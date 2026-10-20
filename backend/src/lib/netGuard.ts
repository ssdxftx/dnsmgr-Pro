import { lookup } from 'node:dns/promises';
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

// SSRF 防护：默认禁止请求内网/回环/链路本地/云元数据地址。
// 如需访问内网目标（自建服务等），显式设置 DNSMGR_ALLOW_PRIVATE_FETCH=1。
export function privateFetchAllowed(): boolean {
  return process.env.DNSMGR_ALLOW_PRIVATE_FETCH === '1';
}

export function isPrivateIp(ip: string): boolean {
  const raw = String(ip || '').replace(/^\[|\]$/g, '');
  const mapped = mappedV4(raw);
  if (mapped && mapped !== raw) return isPrivateIp(mapped);
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

function expandV6(ip: string): number[] | null {
  const v = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!net.isIPv6(v)) return null;
  const [head, tail] = v.split('::');
  const h = head ? head.split(':').filter(Boolean) : [];
  const t = tail ? tail.split(':').filter(Boolean) : [];
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  const groups = [...h, ...Array(fill).fill('0'), ...t].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((n) => !Number.isNaN(n)) ? groups : null;
}

/** 将 IPv4-mapped IPv6（含完整展开形式）还原为点分 IPv4 */
function mappedV4(ip: string): string | null {
  const v = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(v)) return v;
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (dotted) return dotted[1];
  const g = expandV6(v);
  if (g && g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  }
  return null;
}

function normalizeIp(ip: string): string {
  return mappedV4(ip) || String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
}

export function isMetadataIp(ip: string): boolean {
  const v = normalizeIp(ip);
  if (METADATA_HOSTS.has(v)) return true;
  if (net.isIPv4(v)) return v.startsWith('169.254.') || v === '100.100.100.200';
  if (net.isIPv6(v)) return v.startsWith('fe80') || v === 'fd00:ec2::254';
  return false;
}

// 校验将拼入主机名的字段（如云厂商 region）：仅允许字母/数字/连字符/点。
// 防止经 '@' '/' ':' 等字符把请求重定向到任意主机（云元数据 SSRF / 凭据外泄）。
export function assertSafeHostname(host: string, label = '主机名'): string {
  const h = String(host || '').trim();
  if (!/^[a-z0-9.-]+$/i.test(h)) throw new Error(label + '不合法：' + h);
  return h;
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

// 将「校验通过的 IP」固定（pin）到 undici Agent，避免校验后再解析导致的 DNS 重绑定（TOCTOU）
// 注意：undici / node 在连接时可能以 { all: true } 调用 lookup，此时必须回传地址数组，
// 否则会以 ERR_INVALID_IP_ADDRESS 失败（标量返回仅适用于 all:false）。
function makePinnedLookup(host: string, address: string, family: number) {
  return (hostname: string, options: any, callback: any) => {
    if (hostname !== host) return dns.lookup(hostname, options, callback);
    if (options && options.all) return callback(null, [{ address, family }]);
    return callback(null, address, family);
  };
}

const pinnedAgents = new Map<string, Agent>();
function getPinnedAgent(host: string, address: string, family: number): Agent {
  const key = host + '|' + address;
  const cached = pinnedAgents.get(key);
  if (cached) return cached;
  const agent = new Agent({ connect: { lookup: makePinnedLookup(host, address, family) } });
  if (pinnedAgents.size >= 200) {
    const oldest = pinnedAgents.keys().next().value;
    if (oldest !== undefined) {
      pinnedAgents.get(oldest)?.close().catch(() => undefined);
      pinnedAgents.delete(oldest);
    }
  }
  pinnedAgents.set(key, agent);
  return agent;
}

type PinResolver = (u: URL) => Promise<{ address: string; family: number } | null>;

// 已校验地址的短时缓存：避免同一主机在短时间内被反复 DNS 解析。
// 缓存键包含校验策略（blockMsg + 谓词名），避免用弱策略的结果跳过强策略校验。
const dnsPinCache = new Map<string, { at: number; value: { address: string; family: number } | null }>();
const DNS_PIN_TTL = 30_000;

// 解析域名并校验其全部地址；返回首个地址用于 pin。IP 字面量直接校验后返回 null（无需 pin）
async function resolveForPin(host: string, blocked: (ip: string) => boolean, blockMsg: string): Promise<{ address: string; family: number } | null> {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (!h) throw new Error('地址不能为空');
  if (net.isIP(h)) {
    if (blocked(h)) throw new Error(blockMsg);
    return null;
  }
  const cacheKey = `${h}|${blockMsg}|${blocked.name || ''}`;
  const cached = dnsPinCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DNS_PIN_TTL) return cached.value;
  const addrs = await lookup(h, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('域名解析失败');
  for (const a of addrs) {
    if (blocked(a.address)) throw new Error(blockMsg);
  }
  const first = addrs[0];
  const value = { address: first.address, family: first.family === 6 ? 6 : 4 };
  if (dnsPinCache.size > 500) dnsPinCache.clear();
  dnsPinCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

// 供非 safeFetch 路径复用：校验并返回 pin 到已解析 IP 的 dispatcher（无需 pin 或允许内网时返回 undefined）
export async function pinnedDispatcherFor(host: string, blocked: (ip: string) => boolean = isPrivateIp, blockMsg = '禁止访问内网地址'): Promise<Agent | undefined> {
  if (privateFetchAllowed()) return undefined;
  const pin = await resolveForPin(host, blocked, blockMsg);
  return pin ? getPinnedAgent(host.replace(/^\[|\]$/g, ''), pin.address, pin.family) : undefined;
}

// 供 node 原生 https/http 使用：校验并返回 pin 到已解析 IP 的自定义 lookup（无需 pin 时返回 undefined）
export async function pinnedLookupFor(
  host: string,
  blocked: (ip: string) => boolean = isMetadataIp,
  blockMsg = '禁止访问链路本地/云元数据地址',
): Promise<((hostname: string, options: any, cb: any) => void) | undefined> {
  const pin = await resolveForPin(host, blocked, blockMsg);
  if (!pin) return undefined;
  const target = host.replace(/^\[|\]$/g, '');
  return makePinnedLookup(target, pin.address, pin.family);
}

// 统一的逐跳跳转处理：仅 http/https、逐跳复校目标、跨主机剥离敏感头、跨域 307/308 丢弃请求体、IP pin 防重绑定
async function followFetch(raw: string, init: RequestInit, maxRedirects: number, resolve: PinResolver): Promise<Response> {
  let current = raw;
  let method = String(init.method || 'GET').toUpperCase();
  let body = init.body;
  const baseHeaders = toHeaderPairs(init);
  const origin = new URL(raw).origin;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https 地址');
    const crossOrigin = u.origin !== origin;
    const reqInit: any = {
      ...init,
      method,
      body,
      headers: buildFetchHeaders(baseHeaders, crossOrigin),
      redirect: 'manual',
      signal: init.signal ?? AbortSignal.timeout(30000),
    };
    // 始终校验目标地址（协议在上方已校验）；仅当调用方未自带 dispatcher 时注入 pinned dispatcher
    const pin = await resolve(u);
    if (!reqInit.dispatcher && pin) {
      reqInit.dispatcher = getPinnedAgent(u.hostname.replace(/^\[|\]$/g, ''), pin.address, pin.family);
    }
    const res = (await undiciFetch(current, reqInit as any)) as unknown as Response;
    if (!REDIRECT_STATUS.has(res.status)) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    await res.body?.cancel().catch(() => undefined);
    const next = new URL(location, u).toString();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      // 303，以及 301/302 下的 POST，按规范降级为 GET 且丢弃请求体
      method = 'GET';
      body = undefined;
    } else if ((res.status === 307 || res.status === 308) && crossOrigin) {
      // 跨域 307/308 不再转发请求体，避免私钥等敏感内容经跳转外泄
      method = 'GET';
      body = undefined;
    }
    current = next;
  }
  throw new Error('重定向次数过多');
}

