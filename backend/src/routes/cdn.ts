import type { FastifyInstance } from 'fastify';
import { domainToASCII } from 'node:url';
import { query, queryOne, table, withTransaction } from '../db.js';
import { hitRateLimitDistributed } from '../lib/rateLimit.js';
import { configGet, configSet } from '../config.js';
import { getCdnProvider, cdnConfig } from '../lib/cdn/factory.js';
import { getDnsProvider } from '../lib/dns/factory.js';
import { certConfig } from '../lib/cert/factory.js';
import { isCdnDomainIdColumnAvailable } from '../lib/cert/cdnDomainIdColumn.js';
import { getCdnAccountEpoch } from '../lib/cdn/cacheEpoch.js';
import {
  ensureWildcardOrder,
  ensureExactOrder,
  ensureCertDeploy,
  ensureCertDeployForDomain,
  findExactCertOrders,
  providerReady,
  resolveCertAccount,
  ensureDefaultLetsEncrypt,
  linkLog,
  DEFAULT_LE_EMAIL,
  removeCertOrdersLinkedToCdnDomain,
} from '../lib/cdn/certLink.js';
import { CertDeployService } from '../lib/deployService.js';
import { kickOrderProcessing } from '../lib/cert/certTaskService.js';
import type { CdnProvider } from '../lib/cdn/types.js';
import { queryByRoute, hasCdnStatistics, type StatisticsDomain } from '../lib/cdn/statistics/index.js';
import { ensureSections, mergeResult } from '../lib/cdn/statistics/util.js';
import { asText } from '../lib/util.js';
import { loadCached as loadCachedStatistics, isStatCacheEnabled, STAT_COVER_MS, EO_DATA_DELAY_MS } from '../lib/cdn/statistics/cacheService.js';
import { getCatalog, listCatalogs } from '../lib/cdn/statistics/catalog/index.js';
import type { DetailResponse, MetricSeries, ProviderCard, BreakdownItem } from '../lib/cdn/statistics/catalog/result.js';
import { buildOverview, type OverviewAccount } from '../lib/cdn/statistics/overview.js';
import { fetchDetail } from '../lib/cdn/statistics/detail/index.js';
import { aggregate, buildTimeline, combineSeries, mergeRateSeries, runPool } from '../lib/cdn/statistics/detail/shared.js';
import { getCachedDetail, setCachedDetail } from '../lib/cdn/statistics/detail/cache.js';
import { parseGroups, parseFilters, parseTop, BASIC_KEYS, basicUnit } from '../lib/cdn/statistics/validate.js';
import { checkLevel, getUserPermissions, isRecordInScope, matchPermission } from '../auth.js';
import { ConfigDecryptError, decryptConfig, isEncryptedConfig, readAccountConfig, readConfigSafe } from '../lib/secret.js';
import { canAccessCertOrder, canAccessDomainAccount, getVisibleAccount, listVisibleAccounts } from '../lib/accounts/visibility.js';
import { findVaultDekForRequest } from '../lib/vault/service.js';
import { audit } from '../lib/audit/context.js';
import { diffFields } from '../lib/audit/mask.js';
import { ESA_RULE_KINDS, esaRuleFields, isEsaRuleKind } from '../lib/cdn/ruleSchema.js';
import { cleanEsaApiParams, getEsaApi, getEsaCatalog, missingEsaApiParams } from '../lib/cdn/esaApiCatalog.js';
import { EO_CONDITION_SCHEMA } from '../lib/cdn/ruleCondition.js';

// CDN 路由默认只要求登录；账户/域名入口再按归属收口。
// 站点级设置、证书申请、刷新预热、同步等管理动作仍要求管理员。
const authenticate = (app: FastifyInstance) => ({
  preHandler: async (req: any, reply: any) => {
    await (app as any).authenticate(req, reply);
  },
});

const requireAdmin = (app: FastifyInstance) => ({
  preHandler: async (req: any, reply: any) => {
    await (app as any).authenticate(req, reply);
    if (!req.user) return;
    if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
  },
});

function parseStatTime(v: any): Date | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    const m = String(url).match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/]+)/);
    return m ? m[1].split(':')[0] : '';
  }
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

function safeJson(s: any): Record<string, any> {
  if (s && typeof s === 'object') return s as Record<string, any>;
  const cfg = decryptConfig(s);
  if (cfg) return cfg;
  if (isEncryptedConfig(s)) {
    throw new ConfigDecryptError('账户配置无法解密（系统密钥可能已变更），请重新填写账户凭证');
  }
  return {};
}

/** 账户配置读取：私有账户需用保险库 DEK 解密，未解锁时明确报错而非静默当成空配置 */
async function accountConfigOf(acct: any): Promise<Record<string, any>> {
  if (acct?.visibility === 'private') {
    // 必须绑定当前会话：没有本会话解锁记录时按「已锁定」处理
    const dek = await findVaultDekForRequest(Number(acct.owner_uid));
    const { config, state } = readAccountConfig(acct.config, dek);
    if (state === 'locked') throw new ConfigDecryptError('保险库已锁定，请先解锁');
    if (state === 'error') throw new ConfigDecryptError('私有账户凭证无法解密，请重新填写');
    return config;
  }
  return safeJson(acct?.config);
}

/** 校验用户能否把加速域名接入到该 DNS 域名：管理员放行；普通用户需有非只读授权且记录名在授权范围内 */
async function assertDnsDomainUsable(user: any, did: number, accelName: string): Promise<any | null> {
  if (!Number.isFinite(did) || did <= 0) return null;
  const d: any = await queryOne(
    `SELECT D.*, A.visibility AS account_visibility, A.owner_uid AS account_owner
       FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id
      WHERE D.id = ?`,
    [did],
  );
  if (!d) return null;
  // 私有 DNS 账户只允许所有者使用，即使调用方是管理员也不能借域名 ID 使用他人云凭据
  if (d.account_visibility === 'private' && Number(d.account_owner) !== Number(user?.uid)) return null;
  if (checkLevel(user, 2)) return d;
  const name = String(accelName || '').toLowerCase();
  const base = String(d.name || '').toLowerCase();
  if (name !== base && !name.endsWith('.' + base)) return null;
  const recordName = name === base ? '@' : name.slice(0, name.length - base.length - 1);
  const perms = await getUserPermissions(Number(user?.uid));
  // 权限表可能存小写域名，比较时统一大小写；只读授权不能写入
  const hit = perms.find(
    (p: any) =>
      String(p.domain).toLowerCase() === base &&
      Number(p.readonly) !== 1 &&
      isRecordInScope(recordName, p.sub || null),
  );
  return hit ? d : null;
}

function calcRecordName(accelDomain: string, dnsDomain: string): string {
  if (accelDomain === dnsDomain) return '@';
  return accelDomain.slice(0, accelDomain.length - dnsDomain.length - 1);
}

// 删除接入 CDN 域名时联动创建的 DNS 解析记录（CNAME）。
// 优先按 cdn_domain.dns_record 记录 ID 删除；若缺失（历史数据/接入时自动添加失败）则
// 按「记录名 + CNAME + 目标值」精确匹配兜底，避免误删无关记录。
async function removeLinkedDnsRecord(row: any, user: any): Promise<{ ok: boolean; message: string }> {
  const dnsDomain: any = await assertDnsDomainUsable(user, Number(row.did), String(row.name));
  if (!dnsDomain) return { ok: false, message: '未找到联动域名或无权限，解析记录需手动处理' };
  const dnsAcct: any = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
  if (!dnsAcct) return { ok: false, message: 'DNS账户不存在，解析记录需手动处理' };
  const dns: any = getDnsProvider(dnsAcct.type, await accountConfigOf(dnsAcct), dnsDomain.name, dnsDomain.thirdid);
  if (!dns) return { ok: false, message: 'DNS模块不存在，解析记录需手动处理' };

  const norm = (v: any) => String(Array.isArray(v) ? v[0] : v ?? '').trim().toLowerCase();
  let recordId = row.dns_record ? String(row.dns_record) : '';
  if (!recordId && row.cname) {
    const recName = calcRecordName(row.name, dnsDomain.name);
    const res = await dns.getDomainRecords(1, 500);
    const hit = (res && res.list ? res.list : []).find(
      (r: any) =>
        String(r.Type).toUpperCase() === 'CNAME' &&
        norm(r.Name) === norm(recName) &&
        norm(r.Value).replace(/\.+$/, '') === norm(row.cname).replace(/\.+$/, ''),
    );
    if (hit) recordId = String(hit.RecordId);
  }
  if (!recordId) return { ok: false, message: '未找到联动创建的解析记录（可能已手动删除）' };

  // dns_record 可能来自历史数据或导入，不能直接按 ID 删除。
  // 删除前核对记录确实属于当前域名、类型/名称/值与联动信息一致。
  const infoFn = (dns as any).getDomainRecordInfo;
  if (typeof infoFn !== 'function') return { ok: false, message: '该 DNS 类型不支持记录校验，需手动删除' };
  const current = await infoFn(recordId).catch(() => null);
  if (!current) return { ok: false, message: '联动解析记录不存在或无法查询，需手动处理' };
  const shortName = (v: any) => {
    let s = norm(v).replace(/\.+$/, '');
    const base = norm(dnsDomain.name).replace(/\.+$/, '');
    if (!s || s === base) return '@';
    if (s.endsWith('.' + base)) s = s.slice(0, -(base.length + 1));
    return s;
  };
  if (shortName(current.Name) !== shortName(calcRecordName(row.name, dnsDomain.name))) {
    return { ok: false, message: '联动记录名称已变化，需手动处理' };
  }
  if (current.Domain && norm(current.Domain).replace(/\.+$/, '') !== norm(dnsDomain.name).replace(/\.+$/, '')) {
    return { ok: false, message: '联动记录不属于当前域名，已拒绝删除' };
  }
  if (current.Type && String(current.Type).toUpperCase() !== 'CNAME') {
    return { ok: false, message: '联动记录类型已变化，需手动处理' };
  }
  if (row.cname && norm(current.Value).replace(/\.+$/, '') !== norm(row.cname).replace(/\.+$/, '')) {
    return { ok: false, message: '联动记录值已变化，需手动处理' };
  }

  const ok = await dns.deleteDomainRecord(recordId);
  if (!ok) return { ok: false, message: (dns.getError?.() || '删除解析记录失败') + '，需手动处理' };
  return { ok: true, message: '已删除联动解析记录' };
}

function normalizeSetting(v: any): any {
  if (Array.isArray(v)) {
    return v.map(normalizeSetting).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = normalizeSetting(v[k]);
    return out;
  }
  return v;
}

function zoneSettingDiff(current: Record<string, any>, target: Record<string, any>): Record<string, any> {
  const diff: Record<string, any> = {};
  for (const key of Object.keys(target)) {
    const value = target[key];
    const cur = current[key];
    if (JSON.stringify(normalizeSetting(value)) !== JSON.stringify(normalizeSetting(cur))) {
      diff[key] = value;
    }
  }
  return diff;
}

const areaMap: Record<string, string> = { mainland: 'mainland_china', domestic: 'mainland_china', overseas: 'overseas', global: 'global' };

function parseIds(raw: any): number[] {
  return [
    ...new Set(
      (Array.isArray(raw) ? raw : [])
        .map((x: any) => Number(x))
        .filter((n: number) => Number.isInteger(n) && n > 0),
    ),
  ].slice(0, 200) as number[]; // 上限 200，避免单请求扇出大量上游调用
}

function summarizeResults(list: any[], pendingLabel: string): string {
  const applied = list.filter((r) => r.status === 'applied').length;
  const pending = list.filter((r) => r.status === 'pending').length;
  const failed = list.filter((r) => r.status === 'failed').length;
  return `成功 ${applied} 个，${pendingLabel} ${pending} 个，失败 ${failed} 个`;
}


function fmtStatTime(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 跨账户合并同一指标的序列：sum 累加、max 取大、rate 按流量/请求加权 */
function mergeDetailSeries(list: MetricSeries[]): MetricSeries[] {
  const map = new Map<string, MetricSeries>();
  for (const s of list) {
    const prev = map.get(s.key);
    if (!prev) {
      map.set(s.key, { ...s, values: [...s.values] });
      continue;
    }
    const len = prev.values.length;
    if (s.agg === 'rate') {
      map.set(s.key, mergeRateSeries(prev, s));
      continue;
    }
    const values = combineSeries([prev.values, s.values], s.agg, len);
    map.set(s.key, { ...prev, values, summary: aggregate(values, s.agg) });
  }
  return [...map.values()];
}

/** 合并多账户的 Top 表：同标签求和后重算占比 */
function mergeBreakdowns(list: BreakdownItem[]): BreakdownItem[] {
  const map = new Map<string, BreakdownItem>();
  for (const item of list) {
    const prev = map.get(item.key);
    if (!prev) {
      map.set(item.key, { ...item, rows: item.rows.map((r) => ({ ...r })) });
      continue;
    }
    const rows = new Map(prev.rows.map((r) => [r.label, r.value]));
    for (const row of item.rows) rows.set(row.label, (rows.get(row.label) || 0) + row.value);
    const total = [...rows.values()].reduce((a, b) => a + b, 0);
    prev.rows = [...rows.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, value]) => ({ label, value, percent: total > 0 ? (value / total) * 100 : 0 }));
  }
  return [...map.values()];
}

/** 旧缓存结构 → 新详情结构（非管理员只读缓存） */
function detailFromCache(route: string, cached: any, start: Date, end: Date, delayMinutes: number): DetailResponse {
  const catalog = getCatalog(route);
  const labels: string[] = cached?.labels || [];
  const isDay = end.getTime() - start.getTime() > 86400000;
  const interval: 'hour' | 'day' = isDay ? 'day' : 'hour';
  const len = labels.length;
  const rs = cached?.resource?.resource_detail || {};
  const rsum = cached?.resource?.resource_summary || {};
  const vs = cached?.visits?.visits_detail || {};
  const vsum = cached?.visits?.visits_summary || {};
  const series: MetricSeries[] = [];
  const push = (key: string, values: (number | null)[], summary?: number | null) => {
    const def = catalog?.metrics.find((m) => m.key === key);
    if (!def) return;
    series.push({
      key: def.key,
      group: def.group,
      unit: def.unit,
      agg: def.agg,
      chart: def.chart,
      values,
      summary: summary === undefined ? aggregate(values, def.agg) : summary,
      stack: def.stack,
    });
  };
  const outFlux = rs.out_flux || rs.flux || [];
  const hitFlux = vs.hit_flux || [];
  const hitRate = hitFlux.map((h: number, i: number) => {
    const den = Number(outFlux[i] || 0);
    return den > 0 ? (Number(h || 0) / den) * 100 : null;
  });
  const fluxVals = rs.flux || new Array(len).fill(null);
  push('flux', fluxVals, rsum.flux ?? null);
  push('flux_out', rs.out_flux || new Array(len).fill(null), rsum.out_flux ?? null);
  push('bw', rs.bw || new Array(len).fill(null), rsum.bw ?? null);
  push('bs_flux', rs.bs_flux || new Array(len).fill(null), rsum.bs_flux ?? null);
  push('req', vs.req_num || new Array(len).fill(null), vsum.req_num ?? null);
  push('hit_rate', hitRate, aggregate(hitRate, 'avg'));
  push('hit_rate_flux', hitRate, aggregate(hitRate, 'avg'));
  push('hit_flux', hitFlux, vsum.hit_flux ?? null);
  push('hit_req', vs.hit_num || new Array(len).fill(null), vsum.hit_num ?? null);
  const status = cached?.status;
  if (status?.status_detail) {
    (['sc_2xx', 'sc_3xx', 'sc_4xx', 'sc_5xx'] as const).forEach((key, i) => {
      const vals = status.status_detail[i] || new Array(len).fill(null);
      push(key, vals, status.status_summary?.[i] ?? null);
    });
  }
  if (status?.bs_status_detail) {
    (['origin_sc_2xx', 'origin_sc_3xx', 'origin_sc_4xx', 'origin_sc_5xx'] as const).forEach((key, i) => {
      const vals = status.bs_status_detail[i] || new Array(len).fill(null);
      push(key, vals, status.bs_status_summary?.[i] ?? null);
    });
  }
  return {
    route,
    labels,
    interval,
    series,
    breakdowns: [],
    meta: {
      status: series.length ? 'ok' : 'empty',
      dataUntil: fmtStatTime(end),
      delayMinutes,
      cached: true,
      tookMs: 0,
    },
    ...(series.length ? {} : { _errors: ['该时间范围暂未缓存，请稍后再试'] }),
  };
}

function basicsFromCache(cached: any): Array<{ key: string; unit: any; value: number | null }> {
  const rs = cached?.resource?.resource_summary || {};
  const vs = cached?.visits?.visits_summary || {};
  const den = Number(rs.out_flux || 0) || Number(rs.flux || 0);
  const hit = Number(vs.hit_flux || 0);
  const hitRate = den > 0 ? (hit / den) * 100 : null;
  const values: Record<string, number | null> = {
    flux: rs.flux ?? null,
    bw: rs.bw ?? null,
    bs_flux: rs.bs_flux ?? null,
    req: vs.req_num ?? null,
    hit_rate: hitRate,
  };
  return BASIC_KEYS.map((key) => ({ key, unit: basicUnit(key), value: values[key] ?? null }));
}

