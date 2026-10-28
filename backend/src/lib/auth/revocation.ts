import { query, queryOne, table } from '../../db.js';

/**
 * 单会话令牌吊销表。
 * - 登出时写入当前 jti，未过期的令牌立即失效；
 * - 记录 5 秒缓存，避免每个请求都查库；
 * - 过期记录在写入新吊销项时顺带清理。
 */
const CACHE_TTL_MS = 5000;
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
  const exp = expireAt && expireAt.getTime() > Date.now() ? expireAt : new Date(Date.now() + 7 * 86400_000);
  await query(
    `INSERT INTO ${table('token_revocation')} (jti, uid, expire_at, addtime) VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE expire_at = VALUES(expire_at)`,
    [id, uid, exp],
  );
  cache.set(id, { revoked: true, at: Date.now() });
  prune();
  // 顺带清理过期记录，避免表无限增长
  await query(`DELETE FROM ${table('token_revocation')} WHERE expire_at < NOW()`).catch(() => undefined);
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  const id = String(jti || '').trim();
  if (!id) return false;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.revoked;
  const row = await queryOne(`SELECT jti FROM ${table('token_revocation')} WHERE jti = ? LIMIT 1`, [id]).catch(() => undefined);
  const revoked = !!row;
  cache.set(id, { revoked, at: Date.now() });
  prune();
  return revoked;
}
