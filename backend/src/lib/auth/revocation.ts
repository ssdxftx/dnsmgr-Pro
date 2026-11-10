import { query, queryOne, table } from '../../db.js';

/**
 * 单会话令牌吊销表。
 * - 登出时写入当前 jti，未过期的令牌立即失效；
 * - 记录 1 秒负缓存，避免每个请求都查库，同时把跨实例登出窗口压到最小；
 * - 过期记录在写入新吊销项时顺带清理。
 */
const CACHE_TTL_MS = 1000;
const cache = new Map<string, { revoked: boolean; at: number }>();

function prune(): void {
  if (cache.size <= 5000) return;
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > CACHE_TTL_MS) cache.delete(k);
  while (cache.size > 5000) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export async function revokeToken(jti: string, uid: number, expireAt?: Date): Promise<void> {
  const id = String(jti || '').trim();
  if (!id) return;
  // token_revocation.uid 是 unsigned：快捷登录会话的 uid = -did，直接写入会触发
  // MySQL 严格模式 1264 导致登出 500。吊销本身按 jti 生效，uid 只是附加信息，归零即可。
  const owner = Number(uid) > 0 ? Number(uid) : 0;
  // 调用方应传入令牌实际 exp；兜底保留 30 天，避免自定义长 TTL 令牌的吊销记录提前被清理
  const exp = expireAt && expireAt.getTime() > Date.now() ? expireAt : new Date(Date.now() + 30 * 86400_000);
  await query(
    `INSERT INTO ${table('token_revocation')} (jti, uid, expire_at, addtime) VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE expire_at = VALUES(expire_at)`,
    [id, owner, exp],
  );
  cache.set(id, { revoked: true, at: Date.now() });
  prune();
  // 顺带清理过期记录，避免表无限增长
  await query(`DELETE FROM ${table('token_revocation')} WHERE expire_at < NOW()`).catch(() => undefined);
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  const id = String(jti || '').trim();
  // 缺少 jti 的旧令牌无法被精确吊销，按已吊销处理（fail-closed）。
  if (!id) return true;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.revoked;
  let row: any;
  try {
    row = await queryOne(`SELECT jti FROM ${table('token_revocation')} WHERE jti = ? LIMIT 1`, [id]);
  } catch (e: any) {
    // 吊销表不可用时不能放行：否则已登出令牌在数据库抖动期间可继续使用。
    console.error('[auth] 吊销状态查询失败，按已吊销处理:', e?.message || e);
    return true;
  }
  const revoked = !!row;
  cache.set(id, { revoked, at: Date.now() });
  prune();
  return revoked;
}
