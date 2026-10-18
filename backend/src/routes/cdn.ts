import type { FastifyInstance } from 'fastify';
import { domainToASCII } from 'node:url';
import { query, queryOne, table, withTransaction } from '../db.js';
import { configGet } from '../config.js';
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
import { loadCached as loadCachedStatistics, isStatCacheEnabled, STAT_COVER_MS, EO_DATA_DELAY_MS } from '../lib/cdn/statistics/cacheService.js';
import { getCatalog, listCatalogs } from '../lib/cdn/statistics/catalog/index.js';
import type { DetailResponse, MetricSeries, ProviderCard, BreakdownItem } from '../lib/cdn/statistics/catalog/result.js';
import { buildOverview, type OverviewAccount } from '../lib/cdn/statistics/overview.js';
import { fetchDetail } from '../lib/cdn/statistics/detail/index.js';
import { aggregate, buildTimeline, combineSeries, mergeRateSeries, runPool } from '../lib/cdn/statistics/detail/shared.js';
import { getCachedDetail, setCachedDetail } from '../lib/cdn/statistics/detail/cache.js';
import { parseGroups, parseFilters, parseTop, BASIC_KEYS, basicUnit } from '../lib/cdn/statistics/validate.js';
import { checkLevel } from '../auth.js';
import { decryptConfig } from '../lib/secret.js';
import { ESA_RULE_KINDS, esaRuleFields, isEsaRuleKind } from '../lib/cdn/ruleSchema.js';
import { EO_CONDITION_SCHEMA } from '../lib/cdn/ruleCondition.js';