export default async function cdnRoutes(app: FastifyInstance) {
  const auth = authenticate(app);
  const adminAuth = requireAdmin(app);
  const providerCache = new Map<string, { at: number; provider: CdnProvider | false }>();
  const PROVIDER_CACHE_TTL = 5000;
  let providerCacheEpoch = getCdnAccountEpoch();

  // 数据统计：管理员，或被管理员单独授权使用统计缓存的用户
  const statAuth = {
    preHandler: async (req: any, reply: any) => {
      await (app as any).authenticate(req, reply);
      if (!req.user) return;
      if (!checkLevel(req.user, 2) && Number(req.user.stat_cache) !== 1) {
        return reply.code(403).send({ code: -1, msg: '无权限' });
      }
    },
  };

  // 用户直传 aid：统一做可见性校验，越权返回 404（不泄露账户存在性）
  const authAid = {
    preHandler: async (req: any, reply: any) => {
      await (app as any).authenticate(req, reply);
      if (!req.user) return;
      if (!(await hitRateLimitDistributed(`cloud:cdn-account:${req.user.uid}`, 180, 60_000))) return reply.code(429).send({ code: -1, msg: '请求过于频繁，请稍后再试' });
      const acct = await getVisibleAccount('cdn_account', Number(req.params.aid), req.user);
      if (!acct) return reply.code(404).send({ code: -1, msg: '账户不存在' });
      req.account = acct;
    },
  };

  // 用户直传域名 id：先查归属账户，再按账户可见性收口
  const authCdnDomain = {
    preHandler: async (req: any, reply: any) => {
      await (app as any).authenticate(req, reply);
      if (!req.user) return;
      if (!(await hitRateLimitDistributed(`cloud:cdn-domain:${req.user.uid}`, 180, 60_000))) return reply.code(429).send({ code: -1, msg: '请求过于频繁，请稍后再试' });
      const row: any = await queryOne(`SELECT id, aid FROM ${table('cdn_domain')} WHERE id = ?`, [Number(req.params.id)]);
      if (!row) return reply.code(404).send({ code: -1, msg: '加速域名不存在' });
      const acct = await getVisibleAccount('cdn_account', Number(row.aid), req.user);
      if (!acct) return reply.code(404).send({ code: -1, msg: '加速域名不存在' });
      req.cdnDomain = row;
      req.account = acct;
    },
  };

  async function loadCdnDomain(id: number): Promise<any> {
    const row = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE id = ?`, [id]);
    if (!row) return null;
    // 账户密钥不应回传前端：此处不再挂载账户原始 config
    return row;
  }

  async function cdnForRow(row: any): Promise<CdnProvider | false> {
    return cdnForZone(row.aid, row.zone_id);
  }

  // provider 短时缓存：批量操作（缓存刷新/同步）常对同一账户+站点反复构造 provider
  // （每次含 account 查询 + AES 解密），按 aid#zone 缓存 5s，避免逐条重建
  async function cdnForZone(aid: number, zoneId: string | null): Promise<CdnProvider | false> {
    // 账户配置发生增删改时立即失效缓存，避免最长 5s 内仍用旧配置
    const epoch = getCdnAccountEpoch();
    if (epoch !== providerCacheEpoch) {
      providerCache.clear();
      providerCacheEpoch = epoch;
    }
    const key = `${aid}#${zoneId || ''}`;
    const cached = providerCache.get(key);
    if (cached && Date.now() - cached.at < PROVIDER_CACHE_TTL) return cached.provider;
    let provider: CdnProvider | false = false;
    const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
    if (acct) {
      const p: any = getCdnProvider(acct.type, await accountConfigOf(acct));
      if (p) {
        if (zoneId && typeof p.setZoneId === 'function') p.setZoneId(zoneId);
        if (zoneId && typeof p.setSiteId === 'function') p.setSiteId(zoneId);
        provider = p;
      }
    }
    // 私有账户的 provider 不进入共享缓存，避免缓存键仅按 aid 时被其他请求复用
    if (acct?.visibility === 'shared') {
      if (providerCache.size > 200) providerCache.clear();
      providerCache.set(key, { at: Date.now(), provider });
    }
    return provider;
  }

  // 列表
  app.get('/api/cdn/domains', auth, async (req: any) => {
    const q = req.query || {};
    // 可选按账户 / 站点过滤，避免站点设置页为取少量域名而拉取全量列表
    const conds: string[] = [];
    const params: any[] = [];
    if (Number(q.aid || 0)) {
      conds.push('aid = ?');
      params.push(Number(q.aid));
    }
    if (q.zone_id !== undefined && q.zone_id !== null && String(q.zone_id) !== '') {
      conds.push('zone_id = ?');
      params.push(String(q.zone_id));
    }
    const visibleAccounts = await listVisibleAccounts('cdn_account', req.user);
    const allowedAids = new Set(visibleAccounts.map((a: any) => Number(a.id)));
    if (!allowedAids.size) return { code: 0, data: [] };
    // 显式传 aid 时也必须先通过可见性校验，避免用 aid 绕过账户归属过滤
    const qAid = Number(q.aid || 0);
    if (qAid && !allowedAids.has(qAid)) return { code: 0, data: [] };
    // 可见账户直接下推到 SQL，避免先读全表再在内存里过滤
    if (!conds.some((c) => c.startsWith('aid ='))) {
      conds.push(`aid IN (${[...allowedAids].map(() => '?').join(',')})`);
      params.push(...allowedAids);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(`SELECT * FROM ${table('cdn_domain')}${where} ORDER BY id DESC`, params);
    const typeNames = Object.fromEntries(Object.entries(cdnConfig).map(([k, v]) => [k, v.name]));
    const cdnAccounts = visibleAccounts;
    const freeAids = new Set(cdnAccounts.filter((a: any) => cdnConfig[a.type]?.freecert).map((a: any) => a.id));
    const certAids = new Set(cdnAccounts.filter((a: any) => cdnConfig[a.type]?.certapply).map((a: any) => a.id));
    const linkAids = new Set(cdnAccounts.filter((a: any) => cdnConfig[a.type]?.certlink).map((a: any) => a.id));
    // 推导证书管理方式：无显式记录但已绑定联动订单时视为「由本项目管理」，兼容历史数据
    const linkedDids = new Set<number>();
    // cdn_domain_id 为 link 的生成列 + 索引，避免 link LIKE '%cdnDomainId%' 的前缀通配全表扫描；
    // 生成列不可用时降级为 LIKE 粗筛 + 解析，保证功能可用
    if (isCdnDomainIdColumnAvailable()) {
      for (const o of await query(`SELECT DISTINCT cdn_domain_id FROM ${table('cert_order')} WHERE cdn_domain_id IS NOT NULL`)) {
        const did = Number((o as any).cdn_domain_id);
        if (did) linkedDids.add(did);
      }
    } else {
      const lrows = await query(`SELECT link FROM ${table('cert_order')} WHERE link IS NOT NULL AND link LIKE ?`, ['%"cdnDomainId"%']);
      for (const o of lrows as any[]) {
        let did = 0;
        try {
          did = Number(JSON.parse(o.link)?.cdnDomainId || 0);
        } catch {
          did = 0;
        }
        if (did) linkedDids.add(did);
      }
    }
    const data = rows.map((r: any) => ({
      ...r,
      routename: typeNames[r.route] || r.route,
      cert_mode: r.cert_mode || (linkedDids.has(Number(r.id)) ? 'certlink' : ''),
      can_freecert: freeAids.has(r.aid) ? 1 : 0,
      can_certapply: certAids.has(r.aid) ? 1 : 0,
      can_certlink: linkAids.has(r.aid) ? 1 : 0,
    }));
    return { code: 0, data };
  });

  // 站点列表（按账户 + 站点聚合）
  app.get('/api/cdn/zones', auth, async (req: any, reply: any) => {
    const aid = Number(req.query?.aid || 0);
    if (aid) {
      const acct = await getVisibleAccount('cdn_account', aid, req.user);
      if (!acct) return reply.code(404).send({ code: -1, msg: 'CDN账户不存在' });
    }
    const visibleAccounts = await listVisibleAccounts('cdn_account', req.user);
    const allowedAids = new Set(visibleAccounts.map((a: any) => Number(a.id)));
    if (!allowedAids.size) return { code: 0, data: [] };
    const rows = await query(
      `SELECT aid, zone_id, MIN(route) AS route,
              MIN(name) AS primary_name,
              COUNT(*) AS domain_count,
              GROUP_CONCAT(name ORDER BY id ASC SEPARATOR ',') AS domains
       FROM ${table('cdn_domain')}
       WHERE zone_id IS NOT NULL AND zone_id != ''
         AND aid IN (${[...allowedAids].map(() => '?').join(',')})
       GROUP BY aid, zone_id
       ORDER BY aid ASC, zone_id ASC`,
      [...allowedAids],
    );
    const typeNames = Object.fromEntries(Object.entries(cdnConfig).map(([k, v]) => [k, v.name]));
    const localItem = (r: any) => ({
      aid: r.aid,
      zone_id: r.zone_id,
      route: r.route,
      routename: typeNames[r.route] || r.route,
      name: r.primary_name,
      zone_name: r.primary_name,
      domain_count: Number(r.domain_count),
      domains: String(r.domains || '').split(',').filter(Boolean),
      cloud: false,
    });

    // 不传 aid：保持既有行为（本地已接入域名的站点聚合）
    if (!aid) {
      return { code: 0, data: (rows as any[]).map(localItem) };
    }

    // 传 aid：以「云端站点」为准，含尚未接入任何域名的站点；本地数据仅用于补域名数与域名列表
    const acct: any = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
    if (!acct) return { code: -1, msg: 'CDN账户不存在' };
    const provider: any = getCdnProvider(acct.type, await accountConfigOf(acct));
    if (!provider || typeof provider.getZones !== 'function') {
      // 该类型不支持站点枚举时回退到本地聚合，避免页面空白
      return { code: 0, data: (rows as any[]).filter((r) => Number(r.aid) === aid).map(localItem), cloud: false };
    }
    const zones = await provider.getZones();
    if (zones === false) return { code: -1, msg: '获取站点列表失败，' + provider.getError() };
    const localByKey = new Map<string, any>();
    for (const r of rows as any[]) localByKey.set(`${r.aid}::${r.zone_id}`, r);
    let verifiedMap: Record<string, string> = {};
    try {
      verifiedMap = JSON.parse((await configGet('cdn_zone_verified', '{}')) || '{}');
    } catch {
      verifiedMap = {};
    }
    const data = (zones as any[]).map((z: any) => {
      const loc = localByKey.get(`${aid}::${String(z.zoneId)}`);
      return {
        aid,
        zone_id: String(z.zoneId),
        route: acct.type,
        routename: typeNames[acct.type] || acct.type,
        name: loc?.primary_name || z.zoneName || '',
        zone_name: z.zoneName || '',
        domain_count: loc ? Number(loc.domain_count) : 0,
        domains: loc ? String(loc.domains || '').split(',').filter(Boolean) : [],
        status: z.status,
        area: z.area,
        paused: z.paused === true,
        identificationStatus: z.identificationStatus,
        ownershipVerified: z.ownershipVerified === true || !!verifiedMap[`${aid}:${String(z.zoneId)}`],
        cloud: true,
      };
    });
    return { code: 0, data, cloud: true };
  });

  // 站点配置读取
  app.get('/api/cdn/zones/setting', adminAuth, async (req: any, reply: any) => {
    const aid = Number(req.query.aid || 0);
    const zoneId = String(req.query.zone_id || '').trim();
    if (!aid || !zoneId) return { code: -1, msg: '参数不完整' };
    if (!(await getVisibleAccount('cdn_account', aid, req.user))) {
      return reply.code(404).send({ code: -1, msg: 'CDN账户不存在' });
    }
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getZoneSetting !== 'function') return { code: -1, msg: '该站点不支持站点级配置' };
    const zs = await provider.getZoneSetting(zoneId);
    if (zs === false) return { code: -1, msg: '获取站点配置失败，' + provider.getError() };
    return { code: 0, data: { zoneSetting: zs } };
  });

  // 站点配置保存
  app.post('/api/cdn/zones/setting', adminAuth, async (req: any, reply: any) => {
    const { aid, zone_id, setting } = req.body || {};
    const zoneId = String(zone_id || '').trim();
    if (!aid || !zoneId) return { code: -1, msg: '参数不完整' };
    if (!(await getVisibleAccount('cdn_account', Number(aid), req.user))) {
      return reply.code(404).send({ code: -1, msg: 'CDN账户不存在' });
    }
    const provider: any = await cdnForZone(Number(aid), zoneId);
    if (!provider || typeof provider.getZoneSetting !== 'function' || typeof provider.updateZoneSetting !== 'function') {
      return { code: -1, msg: '该站点不支持站点级配置' };
    }
    if (!setting || typeof setting !== 'object') return { code: -1, msg: '配置数据无效' };
    const current = await provider.getZoneSetting(zoneId);
    if (current === false) return { code: -1, msg: '获取当前站点配置失败，' + provider.getError() };
    const diff = zoneSettingDiff(current, setting);
    if (!Object.keys(diff).length) return { code: 0, msg: '未检测到配置变化' };
    if (!(await provider.updateZoneSetting(zoneId, diff))) return { code: -1, msg: '站点配置更新失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: zoneId,
      summary: `修改站点配置 ${zoneId}（${Object.keys(diff).length} 项）`,
      changes: diffFields(current, { ...current, ...diff }),
      detail: { aid, zone_id: zoneId, keys: Object.keys(diff) },
    });
    return { code: 0, msg: '站点配置更新成功' };
  });

  // ===== 站点生命周期（EO Zone / ESA Site）=====

  // 云上站点列表
  app.get('/api/cdn/accounts/:aid/sites', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.getZones !== 'function') return { code: -1, msg: '该 CDN 类型不支持站点管理' };
    const zones = await provider.getZones();
    if (zones === false) return { code: -1, msg: '获取站点列表失败，' + provider.getError() };
    // 尽力补齐暂停状态：provider 已在列表里返回布尔 paused 时直接沿用，避免逐站再查一次（N+1）。
    // 缺失状态时用 4 并发补齐，站点多时不再串行等待。
    if (typeof provider.getZonePaused === 'function') {
      const pending = (zones as any[]).filter((z) => z.zoneId && typeof z.paused !== 'boolean');
      await runPool(
        pending.map((z) => async () => {
          try {
            z.paused = (await provider.getZonePaused(String(z.zoneId))) === true;
          } catch {
            z.paused = false;
          }
        }),
        4,
      );
    }
    return { code: 0, data: zones };
  });

  // 套餐实例列表（ESA 创建站点需要）
  app.get('/api/cdn/accounts/:aid/plan-instances', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.listPlanInstances !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐实例查询' };
    const list = await provider.listPlanInstances();
    if (list === false) return { code: -1, msg: '获取套餐实例失败，' + provider.getError() };
    return { code: 0, data: list };
  });

  // 站点名校验 / 归属识别
  app.post('/api/cdn/accounts/:aid/sites/check', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const name = String((req.body || {}).siteName || '').trim();
    if (!name) return { code: -1, msg: '站点名称不能为空' };
    const provider: any = await cdnForZone(aid, null);
    if (!provider) return { code: -1, msg: '账户不存在' };
    if (typeof provider.checkSiteName === 'function') {
      const r = await provider.checkSiteName(name);
      if (r === false) return { code: -1, msg: '站点名校验失败，' + provider.getError() };
      return { code: 0, data: r };
    }
    if (typeof provider.identifyZone === 'function') {
      const r = await provider.identifyZone(name);
      if (r === false) return { code: -1, msg: '站点识别失败，' + provider.getError() };
      return { code: 0, data: r };
    }
    return { code: -1, msg: '该 CDN 类型不支持站点校验' };
  });

  // 创建站点
  app.post('/api/cdn/accounts/:aid/sites', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.createZone !== 'function') return { code: -1, msg: '该 CDN 类型不支持创建站点' };
    const b = req.body || {};
    const name = String(b.name || b.siteName || '').trim();
    if (!name) return { code: -1, msg: '站点名称不能为空' };
    const zone = await provider.createZone({
      name,
      type: b.type,
      area: b.area || b.coverage,
      planId: b.planId,
      accessType: b.accessType,
      instanceId: b.instanceId,
    });
    if (zone === false) return { code: -1, msg: '创建站点失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: (zone as any)?.zoneId,
      targetName: name,
      summary: `创建站点 ${name}`,
      detail: { aid, name, type: b.type, area: b.area || b.coverage },
    });
    return { code: 0, msg: '站点创建成功', data: zone };
  });

  // 验证归属
  app.post('/api/cdn/accounts/:aid/sites/verify', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.verifyOwnership !== 'function') return { code: -1, msg: '该 CDN 类型不支持归属验证' };
    const r = await provider.verifyOwnership(zoneId, b.domain ? String(b.domain) : undefined);
    if (r === false) return { code: -1, msg: '验证失败，' + provider.getError() };
    // 记录本地确认，避免云端状态延迟导致按钮再次出现
    try {
      const raw = (await configGet('cdn_zone_verified', '{}')) || '{}';
      const map = JSON.parse(raw);
      map[`${aid}:${zoneId}`] = new Date().toISOString();
      await configSet('cdn_zone_verified', JSON.stringify(map));
    } catch {
      /* 记录失败不影响验证结果 */
    }
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: String(b.domain || zoneId),
      summary: `验证站点归属 ${b.domain || zoneId}`,
    });
    return { code: 0, data: r };
  });

  // 暂停 / 启用站点
  app.post('/api/cdn/accounts/:aid/sites/pause', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setZonePaused !== 'function') return { code: -1, msg: '该 CDN 类型不支持暂停/启用' };
    const paused = b.paused === true || b.paused === 'true' || b.paused === 1;
    if (!(await provider.setZonePaused(zoneId, paused))) return { code: -1, msg: '操作失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: zoneId,
      summary: `${paused ? '暂停' : '启用'}站点 ${zoneId}`,
    });
    return { code: 0, msg: paused ? '站点已暂停' : '站点已启用' };
  });

  // 站点 NS 列表
  app.get('/api/cdn/accounts/:aid/sites/:zoneId/ns', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getSiteNs !== 'function') return { code: -1, msg: '该 CDN 类型不支持 NS 查询' };
    const ns = await provider.getSiteNs(zoneId);
    if (ns === false) return { code: -1, msg: '获取 NS 失败，' + provider.getError() };
    return { code: 0, data: ns };
  });

  // 站点完整属性（ESA GetSite / GetSiteNameExclusive / 自定义 NS）
  app.get('/api/cdn/accounts/:aid/sites/:zoneId/properties', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getSiteProperties !== 'function') return { code: -1, msg: '该 CDN 类型不支持站点属性查询' };
    const data = await provider.getSiteProperties(zoneId);
    if (data === false) return { code: -1, msg: '获取站点属性失败，' + provider.getError() };
    return { code: 0, data };
  });

  // 更新站点属性（接入类型 / 覆盖范围 / 站点名独占 / 自定义 NS）
  app.put('/api/cdn/accounts/:aid/sites/:zoneId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const b = req.body || {};
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider) return { code: -1, msg: '账户不存在' };
    let changed = false;
    if (b.accessType && typeof provider.updateSiteAccessType === 'function') {
      if (!(await provider.updateSiteAccessType(zoneId, String(b.accessType)))) return { code: -1, msg: '接入类型更新失败，' + provider.getError() };
      changed = true;
    }
    if (b.coverage && typeof provider.updateSiteCoverage === 'function') {
      if (!(await provider.updateSiteCoverage(zoneId, String(b.coverage)))) return { code: -1, msg: '覆盖范围更新失败，' + provider.getError() };
      changed = true;
    }
    if (b.nameExclusive !== undefined && typeof provider.updateSiteNameExclusive === 'function') {
      const enable = b.nameExclusive === true || b.nameExclusive === 'true' || b.nameExclusive === 1 || b.nameExclusive === 'on';
      if (!(await provider.updateSiteNameExclusive(zoneId, enable))) return { code: -1, msg: '站点名独占更新失败，' + provider.getError() };
      changed = true;
    }
    if (b.vanityNs !== undefined && typeof provider.updateSiteVanityNS === 'function') {
      const list = Array.isArray(b.vanityNs)
        ? b.vanityNs.map((x: any) => String(x).trim()).filter(Boolean)
        : String(b.vanityNs || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (!(await provider.updateSiteVanityNS(zoneId, list))) return { code: -1, msg: '自定义 NS 更新失败，' + provider.getError() };
      changed = true;
    }
    if (!changed) return { code: -1, msg: '无可更新项或该 CDN 类型不支持' };
    return { code: 0, msg: '更新成功' };
  });

  // 删除站点
  app.delete('/api/cdn/accounts/:aid/sites/:zoneId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteZone !== 'function') return { code: -1, msg: '该 CDN 类型不支持删除站点' };
    if (!(await provider.deleteZone(zoneId))) return { code: -1, msg: '删除失败，' + provider.getError() };
    return { code: 0, msg: '站点已删除' };
  });

  // ===== 源站组 =====
  app.get('/api/cdn/accounts/:aid/origin-groups', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listOriginGroups !== 'function') return { code: -1, msg: '该 CDN 类型不支持源站组' };
    const r = await provider.listOriginGroups(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取源站组失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/origin-groups', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !b.name) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createOriginGroup !== 'function') return { code: -1, msg: '该 CDN 类型不支持源站组' };
    const id = await provider.createOriginGroup(zoneId, { name: b.name, type: b.type, records: b.records, hostHeader: b.hostHeader, params: b.params });
    if (id === false) return { code: -1, msg: '创建源站组失败，' + provider.getError() };
    return { code: 0, msg: '创建成功', data: { groupId: id } };
  });

  app.put('/api/cdn/accounts/:aid/origin-groups/:groupId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const groupId = String((req.params as any).groupId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !groupId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateOriginGroup !== 'function') return { code: -1, msg: '该 CDN 类型不支持源站组' };
    if (!(await provider.updateOriginGroup(zoneId, groupId, { name: b.name, type: b.type, records: b.records, hostHeader: b.hostHeader, params: b.params }))) {
      return { code: -1, msg: '更新失败，' + provider.getError() };
    }
    return { code: 0, msg: '更新成功' };
  });

  app.delete('/api/cdn/accounts/:aid/origin-groups/:groupId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const groupId = String((req.params as any).groupId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !groupId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteOriginGroup !== 'function') return { code: -1, msg: '该 CDN 类型不支持源站组' };
    if (!(await provider.deleteOriginGroup(zoneId, groupId))) return { code: -1, msg: '删除失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

  // ===== 负载均衡 =====
  app.get('/api/cdn/accounts/:aid/load-balancers', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listLoadBalancers !== 'function') return { code: -1, msg: '该 CDN 类型不支持负载均衡' };
    const r = await provider.listLoadBalancers(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取负载均衡失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/load-balancers', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !b.name) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createLoadBalancer !== 'function') return { code: -1, msg: '该 CDN 类型不支持负载均衡' };
    const id = await provider.createLoadBalancer(zoneId, {
      name: b.name,
      type: b.type,
      originGroups: b.originGroups,
      healthChecker: b.healthChecker,
      steeringPolicy: b.steeringPolicy,
      failoverPolicy: b.failoverPolicy,
      params: b.params,
    });
    if (id === false) return { code: -1, msg: '创建负载均衡失败，' + provider.getError() };
    return { code: 0, msg: '创建成功', data: { instanceId: id } };
  });

  app.put('/api/cdn/accounts/:aid/load-balancers/:instanceId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const instanceId = String((req.params as any).instanceId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !instanceId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateLoadBalancer !== 'function') return { code: -1, msg: '该 CDN 类型不支持负载均衡' };
    if (!(await provider.updateLoadBalancer(zoneId, instanceId, {
      name: b.name,
      originGroups: b.originGroups,
      healthChecker: b.healthChecker,
      steeringPolicy: b.steeringPolicy,
      failoverPolicy: b.failoverPolicy,
      params: b.params,
    }))) {
      return { code: -1, msg: '更新失败，' + provider.getError() };
    }
    return { code: 0, msg: '更新成功' };
  });

  app.delete('/api/cdn/accounts/:aid/load-balancers/:instanceId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const instanceId = String((req.params as any).instanceId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !instanceId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteLoadBalancer !== 'function') return { code: -1, msg: '该 CDN 类型不支持负载均衡' };
    if (!(await provider.deleteLoadBalancer(zoneId, instanceId))) return { code: -1, msg: '删除失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

  // ===== 规则引擎（EO L7 规则）=====
  app.get('/api/cdn/accounts/:aid/rules/setting', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.getRulesSetting !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则元数据' };
    const r = await provider.getRulesSetting();
    if (r === false) return { code: -1, msg: '获取规则元数据失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    const list = await provider.listRules(zoneId);
    if (list === false) return { code: -1, msg: '获取规则失败，' + provider.getError() };
    return { code: 0, data: list };
  });

  app.post('/api/cdn/accounts/:aid/rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !b.ruleName) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createRule !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    const id = await provider.createRule(zoneId, { ruleName: b.ruleName, status: b.status, enabled: b.enabled, branches: b.branches, description: b.description });
    if (id === false) return { code: -1, msg: '创建规则失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_rule',
      targetId: id,
      targetName: String(b.ruleName),
      summary: `新建规则 ${b.ruleName}（${zoneId}）`,
      detail: { aid, zoneId, ruleName: b.ruleName, status: b.status },
    });
    return { code: 0, msg: '创建成功', data: { ruleId: id } };
  });

  app.put('/api/cdn/accounts/:aid/rules/:ruleId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const ruleId = String((req.params as any).ruleId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !ruleId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateRule !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    if (!(await provider.updateRule(zoneId, ruleId, { ruleName: b.ruleName, status: b.status, enabled: b.enabled, branches: b.branches, description: b.description }))) {
      return { code: -1, msg: '更新规则失败，' + provider.getError() };
    }
    audit(req, {
      targetType: 'cdn_rule',
      targetId: ruleId,
      targetName: String(b.ruleName || ruleId),
      summary: `修改规则 ${b.ruleName || ruleId}（${zoneId}）`,
      detail: { aid, zoneId, ruleName: b.ruleName, status: b.status },
    });
    return { code: 0, msg: '更新成功' };
  });

  app.delete('/api/cdn/accounts/:aid/rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const ruleIds: string[] = Array.isArray(b.ruleIds) ? b.ruleIds.map((x: any) => String(x)) : [];
    if (!zoneId || !ruleIds.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    if (!(await provider.deleteRules(zoneId, ruleIds))) return { code: -1, msg: '删除规则失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_rule',
      targetName: zoneId,
      summary: `删除规则 ${ruleIds.length} 条（${zoneId}）`,
      detail: { aid, zoneId, ruleIds: ruleIds.slice(0, 50) },
    });
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/cdn/accounts/:aid/rules/priority', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const ruleIds: string[] = Array.isArray(b.ruleIds) ? b.ruleIds.map((x: any) => String(x)) : [];
    if (!zoneId || !ruleIds.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setRulePriority !== 'function') return { code: -1, msg: '该 CDN 类型不支持优先级调整' };
    if (!(await provider.setRulePriority(zoneId, ruleIds))) return { code: -1, msg: '优先级调整失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_rule',
      targetName: zoneId,
      summary: `调整规则优先级（${zoneId}）`,
      detail: { aid, zoneId, ruleIds: ruleIds.slice(0, 50) },
    });
    return { code: 0, msg: '优先级已更新' };
  });

  // ===== 规则引擎（ESA 12 类规则配置，kind 形如 RedirectRule）=====
  app.get('/api/cdn/accounts/:aid/rule-configs', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const kind = String(req.query.kind || '').trim();
    if (!zoneId || !kind) return { code: -1, msg: '参数不完整' };
    if (!isEsaRuleKind(kind)) return { code: -1, msg: '不支持的规则类型' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listRuleConfigs !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    const r = await provider.listRuleConfigs(zoneId, kind, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取规则失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/rule-configs', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const kind = String(b.kind || '').trim();
    if (!zoneId || !kind) return { code: -1, msg: '参数不完整' };
    if (!isEsaRuleKind(kind)) return { code: -1, msg: '不支持的规则类型' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.upsertRuleConfig !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!(await provider.upsertRuleConfig(zoneId, kind, params))) return { code: -1, msg: '保存规则失败，' + provider.getError() };
    return { code: 0, msg: '保存成功' };
  });

  app.delete('/api/cdn/accounts/:aid/rule-configs/:configId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const configId = String((req.params as any).configId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    const kind = String((req.body || {}).kind || req.query.kind || '').trim();
    if (!zoneId || !kind || !configId) return { code: -1, msg: '参数不完整' };
    if (!isEsaRuleKind(kind)) return { code: -1, msg: '不支持的规则类型' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteRuleConfig !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    if (!(await provider.deleteRuleConfig(zoneId, kind, configId))) return { code: -1, msg: '删除规则失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

  // 规则字段元数据：驱动可视化规则编辑器
  //   ESA：由官方 OpenAPI 元数据生成的静态字段表（15 类 × List/Create/Update/Delete 全支持）
  //   EO ：透传 DescribeRulesSetting，返回可用动作及其属性定义（Type=CHOICE/TOGGLE/OBJECT/...）
  app.get('/api/cdn/accounts/:aid/rule-schema', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const acct: any = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
    if (!acct) return { code: -1, msg: '账户不存在' };
    const provider: any = getCdnProvider(acct.type, await accountConfigOf(acct));
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };

    if (typeof provider.listRuleConfigs === 'function') {
      const kind = String(req.query.kind || '').trim();
      if (!kind) {
        return {
          code: 0,
          data: {
            vendor: 'esa',
            kinds: ESA_RULE_KINDS.map((k) => ({ kind: k, fields: esaRuleFields(k) })),
          },
        };
      }
      if (!isEsaRuleKind(kind)) return { code: -1, msg: '不支持的规则类型' };
      return { code: 0, data: { vendor: 'esa', kind, fields: esaRuleFields(kind) } };
    }

    if (typeof provider.listRules === 'function') {
      // EO：规则结构（Branches/Actions）由前端静态元数据驱动，无需透传旧版 DescribeRulesSetting
      return { code: 0, data: { vendor: 'eo', condition: EO_CONDITION_SCHEMA } };
    }

    return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
  });

  // ===== 阿里云 ESA 全量 OpenAPI 控制台 =====
  // 官方 478 个接口的目录与参数元数据，供前端按分类生成可视化表单
  app.get('/api/cdn/accounts/:aid/esa/catalog', authAid, async (req: any) => {
    const acct = req.account;
    if (!acct || acct.type !== 'aliyun_esa') return { code: -1, msg: '该账户不是阿里云 ESA' };
    return { code: 0, data: getEsaCatalog() };
  });

  // 通用 Action 执行：Action 必须命中官方目录；站点页传入 zoneId 时强制注入 SiteId
  app.post('/api/cdn/accounts/:aid/esa/actions', adminAuth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    // adminAuth 只校验管理员等级；私有账户仍须按所有者可见性收口，避免管理员借 aid 使用他人凭据
    if (!(await getVisibleAccount('cdn_account', aid, req.user))) {
      return { code: -1, msg: '账户不存在' };
    }
    const b = req.body || {};
    const action = String(b.action || '').trim();
    const meta = getEsaApi(action);
    if (!meta) return { code: -1, msg: `不支持的 ESA API：${action || '(空)'}` };
    const zoneId = String(b.zoneId || '').trim();
    let params: Record<string, any> = {};
    if (b.params && typeof b.params === 'object' && !Array.isArray(b.params)) {
      params = cleanEsaApiParams(b.params);
    } else if (typeof b.params === 'string' && b.params.trim()) {
      try {
        const parsed = JSON.parse(b.params);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = cleanEsaApiParams(parsed);
        else return { code: -1, msg: 'params 必须是 JSON 对象' };
      } catch {
        return { code: -1, msg: 'params 不是合法 JSON' };
      }
    }
    const hasSiteId = meta.params.some((p) => p.name === 'SiteId');
    if (hasSiteId && zoneId) params.SiteId = zoneId;
    if (hasSiteId && !zoneId && !params.SiteId) return { code: -1, msg: '该接口需要 SiteId，请从站点页进入或手动填写 SiteId' };
    const missing = missingEsaApiParams(meta, params, hasSiteId && zoneId ? ['SiteId'] : []);
    if (missing.length) return { code: -1, msg: `缺少必填参数：${missing.join('、')}` };
    const provider: any = await cdnForZone(aid, zoneId || null);
    if (!provider || typeof provider.runEsaApi !== 'function') return { code: -1, msg: '该 CDN 类型不支持 ESA API 控制台' };
    const result = await provider.runEsaApi(action, params);
    if (result === false) return { code: -1, msg: '调用失败，' + provider.getError() };
    if (meta.op !== 'read') {
      audit(req, {
        targetType: 'cdn_zone',
        targetId: zoneId || String(params.SiteId || aid),
        targetName: String(params.SiteId || zoneId || aid),
        summary: `ESA API ${action}（${meta.title}）`,
        detail: { aid, action, zoneId: zoneId || null, paramKeys: Object.keys(params) },
      });
    }
    return { code: 0, msg: '调用成功', data: result };
  });

  // ===== 安全：IP 组 =====
  app.get('/api/cdn/accounts/:aid/security/ip-groups', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listSecurityIpGroups !== 'function') return { code: -1, msg: '该 CDN 类型不支持 IP 组' };
    const list = await provider.listSecurityIpGroups(zoneId);
    if (list === false) return { code: -1, msg: '获取 IP 组失败，' + provider.getError() };
    return { code: 0, data: list };
  });

  app.post('/api/cdn/accounts/:aid/security/ip-groups', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const content: string[] = Array.isArray(b.content) ? b.content.map((x: any) => String(x)) : [];
    if (!zoneId || !b.name) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createSecurityIpGroup !== 'function') return { code: -1, msg: '该 CDN 类型不支持 IP 组' };
    const id = await provider.createSecurityIpGroup(zoneId, String(b.name), content);
    if (id === false) return { code: -1, msg: '创建 IP 组失败，' + provider.getError() };
    return { code: 0, msg: '创建成功', data: { groupId: id } };
  });

  app.put('/api/cdn/accounts/:aid/security/ip-groups/:groupId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const groupId = Number((req.params as any).groupId);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const content: string[] = Array.isArray(b.content) ? b.content.map((x: any) => String(x)) : [];
    if (!zoneId || !groupId || !b.name) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateSecurityIpGroup !== 'function') return { code: -1, msg: '该 CDN 类型不支持 IP 组' };
    if (!(await provider.updateSecurityIpGroup(zoneId, groupId, String(b.name), content, b.mode))) {
      return { code: -1, msg: '更新 IP 组失败，' + provider.getError() };
    }
    return { code: 0, msg: '更新成功' };
  });

  app.delete('/api/cdn/accounts/:aid/security/ip-groups/:groupId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const groupId = Number((req.params as any).groupId);
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !groupId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteSecurityIpGroup !== 'function') return { code: -1, msg: '该 CDN 类型不支持 IP 组' };
    if (!(await provider.deleteSecurityIpGroup(zoneId, groupId))) return { code: -1, msg: '删除 IP 组失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/security/ip-groups/:groupId/content', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const groupId = Number((req.params as any).groupId);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId || !groupId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getSecurityIpGroupContent !== 'function') return { code: -1, msg: '该 CDN 类型不支持 IP 组' };
    const content = await provider.getSecurityIpGroupContent(zoneId, groupId);
    if (content === false) return { code: -1, msg: '获取 IP 组内容失败，' + provider.getError() };
    return { code: 0, data: content };
  });

  // ===== 安全：DDoS / WAF / 源站防护（配置型，JSON 透传）=====
  const securityConfigRoute = (
    name: string,
    getter: string,
    setter: string,
  ) => {
    app.get(`/api/cdn/accounts/:aid/security/${name}`, authAid, async (req: any) => {
      const aid = Number((req.params as any).aid);
      const zoneId = String(req.query.zoneId || '').trim();
      if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
      const provider: any = await cdnForZone(aid, zoneId);
      if (!provider || typeof provider[getter] !== 'function') return { code: -1, msg: '该 CDN 类型不支持此安全配置' };
      const r = await provider[getter](zoneId);
      if (r === false) return { code: -1, msg: '获取配置失败，' + provider.getError() };
      return { code: 0, data: r };
    });
    app.post(`/api/cdn/accounts/:aid/security/${name}`, authAid, async (req: any) => {
      const aid = Number((req.params as any).aid);
      const b = req.body || {};
      const zoneId = String(b.zoneId || '').trim();
      if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
      const provider: any = await cdnForZone(aid, zoneId);
      if (!provider || typeof provider[setter] !== 'function') return { code: -1, msg: '该 CDN 类型不支持此安全配置' };
      const config = b.config && typeof b.config === 'object' ? b.config : {};
      if (!(await provider[setter](zoneId, config))) return { code: -1, msg: '保存配置失败，' + provider.getError() };
      return { code: 0, msg: '保存成功' };
    });
  };
  securityConfigRoute('ddos', 'getDdosProtection', 'setDdosProtection');
  securityConfigRoute('waf', 'getWafInfo', 'setWafInfo');
  securityConfigRoute('origin-protection', 'getOriginProtection', 'setOriginProtection');

  // ===== 四层代理 =====
  app.get('/api/cdn/accounts/:aid/l4-proxies', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listL4Proxies !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层代理' };
    const r = await provider.listL4Proxies(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取四层代理失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/l4-proxies', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !b.name) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createL4Proxy !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层代理' };
    const id = await provider.createL4Proxy(zoneId, { name: b.name, area: b.area, ipv6: b.ipv6, staticIp: b.staticIp, accelerateMainland: b.accelerateMainland, ddosProtectionConfig: b.ddosProtectionConfig, rules: b.rules, params: b.params });
    if (id === false) return { code: -1, msg: '创建四层代理失败，' + provider.getError() };
    return { code: 0, msg: '创建成功', data: { proxyId: id } };
  });

  app.put('/api/cdn/accounts/:aid/l4-proxies/:proxyId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const proxyId = String((req.params as any).proxyId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !proxyId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateL4Proxy !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层代理' };
    if (!(await provider.updateL4Proxy(zoneId, proxyId, { ipv6: b.ipv6, staticIp: b.staticIp, rules: b.rules, params: b.params }))) {
      return { code: -1, msg: '更新四层代理失败，' + provider.getError() };
    }
    return { code: 0, msg: '更新成功' };
  });

  app.delete('/api/cdn/accounts/:aid/l4-proxies/:proxyId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const proxyId = String((req.params as any).proxyId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !proxyId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteL4Proxy !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层代理' };
    if (!(await provider.deleteL4Proxy(zoneId, proxyId))) return { code: -1, msg: '删除四层代理失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/l4-proxies/:proxyId/rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const proxyId = String((req.params as any).proxyId || '');
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId || !proxyId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listL4ProxyRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层转发规则' };
    const r = await provider.listL4ProxyRules(zoneId, proxyId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取四层转发规则失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/l4-proxies/:proxyId/rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const proxyId = String((req.params as any).proxyId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const rules = Array.isArray(b.rules) ? b.rules : [];
    if (!zoneId || !proxyId || !rules.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createL4ProxyRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层转发规则' };
    if (!(await provider.createL4ProxyRules(zoneId, proxyId, rules))) return { code: -1, msg: '创建四层转发规则失败，' + provider.getError() };
    return { code: 0, msg: '创建成功' };
  });

  app.delete('/api/cdn/accounts/:aid/l4-proxies/:proxyId/rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const proxyId = String((req.params as any).proxyId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const ruleIds: string[] = Array.isArray(b.ruleIds) ? b.ruleIds.map((x: any) => String(x)) : [];
    if (!zoneId || !proxyId || !ruleIds.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteL4ProxyRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层转发规则' };
    if (!(await provider.deleteL4ProxyRules(zoneId, proxyId, ruleIds))) return { code: -1, msg: '删除四层转发规则失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

  // ===== 任务 / 配额 / 统计增强 =====
  app.get('/api/cdn/accounts/:aid/tasks/purge', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId || null);
    if (!provider || typeof provider.listPurgeTasks !== 'function') return { code: -1, msg: '该 CDN 类型不支持刷新任务查询' };
    const r = await provider.listPurgeTasks(zoneId || null, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取刷新任务失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/tasks/prefetch', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId || null);
    if (!provider || typeof provider.listPrefetchTasks !== 'function') return { code: -1, msg: '该 CDN 类型不支持预热任务查询' };
    const r = await provider.listPrefetchTasks(zoneId || null, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取预热任务失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/quota/content', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getContentQuota !== 'function') return { code: -1, msg: '该 CDN 类型不支持配额查询' };
    const r = await provider.getContentQuota(zoneId);
    if (r === false) return { code: -1, msg: '获取配额失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/quota/purge', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const type = String(req.query.type || 'file');
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getPurgeQuota !== 'function') return { code: -1, msg: '该 CDN 类型不支持配额查询' };
    const r = await provider.getPurgeQuota(zoneId, type);
    if (r === false) return { code: -1, msg: '获取配额失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  // 缓存增强：开发模式 / 缓存标签 / 屏蔽 / 分层缓存 / 上传
  const cacheAction = (name: string, method: string, argBuilder: (zoneId: string, b: any) => any[]) => {
    app.post(`/api/cdn/accounts/:aid/cache/${name}`, authAid, async (req: any) => {
      const aid = Number((req.params as any).aid);
      const b = req.body || {};
      const zoneId = String(b.zoneId || '').trim();
      if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
      const provider: any = await cdnForZone(aid, zoneId);
      if (!provider || typeof provider[method] !== 'function') return { code: -1, msg: '该 CDN 类型不支持此操作' };
      const ok = await provider[method](...argBuilder(zoneId, b));
      if (!ok) return { code: -1, msg: '操作失败，' + provider.getError() };
      return { code: 0, msg: '操作成功', data: ok };
    });
  };
  cacheAction('development-mode', 'updateDevelopmentMode', (z, b) => [z, b.enable === true || b.enable === 'true' || b.enable === 'on']);
  cacheAction('tag', 'updateCacheTag', (z, b) => [z, b.params && typeof b.params === 'object' ? b.params : {}]);
  cacheAction('block', 'blockObject', (z, b) => [z, String(b.type || 'block'), Array.isArray(b.content) ? b.content.map((x: any) => String(x)) : [], b.maxage]);
  cacheAction('tiered', 'updateTieredCache', (z, b) => [z, String(b.mode || 'edge')]);
  cacheAction('upload-file', 'uploadFile', (z, b) => [z, String(b.url || ''), String(b.type || 'preload'), String(b.taskName || ('dnsmgr-' + Date.now()))]);

  app.get('/api/cdn/accounts/:aid/analysis/top', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneIds = String(req.query.zoneIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    const provider: any = await cdnForZone(aid, zoneIds[0] || null);
    if (!provider || typeof provider.topAnalysis !== 'function') return { code: -1, msg: '该 CDN 类型不支持统计' };
    const r = await provider.topAnalysis(zoneIds, String(req.query.startTime || ''), String(req.query.endTime || ''), String(req.query.metricName || 'l7Flow_outFlux'), Number(req.query.limit || 10));
    if (r === false) return { code: -1, msg: '获取统计失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/analysis/timing-cache', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneIds = String(req.query.zoneIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    const metricNames = String(req.query.metricNames || 'l7Cache_outFlux').split(',').map((s) => s.trim()).filter(Boolean);
    const provider: any = await cdnForZone(aid, zoneIds[0] || null);
    if (!provider || typeof provider.timingCacheData !== 'function') return { code: -1, msg: '该 CDN 类型不支持统计' };
    const r = await provider.timingCacheData(zoneIds, String(req.query.startTime || ''), String(req.query.endTime || ''), metricNames);
    if (r === false) return { code: -1, msg: '获取统计失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  // 加速域名重复检测：本地表精确匹配 + 云端精确定位（EO 走 getDomainCname）
  app.get('/api/cdn/accounts/:aid/domains/exists', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const name = String(req.query?.name || '').trim().toLowerCase();
    if (!aid || !name) return { code: -1, msg: '参数不完整' };

    // 1) 本项目已接入（跨站点，同一账户下域名唯一）
    const local: any = await queryOne(`SELECT id, name, zone_id FROM ${table('cdn_domain')} WHERE aid = ? AND name = ? LIMIT 1`, [aid, name]);
    if (local) {
      return { code: 0, data: { exists: true, source: 'local', zoneId: local.zone_id || '' } };
    }

    // 2) 云端已存在：不传 zoneId，让 provider 自行按域名定位站点，可发现同账户其他站点
    const provider: any = await cdnForZone(aid, null);
    if (provider && typeof provider.getDomainCname === 'function') {
      const cname = await provider.getDomainCname(name);
      if (cname) return { code: 0, data: { exists: true, source: 'cloud', cname } };
      const err = provider.getError?.() || '';
      if (err) return { code: -1, msg: '云端检测失败：' + err };
    }
    return { code: 0, data: { exists: false } };
  });

  // 详情（域名级配置）
  app.get('/api/cdn/domains/:id', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const cacheRules = await query(`SELECT * FROM ${table('cdn_cache_rule')} WHERE did = ? ORDER BY id ASC`, [id]);
    return { code: 0, data: { info: row, cacheRules } };
  });

  // 接入域名 + 联动 DNS + 自动同步
  app.post('/api/cdn/domains', auth, async (req: any, reply: any) => {
    const { aid, did, name, origin, origin_type, service_area, zone_id, cert_mode, cert_order_id, cert_aid, cert_use_default } = req.body || {};
    if (!aid || !name || !origin) return { code: -1, msg: '必填参数不能为空' };
    const visibleAcct = await getVisibleAccount('cdn_account', Number(aid), req.user);
    if (!visibleAcct) return reply.code(404).send({ code: -1, msg: 'CDN账户不存在' });
    const originHost = String(req.body?.origin_host || '');
    const protoRaw = String(req.body?.origin_protocol || 'follow');
    const originProtocol = ['follow', 'http', 'https'].includes(protoRaw) ? protoRaw : 'follow';
    const httpPort = Number(req.body?.http_port) > 0 ? Number(req.body.http_port) : 80;
    const httpsPort = Number(req.body?.https_port) > 0 ? Number(req.body.https_port) : 443;
    const dnsDomain = await assertDnsDomainUsable(req.user, Number(did), String(name));
    if (!dnsDomain) return reply.code(404).send({ code: -1, msg: '域名不存在或无权限' });
    const suffix = '.' + dnsDomain.name;
    if (name !== dnsDomain.name && !name.endsWith(suffix)) {
      return { code: -1, msg: '加速域名必须属于所选域名的子域名' };
    }
    if (await queryOne(`SELECT id FROM ${table('cdn_domain')} WHERE name = ?`, [name])) {
      return { code: -1, msg: '该加速域名已接入' };
    }
    const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
    if (!acct) return { code: -1, msg: 'CDN账户不存在' };
    const provider: any = getCdnProvider(acct.type, await accountConfigOf(acct));
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };
    const certMode = ['freecert', 'certapply', 'certlink'].includes(cert_mode) ? cert_mode : 'none';
    if (certMode !== 'none' && !checkLevel(req.user, 2)) {
      return reply.code(403).send({ code: -1, msg: '仅管理员可配置证书' });
    }
    if (certMode === 'freecert' && !cdnConfig[acct.type]?.freecert) return { code: -1, msg: '该 CDN 类型不支持配置平台免费证书' };
    if (certMode === 'certapply' && !cdnConfig[acct.type]?.certapply) return { code: -1, msg: '该 CDN 类型不支持联动证书申请' };
    if (certMode === 'certlink' && !cdnConfig[acct.type]?.certlink) return { code: -1, msg: '该 CDN 类型不支持与项目联动' };
    const cname = await provider.createDomain(name, origin, origin_type || 'ipaddr', service_area || 'mainland_china', zone_id || null);
    if (!cname) return { code: -1, msg: '接入加速域名失败，' + provider.getError() };

    // 应用回源协议 / 端口 / HOST（非默认值时），失败不回滚，可在详情页重试
    let originError = '';
    const needOriginUpdate = !!(originHost || originProtocol !== 'follow' || httpPort !== 80 || httpsPort !== 443);
    if (needOriginUpdate) {
      try {
        const ok = await provider.updateOrigin(name, origin, origin_type || 'ipaddr', originHost, originProtocol, httpPort, httpsPort);
        if (!ok) originError = provider.getError() || '未知错误';
      } catch (e: any) {
        originError = e?.message || String(e);
      }
    }

    const recordName = calcRecordName(name, dnsDomain.name);
    let dnsRecord: string | null = null;
    let dnsError = '';
    const dnsAcct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
    if (dnsAcct) {
      const dns = getDnsProvider(dnsAcct.type, await accountConfigOf(dnsAcct), dnsDomain.name, dnsDomain.thirdid);
      if (dns) {
        const recordId = await dns.addDomainRecord(recordName, 'CNAME', cname, undefined, 600);
        if (recordId) dnsRecord = String(recordId);
        else dnsError = dns.getError();
      } else dnsError = 'DNS模块不存在';
    } else dnsError = 'DNS账户不存在';

    const insertRes: any = await query(
      `INSERT INTO ${table('cdn_domain')} (aid, did, name, route, zone_id, origin, origin_type, origin_host, origin_protocol, http_port, https_port, service_area, cname, dns_record, status, cert_mode, addtime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, NOW())`,
      [aid, did, name, acct.type, zone_id || null, origin, origin_type || 'ipaddr', originHost, originProtocol, httpPort, httpsPort, service_area || 'mainland_china', cname, dnsRecord, certMode === 'none' ? null : certMode],
    );
    const newId = Number(insertRes?.insertId || 0);

    let msg = dnsRecord
      ? `接入成功，已自动添加 CNAME 解析记录 ${recordName} → ${cname}`
      : `接入成功，但自动添加解析失败（${dnsError}），请手动添加 CNAME ${recordName} → ${cname}`;
    if (originError) msg += `；回源配置应用失败（${originError}），可在域名详情页重试`;

    const sync = await syncFromCloud(aid, did, req.user);
    if (sync.code === 0 && sync.added > 0) msg += `；同时从云端同步了 ${sync.added} 个已有加速域名`;

    // 按接入时选择的证书配置处理：平台免费证书 / 联动证书申请 / 与项目联动
    let certResult: any = null;
    if (newId && certMode === 'freecert') {
      const r: any = (await runFreeCert([newId], false, req.user))[0];
      if (r) msg += `；免费证书：${r.message || r.status}`;
    } else if (newId && certMode === 'certapply') {
      const r: any = (await runCertLink([newId], false, req.user))[0];
      if (r) msg += `；证书申请：${r.message || r.status}`;
    } else if (newId && certMode === 'certlink') {
      const r = await applyCertLink(newId, provider, { certOrderId: cert_order_id, certAid: cert_aid, useDefault: !!cert_use_default }, req.user);
      certResult = r;
      msg += `；证书：${r.message}`;
    }

    audit(req, {
      targetType: 'cdn_domain',
      targetId: newId,
      targetName: String(name),
      summary: `接入加速域名 ${name}（${acct.type}）`,
      changes: [{ field: '加速域名', to: String(name) }],
      detail: { aid, did, name, origin, origin_type, zone_id, cert_mode },
    });
    return { code: 0, msg, data: { id: newId, cert: certResult } };
  });

  // 删除：可选同时删除云端加速域名（delete_cloud=1）、可选同时删除联动 DNS 解析记录（delete_dns=1）；
  // 先删除云端域名；成功后再吊销联动证书并清理本地/DNS。
  // 云端删除失败时不改动本地；证书吊销失败时保留本地记录便于重试。
  app.delete('/api/cdn/domains/:id', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const deleteCloud = ['1', 'true'].includes(String(req.query?.delete_cloud || '').toLowerCase());
    const deleteDns = ['1', 'true'].includes(String(req.query?.delete_dns || '').toLowerCase());
    const row = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '加速域名不存在' };

    if (deleteCloud) {
      const provider = await cdnForRow(row);
      if (!provider) return { code: -1, msg: 'CDN账户不存在，无法删除云端加速域名' };
      if (!(await provider.deleteDomain(row.name))) {
        return { code: -1, msg: `删除云端加速域名失败：${provider.getError() || '未知错误'}（本地记录未删除，可重试或改为仅删除本地）` };
      }
    }

    // 云端删除成功后再处理联动证书；避免云端删除失败时证书已经被误删。
    let linked = { orders: 0, deployTasks: 0 };
    try {
      linked = await removeCertOrdersLinkedToCdnDomain(Number(id), req.user);
    } catch (e: any) {
      return {
        code: -1,
        msg:
          (e?.message || '联动证书吊销失败') +
          (deleteCloud ? '（云端域名已删除，本地记录保留；可改用 delete_cloud=0 重试清理）' : '（未删除本地记录，可稍后重试）'),
      };
    }
    // 可选删除联动创建的解析记录；删除失败不阻断加速域名删除，仅提示手动处理
    let dnsMsg = '';
    if (deleteDns) {
      const r = await removeLinkedDnsRecord(row, req.user);
      dnsMsg = r.message;
    }
    await withTransaction(async (q) => {
      await q(`DELETE FROM ${table('cdn_cache_rule')} WHERE did = ?`, [id]);
      await q(`DELETE FROM ${table('cdn_domain')} WHERE id = ?`, [id]);
    });
    let msg = deleteCloud ? '已删除加速域名（含云端）' : '已删除本地记录（云端加速域名保留）';
    if (linked.orders) msg += `；已吊销并删除联动证书 ${linked.orders} 个、自动部署任务 ${linked.deployTasks} 个`;
    if (deleteDns) msg += `；${dnsMsg}`;
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `删除加速域名 ${row.name}`,
      detail: { deleteCloud, deleteDns },
    });
    return { code: 0, msg };
  });

  // 状态
  app.post('/api/cdn/domains/:id/status', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const { status } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    const target = status === 'offline' ? 'offline' : 'online';
    if (!(await provider.setDomainStatus(row.name, target))) return { code: -1, msg: '状态更新失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_domain')} SET status = ? WHERE id = ?`, [target, id]);
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `${target === 'offline' ? '停用' : '启用'}加速域名 ${row.name}`,
      changes: [{ field: '状态', to: target === 'offline' ? '停用' : '启用' }],
    });
    return { code: 0, msg: target === 'offline' ? '加速域名已停用' : '加速域名已启用' };
  });

  // 回源
  app.post('/api/cdn/domains/:id/origin', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const b = req.body || {};
    const origin = asText(b.origin, 255);
    const originType = asText(b.origin_type, 32) || 'ipaddr';
    const originHost = asText(b.origin_host, 255);
    const originProtocol = ['http', 'https', 'follow'].includes(String(b.origin_protocol)) ? String(b.origin_protocol) : 'follow';
    const httpPort = Math.min(65535, Math.max(1, Math.floor(Number(b.http_port)) || 80));
    const httpsPort = Math.min(65535, Math.max(1, Math.floor(Number(b.https_port)) || 443));
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    if (!origin) return { code: -1, msg: '源站不能为空' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.updateOrigin(row.name, origin, originType, originHost, originProtocol, httpPort, httpsPort))) {
      return { code: -1, msg: '回源配置更新失败，' + provider.getError() };
    }
    await query(
      `UPDATE ${table('cdn_domain')} SET origin = ?, origin_type = ?, origin_host = ?, origin_protocol = ?, http_port = ?, https_port = ? WHERE id = ?`,
      [origin, originType, originHost, originProtocol, httpPort, httpsPort, id],
    );
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `修改回源配置 ${row.name}`,
      changes: diffFields(
        {
          origin: row.origin,
          origin_type: row.origin_type,
          origin_host: row.origin_host,
          origin_protocol: row.origin_protocol,
          http_port: row.http_port,
          https_port: row.https_port,
        },
        {
          origin,
          origin_type: originType,
          origin_host: originHost,
          origin_protocol: originProtocol,
          http_port: httpPort,
          https_port: httpsPort,
        },
        {
          origin: '源站',
          origin_type: '源站类型',
          origin_host: '回源 HOST',
          origin_protocol: '回源协议',
          http_port: 'HTTP 端口',
          https_port: 'HTTPS 端口',
        },
      ),
    });
    return { code: 0, msg: '回源配置更新成功' };
  });

  // 缓存规则
  app.post('/api/cdn/domains/:id/cache', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const { rules } = req.body || {};
    const ruleList = Array.isArray(rules) ? rules : [];
    if (ruleList.length > 200) return { code: -1, msg: '缓存规则最多 200 条' };
    // 预先校验，避免厂商已接受规则后本地 INSERT 因超长/非法值回滚，造成云端与库内不一致
    const normalized: Array<{ path: string; ttl: number }> = [];
    for (const r of ruleList) {
      const path = String(r?.path ?? '').trim();
      if (!path) continue;
      if (path.length > 255) return { code: -1, msg: '缓存规则路径不能超过 255 个字符：' + path.slice(0, 50) };
      const ttl = Number(r?.ttl ?? 0);
      if (!Number.isFinite(ttl) || ttl < 0 || ttl > 31536000) return { code: -1, msg: '缓存规则 TTL 不合法' };
      normalized.push({ path, ttl });
    }
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.setCacheRules(row.name, ruleList))) return { code: -1, msg: '缓存规则更新失败，' + provider.getError() };
    await withTransaction(async (q) => {
      await q(`DELETE FROM ${table('cdn_cache_rule')} WHERE did = ?`, [id]);
      for (const r of normalized) {
        await q(`INSERT INTO ${table('cdn_cache_rule')} (did, path, ttl, addtime) VALUES (?, ?, ?, NOW())`, [id, r.path, r.ttl]);
      }
    });
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `修改缓存配置 ${row.name}（${ruleList.length} 条规则）`,
      detail: { rules: ruleList.slice(0, 20) },
    });
    return { code: 0, msg: '缓存规则更新成功' };
  });

  // HTTPS
  app.post('/api/cdn/domains/:id/https', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const { https_enabled, force_redirect } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.setHttps(row.name, !!https_enabled, !!force_redirect))) return { code: -1, msg: 'HTTPS 配置更新失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_domain')} SET https_enabled = ?, force_redirect = ? WHERE id = ?`, [https_enabled ? 1 : 0, force_redirect ? 1 : 0, id]);
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `修改 HTTPS 配置 ${row.name}`,
      changes: diffFields(
        { https_enabled: row.https_enabled, force_redirect: row.force_redirect },
        { https_enabled: https_enabled ? 1 : 0, force_redirect: force_redirect ? 1 : 0 },
        { https_enabled: 'HTTPS', force_redirect: '强制跳转' },
      ),
    });
    return { code: 0, msg: 'HTTPS 配置更新成功' };
  });

  // 免费证书 DNS 委派验证：联动域名在本系统内时尝试自动添加验证记录
  async function addVerifyRecord(row: any, rec: any, user: any): Promise<string> {
    const dnsDomain: any = await queryOne(
      `SELECT D.*, A.visibility AS account_visibility, A.owner_uid AS account_owner
         FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id
        WHERE D.id = ?`,
      [row.did],
    );
    if (!dnsDomain) return '未找到联动域名，请手动添加验证记录';
    if (dnsDomain.account_visibility === 'private' && Number(dnsDomain.account_owner) !== Number(user?.uid)) {
      return '无权限操作该域名的私有 DNS 账户，请手动添加验证记录';
    }
    const dnsAcct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
    if (!dnsAcct) return 'DNS账户不存在，请手动添加验证记录';
    const dns = getDnsProvider(dnsAcct.type, await accountConfigOf(dnsAcct), dnsDomain.name, dnsDomain.thirdid);
    if (!dns) return 'DNS模块不存在，请手动添加验证记录';
    const rel = calcRecordName(row.name, dnsDomain.name);
    const name = rel === '@' ? rec.name : `${rec.name}.${rel}`;
    const recordId = await dns.addDomainRecord(name, rec.type, rec.value, undefined, 600);
    if (recordId) return `已自动添加验证解析 ${name} ${rec.type} ${rec.value}`;
    return `自动添加验证解析失败（${dns.getError()}），请手动添加 ${name} ${rec.type} ${rec.value}`;
  }

  async function runFreeCert(ids: number[], checkOnly: boolean, user: any): Promise<any[]> {
    const results: any[] = [];
    for (const id of ids) {
      const row = await loadCdnDomain(id);
      if (!row || !(await getVisibleAccount('cdn_account', Number(row.aid), user))) {
        results.push({ id, status: 'failed', message: '加速域名不存在' });
        continue;
      }
      const name = row.name;
      const provider: any = await cdnForRow(row);
      if (!provider) {
        results.push({ id, name, status: 'failed', message: 'CDN账户不存在' });
        continue;
      }
      const fn = checkOnly ? provider.checkFreeCert : provider.applyFreeCert;
      if (typeof fn !== 'function') {
        results.push({ id, name, status: 'failed', message: '该厂商暂不支持配置平台免费证书' });
        continue;
      }
      let r: any;
      try {
        r = await fn.call(provider, row.name);
      } catch (e: any) {
        r = { status: 'failed', message: e?.message || String(e) };
      }
      let message = r?.message || '';
      if (r?.status === 'applied') {
        await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [id]);
        message = checkOnly ? '免费证书已部署' : '免费证书已申请并部署';
      } else if (r?.status === 'pending' && Array.isArray(r.records) && r.records.length) {
        const notes: string[] = [];
        for (const rec of r.records) notes.push(await addVerifyRecord(row, rec, user));
        message = (message || '需完成域名验证') + '；' + notes.join('；');
      }
      results.push({ id, name, status: r?.status || 'failed', message, records: r?.records || [] });
    }
    return results;
  }

  // 批量为加速域名申请平台免费证书（如腾讯云 EdgeOne 免费证书）
  app.post('/api/cdn/domains/freecert', adminAuth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要配置免费证书的加速域名' };
    const data = await runFreeCert(ids, false, req.user);
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'freecert');
    return { code: 0, msg: summarizeResults(data, '待验证'), data };
  });

  // 检查免费证书申请结果，通过后部署到加速域名
  app.post('/api/cdn/domains/freecert/check', adminAuth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要检查的加速域名' };
    const data = await runFreeCert(ids, true, req.user);
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'freecert');
    return { code: 0, msg: summarizeResults(data, '待验证'), data };
  });

  // ===== 联动证书申请：按站点申请一张通配符证书，签发后直传站点并启用 HTTPS =====

  async function runCertLink(ids: number[], checkOnly: boolean, user: any): Promise<any[]> {
    // 指定账户不可用时回退默认 Let's Encrypt（固定邮箱），未配置也能签发
    const configuredAid = Number(await configGet('cdn_cert_aid', '0')) || 0;
    // 配置的证书账户若属于他人私有账户，回退默认 Let's Encrypt，避免管理员借联动使用私有凭证
    const visibleConfigured = configuredAid ? await getVisibleAccount('cert_account', configuredAid, user) : null;
    const { aid, account, usingDefault } = await resolveCertAccount(visibleConfigured ? configuredAid : 0, { requireWildcard: true });
    const le = usingDefault ? "（默认 Let's Encrypt）" : '';
    const kicked = new Set<number>();
    const results: any[] = [];
    for (const id of ids) {
      const row = await loadCdnDomain(id);
      if (!row || !(await getVisibleAccount('cdn_account', Number(row.aid), user))) {
        results.push({ id, status: 'failed', message: '加速域名不存在' });
        continue;
      }
      const provider: any = await cdnForRow(row);
      if (!provider || typeof provider.getCertScope !== 'function' || typeof provider.getCertDeployPlan !== 'function') {
        results.push({ id, name: row.name, status: 'failed', message: '该厂商暂不支持联动证书申请' });
        continue;
      }
      const scope = await provider.getCertScope(row.name);
      if (!scope) {
        results.push({ id, name: row.name, status: 'failed', message: '未找到该域名对应的加速站点，请先在对应云控制台创建站点' });
        continue;
      }
      if (!account) {
        results.push({ id, name: row.name, status: 'failed', message: '无法准备证书账户（默认 Let\'s Encrypt 创建失败）' });
        continue;
      }
      const rootRow: any = await queryOne(
        `SELECT D.id, D.aid, A.visibility AS account_visibility, A.owner_uid AS account_owner
           FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id
          WHERE D.name = ?`,
        [scope.siteName],
      );
      if (!rootRow) {
        results.push({ id, name: row.name, status: 'failed', message: `根域名 ${scope.siteName} 未在本系统添加，无法自动完成 DNS 验证` });
        continue;
      }
      if (rootRow.account_visibility === 'private' && Number(rootRow.account_owner) !== Number(user?.uid)) {
        results.push({ id, name: row.name, status: 'failed', message: `根域名 ${scope.siteName} 使用他人私有 DNS 账户，无法自动完成验证` });
        continue;
      }
      const order = await ensureWildcardOrder(aid, scope.domains);
      const deploy: any = await ensureCertDeploy(provider, row, scope, Number(order.id)).catch(() => false);
      const status = Number(order.status);
      if (status !== 3) {
        // 新建/待处理订单立即在后台开始申请，无需手动点「处理」
        if (!kicked.has(Number(order.id))) {
          kicked.add(Number(order.id));
          kickOrderProcessing(Number(order.id));
        }
        let message: string;
        if (status < 0) {
          message = `证书订单处理失败：${order.error || '未知错误'}`;
        } else if (deploy) {
          message = `已提交证书申请${le}，并已创建自动部署任务，签发后会自动上传并绑定；也可稍后点击「检查并部署」立即处理`;
        } else {
          message = checkOnly ? '证书尚未签发完成，请稍后再检查' : `已提交证书申请${le}，系统将自动完成 DNS 验证与签发，签发后点击「检查并部署」完成上传`;
        }
        results.push({ id, name: row.name, status: status < 0 ? 'failed' : 'pending', message, order_id: order.id, domains: scope.domains });
        continue;
      }
      // 已签发：优先执行自动部署任务（与续签同一条链路），无计划时回退直传
      let applied = false;
      let message = '';
      if (deploy?.taskId) {
        let err = '';
        try {
          await new CertDeployService(deploy.taskId).process(true);
        } catch (e: any) {
          err = e?.message || String(e);
        }
        const task = await queryOne(`SELECT status, error FROM ${table('cert_deploy')} WHERE id = ?`, [deploy.taskId]);
        applied = Number(task?.status) === 1;
        message = applied ? '证书已部署，后续续签将自动更新' : task?.error || err || '证书部署失败';
      } else {
        message = '无法创建自动部署任务，请检查该 CDN 类型是否支持证书联动';
      }
      if (applied) {
        await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [id]);
      }
      results.push({ id, name: row.name, status: applied ? 'applied' : 'failed', message, order_id: order.id, domains: scope.domains });
    }
    return results;
  }

  // 按站点申请/复用通配符证书，已签发则直传 ESA 站点
  app.post('/api/cdn/domains/cert', adminAuth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要申请证书的加速域名' };
    const data = await runCertLink(ids, false, req.user);
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'certapply');
    return { code: 0, msg: summarizeResults(data, '待签发'), data };
  });

  // 检查通配符证书签发结果，已签发则直传 ESA 站点
  app.post('/api/cdn/domains/cert/check', adminAuth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要检查的加速域名' };
    const data = await runCertLink(ids, true, req.user);
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'certapply');
    return { code: 0, msg: summarizeResults(data, '待签发'), data };
  });

  // ===== 与项目联动：精确子域名证书选择 / 签发 / 自动部署 =====

  // 为加速域名选择已有证书或新建精确子域名证书，并创建自动部署任务
  async function applyCertLink(domainId: number, provider: any, opts: { certOrderId?: any; certAid?: any; useDefault?: boolean }, user: any): Promise<any> {
    const row = await loadCdnDomain(domainId);
    if (!row) return { status: 'failed', message: '加速域名不存在' };
    // 证书验证会写入联动 DNS 域名：私有 DNS 账户仅所有者可用，避免管理员借 CDN 域名操作他人私有域
    if (row.did && !(await canAccessDomainAccount(Number(row.did), user))) {
      return { status: 'failed', message: '无权限操作该加速域名关联的私有 DNS 账户' };
    }
    if (!provider || typeof provider.getCertScope !== 'function' || typeof provider.getCertDeployPlan !== 'function') {
      await linkLog(domainId, 0, 'order', 'fail', '该厂商不支持与项目联动');
      return { status: 'failed', message: '该厂商不支持与项目联动' };
    }
    const scope = await provider.getCertScope(row.name);
    if (!scope) {
      await linkLog(domainId, 0, 'order', 'fail', '未找到该域名的加速站点，请先在控制台创建站点');
      return { status: 'failed', message: '未找到该域名的加速站点，请先在控制台创建站点' };
    }
    const need = domainToASCII(row.name.toLowerCase());

    const orderId = Number(opts.certOrderId || 0);
    if (orderId) {
      if (!(await canAccessCertOrder(orderId, user))) return { status: 'failed', message: '所选证书不存在' };
      const order = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [orderId]);
      if (!order) return { status: 'failed', message: '所选证书不存在' };
      if (Number(order.status) !== 3 || !order.fullchain || !order.privatekey) return { status: 'failed', message: '所选证书尚未签发完成' };
      const exact = await queryOne(`SELECT id FROM ${table('cert_domain')} WHERE oid = ? AND LOWER(domain) = ?`, [orderId, need]);
      if (!exact) return { status: 'failed', message: `所选证书未精确包含 ${row.name}，不能用于该域名` };
      // 记录联动，续签后仍自动更新
      await query(`UPDATE ${table('cert_order')} SET link = ? WHERE id = ?`, [JSON.stringify({ cdnDomainId: domainId }), orderId]);
      await linkLog(domainId, orderId, 'issue', 'ok', `已选用项目内已签发证书 #${orderId}`);
      const task: any = await ensureCertDeploy(provider, row, scope, orderId).catch(() => false);
      if (!task) return { status: 'failed', message: '创建自动部署任务失败' };
      try {
        await new CertDeployService(task.taskId).process(true);
      } catch {
        // 具体错误从任务记录读取，确保不静默失败
      }
      const t = await queryOne(`SELECT status, error FROM ${table('cert_deploy')} WHERE id = ?`, [task.taskId]);
      if (Number(t?.status) === 1) {
        await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [domainId]);
        await linkLog(domainId, orderId, 'deploy', 'ok', '证书已上传并绑定到 CDN 加速域名，部署完成');
        return { status: 'applied', message: `已使用项目证书并部署到 ${row.name}`, order_id: orderId };
      }
      await linkLog(domainId, orderId, 'deploy', 'fail', '部署失败：' + (t?.error || '未知错误，可在自动部署任务中重试'));
      return { status: 'failed', message: t?.error || '证书部署失败，可在自动部署任务中重试', order_id: orderId };
    }

    // 新建精确子域名订单（不含根域/通配符/额外 SAN）
    let aid = Number(opts.certAid || 0);
    if (!aid && opts.useDefault) aid = await ensureDefaultLetsEncrypt();
    if (!aid) return { status: 'failed', message: '请选择证书提供商' };
    const account = await getVisibleAccount('cert_account', aid, user);
    if (!account || Number(account.deploy) !== 0) return { status: 'failed', message: '证书提供商不存在' };
    if (!providerReady(account.type, await accountConfigOf(account))) return { status: 'failed', message: `证书提供商「${account.name}」密钥未配置完整` };
    const order = await ensureExactOrder(aid, row.name, JSON.stringify({ cdnDomainId: domainId }));
    if (Number(order.status) === 3) {
      await linkLog(domainId, Number(order.id), 'issue', 'ok', `已复用已签发证书 #${order.id}`);
      const task: any = await ensureCertDeploy(provider, row, scope, Number(order.id)).catch(() => false);
      if (task) await new CertDeployService(task.taskId).process(true).catch(() => undefined);
      const t = task ? await queryOne(`SELECT status, error FROM ${table('cert_deploy')} WHERE id = ?`, [task.taskId]) : null;
      if (Number(t?.status) === 1) {
        // 仅在实际部署成功后置位，避免部署失败仍标记已启用
        await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [domainId]);
        await linkLog(domainId, Number(order.id), 'deploy', 'ok', '证书已上传并绑定到 CDN 加速域名，部署完成');
        return { status: 'applied', message: `已复用已签发证书并部署到 ${row.name}`, order_id: Number(order.id) };
      }
      return { status: 'failed', message: t?.error || '证书部署失败，可在自动部署任务中重试', order_id: Number(order.id) };
    }
    await linkLog(domainId, Number(order.id), 'order', 'doing', `已创建证书订单 #${order.id}，正在提交签发`);
    kickOrderProcessing(Number(order.id));
    return { status: 'pending', message: `已提交证书签发（仅包含 ${row.name}），签发后将自动部署到 CDN`, order_id: Number(order.id) };
  }

  // 与项目联动 - 证书候选：精确匹配的已签发证书 + 可用签发提供商（无则默认 Let's Encrypt）
  app.get('/api/cdn/cert/candidates', adminAuth, async (req: any) => {
    const raw = String(req.query?.name || '').trim();
    if (!raw) return { code: -1, msg: '请提供加速域名' };
    const visibleAccts = await listVisibleAccounts('cert_account', req.user);
    const visibleAids = new Set(visibleAccts.map((a: any) => Number(a.id)));
    const exact = (await findExactCertOrders(raw)).filter((o: any) => visibleAids.has(Number(o.aid)));
    const accts = visibleAccts.filter((a: any) => Number(a.deploy) === 0);
    const providers = (accts as any[])
      .filter((a) => {
        const { config, configError } = readConfigSafe(a.config);
        return !configError && providerReady(a.type, config);
      })
      .map((a) => ({ aid: Number(a.id), type: a.type, typename: certConfig[a.type]?.name || a.type, name: a.name }));
    let defaultLe: any = null;
    if (!providers.length) {
      const aid = await ensureDefaultLetsEncrypt();
      defaultLe = { aid, email: DEFAULT_LE_EMAIL, typename: certConfig['letsencrypt']?.name || "Let's Encrypt" };
    }
    return { code: 0, data: { name: raw, exact, providers, defaultLe } };
  });

  // 对已接入的加速域名执行「与项目联动」（选择已有证书或新建签发）
  app.post('/api/cdn/domains/:id/certlink', authCdnDomain, async (req: any, reply: any) => {
    if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '仅管理员可配置证书' });
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider: any = await cdnForRow(row);
    const { cert_order_id, cert_aid, cert_use_default } = req.body || {};
    const r = await applyCertLink(Number(id), provider, { certOrderId: cert_order_id, certAid: cert_aid, useDefault: !!cert_use_default }, req.user);
    if (r.status !== 'failed') await setCertMode(Number(id), 'certlink');
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `证书联动 ${row.name}：${r.message}`,
      detail: { cert_order_id, cert_aid, cert_use_default: !!cert_use_default },
    });
    return { code: r.status === 'failed' ? -1 : 0, msg: r.message, data: { ...r, domain_id: Number(id) } };
  });

  // 查找该加速域名已绑定的联动证书订单（按 link 中的 cdnDomainId 精确匹配）
  async function findLinkedOrder(did: number): Promise<any | null> {
    // 走 cdn_domain_id 生成列索引精确匹配；生成列不可用时降级为 LIKE 粗筛 + 解析
    if (isCdnDomainIdColumnAvailable()) {
      const rows = await query(`SELECT id, status, error, expiretime, link FROM ${table('cert_order')} WHERE cdn_domain_id = ? ORDER BY id DESC LIMIT 1`, [did]);
      return (rows as any[])[0] || null;
    }
    const candidates = await query(
      `SELECT id, status, error, expiretime, link FROM ${table('cert_order')} WHERE link IS NOT NULL AND link LIKE ? ORDER BY id DESC LIMIT 50`,
      ['%"cdnDomainId"%'],
    );
    for (const r of candidates as any[]) {
      try {
        if (Number(JSON.parse(r.link)?.cdnDomainId) === did) return r;
      } catch {
        /* 非法 JSON 忽略 */
      }
    }
    return null;
  }

  // 记录/切换证书管理方式：切换离开「由本项目管理」时停用其联动部署任务，切回时重新启用
  async function setCertMode(did: number, mode: string): Promise<void> {
    const normalized = ['freecert', 'certapply', 'certlink'].includes(mode) ? mode : null;
    await query(`UPDATE ${table('cdn_domain')} SET cert_mode = ? WHERE id = ?`, [normalized, did]);
    const linked = await findLinkedOrder(did);
    if (!linked) return;
    await query(`UPDATE ${table('cert_deploy')} SET active = ? WHERE oid = ?`, [normalized === 'certlink' ? 1 : 0, linked.id]);
  }

  // 显式设置证书管理方式（用于切换为「不使用证书」或已完成的切换）
  app.post('/api/cdn/domains/:id/cert_mode', authCdnDomain, async (req: any, reply: any) => {
    if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const mode = String(req.body?.mode || '');
    if (!['', 'freecert', 'certapply', 'certlink'].includes(mode)) return { code: -1, msg: '不支持的证书管理方式' };
    await setCertMode(Number(id), mode);
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `修改证书模式 ${row.name}：${mode || '不使用证书'}`,
      changes: [{ field: '证书模式', from: row.cert_mode || 'none', to: mode || 'none' }],
    });
    return { code: 0, msg: mode ? '证书管理方式已更新' : '已停用证书管理（不影响当前已部署证书）' };
  });

  // 证书管理 - 云端状态：查询该加速域名在 CDN 云端的当前证书配置，并附本项目联动摘要
  app.get('/api/cdn/domains/:id/cert_status', authCdnDomain, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const did = Number(id);
    const provider: any = await cdnForRow(row);
    let cloud: any;
    if (!provider || typeof provider.getDomainCertInfo !== 'function') {
      cloud = { supported: false, error: '该厂商暂不支持云端证书查询' };
    } else {
      try {
        const info = await provider.getDomainCertInfo(row.name);
        cloud = info
          ? { supported: true, ...info }
          : { supported: true, error: '未能获取云端证书信息（站点或域名不存在）' };
      } catch (e: any) {
        cloud = { supported: true, error: '查询云端证书失败：' + (e?.message || String(e)) };
      }
    }
    const order = await findLinkedOrder(did);
    if (order && !(await canAccessCertOrder(Number(order.id), req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书不存在' });
    }
    let linked: any = null;
    if (order) {
      const ds = await query(`SELECT id, status, active FROM ${table('cert_deploy')} WHERE oid = ? ORDER BY id DESC LIMIT 1`, [order.id]);
      linked = {
        orderId: Number(order.id),
        orderStatus: Number(order.status),
        deployId: ds[0] ? Number(ds[0].id) : null,
        deployStatus: ds[0] ? Number(ds[0].status) : null,
        deployActive: ds[0] ? Number(ds[0].active) : null,
      };
    }
    return { code: 0, data: { name: row.name, cert_mode: row.cert_mode || '', cloud, linked } };
  });

  // 与项目联动 - 实时进度日志：返回各阶段日志与当前订单/部署任务状态，供前端轮询
  app.get('/api/cdn/domains/:id/certlink/log', authCdnDomain, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const did = Number(id);
    const logs = await query(
      `SELECT node, status, message, addtime FROM ${table('cert_link_log')} WHERE did = ? ORDER BY id ASC LIMIT 200`,
      [did],
    );
    const order = await findLinkedOrder(did);
    if (order && !(await canAccessCertOrder(Number(order.id), req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书不存在' });
    }
    let domains: string[] = [];
    let deploy: any = null;
    if (order) {
      domains = (await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [order.id])).map((r: any) => r.domain);
      const ds = await query(`SELECT id, status, error, active FROM ${table('cert_deploy')} WHERE oid = ? ORDER BY id DESC LIMIT 1`, [order.id]);
      deploy = ds[0] || null;
    }
    const deployOk = deploy && Number(deploy.status) === 1;
    const done = !!order && Number(order.status) === 3 && !!deployOk;
    const failed = (!!order && Number(order.status) < 0) || (!!deploy && Number(deploy.status) < 0);
    return {
      code: 0,
      data: {
        name: row.name,
        order: order ? { id: Number(order.id), status: Number(order.status), error: order.error, expiretime: order.expiretime, domains } : null,
        deploy: deploy ? { id: Number(deploy.id), status: Number(deploy.status), error: deploy.error, active: Number(deploy.active) } : null,
        logs,
        done,
        failed,
      },
    };
  });

  // 与项目联动 - 立即推进：证书未签发则触发处理，已签发则创建并执行自动部署任务
  app.post('/api/cdn/domains/:id/certlink/run', authCdnDomain, async (req: any, reply: any) => {
    if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '仅管理员可配置证书' });
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const did = Number(id);
    const order = await findLinkedOrder(did);
    if (!order) return { code: -1, msg: '未找到该域名的联动证书订单，请重新发起「与项目联动」' };
    if (!(await canAccessCertOrder(Number(order.id), req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书不存在' });
    }
    if (Number(order.status) !== 3) {
      await linkLog(did, Number(order.id), 'order', 'doing', '手动触发：证书尚未签发，已提交立即处理');
      kickOrderProcessing(Number(order.id));
      audit(req, {
        targetType: 'cdn_domain',
        targetId: id,
        targetName: String(row.name),
        summary: `执行证书联动 ${row.name}：触发证书处理`,
      });
      return { code: 0, msg: '证书尚未签发，已触发立即处理，请稍后查看进度' };
    }
    const task: any = await ensureCertDeployForDomain(did, Number(order.id)).catch(() => false);
    if (!task) return { code: -1, msg: '创建自动部署任务失败，请查看进度日志了解原因' };
    try {
      await new CertDeployService(task.taskId).process(true);
    } catch {
      // 具体错误从任务记录读取
    }
    const t = await queryOne(`SELECT status, error FROM ${table('cert_deploy')} WHERE id = ?`, [task.taskId]);
    if (Number(t?.status) === 1) {
      await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [did]);
      audit(req, {
        targetType: 'cdn_domain',
        targetId: id,
        targetName: String(row.name),
        summary: `执行证书联动 ${row.name}：部署成功`,
      });
      return { code: 0, msg: '证书已部署到 CDN 加速域名' };
    }
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `执行证书联动 ${row.name}：部署未完成`,
    });
    return { code: -1, msg: t?.error || '部署未完成，请稍后在进度日志查看或重试' };
  });

  // 同步云端
  app.post('/api/cdn/sync', adminAuth, async (req: any, reply: any) => {
    const { aid, did } = req.body || {};
    if (!(await getVisibleAccount('cdn_account', Number(aid || 0), req.user))) {
      return reply.code(404).send({ code: -1, msg: '账户不存在' });
    }
    const r = await syncFromCloud(Number(aid || 0), Number(did || 0), req.user);
    audit(req, {
      targetType: 'account',
      targetId: Number(aid || 0) || undefined,
      summary: `同步云端加速域名（新增 ${r?.added || 0}，更新 ${r?.updated || 0}）`,
      detail: { aid, did, result: r },
    });
    return r;
  });

  // 站点全局配置保存
  app.post('/api/cdn/domains/:id/zone_setting', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const { setting } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    if (!row.zone_id) return { code: -1, msg: '该加速域名无站点信息' };
    const provider: any = await cdnForRow(row);
    if (!provider || typeof provider.getZoneSetting !== 'function' || typeof provider.updateZoneSetting !== 'function') {
      return { code: -1, msg: '该厂商不支持站点级配置' };
    }
    if (!setting || typeof setting !== 'object') return { code: -1, msg: '配置数据无效' };
    const current = await provider.getZoneSetting(row.zone_id);
    if (current === false) return { code: -1, msg: '获取当前站点配置失败，' + provider.getError() };
    const diff = zoneSettingDiff(current, setting);
    if (!Object.keys(diff).length) return { code: 0, msg: '未检测到配置变化' };
    if (!(await provider.updateZoneSetting(row.zone_id, diff))) return { code: -1, msg: '站点配置更新失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `修改站点设置 ${row.name}（${Object.keys(diff).length} 项）`,
      changes: diffFields(current, { ...current, ...diff }),
      detail: { zone_id: row.zone_id, keys: Object.keys(diff) },
    });
    return { code: 0, msg: '站点配置更新成功' };
  });

  // CDN 统计概览：每服务商一张卡片（4 个服务商总是返回）
  app.get('/api/cdn/statistics/overview', statAuth, async (req: any) => {
    try {
      const q = req.query || {};
      const start = parseStatTime(q.startTime);
      const end = parseStatTime(q.endTime);
      if (!start || !end) return { code: -1, msg: '时间参数无效，格式：2026-01-01 00:00:00' };
      const latest = Date.now() - 5 * 60 * 1000;
      if (end.getTime() > latest && start.getTime() < latest) end.setTime(latest);
      if (end.getTime() <= start.getTime()) return { code: -1, msg: '结束时间需大于开始时间' };

      const isAdmin = checkLevel(req.user, 2);
      const cacheEnabled = await isStatCacheEnabled();
      const aid = Number(q.aid || 0);
      const routeFilter = String(q.route || '').trim();
      const dataUntil = fmtStatTime(end);

      // 各服务商的接入规模：按当前用户可见账户统计，避免普通用户读到他人私有账户规模
      const routeStats = new Map<string, { accounts: number; domains: number }>();
      const visibleAccts = await listVisibleAccounts('cdn_account', req.user);
      const visibleAids = (visibleAccts as any[]).map((a) => Number(a.id)).filter((id) => id > 0);
      const acctCountRows: any[] = visibleAids.length
        ? await query(
            `SELECT type, COUNT(*) c FROM ${table('cdn_account')} WHERE id IN (${visibleAids.map(() => '?').join(',')}) GROUP BY type`,
            visibleAids,
          )
        : [];
      for (const r of acctCountRows) {
        routeStats.set(String(r.type), { accounts: Number(r.c), domains: 0 });
      }
      const domCountRows: any[] = visibleAids.length
        ? await query(
            `SELECT route, COUNT(*) c, COUNT(DISTINCT aid) a FROM ${table('cdn_domain')} WHERE aid IN (${visibleAids.map(() => '?').join(',')}) GROUP BY route`,
            visibleAids,
          )
        : [];
      for (const r of domCountRows) {
        const st = routeStats.get(String(r.route)) || { accounts: 0, domains: 0 };
        st.domains = Number(r.c);
        if (!st.accounts) st.accounts = Number(r.a);
        routeStats.set(String(r.route), st);
      }
      /** 已接入 = 至少一个加速域名（站点） */
      const isConnected = (route: string) => (routeStats.get(route)?.domains ?? 0) > 0;

      if (!isAdmin) {
        // 普通用户只读取统计缓存覆盖期内的数据，避免超长时间范围构造大量标签/查询
        if (start.getTime() < Date.now() - STAT_COVER_MS) {
          return { code: 0, data: { dataUntil, providers: [] } };
        }
        const providers: ProviderCard[] = [];
        for (const catalog of listCatalogs()) {
          if (routeFilter && catalog.route !== routeFilter) continue;
          if (!isConnected(catalog.route)) continue;
          const st = routeStats.get(catalog.route)!;
          let basics: ProviderCard['basics'] = [];
          let status: ProviderCard['status'] = 'empty';
          if (cacheEnabled) {
            const accts = await query(`SELECT id FROM ${table('cdn_account')} WHERE type = ? AND visibility = 'shared'`, [catalog.route]);
            const ids = (accts as any[]).map((a) => Number(a.id));
            const cached = ids.length
              ? await loadCachedStatistics(start, end, 'All', ids).catch(() => null)
              : null;
            if (cached?.labels?.length) {
              basics = basicsFromCache(cached);
              status = 'ok';
            }
          }
          providers.push({
            route: catalog.route,
            name: catalog.name,
            tone: catalog.tone,
            status,
            accountCount: st.accounts,
            domainCount: st.domains,
            basics,
            dataUntil,
            cached: true,
            tookMs: 0,
          });
        }
        return { code: 0, data: { dataUntil, providers } };
      }

      // 按当前用户可见账户取数：普通用户含共享 + 自己的私有账户；
      // 之前写死 visibility = 'shared'，私有账户（自建的 ESA/EO 账户）在统计页永远不出现
      if (!visibleAids.length) return { code: 0, data: { dataUntil, providers: [] } };
      const acctWhere: string[] = [`id IN (${visibleAids.map(() => '?').join(',')})`];
      const acctParams: any[] = [...visibleAids];
      if (aid) {
        acctWhere.push('id = ?');
        acctParams.push(aid);
      }
      if (routeFilter) {
        acctWhere.push('type = ?');
        acctParams.push(routeFilter);
      }
      const acctRows: any[] = await query(
        `SELECT * FROM ${table('cdn_account')} WHERE ${acctWhere.join(' AND ')}`,
        acctParams,
      );

      const domWhere: string[] = [`aid IN (${visibleAids.map(() => '?').join(',')})`];
      const domParams: any[] = [...visibleAids];
      if (aid) {
        domWhere.push('aid = ?');
        domParams.push(aid);
      }
      if (routeFilter) {
        domWhere.push('route = ?');
        domParams.push(routeFilter);
      }
      const domRows: any[] = await query(
        `SELECT * FROM ${table('cdn_domain')} WHERE ${domWhere.join(' AND ')}`,
        domParams,
      );

      // 站点级服务商（ESA / EdgeOne）的统计以「站点」为单位，不依赖本项目是否接入过域名。
      // 本地没有域名记录时回退到云端站点列表，否则只建了站点、未接域名的账户在统计页会整块消失。
      const cloudSites = new Map<number, StatisticsDomain[]>();
      for (const catalog of listCatalogs()) {
        if (!catalog.siteScoped) continue;
        for (const a of acctRows.filter((x) => x.type === catalog.route)) {
          const localCount = domRows.filter((d) => Number(d.aid) === Number(a.id)).length;
          if (localCount) continue;
          try {
            const provider: any = getCdnProvider(a.type, await accountConfigOf(a));
            if (!provider || typeof provider.getZones !== 'function') continue;
            const zones = await provider.getZones();
            if (!Array.isArray(zones)) continue;
            const list = zones
              .map((z: any) => ({
                name: String(z?.zoneName || z?.name || ''),
                route: String(a.type),
                zoneId: String(z?.zoneId || ''),
                serviceArea: z?.area,
              }))
              .filter((d: any) => d.zoneId);
            if (list.length) cloudSites.set(Number(a.id), list);
          } catch {
            // 云端不可达时保持「未接入」，不影响其他服务商
          }
        }
      }

      const inputs = listCatalogs()
        .filter(
          (catalog) =>
            isConnected(catalog.route) ||
            acctRows.some((a) => a.type === catalog.route && cloudSites.has(Number(a.id))),
        )
        .map((catalog) => {
        const accounts: OverviewAccount[] = acctRows
          .filter((a) => a.type === catalog.route)
          .map((a) => {
            const localDomains: StatisticsDomain[] = domRows
              .filter((d) => Number(d.aid) === Number(a.id) && d.route === catalog.route)
              .map((d) => ({
                name: d.name,
                route: d.route,
                zoneId: d.zone_id,
                serviceArea: d.service_area,
              }));
            const domains = localDomains.length ? localDomains : cloudSites.get(Number(a.id)) || [];
            return {
              id: Number(a.id),
              ...readConfigSafe(a.config),
              domains,
            };
          })
          .filter((a) => a.domains.length);
        return {
          route: catalog.route,
          accountCount: acctRows.filter((a) => a.type === catalog.route).length,
          accounts,
        };
      });

      const providers = await buildOverview(inputs, start, end);
      return { code: 0, data: { dataUntil, providers } };
    } catch (e: any) {
      return { code: -1, msg: '统计概览异常：' + (e?.message || e) };
    }
  });

  // CDN 统计详情：按服务商能力目录返回指标序列与 Top 表
  app.get('/api/cdn/statistics/detail', statAuth, async (req: any) => {
    try {
      const q = req.query || {};
      const route = String(q.route || '').trim();
      const catalog = getCatalog(route);
      if (!catalog) return { code: -1, msg: '未知的服务商' };
      const start = parseStatTime(q.startTime);
      const end = parseStatTime(q.endTime);
      if (!start || !end) return { code: -1, msg: '时间参数无效，格式：2026-01-01 00:00:00' };
      const latest = Date.now() - catalog.delayMinutes * 60 * 1000;
      if (end.getTime() > latest && start.getTime() < latest) end.setTime(latest);
      if (end.getTime() <= start.getTime()) return { code: -1, msg: '结束时间需大于开始时间' };

      const isAdmin = checkLevel(req.user, 2);
      const cacheEnabled = await isStatCacheEnabled();
      const domainNames = String(q.domains || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const aid = Number(q.aid || 0);
      const groups = parseGroups(q.groups, catalog.groups);
      const timeline = buildTimeline(start, end);

      const emptyDetail = (msg: string): DetailResponse => ({
        route,
        labels: timeline.labels,
        interval: timeline.interval,
        series: [],
        breakdowns: [],
        meta: {
          status: 'empty',
          dataUntil: fmtStatTime(end),
          delayMinutes: catalog.delayMinutes,
          cached: !isAdmin,
          tookMs: 0,
        },
        _errors: [msg],
      });

      if (!isAdmin) {
        if (!cacheEnabled) return { code: -1, msg: '数据统计缓存未开启，暂无法查看统计' };
        if (aid || domainNames.length || q.filters) return { code: -1, msg: '普通用户不支持筛选' };
        if (start.getTime() < Date.now() - STAT_COVER_MS) return { code: 0, data: emptyDetail('该时间范围暂未缓存，请稍后再试') };
        const accts: any[] = await query(`SELECT id FROM ${table('cdn_account')} WHERE type = ? AND visibility = 'shared'`, [route]);
        const ids = accts.map((a) => Number(a.id));
        const cached = ids.length
          ? await loadCachedStatistics(start, end, 'All', ids).catch(() => null)
          : null;
        if (!cached?.labels?.length) return { code: 0, data: emptyDetail('该时间范围暂未缓存，请稍后再试') };
        return { code: 0, data: detailFromCache(route, cached, start, end, catalog.delayMinutes) };
      }

      const filters = parseFilters(q.filters, catalog.filters);
      const top = parseTop(q.top, catalog.breakdowns.map((b) => b.key));
      const cacheKey = JSON.stringify([
        route,
        fmtStatTime(start),
        fmtStatTime(end),
        aid,
        domainNames,
        [...groups].sort(),
        filters,
        top,
      ]);
      const cachedDetail = getCachedDetail(cacheKey);
      if (cachedDetail) return { code: 0, data: cachedDetail };

      const where: string[] = ['route = ?'];
      const params: any[] = [route];
      if (aid) {
        where.push('aid = ?');
        params.push(aid);
      }
      if (domainNames.length) {
        where.push(`name IN (${domainNames.map(() => '?').join(',')})`);
        params.push(...domainNames);
      }
      const rows: any[] = await query(
        `SELECT * FROM ${table('cdn_domain')} WHERE ${where.join(' AND ')}`,
        params,
      );
      if (!rows.length) return { code: 0, data: emptyDetail('没有匹配的加速域名') };

      const accountCache = new Map<number, any>();
      const accounts = new Map<number, OverviewAccount>();
      for (const row of rows) {
        const accountId = Number(row.aid);
        if (!accountCache.has(accountId)) {
          accountCache.set(accountId, await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [accountId]));
        }
        const acct = accountCache.get(accountId);
        // 私有账户不提供统计（含管理员视图），避免跨用户读取私有凭证下的流量数据
        if (!acct || acct.visibility === 'private') continue;
        if (!accounts.has(accountId)) accounts.set(accountId, { id: accountId, ...readConfigSafe(acct.config), domains: [] });
        accounts.get(accountId)!.domains.push({
          name: row.name,
          route: row.route,
          zoneId: row.zone_id,
          serviceArea: row.service_area,
        });
      }

      const started = Date.now();
      const parts = await runPool(
        [...accounts.values()].map(
          (acct) => () =>
            acct.configError
              ? Promise.resolve({
                  series: [],
                  breakdowns: [],
                  errors: [`账户 #${acct.id} 配置无法解密，请在「CDN 账户」中重新填写凭证`],
                  requests: 0,
                })
              : fetchDetail(catalog, { config: acct.config, domains: acct.domains, timeline, groups, filters, top }).catch(
                  (e: any) => ({ series: [], breakdowns: [], errors: [String(e?.message || e)], requests: 0 }),
                ),
        ),
        4,
      );
      const series = mergeDetailSeries(parts.flatMap((p) => p.series));
      const breakdowns = mergeBreakdowns(parts.flatMap((p) => p.breakdowns));
      const errors = parts.flatMap((p) => p.errors);
      const status = series.length ? (errors.length ? 'partial' : 'ok') : errors.length ? 'error' : 'empty';
      const data: DetailResponse = {
        route,
        labels: timeline.labels,
        interval: timeline.interval,
        series,
        breakdowns,
        meta: {
          status,
          dataUntil: fmtStatTime(end),
          delayMinutes: catalog.delayMinutes,
          cached: false,
          tookMs: Date.now() - started,
        },
        ...(errors.length ? { _errors: errors.slice(0, 20) } : {}),
      };
      if (status === 'ok' || status === 'partial') setCachedDetail(cacheKey, data);
      return { code: 0, data };
    } catch (e: any) {
      return { code: -1, msg: '统计详情异常：' + (e?.message || e) };
    }
  });

  // CDN 数据统计（加速流量 / 带宽 / 请求数 / 缓存命中 / 状态码）
  app.get('/api/cdn/statistics', statAuth, async (req: any) => {
    try {
      const q = req.query || {};
      const type = ['Resource', 'Visits', 'HttpCodeStatus', 'All'].includes(String(q.type)) ? String(q.type) : 'All';
      const start = parseStatTime(q.startTime);
      const end = parseStatTime(q.endTime);
      if (!start || !end) return { code: -1, msg: '时间参数无效，格式：2026-01-01 00:00:00' };
      // 厂商统计有约 10 分钟延迟：结束时间统一回退，避免最后一个桶被截断
      const latest = Date.now() - EO_DATA_DELAY_MS;
      // 起始时间也落在延迟窗口内时（如刚过零点查「今天」）不再回退，避免区间为空
      if (end.getTime() > latest && start.getTime() < latest) end.setTime(latest);
      if (end.getTime() <= start.getTime()) return { code: -1, msg: '结束时间需大于开始时间' };

      const domainNames = String(q.domains || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const aid = Number(q.aid || 0);

      const isAdmin = checkLevel(req.user, 2);
      const cacheEnabled = await isStatCacheEnabled();
      // 普通用户仅能查看缓存覆盖期内、且不区分账号的汇总统计：
      // 严禁落入实时查询分支，否则可传任意 aid 越权读取账号/域名明细并触发上游调用
      // 统计缓存只包含共享账户；查询时显式传入共享账户 ID，避免把旧缓存/私有账户聚合进来
      const sharedAids: number[] = (
        await query(`SELECT id FROM ${table('cdn_account')} WHERE visibility = 'shared'`)
      ).map((r: any) => Number(r.id));
      if (!isAdmin) {
        if (!cacheEnabled) return { code: -1, msg: '数据统计缓存未开启，暂无法查看统计' };
        if (domainNames.length) return { code: -1, msg: '普通用户不支持按域名筛选' };
        if (start.getTime() >= Date.now() - STAT_COVER_MS) {
          try {
            const cached = await loadCachedStatistics(start, end, type, sharedAids);
            if (cached && cached.labels?.length) return { code: 0, data: cached };
          } catch {
            // 读取缓存失败按未缓存处理
          }
        }
        return { code: 0, data: { labels: [], _errors: ['该时间范围暂未缓存，请稍后再试'] } };
      }
      // 管理员：缓存命中（开启缓存且未按域名筛选、时间范围在保留期内）
      if (cacheEnabled && !domainNames.length && start.getTime() >= Date.now() - STAT_COVER_MS) {
        const cacheAids = aid ? (sharedAids.includes(aid) ? [aid] : []) : sharedAids;
        try {
          const cached = cacheAids.length ? await loadCachedStatistics(start, end, type, cacheAids) : null;
          if (cached && cached.labels?.length) return { code: 0, data: cached };
        } catch {
          // 读取缓存失败则继续走实时查询
        }
      }

      const where: string[] = [];
      const params: any[] = [];
      if (domainNames.length) {
        where.push(`name IN (${domainNames.map(() => '?').join(',')})`);
        params.push(...domainNames);
      }
      if (aid) {
        where.push('aid = ?');
        params.push(aid);
      }
      const sql = `SELECT * FROM ${table('cdn_domain')}` + (where.length ? ` WHERE ${where.join(' AND ')}` : '');
      const rows = await query(sql, params);
      if (!rows.length) return { code: 0, data: { labels: [] } };

      const accounts: Record<number, any> = {};
      const groups: Record<
        string,
        { route: string; aid: number; config: Record<string, any>; configError: boolean; domains: StatisticsDomain[] }
      > = {};
      for (const row of rows as any[]) {
        if (!hasCdnStatistics(row.route)) continue;
        if (!accounts[row.aid]) accounts[row.aid] = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [row.aid]);
        const acct = accounts[row.aid];
        // 私有账户不提供统计（含本人），避免多一条按用户聚合的链路
        if (!acct || acct.visibility === 'private') continue;
        const groupKey = `${row.route}#${row.aid}`;
        if (!groups[groupKey]) {
          groups[groupKey] = { route: row.route, aid: Number(row.aid), ...readConfigSafe(acct.config), domains: [] };
        }
        groups[groupKey].domains.push({ name: row.name, route: row.route, zoneId: row.zone_id, serviceArea: row.service_area });
      }

      let merged: any = null;
      const errors: string[] = [];
      for (const key of Object.keys(groups)) {
        const group = groups[key];
        if (group.configError) {
          errors.push(`账户 #${group.aid} 配置无法解密，请在「CDN 账户」中重新填写凭证`);
          continue;
        }
        try {
          const part = await queryByRoute(group.route, group.config, group.domains, start, end, type);
          if (!part.labels.length) continue;
          merged = merged ? mergeResult(merged, part) : part;
        } catch (e: any) {
          errors.push(`${group.route}: ${e?.message || e}`);
        }
      }
      if (!merged) return { code: 0, data: { labels: [], _errors: errors } };
      ensureSections(merged, type, merged.labels.length);
      if (errors.length) (merged as any)._errors = errors;
      return { code: 0, data: merged };
    } catch (e: any) {
      // 兜底返回具体错误，避免框架默认 500 让前端只能显示笼统的「查询失败」
      return { code: -1, msg: '统计查询异常：' + (e?.message || e) };
    }
  });

  // 按域名分组分发刷新/预热操作
  async function dispatchCacheOp(op: 'purge' | 'preheat', type: string, urls: string[], user: any) {
    const grouped = new Map<string, { route: string; provider: any; urls: string[] }>();
    const failed: { url: string; msg: string }[] = [];
    const domains = dedupe(urls.map((u) => domainFromUrl(u)).filter(Boolean));
    // 一次 IN 查询预取本次涉及的全部加速域名，避免每个 URL 都做一次点查
    const rows = domains.length
      ? await query(`SELECT * FROM ${table('cdn_domain')} WHERE name IN (${domains.map(() => '?').join(',')})`, domains)
      : [];
    const rowByName = new Map((rows as any[]).map((r) => [String(r.name), r]));
    const visibleCache = new Map<number, boolean>();

    for (const url of urls) {
      const domain = domainFromUrl(url);
      if (!domain) {
        failed.push({ url, msg: 'URL 格式错误' });
        continue;
      }
      const row: any = rowByName.get(domain);
      if (!row) {
        failed.push({ url, msg: `未找到加速域名 ${domain}` });
        continue;
      }
      const aid = Number(row.aid);
      if (!visibleCache.has(aid)) {
        visibleCache.set(aid, !!(await getVisibleAccount('cdn_account', aid, user)));
      }
      if (!visibleCache.get(aid)) {
        failed.push({ url, msg: `未找到加速域名 ${domain}` });
        continue;
      }
      const provider: any = await cdnForRow(row);
      if (!provider) {
        failed.push({ url, msg: 'CDN 账户不存在' });
        continue;
      }
      // 按「账户 + 站点(zone)」分组：同一账户下不同站点的 provider 实例（站点上下文）不同，
      // 若仅按账户分组，会把 URL 提交到首个域名所属的站点，导致跨站点误刷
      const key = `${row.route}#${row.aid}#${row.zone_id || ''}`;
      if (!grouped.has(key)) grouped.set(key, { route: row.route, provider, urls: [] });
      grouped.get(key)!.urls.push(url);
    }

    const success: { url: string; taskId: string | null }[] = [];
    const taskRows: any[][] = [];
    const addtime = new Date();
    for (const g of grouped.values()) {
      const fn = g.provider ? g.provider[op] : undefined;
      if (typeof fn !== 'function') {
        for (const u of g.urls) failed.push({ url: u, msg: '该厂商暂不支持此操作' });
        continue;
      }
      const taskId = op === 'purge' ? await g.provider[op](g.urls, type) : await g.provider[op](g.urls);
      const status = taskId === false ? 1 : 0;
      const errMsg = taskId === false ? g.provider.getError?.() || '提交失败' : null;
      const taskType = type === 'dir' ? 'dir' : op === 'preheat' ? 'preheat' : 'url';
      for (const u of g.urls) {
        if (taskId === false) failed.push({ url: u, msg: errMsg || '提交失败' });
        else success.push({ url: u, taskId: typeof taskId === 'string' ? taskId : null });
        taskRows.push([
          u,
          taskType,
          g.route,
          typeof taskId === 'string' ? taskId : null,
          status,
          errMsg,
          addtime,
          Number(user?.uid || 0),
        ]);
      }
    }
    // 批量写入任务历史，最多 100 行，减少逐条 INSERT 的数据库往返
    if (taskRows.length) {
      await query(
        `INSERT INTO ${table('cdn_cache_task')} (url, type, provider, task_id, status, msg, addtime, owner_uid) VALUES ?`,
        [taskRows],
      );
    }
    return { success, failed };
  }

  // 缓存刷新/预热单次请求的最大 URL 数，避免单请求扇出过多上游调用
