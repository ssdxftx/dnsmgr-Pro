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

const PEM_BLOCK_RE = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
const CERT_PEM_LABELS = new Set(['CERTIFICATE', 'TRUSTED CERTIFICATE']);
const KEY_PEM_LABELS = new Set([
  'PRIVATE KEY',
  'RSA PRIVATE KEY',
  'EC PRIVATE KEY',
  'DSA PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
  'OPENSSH PRIVATE KEY',
]);

/**
 * 严格校验 PEM 文本只包含允许的 PEM 块。
 * Node 的 X509Certificate/createPrivateKey 会忽略尾部任意文本，若直接把用户输入原样保存，
 * 后续部署会把夹带的 shell 脚本写进远端配置文件；这里要求块外只允许空白字符。
 */
function assertOnlyPemBlocks(text: string, allowed: Set<string>, label: string): string {
  const raw = String(text ?? '');
  if (raw.includes('\u0000')) throw new Error(label + '包含非法字符');
  let rest = raw;
  let blocks = 0;
  let sawCertificate = false;
  PEM_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PEM_BLOCK_RE.exec(raw))) {
    const type = match[1].trim();
    if (!allowed.has(type)) throw new Error(`${label}包含不支持的 PEM 块：${type}`);
    if (!match[2].trim()) throw new Error(`${label}的 PEM 块内容为空`);
    if (CERT_PEM_LABELS.has(type)) sawCertificate = true;
    blocks++;
  }
  // 逐个删除被识别的块，剩余部分必须只有空白；同时能发现未闭合/嵌套的 BEGIN 标记
  rest = raw.replace(PEM_BLOCK_RE, '');
  if (rest.replace(/\s+/g, '') !== '') {
    throw new Error(label + '只能包含完整的 PEM 块，禁止夹带其他内容');
  }
  if (!blocks) throw new Error(label + '不是有效的 PEM 格式');
  if (allowed === CERT_PEM_LABELS && !sawCertificate) throw new Error(label + '缺少 CERTIFICATE 块');
  if (allowed === KEY_PEM_LABELS && blocks !== 1) throw new Error(label + '只能包含一个私钥块');
  return raw.trim();
}

/** 证书链：允许一个或多个 CERTIFICATE 块，块外只能是空白 */
export function assertStrictCertPem(fullchain: string): string {
  return assertOnlyPemBlocks(fullchain, CERT_PEM_LABELS, '证书内容');
}

/** 私钥：只允许单个私钥 PEM 块，块外只能是空白 */
export function assertStrictKeyPem(privatekey: string): string {
  return assertOnlyPemBlocks(privatekey, KEY_PEM_LABELS, '私钥内容');
}

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
  // 条目名检查不够：符号链接条目本身名字合法，但解压后可在后续条目中写穿目录。
  // 用 zipinfo 长格式识别 lrwx 条目；命令不支持时保持原有行为（仍受 findFileByExt 的 realpath 校验保护）。
  try {
    const long = execFileSync('unzip', ['-Z', '-l', zipPath], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    for (const line of long.split(/\r?\n/)) {
      if (/^l[rwxStTs-]{9}\s/.test(line.trim())) throw new Error('压缩包包含符号链接条目，已拒绝解压');
    }
  } catch (e: any) {
    if (String(e?.message || '').includes('符号链接')) throw e;
    // zipinfo 不可用/输出格式不同：不阻断正常证书包
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
      await execFileAsync('openssl', ['pkcs12', '-export', '-out', pfxFile, '-inkey', keyFile, '-in', certFile, '-passout', 'env:PFX_PASS'], {
        env: { ...process.env, PFX_PASS: pwd },
      });
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