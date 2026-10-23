import { localResolve } from './localResolve.js';

const CLOUDFLARE_V4_RANGES = [
  ['173.245.48.0', 20],
  ['103.21.244.0', 22],
  ['103.22.200.0', 22],
  ['103.31.4.0', 22],
  ['141.101.64.0', 18],
  ['108.162.192.0', 18],
  ['190.93.240.0', 20],
  ['188.114.96.0', 20],
  ['197.234.240.0', 22],
  ['198.41.128.0', 17],
  ['162.158.0.0', 15],
  ['104.16.0.0', 13],
  ['104.24.0.0', 14],
  ['172.64.0.0', 13],
  ['131.0.72.0', 22],
] as const;

const CLOUDFLARE_V6_RANGES = [
  ['2400:cb00::', 32],
  ['2606:4700::', 32],
  ['2803:f800::', 32],
  ['2405:b500::', 32],
  ['2405:8100::', 32],
  ['2a06:98c0::', 29],
  ['2c0f:f248::', 32],
] as const;

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function v6ToBigInt(ip: string): bigint | null {
  const raw = ip.toLowerCase().split('%')[0];
  if (!raw.includes(':')) return null;
  const halves = raw.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (value: string): number[] | null => {
    if (!value) return [];
    const out: number[] = [];
    for (const part of value.split(':')) {
      if (part.includes('.')) {
        const v4 = v4ToInt(part);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        out.push(parseInt(part, 16));
      }
    }
    return out;
  };
  const left = parseGroups(halves[0]);
  const right = parseGroups(halves.length === 2 ? halves[1] : '');
  if (!left || !right) return null;
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill(0), ...right];
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

const V4_MATCHERS = CLOUDFLARE_V4_RANGES.map(([base, bits]) => {
  const baseInt = v4ToInt(base) as number;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return { base: (baseInt & mask) >>> 0, mask };
});

const V6_MATCHERS = CLOUDFLARE_V6_RANGES.map(([base, bits]) => {
  const baseInt = v6ToBigInt(base) as bigint;
  return { base: baseInt, shift: BigInt(128 - bits) };
});

export function isCloudflareIp(ip: string): boolean {
  const value = String(ip ?? '').trim().toLowerCase();
  if (!value) return false;
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isCloudflareIp(mapped[1]);
  if (value.includes(':')) {
    const n = v6ToBigInt(value);
    if (n === null) return false;
    return V6_MATCHERS.some((r) => (n >> r.shift) === (r.base >> r.shift));
  }
  const n = v4ToInt(value);
  if (n === null) return false;
  return V4_MATCHERS.some((r) => ((n & r.mask) >>> 0) === r.base);
}

export function isCloudflareProxyValues(values: string[]): boolean {
  const list = (values || []).map((v) => String(v ?? '').trim()).filter(Boolean);
  return list.length > 0 && list.every(isCloudflareIp);
}

export async function detectCloudflareProxy(
  fullDomain: string,
  type: string,
  actual: string[],
): Promise<{ proxied: boolean; actual: string[] }> {
  const recordType = String(type ?? '').toUpperCase();
  if (recordType !== 'A' && recordType !== 'AAAA' && recordType !== 'CNAME') {
    return { proxied: false, actual };
  }
  if (isCloudflareProxyValues(actual)) return { proxied: true, actual };
  if (recordType === 'CNAME') {
    const [v4, v6] = await Promise.all([localResolve(fullDomain, 'A'), localResolve(fullDomain, 'AAAA')]);
    const ips = [...v4, ...v6];
    if (isCloudflareProxyValues(ips)) return { proxied: true, actual: ips };
  }
  return { proxied: false, actual };
}
