import { lookup } from 'node:dns/promises';
import net from 'node:net';

// SSRF 防护：默认禁止请求内网/回环/链路本地/云元数据地址。
// 如需访问内网目标（自建服务等），显式设置 DNSMGR_ALLOW_PRIVATE_FETCH=1。
export function privateFetchAllowed(): boolean {
  return process.env.DNSMGR_ALLOW_PRIVATE_FETCH === '1';
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // 链路本地/云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // 组播/保留
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // 唯一本地地址
    if (low.startsWith('fe80')) return true; // 链路本地
    if (low.startsWith('::ffff:')) return isPrivateIp(low.slice(7));
    return false;
  }
  return true;
}

// 校验待请求的 URL：仅允许 http/https，且解析后的地址不能是内网地址
export async function assertUrlAllowed(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https 地址');
  if (privateFetchAllowed()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('禁止访问内网地址');
    return u;
  }
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('域名解析失败');
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error('禁止访问内网地址');
  }
  return u;
}