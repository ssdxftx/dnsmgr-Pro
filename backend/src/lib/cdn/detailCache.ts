import { createHash } from 'node:crypto';

/** CDN 列表补详情用的短 TTL 缓存：同一账户短时间反复刷新列表时不再逐域名重发请求 */
const store = new Map<string, { at: number; value: any }>();
const inflight = new Map<string, Promise<any>>();
const MAX_ENTRIES = 5000;

export function credentialCacheId(...values: any[]): string {
  const parts = values.map((v) => String(v ?? '').trim());
  if (parts.some((v) => !v)) return '';
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 24);
}

export async function cachedDetail<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (!key) return fn();
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const running = inflight.get(key);
  if (running) return running;
  const task = fn()
    .then((value) => {
      // 失败结果不缓存，避免一次上游抖动让列表在 TTL 内持续不可用
      if (value !== false && value !== null && value !== undefined) {
        if (store.size >= MAX_ENTRIES) store.clear();
        store.set(key, { at: Date.now(), value });
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
