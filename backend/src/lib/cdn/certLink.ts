import { domainToASCII } from 'node:url';
import { query, queryOne, table } from '../../db.js';
import { certConfig } from '../cert/factory.js';
import { getCdnProvider } from './factory.js';
import type { CertDeployPlan } from './types.js';

// 允许注入连接，便于测试
type QueryFn = (sql: string, params?: any[]) => Promise<any>;

function safeJson(s: any): Record<string, any> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}

// 解析证书字段的 show 条件（仅支持 key=='value' 形式，其余视为显示）
export function showOk(show: string, config: Record<string, any>): boolean {
  const m = String(show).match(/^\s*(\w+)\s*==\s*'([^']*)'\s*$/);
  if (m) return String(config[m[1]] ?? '') === m[2];
  return true;
}

// 证书提供商是否可用：类型存在且必填密钥已配置
export function providerReady(type: string, config: Record<string, any>): boolean {
  const meta = certConfig[type];
  if (!meta) return false;
  for (const [key, f] of Object.entries<any>(meta.inputs || {})) {
    if (!f?.required) continue;
    if (f.show && !showOk(f.show, config)) continue;
    if (!config[key]) return false;
  }
  return true;
}

export const DEFAULT_LE_EMAIL = 'ssdxftx@gmail.com';

// 查找或创建默认 Let's Encrypt 账户（固定邮箱）
export async function ensureDefaultLetsEncrypt(q: QueryFn = query): Promise<number> {
  const rows: any = await q(`SELECT id, config FROM ${table('cert_account')} WHERE type = 'letsencrypt' AND deploy = 0`);
  for (const r of rows as any[]) {
    if (safeJson(r.config).email === DEFAULT_LE_EMAIL) return Number(r.id);
  }
  const res: any = await q(
    `INSERT INTO ${table('cert_account')} (type, name, config, remark, deploy, addtime) VALUES ('letsencrypt', ?, ?, ?, 0, NOW())`,
    ["默认Let's Encrypt", JSON.stringify({ email: DEFAULT_LE_EMAIL, mode: 'live', proxy: '0' }), '由 CDN 证书联动自动创建'],
  );
  return Number(res?.insertId || 0);
}

// 解析可用的证书账户：指定账户不可用（不存在/密钥不全/不支持泛域名）时回退默认 Let's Encrypt
export async function resolveCertAccount(
  configuredAid: number,
  opts: { requireWildcard?: boolean } = {},
  q: QueryFn = query,
): Promise<{ aid: number; account: any; usingDefault: boolean }> {
  const pick = async (id: number): Promise<any> => {
    if (!id) return null;
    const rows: any = await q(`SELECT * FROM ${table('cert_account')} WHERE id = ? AND deploy = 0 LIMIT 1`, [id]);
    return rows[0] || null;
  };
  const usable = (a: any): boolean =>
    !!a && providerReady(a.type, safeJson(a.config)) && (!opts.requireWildcard || !!certConfig[a.type]?.wildcard);
  const configured = await pick(configuredAid);
  if (usable(configured)) return { aid: Number(configured.id), account: configured, usingDefault: false };
  const aid = await ensureDefaultLetsEncrypt(q);
  return { aid, account: await pick(aid), usingDefault: true };
}

// 精确匹配的已签发证书：绑定域名恰好包含目标子域名（通配符不参与精确匹配）
export async function findExactCertOrders(name: string, q: QueryFn = query): Promise<any[]> {
  const need = domainToASCII(name.toLowerCase());
  const rows = await q(
    `SELECT O.id AS oid, O.issuer, O.expiretime, GROUP_CONCAT(D.domain ORDER BY D.sort SEPARATOR ',') AS doms
       FROM ${table('cert_order')} O JOIN ${table('cert_domain')} D ON D.oid = O.id
      WHERE O.status = 3 AND O.expiretime IS NOT NULL AND O.expiretime > NOW()
      GROUP BY O.id
     HAVING SUM(CASE WHEN LOWER(D.domain) = ? THEN 1 ELSE 0 END) > 0
      ORDER BY O.expiretime ASC`,
    [need],
  );
  return (rows as any[]).map((r) => {
    const domains = String(r.doms || '').split(',').filter(Boolean);
    return { oid: Number(r.oid), name: domains[0] || name, issuer: r.issuer || '', expiretime: r.expiretime, domains };
  });
}

// 在指定证书账户下查找绑定域名集合完全一致的订单（避免重复下单）
export async function findOrderByDomains(aid: number, domains: string[], q: QueryFn = query): Promise<any | null> {
  const want = [...domains].sort();
  const rows = await q(
    `SELECT O.*, GROUP_CONCAT(D.domain ORDER BY D.domain SEPARATOR ',') AS doms
       FROM ${table('cert_order')} O JOIN ${table('cert_domain')} D ON D.oid = O.id
      WHERE O.aid = ? AND O.status IN (0, 1, 2, 3)
      GROUP BY O.id`,
    [aid],
  );
  for (const r of rows as any[]) {
    const list = String(r.doms || '').split(',').filter(Boolean).sort();
    if (list.length === want.length && JSON.stringify(list) === JSON.stringify(want)) return r;
  }
  return null;
}