// SSRF 安全的 fetch：默认不自动跟随跳转，改为手动逐跳校验 Location 的目标地址，
// 避免经 302/307 跳转到内网/云元数据地址绕过 assertUrlAllowed；并 pin 校验通过的 IP。
export async function safeFetch(raw: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  const resolve: PinResolver = privateFetchAllowed()
    ? async () => null
    : (u) => resolveForPin(u.hostname, isPrivateIp, '禁止访问内网地址');
  return followFetch(raw, init, maxRedirects, resolve);
}

// 跳转时会随请求转发的敏感凭据头，跨主机跳转时必须剥离，避免被 302 带到攻击者/元数据地址
const SENSITIVE_FETCH_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'api-secret',
  'x-auth-token',
  'x-access-token',
  'x-token',
  'x-cloud-access-token',
  'x-edge-access-token',
  'x-panel-token',
  '1panel-token',
  'x-bt-key',
  'access-token',
  'eop-authorization',
  'x-cf-authorization',
  'x-slce-api-token',
  'x-client-token',
  'waf_request_token',
  'app-id',
  'app-secret',
  'token',
  'opentoken',
]);

function toHeaderPairs(init: RequestInit): [string, string][] {
  const h = init.headers;
  if (!h) return [];
  if (h instanceof Headers) return [...h.entries()];
  if (Array.isArray(h)) return h as [string, string][];
  return Object.entries(h as Record<string, string>);
}

function buildFetchHeaders(pairs: [string, string][], stripSensitive: boolean): Headers {
  const out = new Headers();
  for (const [k, v] of pairs) {
    if (stripSensitive && SENSITIVE_FETCH_HEADERS.has(String(k).toLowerCase())) continue;
    out.set(k, v);
  }
  return out;
}

// 部署商出站请求：允许内网/局域网面板（自建与内网部署是核心功能），
// 但手动逐跳跟随跳转并复校目标，拒绝链路本地/云元数据地址；
// 跨主机跳转时剥离 Authorization / Cookie / 面板 Token 等敏感头，跨域 307/308 丢弃请求体，
// 防止凭据/私钥经跳转外泄；并 pin 校验通过的 IP 防 DNS 重绑定。
export async function safeFetchDeploy(raw: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  const resolve: PinResolver = (u) => resolveForPin(u.hostname, isMetadataIp, '禁止访问链路本地/云元数据地址');
  return followFetch(raw, init, maxRedirects, resolve);
}
