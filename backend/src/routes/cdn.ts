import type { FastifyInstance } from 'fastify';
import { domainToASCII } from 'node:url';
import { query, queryOne, table, withTransaction } from '../db.js';
import { hitRateLimit, hitRateLimitDistributed } from '../lib/rateLimit.js';
import { withDistributedLockResult } from '../lib/scheduler/distLock.js';
import { configGet, configSet } from '../config.js';
import { getCdnProvider, cdnConfig } from '../lib/cdn/factory.js';
import { cnameEquals, normalizeHost, shortRecordName, siteCoversDomain } from '../lib/cdn/switchRoute.js';
import { getDnsProvider } from '../lib/dns/factory.js';
import { certConfig } from '../lib/cert/factory.js';
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
  assertCertOrdersRemovable,
  cdnLinkIds,
  linkOrderToCdnDomain,
} from '../lib/cdn/certLink.js';
import { CertDeployService } from '../lib/deployService.js';
import { kickOrderProcessing } from '../lib/cert/certTaskService.js';
import type { CdnProvider } from '../lib/cdn/types.js';
import { queryByRoute, hasCdnStatistics, type StatisticsDomain } from '../lib/cdn/statistics/index.js';
import { ensureSections, mergeResult } from '../lib/cdn/statistics/util.js';
import { asText } from '../lib/util.js';

// 统计区间上限（31 天）：区间越大生成的标签越多，超长区间可一次性产出数万个标签
const MAX_STAT_RANGE_MS = 31 * 86400_000;
import { loadCached as loadCachedStatistics, isStatCacheEnabled, STAT_COVER_MS, EO_DATA_DELAY_MS } from '../lib/cdn/statistics/cacheService.js';
import { getCatalog, listCatalogs } from '../lib/cdn/statistics/catalog/index.js';
import type { DetailResponse, MetricSeries, ProviderCard, BreakdownItem } from '../lib/cdn/statistics/catalog/result.js';
import { buildOverview, type OverviewAccount } from '../lib/cdn/statistics/overview.js';
import { fetchDetail } from '../lib/cdn/statistics/detail/index.js';
import { aggregate, buildTimeline, combineSeries, mergeRateSeries, runPool } from '../lib/cdn/statistics/detail/shared.js';
import { getCachedDetail, setCachedDetail } from '../lib/cdn/statistics/detail/cache.js';
import { parseGroups, parseFilters, parseTop, BASIC_KEYS, basicUnit } from '../lib/cdn/statistics/validate.js';
import { checkLevel, isRecordInScope, matchPermission } from '../auth.js';
import { ConfigDecryptError, decryptConfig, isEncryptedConfig, readAccountConfig, readConfigSafe } from '../lib/secret.js';
import { canAccessCertOrder, canAccessDomainAccount, getEffectivePermissions, getVisibleAccount, listVisibleAccounts } from '../lib/accounts/visibility.js';
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
  const perms = await getEffectivePermissions(user);
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
  const accel = normalizeHost(accelDomain);
  const base = normalizeHost(dnsDomain);
  if (!accel || !base) return '';
  if (accel === base) return '@';
  if (!accel.endsWith('.' + base)) return '';
  return accel.slice(0, -(base.length + 1));
}

