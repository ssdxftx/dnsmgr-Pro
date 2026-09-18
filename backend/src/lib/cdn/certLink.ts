import { domainToASCII } from 'node:url';
import { query, table } from '../../db.js';
import type { CertDeployPlan } from './types.js';

// 允许注入连接，便于测试
type QueryFn = (sql: string, params?: any[]) => Promise<any>;

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

// 站点级通配符订单：存在即复用，不存在则创建，交由证书调度器完成签发
export async function ensureWildcardOrder(aid: number, domains: string[], q: QueryFn = query): Promise<any> {
  const existing = await findOrderByDomains(aid, domains, q);
  if (existing) return existing;
  const res: any = await q(`INSERT INTO ${table('cert_order')} SET ?`, [
    { aid, keytype: 'RSA', keysize: 2048, addtime: new Date(), updatetime: new Date(), issuer: '', status: 0, isauto: 1 },
  ]);
  const id = Number(res?.insertId || 0);
  let sort = 1;
  for (const d of domains) {
    await q(`INSERT INTO ${table('cert_domain')} (oid, domain, sort) VALUES (?, ?, ?)`, [id, domainToASCII(d), sort++]);
  }
  const rows: any = await q(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [id]);
  return rows[0];
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