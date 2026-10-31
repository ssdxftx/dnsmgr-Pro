import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

export const API_KEY_MODULES = [
  'auth', 'apikeys', 'dns', 'cdn', 'cert', 'deploy', 'cloudflare', 'monitor',
  'schedule', 'optimize', 'dnscheck', 'expire', 'backup', 'vault', 'users',
  'system', 'audit', 'jobs', 'events', 'general',
] as const;

export type ApiKeyModule = (typeof API_KEY_MODULES)[number];

const MODULE_SET = new Set<string>(API_KEY_MODULES);

export function hashApiKey(key: string): string {
  return createHash('sha256').update(String(key || '')).digest('hex');
}

export function generateApiKey(): string {
  return 'dnsmgr_' + randomBytes(24).toString('base64url');
}

export function apiKeyPrefix(key: string): string {
  return String(key || '').slice(0, 14);
}

export function safeEqualHash(a: string, b: string): boolean {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeScopes(input: any): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : [];
  const out = new Set<string>();
  for (const item of raw) {
    const scope = String(item || '').trim().toLowerCase();
    if (!scope) continue;
    if (scope === '*' || scope === 'read' || scope === 'write') {
      out.add(scope);
      continue;
    }
    const m = /^([a-z0-9_-]+)(?::([a-z*]+))?$/.exec(scope);
    if (!m) throw new Error(`无效的权限范围：${scope}`);
    const mod = m[1];
    const action = m[2] || '*';
    if (!MODULE_SET.has(mod)) throw new Error(`未知模块：${mod}`);
    if (!['read', 'write', '*'].includes(action)) throw new Error(`无效动作：${action}`);
    out.add(`${mod}:${action}`);
  }
  if (!out.size) return ['*'];
  return [...out];
}

export function scopesJson(scopes: string[]): string {
  return JSON.stringify(normalizeScopes(scopes));
}

export function parseScopes(value: any): string[] {
  try {
    if (Array.isArray(value)) return normalizeScopes(value);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return normalizeScopes(parsed);
      } catch {
        return normalizeScopes(value);
      }
    }
  } catch {
    // 存储值损坏时 fail-closed，避免异常作用域退化为全权限。
    return [];
  }
  return [];
}

export function moduleForPath(method: string, rawPath: string): string {
  const path = String(rawPath || '').split('?')[0].toLowerCase();
  const rules: Array<[string, string]> = [
    ['/api/api-keys', 'apikeys'],
    ['/api/auth', 'auth'],
    ['/api/dns-check', 'dnscheck'],
    ['/api/dns', 'dns'],
    ['/api/domains', 'dns'],
    ['/api/records', 'dns'],
    ['/api/cdn', 'cdn'],
    ['/api/preheat', 'cdn'],
    ['/api/cert', 'cert'],
    ['/api/deploy', 'deploy'],
    ['/api/cf-rules', 'cloudflare'],
    ['/api/cloudflare', 'cloudflare'],
    ['/api/dmonitor', 'monitor'],
    ['/api/schedule', 'schedule'],
    ['/api/optimize', 'optimize'],
    ['/api/expire', 'expire'],
    ['/api/backup', 'backup'],
    ['/api/vault', 'vault'],
    ['/api/users', 'users'],
    ['/api/user', 'users'],
    ['/api/logs', 'users'],
    ['/api/register', 'users'],
    ['/api/system', 'system'],
    ['/api/announcements', 'system'],
    ['/api/notifications', 'system'],
    ['/api/metrics', 'system'],
    ['/api/audit', 'audit'],
    ['/api/jobs', 'jobs'],
    ['/api/events', 'events'],
    ['/api/about', 'general'],
    ['/api/dashboard', 'general'],
  ];
  for (const [prefix, mod] of rules) {
    if (path === prefix || path.startsWith(prefix + '/')) return mod;
  }
  return 'general';
}

export function isReadMethod(method: string): boolean {
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

export function scopeAllows(scopes: string[], method: string, path: string): boolean {
  // 空作用域按 fail-closed 处理：只有显式 '*' 才代表全权限。
  const list = scopes;
  if (!list.length) return false;
  if (list.includes('*')) return true;
  const write = !isReadMethod(method);
  if (list.includes(write ? 'write' : 'read')) return true;
  const mod = moduleForPath(method, path);
  for (const scope of list) {
    if (scope === mod || scope === `${mod}:*`) return true;
    if (write && scope === `${mod}:write`) return true;
    if (!write && scope === `${mod}:read`) return true;
  }
  return false;
}

function mappedV4(ip: string): string {
  const s = String(ip || '').replace(/^\[|\]$/g, '');
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  return m ? m[1] : s;
}

export function normalizeIpAllowlist(input: any): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : [];
  const out: string[] = [];
  for (const item of raw) {
    let entry = String(item || '').trim();
    if (!entry) continue;
    if (entry === '*') return [];
    if (entry.includes('/')) {
      const [addr, prefixRaw] = entry.split('/');
      const family = isIP(addr);
      if (!family) throw new Error(`无效的 IP 地址：${addr}`);
      const prefix = Number(prefixRaw);
      const max = family === 4 ? 32 : 128;
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error(`无效的 CIDR 前缀：${entry}`);
      entry = `${addr}/${prefix}`;
    } else if (!isIP(entry)) {
      throw new Error(`无效的 IP 地址：${entry}`);
    }
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

export function ipAllowed(ip: string, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  const raw = mappedV4(ip);
  const family = isIP(raw);
  if (!family) return false;
  const list = new BlockList();
  for (const entry of allowlist) {
    try {
      if (entry.includes('/')) {
        const [addr, prefixRaw] = entry.split('/');
        const f = isIP(addr);
        if (!f) continue;
        list.addSubnet(addr, Number(prefixRaw), f === 4 ? 'ipv4' : 'ipv6');
      } else {
        const f = isIP(entry);
        if (!f) continue;
        list.addAddress(entry, f === 4 ? 'ipv4' : 'ipv6');
      }
    } catch {
      return false;
    }
  }
  return list.check(raw, family === 4 ? 'ipv4' : 'ipv6');
}
