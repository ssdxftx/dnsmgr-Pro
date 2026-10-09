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

// 校验主机名（IP 或域名）解析后的地址不能是内网地址
export async function assertHostAllowed(host: string): Promise<void> {
  if (privateFetchAllowed()) return;
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (!h) throw new Error('地址不能为空');
  if (net.isIP(h)) {
    if (isPrivateIp(h)) throw new Error('禁止访问内网地址');
    return;
  }
  const addrs = await lookup(h, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('域名解析失败');
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error('禁止访问内网地址');
  }
}

// 校验待请求的 URL：仅允许 http/https，且解析后的地址不能是内网地址
export async function assertUrlAllowed(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https 地址');
  if (privateFetchAllowed()) return u;
  await assertHostAllowed(u.hostname);
  return u;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

// 云元数据服务地址：部署商/外部请求指向这些地址可用于窃取云主机临时凭据
const METADATA_HOSTS = new Set(['169.254.169.254', '100.100.100.200', '169.254.0.23', 'fd00:ec2::254']);

export function isMetadataIp(ip: string): boolean {
  const low = ip.toLowerCase();
  if (METADATA_HOSTS.has(low)) return true;
  if (net.isIPv4(ip)) return ip.startsWith('169.254.'); // 链路本地
  if (net.isIPv6(ip)) return low.startsWith('fe80'); // 链路本地
  return false;
}

// 部署商目标地址防护：允许内网/局域网面板（自建与内网部署是核心功能），
// 但禁止指向链路本地/云元数据地址，避免凭据被诱导窃取。
export async function assertDeployTargetAllowed(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isMetadataIp(host)) throw new Error('禁止访问链路本地/云元数据地址：' + raw);
    return;
  }
  const addrs = await lookup(host, { all: true }).catch(() => []);
  for (const a of addrs) {
    if (isMetadataIp(a.address)) throw new Error('禁止访问链路本地/云元数据地址：' + raw);
  }
}

// 扫描部署商配置中的所有字符串，对疑似 URL 的目标逐一做部署防护校验
export async function assertDeployConfigAllowed(config: any): Promise<void> {
  const seen = new Set<string>();
  const walk = async (v: any): Promise<void> => {
    if (typeof v === 'string') {
      if (/^https?:\/\//i.test(v) && !seen.has(v)) {
        seen.add(v);
        await assertDeployTargetAllowed(v);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) await walk(item);
      return;
    }
    if (v && typeof v === 'object') {
      for (const item of Object.values(v)) await walk(item);
    }
  };
  await walk(config);
}

// SSRF 安全的 fetch：默认不自动跟随跳转，改为手动逐跳校验 Location 的目标地址，
// 避免经 302/307 跳转到内网/云元数据地址绕过 assertUrlAllowed。
export async function safeFetch(raw: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = raw;
  let method = String(init.method || 'GET').toUpperCase();
  let body = init.body;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertUrlAllowed(current);
    const res = await fetch(u, { ...init, method, body, redirect: 'manual' });
    if (!REDIRECT_STATUS.has(res.status)) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    await res.body?.cancel().catch(() => undefined);
    const next = new URL(location, u).toString();
    // 303，以及 301/302 下的 POST，按规范降级为 GET 且丢弃请求体
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
    }
    current = next;
  }
  throw new Error('重定向次数过多');
}