const MAX_CACHE_OP_URLS = 100;

// 缓存刷新
  app.post('/api/cdn/purge', adminAuth, async (req: any) => {
    const { type, urls } = req.body || {};
    const list = dedupe(Array.isArray(urls) ? urls : []);
    if (!list.length) return { code: -1, msg: '请填写需要刷新的 URL' };
    if (list.length > MAX_CACHE_OP_URLS) return { code: -1, msg: `单次最多提交 ${MAX_CACHE_OP_URLS} 个 URL` };
    const result = await dispatchCacheOp('purge', type === 'dir' ? 'dir' : 'url', list, req.user);
    audit(req, {
      targetType: 'cdn_domain',
      summary: `刷新缓存 ${list.length} 个 URL（成功 ${result.success.length}，失败 ${result.failed.length}）`,
      detail: { type: type === 'dir' ? 'dir' : 'url', urls: list.slice(0, 50) },
    });
    return { code: 0, ...result };
  });

  // 缓存预热
  app.post('/api/cdn/preheat', adminAuth, async (req: any) => {
    const { urls } = req.body || {};
    const list = dedupe(Array.isArray(urls) ? urls : []);
    if (!list.length) return { code: -1, msg: '请填写需要预热的 URL' };
    if (list.length > MAX_CACHE_OP_URLS) return { code: -1, msg: `单次最多提交 ${MAX_CACHE_OP_URLS} 个 URL` };
    const result = await dispatchCacheOp('preheat', 'preheat', list, req.user);
    audit(req, {
      targetType: 'cdn_domain',
      summary: `预热 ${list.length} 个 URL（成功 ${result.success.length}，失败 ${result.failed.length}）`,
      detail: { urls: list.slice(0, 50) },
    });
    return { code: 0, ...result };
  });

  // 刷新/预热历史
  app.get('/api/cdn/cache-tasks', adminAuth, async () => {
    const rows = await query(`SELECT * FROM ${table('cdn_cache_task')} ORDER BY id DESC LIMIT 200`);
    return { code: 0, data: rows };
  });

  app.get('/api/cdn/cache-tasks/:id', adminAuth, async (req: any) => {
    const row = await queryOne(`SELECT * FROM ${table('cdn_cache_task')} WHERE id = ?`, [Number(req.params.id)]);
    if (!row) return { code: -1, msg: '任务记录不存在' };
    return { code: 0, data: row };
  });

  app.post('/api/cdn/cache-tasks/:id/retry', adminAuth, async (req: any) => {
    const row: any = await queryOne(`SELECT * FROM ${table('cdn_cache_task')} WHERE id = ?`, [Number(req.params.id)]);
    if (!row) return { code: -1, msg: '任务记录不存在' };
    const op = String(row.type) === 'preheat' ? 'preheat' : 'purge';
    const result = await dispatchCacheOp(op, String(row.type || (op === 'preheat' ? 'preheat' : 'url')), [String(row.url)], req.user);
    audit(req, { targetType: 'cdn_cache_task', targetId: row.id, summary: `重试 CDN ${op}：${row.url}` });
    return { code: 0, ...result };
  });

  // 访问控制 - 查询
  app.get('/api/cdn/domains/:id/access', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const def = { referer_mode: 'off', referer_list: [], ip_mode: 'off', ip_list: [], ua_list: [] };
    const provider: any = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在或凭证不可用，无法查询访问控制' };
    if (typeof provider.getAccess !== 'function') return { code: -1, msg: '该厂商暂不支持访问控制配置' };
    try {
      const cfg = await provider.getAccess(row.name);
      if (!cfg) return { code: -1, msg: '查询云端访问控制失败，请稍后重试' };
      return { code: 0, data: { ...def, ...cfg } };
    } catch (e: any) {
      return { code: -1, msg: '查询云端访问控制失败：' + (e?.message || String(e)) };
    }
  });

  // 访问控制 - 保存
  app.post('/api/cdn/domains/:id/access', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider: any = await cdnForRow(row);
    if (!provider || typeof provider.setAccess !== 'function') return { code: -1, msg: '该厂商暂不支持访问控制配置' };
    if (!(await provider.setAccess(row.name, req.body || {}))) return { code: -1, msg: '访问控制更新失败，' + (provider.getError?.() || '') };
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `修改访问控制 ${row.name}`,
      detail: req.body || {},
    });
    return { code: 0, msg: '访问控制更新成功' };
  });
}

