// 轻量进程内滑动窗口限流：用于低频高成本操作（备份导入/导出、DNS 检测手动执行）。
// 不替代 security.ts 的请求级限流，只做业务维度的额外约束。
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