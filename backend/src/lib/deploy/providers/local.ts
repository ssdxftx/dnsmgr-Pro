import { exec } from 'node:child_process';
import { existsSync, writeFileSync, chmodSync, realpathSync, lstatSync } from 'node:fs';
import { dirname, normalize, sep, basename, join, win32 } from 'node:path';
import { buildPfx } from '../../cert/utils.js';
import { assertCommandAllowed } from '../commandGuard.js';
import type { DeployProvider } from '../types.js';

// 本地部署目标路径安全约束：必须为规范化的绝对路径；
// 若配置了 DNSMGR_DEPLOY_LOCAL_DIRS（逗号分隔的允许目录），则目标必须位于其中之一；
// 同时默认拒绝写入高风险系统位置（authorized_keys、crontab、/etc/passwd、systemd 单元等），
// 避免管理员误配或被滥用时向本机任意位置写入文件（如提权/持久化）。
const LOCAL_DENY_PREFIXES = [
  '/etc',
  '/boot',
  '/sys',
  '/proc',
  '/dev',
  '/var/spool/cron',
  '/var/spool/at',
  '/root',
  '/usr/lib/systemd',
  '/lib/systemd',
];

// Windows 受保护系统位置（盘符/UNC 路径）
const WIN_DENY_PREFIXES = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata'];

// POSIX 敏感文件/目录（denylist 之外的持久化落点）
function isDeniedPosix(low: string): boolean {
  return (
    LOCAL_DENY_PREFIXES.some((pre) => low === pre || low.startsWith(pre + '/')) ||
    low.includes('/.ssh/') ||
    low.endsWith('/.ssh') ||
    low.endsWith('/authorized_keys') ||
    low.endsWith('/authorized_keys2') ||
    low.endsWith('/.bashrc') ||
    low.endsWith('/.bash_profile') ||
    low.endsWith('/.profile') ||
    low.endsWith('/.zshrc') ||
    low.includes('/.config/')
  );
}

function safeTargetPath(p: any): string {
  const raw = String(p || '').trim();
  if (!raw) throw new Error('目标文件路径不能为空');
  const isPosixAbs = raw.startsWith('/');
  const isWinAbs = /^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\/.test(raw);
  if (!isPosixAbs && !isWinAbs) throw new Error('目标文件路径必须为绝对路径：' + raw);
  if (raw.split(/[\\/]/).includes('..')) throw new Error('目标文件路径不合法，禁止包含 .. ：' + raw);

  const allowDirs = (process.env.DNSMGR_DEPLOY_LOCAL_DIRS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((d) => normalize(d));
  // 未显式配置时默认只允许写入数据目录，避免证书部署覆盖 /app 下的程序文件
  if (!allowDirs.length) allowDirs.push(normalize(process.env.DNSMGR_DATA_DIR || '/app/data'));

  if (isWinAbs && !isPosixAbs) {
    // 配置了允许目录白名单时，Windows 风格路径无法落在其中，直接拒绝
    if (allowDirs.length) throw new Error('目标文件路径不在允许目录内（可通过 DNSMGR_DEPLOY_LOCAL_DIRS 配置）：' + raw);
    // Windows 路径：按 win32 语义规范化后做系统位置拒绝
    const wn = win32.normalize(raw).toLowerCase();
    const denied =
      WIN_DENY_PREFIXES.some((pre) => wn === pre || wn.startsWith(pre + '\\')) ||
      wn.includes('\\.ssh\\') ||
      wn.endsWith('\\.ssh') ||
      wn.endsWith('\\authorized_keys') ||
      wn.endsWith('\\authorized_keys2') ||
      wn.includes('\\start menu\\') ||
      wn.includes('\\startup\\');
    if (denied) throw new Error('目标文件路径指向受保护的系统位置，禁止写入：' + raw);
    return raw;
  }

  const normalized = normalize(raw);
  // 解析符号链接：目标已存在则解析完整真实路径；悬空软链必须直接拒绝，
  // 否则 existsSync=false 只解析父目录，白名单校验通过后 writeFileSync 会跟随软链写到任意位置。
  let resolved = normalized;
  try {
    const lst = lstatSync(normalized);
    if (lst.isSymbolicLink()) throw new Error('目标文件为符号链接，禁止写入：' + raw);
    resolved = realpathSync(normalized);
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('符号链接')) throw e;
    // 目标尚不存在：解析父目录真实路径后再拼回文件名
    try {
      const parentReal = realpathSync(dirname(normalized));
      const candidate = join(parentReal, basename(normalized));
      try {
        if (lstatSync(candidate).isSymbolicLink()) {
          throw new Error('目标文件为符号链接，禁止写入：' + raw);
        }
      } catch (e2: any) {
        if (String(e2?.message || '').includes('符号链接')) throw e2;
      }
      resolved = candidate;
    } catch (e2: any) {
      if (String(e2?.message || '').includes('符号链接')) throw e2;
      resolved = normalized;
    }
  }
  if (allowDirs.length) {
    const ok = allowDirs.some((d) => resolved === d || resolved.startsWith(d.endsWith(sep) ? d : d + sep));
    if (!ok) throw new Error('目标文件路径不在允许目录内（可通过 DNSMGR_DEPLOY_LOCAL_DIRS 配置）：' + raw);
  }
  // 数据目录本身是默认允许目录，但其中的数据库/配置/备份属于应用自身状态，
  // 允许写入会让「部署证书」变成破坏站点数据或覆盖配置的通道。
  if (isProtectedDataPath(resolved)) {
    throw new Error('目标文件路径位于应用数据目录内的受保护文件，禁止写入：' + raw);
  }
  const low = resolved.toLowerCase();
  if (isDeniedPosix(low)) throw new Error('目标文件路径指向受保护的系统位置，禁止写入：' + raw);
  return resolved;
}

