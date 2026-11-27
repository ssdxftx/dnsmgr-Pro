import { getCdnAccountEpoch } from './cacheEpoch.js';

const TTL_MS = 30_000;
const MAX_ENTRIES = 200;
const cache = new Map<number, { at: number; zones: any[] }>();
let epoch = getCdnAccountEpoch();

function syncEpoch(): void {
  const current = getCdnAccountEpoch();
  if (current !== epoch) {
    cache.clear();
    epoch = current;
  }
}

export function getCachedZones(aid: number): any[] | null {
  syncEpoch();
  const hit = cache.get(Number(aid));
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(Number(aid));
    return null;
  }
  return hit.zones;
}

export function setCachedZones(aid: number, zones: any[]): void {
  syncEpoch();
  if (!cache.has(Number(aid)) && cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(Number(aid), { at: Date.now(), zones });
}

export function clearZonesCache(aid?: number): void {
  if (aid === undefined) cache.clear();
  else cache.delete(Number(aid));
}
