import { query, queryOne, table } from '../../db.js';
import { checkLevel } from '../../auth.js';

export type AccountTable = 'account' | 'cdn_account' | 'cert_account';

/**
 * 用户直传 aid 的入口必须走可见性校验：
 * - private：仅所有者可见
 * - shared：仅管理员可见
 * 越权一律返回 null（路由层统一 404，避免泄露存在性）
 */
export async function getVisibleAccount(t: AccountTable, aid: number, user: any): Promise<any | null> {
  if (!Number.isFinite(aid) || aid <= 0) return null;
  const row: any = await queryOne(`SELECT * FROM ${table(t)} WHERE id = ?`, [aid]);
  if (!row) return null;
  if (row.visibility === 'private') {
    return Number(row.owner_uid) === Number(user?.uid) ? row : null;
  }
  return checkLevel(user, 2) ? row : null;
}

/** 证书订单越权守卫：订单归属账户对当前用户不可见时按不存在处理 */
export async function canAccessCertOrder(orderId: number, user: any): Promise<boolean> {
  const row: any = await queryOne(`SELECT aid FROM ${table('cert_order')} WHERE id = ?`, [Number(orderId)]);
  if (!row) return false;
  // aid=0 为手工上传证书，缺少上传者字段，按站点资产仅管理员可读
  if (!Number(row.aid)) return checkLevel(user, 2);
  return !!(await getVisibleAccount('cert_account', Number(row.aid), user));
}

/** 域名是否可以由该用户操作：私有账户仅所有者，共享账户沿用域名授权 */
export async function canAccessDomainAccount(domainId: number, user: any): Promise<boolean> {
  const row: any = await queryOne(
    `SELECT A.visibility, A.owner_uid FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id WHERE D.id = ?`,
    [Number(domainId)],
  );
  if (!row) return false;
  return row.visibility !== 'private' || Number(row.owner_uid) === Number(user?.uid);
}

/** 列表：管理员看共享 + 自己的私有；普通用户只看自己的私有 */
export async function listVisibleAccounts(t: AccountTable, user: any): Promise<any[]> {
  if (checkLevel(user, 2)) {
    return query(
      `SELECT * FROM ${table(t)}
       WHERE visibility = 'shared' OR (visibility = 'private' AND owner_uid = ?)
       ORDER BY id DESC`,
      [user.uid],
    );
  }
  return query(`SELECT * FROM ${table(t)} WHERE visibility = 'private' AND owner_uid = ? ORDER BY id DESC`, [user.uid]);
}

/** 他人私有账户在列表里只显示占位名，绝不回显用户起的名称 */
export function maskAccountLabel(row: any, viewer: any): string {
  if (!row) return '—';
  if (row.visibility === 'private' && Number(row.owner_uid) !== Number(viewer?.uid)) return '个人账户';
  return String(row.name || '—');
}
