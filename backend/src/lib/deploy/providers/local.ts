import { exec } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize, sep } from 'node:path';
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

function safeTargetPath(p: any): string {
  const raw = String(p || '').trim();
  if (!raw) throw new Error('目标文件路径不能为空');
  if (!isAbsolute(raw)) throw new Error('目标文件路径必须为绝对路径：' + raw);
  if (raw.split(/[\\/]/).includes('..')) throw new Error('目标文件路径不合法，禁止包含 .. ：' + raw);
  const normalized = normalize(raw);
  const allowDirs = (process.env.DNSMGR_DEPLOY_LOCAL_DIRS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((d) => normalize(d));
  if (allowDirs.length) {
    const ok = allowDirs.some((d) => normalized === d || normalized.startsWith(d.endsWith(sep) ? d : d + sep));
    if (!ok) throw new Error('目标文件路径不在允许目录内（可通过 DNSMGR_DEPLOY_LOCAL_DIRS 配置）：' + raw);
  }
  // 仅对 POSIX 绝对路径做系统位置拒绝（Windows 本地部署的场景较少，避免误伤盘符路径）
  if (normalized.startsWith('/')) {
    const low = normalized.toLowerCase();
    const denied =
      LOCAL_DENY_PREFIXES.some((pre) => low === pre || low.startsWith(pre + '/')) ||
      low.includes('/.ssh/') ||
      low.endsWith('/.ssh') ||
      low.endsWith('/authorized_keys') ||
      low.endsWith('/authorized_keys2');
    if (denied) throw new Error('目标文件路径指向受保护的系统位置，禁止写入：' + raw);
  }
  return normalized;
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
      this.log('私钥已保存到：' + keyFile);
    } else if (config.format === 'pfx') {
      const pfxFile = safeTargetPath(config.pfx_file);
      const dir = dirname(pfxFile);
      if (!existsSync(dir)) throw new Error(dir + ' 目录不存在');
      const pfx = buildPfx(fullchain, privatekey, String(config.pfx_pass || ''));
      writeFileSync(pfxFile, pfx);
      this.log('PFX证书已保存到：' + pfxFile);
    }
    if (config.cmd) {
      assertCommandAllowed();
      const cmds = String(config.cmd).split('\n');
      for (const raw of cmds) {
        const cmd = raw.trim();
        if (!cmd) continue;
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