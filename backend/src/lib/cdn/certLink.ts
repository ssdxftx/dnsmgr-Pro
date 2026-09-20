import { domainToASCII } from 'node:url';
import { query, queryOne, table } from '../../db.js';
import { certConfig } from '../cert/factory.js';
import { getCdnProvider } from './factory.js';
import type { CertDeployPlan } from './types.js';

// 允许注入连接，便于测试
type QueryFn = (sql: string, params?: any[]) => Promise<any>;

import { decryptConfig, encryptConfig } from '../secret.js';

function safeJson(s: any): Record<string, any> {
  return decryptConfig(s) || {};
}

// 证书联动阶段：order=证书订单、issue=签发、account=部署账户、task=部署任务、deploy=部署到 CDN
export type LinkNode = 'order' | 'issue' | 'account' | 'task' | 'deploy';
export type LinkStatus = 'doing' | 'ok' | 'fail';

// 记录联动执行阶段，供前端实时查看；日志写入失败不影响主流程
export async function linkLog(
  did: number,
  oid: number,
  node: LinkNode,
  status: LinkStatus,
  message: string,
  q: QueryFn = query,
): Promise<void> {
  try {
    await q(`INSERT INTO ${table('cert_link_log')} (did, oid, node, status, message, addtime) VALUES (?, ?, ?, ?, ?, NOW())`, [
      Number(did || 0),
      Number(oid || 0),
      node,
      status,
      String(message || '').slice(0, 500),
    ]);
  } catch {
    // 忽略日志写入错误
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
  if (existing) {
    // 复用已有订单时也要补写联动信息，否则签发成功后不会创建部署任务
    if (link && existing.link !== link) {
      await q(`UPDATE ${table('cert_order')} SET link = ? WHERE id = ?`, [link, existing.id]);
      existing.link = link;
    }
    return existing;
  }
  return await createOrder(aid, [domain], link, q);
}

// 复用 CDN 账户密钥：按（类型 + 配置）查找或创建自动部署账户
export async function ensureDeployAccount(plan: CertDeployPlan, q: QueryFn = query): Promise<number> {
  const cfg = JSON.stringify(plan.accountConfig || {});
  // 加密存储使用随机 IV，无法按密文比较，改为按类型取出后解密比对
  const rows: any = await q(`SELECT id, config FROM ${table('cert_account')} WHERE type = ? AND deploy = 1`, [plan.accountType]);
  const hit = (rows as any[]).find((r: any) => JSON.stringify(decryptConfig(r.config) || {}) === cfg);
  if (hit?.id) return Number(hit.id);
  const res: any = await q(
    `INSERT INTO ${table('cert_account')} (type, name, config, remark, deploy, addtime) VALUES (?, ?, ?, ?, 1, NOW())`,
    [plan.accountType, plan.accountName || 'CDN 证书联动（' + plan.accountType + '）', encryptConfig(plan.accountConfig || {}), '由 CDN 证书联动自动创建'],
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
  const rows: any = await q(`SELECT id, active, config FROM ${table('cert_deploy')} WHERE aid = ? AND oid = ?`, [aid, oid]);
  // 加密存储使用随机 IV，需解密后比较配置
  const hit = (rows as any[]).find((r: any) => JSON.stringify(decryptConfig(r.config) || {}) === cfg);
  if (hit?.id) {
    if (!hit.active) await q(`UPDATE ${table('cert_deploy')} SET active = 1 WHERE id = ?`, [hit.id]);
    return { taskId: Number(hit.id), created: false };
  }
  const res: any = await q(
    `INSERT INTO ${table('cert_deploy')} (aid, oid, config, remark, addtime, status, active) VALUES (?, ?, ?, ?, NOW(), 0, 1)`,
    [aid, oid, encryptConfig(config), 'CDN 证书联动自动部署'],
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
  const did = Number(row?.id || 0);
  if (!provider || typeof provider.getCertDeployPlan !== 'function' || !scope) {
    await linkLog(did, orderId, 'account', 'fail', '该厂商或站点不支持自动部署', q);
    return false;
  }
  let plan: any = false;
  let planErr = '';
  try {
    plan = await provider.getCertDeployPlan(row.name, scope);
  } catch (e: any) {
    plan = false;
    planErr = e?.message || String(e);
  }
  if (!plan?.accountType || !plan?.config) {
    await linkLog(did, orderId, 'account', 'fail', '无法生成部署计划' + (planErr ? '：' + planErr : ''), q);
    return false;
  }
  // 关键：产品类型必须写入任务配置，否则部署时无法识别要上传/绑定到哪个云产品
  const taskConfig = { ...plan.config, product: plan.product };
  const deployAid = await ensureDeployAccount(plan, q);
  if (!deployAid) {
    await linkLog(did, orderId, 'account', 'fail', '创建自动部署账户失败（密钥或配置不完整）', q);
    return false;
  }
  await linkLog(did, orderId, 'account', 'ok', `已准备自动部署账户 #${deployAid}（${plan.accountName || plan.accountType}）`, q);
  const task = await ensureDeployTask(deployAid, orderId, taskConfig, q);
  await linkLog(did, orderId, 'task', 'ok', `${task.created ? '已创建' : '已复用'}自动部署任务 #${task.taskId}，等待部署`, q);
  return task;
}

// 按加速域名 ID 解析厂商与站点作用域，创建自动部署任务（供订单签发成功后回调）
export async function ensureCertDeployForDomain(cdnDomainId: number, orderId: number): Promise<{ taskId: number; created: boolean } | false> {
  const did = Number(cdnDomainId || 0);
  const row = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE id = ?`, [cdnDomainId]);
  if (!row) {
    await linkLog(did, orderId, 'account', 'fail', '加速域名不存在，无法创建部署任务');
    return false;
  }
  const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [row.aid]);
  if (!acct) {
    await linkLog(did, orderId, 'account', 'fail', 'CDN 账户不存在，无法创建部署任务');
    return false;
  }
  const provider: any = getCdnProvider(acct.type, safeJson(acct.config));
  if (!provider || typeof provider.getCertScope !== 'function') {
    await linkLog(did, orderId, 'account', 'fail', '该 CDN 类型不支持证书联动部署');
    return false;
  }
  if (row.zone_id) {
    if (typeof provider.setZoneId === 'function') provider.setZoneId(row.zone_id);
    if (typeof provider.setSiteId === 'function') provider.setSiteId(row.zone_id);
  }
  const scope = await provider.getCertScope(row.name);
  if (!scope) {
    await linkLog(did, orderId, 'account', 'fail', '未找到该域名的加速站点（Zone/Site），请先在控制台创建');
    return false;
  }
  await linkLog(did, orderId, 'account', 'ok', `已定位加速站点 ${scope.siteName || scope.siteId}`);
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
  await linkLog(Number(link.cdnDomainId), orderId, 'issue', 'ok', '证书已签发，开始创建 CDN 自动部署任务');
  await ensureCertDeployForDomain(Number(link.cdnDomainId), orderId);
}

// 证书订单处理失败时写入联动阶段日志（仅针对带 CDN 联动的订单，成功由 processOrderLink 记录）
export async function logOrderFailure(orderId: number, error?: string): Promise<void> {
  const order = await queryOne(`SELECT link FROM ${table('cert_order')} WHERE id = ?`, [orderId]);
  if (!order?.link) return;
  let link: any;
  try {
    link = JSON.parse(order.link);
  } catch {
    return;
  }
  if (!link?.cdnDomainId) return;
  await linkLog(Number(link.cdnDomainId), orderId, 'issue', 'fail', '证书签发失败：' + (error || '未知错误'));
}

// 部署任务执行完成后，把结果写入联动阶段日志（仅针对带 CDN 联动的订单）
export async function logDeployResult(taskId: number, status: number, error?: string): Promise<void> {
  const task = await queryOne(`SELECT oid FROM ${table('cert_deploy')} WHERE id = ?`, [taskId]);
  const oid = Number(task?.oid || 0);
  if (!oid) return;
  const order = await queryOne(`SELECT link FROM ${table('cert_order')} WHERE id = ?`, [oid]);
  if (!order?.link) return;
  let link: any;
  try {
    link = JSON.parse(order.link);
  } catch {
    return;
  }
  if (!link?.cdnDomainId) return;
  const did = Number(link.cdnDomainId);
  if (status === 1) {
    await linkLog(did, oid, 'deploy', 'ok', '证书已上传并绑定到 CDN 加速域名，部署完成');
    await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [did]);
  } else if (status < 0) {
    await linkLog(did, oid, 'deploy', 'fail', '部署失败：' + (error || '未知错误，可在自动部署任务中重试'));
  }
}