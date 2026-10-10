import { execFile } from 'node:child_process';
import net from 'node:net';
import { Agent } from 'undici';
import { safeFetch, assertHostAllowed } from '../netGuard.js';
import { getConfiguredProxyAgent } from '../proxy.js';

export interface CheckResult {
  status: boolean;
  errmsg: string | null;
  usetime: number;
}

// 构造监控请求的 dispatcher：支持「系统代理」与「强制解析到指定 IP」（等价原版 CURLOPT_RESOLVE）
async function buildDispatcher(host: string, ip: string | null, proxy: boolean): Promise<any> {
  if (proxy) {
    const agent = await getConfiguredProxyAgent();
    return agent || undefined;
  }
  if (ip && net.isIP(ip) && !net.isIP(host)) {
    const dns = await import('node:dns');
    const family = ip.includes(':') ? 6 : 4;
    return new Agent({
      connect: {
        lookup: (hostname: string, options: any, callback: any) => {
          if (hostname === host) return callback(null, ip, family);
          return (dns as any).lookup(hostname, options, callback);
        },
      },
    });
  }
  return undefined;
}

function isIp(s: string): boolean {
  return net.isIP(s) !== 0;
}

function isDomain(s: string): boolean {
  return /^[-a-z0-9_*.]{2,512}$/i.test(s) && s.includes('.');
}

export async function dnsResolve(host: string): Promise<string> {
  const { lookup } = await import('node:dns/promises');
  try {
    const res = await lookup(host);
    return res.address;
  } catch {
    return '';
  }
}

export async function checkCurl(url: string, timeout: number, ip: string | null = null, proxy = false): Promise<CheckResult> {
  const start = Date.now();
  let status = true;
  let errmsg: string | null = null;
  try {
    const u = new URL(url);
    if (!u.hostname) throw new Error('Invalid URL');
    // 禁止监控目标指向内网/回环地址，避免被用作内网探测或 SSRF；
    // safeFetch 逐跳校验跳转目标，防止经 302 跳转到内网地址
    const dispatcher = await buildDispatcher(u.hostname, ip, proxy);
    const init: any = {
      signal: AbortSignal.timeout(timeout * 1000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' },
    };
    if (dispatcher) init.dispatcher = dispatcher;
    const res = await safeFetch(url, init);
    const httpcode = res.status;
    if (httpcode < 200 || httpcode >= 400) {
      status = false;
      errmsg = 'http_code=' + httpcode;
    }
    await res.arrayBuffer().catch(() => undefined);
  } catch (e: any) {
    status = false;
    errmsg = e && e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message || '请求失败');
  }
  const usetime = Math.round(Date.now() - start);
  return { status, errmsg, usetime };
}

export async function checkTcp(target: string, ip: string | null, port: number, timeout: number): Promise<CheckResult> {
  let host = target;
  if (ip && isIp(ip)) host = ip;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!isIp(host) && isDomain(host)) {
    host = await dnsResolve(host);
    if (!host) return { status: false, errmsg: 'DNS resolve failed', usetime: 0 };
  }
  if (!isIp(host)) return { status: false, errmsg: 'Invalid IP address', usetime: 0 };

  // 与 http 探活一致：默认禁止探测内网/回环地址，避免被用作内网扫描
  try {
    await assertHostAllowed(host);
  } catch (e: any) {
    return { status: false, errmsg: e?.message || '禁止访问内网地址', usetime: 0 };
  }

  const start = Date.now();
  const status = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port, timeout: timeout * 1000 });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
  const usetime = Date.now() - start;
  return { status, errmsg: status ? null : '连接失败', usetime };
}

export async function checkPing(target: string, ip: string | null): Promise<CheckResult> {
  let host = target;
  if (ip && isIp(ip)) host = ip;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!isIp(host) && isDomain(host)) {
    host = await dnsResolve(host);
    if (!host) return { status: false, errmsg: 'DNS resolve failed', usetime: 0 };
  }
  if (!isIp(host)) return { status: false, errmsg: 'Invalid IP address', usetime: 0 };

  // 与 http 探活一致：默认禁止探测内网/回环地址，避免被用作内网扫描
  try {
    await assertHostAllowed(host);
  } catch (e: any) {
    return { status: false, errmsg: e?.message || '禁止访问内网地址', usetime: 0 };
  }

  const isV6 = host.includes(':');
  const args = isV6 ? ['-6', '-c', '1', '-w', '1', host] : ['-c', '1', '-w', '1', host];
  const start = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('ping', args, { timeout: 3000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const usetime = Math.round(Date.now() - start);
    return { status: true, errmsg: null, usetime };
  } catch {
    return { status: false, errmsg: 'ping timeout', usetime: 1000 };
  }
}