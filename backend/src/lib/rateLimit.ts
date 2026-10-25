// 轻量进程内滑动窗口限流：用于低频高成本操作（备份导入/导出、DNS 检测手动执行）。
// 不替代 security.ts 的请求级限流，只做业务维度的额外约束。
import { query, table } from '../db.js';

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 20_000;
let lastSweep = 0;

export function hitRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, arr] of buckets) {
      if (!arr.length || arr[arr.length - 1] <= now - windowMs) buckets.delete(k);
    }
    lastSweep = now;
  }
  let arr = buckets.get(key);
  if (!arr) {
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    arr = [];
    buckets.set(key, arr);
  }
  const cutoff = now - windowMs;
  while (arr.length && arr[0] <= cutoff) arr.shift();
  if (arr.length >= max) return false;
  arr.push(now);
  return true;
}

/**
 * 跨实例限流：多副本共用 rate_limit 表。表不可用时回退到进程内滑窗，
 * 保证限流不是单实例的软约束。
 */
export async function hitRateLimitDistributed(key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  try {
    const res: any = await query(
      `UPDATE ${table('rate_limit')} SET hits = hits + 1 WHERE bucket = ? AND window_start = ?`,
      [key, windowStart],
    );
    if (!Number(res?.affectedRows || 0)) {
      // 旧窗口先删除，再插入新窗口；并发插入冲突时改为对新窗口自增
      await query(`DELETE FROM ${table('rate_limit')} WHERE bucket = ? AND window_start <> ?`, [key, windowStart]).catch(() => undefined);
      try {
        await query(`INSERT INTO ${table('rate_limit')} (bucket, window_start, hits) VALUES (?, ?, 1)`, [key, windowStart]);
      } catch {
        await query(
          `UPDATE ${table('rate_limit')} SET hits = hits + 1 WHERE bucket = ? AND window_start = ?`,
          [key, windowStart],
        );
      }
    }
    const rows: any = await query(`SELECT hits FROM ${table('rate_limit')} WHERE bucket = ?`, [key]);
    if (Math.random() < 0.01) {
      await query(`DELETE FROM ${table('rate_limit')} WHERE window_start < ?`, [now - windowMs * 10]).catch(() => undefined);
    }
    return Number(rows?.[0]?.hits || 0) <= max;
  } catch {
    return hitRateLimit(key, max, windowMs);
  }
}
