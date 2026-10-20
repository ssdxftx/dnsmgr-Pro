import type { MetricGroup, MetricUnit } from './catalog/types.js';

export const ALL_GROUPS: MetricGroup[] = [
  'overview',
  'traffic',
  'bandwidth',
  'request',
  'cache',
  'origin',
  'status',
  'performance',
  'top',
];

export function parseGroups(value: any, allowed: MetricGroup[]): Set<MetricGroup> {
  if (value === undefined || value === null || String(value).trim() === '') return new Set(allowed);
  const wanted = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is MetricGroup => (ALL_GROUPS as string[]).includes(s));
  const set = new Set(wanted.filter((g) => allowed.includes(g)));
  return set.size ? set : new Set(allowed);
}

export function parseFilters(
  value: any,
  allowed: string[],
): Record<string, string[]> {
  if (value === undefined || value === null || String(value).trim() === '') return {};
  let parsed: any;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (!allowed.includes(key)) continue;
    const list = Array.isArray(raw) ? raw : [raw];
    const values = list
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0 && v.length <= 100)
      .slice(0, 20);
    if (values.length) out[key] = values;
  }
  return out;
}

export function parseTop(value: any, allowed: string[]): string[] {
  if (value === undefined || value === null || String(value).trim() === '') return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => allowed.includes(s))
    .slice(0, 12);
}

export const BASIC_KEYS = ['flux', 'bw', 'bs_flux', 'req', 'hit_rate'] as const;

export function basicUnit(key: string): MetricUnit {
  if (key === 'flux' || key === 'bs_flux') return 'byte';
  if (key === 'bw') return 'bps';
  if (key === 'req') return 'count';
  return 'percent';
}