// syncFromCloud 允许写回的列白名单，避免动态拼接列名
const CDN_SYNC_COLUMNS = new Set([
  'origin', 'origin_type', 'origin_host', 'origin_protocol',
  'http_port', 'https_port', 'cname', 'https_enabled', 'force_redirect',
]);

async function syncFromCloud(aid: number, did: number, user?: any): Promise<any> {
  const account = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
  if (!account) return { code: -1, msg: 'CDN账户不存在', added: 0, skipped: 0, updated: 0 };
  const provider: any = getCdnProvider(account.type, await accountConfigOf(account));
  if (!provider) return { code: -1, msg: 'CDN模块不存在', added: 0, skipped: 0, updated: 0 };

  const list = await provider.listDomains();
  if (list === false) return { code: -1, msg: '获取云端加速域名失败，' + provider.getError(), added: 0, skipped: 0, updated: 0 };

  const dnsRows = await query(`SELECT * FROM ${table('domain')}`);
  const dnsMap: Record<string, any> = {};
  for (const d of dnsRows) dnsMap[d.name] = d;

  // 预加载已有加速域名与 DNS 账户，避免循环内逐条 SELECT（N+1）
  const cdnByName = new Map<string, any>();
  for (const r of await query(`SELECT * FROM ${table('cdn_domain')}`)) cdnByName.set(r.name, r);
  const acctById = new Map<number, any>();
  for (const a of await query(`SELECT * FROM ${table('account')}`)) acctById.set(Number(a.id), a);

  let filterDnsName: string | null = null;
  for (const d of dnsRows as any[]) if (d.id == did) filterDnsName = d.name;

  // 普通用户同步云端域名时，DNS 写入必须逐条校验其子域名授权；
  // 管理员/未传 user 的旧调用保持原有全量同步能力。
  const perms = user && !checkLevel(user, 2) ? await getUserPermissions(Number(user.uid)) : null;

  let added = 0;
  let skipped = 0;
  let updated = 0;
  let dnsOk = 0;
  let dnsFail = 0;

  for (const item of list) {
    const name = (item.domain || '').trim();
    if (!name) continue;
    if (filterDnsName !== null) {
      const suffix = '.' + filterDnsName;
      if (name !== filterDnsName && !name.endsWith(suffix)) continue;
    }
    const exists = cdnByName.get(name);
    if (exists) {
      // 同名加速域名可能属于其他账户（不同 CDN 厂商允许同名）；只允许更新当前账户自己的记录
      if (Number(exists.aid) !== Number(aid)) {
        skipped++;
        continue;
      }
      const upd: Record<string, any> = {};
      if (!exists.origin && item.origin) {
        upd.origin = item.origin;
        upd.origin_type = item.origin_type || 'ipaddr';
        upd.origin_host = item.origin_host || '';
        upd.origin_protocol = item.origin_protocol || 'follow';
        upd.http_port = Number(item.http_port || 80);
        upd.https_port = Number(item.https_port || 443);
        if (item.cname) upd.cname = item.cname;
      }
      if ('https_enabled' in item) {
        const cloudHttps = !!item.https_enabled;
        const cloudForce = !!item.force_redirect;
        if (cloudHttps !== !!exists.https_enabled || cloudForce !== !!exists.force_redirect) {
          upd.https_enabled = cloudHttps ? 1 : 0;
          upd.force_redirect = cloudForce ? 1 : 0;
        }
      }
      if (Object.keys(upd).length) {
        const cols = Object.keys(upd).filter((k) => CDN_SYNC_COLUMNS.has(k));
        if (cols.length) {
          const fields = cols.map((k) => `${k} = ?`).join(', ');
          await query(`UPDATE ${table('cdn_domain')} SET ${fields} WHERE id = ?`, [...cols.map((k) => upd[k]), exists.id]);
          updated++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
      continue;
    }

    let belongDomain: any = null;
    let recordName = '@';
    // 按名称长度降序匹配，确保 a.example.com 优先于 example.com，结果不依赖数据库返回顺序
    const dnsNames = Object.keys(dnsMap).sort((a, b) => b.length - a.length);
    for (const dnsName of dnsNames) {
      const d = dnsMap[dnsName];
      if (name === dnsName) {
        belongDomain = d;
        recordName = '@';
        break;
      }
      const suffix = '.' + dnsName;
      if (name.endsWith(suffix)) {
        belongDomain = d;
        recordName = name.slice(0, name.length - suffix.length);
        break;
      }
    }

    // 私有 DNS 账户只允许所有者写入；管理员同步也不能把 CNAME 写进他人私有域名
    if (belongDomain) {
      const belongAcct = acctById.get(Number(belongDomain.aid));
      if (belongAcct?.visibility === 'private' && Number(belongAcct.owner_uid) !== Number(user?.uid)) {
        skipped++;
        continue;
      }
    }

    if (perms) {
      if (!belongDomain || matchPermission(perms, belongDomain.name, recordName) !== 0) {
        // 无权限或只读授权：不落 cdn_domain，也不写 DNS 记录
        skipped++;
        continue;
      }
    }

    const cname = item.cname || '';
    let dnsRecord: string | null = null;
    if (belongDomain && cname) {
      const dnsAcct = acctById.get(Number(belongDomain.aid));
      if (dnsAcct) {
        const dns = getDnsProvider(dnsAcct.type, await accountConfigOf(dnsAcct), belongDomain.name, belongDomain.thirdid);
        if (dns) {
          const recordId = await dns.addDomainRecord(recordName, 'CNAME', cname, undefined, 600);
          if (recordId) {
            dnsRecord = String(recordId);
            dnsOk++;
          } else dnsFail++;
        } else dnsFail++;
      } else dnsFail++;
    }

    const ins: any = await query(
      `INSERT INTO ${table('cdn_domain')} (aid, did, name, route, zone_id, origin, origin_type, origin_host, origin_protocol, http_port, https_port, service_area, cname, dns_record, status, https_enabled, force_redirect, addtime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        aid,
        belongDomain ? belongDomain.id : 0,
        name,
        account.type,
        item.zoneId || null,
        item.origin || '',
        item.origin_type || 'ipaddr',
        item.origin_host || '',
        item.origin_protocol || 'follow',
        Number(item.http_port || 80),
        Number(item.https_port || 443),
        areaMap[item.area || ''] || 'mainland_china',
        cname || null,
        dnsRecord,
        item.status === 'offline' ? 'offline' : 'online',
        item.https_enabled ? 1 : 0,
        item.force_redirect ? 1 : 0,
      ],
    );
    // 登记到内存映射，避免云端列表出现同名项时重复插入
    cdnByName.set(name, { id: ins.insertId, name, origin: item.origin || '', https_enabled: item.https_enabled ? 1 : 0, force_redirect: item.force_redirect ? 1 : 0 });
    added++;
  }

  let msg = `同步完成：新增 ${added} 个，已存在 ${skipped} 个`;
  if (updated > 0) msg += `，补全云端配置 ${updated} 个`;
  if (added > 0 && (dnsOk > 0 || dnsFail > 0)) {
    msg += `；自动添加 CNAME 解析成功 ${dnsOk} 个`;
    if (dnsFail > 0) msg += `，失败 ${dnsFail} 个，请手动添加解析`;
  }
  return { code: 0, msg, added, skipped, updated, dnsOk, dnsFail };
}