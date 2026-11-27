// 轻量进程内滑动窗口限流：用于低频高成本操作（备份导入/导出、DNS 检测手动执行）。
// 不替代 security.ts 的请求级限流，只做业务维度的额外约束。
import { query, table } from '../db.js';

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 20_000;
let lastSweep = 0;

// 分布式限流的进程内镜像：按数据库相同的固定窗口计数，避免滑窗语义让客户端在窗口切换后继续被拦。
const distBuckets = new Map<string, { window: number; count: number }>();
let lastDistSweep = 0;

function allowDistributedLocal(key: string, max: number, windowStart: number): boolean {
  const now = Date.now();
  if (now - lastDistSweep > 60_000) {
    const stale = windowStart - 600_000;
    for (const [k, v] of distBuckets) {
      if (v.window < stale) distBuckets.delete(k);
    }
    lastDistSweep = now;
  }
  let rec = distBuckets.get(key);
  if (!rec || rec.window !== windowStart) {
    if (!rec && distBuckets.size >= MAX_BUCKETS) {
      const stale = windowStart - 600_000;
      for (const [k, v] of distBuckets) {
        if (v.window < stale) distBuckets.delete(k);
      }
      // 容量仍满时跳过本地镜像，数据库计数仍是准绳
      if (distBuckets.size >= MAX_BUCKETS) return true;
    }
    rec = { window: windowStart, count: 0 };
    distBuckets.set(key, rec);
  }
  if (rec.count >= max) return false;
  rec.count++;
  return true;
}

export function hitRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, arr] of buckets) {
      if (!arr.length || arr[arr.length - 1] <= now - windowMs) buckets.delete(k);
    }
    lastSweep = now;
  }
  let bucketKey = key;
  let arr = buckets.get(bucketKey);
  if (!arr) {
    if (buckets.size >= MAX_BUCKETS) {
      // 只清理过期桶；容量仍满时新 key 降级到共享溢出桶，避免挤掉未过期桶
      for (const [k, v] of buckets) {
        if (!v.length || v[v.length - 1] <= now - windowMs) buckets.delete(k);
      }
      if (buckets.size >= MAX_BUCKETS) {
        bucketKey = '\u0000overflow';
        arr = buckets.get(bucketKey);
      }
    }
    if (!arr) {
      arr = [];
      buckets.set(bucketKey, arr);
    }
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
  // 进程内预检：同一固定窗口内本地计数达到上限时，全局计数必然也已达到，直接拒绝省掉一次写库。
  // 预检同时记录本次命中，数据库不可用时天然回退到进程内限流。
  if (!allowDistributedLocal(key, max, windowStart)) return false;
  try {
    // 单条原子 upsert：窗口切换与计数在同一行完成，避免「删除当前窗口计数」的竞态。
    await query(
      `INSERT INTO ${table('rate_limit')} (bucket, window_start, hits) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE
         hits = CASE WHEN window_start = VALUES(window_start) THEN hits + 1 ELSE 1 END,
         window_start = VALUES(window_start)`,
      [key, windowStart],
    );
    const rows: any = await query(`SELECT hits FROM ${table('rate_limit')} WHERE bucket = ?`, [key]);
    if (Math.random() < 0.01) {
      await query(`DELETE FROM ${table('rate_limit')} WHERE window_start < ?`, [now - windowMs * 10]).catch(() => undefined);
    }
    return Number(rows?.[0]?.hits || 0) <= max;
  } catch {
    // 预检已经计数：数据库异常时由进程内固定窗口继续限流，不再重复计数。
    return true;
  }
}