// 所有 CDN 管理接口仅管理员可用
const authenticate = (app: FastifyInstance) => ({
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

// 兼容历史明文与新版加密存储的账户配置
function safeJson(s: any): Record<string, any> {
  if (s && typeof s === 'object') return s as Record<string, any>;
  return decryptConfig(s) || {};
}

function calcRecordName(accelDomain: string, dnsDomain: string): string {
  if (accelDomain === dnsDomain) return '@';
  return accelDomain.slice(0, accelDomain.length - dnsDomain.length - 1);
}

// 删除接入 CDN 域名时联动创建的 DNS 解析记录（CNAME）。
// 优先按 cdn_domain.dns_record 记录 ID 删除；若缺失（历史数据/接入时自动添加失败）则
// 按「记录名 + CNAME + 目标值」精确匹配兜底，避免误删无关记录。
async function removeLinkedDnsRecord(row: any): Promise<{ ok: boolean; message: string }> {
  const dnsDomain: any = await queryOne(`SELECT * FROM ${table('domain')} WHERE id = ?`, [row.did]);
  if (!dnsDomain) return { ok: false, message: '未找到联动域名，解析记录需手动处理' };
  const dnsAcct: any = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
  if (!dnsAcct) return { ok: false, message: 'DNS账户不存在，解析记录需手动处理' };
  const dns: any = getDnsProvider(dnsAcct.type, safeJson(dnsAcct.config), dnsDomain.name, dnsDomain.thirdid);
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
      const p: any = getCdnProvider(acct.type, safeJson(acct.config));
      if (p) {
        if (zoneId && typeof p.setZoneId === 'function') p.setZoneId(zoneId);
        if (zoneId && typeof p.setSiteId === 'function') p.setSiteId(zoneId);
        provider = p;
      }
    }
    if (providerCache.size > 200) providerCache.clear();
    providerCache.set(key, { at: Date.now(), provider });
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
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(`SELECT * FROM ${table('cdn_domain')}${where} ORDER BY id DESC`, params);
    const typeNames = Object.fromEntries(Object.entries(cdnConfig).map(([k, v]) => [k, v.name]));
    const cdnAccounts = await query(`SELECT id, type FROM ${table('cdn_account')}`);
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
  app.get('/api/cdn/zones', auth, async (req: any) => {
    const aid = Number(req.query?.aid || 0);
    const rows = await query(
      `SELECT aid, zone_id, MIN(route) AS route,
              MIN(name) AS primary_name,
              COUNT(*) AS domain_count,
              GROUP_CONCAT(name ORDER BY id ASC SEPARATOR ',') AS domains
       FROM ${table('cdn_domain')}
       WHERE zone_id IS NOT NULL AND zone_id != ''
       GROUP BY aid, zone_id
       ORDER BY aid ASC, zone_id ASC`,
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
    const provider: any = getCdnProvider(acct.type, safeJson(acct.config));
    if (!provider || typeof provider.getZones !== 'function') {
      // 该类型不支持站点枚举时回退到本地聚合，避免页面空白
      return { code: 0, data: (rows as any[]).filter((r) => Number(r.aid) === aid).map(localItem), cloud: false };
    }
    const zones = await provider.getZones();
    if (zones === false) return { code: -1, msg: '获取站点列表失败，' + provider.getError() };
    const localByKey = new Map<string, any>();
    for (const r of rows as any[]) localByKey.set(`${r.aid}::${r.zone_id}`, r);
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
        ownershipVerified: z.ownershipVerified === true,
        cloud: true,
      };
    });
    return { code: 0, data, cloud: true };
  });

  // 站点配置读取
  app.get('/api/cdn/zones/setting', auth, async (req: any) => {
    const aid = Number(req.query.aid || 0);
    const zoneId = String(req.query.zone_id || '').trim();
    if (!aid || !zoneId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getZoneSetting !== 'function') return { code: -1, msg: '该站点不支持站点级配置' };
    const zs = await provider.getZoneSetting(zoneId);
    if (zs === false) return { code: -1, msg: '获取站点配置失败，' + provider.getError() };
    return { code: 0, data: { zoneSetting: zs } };
  });

  // 站点配置保存
  app.post('/api/cdn/zones/setting', auth, async (req: any) => {
    const { aid, zone_id, setting } = req.body || {};
    const zoneId = String(zone_id || '').trim();
    if (!aid || !zoneId) return { code: -1, msg: '参数不完整' };
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
    return { code: 0, msg: '站点配置更新成功' };
  });

  // ===== 站点生命周期（EO Zone / ESA Site）=====

  // 云上站点列表
  app.get('/api/cdn/accounts/:aid/sites', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.getZones !== 'function') return { code: -1, msg: '该 CDN 类型不支持站点管理' };
    const zones = await provider.getZones();
    if (zones === false) return { code: -1, msg: '获取站点列表失败，' + provider.getError() };
    // 尽力补齐暂停状态：provider 已在列表里返回布尔 paused 时直接沿用，避免逐站再查一次（N+1）
    if (typeof provider.getZonePaused === 'function') {
      for (const z of zones as any[]) {
        if (!z.zoneId) continue;
        if (typeof z.paused === 'boolean') continue;
        try {
          const p = await provider.getZonePaused(String(z.zoneId));
          z.paused = p === true;
        } catch {
          z.paused = false;
        }
      }
    }
    return { code: 0, data: zones };
  });

  // 套餐实例列表（ESA 创建站点需要）
  app.get('/api/cdn/accounts/:aid/plan-instances', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.listPlanInstances !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐实例查询' };
    const list = await provider.listPlanInstances();
    if (list === false) return { code: -1, msg: '获取套餐实例失败，' + provider.getError() };
    return { code: 0, data: list };
  });

  // 站点名校验 / 归属识别
  app.post('/api/cdn/accounts/:aid/sites/check', auth, async (req: any) => {
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
  app.post('/api/cdn/accounts/:aid/sites', auth, async (req: any) => {
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
    return { code: 0, msg: '站点创建成功', data: zone };
  });

  // 验证归属
  app.post('/api/cdn/accounts/:aid/sites/verify', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.verifyOwnership !== 'function') return { code: -1, msg: '该 CDN 类型不支持归属验证' };
    const r = await provider.verifyOwnership(zoneId, b.domain ? String(b.domain) : undefined);
    if (r === false) return { code: -1, msg: '验证失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  // 暂停 / 启用站点
  app.post('/api/cdn/accounts/:aid/sites/pause', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setZonePaused !== 'function') return { code: -1, msg: '该 CDN 类型不支持暂停/启用' };
    const paused = b.paused === true || b.paused === 'true' || b.paused === 1;
    if (!(await provider.setZonePaused(zoneId, paused))) return { code: -1, msg: '操作失败，' + provider.getError() };
    return { code: 0, msg: paused ? '站点已暂停' : '站点已启用' };
  });

  // 站点 NS 列表
  app.get('/api/cdn/accounts/:aid/sites/:zoneId/ns', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getSiteNs !== 'function') return { code: -1, msg: '该 CDN 类型不支持 NS 查询' };
    const ns = await provider.getSiteNs(zoneId);
    if (ns === false) return { code: -1, msg: '获取 NS 失败，' + provider.getError() };
    return { code: 0, data: ns };
  });

  // 更新站点属性（接入类型 / 覆盖范围 / 站点名独占）
  app.put('/api/cdn/accounts/:aid/sites/:zoneId', auth, async (req: any) => {
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
    if (!changed) return { code: -1, msg: '无可更新项或该 CDN 类型不支持' };
    return { code: 0, msg: '更新成功' };
  });

  // 删除站点
  app.delete('/api/cdn/accounts/:aid/sites/:zoneId', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteZone !== 'function') return { code: -1, msg: '该 CDN 类型不支持删除站点' };
    if (!(await provider.deleteZone(zoneId))) return { code: -1, msg: '删除失败，' + provider.getError() };
    return { code: 0, msg: '站点已删除' };
  });

  // ===== 源站组 =====
  app.get('/api/cdn/accounts/:aid/origin-groups', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listOriginGroups !== 'function') return { code: -1, msg: '该 CDN 类型不支持源站组' };
    const r = await provider.listOriginGroups(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取源站组失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/origin-groups', auth, async (req: any) => {
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

  app.put('/api/cdn/accounts/:aid/origin-groups/:groupId', auth, async (req: any) => {
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

  app.delete('/api/cdn/accounts/:aid/origin-groups/:groupId', auth, async (req: any) => {
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
  app.get('/api/cdn/accounts/:aid/load-balancers', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listLoadBalancers !== 'function') return { code: -1, msg: '该 CDN 类型不支持负载均衡' };
    const r = await provider.listLoadBalancers(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取负载均衡失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/load-balancers', auth, async (req: any) => {
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

  app.put('/api/cdn/accounts/:aid/load-balancers/:instanceId', auth, async (req: any) => {
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

  app.delete('/api/cdn/accounts/:aid/load-balancers/:instanceId', auth, async (req: any) => {
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
  app.get('/api/cdn/accounts/:aid/rules/setting', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.getRulesSetting !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则元数据' };
    const r = await provider.getRulesSetting();
    if (r === false) return { code: -1, msg: '获取规则元数据失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/rules', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    const list = await provider.listRules(zoneId);
    if (list === false) return { code: -1, msg: '获取规则失败，' + provider.getError() };
    return { code: 0, data: list };
  });

  app.post('/api/cdn/accounts/:aid/rules', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !b.ruleName) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createRule !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    const id = await provider.createRule(zoneId, { ruleName: b.ruleName, status: b.status, enabled: b.enabled, branches: b.branches, description: b.description });
    if (id === false) return { code: -1, msg: '创建规则失败，' + provider.getError() };
    return { code: 0, msg: '创建成功', data: { ruleId: id } };
  });

  app.put('/api/cdn/accounts/:aid/rules/:ruleId', auth, async (req: any) => {
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
    return { code: 0, msg: '更新成功' };
  });

  app.delete('/api/cdn/accounts/:aid/rules', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const ruleIds: string[] = Array.isArray(b.ruleIds) ? b.ruleIds.map((x: any) => String(x)) : [];
    if (!zoneId || !ruleIds.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则引擎' };
    if (!(await provider.deleteRules(zoneId, ruleIds))) return { code: -1, msg: '删除规则失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/cdn/accounts/:aid/rules/priority', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const ruleIds: string[] = Array.isArray(b.ruleIds) ? b.ruleIds.map((x: any) => String(x)) : [];
    if (!zoneId || !ruleIds.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setRulePriority !== 'function') return { code: -1, msg: '该 CDN 类型不支持优先级调整' };
    if (!(await provider.setRulePriority(zoneId, ruleIds))) return { code: -1, msg: '优先级调整失败，' + provider.getError() };
    return { code: 0, msg: '优先级已更新' };
  });

  // ===== 规则引擎（ESA 12 类规则配置，kind 形如 RedirectRule）=====
  app.get('/api/cdn/accounts/:aid/rule-configs', auth, async (req: any) => {
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

  app.post('/api/cdn/accounts/:aid/rule-configs', auth, async (req: any) => {
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

  app.delete('/api/cdn/accounts/:aid/rule-configs/:configId', auth, async (req: any) => {
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
  app.get('/api/cdn/accounts/:aid/rule-schema', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const acct: any = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
    if (!acct) return { code: -1, msg: '账户不存在' };
    const provider: any = getCdnProvider(acct.type, safeJson(acct.config));
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

  // ===== 安全：IP 组 =====
  app.get('/api/cdn/accounts/:aid/security/ip-groups', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listSecurityIpGroups !== 'function') return { code: -1, msg: '该 CDN 类型不支持 IP 组' };
    const list = await provider.listSecurityIpGroups(zoneId);
    if (list === false) return { code: -1, msg: '获取 IP 组失败，' + provider.getError() };
    return { code: 0, data: list };
  });

  app.post('/api/cdn/accounts/:aid/security/ip-groups', auth, async (req: any) => {
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

  app.put('/api/cdn/accounts/:aid/security/ip-groups/:groupId', auth, async (req: any) => {
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

  app.delete('/api/cdn/accounts/:aid/security/ip-groups/:groupId', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const groupId = Number((req.params as any).groupId);
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !groupId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteSecurityIpGroup !== 'function') return { code: -1, msg: '该 CDN 类型不支持 IP 组' };
    if (!(await provider.deleteSecurityIpGroup(zoneId, groupId))) return { code: -1, msg: '删除 IP 组失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/security/ip-groups/:groupId/content', auth, async (req: any) => {
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
    app.get(`/api/cdn/accounts/:aid/security/${name}`, auth, async (req: any) => {
      const aid = Number((req.params as any).aid);
      const zoneId = String(req.query.zoneId || '').trim();
      if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
      const provider: any = await cdnForZone(aid, zoneId);
      if (!provider || typeof provider[getter] !== 'function') return { code: -1, msg: '该 CDN 类型不支持此安全配置' };
      const r = await provider[getter](zoneId);
      if (r === false) return { code: -1, msg: '获取配置失败，' + provider.getError() };
      return { code: 0, data: r };
    });
    app.post(`/api/cdn/accounts/:aid/security/${name}`, auth, async (req: any) => {
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
  app.get('/api/cdn/accounts/:aid/l4-proxies', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listL4Proxies !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层代理' };
    const r = await provider.listL4Proxies(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取四层代理失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/l4-proxies', auth, async (req: any) => {
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

  app.put('/api/cdn/accounts/:aid/l4-proxies/:proxyId', auth, async (req: any) => {
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

  app.delete('/api/cdn/accounts/:aid/l4-proxies/:proxyId', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const proxyId = String((req.params as any).proxyId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !proxyId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteL4Proxy !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层代理' };
    if (!(await provider.deleteL4Proxy(zoneId, proxyId))) return { code: -1, msg: '删除四层代理失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/l4-proxies/:proxyId/rules', auth, async (req: any) => {
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

  app.post('/api/cdn/accounts/:aid/l4-proxies/:proxyId/rules', auth, async (req: any) => {
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

  app.delete('/api/cdn/accounts/:aid/l4-proxies/:proxyId/rules', auth, async (req: any) => {
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
  app.get('/api/cdn/accounts/:aid/tasks/purge', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId || null);
    if (!provider || typeof provider.listPurgeTasks !== 'function') return { code: -1, msg: '该 CDN 类型不支持刷新任务查询' };
    const r = await provider.listPurgeTasks(zoneId || null, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取刷新任务失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/tasks/prefetch', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId || null);
    if (!provider || typeof provider.listPrefetchTasks !== 'function') return { code: -1, msg: '该 CDN 类型不支持预热任务查询' };
    const r = await provider.listPrefetchTasks(zoneId || null, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取预热任务失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/quota/content', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getContentQuota !== 'function') return { code: -1, msg: '该 CDN 类型不支持配额查询' };
    const r = await provider.getContentQuota(zoneId);
    if (r === false) return { code: -1, msg: '获取配额失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/quota/purge', auth, async (req: any) => {
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
    app.post(`/api/cdn/accounts/:aid/cache/${name}`, auth, async (req: any) => {
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

  app.get('/api/cdn/accounts/:aid/analysis/top', auth, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneIds = String(req.query.zoneIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    const provider: any = await cdnForZone(aid, zoneIds[0] || null);
    if (!provider || typeof provider.topAnalysis !== 'function') return { code: -1, msg: '该 CDN 类型不支持统计' };
    const r = await provider.topAnalysis(zoneIds, String(req.query.startTime || ''), String(req.query.endTime || ''), String(req.query.metricName || 'l7Flow_outFlux'), Number(req.query.limit || 10));
    if (r === false) return { code: -1, msg: '获取统计失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/analysis/timing-cache', auth, async (req: any) => {
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
  app.get('/api/cdn/accounts/:aid/domains/exists', auth, async (req: any) => {
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
  app.get('/api/cdn/domains/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const cacheRules = await query(`SELECT * FROM ${table('cdn_cache_rule')} WHERE did = ? ORDER BY id ASC`, [id]);
    return { code: 0, data: { info: row, cacheRules } };
  });

  // 接入域名 + 联动 DNS + 自动同步
  app.post('/api/cdn/domains', auth, async (req: any) => {
    const { aid, did, name, origin, origin_type, service_area, zone_id, cert_mode, cert_order_id, cert_aid, cert_use_default } = req.body || {};
    if (!aid || !name || !origin) return { code: -1, msg: '必填参数不能为空' };
    const originHost = String(req.body?.origin_host || '');
    const protoRaw = String(req.body?.origin_protocol || 'follow');
    const originProtocol = ['follow', 'http', 'https'].includes(protoRaw) ? protoRaw : 'follow';
    const httpPort = Number(req.body?.http_port) > 0 ? Number(req.body.http_port) : 80;
    const httpsPort = Number(req.body?.https_port) > 0 ? Number(req.body.https_port) : 443;
    const dnsDomain = await queryOne(`SELECT * FROM ${table('domain')} WHERE id = ?`, [did]);
    if (!dnsDomain) return { code: -1, msg: '请选择要联动解析的域名' };
    const suffix = '.' + dnsDomain.name;
    if (name !== dnsDomain.name && !name.endsWith(suffix)) {
      return { code: -1, msg: `加速域名必须属于所选域名 ${dnsDomain.name} 的子域名` };
    }
    if (await queryOne(`SELECT id FROM ${table('cdn_domain')} WHERE name = ?`, [name])) {
      return { code: -1, msg: '该加速域名已接入' };
    }
    const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
    if (!acct) return { code: -1, msg: 'CDN账户不存在' };
    const provider: any = getCdnProvider(acct.type, safeJson(acct.config));
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };
    const certMode = ['freecert', 'certapply', 'certlink'].includes(cert_mode) ? cert_mode : 'none';
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
      const dns = getDnsProvider(dnsAcct.type, safeJson(dnsAcct.config), dnsDomain.name, dnsDomain.thirdid);
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

    const sync = await syncFromCloud(aid, did);
    if (sync.code === 0 && sync.added > 0) msg += `；同时从云端同步了 ${sync.added} 个已有加速域名`;

    // 按接入时选择的证书配置处理：平台免费证书 / 联动证书申请 / 与项目联动
    let certResult: any = null;
    if (newId && certMode === 'freecert') {
      const r: any = (await runFreeCert([newId], false))[0];
      if (r) msg += `；免费证书：${r.message || r.status}`;
    } else if (newId && certMode === 'certapply') {
      const r: any = (await runCertLink([newId], false))[0];
      if (r) msg += `；证书申请：${r.message || r.status}`;
    } else if (newId && certMode === 'certlink') {
      const r = await applyCertLink(newId, provider, { certOrderId: cert_order_id, certAid: cert_aid, useDefault: !!cert_use_default });
      certResult = r;
      msg += `；证书：${r.message}`;
    }

    return { code: 0, msg, data: { id: newId, cert: certResult } };
  });

  // 删除：可选同时删除云端加速域名（delete_cloud=1）、可选同时删除联动 DNS 解析记录（delete_dns=1）；
  // 云端删除失败时不删除本地记录，便于重试；联动证书需先吊销成功才会删除，吊销失败则整体中止
  app.delete('/api/cdn/domains/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    const deleteCloud = ['1', 'true'].includes(String(req.query?.delete_cloud || '').toLowerCase());
    const deleteDns = ['1', 'true'].includes(String(req.query?.delete_dns || '').toLowerCase());
    const row = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '加速域名不存在' };

    // 先吊销并删除联动证书；吊销失败则中止，不删除云端/本地记录
    let linked = { orders: 0, deployTasks: 0 };
    try {
      linked = await removeCertOrdersLinkedToCdnDomain(Number(id));
    } catch (e: any) {
      return { code: -1, msg: (e?.message || '联动证书吊销失败') + '（未删除加速域名，可稍后重试）' };
    }

    if (deleteCloud) {
      const provider = await cdnForRow(row);
      if (!provider) return { code: -1, msg: 'CDN账户不存在，无法删除云端加速域名' };
      if (!(await provider.deleteDomain(row.name))) {
        return { code: -1, msg: `删除云端加速域名失败：${provider.getError() || '未知错误'}（本地记录未删除，可重试或改为仅删除本地）` };
      }
    }
    // 可选删除联动创建的解析记录；删除失败不阻断加速域名删除，仅提示手动处理
    let dnsMsg = '';
    if (deleteDns) {
      const r = await removeLinkedDnsRecord(row);
      dnsMsg = r.message;
    }
    await query(`DELETE FROM ${table('cdn_cache_rule')} WHERE did = ?`, [id]);
    await query(`DELETE FROM ${table('cdn_domain')} WHERE id = ?`, [id]);
    let msg = deleteCloud ? '已删除加速域名（含云端）' : '已删除本地记录（云端加速域名保留）';
    if (linked.orders) msg += `；已吊销并删除联动证书 ${linked.orders} 个、自动部署任务 ${linked.deployTasks} 个`;
    if (deleteDns) msg += `；${dnsMsg}`;
    return { code: 0, msg };
  });

  // 状态
  app.post('/api/cdn/domains/:id/status', auth, async (req: any) => {
    const { id } = req.params as any;
    const { status } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    const target = status === 'offline' ? 'offline' : 'online';
    if (!(await provider.setDomainStatus(row.name, target))) return { code: -1, msg: '状态更新失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_domain')} SET status = ? WHERE id = ?`, [target, id]);
    return { code: 0, msg: target === 'offline' ? '加速域名已停用' : '加速域名已启用' };
  });

  // 回源
  app.post('/api/cdn/domains/:id/origin', auth, async (req: any) => {
    const { id } = req.params as any;
    const { origin, origin_type, origin_host, origin_protocol, http_port, https_port } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    if (!origin) return { code: -1, msg: '源站不能为空' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.updateOrigin(row.name, origin, origin_type || 'ipaddr', origin_host || '', origin_protocol || 'follow', Number(http_port || 80), Number(https_port || 443)))) {
      return { code: -1, msg: '回源配置更新失败，' + provider.getError() };
    }
    await query(
      `UPDATE ${table('cdn_domain')} SET origin = ?, origin_type = ?, origin_host = ?, origin_protocol = ?, http_port = ?, https_port = ? WHERE id = ?`,
      [origin, origin_type || 'ipaddr', origin_host || '', origin_protocol || 'follow', Number(http_port || 80), Number(https_port || 443), id],
    );
    return { code: 0, msg: '回源配置更新成功' };
  });

  // 缓存规则
  app.post('/api/cdn/domains/:id/cache', auth, async (req: any) => {
    const { id } = req.params as any;
    const { rules } = req.body || {};
    const ruleList = Array.isArray(rules) ? rules : [];
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.setCacheRules(row.name, ruleList))) return { code: -1, msg: '缓存规则更新失败，' + provider.getError() };
    await withTransaction(async (q) => {
      await q(`DELETE FROM ${table('cdn_cache_rule')} WHERE did = ?`, [id]);
      for (const r of ruleList) {
        const path = (r.path || '').trim();
        if (!path) continue;
        await q(`INSERT INTO ${table('cdn_cache_rule')} (did, path, ttl, addtime) VALUES (?, ?, ?, NOW())`, [id, path, Number(r.ttl || 0)]);
      }
    });
    return { code: 0, msg: '缓存规则更新成功' };
  });

  // HTTPS
  app.post('/api/cdn/domains/:id/https', auth, async (req: any) => {
    const { id } = req.params as any;
    const { https_enabled, force_redirect } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.setHttps(row.name, !!https_enabled, !!force_redirect))) return { code: -1, msg: 'HTTPS 配置更新失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_domain')} SET https_enabled = ?, force_redirect = ? WHERE id = ?`, [https_enabled ? 1 : 0, force_redirect ? 1 : 0, id]);
    return { code: 0, msg: 'HTTPS 配置更新成功' };
  });

  // 免费证书 DNS 委派验证：联动域名在本系统内时尝试自动添加验证记录
  async function addVerifyRecord(row: any, rec: any): Promise<string> {
    const dnsDomain = await queryOne(`SELECT * FROM ${table('domain')} WHERE id = ?`, [row.did]);
    if (!dnsDomain) return '未找到联动域名，请手动添加验证记录';
    const dnsAcct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
    if (!dnsAcct) return 'DNS账户不存在，请手动添加验证记录';
    const dns = getDnsProvider(dnsAcct.type, safeJson(dnsAcct.config), dnsDomain.name, dnsDomain.thirdid);
    if (!dns) return 'DNS模块不存在，请手动添加验证记录';
    const rel = calcRecordName(row.name, dnsDomain.name);
    const name = rel === '@' ? rec.name : `${rec.name}.${rel}`;
    const recordId = await dns.addDomainRecord(name, rec.type, rec.value, undefined, 600);
    if (recordId) return `已自动添加验证解析 ${name} ${rec.type} ${rec.value}`;
    return `自动添加验证解析失败（${dns.getError()}），请手动添加 ${name} ${rec.type} ${rec.value}`;
  }

  async function runFreeCert(ids: number[], checkOnly: boolean): Promise<any[]> {
    const results: any[] = [];
    for (const id of ids) {
      const row = await loadCdnDomain(id);
      if (!row) {
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
        for (const rec of r.records) notes.push(await addVerifyRecord(row, rec));
        message = (message || '需完成域名验证') + '；' + notes.join('；');
      }
      results.push({ id, name, status: r?.status || 'failed', message, records: r?.records || [] });
    }
    return results;
  }

  // 批量为加速域名申请平台免费证书（如腾讯云 EdgeOne 免费证书）
  app.post('/api/cdn/domains/freecert', auth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要配置免费证书的加速域名' };
    const data = await runFreeCert(ids, false);
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'freecert');
    return { code: 0, msg: summarizeResults(data, '待验证'), data };
  });

  // 检查免费证书申请结果，通过后部署到加速域名
  app.post('/api/cdn/domains/freecert/check', auth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要检查的加速域名' };
    const data = await runFreeCert(ids, true);
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'freecert');
    return { code: 0, msg: summarizeResults(data, '待验证'), data };
  });

  // ===== 联动证书申请：按站点申请一张通配符证书，签发后直传站点并启用 HTTPS =====

  async function runCertLink(ids: number[], checkOnly: boolean): Promise<any[]> {
    // 指定账户不可用时回退默认 Let's Encrypt（固定邮箱），未配置也能签发
    const configuredAid = Number(await configGet('cdn_cert_aid', '0')) || 0;
    const { aid, account, usingDefault } = await resolveCertAccount(configuredAid, { requireWildcard: true });
    const le = usingDefault ? "（默认 Let's Encrypt）" : '';
    const kicked = new Set<number>();
    const results: any[] = [];
    for (const id of ids) {
      const row = await loadCdnDomain(id);
      if (!row) {
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
      const rootRow = await queryOne(`SELECT id FROM ${table('domain')} WHERE name = ?`, [scope.siteName]);
      if (!rootRow) {
        results.push({ id, name: row.name, status: 'failed', message: `根域名 ${scope.siteName} 未在本系统添加，无法自动完成 DNS 验证` });
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
  app.post('/api/cdn/domains/cert', auth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要申请证书的加速域名' };
    const data = await runCertLink(ids, false);
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'certapply');
    return { code: 0, msg: summarizeResults(data, '待签发'), data };
  });

  // 检查通配符证书签发结果，已签发则直传 ESA 站点
  app.post('/api/cdn/domains/cert/check', auth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要检查的加速域名' };
    const data = await runCertLink(ids, true);
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'certapply');
    return { code: 0, msg: summarizeResults(data, '待签发'), data };
  });

  // ===== 与项目联动：精确子域名证书选择 / 签发 / 自动部署 =====

  // 为加速域名选择已有证书或新建精确子域名证书，并创建自动部署任务
  async function applyCertLink(domainId: number, provider: any, opts: { certOrderId?: any; certAid?: any; useDefault?: boolean }): Promise<any> {
    const row = await loadCdnDomain(domainId);
    if (!row) return { status: 'failed', message: '加速域名不存在' };
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
    const account = await queryOne(`SELECT * FROM ${table('cert_account')} WHERE id = ? AND deploy = 0`, [aid]);
    if (!account) return { status: 'failed', message: '证书提供商不存在' };
    if (!providerReady(account.type, safeJson(account.config))) return { status: 'failed', message: `证书提供商「${account.name}」密钥未配置完整` };
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
  app.get('/api/cdn/cert/candidates', auth, async (req: any) => {
    const raw = String(req.query?.name || '').trim();
    if (!raw) return { code: -1, msg: '请提供加速域名' };
    const exact = await findExactCertOrders(raw);
    const accts = await query(`SELECT * FROM ${table('cert_account')} WHERE deploy = 0 ORDER BY id ASC`);
    const providers = (accts as any[])
      .filter((a) => providerReady(a.type, safeJson(a.config)))
      .map((a) => ({ aid: Number(a.id), type: a.type, typename: certConfig[a.type]?.name || a.type, name: a.name }));
    let defaultLe: any = null;
    if (!providers.length) {
      const aid = await ensureDefaultLetsEncrypt();
      defaultLe = { aid, email: DEFAULT_LE_EMAIL, typename: certConfig['letsencrypt']?.name || "Let's Encrypt" };
    }
    return { code: 0, data: { name: raw, exact, providers, defaultLe } };
  });

  // 对已接入的加速域名执行「与项目联动」（选择已有证书或新建签发）
  app.post('/api/cdn/domains/:id/certlink', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider: any = await cdnForRow(row);
    const { cert_order_id, cert_aid, cert_use_default } = req.body || {};
    const r = await applyCertLink(Number(id), provider, { certOrderId: cert_order_id, certAid: cert_aid, useDefault: !!cert_use_default });
    if (r.status !== 'failed') await setCertMode(Number(id), 'certlink');
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
  app.post('/api/cdn/domains/:id/cert_mode', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const mode = String(req.body?.mode || '');
    if (!['', 'freecert', 'certapply', 'certlink'].includes(mode)) return { code: -1, msg: '不支持的证书管理方式' };
    await setCertMode(Number(id), mode);
    return { code: 0, msg: mode ? '证书管理方式已更新' : '已停用证书管理（不影响当前已部署证书）' };
  });

  // 证书管理 - 云端状态：查询该加速域名在 CDN 云端的当前证书配置，并附本项目联动摘要
  app.get('/api/cdn/domains/:id/cert_status', auth, async (req: any) => {
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
  app.get('/api/cdn/domains/:id/certlink/log', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const did = Number(id);
    const logs = await query(
      `SELECT node, status, message, addtime FROM ${table('cert_link_log')} WHERE did = ? ORDER BY id ASC LIMIT 200`,
      [did],
    );
    const order = await findLinkedOrder(did);
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
  app.post('/api/cdn/domains/:id/certlink/run', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const did = Number(id);
    const order = await findLinkedOrder(did);
    if (!order) return { code: -1, msg: '未找到该域名的联动证书订单，请重新发起「与项目联动」' };
    if (Number(order.status) !== 3) {
      await linkLog(did, Number(order.id), 'order', 'doing', '手动触发：证书尚未签发，已提交立即处理');
      kickOrderProcessing(Number(order.id));
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
      return { code: 0, msg: '证书已部署到 CDN 加速域名' };
    }
    return { code: -1, msg: t?.error || '部署未完成，请稍后在进度日志查看或重试' };
  });

  // 同步云端
  app.post('/api/cdn/sync', auth, async (req: any) => {
    const { aid, did } = req.body || {};
    return syncFromCloud(Number(aid || 0), Number(did || 0));
  });

  // 站点全局配置保存
  app.post('/api/cdn/domains/:id/zone_setting', auth, async (req: any) => {
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

      // 各服务商的接入规模：用于「只展示已接入」与卡片副标题（不读取、不解密 config）
      const routeStats = new Map<string, { accounts: number; domains: number }>();
      const acctCountRows: any[] = await query(
        `SELECT type, COUNT(*) c FROM ${table('cdn_account')} GROUP BY type`,
      );
      for (const r of acctCountRows) {
        routeStats.set(String(r.type), { accounts: Number(r.c), domains: 0 });
      }
      const domCountRows: any[] = await query(
        `SELECT route, COUNT(*) c, COUNT(DISTINCT aid) a FROM ${table('cdn_domain')} GROUP BY route`,
      );
      for (const r of domCountRows) {
        const st = routeStats.get(String(r.route)) || { accounts: 0, domains: 0 };
        st.domains = Number(r.c);
        if (!st.accounts) st.accounts = Number(r.a);
        routeStats.set(String(r.route), st);
      }
      /** 已接入 = 至少一个加速域名（站点） */
      const isConnected = (route: string) => (routeStats.get(route)?.domains ?? 0) > 0;

      if (!isAdmin) {
        const providers: ProviderCard[] = [];
        for (const catalog of listCatalogs()) {
          if (routeFilter && catalog.route !== routeFilter) continue;
          if (!isConnected(catalog.route)) continue;
          const st = routeStats.get(catalog.route)!;
          let basics: ProviderCard['basics'] = [];
          let status: ProviderCard['status'] = 'empty';
          if (cacheEnabled) {
            const accts = await query(`SELECT id FROM ${table('cdn_account')} WHERE type = ?`, [catalog.route]);
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

      const acctWhere: string[] = [];
      const acctParams: any[] = [];
      if (aid) {
        acctWhere.push('id = ?');
        acctParams.push(aid);
      }
      if (routeFilter) {
        acctWhere.push('type = ?');
        acctParams.push(routeFilter);
      }
      const acctRows: any[] = await query(
        `SELECT * FROM ${table('cdn_account')}` + (acctWhere.length ? ` WHERE ${acctWhere.join(' AND ')}` : ''),
        acctParams,
      );
      const domWhere: string[] = [];
      const domParams: any[] = [];
      if (aid) {
        domWhere.push('aid = ?');
        domParams.push(aid);
      }
      if (routeFilter) {
        domWhere.push('route = ?');
        domParams.push(routeFilter);
      }
      const domRows: any[] = await query(
        `SELECT * FROM ${table('cdn_domain')}` + (domWhere.length ? ` WHERE ${domWhere.join(' AND ')}` : ''),
        domParams,
      );

      const inputs = listCatalogs()
        .filter((catalog) => isConnected(catalog.route))
        .map((catalog) => {
        const accounts: OverviewAccount[] = acctRows
          .filter((a) => a.type === catalog.route)
          .map((a) => ({
            id: Number(a.id),
            config: safeJson(a.config),
            domains: domRows
              .filter((d) => Number(d.aid) === Number(a.id) && d.route === catalog.route)
              .map((d) => ({
                name: d.name,
                route: d.route,
                zoneId: d.zone_id,
                serviceArea: d.service_area,
              })),
          }))
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
        const accts: any[] = await query(`SELECT id FROM ${table('cdn_account')} WHERE type = ?`, [route]);
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
        if (!acct) continue;
        if (!accounts.has(accountId)) accounts.set(accountId, { id: accountId, config: safeJson(acct.config), domains: [] });
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
            fetchDetail(catalog, { config: acct.config, domains: acct.domains, timeline, groups, filters, top }).catch(
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
      if (!isAdmin) {
        if (!cacheEnabled) return { code: -1, msg: '数据统计缓存未开启，暂无法查看统计' };
        if (domainNames.length) return { code: -1, msg: '普通用户不支持按域名筛选' };
        if (start.getTime() >= Date.now() - STAT_COVER_MS) {
          try {
            const cached = await loadCachedStatistics(start, end, type, undefined);
            if (cached && cached.labels?.length) return { code: 0, data: cached };
          } catch {
            // 读取缓存失败按未缓存处理
          }
        }
        return { code: 0, data: { labels: [], _errors: ['该时间范围暂未缓存，请稍后再试'] } };
      }
      // 管理员：缓存命中（开启缓存且未按域名筛选、时间范围在保留期内）
      if (cacheEnabled && !domainNames.length && start.getTime() >= Date.now() - STAT_COVER_MS) {
        try {
          const cached = await loadCachedStatistics(start, end, type, aid ? [aid] : undefined);
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
      const groups: Record<string, { route: string; config: Record<string, any>; domains: StatisticsDomain[] }> = {};
      for (const row of rows as any[]) {
        if (!hasCdnStatistics(row.route)) continue;
        if (!accounts[row.aid]) accounts[row.aid] = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [row.aid]);
        const acct = accounts[row.aid];
        if (!acct) continue;
        const groupKey = `${row.route}#${row.aid}`;
        if (!groups[groupKey]) groups[groupKey] = { route: row.route, config: safeJson(acct.config), domains: [] };
        groups[groupKey].domains.push({ name: row.name, route: row.route, zoneId: row.zone_id, serviceArea: row.service_area });
      }

      let merged: any = null;
      const errors: string[] = [];
      for (const key of Object.keys(groups)) {
        const group = groups[key];
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
  async function dispatchCacheOp(op: 'purge' | 'preheat', type: string, urls: string[]) {
    const grouped: Record<string, { route: string; provider: any; urls: string[] }> = {};
    const failed: { url: string; msg: string }[] = [];
    for (const url of urls) {
      const domain = domainFromUrl(url);
      if (!domain) {
        failed.push({ url, msg: 'URL 格式错误' });
        continue;
      }
      const row = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE name = ?`, [domain]);
      if (!row) {
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
      if (!grouped[key]) grouped[key] = { route: row.route, provider, urls: [] };
      grouped[key].urls.push(url);
    }

    const success: { url: string; taskId: string | null }[] = [];
    for (const key of Object.keys(grouped)) {
      const g = grouped[key];
      const fn = g.provider ? g.provider[op] : undefined;
      if (typeof fn !== 'function') {
        for (const u of g.urls) failed.push({ url: u, msg: '该厂商暂不支持此操作' });
        continue;
      }
      const taskId = op === 'purge' ? await fn(g.urls, type) : await fn(g.urls);
      const status = taskId === false ? 1 : 0;
      const errMsg = taskId === false ? g.provider.getError?.() || '提交失败' : null;
      for (const u of g.urls) {
        if (taskId === false) {
          failed.push({ url: u, msg: errMsg || '提交失败' });
        } else {
          success.push({ url: u, taskId: typeof taskId === 'string' ? taskId : null });
        }
        const taskType = type === 'dir' ? 'dir' : op === 'preheat' ? 'preheat' : 'url';
        await query(
          `INSERT INTO ${table('cdn_cache_task')} (url, type, provider, task_id, status, msg, addtime) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [u, taskType, g.route, typeof taskId === 'string' ? taskId : null, status, errMsg],
        );
      }
    }
    return { success, failed };
  }

  // 缓存刷新/预热单次请求的最大 URL 数，避免单请求扇出过多上游调用
const MAX_CACHE_OP_URLS = 100;

// 缓存刷新
  app.post('/api/cdn/purge', auth, async (req: any) => {
    const { type, urls } = req.body || {};
    const list = dedupe(Array.isArray(urls) ? urls : []);
    if (!list.length) return { code: -1, msg: '请填写需要刷新的 URL' };
    if (list.length > MAX_CACHE_OP_URLS) return { code: -1, msg: `单次最多提交 ${MAX_CACHE_OP_URLS} 个 URL` };
    const result = await dispatchCacheOp('purge', type === 'dir' ? 'dir' : 'url', list);
    return { code: 0, ...result };
  });

  // 缓存预热
  app.post('/api/cdn/preheat', auth, async (req: any) => {
    const { urls } = req.body || {};
    const list = dedupe(Array.isArray(urls) ? urls : []);
    if (!list.length) return { code: -1, msg: '请填写需要预热的 URL' };
    if (list.length > MAX_CACHE_OP_URLS) return { code: -1, msg: `单次最多提交 ${MAX_CACHE_OP_URLS} 个 URL` };
    const result = await dispatchCacheOp('preheat', 'preheat', list);
    return { code: 0, ...result };
  });

  // 刷新/预热历史
  app.get('/api/cdn/cache-tasks', auth, async () => {
    const rows = await query(`SELECT * FROM ${table('cdn_cache_task')} ORDER BY id DESC LIMIT 200`);
    return { code: 0, data: rows };
  });

  // 访问控制 - 查询
  app.get('/api/cdn/domains/:id/access', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const def = { referer_mode: 'off', referer_list: [], ip_mode: 'off', ip_list: [], ua_list: [] };
    const provider: any = await cdnForRow(row);
    if (provider && typeof provider.getAccess === 'function') {
      const cfg = await provider.getAccess(row.name);
      if (cfg) return { code: 0, data: { ...def, ...cfg } };
    }
    return { code: 0, data: def };
  });

  // 访问控制 - 保存
  app.post('/api/cdn/domains/:id/access', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider: any = await cdnForRow(row);
    if (!provider || typeof provider.setAccess !== 'function') return { code: -1, msg: '该厂商暂不支持访问控制配置' };
    if (!(await provider.setAccess(row.name, req.body || {}))) return { code: -1, msg: '访问控制更新失败，' + (provider.getError?.() || '') };
    return { code: 0, msg: '访问控制更新成功' };
  });
}

// syncFromCloud 允许写回的列白名单，避免动态拼接列名
const CDN_SYNC_COLUMNS = new Set([
  'origin', 'origin_type', 'origin_host', 'origin_protocol',
  'http_port', 'https_port', 'cname', 'https_enabled', 'force_redirect',
]);

async function syncFromCloud(aid: number, did: number): Promise<any> {
  const account = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
  if (!account) return { code: -1, msg: 'CDN账户不存在', added: 0, skipped: 0, updated: 0 };
  const provider: any = getCdnProvider(account.type, safeJson(account.config));
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
    for (const dnsName of Object.keys(dnsMap)) {
      const d = dnsMap[dnsName];
      if (name === dnsName) {
        belongDomain = d;
        break;
      }
      const suffix = '.' + dnsName;
      if (name.endsWith(suffix)) {
        belongDomain = d;
        recordName = name.slice(0, name.length - suffix.length);
        break;
      }
    }

    const cname = item.cname || '';
    let dnsRecord: string | null = null;
    if (belongDomain && cname) {
      const dnsAcct = acctById.get(Number(belongDomain.aid));
      if (dnsAcct) {
        const dns = getDnsProvider(dnsAcct.type, safeJson(dnsAcct.config), belongDomain.name, belongDomain.thirdid);
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