// 删除接入 CDN 域名时联动创建的 DNS 解析记录（CNAME）。
// 优先按 cdn_domain.dns_record 记录 ID 删除；若缺失（历史数据/接入时自动添加失败）则
// 按「记录名 + CNAME + 目标值」精确匹配兜底，避免误删无关记录。
async function removeLinkedDnsRecord(row: any, user: any): Promise<{ ok: boolean; message: string }> {
  const dnsDomain: any = await assertDnsDomainUsable(user, Number(row.did), String(row.name));
  if (!dnsDomain) return { ok: false, message: '未找到联动域名或无权限，解析记录需手动处理' };
  const linkedName = calcRecordName(row.name, dnsDomain.name);
  if (!linkedName) return { ok: false, message: '加速域名不属于关联的 DNS 域名，解析记录需手动处理' };
  const dnsAcct: any = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
  if (!dnsAcct) return { ok: false, message: 'DNS账户不存在，解析记录需手动处理' };
  const dns: any = getDnsProvider(dnsAcct.type, await accountConfigOf(dnsAcct), dnsDomain.name, dnsDomain.thirdid);
  if (!dns) return { ok: false, message: 'DNS模块不存在，解析记录需手动处理' };

  const norm = (v: any) => String(Array.isArray(v) ? v[0] : v ?? '').trim().toLowerCase();
  let recordId = row.dns_record ? String(row.dns_record) : '';
  if (!recordId && row.cname) {
    const res = await dns.getDomainRecords(1, 500);
    const hit = (res && res.list ? res.list : []).find(
      (r: any) =>
        String(r.Type).toUpperCase() === 'CNAME' &&
        norm(r.Name) === norm(linkedName) &&
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
  if (shortName(current.Name) !== shortName(linkedName)) {
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

/** 目标线路是否支持某种证书方式 */
function cdnCertModeSupported(type: string, mode: string): boolean {
  if (!mode || mode === 'none') return true;
  const meta = cdnConfig[type] || {};
  if (mode === 'freecert') return !!meta.freecert;
  if (mode === 'certapply') return !!meta.certapply;
  if (mode === 'certlink') return !!meta.certlink;
  return false;
}

/** 拉取 DNS 域名下全部解析记录（最多 5000 条），用于按名称兜底定位联动记录 */
async function listAllDnsRecords(dns: any): Promise<any[] | false> {
  const all: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await dns.getDomainRecords(page, 500);
    if (!res) return false;
    const list = Array.isArray(res.list) ? res.list : [];
    all.push(...list);
    const total = Number(res.total || 0);
    if (list.length < 500 || (total > 0 && all.length >= total)) break;
  }
  return all;
}

interface SwitchDnsResult {
  recordId: string;
  updated: boolean;
  added: boolean;
  warning: string;
  /** 原记录是否处于暂停状态；写库失败回滚时需要恢复 */
  wasPaused: boolean;
}

/**
 * 把联动 DNS 的 CNAME 记录切到新目标值。
 *
 * 安全约束：
 * - 优先使用 cdn_domain.dns_record 记录 ID，但仍校验域名/记录名/类型；
 * - 没有记录 ID 时只接受「记录名 + 原 CNAME 值」唯一匹配，多条同名记录直接拒绝；
 * - 更新时保留线路、TTL、MX、权重、备注，只替换 Value。
 */
async function switchLinkedDnsRecord(row: any, dnsDomain: any, dns: any, newCname: string): Promise<SwitchDnsResult> {
  const expectedName = calcRecordName(String(row.name), String(dnsDomain.name));
  if (!expectedName) throw new Error('加速域名不属于关联的 DNS 域名，无法自动切换解析');
  const expectedShort = shortRecordName(expectedName, dnsDomain.name);
  const invalid = (msg: string) => {
    throw new Error(msg);
  };

  const verify = (rec: any): boolean => {
    if (!rec) return false;
    if (shortRecordName(rec.Name, dnsDomain.name) !== expectedShort) return false;
    if (rec.Domain && normalizeHost(rec.Domain) !== normalizeHost(dnsDomain.name)) return false;
    if (String(rec.Type || '').toUpperCase() !== 'CNAME') return false;
    return true;
  };

  let rec: any = null;
  let fromStoredId = false;
  let storedIdUnreadable = false;
  if (row.dns_record) {
    const info = await dns.getDomainRecordInfo(String(row.dns_record)).catch(() => false);
    if (info) {
      if (!verify(info)) invalid('联动解析记录的名称/类型/所属域名已变化，无法自动切换，请手动处理');
      rec = info;
      fromStoredId = true;
    } else {
      storedIdUnreadable = true;
    }
  }

  if (!rec) {
    const list = await listAllDnsRecords(dns);
    if (list === false) invalid('读取解析记录失败：' + (dns.getError?.() || '未知错误'));
    const sameName = (list as any[]).filter((r: any) => verify(r));
    // 兜底匹配必须同时满足记录名与旧 CNAME 值，避免误改用户后来新建的同名记录
    const hits = sameName.filter((r: any) => cnameEquals(r.Value, row.cname));
    if (hits.length > 1) invalid('存在多条同名且同值的 CNAME 记录，无法确定要切换的记录，请手动处理');
    if (!hits.length && sameName.length) {
      invalid('存在同名 CNAME 但当前值与系统记录的原线路不一致，已拒绝自动覆盖，请手动处理');
    }
    if (hits.length === 1) rec = hits[0];
    // 记录 ID 存在却查不到，且按名称也找不到：宁可中止，也不要在原记录可能仍存在时新增重复 CNAME
    if (!rec && storedIdUnreadable) invalid('原联动解析记录不存在或无法读取，请到 DNS 记录页手动确认后重试');
  }

  if (rec) {
    const recordId = String(rec.RecordId || row.dns_record || '');
    if (!recordId) invalid('解析记录缺少记录 ID，无法自动切换');
    const wasPaused = String(rec.Status ?? '') === '0';
    const enableIfPaused = async (): Promise<string> => {
      if (!wasPaused) return '';
      const enabled = await dns.setDomainRecordStatus(recordId, '1').catch(() => false);
      return enabled ? '' : '解析记录原为暂停状态，自动启用失败（' + (dns.getError?.() || '该 DNS 类型不支持记录级启用') + '），请手动启用';
    };
    if (cnameEquals(rec.Value, newCname)) {
      return { recordId, updated: false, added: false, warning: await enableIfPaused(), wasPaused };
    }
    if (!fromStoredId && !cnameEquals(rec.Value, row.cname)) {
      invalid('同名 CNAME 当前值与原线路不一致，已拒绝自动覆盖，请手动处理');
    }
    const rawTtl = rec.TTL;
    const ttl = rawTtl === null || rawTtl === undefined || rawTtl === '' || Number.isNaN(Number(rawTtl)) ? 600 : Number(rawTtl);
    const updated = await dns.updateDomainRecord(
      recordId,
      rec.Name,
      'CNAME',
      newCname,
      rec.Line ?? 'default',
      ttl,
      rec.MX ?? null,
      rec.Weight ?? null,
      rec.Remark ?? null,
    );
    if (!updated) invalid('修改解析记录失败：' + (dns.getError?.() || '未知错误'));

    // 记录被暂停时即使值已更新也不会生效；尽力恢复启用，失败明确提示
    const warning = await enableIfPaused();
    return { recordId, updated: true, added: false, warning, wasPaused };
  }

  const addedId = await dns.addDomainRecord(expectedName, 'CNAME', newCname, undefined, 600);
  if (!addedId) invalid('新增解析记录失败：' + (dns.getError?.() || '未知错误'));
  return { recordId: String(addedId), updated: true, added: true, warning: '', wasPaused: false };
}

/** 复用目标站点已有域名时，尽力读取云端回源/状态，用于同步本地展示 */
async function readCloudDomainInfo(provider: any, name: string, zoneId: string): Promise<any | null> {
  if (typeof provider.listDomains !== 'function') return null;
  const list = await provider.listDomains().catch(() => false);
  if (!Array.isArray(list)) return null;
  const target = normalizeHost(name);
  return (
    list.find(
      (d: any) =>
        normalizeHost(d?.domain) === target &&
        (!zoneId || String(d?.zoneId || '') === String(zoneId)),
    ) || null
  );
}

/** 读取目标域名当前证书/HTTPS 状态（只读，失败返回 null） */
async function readCdnCertState(provider: any, name: string): Promise<any | null> {
  if (typeof provider.getDomainCertInfo !== 'function') return null;
  const target = normalizeHost(name) || String(name || '');
  try {
    return (await provider.getDomainCertInfo(target)) || null;
  } catch {
    return null;
  }
}

/** 证书详情是否真的覆盖该加速域名（ESA 返回的是站点证书列表，不能只看 httpsEnabled） */
function certInfoCoversDomain(info: any, name: string): boolean {
  if (!info || !info.httpsEnabled) return false;
  const certs = Array.isArray(info.certs) ? info.certs : [];
  // EO 平台免费证书只返回 httpsEnabled、不返回证书列表，视为平台已覆盖；
  // 一旦有证书列表，就必须有可用的 SAN 覆盖才算数。
  if (!certs.length) return info.source === 'platform';
  const now = Date.now();
  const certDate = (v: any): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? null : t;
  };
  const usable = certs.filter((c: any) => {
    const notAfter = certDate(c?.notAfter);
    if (notAfter !== null && notAfter <= now) return false;
    const notBefore = certDate(c?.notBefore);
    if (notBefore !== null && notBefore > now) return false;
    return true;
  });
  const withSan = usable.filter((c: any) => Array.isArray(c.san) && c.san.length);
  // EO 免费证书可能只返回证书 ID、不返回 SAN；平台证书可按 httpsEnabled 信任。
  // 自定义证书的 SAN 读取失败时必须判为不可用，避免把不覆盖域名的证书当成可用。
  if (!withSan.length) return !!(usable.length && info.source === 'platform');
  const target = normalizeHost(name);
  if (!target) return false;
  return withSan.some((c: any) =>
    c.san.some((raw: any) => {
      const san = String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/\.+$/, '');
      if (!san) return false;
      if (san.startsWith('*.')) {
        const suffix = san.slice(1);
        return target.endsWith(suffix) && target.split('.').length === san.split('.').length;
      }
      return san === target;
    }),
  );
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

/** 站点 area/coverage -> 本地 service_area 值 */
function normalizeServiceArea(value: any): string {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'mainland_china') return s;
  return areaMap[s] || '';
}

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
    if (cached && Date.now() - cached.at < PROVIDER_CACHE_TTL) {
      const p: any = cached.provider;
      if (p && zoneId && typeof p.setZoneId === 'function') p.setZoneId(zoneId);
      if (p && zoneId && typeof p.setSiteId === 'function') p.setSiteId(zoneId);
      return p;
    }
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
    // 私有账户不进入共享缓存；zoneId 为空的 provider 也不缓存，
    // 因为 provider 会把 findSite/findZone 解析出的状态写进实例，跨请求复用会串站。
    if (acct?.visibility === 'shared' && zoneId) {
      if (providerCache.size > 200) providerCache.clear();
      providerCache.set(key, { at: Date.now(), provider });
    }
    return provider;
  }

  // ===== CDN 线路切换（首期：EdgeOne <-> 阿里云 ESA） =====

  function switchPartnerOf(type: string): string {
    return String(cdnConfig[type]?.switchPartner || '');
  }

  /** 目标站点是否处于不可切换状态（暂停/离线/禁用） */
  function switchZoneBlockReason(zone: any): string {
    const status = String(zone?.status || '').trim().toLowerCase();
    const paused = zone?.paused === true || String(zone?.paused ?? '').toLowerCase() === 'true';
    if (paused || ['paused', 'offline', 'disabled', 'suspended', 'inactive'].includes(status)) {
      return `目标站点 ${zone?.zoneName || zone?.zoneId || ''} 当前为暂停/离线状态，切换后流量可能无法加速，请先在目标线路启用`;
    }
    return '';
  }

  /** 切换目标账户 + 当前 DNS 写权限校验（站点校验由 resolveSwitchTarget 继续完成） */
  async function resolveSwitchAccount(req: any, row: any, aid: number) {
    const partner = switchPartnerOf(String(row?.route || ''));
    if (!partner) throw new Error('该 CDN 线路暂不支持一键切换');
    const acct: any = await getVisibleAccount('cdn_account', aid, req.user);
    if (!acct) throw new Error('目标 CDN 账户不存在或无权限');
    if (String(acct.type) !== partner) throw new Error('目标账户与目标线路不匹配');
    const dnsDomain: any = await assertDnsDomainUsable(req.user, Number(row.did), String(row.name));
    if (!dnsDomain) throw new Error('该加速域名未关联可写的 DNS 域名，无法自动切换解析');
    const accel = normalizeHost(row.name);
    const base = normalizeHost(dnsDomain.name);
    if (!accel || !base || (accel !== base && !accel.endsWith('.' + base))) {
      throw new Error('加速域名不属于关联的 DNS 域名，无法自动切换解析');
    }
    return { partner, acct, dnsDomain };
  }

  /** 继续校验目标站点确实覆盖当前加速域名，并返回已绑定 zone 的 provider */
  async function resolveSwitchTarget(req: any, row: any, aid: number, zoneId: string) {
    const base = await resolveSwitchAccount(req, row, aid);
    const provider: any = await cdnForZone(aid, zoneId || null);
    if (!provider || typeof provider.getZones !== 'function') throw new Error('目标 CDN 账户不可用');
    const zones = await provider.getZones();
    if (!Array.isArray(zones) || !zones.length) {
      const err = provider.getError?.() || '';
      throw new Error(err ? '获取目标站点失败：' + err : '目标账户下没有可用站点');
    }
    const zone = zones.find((z: any) => String(z.zoneId) === String(zoneId));
    if (!zone) throw new Error('目标站点不存在或不属于该账户');
    // ESA 的 ListSites 不返回暂停状态，需要单独查询；EO 列表通常已带 paused。
    if (typeof zone.paused !== 'boolean' && typeof provider.getZonePaused === 'function') {
      try {
        zone.paused = (await provider.getZonePaused(String(zoneId))) === true;
      } catch {
        // 状态查询失败时不让切换流程直接崩溃；后续仍会校验域名状态并给出告警
      }
    }
    const blocked = switchZoneBlockReason(zone);
    if (blocked) throw new Error(blocked);
    if (!siteCoversDomain(row.name, zone.zoneName, base.dnsDomain.name)) {
      throw new Error(`目标站点 ${zone.zoneName} 与当前域名不属于同一主域名，已拒绝切换`);
    }
    return { ...base, provider, zone };
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
    // link 可能保存多个 cdnDomainIds；生成列只覆盖主关联，必须解析完整列表。
    const lrows = await query(`SELECT link FROM ${table('cert_order')} WHERE link IS NOT NULL AND link LIKE ?`, ['%"cdnDomainId"%']);
    for (const o of lrows as any[]) {
      for (const did of cdnLinkIds(o.link)) linkedDids.add(did);
    }
    const data = rows.map((r: any) => ({
      ...r,
      routename: typeNames[r.route] || r.route,
      cert_mode:
        r.cert_mode === null || r.cert_mode === undefined
          ? linkedDids.has(Number(r.id))
            ? 'certlink'
            : ''
          : String(r.cert_mode),
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
        type: z.type || '',
        status: z.status,
        area: z.area,
        planId: z.planId || '',
        planName: z.planName || '',
        planExpireTime: z.planExpireTime || '',
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
    const passed = (r as any)?.passed ?? (r as any)?.Passed ?? (r as any)?.VerifyOwnershipResult?.Passed;
    if (passed === false) return { code: -1, msg: '归属验证未通过，请检查 DNS 解析后重试' };
    // 记录本地确认，避免云端状态延迟导致按钮再次出现。
    // 这里是「读整张 map → 改一项 → 写回」，并发验证会互相覆盖（连别的账户的条目一起抹掉），
    // 因此必须用命名锁把这段读改写串行化。
    try {
      await withDistributedLockResult('dnsmgr:cdn-zone-verified', async () => {
        const raw = (await configGet('cdn_zone_verified', '{}')) || '{}';
        const map = JSON.parse(raw);
        map[`${aid}:${zoneId}`] = new Date().toISOString();
        await configSet('cdn_zone_verified', JSON.stringify(map));
      }, 3);
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

  // 为未绑定套餐的站点绑定套餐
  app.post('/api/cdn/accounts/:aid/sites/bind-plan', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const planId = String(b.planId || '').trim();
    if (!zoneId || !planId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.bindZoneToPlan !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐绑定' };
    if (!(await provider.bindZoneToPlan(zoneId, planId))) return { code: -1, msg: '绑定套餐失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: zoneId,
      summary: `站点绑定套餐 ${zoneId} -> ${planId}`,
      detail: { aid, zoneId, planId },
    });
    return { code: 0, msg: '套餐绑定成功' };
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
    // EO ModifyZone：接入方式 / 区域 / 同名站点标识 / 自定义 NS
    if (
      typeof provider.modifyZone === 'function' &&
      (b.type !== undefined || b.area !== undefined || b.aliasZoneName !== undefined || b.vanityNs !== undefined)
    ) {
      if (!(await provider.modifyZone(zoneId, { type: b.type, area: b.area, aliasZoneName: b.aliasZoneName, vanityNs: b.vanityNs }))) {
        return { code: -1, msg: '站点属性更新失败，' + provider.getError() };
      }
      audit(req, {
        targetType: 'cdn_zone',
        targetId: zoneId,
        targetName: zoneId,
        summary: `修改站点属性 ${zoneId}`,
        detail: { aid, zoneId, type: b.type, area: b.area, aliasZoneName: b.aliasZoneName, vanityNs: b.vanityNs },
      });
      return { code: 0, msg: '更新成功' };
    }
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

  // 站点配置导出 / 导入 / 导入结果
  app.get('/api/cdn/accounts/:aid/sites/:zoneId/config/export', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const types = String(req.query.types || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.exportZoneConfig !== 'function') return { code: -1, msg: '该 CDN 类型不支持配置导出' };
    const content = await provider.exportZoneConfig(zoneId, types);
    if (content === false) return { code: -1, msg: '导出配置失败，' + provider.getError() };
    return { code: 0, data: { content, types } };
  });

  app.post('/api/cdn/accounts/:aid/sites/:zoneId/config/import', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const content = String((req.body || {}).content || '');
    if (!zoneId || !content.trim()) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.importZoneConfig !== 'function') return { code: -1, msg: '该 CDN 类型不支持配置导入' };
    const taskId = await provider.importZoneConfig(zoneId, content);
    if (taskId === false) return { code: -1, msg: '导入配置失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: zoneId,
      summary: `导入站点配置 ${zoneId}`,
      detail: { aid, zoneId, taskId, contentLength: content.length },
    });
    return { code: 0, msg: '导入任务已提交', data: { taskId } };
  });

  app.get('/api/cdn/accounts/:aid/sites/:zoneId/config/import/:taskId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const taskId = String((req.params as any).taskId || '').trim();
    if (!zoneId || !taskId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getZoneConfigImportResult !== 'function') return { code: -1, msg: '该 CDN 类型不支持导入结果查询' };
    const data = await provider.getZoneConfigImportResult(zoneId, taskId);
    if (data === false) return { code: -1, msg: '获取导入结果失败，' + provider.getError() };
    return { code: 0, data };
  });

  // 站点级自定义变量
  app.get('/api/cdn/accounts/:aid/sites/:zoneId/custom-variables', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getZoneCustomVariables !== 'function') return { code: -1, msg: '该 CDN 类型不支持站点自定义变量' };
    const data = await provider.getZoneCustomVariables(zoneId);
    if (data === false) return { code: -1, msg: '获取自定义变量失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/sites/:zoneId/custom-variables', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const b = req.body || {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setZoneCustomVariables !== 'function') return { code: -1, msg: '该 CDN 类型不支持站点自定义变量' };
    if (!(await provider.setZoneCustomVariables(zoneId, {
      CustomVariables: Array.isArray(b.CustomVariables) ? b.CustomVariables : [],
      CustomVariableOperations: Array.isArray(b.CustomVariableOperations) ? b.CustomVariableOperations : [],
    }))) {
      return { code: -1, msg: '保存自定义变量失败，' + provider.getError() };
    }
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: zoneId,
      summary: `修改站点自定义变量 ${zoneId}`,
      detail: { aid, zoneId, variables: Array.isArray(b.CustomVariables) ? b.CustomVariables.length : 0 },
    });
    return { code: 0, msg: '保存成功' };
  });

  // ===== 边缘函数 =====
  app.get('/api/cdn/accounts/:aid/functions', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listFunctions !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘函数' };
    const data = await provider.listFunctions(zoneId);
    if (data === false) return { code: -1, msg: '获取边缘函数失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/functions', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createFunction !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘函数' };
    const functionId = await provider.createFunction(zoneId, params);
    if (functionId === false) return { code: -1, msg: '创建边缘函数失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: functionId, summary: `创建边缘函数 ${params.Name || functionId}（${zoneId}）`, detail: { aid, zoneId, functionId } });
    return { code: 0, msg: '创建成功', data: { functionId } };
  });

  app.put('/api/cdn/accounts/:aid/functions/:functionId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !functionId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateFunction !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘函数' };
    if (!(await provider.updateFunction(zoneId, functionId, params))) return { code: -1, msg: '修改边缘函数失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: functionId, summary: `修改边缘函数 ${functionId}（${zoneId}）`, detail: { aid, zoneId, functionId } });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/functions/:functionId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !functionId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteFunction !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘函数' };
    if (!(await provider.deleteFunction(zoneId, functionId))) return { code: -1, msg: '删除边缘函数失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: functionId, summary: `删除边缘函数 ${functionId}（${zoneId}）`, detail: { aid, zoneId, functionId } });
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/functions/:functionId/runtime', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId || !functionId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getFunctionRuntime !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数运行环境' };
    const data = await provider.getFunctionRuntime(zoneId, functionId);
    if (data === false) return { code: -1, msg: '获取函数运行环境失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/functions/:functionId/runtime', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !functionId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.handleFunctionRuntime !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数运行环境' };
    if (!(await provider.handleFunctionRuntime(zoneId, functionId, params))) return { code: -1, msg: '修改函数运行环境失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: functionId, summary: `修改函数运行环境 ${functionId}（${zoneId}）`, detail: { aid, zoneId, functionId, operation: params.Operation } });
    return { code: 0, msg: '操作成功' };
  });

  app.get('/api/cdn/accounts/:aid/functions/:functionId/replicas', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId || !functionId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listFunctionReplicas !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数副本' };
    const r = await provider.listFunctionReplicas(zoneId, functionId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取函数副本失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/functions/:functionId/replicas', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !functionId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createFunctionReplica !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数副本' };
    if (!(await provider.createFunctionReplica(zoneId, functionId, params))) return { code: -1, msg: '创建函数副本失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: functionId, summary: `创建函数副本 ${params.ReplicaName || ''}（${functionId}）`, detail: { aid, zoneId, functionId, replicaName: params.ReplicaName } });
    return { code: 0, msg: '创建成功' };
  });

  app.put('/api/cdn/accounts/:aid/functions/:functionId/replicas/:replicaName', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const replicaName = decodeURIComponent(String((req.params as any).replicaName || ''));
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = { ...(b.params && typeof b.params === 'object' ? b.params : {}), ReplicaName: replicaName };
    if (!zoneId || !functionId || !replicaName) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateFunctionReplica !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数副本' };
    if (!(await provider.updateFunctionReplica(zoneId, functionId, params))) return { code: -1, msg: '修改函数副本失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: functionId, summary: `修改函数副本 ${replicaName}（${functionId}）`, detail: { aid, zoneId, functionId, replicaName } });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/functions/:functionId/replicas', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const names = (Array.isArray(b.replicaNames) ? b.replicaNames : []).map((x: any) => String(x)).filter(Boolean);
    if (!zoneId || !functionId || !names.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteFunctionReplicas !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数副本' };
    if (!(await provider.deleteFunctionReplicas(zoneId, functionId, names))) return { code: -1, msg: '删除函数副本失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: functionId, summary: `删除函数副本 ${names.length} 个（${functionId}）`, detail: { aid, zoneId, functionId, names } });
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/functions/:functionId/bindings', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId || !functionId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listFunctionBindings !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数组件绑定' };
    const data = await provider.listFunctionBindings(zoneId, functionId);
    if (data === false) return { code: -1, msg: '获取函数绑定失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/functions/:functionId/bindings', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const functionId = String((req.params as any).functionId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !functionId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.modifyFunctionBindings !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数组件绑定' };
    if (!(await provider.modifyFunctionBindings(zoneId, functionId, params))) return { code: -1, msg: '修改函数绑定失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: functionId, summary: `修改函数组件绑定 ${functionId}（${zoneId}）`, detail: { aid, zoneId, functionId, operation: params.Operation } });
    return { code: 0, msg: '操作成功' };
  });

  app.get('/api/cdn/accounts/:aid/function-rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listFunctionRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数触发规则' };
    const data = await provider.listFunctionRules(zoneId);
    if (data === false) return { code: -1, msg: '获取函数触发规则失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/function-rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createFunctionRule !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数触发规则' };
    const ruleId = await provider.createFunctionRule(zoneId, params);
    if (ruleId === false) return { code: -1, msg: '创建函数触发规则失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: ruleId, summary: `创建函数触发规则 ${ruleId}（${zoneId}）`, detail: { aid, zoneId, ruleId } });
    return { code: 0, msg: '创建成功', data: { ruleId } };
  });

  app.put('/api/cdn/accounts/:aid/function-rules/:ruleId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const ruleId = String((req.params as any).ruleId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !ruleId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateFunctionRule !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数触发规则' };
    if (!(await provider.updateFunctionRule(zoneId, ruleId, params))) return { code: -1, msg: '修改函数触发规则失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: ruleId, summary: `修改函数触发规则 ${ruleId}（${zoneId}）`, detail: { aid, zoneId, ruleId } });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/function-rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const ruleIds = (Array.isArray(b.ruleIds) ? b.ruleIds : []).map((x: any) => String(x)).filter(Boolean);
    if (!zoneId || !ruleIds.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteFunctionRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持函数触发规则' };
    if (!(await provider.deleteFunctionRules(zoneId, ruleIds))) return { code: -1, msg: '删除函数触发规则失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: zoneId, summary: `删除函数触发规则 ${ruleIds.length} 条（${zoneId}）`, detail: { aid, zoneId, ruleIds } });
    return { code: 0, msg: '删除成功' };
  });

  // ===== EdgeKV =====
  app.get('/api/cdn/accounts/:aid/kv/namespaces', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listKvNamespaces !== 'function') return { code: -1, msg: '该 CDN 类型不支持 EdgeKV' };
    const r = await provider.listKvNamespaces(zoneId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取 KV 命名空间失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/kv/namespaces', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const namespace = String(b.namespace || '').trim();
    if (!zoneId || !namespace) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createKvNamespace !== 'function') return { code: -1, msg: '该 CDN 类型不支持 EdgeKV' };
    if (!(await provider.createKvNamespace(zoneId, namespace, b.remark ? String(b.remark) : undefined))) return { code: -1, msg: '创建 KV 命名空间失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: namespace, summary: `创建 KV 命名空间 ${namespace}（${zoneId}）`, detail: { aid, zoneId, namespace } });
    return { code: 0, msg: '创建成功' };
  });

  app.put('/api/cdn/accounts/:aid/kv/namespaces/:namespace', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const namespace = decodeURIComponent(String((req.params as any).namespace || ''));
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !namespace) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateKvNamespace !== 'function') return { code: -1, msg: '该 CDN 类型不支持 EdgeKV' };
    if (!(await provider.updateKvNamespace(zoneId, namespace, b.remark !== undefined ? String(b.remark) : undefined))) return { code: -1, msg: '修改 KV 命名空间失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: namespace, summary: `修改 KV 命名空间 ${namespace}（${zoneId}）`, detail: { aid, zoneId, namespace } });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/kv/namespaces/:namespace', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const namespace = decodeURIComponent(String((req.params as any).namespace || ''));
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !namespace) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteKvNamespace !== 'function') return { code: -1, msg: '该 CDN 类型不支持 EdgeKV' };
    if (!(await provider.deleteKvNamespace(zoneId, namespace))) return { code: -1, msg: '删除 KV 命名空间失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: namespace, summary: `删除 KV 命名空间 ${namespace}（${zoneId}）`, detail: { aid, zoneId, namespace } });
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/kv/namespaces/:namespace/keys', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const namespace = decodeURIComponent(String((req.params as any).namespace || ''));
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId || !namespace) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.kvList !== 'function') return { code: -1, msg: '该 CDN 类型不支持 EdgeKV' };
    const r = await provider.kvList(zoneId, namespace, String(req.query.prefix || ''), String(req.query.cursor || ''), Number(req.query.limit || 100));
    if (r === false) return { code: -1, msg: '获取 KV 键列表失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/kv/namespaces/:namespace/get', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const namespace = decodeURIComponent(String((req.params as any).namespace || ''));
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const keys = Array.isArray(b.keys) ? b.keys.map((x: any) => String(x)) : [];
    if (!zoneId || !namespace || !keys.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.kvGet !== 'function') return { code: -1, msg: '该 CDN 类型不支持 EdgeKV' };
    const r = await provider.kvGet(zoneId, namespace, keys);
    if (r === false) return { code: -1, msg: '读取 KV 失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/kv/namespaces/:namespace/put', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const namespace = decodeURIComponent(String((req.params as any).namespace || ''));
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !namespace || !b.key || b.value === undefined) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.kvPut !== 'function') return { code: -1, msg: '该 CDN 类型不支持 EdgeKV' };
    if (!(await provider.kvPut(zoneId, namespace, String(b.key), String(b.value), b.expiration ? Number(b.expiration) : undefined, b.ttl ? Number(b.ttl) : undefined))) return { code: -1, msg: '写入 KV 失败，' + provider.getError() };
    return { code: 0, msg: '写入成功' };
  });

  app.post('/api/cdn/accounts/:aid/kv/namespaces/:namespace/delete', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const namespace = decodeURIComponent(String((req.params as any).namespace || ''));
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const keys = Array.isArray(b.keys) ? b.keys.map((x: any) => String(x)) : [];
    if (!zoneId || !namespace || !keys.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.kvDelete !== 'function') return { code: -1, msg: '该 CDN 类型不支持 EdgeKV' };
    if (!(await provider.kvDelete(zoneId, namespace, keys))) return { code: -1, msg: '删除 KV 失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: namespace, summary: `删除 KV 键 ${keys.length} 个（${namespace}）`, detail: { aid, zoneId, namespace, keys } });
    return { code: 0, msg: '删除成功' };
  });

  // ===== 版本管理 =====
  app.get('/api/cdn/accounts/:aid/sites/:zoneId/environments', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listEnvironments !== 'function') return { code: -1, msg: '该 CDN 类型不支持版本管理' };
    const data = await provider.listEnvironments(zoneId);
    if (data === false) return { code: -1, msg: '获取环境信息失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.get('/api/cdn/accounts/:aid/sites/:zoneId/versions', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const groupId = String(req.query.groupId || '').trim();
    if (!zoneId || !groupId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listConfigGroupVersions !== 'function') return { code: -1, msg: '该 CDN 类型不支持版本管理' };
    const r = await provider.listConfigGroupVersions(zoneId, groupId, Number(req.query.page || 1), Number(req.query.size || 50));
    if (r === false) return { code: -1, msg: '获取版本列表失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/sites/:zoneId/versions', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const params = (req.body || {}).params && typeof (req.body || {}).params === 'object' ? req.body.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createConfigGroupVersion !== 'function') return { code: -1, msg: '该 CDN 类型不支持版本管理' };
    const versionId = await provider.createConfigGroupVersion(zoneId, params);
    if (versionId === false) return { code: -1, msg: '创建版本失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: String(params.GroupId || versionId),
      summary: `创建配置组版本 ${versionId}（${zoneId}）`,
      detail: { aid, zoneId, versionId, groupId: params.GroupId },
    });
    return { code: 0, msg: '创建成功', data: { versionId } };
  });

  app.get('/api/cdn/accounts/:aid/sites/:zoneId/versions/history', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const envId = String(req.query.envId || '').trim();
    if (!zoneId || !envId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getDeployHistory !== 'function') return { code: -1, msg: '该 CDN 类型不支持版本管理' };
    const r = await provider.getDeployHistory(zoneId, envId);
    if (r === false) return { code: -1, msg: '获取发布历史失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/sites/:zoneId/versions/deploy', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const params = (req.body || {}).params && typeof (req.body || {}).params === 'object' ? req.body.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deployConfigGroupVersion !== 'function') return { code: -1, msg: '该 CDN 类型不支持版本管理' };
    const recordId = await provider.deployConfigGroupVersion(zoneId, params);
    if (recordId === false) return { code: -1, msg: '发布版本失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: recordId,
      summary: `发布配置组版本（${zoneId} -> ${params.EnvId || '-'}）`,
      detail: { aid, zoneId, recordId, envId: params.EnvId },
    });
    return { code: 0, msg: '发布任务已提交', data: { recordId } };
  });

  app.get('/api/cdn/accounts/:aid/sites/:zoneId/versions/:versionId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const versionId = String((req.params as any).versionId || '').trim();
    if (!zoneId || !versionId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getConfigGroupVersionDetail !== 'function') return { code: -1, msg: '该 CDN 类型不支持版本管理' };
    const data = await provider.getConfigGroupVersionDetail(zoneId, versionId);
    if (data === false) return { code: -1, msg: '获取版本详情失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/sites/:zoneId/work-mode', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const infos = Array.isArray((req.body || {}).infos) ? req.body.infos : [];
    if (!zoneId || !infos.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setZoneWorkMode !== 'function') return { code: -1, msg: '该 CDN 类型不支持工作模式修改' };
    if (!(await provider.setZoneWorkMode(zoneId, infos))) return { code: -1, msg: '修改工作模式失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: zoneId,
      summary: `修改站点工作模式（${zoneId}）`,
      detail: { aid, zoneId, infos },
    });
    return { code: 0, msg: '修改成功' };
  });

  // ===== 多通道安全网关 =====
  app.get('/api/cdn/accounts/:aid/multipath/regions', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listMultiPathGatewayRegions !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    const data = await provider.listMultiPathGatewayRegions(zoneId);
    if (data === false) return { code: -1, msg: '获取网关地域失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.get('/api/cdn/accounts/:aid/multipath/gateways', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listMultiPathGateways !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    const r = await provider.listMultiPathGateways(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取网关列表失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/multipath/gateways', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createMultiPathGateway !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    const gatewayId = await provider.createMultiPathGateway(zoneId, params);
    if (gatewayId === false) return { code: -1, msg: '创建网关失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: gatewayId, summary: `创建多通道安全网关 ${gatewayId}（${zoneId}）`, detail: { aid, zoneId, gatewayId, params } });
    return { code: 0, msg: '创建成功', data: { gatewayId } };
  });

  app.get('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    if (!zoneId || !gatewayId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getMultiPathGateway !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    const data = await provider.getMultiPathGateway(zoneId, gatewayId);
    if (data === false) return { code: -1, msg: '获取网关详情失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.put('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !gatewayId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateMultiPathGateway !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    if (!(await provider.updateMultiPathGateway(zoneId, gatewayId, params))) return { code: -1, msg: '修改网关失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: gatewayId, summary: `修改多通道安全网关 ${gatewayId}（${zoneId}）`, detail: { aid, zoneId, gatewayId, params } });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    if (!zoneId || !gatewayId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteMultiPathGateway !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    if (!(await provider.deleteMultiPathGateway(zoneId, gatewayId))) return { code: -1, msg: '删除网关失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: gatewayId, summary: `删除多通道安全网关 ${gatewayId}（${zoneId}）`, detail: { aid, zoneId, gatewayId } });
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId/status', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    const status = String(b.GatewayStatus || b.status || '').trim();
    if (!zoneId || !gatewayId || !status) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setMultiPathGatewayStatus !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    if (!(await provider.setMultiPathGatewayStatus(zoneId, gatewayId, status))) return { code: -1, msg: '修改网关状态失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: gatewayId, summary: `修改网关状态 ${gatewayId} -> ${status}（${zoneId}）`, detail: { aid, zoneId, gatewayId, status } });
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId/lines', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !gatewayId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createMultiPathGatewayLine !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    const lineId = await provider.createMultiPathGatewayLine(zoneId, gatewayId, params);
    if (lineId === false) return { code: -1, msg: '创建线路失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: gatewayId, summary: `创建网关线路 ${lineId}（${gatewayId}）`, detail: { aid, zoneId, gatewayId, lineId, params } });
    return { code: 0, msg: '创建成功', data: { lineId } };
  });

  app.get('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId/lines/:lineId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    const lineId = String((req.params as any).lineId || '').trim();
    if (!zoneId || !gatewayId || !lineId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getMultiPathGatewayLine !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    const data = await provider.getMultiPathGatewayLine(zoneId, gatewayId, lineId);
    if (data === false) return { code: -1, msg: '获取线路失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.put('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId/lines/:lineId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    const lineId = String((req.params as any).lineId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !gatewayId || !lineId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateMultiPathGatewayLine !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    if (!(await provider.updateMultiPathGatewayLine(zoneId, gatewayId, lineId, params))) return { code: -1, msg: '修改线路失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: gatewayId, summary: `修改网关线路 ${lineId}（${gatewayId}）`, detail: { aid, zoneId, gatewayId, lineId, params } });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId/lines/:lineId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    const lineId = String((req.params as any).lineId || '').trim();
    if (!zoneId || !gatewayId || !lineId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteMultiPathGatewayLine !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    if (!(await provider.deleteMultiPathGatewayLine(zoneId, gatewayId, lineId))) return { code: -1, msg: '删除线路失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: gatewayId, summary: `删除网关线路 ${lineId}（${gatewayId}）`, detail: { aid, zoneId, gatewayId, lineId } });
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId/origin-acl', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    if (!zoneId || !gatewayId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getMultiPathGatewayOriginAcl !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    const data = await provider.getMultiPathGatewayOriginAcl(zoneId, gatewayId);
    if (data === false) return { code: -1, msg: '获取回源 ACL 失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/multipath/gateways/:gatewayId/origin-acl/confirm', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const gatewayId = String((req.params as any).gatewayId || '').trim();
    const version = Number(b.OriginACLVersion || b.version || 0);
    if (!zoneId || !gatewayId || !version) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.confirmMultiPathGatewayOriginAcl !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    if (!(await provider.confirmMultiPathGatewayOriginAcl(zoneId, gatewayId, version))) return { code: -1, msg: '确认回源 ACL 失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: gatewayId, summary: `确认网关回源 ACL 版本 ${version}（${gatewayId}）`, detail: { aid, zoneId, gatewayId, version } });
    return { code: 0, msg: '确认成功' };
  });

  app.get('/api/cdn/accounts/:aid/multipath/secret-key', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getMultiPathGatewaySecretKey !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    const data = await provider.getMultiPathGatewaySecretKey(zoneId);
    if (data === false) return { code: -1, msg: '获取接入密钥失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/multipath/secret-key', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createMultiPathGatewaySecretKey !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    const secretKey = b.SecretKey ? String(b.SecretKey) : (b.secretKey ? String(b.secretKey) : undefined);
    if (!(await provider.createMultiPathGatewaySecretKey(zoneId, secretKey))) return { code: -1, msg: '创建接入密钥失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: zoneId, summary: `创建网关接入密钥（${zoneId}）`, detail: { aid, zoneId } });
    return { code: 0, msg: '创建成功' };
  });

  app.put('/api/cdn/accounts/:aid/multipath/secret-key', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const secretKey = String(b.SecretKey || b.secretKey || '').trim();
    if (!zoneId || !secretKey) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateMultiPathGatewaySecretKey !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    if (!(await provider.updateMultiPathGatewaySecretKey(zoneId, secretKey))) return { code: -1, msg: '更新接入密钥失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: zoneId, summary: `更新网关接入密钥（${zoneId}）`, detail: { aid, zoneId } });
    return { code: 0, msg: '更新成功' };
  });

  app.post('/api/cdn/accounts/:aid/multipath/secret-key/refresh', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.body || {}).zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.refreshMultiPathGatewaySecretKey !== 'function') return { code: -1, msg: '该 CDN 类型不支持多通道安全网关' };
    if (!(await provider.refreshMultiPathGatewaySecretKey(zoneId))) return { code: -1, msg: '刷新接入密钥失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: zoneId, summary: `刷新网关接入密钥（${zoneId}）`, detail: { aid, zoneId } });
    return { code: 0, msg: '刷新成功' };
  });

  // ===== 边缘推理 =====
  app.get('/api/cdn/accounts/:aid/inference/services', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listInferenceServices !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    const r = await provider.listInferenceServices(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取推理服务失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/inference/services', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createInferenceService !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    const serviceId = await provider.createInferenceService(zoneId, params);
    if (serviceId === false) return { code: -1, msg: '创建推理服务失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: serviceId, summary: `创建推理服务 ${serviceId}（${zoneId}）`, detail: { aid, zoneId, serviceId, params } });
    return { code: 0, msg: '创建成功', data: { serviceId } };
  });

  app.put('/api/cdn/accounts/:aid/inference/services/:serviceId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const serviceId = String((req.params as any).serviceId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !serviceId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateInferenceService !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    if (!(await provider.updateInferenceService(zoneId, serviceId, params))) return { code: -1, msg: '修改推理服务失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: serviceId, summary: `修改推理服务 ${serviceId}（${zoneId}）`, detail: { aid, zoneId, serviceId, params } });
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/cdn/accounts/:aid/inference/services/:serviceId/operate', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const serviceId = String((req.params as any).serviceId || '').trim();
    const operation = String(b.operation || '').trim();
    if (!zoneId || !serviceId || !operation) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.operateInferenceService !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    if (!(await provider.operateInferenceService(zoneId, serviceId, operation))) return { code: -1, msg: '操作推理服务失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: serviceId, summary: `推理服务 ${serviceId} 操作 ${operation}（${zoneId}）`, detail: { aid, zoneId, serviceId, operation } });
    return { code: 0, msg: '操作成功' };
  });

  app.get('/api/cdn/accounts/:aid/inference/services/:serviceId/records', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const serviceId = String((req.params as any).serviceId || '').trim();
    if (!zoneId || !serviceId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listInferenceDeploymentRecords !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    const r = await provider.listInferenceDeploymentRecords(zoneId, serviceId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取部署记录失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/inference/services/:serviceId/records/:recordId/logs', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const serviceId = String((req.params as any).serviceId || '').trim();
    const recordId = String((req.params as any).recordId || '').trim();
    if (!zoneId || !serviceId || !recordId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getInferenceDeploymentLogs !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    const r = await provider.getInferenceDeploymentLogs(zoneId, serviceId, recordId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取部署日志失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/inference/monitor', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getInferenceMonitorData !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    const data = await provider.getInferenceMonitorData(zoneId, params);
    if (data === false) return { code: -1, msg: '获取监控数据失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.get('/api/cdn/accounts/:aid/inference/tokens', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listInferenceApiTokens !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    const r = await provider.listInferenceApiTokens(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取推理 Token 失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/inference/tokens', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const name = String(b.Name || b.name || '').trim();
    if (!zoneId || !name) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createInferenceApiToken !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    const data = await provider.createInferenceApiToken(zoneId, name);
    if (data === false) return { code: -1, msg: '创建推理 Token 失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: name, summary: `创建推理 Token ${name}（${zoneId}）`, detail: { aid, zoneId, name, tokenId: data.TokenId } });
    return { code: 0, msg: '创建成功', data };
  });

  app.delete('/api/cdn/accounts/:aid/inference/tokens/:tokenId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const tokenId = String((req.params as any).tokenId || '').trim();
    if (!zoneId || !tokenId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteInferenceApiToken !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    if (!(await provider.deleteInferenceApiToken(zoneId, tokenId))) return { code: -1, msg: '删除推理 Token 失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: tokenId, summary: `删除推理 Token ${tokenId}（${zoneId}）`, detail: { aid, zoneId, tokenId } });
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/inference/domains', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const serviceId = String(req.query.serviceId || '').trim();
    if (!zoneId || !serviceId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listInferenceDomains !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    const r = await provider.listInferenceDomains(zoneId, serviceId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取推理域名失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/inference/domains', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createInferenceDomain !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    if (!(await provider.createInferenceDomain(zoneId, params))) return { code: -1, msg: '创建推理域名失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: String(params.Domain || ''), summary: `创建推理域名 ${params.Domain || ''}（${zoneId}）`, detail: { aid, zoneId, params } });
    return { code: 0, msg: '创建成功' };
  });

  app.post('/api/cdn/accounts/:aid/inference/domains/operate', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.operateInferenceDomain !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    if (!(await provider.operateInferenceDomain(zoneId, params))) return { code: -1, msg: '操作推理域名失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: String(params.Domain || ''), summary: `推理域名 ${params.Domain || ''} 操作 ${params.Operation || ''}（${zoneId}）`, detail: { aid, zoneId, params } });
    return { code: 0, msg: '操作成功' };
  });

  app.get('/api/cdn/accounts/:aid/inference/hardware', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listInferenceHardwareSpecifications !== 'function') return { code: -1, msg: '该 CDN 类型不支持边缘推理' };
    const data = await provider.listInferenceHardwareSpecifications(zoneId);
    if (data === false) return { code: -1, msg: '获取硬件规格失败，' + provider.getError() };
    return { code: 0, data };
  });

  // ===== 即时转码模板 =====
  app.get('/api/cdn/accounts/:aid/media/transcode-templates', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listJitTranscodeTemplates !== 'function') return { code: -1, msg: '该 CDN 类型不支持即时转码' };
    const r = await provider.listJitTranscodeTemplates(zoneId, Number(req.query.page || 1), Number(req.query.size || 20));
    if (r === false) return { code: -1, msg: '获取转码模板失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/media/transcode-templates', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createJitTranscodeTemplate !== 'function') return { code: -1, msg: '该 CDN 类型不支持即时转码' };
    const templateId = await provider.createJitTranscodeTemplate(zoneId, params);
    if (templateId === false) return { code: -1, msg: '创建转码模板失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: String(params.TemplateName || templateId), summary: `创建即时转码模板 ${templateId}（${zoneId}）`, detail: { aid, zoneId, templateId, params } });
    return { code: 0, msg: '创建成功', data: { templateId } };
  });

  app.delete('/api/cdn/accounts/:aid/media/transcode-templates', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const rawTemplateIds = Array.isArray(b.TemplateIds) ? b.TemplateIds : (Array.isArray(b.templateIds) ? b.templateIds : []);
    const templateIds = rawTemplateIds.map((x: any) => String(x));
    if (!zoneId || !templateIds.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteJitTranscodeTemplates !== 'function') return { code: -1, msg: '该 CDN 类型不支持即时转码' };
    if (!(await provider.deleteJitTranscodeTemplates(zoneId, templateIds))) return { code: -1, msg: '删除转码模板失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: zoneId, summary: `删除即时转码模板 ${templateIds.length} 个（${zoneId}）`, detail: { aid, zoneId, templateIds } });
    return { code: 0, msg: '删除成功' };
  });

  // ===== 套餐与计费 =====
  app.post('/api/cdn/accounts/:aid/billing/data', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    const provider: any = await cdnForZone(aid, zoneId || null);
    if (!provider || typeof provider.getBillingData !== 'function') return { code: -1, msg: '该 CDN 类型不支持计费数据查询' };
    if (!Array.isArray(params.ZoneIds) || !params.ZoneIds.length) params.ZoneIds = zoneId ? [zoneId] : ['*'];
    const data = await provider.getBillingData(params);
    if (data === false) return { code: -1, msg: '获取计费数据失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.get('/api/cdn/accounts/:aid/billing/available-plans', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.listAvailablePlans !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐查询' };
    const data = await provider.listAvailablePlans();
    if (data === false) return { code: -1, msg: '获取可购买套餐失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/billing/plans', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.createPlan !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐购买' };
    const data = await provider.createPlan(params);
    if (data === false) return { code: -1, msg: '套餐购买失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_account', targetId: String(aid), targetName: data.PlanId, summary: `购买 EO 套餐 ${data.PlanId}`, detail: { aid, params } });
    return { code: 0, msg: '下单成功', data };
  });

  app.put('/api/cdn/accounts/:aid/billing/plans/:planId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const planId = String((req.params as any).planId || '').trim();
    const b = req.body || {};
    const renewFlag = b.RenewFlag && typeof b.RenewFlag === 'object' ? b.RenewFlag : (b.renewFlag && typeof b.renewFlag === 'object' ? b.renewFlag : {});
    if (!planId || !Object.keys(renewFlag).length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.updatePlan !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐修改' };
    if (!(await provider.updatePlan(planId, renewFlag))) return { code: -1, msg: '修改套餐失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_account', targetId: String(aid), targetName: planId, summary: `修改套餐配置 ${planId}`, detail: { aid, planId, renewFlag } });
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/cdn/accounts/:aid/billing/plans/:planId/renew', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const planId = String((req.params as any).planId || '').trim();
    const b = req.body || {};
    const period = Number(b.Period || b.period || 0);
    if (!planId || !period) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.renewPlan !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐续费' };
    const voucher = b.AutoUseVoucher || b.autoUseVoucher;
    if (!(await provider.renewPlan(planId, period, voucher ? String(voucher) : undefined))) return { code: -1, msg: '套餐续费失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_account', targetId: String(aid), targetName: planId, summary: `套餐续费 ${planId} / ${period} 个月`, detail: { aid, planId, period } });
    return { code: 0, msg: '续费成功' };
  });

  app.post('/api/cdn/accounts/:aid/billing/plans/:planId/upgrade', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const planId = String((req.params as any).planId || '').trim();
    const b = req.body || {};
    const planType = String(b.PlanType || b.planType || '').trim();
    if (!planId || !planType) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.upgradePlan !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐升级' };
    const voucher = b.AutoUseVoucher || b.autoUseVoucher;
    if (!(await provider.upgradePlan(planId, planType, voucher ? String(voucher) : undefined))) return { code: -1, msg: '套餐升级失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_account', targetId: String(aid), targetName: planId, summary: `套餐升级 ${planId} -> ${planType}`, detail: { aid, planId, planType } });
    return { code: 0, msg: '升级成功' };
  });

  app.delete('/api/cdn/accounts/:aid/billing/plans/:planId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const planId = String((req.params as any).planId || '').trim();
    if (!planId) return { code: -1, msg: '缺少 planId' };
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.destroyPlan !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐销毁' };
    if (!(await provider.destroyPlan(planId))) return { code: -1, msg: '销毁套餐失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_account', targetId: String(aid), targetName: planId, summary: `销毁套餐 ${planId}`, detail: { aid, planId } });
    return { code: 0, msg: '销毁成功' };
  });

  app.post('/api/cdn/accounts/:aid/billing/plans/:planId/quota', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const planId = String((req.params as any).planId || '').trim();
    const b = req.body || {};
    const quotaType = String(b.QuotaType || b.quotaType || '').trim();
    const quotaNumber = Number(b.QuotaNumber || b.quotaNumber || 0);
    if (!planId || !quotaType || !quotaNumber) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.increasePlanQuota !== 'function') return { code: -1, msg: '该 CDN 类型不支持套餐配额增购' };
    if (!(await provider.increasePlanQuota(planId, quotaType, quotaNumber))) return { code: -1, msg: '增购套餐配额失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_account', targetId: String(aid), targetName: planId, summary: `套餐配额增购 ${planId} / ${quotaType} +${quotaNumber}`, detail: { aid, planId, quotaType, quotaNumber } });
    return { code: 0, msg: '增购成功' };
  });

  app.post('/api/cdn/accounts/:aid/sites/:zoneId/billing/plan', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const planType = String((req.body || {}).PlanType || (req.body || {}).planType || '').trim();
    if (!zoneId || !planType) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createPlanForZone !== 'function') return { code: -1, msg: '该 CDN 类型不支持站点套餐购买' };
    const data = await provider.createPlanForZone(zoneId, planType);
    if (data === false) return { code: -1, msg: '站点套餐购买失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: planType, summary: `为站点购买套餐 ${planType}（${zoneId}）`, detail: { aid, zoneId, planType, data } });
    return { code: 0, msg: '下单成功', data };
  });

  // 删除站点
  app.delete('/api/cdn/accounts/:aid/sites/:zoneId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.params as any).zoneId || '').trim();
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteZone !== 'function') return { code: -1, msg: '该 CDN 类型不支持删除站点' };
    const local: any = await queryOne(
      `SELECT COUNT(*) AS c FROM ${table('cdn_domain')} WHERE aid = ? AND zone_id = ?`,
      [aid, zoneId],
    );
    if (Number(local?.c || 0) > 0) {
      return { code: -1, msg: '该站点下仍有已接入的加速域名，请先删除/迁移这些域名后再删除站点' };
    }
    if (!(await provider.deleteZone(zoneId))) return { code: -1, msg: '删除失败，' + provider.getError() };
    return { code: 0, msg: '站点已删除' };
  });

  // ===== 共享 CNAME =====
  app.get('/api/cdn/accounts/:aid/shared-cnames', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listSharedCnames !== 'function') return { code: -1, msg: '该 CDN 类型不支持共享 CNAME' };
    const r = await provider.listSharedCnames(zoneId, Number(req.query.page || 1), Number(req.query.size || 50));
    if (r === false) return { code: -1, msg: '获取共享 CNAME 失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/shared-cnames', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const prefix = String(b.prefix || '').trim();
    if (!zoneId || !prefix) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createSharedCname !== 'function') return { code: -1, msg: '该 CDN 类型不支持共享 CNAME' };
    const sharedCname = await provider.createSharedCname(zoneId, prefix, b.description ? String(b.description) : undefined);
    if (sharedCname === false) return { code: -1, msg: '创建共享 CNAME 失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: sharedCname,
      summary: `创建共享 CNAME ${sharedCname}（${zoneId}）`,
      detail: { aid, zoneId, prefix },
    });
    return { code: 0, msg: '创建成功', data: { sharedCname } };
  });

  app.put('/api/cdn/accounts/:aid/shared-cnames/:sharedCname', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const sharedCname = decodeURIComponent(String((req.params as any).sharedCname || ''));
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !sharedCname) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateSharedCname !== 'function') return { code: -1, msg: '该 CDN 类型不支持共享 CNAME' };
    if (!(await provider.updateSharedCname(zoneId, sharedCname, b.description !== undefined ? String(b.description) : undefined))) {
      return { code: -1, msg: '修改共享 CNAME 失败，' + provider.getError() };
    }
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: sharedCname,
      summary: `修改共享 CNAME ${sharedCname}（${zoneId}）`,
      detail: { aid, zoneId, sharedCname, description: b.description },
    });
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/cdn/accounts/:aid/shared-cnames/bind', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const maps = Array.isArray(b.maps) ? b.maps : [];
    if (!zoneId || !maps.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.bindSharedCname !== 'function') return { code: -1, msg: '该 CDN 类型不支持共享 CNAME 绑定' };
    if (!(await provider.bindSharedCname(zoneId, String(b.bindType || 'bind'), maps))) {
      return { code: -1, msg: '绑定操作失败，' + provider.getError() };
    }
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: String(b.bindType || 'bind'),
      summary: `${b.bindType === 'unbind' ? '解绑' : '绑定'}共享 CNAME（${zoneId}）`,
      detail: { aid, zoneId, bindType: b.bindType, maps: maps.slice(0, 50) },
    });
    return { code: 0, msg: b.bindType === 'unbind' ? '解绑成功' : '绑定成功' };
  });

  app.delete('/api/cdn/accounts/:aid/shared-cnames/:sharedCname', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const sharedCname = decodeURIComponent(String((req.params as any).sharedCname || ''));
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !sharedCname) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteSharedCname !== 'function') return { code: -1, msg: '该 CDN 类型不支持共享 CNAME' };
    if (!(await provider.deleteSharedCname(zoneId, sharedCname))) return { code: -1, msg: '删除共享 CNAME 失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: sharedCname,
      summary: `删除共享 CNAME ${sharedCname}（${zoneId}）`,
      detail: { aid, zoneId, sharedCname },
    });
    return { code: 0, msg: '删除成功' };
  });

  // ===== 别称域名 =====
  app.get('/api/cdn/accounts/:aid/alias-domains', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listAliasDomains !== 'function') return { code: -1, msg: '该 CDN 类型不支持别称域名' };
    const r = await provider.listAliasDomains(zoneId, Number(req.query.page || 1), Number(req.query.size || 50));
    if (r === false) return { code: -1, msg: '获取别称域名失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/alias-domains', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !b.aliasName || !b.targetName) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createAliasDomain !== 'function') return { code: -1, msg: '该 CDN 类型不支持别称域名' };
    if (!(await provider.createAliasDomain(zoneId, b))) return { code: -1, msg: '创建别称域名失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: String(b.aliasName),
      summary: `创建别称域名 ${b.aliasName} -> ${b.targetName}（${zoneId}）`,
      detail: { aid, zoneId, aliasName: b.aliasName, targetName: b.targetName, certType: b.certType },
    });
    return { code: 0, msg: '创建成功' };
  });

  app.put('/api/cdn/accounts/:aid/alias-domains/:aliasName', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const aliasName = decodeURIComponent(String((req.params as any).aliasName || ''));
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !aliasName || !b.targetName) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateAliasDomain !== 'function') return { code: -1, msg: '该 CDN 类型不支持别称域名' };
    if (!(await provider.updateAliasDomain(zoneId, { ...b, aliasName }))) return { code: -1, msg: '修改别称域名失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: aliasName,
      summary: `修改别称域名 ${aliasName}（${zoneId}）`,
      detail: { aid, zoneId, aliasName, targetName: b.targetName },
    });
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/cdn/accounts/:aid/alias-domains/:aliasName/status', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const aliasName = decodeURIComponent(String((req.params as any).aliasName || ''));
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !aliasName) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setAliasDomainStatus !== 'function') return { code: -1, msg: '该 CDN 类型不支持别称域名状态修改' };
    const paused = b.paused === true || b.paused === 'true' || b.paused === 1;
    if (!(await provider.setAliasDomainStatus(zoneId, [aliasName], paused))) return { code: -1, msg: '修改状态失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: aliasName,
      summary: `${paused ? '停用' : '启用'}别称域名 ${aliasName}（${zoneId}）`,
      detail: { aid, zoneId, aliasName, paused },
    });
    return { code: 0, msg: paused ? '已停用' : '已启用' };
  });

  app.delete('/api/cdn/accounts/:aid/alias-domains/:aliasName', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const aliasName = decodeURIComponent(String((req.params as any).aliasName || ''));
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !aliasName) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteAliasDomain !== 'function') return { code: -1, msg: '该 CDN 类型不支持别称域名' };
    if (!(await provider.deleteAliasDomain(zoneId, aliasName))) return { code: -1, msg: '删除别称域名失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: aliasName,
      summary: `删除别称域名 ${aliasName}（${zoneId}）`,
      detail: { aid, zoneId, aliasName },
    });
    return { code: 0, msg: '删除成功' };
  });

  // ===== 自定义响应页面 =====
  app.get('/api/cdn/accounts/:aid/error-pages', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listCustomErrorPages !== 'function') return { code: -1, msg: '该 CDN 类型不支持自定义响应页面' };
    const r = await provider.listCustomErrorPages(zoneId, Number(req.query.page || 1), Number(req.query.size || 50));
    if (r === false) return { code: -1, msg: '获取自定义响应页面失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/error-pages', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !b.name || !b.contentType) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createCustomErrorPage !== 'function') return { code: -1, msg: '该 CDN 类型不支持自定义响应页面' };
    const pageId = await provider.createCustomErrorPage(zoneId, b);
    if (pageId === false) return { code: -1, msg: '创建自定义响应页面失败，' + provider.getError() };
    return { code: 0, msg: '创建成功', data: { pageId } };
  });

  app.put('/api/cdn/accounts/:aid/error-pages/:pageId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const pageId = String((req.params as any).pageId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId || !pageId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateCustomErrorPage !== 'function') return { code: -1, msg: '该 CDN 类型不支持自定义响应页面' };
    if (!(await provider.updateCustomErrorPage(zoneId, pageId, b))) return { code: -1, msg: '修改自定义响应页面失败，' + provider.getError() };
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/error-pages/:pageId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const pageId = String((req.params as any).pageId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !pageId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteCustomErrorPage !== 'function') return { code: -1, msg: '该 CDN 类型不支持自定义响应页面' };
    if (!(await provider.deleteCustomErrorPage(zoneId, pageId))) return { code: -1, msg: '删除自定义响应页面失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: pageId,
      summary: `删除自定义响应页面 ${pageId}（${zoneId}）`,
      detail: { aid, zoneId, pageId },
    });
    return { code: 0, msg: '删除成功' };
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

  app.get('/api/cdn/accounts/:aid/load-balancers/:instanceId/health', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const instanceId = String((req.params as any).instanceId || '');
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId || !instanceId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getLoadBalancerHealth !== 'function') return { code: -1, msg: '该 CDN 类型不支持健康状态查询' };
    const list = await provider.getLoadBalancerHealth(zoneId, instanceId);
    if (list === false) return { code: -1, msg: '获取健康状态失败，' + provider.getError() };
    return { code: 0, data: list };
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
  app.get('/api/cdn/accounts/:aid/rule-actions', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, String(req.query.zoneId || '').trim() || null);
    if (!provider || typeof provider.getAvailableRuleActions !== 'function') return { code: -1, msg: '该 CDN 类型不支持规则动作元数据' };
    const data = await provider.getAvailableRuleActions();
    if (data === false) return { code: -1, msg: '获取规则动作失败，' + provider.getError() };
    return { code: 0, data };
  });

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

  app.get('/api/cdn/accounts/:aid/security/origin-protection/families', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getOriginAclFamilies !== 'function') return { code: -1, msg: '该 CDN 类型不支持源站防护控制域查询' };
    const data = await provider.getOriginAclFamilies(zoneId);
    if (data === false) return { code: -1, msg: '获取控制域失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/security/origin-protection/confirm', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String((req.body || {}).zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.confirmOriginAclUpdate !== 'function') return { code: -1, msg: '该 CDN 类型不支持确认回源 IP 更新' };
    if (!(await provider.confirmOriginAclUpdate(zoneId))) return { code: -1, msg: '确认失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: zoneId,
      summary: `确认源站防护回源 IP 更新（${zoneId}）`,
      detail: { aid, zoneId },
    });
    return { code: 0, msg: '确认成功' };
  });

  // ===== 安全策略模板：详情 / 删除 / 绑定关系 =====
  app.get('/api/cdn/accounts/:aid/security/templates/:templateId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const templateId = String((req.params as any).templateId || '');
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId || !templateId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getWafTemplate !== 'function') return { code: -1, msg: '该 CDN 类型不支持安全策略模板' };
    const data = await provider.getWafTemplate(zoneId, templateId);
    if (data === false) return { code: -1, msg: '获取策略模板失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.delete('/api/cdn/accounts/:aid/security/templates/:templateId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const templateId = String((req.params as any).templateId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !templateId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteWafTemplate !== 'function') return { code: -1, msg: '该 CDN 类型不支持安全策略模板' };
    if (!(await provider.deleteWafTemplate(zoneId, templateId))) return { code: -1, msg: '删除策略模板失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: templateId,
      summary: `删除安全策略模板 ${templateId}（${zoneId}）`,
      detail: { aid, zoneId, templateId },
    });
    return { code: 0, msg: '策略模板已删除' };
  });

  app.get('/api/cdn/accounts/:aid/security/template-bindings', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    const raw = req.query.templateIds ?? req.query.templateId ?? '';
    const templateIds = (Array.isArray(raw) ? raw : String(raw).split(','))
      .map((x: any) => String(x).trim())
      .filter(Boolean);
    if (!zoneId || !templateIds.length) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getWafTemplateBindings !== 'function') return { code: -1, msg: '该 CDN 类型不支持策略模板绑定查询' };
    const data = await provider.getWafTemplateBindings(zoneId, templateIds);
    if (data === false) return { code: -1, msg: '获取绑定关系失败，' + provider.getError() };
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts/:aid/security/template-bind', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const templateId = String(b.templateId || '').trim();
    const entities = (Array.isArray(b.entities) ? b.entities : String(b.entities || '').split(','))
      .map((x: any) => String(x).trim())
      .filter(Boolean);
    const operate = String(b.operate || 'bind');
    if (!zoneId || !templateId || !entities.length) return { code: -1, msg: '参数不完整' };
    if (!['bind', 'unbind-keep-policy', 'unbind-use-default'].includes(operate)) return { code: -1, msg: '不支持的绑定操作' };
    if (operate !== 'bind' && entities.length !== 1) return { code: -1, msg: '解绑一次只能指定一个域名' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.bindWafTemplate !== 'function') return { code: -1, msg: '该 CDN 类型不支持策略模板绑定' };
    const overWrite = b.overWrite === undefined ? undefined : (b.overWrite === true || b.overWrite === 'true' || b.overWrite === 1);
    if (!(await provider.bindWafTemplate(zoneId, templateId, entities, operate, overWrite))) {
      return { code: -1, msg: '绑定操作失败，' + provider.getError() };
    }
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: templateId,
      summary: `安全策略模板${operate === 'bind' ? '绑定' : '解绑'} ${templateId}（${entities.join(',')}）`,
      detail: { aid, zoneId, templateId, entities, operate, overWrite },
    });
    return { code: 0, msg: operate === 'bind' ? '绑定成功' : '解绑成功' };
  });

  // ===== JavaScript 注入规则 / 客户端认证选项 =====
  app.get('/api/cdn/accounts/:aid/security/js-injection', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listJsInjectionRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持 JS 注入规则' };
    const r = await provider.listJsInjectionRules(zoneId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取 JS 注入规则失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/security/js-injection', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const rule = b.rule && typeof b.rule === 'object' ? b.rule : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createJsInjectionRule !== 'function') return { code: -1, msg: '该 CDN 类型不支持 JS 注入规则' };
    const ruleId = await provider.createJsInjectionRule(zoneId, rule);
    if (ruleId === false) return { code: -1, msg: '创建 JS 注入规则失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: ruleId,
      summary: `创建 JS 注入规则 ${rule.Name || ruleId}（${zoneId}）`,
      detail: { aid, zoneId, ruleId },
    });
    return { code: 0, msg: '创建成功', data: { ruleId } };
  });

  app.put('/api/cdn/accounts/:aid/security/js-injection/:ruleId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const ruleId = String((req.params as any).ruleId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const rule = { ...(b.rule && typeof b.rule === 'object' ? b.rule : {}), RuleId: ruleId };
    if (!zoneId || !ruleId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateJsInjectionRule !== 'function') return { code: -1, msg: '该 CDN 类型不支持 JS 注入规则' };
    if (!(await provider.updateJsInjectionRule(zoneId, rule))) return { code: -1, msg: '修改 JS 注入规则失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: ruleId,
      summary: `修改 JS 注入规则 ${ruleId}（${zoneId}）`,
      detail: { aid, zoneId, ruleId },
    });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/security/js-injection/:ruleId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const ruleId = String((req.params as any).ruleId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !ruleId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteJsInjectionRule !== 'function') return { code: -1, msg: '该 CDN 类型不支持 JS 注入规则' };
    if (!(await provider.deleteJsInjectionRule(zoneId, ruleId))) return { code: -1, msg: '删除 JS 注入规则失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: ruleId,
      summary: `删除 JS 注入规则 ${ruleId}（${zoneId}）`,
      detail: { aid, zoneId, ruleId },
    });
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/security/client-attesters', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listClientAttesters !== 'function') return { code: -1, msg: '该 CDN 类型不支持客户端认证选项' };
    const r = await provider.listClientAttesters(zoneId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取客户端认证选项失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/security/client-attesters', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const attester = b.attester && typeof b.attester === 'object' ? b.attester : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createClientAttester !== 'function') return { code: -1, msg: '该 CDN 类型不支持客户端认证选项' };
    const id = await provider.createClientAttester(zoneId, attester);
    if (id === false) return { code: -1, msg: '创建客户端认证选项失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: id,
      summary: `创建客户端认证选项 ${attester.Name || id}（${zoneId}）`,
      detail: { aid, zoneId, id },
    });
    return { code: 0, msg: '创建成功', data: { id } };
  });

  app.put('/api/cdn/accounts/:aid/security/client-attesters/:id', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const id = String((req.params as any).id || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const attester = { ...(b.attester && typeof b.attester === 'object' ? b.attester : {}), Id: id };
    if (!zoneId || !id) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateClientAttester !== 'function') return { code: -1, msg: '该 CDN 类型不支持客户端认证选项' };
    if (!(await provider.updateClientAttester(zoneId, attester))) return { code: -1, msg: '修改客户端认证选项失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: id,
      summary: `修改客户端认证选项 ${id}（${zoneId}）`,
      detail: { aid, zoneId, id },
    });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/security/client-attesters/:id', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const id = String((req.params as any).id || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !id) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteClientAttester !== 'function') return { code: -1, msg: '该 CDN 类型不支持客户端认证选项' };
    if (!(await provider.deleteClientAttester(zoneId, id))) return { code: -1, msg: '删除客户端认证选项失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: id,
      summary: `删除客户端认证选项 ${id}（${zoneId}）`,
      detail: { aid, zoneId, id },
    });
    return { code: 0, msg: '删除成功' };
  });

  // ===== API 服务 / API 资源 =====
  app.get('/api/cdn/accounts/:aid/security/api-services', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listApiServices !== 'function') return { code: -1, msg: '该 CDN 类型不支持 API 服务' };
    const r = await provider.listApiServices(zoneId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取 API 服务失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/security/api-services', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const service = b.service && typeof b.service === 'object' ? b.service : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createApiService !== 'function') return { code: -1, msg: '该 CDN 类型不支持 API 服务' };
    const id = await provider.createApiService(zoneId, service);
    if (id === false) return { code: -1, msg: '创建 API 服务失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: id,
      summary: `创建 API 服务 ${service.Name || id}（${zoneId}）`,
      detail: { aid, zoneId, id },
    });
    return { code: 0, msg: '创建成功', data: { id } };
  });

  app.put('/api/cdn/accounts/:aid/security/api-services/:id', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const id = String((req.params as any).id || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const service = { ...(b.service && typeof b.service === 'object' ? b.service : {}), Id: id };
    if (!zoneId || !id) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateApiService !== 'function') return { code: -1, msg: '该 CDN 类型不支持 API 服务' };
    if (!(await provider.updateApiService(zoneId, service))) return { code: -1, msg: '修改 API 服务失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: id, summary: `修改 API 服务 ${id}（${zoneId}）`, detail: { aid, zoneId, id } });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/security/api-services/:id', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const id = String((req.params as any).id || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !id) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteApiService !== 'function') return { code: -1, msg: '该 CDN 类型不支持 API 服务' };
    if (!(await provider.deleteApiService(zoneId, id))) return { code: -1, msg: '删除 API 服务失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: id, summary: `删除 API 服务 ${id}（${zoneId}）`, detail: { aid, zoneId, id } });
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/security/api-resources', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listApiResources !== 'function') return { code: -1, msg: '该 CDN 类型不支持 API 资源' };
    const r = await provider.listApiResources(zoneId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取 API 资源失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/security/api-resources', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const resource = b.resource && typeof b.resource === 'object' ? b.resource : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createApiResource !== 'function') return { code: -1, msg: '该 CDN 类型不支持 API 资源' };
    const id = await provider.createApiResource(zoneId, resource);
    if (id === false) return { code: -1, msg: '创建 API 资源失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: id, summary: `创建 API 资源 ${resource.Name || id}（${zoneId}）`, detail: { aid, zoneId, id } });
    return { code: 0, msg: '创建成功', data: { id } };
  });

  app.put('/api/cdn/accounts/:aid/security/api-resources/:id', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const id = String((req.params as any).id || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const resource = { ...(b.resource && typeof b.resource === 'object' ? b.resource : {}), Id: id };
    if (!zoneId || !id) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateApiResource !== 'function') return { code: -1, msg: '该 CDN 类型不支持 API 资源' };
    if (!(await provider.updateApiResource(zoneId, resource))) return { code: -1, msg: '修改 API 资源失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: id, summary: `修改 API 资源 ${id}（${zoneId}）`, detail: { aid, zoneId, id } });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/security/api-resources/:id', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const id = String((req.params as any).id || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !id) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteApiResource !== 'function') return { code: -1, msg: '该 CDN 类型不支持 API 资源' };
    if (!(await provider.deleteApiResource(zoneId, id))) return { code: -1, msg: '删除 API 资源失败，' + provider.getError() };
    audit(req, { targetType: 'cdn_zone', targetId: zoneId, targetName: id, summary: `删除 API 资源 ${id}（${zoneId}）`, detail: { aid, zoneId, id } });
    return { code: 0, msg: '删除成功' };
  });

  // ===== 内容标识符 =====
  app.get('/api/cdn/accounts/:aid/content-identifiers', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.listContentIdentifiers !== 'function') return { code: -1, msg: '该 CDN 类型不支持内容标识符' };
    const r = await provider.listContentIdentifiers(Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取内容标识符失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/content-identifiers', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.createContentIdentifier !== 'function') return { code: -1, msg: '该 CDN 类型不支持内容标识符' };
    const contentId = await provider.createContentIdentifier(params);
    if (contentId === false) return { code: -1, msg: '创建内容标识符失败，' + provider.getError() };
    return { code: 0, msg: '创建成功', data: { contentId } };
  });

  app.put('/api/cdn/accounts/:aid/content-identifiers/:contentId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const contentId = String((req.params as any).contentId || '');
    const description = String((req.body || {}).description || '');
    if (!contentId || !description.trim()) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.updateContentIdentifier !== 'function') return { code: -1, msg: '该 CDN 类型不支持内容标识符' };
    if (!(await provider.updateContentIdentifier(contentId, description))) return { code: -1, msg: '修改内容标识符失败，' + provider.getError() };
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/content-identifiers/:contentId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const contentId = String((req.params as any).contentId || '');
    if (!contentId) return { code: -1, msg: '缺少 contentId' };
    const provider: any = await cdnForZone(aid, null);
    if (!provider || typeof provider.deleteContentIdentifier !== 'function') return { code: -1, msg: '该 CDN 类型不支持内容标识符' };
    if (!(await provider.deleteContentIdentifier(contentId))) return { code: -1, msg: '删除内容标识符失败，' + provider.getError() };
    return { code: 0, msg: '删除成功' };
  });

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

  app.post('/api/cdn/accounts/:aid/l4-proxies/:proxyId/status', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const proxyId = String((req.params as any).proxyId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const status = String(b.status || '');
    if (!zoneId || !proxyId || !['online', 'offline'].includes(status)) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setL4ProxyStatus !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层代理状态修改' };
    if (!(await provider.setL4ProxyStatus(zoneId, proxyId, status))) return { code: -1, msg: '修改状态失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: proxyId,
      summary: `${status === 'online' ? '启用' : '停用'}四层代理 ${proxyId}（${zoneId}）`,
      detail: { aid, zoneId, proxyId, status },
    });
    return { code: 0, msg: status === 'online' ? '四层代理已启用' : '四层代理已停用' };
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

  app.put('/api/cdn/accounts/:aid/l4-proxies/:proxyId/rules', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const proxyId = String((req.params as any).proxyId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const rules = Array.isArray(b.rules) ? b.rules : [];
    if (!zoneId || !proxyId || !rules.length) return { code: -1, msg: '参数不完整' };
    if (rules.some((r: any) => !r?.RuleId)) return { code: -1, msg: '修改规则时缺少 RuleId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateL4ProxyRules !== 'function') return { code: -1, msg: '该 CDN 类型不支持修改四层转发规则' };
    if (!(await provider.updateL4ProxyRules(zoneId, proxyId, rules))) return { code: -1, msg: '修改四层转发规则失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: proxyId,
      summary: `修改四层转发规则 ${rules.length} 条（${proxyId}）`,
      detail: { aid, zoneId, proxyId, ruleIds: rules.map((r: any) => String(r.RuleId)).slice(0, 50) },
    });
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/cdn/accounts/:aid/l4-proxies/:proxyId/rules/status', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const proxyId = String((req.params as any).proxyId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const ruleIds = (Array.isArray(b.ruleIds) ? b.ruleIds : []).map((x: any) => String(x)).filter(Boolean);
    const status = String(b.status || '');
    if (!zoneId || !proxyId || !ruleIds.length || !['online', 'offline'].includes(status)) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setL4ProxyRulesStatus !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层规则状态修改' };
    if (!(await provider.setL4ProxyRulesStatus(zoneId, proxyId, ruleIds, status))) return { code: -1, msg: '修改规则状态失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: proxyId,
      summary: `${status === 'online' ? '启用' : '停用'}四层转发规则 ${ruleIds.length} 条（${proxyId}）`,
      detail: { aid, zoneId, proxyId, ruleIds: ruleIds.slice(0, 50), status },
    });
    return { code: 0, msg: status === 'online' ? '规则已启用' : '规则已停用' };
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

  // ===== 实时日志 / 离线日志 =====
  app.get('/api/cdn/accounts/:aid/logs/realtime', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.listRealtimeLogTasks !== 'function') return { code: -1, msg: '该 CDN 类型不支持实时日志' };
    const r = await provider.listRealtimeLogTasks(zoneId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取实时日志任务失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/logs/realtime', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.createRealtimeLogTask !== 'function') return { code: -1, msg: '该 CDN 类型不支持实时日志' };
    const taskId = await provider.createRealtimeLogTask(zoneId, params);
    if (taskId === false) return { code: -1, msg: '创建实时日志任务失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: String(params.TaskName || taskId),
      summary: `创建实时日志投递任务 ${params.TaskName || taskId}（${zoneId}）`,
      detail: { aid, zoneId, taskId, logType: params.LogType, taskType: params.TaskType },
    });
    return { code: 0, msg: '创建成功', data: { taskId } };
  });

  app.put('/api/cdn/accounts/:aid/logs/realtime/:taskId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const taskId = String((req.params as any).taskId || '');
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (!zoneId || !taskId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.updateRealtimeLogTask !== 'function') return { code: -1, msg: '该 CDN 类型不支持实时日志' };
    if (!(await provider.updateRealtimeLogTask(zoneId, taskId, params))) return { code: -1, msg: '修改实时日志任务失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: String(params.TaskName || taskId),
      summary: `修改实时日志投递任务 ${params.TaskName || taskId}（${zoneId}）`,
      detail: { aid, zoneId, taskId },
    });
    return { code: 0, msg: '修改成功' };
  });

  app.delete('/api/cdn/accounts/:aid/logs/realtime/:taskId', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const taskId = String((req.params as any).taskId || '');
    const zoneId = String((req.body || {}).zoneId || req.query.zoneId || '').trim();
    if (!zoneId || !taskId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.deleteRealtimeLogTask !== 'function') return { code: -1, msg: '该 CDN 类型不支持实时日志' };
    if (!(await provider.deleteRealtimeLogTask(zoneId, taskId))) return { code: -1, msg: '删除实时日志任务失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: taskId,
      summary: `删除实时日志投递任务 ${taskId}（${zoneId}）`,
      detail: { aid, zoneId, taskId },
    });
    return { code: 0, msg: '删除成功' };
  });

  app.get('/api/cdn/accounts/:aid/logs/offline/l7', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneIds = String(req.query.zoneIds || '').split(',').map((x) => x.trim()).filter(Boolean);
    const domains = String(req.query.domains || '').split(',').map((x) => x.trim()).filter(Boolean);
    const provider: any = await cdnForZone(aid, zoneIds[0] || null);
    if (!provider || typeof provider.downloadL7Logs !== 'function') return { code: -1, msg: '该 CDN 类型不支持离线日志' };
    const r = await provider.downloadL7Logs(
      zoneIds,
      String(req.query.startTime || ''),
      String(req.query.endTime || ''),
      Number(req.query.limit || 20),
      Number(req.query.offset || 0),
      domains,
    );
    if (r === false) return { code: -1, msg: '获取离线日志失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/logs/offline/l4', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneIds = String(req.query.zoneIds || '').split(',').map((x) => x.trim()).filter(Boolean);
    const proxyIds = String(req.query.proxyIds || '').split(',').map((x) => x.trim()).filter(Boolean);
    const provider: any = await cdnForZone(aid, zoneIds[0] || null);
    if (!provider || typeof provider.downloadL4Logs !== 'function') return { code: -1, msg: '该 CDN 类型不支持四层离线日志' };
    const r = await provider.downloadL4Logs(
      zoneIds,
      String(req.query.startTime || ''),
      String(req.query.endTime || ''),
      Number(req.query.limit || 20),
      Number(req.query.offset || 0),
      proxyIds,
    );
    if (r === false) return { code: -1, msg: '获取四层离线日志失败，' + provider.getError() };
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

  app.get('/api/cdn/accounts/:aid/cache/prefetch-origin-limit', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneId = String(req.query.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getPrefetchOriginLimit !== 'function') return { code: -1, msg: '该 CDN 类型不支持预热回源限速' };
    const r = await provider.getPrefetchOriginLimit(zoneId, Number(req.query.page || 1), Number(req.query.size || 100));
    if (r === false) return { code: -1, msg: '获取预热回源限速失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.post('/api/cdn/accounts/:aid/cache/prefetch-origin-limit', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const b = req.body || {};
    const zoneId = String(b.zoneId || '').trim();
    if (!zoneId) return { code: -1, msg: '缺少 zoneId' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.setPrefetchOriginLimit !== 'function') return { code: -1, msg: '该 CDN 类型不支持预热回源限速' };
    if (!(await provider.setPrefetchOriginLimit(zoneId, b))) return { code: -1, msg: '保存预热回源限速失败，' + provider.getError() };
    audit(req, {
      targetType: 'cdn_zone',
      targetId: zoneId,
      targetName: String(b.domainName || zoneId),
      summary: `配置预热回源限速 ${b.domainName || zoneId}`,
      detail: { aid, zoneId, domainName: b.domainName, area: b.area, bandwidth: b.bandwidth, enabled: b.enabled },
    });
    return { code: 0, msg: '保存成功' };
  });

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

  app.get('/api/cdn/accounts/:aid/analysis/ddos/events', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneIds = String(req.query.zoneIds || '').split(',').map((x) => x.trim()).filter(Boolean);
    const provider: any = await cdnForZone(aid, zoneIds[0] || null);
    if (!provider || typeof provider.getDdosAttackEvents !== 'function') return { code: -1, msg: '该 CDN 类型不支持 DDoS 事件查询' };
    const r = await provider.getDdosAttackEvents(zoneIds, String(req.query.startTime || ''), String(req.query.endTime || ''), Number(req.query.limit || 20));
    if (r === false) return { code: -1, msg: '获取 DDoS 事件失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/analysis/ddos/top', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneIds = String(req.query.zoneIds || '').split(',').map((x) => x.trim()).filter(Boolean);
    const provider: any = await cdnForZone(aid, zoneIds[0] || null);
    if (!provider || typeof provider.getDdosAttackTop !== 'function') return { code: -1, msg: '该 CDN 类型不支持 DDoS Top 查询' };
    const r = await provider.getDdosAttackTop(
      zoneIds,
      String(req.query.startTime || ''),
      String(req.query.endTime || ''),
      String(req.query.metricName || 'ddos_attackFlux_protocol'),
      Number(req.query.limit || 10),
    );
    if (r === false) return { code: -1, msg: '获取 DDoS Top 失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/analysis/l4-timing', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const zoneIds = String(req.query.zoneIds || '').split(',').map((x) => x.trim()).filter(Boolean);
    const metricNames = String(req.query.metricNames || 'l4Flow_flux').split(',').map((x) => x.trim()).filter(Boolean);
    const provider: any = await cdnForZone(aid, zoneIds[0] || null);
    if (!provider || typeof provider.getL4TimingData !== 'function') return { code: -1, msg: '该 CDN 类型不支持 L4 统计' };
    const r = await provider.getL4TimingData(
      zoneIds,
      String(req.query.startTime || ''),
      String(req.query.endTime || ''),
      metricNames,
      String(req.query.interval || 'hour'),
    );
    if (r === false) return { code: -1, msg: '获取 L4 统计失败，' + provider.getError() };
    return { code: 0, data: r };
  });

  app.get('/api/cdn/accounts/:aid/diagnostics/ip-region', authAid, async (req: any) => {
    const aid = Number((req.params as any).aid);
    const ips = String(req.query.ips || '').split(',').map((x) => x.trim()).filter(Boolean);
    const provider: any = await cdnForZone(aid, String(req.query.zoneId || '').trim() || null);
    if (!provider || typeof provider.getIpRegion !== 'function') return { code: -1, msg: '该 CDN 类型不支持 IP 归属查询' };
    const r = await provider.getIpRegion(ips);
    if (r === false) return { code: -1, msg: '获取 IP 归属失败，' + provider.getError() };
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

  // 切换线路：目标账户下与当前域名同主域名的站点
  app.get('/api/cdn/domains/:id/switch/sites', authCdnDomain, async (req: any) => {
    const row = await loadCdnDomain(Number(req.params.id));
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const aid = Number(req.query?.aid || 0);
    if (!aid) return { code: -1, msg: '请选择目标线路账户' };
    try {
      const { partner, acct, dnsDomain } = await resolveSwitchAccount(req, row, aid);
      const provider: any = await cdnForZone(aid, null);
      if (!provider || typeof provider.getZones !== 'function') return { code: -1, msg: '目标 CDN 账户不可用' };
      const zones = await provider.getZones();
      if (!Array.isArray(zones)) return { code: -1, msg: '获取目标站点失败：' + (provider.getError?.() || '未知错误') };
      if (!zones.length) {
        const err = provider.getError?.() || '';
        if (err) return { code: -1, msg: '获取目标站点失败：' + err };
      }
      const matched = zones
        .filter((z: any) => siteCoversDomain(row.name, z.zoneName, dnsDomain.name))
        .sort((a: any, b: any) => {
          const an = normalizeHost(a.zoneName);
          const bn = normalizeHost(b.zoneName);
          const exactA = an === normalizeHost(row.name) ? 1 : 0;
          const exactB = bn === normalizeHost(row.name) ? 1 : 0;
          return exactB - exactA || bn.length - an.length;
        })
        .map((z: any) => ({
          zoneId: String(z.zoneId || ''),
          zoneName: String(z.zoneName || ''),
          status: z.status || '',
          paused: z.paused === true,
          area: z.area || '',
          planName: z.planName || '',
        }))
        .filter((z: any) => !!z.zoneId);
      // ESA 的 ListSites 不返回暂停状态；补齐后前端才能在站点选项里提示。
      if (typeof provider.getZonePaused === 'function') {
        await runPool(
          matched
            .filter((z: any) => typeof z.paused !== 'boolean')
            .map((z: any) => async () => {
              try {
                z.paused = (await provider.getZonePaused(String(z.zoneId))) === true;
              } catch {
                z.paused = false;
              }
            }),
          4,
        );
      }
      return {
        code: 0,
        data: {
          aid,
          accountName: acct.name,
          targetRoute: partner,
          targetRouteName: cdnConfig[partner]?.name || partner,
          dnsName: dnsDomain.name,
          zones: matched,
        },
      };
    } catch (e: any) {
      return { code: -1, msg: e?.message || String(e) };
    }
  });

  // 切换线路预检：目标站点是否已有同名加速域名
  app.get('/api/cdn/domains/:id/switch/check', authCdnDomain, async (req: any) => {
    const row = await loadCdnDomain(Number(req.params.id));
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const aid = Number(req.query?.aid || 0);
    const zoneId = String(req.query?.zone_id || '').trim();
    if (!aid || !zoneId) return { code: -1, msg: '请选择目标账户和站点' };
    try {
      const { provider, dnsDomain, zone } = await resolveSwitchTarget(req, row, aid, zoneId);
      const targetHost = normalizeHost(row.name) || String(row.name);
      const cname = await provider.getDomainCname(targetHost);
      const err = provider.getError?.() || '';
      if (!cname && err) return { code: -1, msg: '检查目标域名失败：' + err };
      const targetInfo = cname ? await readCloudDomainInfo(provider, targetHost, zoneId) : null;
      if (targetInfo?.status === 'offline') {
        return { code: -1, msg: '目标加速域名当前处于关闭状态，切换后流量可能无法加速，请先在目标线路启用' };
      }
      return {
        code: 0,
        data: {
          exists: !!cname,
          cname: cname || '',
          dnsName: dnsDomain.name,
          recordName: calcRecordName(String(row.name), String(dnsDomain.name)),
          zoneId,
          zoneName: zone.zoneName,
          zoneStatus: zone.status || '',
          zonePaused: zone.paused === true,
          targetStatus: targetInfo?.status || '',
        },
      };
    } catch (e: any) {
      return { code: -1, msg: e?.message || String(e) };
    }
  });

  // 执行切换：复用或创建目标域名 -> 更新 DNS -> 更新本地线路 -> 按需配置证书
  app.post('/api/cdn/domains/:id/switch', authCdnDomain, async (req: any, reply: any) => {
    const id = Number(req.params.id);
    if (!hitRateLimit(`cdn-switch:${req.user.uid}`, 10, 10 * 60_000)) {
      return { code: -1, msg: '切换操作过于频繁，请稍后再试' };
    }
    const locked = await withDistributedLockResult(
      `dnsmgr:cdn-switch:${id}`,
      async () => {
        const row: any = await loadCdnDomain(id);
        if (!row) return { code: -1, msg: '加速域名不存在' };
        const b = req.body || {};
        const aid = Number(b.aid || 0);
        const zoneId = String(b.zone_id || '').trim();
        if (!aid || !zoneId) return { code: -1, msg: '请选择目标账户和站点' };

        let ctx: any;
        try {
          ctx = await resolveSwitchTarget(req, row, aid, zoneId);
        } catch (e: any) {
          return { code: -1, msg: e?.message || String(e) };
        }
        const { acct, dnsDomain, provider, zone } = ctx;
        const targetHost = normalizeHost(row.name) || String(row.name);

        // 证书模式先解析；是否允许配置要等确认目标域名是否已存在后再判断。
        // 复用已有域名时必须完全忽略证书设置，只改 DNS。
        const certModeRaw = b.cert_mode === undefined ? null : String(b.cert_mode);
        let requestedCertMode =
          certModeRaw === null ? null : ['freecert', 'certapply', 'certlink'].includes(certModeRaw) ? certModeRaw : 'none';

        const dnsAcct: any = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
        if (!dnsAcct) return { code: -1, msg: 'DNS 账户不存在，无法自动切换解析' };
        let dns: any;
        try {
          dns = getDnsProvider(dnsAcct.type, await accountConfigOf(dnsAcct), dnsDomain.name, dnsDomain.thirdid);
        } catch (e: any) {
          return { code: -1, msg: '读取 DNS 账户失败：' + (e?.message || String(e)) };
        }
        if (!dns) return { code: -1, msg: 'DNS 模块不存在，无法自动切换解析' };

        const origin = String(b.origin || '').trim();
        const originType = ['ipaddr', 'domain'].includes(String(b.origin_type || '')) ? String(b.origin_type) : 'ipaddr';
        const protoRaw = String(b.origin_protocol || 'follow');
        const originProtocol = ['follow', 'http', 'https'].includes(protoRaw) ? protoRaw : 'follow';
        const httpPort = Number(b.http_port) > 0 ? Number(b.http_port) : 80;
        const httpsPort = Number(b.https_port) > 0 ? Number(b.https_port) : 443;
        const originHost = String(b.origin_host || '');
        const targetServiceArea = normalizeServiceArea(zone?.area) || String(row.service_area || 'mainland_china');

        let cname = await provider.getDomainCname(targetHost);
        const lookupError = cname ? '' : provider.getError?.() || '';
        if (!cname && lookupError) return { code: -1, msg: '检查目标域名失败：' + lookupError };
        const reused = !!cname;
        let certModeIgnored = false;
        if (reused && requestedCertMode) {
          // 目标站点已有同名域名：不创建、不修改，只改 DNS；证书设置全部忽略。
          certModeIgnored = requestedCertMode !== 'none';
          requestedCertMode = null;
        }
        if (!reused && requestedCertMode && requestedCertMode !== 'none') {
          if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '仅管理员可配置证书' });
          if (!cdnCertModeSupported(acct.type, requestedCertMode)) return { code: -1, msg: '目标线路不支持所选证书方式' };
          if (requestedCertMode === 'certlink' && !b.cert_order_id && !b.cert_aid && !b.cert_use_default) {
            return { code: -1, msg: '请选择证书来源' };
          }
        }
        let created = false;
        // 仅当创建接口明确返回成功时才允许失败回滚删除，
        // 避免把「创建返回失败但复查发现已存在」的既有域名误删。
        let createdByUs = false;
        let originWarning = '';
        let cloudInfo: any = null;

        if (!cname) {
          if (!origin) return { code: -1, msg: '目标站点没有同名域名，请填写回源地址' };
          const createdCname = await provider.createDomain(targetHost, origin, originType, targetServiceArea, zoneId);
          if (createdCname) {
            cname = createdCname;
            created = true;
            createdByUs = true;
          } else {
            // 创建接口超时/轮询失败时域名可能已经创建，再查一次避免重复创建
            cname = await provider.getDomainCname(targetHost);
            if (!cname) {
              return { code: -1, msg: '在目标站点创建加速域名失败：' + (provider.getError?.() || '未知错误') };
            }
            created = true;
          }
          const needOriginUpdate = !!(originHost || originProtocol !== 'follow' || httpPort !== 80 || httpsPort !== 443);
          if (needOriginUpdate) {
            const ok = await provider
              .updateOrigin(targetHost, origin, originType, originHost, originProtocol, httpPort, httpsPort)
              .catch(() => false);
            if (!ok) originWarning = '回源协议/端口/HOST 应用失败（' + (provider.getError?.() || '未知错误') + '），可在详情页重试';
          }
        } else {
          // 复用已有域名：按要求不修改目标回源/规则，仅尽力读取云端信息同步本地展示
          cloudInfo = await readCloudDomainInfo(provider, targetHost, zoneId);
        }
        if (!created && cloudInfo?.status === 'offline') {
          return { code: -1, msg: '目标加速域名当前处于关闭状态，切换后流量可能无法加速，请先在目标线路启用' };
        }

        let dnsResult: SwitchDnsResult;
        try {
          dnsResult = await switchLinkedDnsRecord(row, dnsDomain, dns, String(cname));
        } catch (e: any) {
          let rollback = '';
          if (createdByUs) {
            const removed = await provider.deleteDomain(targetHost).catch(() => false);
            rollback = removed ? '（已回滚本次新建的云端域名）' : '（云端域名回滚失败，请手动删除）';
          }
          return { code: -1, msg: '切换 DNS 解析失败：' + (e?.message || String(e)) + rollback };
        }

        const certStateBefore = await readCdnCertState(provider, targetHost);
        const certBeforeUsable = certInfoCoversDomain(certStateBefore, row.name);
        let nextCertMode = requestedCertMode;
        if (reused) {
          // 复用目标域名不继承旧线路的证书管理方式；只按目标站点实际平台证书做展示推断。
          nextCertMode =
            certBeforeUsable && certStateBefore?.source === 'platform' && cdnConfig[acct.type]?.freecert ? 'freecert' : '';
        } else if (nextCertMode === null) {
          nextCertMode = String(row.cert_mode || '');
          if (nextCertMode && !cdnCertModeSupported(acct.type, nextCertMode)) nextCertMode = '';
          if (!nextCertMode && certBeforeUsable && certStateBefore?.source === 'platform' && cdnConfig[acct.type]?.freecert) {
            nextCertMode = 'freecert';
          }
        }
        if (nextCertMode === 'none') nextCertMode = '';

        const nextOrigin = created
          ? { origin, origin_type: originType, origin_host: originHost, origin_protocol: originProtocol, http_port: httpPort, https_port: httpsPort }
          : {
              origin: cloudInfo?.origin || row.origin || '',
              origin_type: cloudInfo?.origin_type || row.origin_type || 'ipaddr',
              origin_host:
                cloudInfo && Object.prototype.hasOwnProperty.call(cloudInfo, 'origin_host')
                  ? String(cloudInfo.origin_host ?? '')
                  : String(row.origin_host ?? ''),
              origin_protocol: cloudInfo?.origin_protocol || row.origin_protocol || 'follow',
              http_port: Number(cloudInfo?.http_port) > 0 ? Number(cloudInfo.http_port) : Number(row.http_port) || 80,
              https_port: Number(cloudInfo?.https_port) > 0 ? Number(cloudInfo.https_port) : Number(row.https_port) || 443,
            };
        const nextStatus = created ? 'online' : cloudInfo ? (cloudInfo.status === 'offline' ? 'offline' : 'online') : row.status || 'online';
        const nextHttps = certStateBefore
          ? certBeforeUsable
            ? 1
            : 0
          : created || reused
            ? 0
            : Number(row.https_enabled) || 0;
        const nextForce = created
          ? 0
          : cloudInfo && typeof cloudInfo.force_redirect === 'boolean'
            ? cloudInfo.force_redirect
              ? 1
              : 0
            : Number(row.force_redirect) || 0;
        const nextServiceArea = targetServiceArea;

        try {
          await query(
            `UPDATE ${table('cdn_domain')}
                SET aid = ?, route = ?, zone_id = ?, cname = ?, dns_record = ?, origin = ?, origin_type = ?, origin_host = ?,
                    origin_protocol = ?, http_port = ?, https_port = ?, service_area = ?, status = ?, https_enabled = ?, force_redirect = ?, cert_mode = ?
              WHERE id = ?`,
            [
              acct.id,
              acct.type,
              zoneId,
              String(cname),
              dnsResult.recordId,
              nextOrigin.origin,
              nextOrigin.origin_type,
              nextOrigin.origin_host,
              nextOrigin.origin_protocol,
              nextOrigin.http_port,
              nextOrigin.https_port,
              nextServiceArea,
              nextStatus,
              nextHttps,
              nextForce,
              created ? '' : nextCertMode,
              id,
            ],
          );
        } catch (e: any) {
          // 本地写库失败：尽量把 DNS 改回旧值并清理本次新建的云端域名
          let rollbackDns = '';
          if (dnsResult.added) {
            // 本次新加的记录直接删除；不能把它改成旧值，否则会留下一条多余记录
            const removed = await dns.deleteDomainRecord(dnsResult.recordId).catch(() => false);
            if (!removed) rollbackDns = '；新增的 DNS 记录回滚删除失败，请手动处理';
          } else if (dnsResult.updated && row.cname) {
            const reverted = await switchLinkedDnsRecord(
              { ...row, cname: String(cname), dns_record: dnsResult.recordId },
              dnsDomain,
              dns,
              String(row.cname),
            ).catch(() => false);
            if (!reverted) rollbackDns = '；DNS 回滚失败，请手动改回 ' + row.cname;
          }
          if (dnsResult.wasPaused && !dnsResult.added) {
            const paused = await dns.setDomainRecordStatus(dnsResult.recordId, '0').catch(() => false);
            if (!paused) rollbackDns += '；原解析记录的暂停状态恢复失败，请手动暂停';
          }
          let rollbackCloud = '';
          if (createdByUs) {
            const removed = await provider.deleteDomain(targetHost).catch(() => false);
            if (!removed) rollbackCloud = '；云端域名回滚失败，请手动删除';
          }
          return { code: -1, msg: '保存切换结果失败：' + (e?.message || String(e)) + rollbackDns + rollbackCloud };
        }

        // 旧线路的「与项目联动」自动部署任务在本地库更新成功后再停用：
        // 如果写库失败，旧线路仍保持原状，不需要恢复任务。
        // certapply 使用站点级通配符任务，可能仍服务旧站点上的其他域名，不能在这里
        // 无条件停用；certlink 是精确到本域名的绑定，可以安全停用。
        let certCleanupWarning = '';
        let oldCertlink = String(row.cert_mode || '') === 'certlink';
        if (!oldCertlink && !row.cert_mode) {
          // 兼容历史数据：cert_mode 为空但已存在联动订单时，列表页会按 certlink 展示，
          // 切换时也应停用旧部署任务。
          try {
            oldCertlink = !!(await findLinkedOrder(id));
          } catch (e: any) {
            oldCertlink = false;
            certCleanupWarning = '检查旧证书自动部署任务失败：' + (e?.message || String(e));
          }
        }
        if (oldCertlink) {
          try {
            await deactivateCertDeployForDomain(id);
          } catch (e: any) {
            certCleanupWarning = '旧证书自动部署任务停用失败：' + (e?.message || String(e));
          }
        }

        // 证书：只有用户在切换时显式选择或在新建域名时传入才自动处理；复用已有域名默认不动证书
        let certResult: any = null;
        if (requestedCertMode && requestedCertMode !== 'none') {
          try {
            if (requestedCertMode === 'freecert') {
              const r: any = (await runFreeCert([id], false, req.user))[0];
              certResult = r || null;
              if (r && r.status !== 'failed') await setCertMode(id, 'freecert');
            } else if (requestedCertMode === 'certapply') {
              const r: any = (await runCertLink([id], false, req.user))[0];
              certResult = r || null;
              if (r && r.status !== 'failed') await setCertMode(id, 'certapply', r.order_id ? [Number(r.order_id)] : []);
            } else if (requestedCertMode === 'certlink') {
              const r: any = await applyCertLink(
                id,
                provider,
                { certOrderId: b.cert_order_id, certAid: b.cert_aid, useDefault: !!b.cert_use_default },
                req.user,
              );
              certResult = r || null;
              if (r && r.status !== 'failed') await setCertMode(id, 'certlink');
            }
          } catch (e: any) {
            certResult = { status: 'failed', message: e?.message || String(e) };
          }
          if (certResult?.status === 'failed') {
            // 证书失败不影响线路切换结果，但本地不保留会误导的证书方式
            await query(`UPDATE ${table('cdn_domain')} SET cert_mode = '' WHERE id = ?`, [id]).catch(() => undefined);
          }
        }

        const certStateAfter = await readCdnCertState(provider, targetHost);
        const certAfterUsable = certInfoCoversDomain(certStateAfter, row.name);
        const certPending = certResult?.status === 'pending';
        const certApplied = certResult?.status === 'applied' || certAfterUsable;
        // 证书状态读不到时也提示（文案是“暂未检测到”），避免 HTTPS 不可用却静默通过。
        // 若本次证书操作失败但目标域名已有可用证书，不需要再弹补配提醒。
        const needsCert = (!certApplied && !certPending) || (certResult?.status === 'failed' && !certAfterUsable);

        const warnings: string[] = [];
        if (originWarning) warnings.push(originWarning);
        if (dnsResult.warning) warnings.push(dnsResult.warning);
        if (certCleanupWarning) warnings.push(certCleanupWarning);
        if (certModeIgnored) warnings.push('目标站点已有同名域名，已忽略证书设置，仅切换 DNS');
        if (!created && !cloudInfo) warnings.push('未能读取目标线路的回源信息，本地展示可能仍为原线路配置');
        if (
          !created &&
          cloudInfo &&
          (cloudInfo.origin_protocol === undefined ||
            cloudInfo.origin_host === undefined ||
            cloudInfo.http_port === undefined ||
            cloudInfo.https_port === undefined ||
            cloudInfo.force_redirect === undefined)
        ) {
          warnings.push('目标线路未返回完整回源/跳转信息，本地展示可能保留原线路配置');
        }
        if (certResult?.status === 'failed' && certResult.message) warnings.push('证书配置失败：' + certResult.message);
        if (needsCert) warnings.push('目标域名暂未检测到可用证书，HTTPS 可能不可用');

        const targetName = cdnConfig[acct.type]?.name || acct.type;
        const oldName = cdnConfig[row.route]?.name || row.route;
        let msg = `已从 ${oldName} 切换到 ${targetName}（${created ? '已在目标站点创建同名域名' : '已复用目标站点同名域名'}）`;
        if (dnsResult.added) msg += '；已新增 DNS CNAME 解析';
        else if (dnsResult.updated) msg += '；已更新 DNS CNAME 解析';
        else msg += '；DNS 解析已指向目标线路';
        if (certResult?.message) msg += `；证书：${certResult.message}`;
        msg += '；原线路云端域名已保留，可随时切回';

        audit(req, {
          targetType: 'cdn_domain',
          targetId: id,
          targetName: String(row.name),
          summary: `切换 CDN 线路 ${row.name}：${oldName} -> ${targetName}`,
          changes: [
            { field: '线路', from: String(row.route || ''), to: String(acct.type) },
            { field: '账户', from: String(row.aid || ''), to: String(acct.id) },
            { field: '站点', from: String(row.zone_id || ''), to: zoneId },
            { field: 'CNAME', from: String(row.cname || ''), to: String(cname) },
          ],
          detail: {
            old_aid: row.aid,
            old_route: row.route,
            old_cname: row.cname,
            aid: acct.id,
            route: acct.type,
            zone_id: zoneId,
            cname,
            created,
            reused,
            dns_record: dnsResult.recordId,
            dns_updated: dnsResult.updated,
            dns_added: dnsResult.added,
            cert_mode: requestedCertMode,
            cert_mode_ignored: certModeIgnored,
            cert_status: certResult?.status || null,
            needs_cert: needsCert,
            warnings,
          },
        });

        return {
          code: 0,
          msg,
          data: {
            id,
            name: row.name,
            aid: acct.id,
            route: acct.type,
            routename: targetName,
            zone_id: zoneId,
            cname: String(cname),
            dns_record: dnsResult.recordId,
            dns_updated: dnsResult.updated,
            dns_added: dnsResult.added,
            created,
            reused,
            old_aid: row.aid,
            old_route: row.route,
            old_cname: row.cname,
            old_kept: true,
            cert_mode: requestedCertMode,
            cert_mode_ignored: certModeIgnored,
            cert: certResult,
            cert_pending: !!certPending,
            needs_cert: needsCert,
            cert_status: certStateAfter
              ? { httpsEnabled: !!certStateAfter.httpsEnabled, covered: certAfterUsable, source: certStateAfter.source, mode: certStateAfter.mode }
              : null,
            warnings,
          },
        };
      },
      10,
    );
    if (!locked.locked) return { code: -1, msg: '该域名正在执行切换，请稍后再试' };
    return locked.result;
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
    // 每次接入都会做三张表的全量扫描 + 多次厂商调用，必须限流，避免被当作资源放大器
    if (!hitRateLimit(`cdn-domain-add:${req.user.uid}`, 30, 10 * 60_000)) {
      return { code: -1, msg: '接入操作过于频繁，请稍后再试' };
    }
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
    let dnsProvider: any = null;
    const dnsAcct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
    if (dnsAcct) {
      dnsProvider = getDnsProvider(dnsAcct.type, await accountConfigOf(dnsAcct), dnsDomain.name, dnsDomain.thirdid);
      if (dnsProvider) {
        const recordId = await dnsProvider.addDomainRecord(recordName, 'CNAME', cname, undefined, 600);
        if (recordId) dnsRecord = String(recordId);
        else dnsError = dnsProvider.getError();
      } else dnsError = 'DNS模块不存在';
    } else dnsError = 'DNS账户不存在';

    let insertRes: any;
    try {
      insertRes = await query(
        `INSERT INTO ${table('cdn_domain')} (aid, did, name, route, zone_id, origin, origin_type, origin_host, origin_protocol, http_port, https_port, service_area, cname, dns_record, status, cert_mode, addtime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, NOW())`,
        [aid, did, name, acct.type, zone_id || null, origin, origin_type || 'ipaddr', originHost, originProtocol, httpPort, httpsPort, service_area || 'mainland_china', cname, dnsRecord, certMode === 'none' ? null : certMode],
      );
    } catch (e: any) {
      // 云端加速域名和 CNAME 已经创建，本地写库失败必须补偿删除，否则重试会再建一份。
      await provider.deleteDomain(name).catch(() => undefined);
      if (dnsProvider && dnsRecord) await dnsProvider.deleteDomainRecord(dnsRecord).catch(() => undefined);
      return { code: -1, msg: '保存加速域名失败，已回滚云端资源：' + (e?.message || String(e)) };
    }
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
      // 先做证书联动预检：无权限的订单应在删除云端域名之前就阻止，避免云端已删而本地无法清理。
      try {
        await assertCertOrdersRemovable(Number(id), req.user);
      } catch (e: any) {
        return { code: -1, msg: e?.message || '存在无权处理的联动证书' };
      }
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
    // 下发的必须是校验/归一化后的列表：旧实现校验 normalized 却把原始 ruleList 发给厂商，
    // 可以写出「本地没有记录、云端却生效」的整站 TTL 规则（例如 path 为空但 ttl 极大）。
    if (!(await provider.setCacheRules(row.name, normalized))) return { code: -1, msg: '缓存规则更新失败，' + provider.getError() };
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
      summary: `修改缓存配置 ${row.name}（${normalized.length} 条规则）`,
      detail: { rules: normalized.slice(0, 20) },
    });
    return { code: 0, msg: '缓存规则更新成功' };
  });

  // HTTPS
  app.post('/api/cdn/domains/:id/https', authCdnDomain, async (req: any) => {
    const { id } = req.params as any;
    const { https_enabled, force_redirect } = req.body || {};
    const toBool = (v: any) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
    const httpsOn = toBool(https_enabled);
    const forceOn = toBool(force_redirect);
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.setHttps(row.name, httpsOn, forceOn))) return { code: -1, msg: 'HTTPS 配置更新失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_domain')} SET https_enabled = ?, force_redirect = ? WHERE id = ?`, [httpsOn ? 1 : 0, forceOn ? 1 : 0, id]);
    audit(req, {
      targetType: 'cdn_domain',
      targetId: id,
      targetName: String(row.name),
      summary: `修改 HTTPS 配置 ${row.name}`,
      changes: diffFields(
        { https_enabled: row.https_enabled, force_redirect: row.force_redirect },
        { https_enabled: httpsOn ? 1 : 0, force_redirect: forceOn ? 1 : 0 },
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
    const norm = (v: any) => String(v ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^"|"$/g, '');
    // 幂等：pending 期间反复点“检查”会重复调用本函数；已存在同值同类型记录时不再新增。
    if (typeof (dns as any).getDomainRecords === 'function') {
      const existing: any = await Promise.resolve()
        .then(() => (dns as any).getDomainRecords(1, 500, name, null, rec.value, rec.type))
        .catch(() => null);
      const list: any[] = Array.isArray(existing?.list) ? existing.list : [];
      const hit = list.some(
        (item: any) =>
          norm(item?.Value ?? item?.value) === norm(rec.value) &&
          String(item?.Type ?? item?.type ?? '').toUpperCase() === String(rec.type).toUpperCase() &&
          (norm(item?.Name ?? item?.name) === norm(name) ||
            norm(item?.Name ?? item?.name).endsWith('.' + norm(name)) ||
            norm(item?.Name ?? item?.name).endsWith('.' + norm(rel))),
      );
      if (hit) return `验证解析已存在 ${name} ${rec.type} ${rec.value}`;
    }
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
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'certapply', r.order_id ? [Number(r.order_id)] : []);
    return { code: 0, msg: summarizeResults(data, '待签发'), data };
  });

  // 检查通配符证书签发结果，已签发则直传 ESA 站点
  app.post('/api/cdn/domains/cert/check', adminAuth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要检查的加速域名' };
    const data = await runCertLink(ids, true, req.user);
    for (const r of data) if (r.status !== 'failed') await setCertMode(Number(r.id), 'certapply', r.order_id ? [Number(r.order_id)] : []);
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
      // 记录联动，续签后仍自动更新；合并而不是覆盖，避免切断该证书与此前 CDN 域名的联动。
      await linkOrderToCdnDomain(orderId, domainId);
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

  // 查找该加速域名已绑定的联动证书订单（link 可能包含多个 cdnDomainIds）
  async function findLinkedOrder(did: number): Promise<any | null> {
    const candidates = await query(
      `SELECT id, status, error, expiretime, link FROM ${table('cert_order')} WHERE link IS NOT NULL AND link LIKE ? ORDER BY id DESC LIMIT 200`,
      ['%"cdnDomainId"%'],
    );
    for (const r of candidates as any[]) {
      if (cdnLinkIds(r.link).includes(Number(did))) return r;
    }
    return null;
  }

  /** 停用该加速域名关联的证书自动部署任务（不修改 cdn_domain.cert_mode） */
  async function deactivateCertDeployForDomain(did: number, keepOids: number[] = []): Promise<void> {
    const linked = await findLinkedOrder(did);
    const keep = keepOids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const keepSql = keep.length ? ` AND oid NOT IN (${keep.map(() => '?').join(',')})` : '';
    await query(
      `UPDATE ${table('cert_deploy')} SET active = 0
        WHERE (oid IN (SELECT oid FROM ${table('cert_link_log')} WHERE did = ?)
           OR oid = ?)${keepSql}`,
      [did, Number(linked?.id || 0), ...keep],
    );
  }

  // 记录/切换证书管理方式：切换离开「由本项目管理」时停用其联动部署任务，切回时重新启用
  async function setCertMode(did: number, mode: string, keepOids: number[] = []): Promise<void> {
    const normalized = ['freecert', 'certapply', 'certlink'].includes(mode) ? mode : null;
    const cur: any = await queryOne(`SELECT cert_mode FROM ${table('cdn_domain')} WHERE id = ?`, [did]);
    const previous = String(cur?.cert_mode || '');
    // 显式关闭写空串而不是 NULL，列表才能区分「从未配置」与「用户主动关闭」
    const stored = normalized ?? '';
    await query(`UPDATE ${table('cdn_domain')} SET cert_mode = ? WHERE id = ?`, [stored, did]);
    if (normalized === 'certlink') {
      // 启用：优先使用带 link 的最新订单；旧数据没有 link 时回退到联动日志里最新的 oid。
      const linked = await findLinkedOrder(did);
      const fallback: any = linked
        ? null
        : (await query(`SELECT oid FROM ${table('cert_link_log')} WHERE did = ? ORDER BY id DESC LIMIT 1`, [did]))[0];
      const oid = Number(linked?.id || fallback?.oid || 0);
      if (oid) await query(`UPDATE ${table('cert_deploy')} SET active = 1 WHERE oid = ?`, [oid]);
      return;
    }
    // 只有真正从「证书联动」切换到其他模式时才需要停用旧任务。
    // certapply 申请成功后也会调用本函数，此时刚创建的部署任务尚未签发，绝不能被误停。
    if (previous !== 'certlink') return;
    await deactivateCertDeployForDomain(did, keepOids);
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
    const logs: any[] = await query(
      `SELECT node, status, message, addtime FROM ${table('cert_link_log')} WHERE did = ? ORDER BY id DESC LIMIT 200`,
      [did],
    );
    logs.reverse(); // 取最近 200 条后恢复时间顺序，避免只看到最早的日志
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
      // 区间上限：buildTimeline 会按区间生成标签，1970→now 一次就能产出两万多个标签把内存打满
      if (end.getTime() - start.getTime() > MAX_STAT_RANGE_MS) return { code: -1, msg: '统计区间最长 31 天' };
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
    const rowsByName = new Map<string, any[]>();
    for (const r of rows as any[]) {
      const key = String(r.name);
      const list = rowsByName.get(key) || [];
      list.push(r);
      rowsByName.set(key, list);
    }
    const visibleCache = new Map<number, boolean>();

    for (const url of urls) {
      const domain = domainFromUrl(url);
      if (!domain) {
        failed.push({ url, msg: 'URL 格式错误' });
        continue;
      }
      const candidates = (rowsByName.get(domain) || []).filter((r) => Number(r?.id) > 0);
      const visible: any[] = [];
      for (const candidate of candidates) {
        const aid = Number(candidate.aid);
        if (!visibleCache.has(aid)) {
          visibleCache.set(aid, !!(await getVisibleAccount('cdn_account', aid, user)));
        }
        if (visibleCache.get(aid)) visible.push(candidate);
      }
      if (!visible.length) {
        failed.push({ url, msg: `未找到加速域名 ${domain}` });
        continue;
      }
      // 同名加速域名可能存在于多个账户（唯一键是 aid+name）；没有账户上下文时
      // 直接失败比随机挑一个更安全，避免把刷新/预热打到错误的厂商站点。
      if (visible.length > 1) {
        failed.push({ url, msg: `加速域名 ${domain} 存在于多个账户，请在对应账户的域名详情中操作` });
        continue;
      }
      const row: any = visible[0];
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
  const perms = user && !checkLevel(user, 2) ? await getEffectivePermissions(user) : null;

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