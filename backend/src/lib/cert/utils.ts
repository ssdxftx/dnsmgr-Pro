import { createHash, X509Certificate } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';
import { query, table } from '../../db.js';

let domainsCache: string[] | null = null;
let domainsCacheAt = 0;
const DOMAINS_CACHE_MS = 60_000;

export async function getMainDomain(host: string): Promise<string> {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return host;
  if (!domainsCache || Date.now() - domainsCacheAt > DOMAINS_CACHE_MS) {
    const rows = await query<{ name: string }>(`SELECT name FROM ${table('domain')}`);
    const aliasRows = await query<{ name: string }>(`SELECT name FROM ${table('domain_alias')}`);
    domainsCache = [...rows.map((r) => r.name), ...aliasRows.map((r) => r.name)].sort((a, b) => b.length - a.length);
    domainsCacheAt = Date.now();
  }
  for (const domain of domainsCache) {
    if (host === domain || host.endsWith('.' + domain)) return domain;
  }
  return host;
}

function extractCN(subject: string): string {
  const m = subject.match(/(?:^|,\s*)CN\s*=\s*([^,]+)/i);
  return m ? m[1].trim() : '';
}

export function parseCertPem(pem: string): { issuer: string; subject: string; validFrom: number; validTo: number } {
  const x = new X509Certificate(pem);
  return {
    issuer: extractCN(x.issuer),
    subject: extractCN(x.subject),
    validFrom: new Date(x.validFrom).getTime() / 1000,
    validTo: new Date(x.validTo).getTime() / 1000,
  };
}

export function unzip(zipPath: string, destDir: string): void {
  // 预检压缩包条目：拒绝绝对路径、盘符/UNC、含 .. 段的条目，防止 zip-slip 越界落盘
  let listing: string;
  try {
    listing = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (e: any) {
    // 安全校验应 fail-closed：无法列出条目即拒绝解压
    throw new Error('无法读取压缩包目录，已拒绝解压：' + (e?.message || String(e)));
  }
  for (const raw of listing.split(/\r?\n/)) {
    const name = raw.trim();
    if (!name) continue;
    if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(name) || name.split(/[\\/]/).includes('..')) {
      throw new Error('压缩包包含非法/越界路径条目：' + name);
    }
  }
  execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'ignore' });
}

const execFileAsync = promisify(execFile);

// 同一订单的 PFX 结果缓存（按 fullchain + 私钥 + 密码哈希）：避免证书详情/批量部署反复重新生成
const pfxCache = new Map<string, { at: number; buf: Buffer }>();
const PFX_CACHE_TTL = 10 * 60_000;
const PFX_CACHE_MAX = 64;

export async function buildPfx(fullchain: string, privatekey: string, pwd: string): Promise<Buffer> {
  const cacheKey = createHash('sha256').update(pwd).update('\0').update(fullchain).update('\0').update(privatekey).digest('hex');
  const cached = pfxCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PFX_CACHE_TTL) return cached.buf;

  const dir = await mkdtemp(join(tmpdir(), 'pfx_'));
  const certFile = join(dir, 'fullchain.pem');
  const keyFile = join(dir, 'key.pem');
  const pfxFile = join(dir, 'out.pfx');
  try {
    await writeFile(certFile, fullchain);
    await writeFile(keyFile, privatekey, { mode: 0o600 });
    try {
      await execFileAsync('openssl', ['pkcs12', '-export', '-out', pfxFile, '-inkey', keyFile, '-in', certFile, '-passout', `pass:${pwd}`]);
    } catch (e: any) {
      // 区分「未安装 openssl」与「openssl 执行失败」，避免环境问题被误判为证书内容问题
      if (e && e.code === 'ENOENT') {
        throw new Error('服务器缺少 openssl 命令，无法生成 PFX；请安装 openssl（Docker 镜像已内置）');
      }
      const detail = e && e.stderr ? String(e.stderr).trim() : e?.message || String(e);
      throw new Error('生成 PFX 失败：' + detail);
    }
    const buf = await readFile(pfxFile);
    if (pfxCache.size >= PFX_CACHE_MAX) pfxCache.clear();
    pfxCache.set(cacheKey, { at: Date.now(), buf });
    return buf;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function findFileByExt(dir: string, exts: string[], root: string = dir): string | null {
  const rootReal = (() => {
    try {
      return realpathSync(root);
    } catch {
      return root;
    }
  })();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // 拒绝符号链接，避免读取解压目录之外的文件
    if (entry.isSymbolicLink()) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = findFileByExt(p, exts, root);
      if (r) return r;
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      const real = (() => {
        try {
          return realpathSync(p);
        } catch {
          return p;
        }
      })();
      if (rootReal && !(real === rootReal || real.startsWith(rootReal + sep))) continue;
      return p;
    }
  }
  return null;
}