// 数据目录内不可被部署写入的路径：数据库文件、配置、备份与临时目录
function isProtectedDataPath(resolved: string): boolean {
  const dataDir = normalize(process.env.DNSMGR_DATA_DIR || '/app/data');
  const base = basename(resolved).toLowerCase();
  if (
    base === 'dnsmgr.sqlite' ||
    base === 'dnsmgr.sqlite-wal' ||
    base === 'dnsmgr.sqlite-shm' ||
    base === 'config.json' ||
    base === '.env' ||
    base.startsWith('.env.')
  ) {
    return true;
  }
  const prefix = dataDir.endsWith(sep) ? dataDir : dataDir + sep;
  if (!resolved.startsWith(prefix)) return false;
  const rel = resolved.slice(prefix.length);
  const first = rel.split(/[\\/]/)[0]?.toLowerCase() || '';
  return first === 'backups' || first === 'tmp';
}

export class LocalDeploy implements DeployProvider {
  private logger: ((txt: string) => void) | null = null;

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  async check(): Promise<void> {
    return;
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (config.format === 'pem') {
      const certFile = safeTargetPath(config.pem_cert_file);
      const keyFile = safeTargetPath(config.pem_key_file);
      const certDir = dirname(certFile);
      const keyDir = dirname(keyFile);
      if (!existsSync(certDir)) throw new Error(certDir + ' 目录不存在');
      if (!existsSync(keyDir)) throw new Error(keyDir + ' 目录不存在');
      writeFileSync(certFile, fullchain);
      this.log('证书已保存到：' + certFile);
      // 私钥显式以 0600 写入，避免按进程 umask 落盘为全局可读
      writeFileSync(keyFile, privatekey, { mode: 0o600 });
      // 文件已存在时 mode 不生效，显式收紧权限
      try { chmodSync(keyFile, 0o600); } catch { /* 忽略：部分文件系统不支持 */ }
      this.log('私钥已保存到：' + keyFile);
    } else if (config.format === 'pfx') {
      const pfxFile = safeTargetPath(config.pfx_file);
      const dir = dirname(pfxFile);
      if (!existsSync(dir)) throw new Error(dir + ' 目录不存在');
      const pfx = await buildPfx(fullchain, privatekey, String(config.pfx_pass || ''));
      // PFX 内含私钥，显式以 0600 写入，避免按进程 umask 落盘为全局可读
      writeFileSync(pfxFile, pfx, { mode: 0o600 });
      try { chmodSync(pfxFile, 0o600); } catch { /* 忽略：部分文件系统不支持 */ }
      this.log('PFX证书已保存到：' + pfxFile);
    } else {
      throw new Error('未知的证书格式：' + String(config.format || '(空)'));
    }
    if (config.cmd) {
      const cmds = String(config.cmd).split('\n');
      for (const raw of cmds) {
        const cmd = raw.trim();
        if (!cmd) continue;
        assertCommandAllowed(cmd);
        this.log('执行命令：' + cmd);
        await this.execAsync(cmd);
        this.log('执行命令成功');
      }
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }

  private execAsync(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) reject(new Error('执行命令失败：' + (stderr || err.message)));
        else resolve(stdout);
      });
    });
  }
}