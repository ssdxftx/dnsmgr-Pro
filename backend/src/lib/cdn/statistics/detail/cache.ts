import type { DetailResponse } from '../catalog/result.js';

const cache = new Map<string, { at: number; data: DetailResponse }>();
const TTL_MS = 120_000;

export function getCachedDetail(key: string): DetailResponse | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

export function setCachedDetail(key: string, data: DetailResponse): void {
  cache.set(key, { at: Date.now(), data });
}

export function clearDetailCache(): void {
  cache.clear();
}