// 新建证书订单并绑定域名（可指定 link 联动信息）
export async function createOrder(aid: number, domains: string[], link: string | null = null, q: QueryFn = query): Promise<any> {
  const res: any = await q(`INSERT INTO ${table('cert_order')} SET ?`, [
    { aid, keytype: 'RSA', keysize: 2048, addtime: new Date(), updatetime: new Date(), issuer: '', status: 0, isauto: 1, retrytime: new Date(), link },
  ]);
  const id = Number(res?.insertId || 0);
  let sort = 1;
  for (const d of domains) {
    await q(`INSERT INTO ${table('cert_domain')} (oid, domain, sort) VALUES (?, ?, ?)`, [id, domainToASCII(d), sort++]);
  }
  const rows: any = await q(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [id]);
  return rows[0];
}

// 站点级通配符订单：存在即复用，不存在则创建，交由证书调度器完成签发
export async function ensureWildcardOrder(aid: number, domains: string[], q: QueryFn = query): Promise<any> {
  const existing = await findOrderByDomains(aid, domains, q);
  if (existing) return existing;
  return await createOrder(aid, domains, null, q);
}

// 精确子域名订单：只绑定目标子域名，不含根域/通配符/额外 SAN
export async function ensureExactOrder(aid: number, domain: string, link: string | null = null, q: QueryFn = query): Promise<any> {
  const existing = await findOrderByDomains(aid, [domain], q);
  if (existing) return existing;
  return await createOrder(aid, [domain], link, q);
}

// 复用 CDN 账户密钥：按（类型 + 配置）查找或创建自动部署账户
export async function ensureDeployAccount(plan: CertDeployPlan, q: QueryFn = query): Promise<number> {
  const cfg = JSON.stringify(plan.accountConfig || {});
  const rows: any = await q(`SELECT id FROM ${table('cert_account')} WHERE type = ? AND config = ? AND deploy = 1 LIMIT 1`, [
    plan.accountType,
    cfg,
  ]);
  if (rows[0]?.id) return Number(rows[0].id);
  const res: any = await q(
    `INSERT INTO ${table('cert_account')} (type, name, config, remark, deploy, addtime) VALUES (?, ?, ?, ?, 1, NOW())`,
    [plan.accountType, plan.accountName || 'CDN 证书联动（' + plan.accountType + '）', cfg, '由 CDN 证书联动自动创建'],
  );
  return Number(res?.insertId || 0);
}

// 按（部署账户 + 证书订单 + 配置）去重创建自动部署任务，保证续签后自动更新
export async function ensureDeployTask(
  aid: number,
  oid: number,
  config: Record<string, any>,
  q: QueryFn = query,
): Promise<{ taskId: number; created: boolean }> {
  const cfg = JSON.stringify(config);
  const rows: any = await q(`SELECT id, active FROM ${table('cert_deploy')} WHERE aid = ? AND oid = ? AND config = ? LIMIT 1`, [
    aid,
    oid,
    cfg,
  ]);
  if (rows[0]?.id) {
    if (!rows[0].active) await q(`UPDATE ${table('cert_deploy')} SET active = 1 WHERE id = ?`, [rows[0].id]);
    return { taskId: Number(rows[0].id), created: false };
  }
  const res: any = await q(
    `INSERT INTO ${table('cert_deploy')} (aid, oid, config, remark, addtime, status, active) VALUES (?, ?, ?, ?, NOW(), 0, 1)`,
    [aid, oid, cfg, 'CDN 证书联动自动部署'],
  );
  return { taskId: Number(res?.insertId || 0), created: true };
}

// 由已构造的 provider + 加速域名行，生成部署计划并创建自动部署任务
export async function ensureCertDeploy(
  provider: any,
  row: any,
  scope: any,
  orderId: number,
  q: QueryFn = query,
): Promise<{ taskId: number; created: boolean } | false> {
  if (!provider || typeof provider.getCertDeployPlan !== 'function' || !scope) return false;
  let plan: any;
  try {
    plan = await provider.getCertDeployPlan(row.name, scope);
  } catch {
    plan = false;
  }
  if (!plan?.accountType || !plan?.config) return false;
  const deployAid = await ensureDeployAccount(plan, q);
  if (!deployAid) return false;
  return await ensureDeployTask(deployAid, orderId, plan.config, q);
}

// 按加速域名 ID 解析厂商与站点作用域，创建自动部署任务（供订单签发成功后回调）
export async function ensureCertDeployForDomain(cdnDomainId: number, orderId: number): Promise<{ taskId: number; created: boolean } | false> {
  const row = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE id = ?`, [cdnDomainId]);
  if (!row) return false;
  const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [row.aid]);
  if (!acct) return false;
  const provider: any = getCdnProvider(acct.type, safeJson(acct.config));
  if (!provider || typeof provider.getCertScope !== 'function') return false;
  if (row.zone_id) {
    if (typeof provider.setZoneId === 'function') provider.setZoneId(row.zone_id);
    if (typeof provider.setSiteId === 'function') provider.setSiteId(row.zone_id);
  }
  const scope = await provider.getCertScope(row.name);
  if (!scope) return false;
  const task = await ensureCertDeploy(provider, row, scope, orderId);
  if (task) await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [row.id]);
  return task;
}

// 订单签发成功后：若订单带 CDN 部署联动标记，自动创建部署任务（失败不创建）
export async function processOrderLink(orderId: number): Promise<void> {
  const order = await queryOne(`SELECT link FROM ${table('cert_order')} WHERE id = ?`, [orderId]);
  if (!order?.link) return;
  let link: any;
  try {
    link = JSON.parse(order.link);
  } catch {
    return;
  }
  if (!link?.cdnDomainId) return;
  await ensureCertDeployForDomain(Number(link.cdnDomainId), orderId);
}