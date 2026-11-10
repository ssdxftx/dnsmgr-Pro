import { Client, ConnectConfig, type SFTPWrapper } from 'ssh2';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { posix } from 'node:path';
import { buildPfx } from '../../cert/utils.js';
import { assertCommandAllowed } from '../commandGuard.js';
import { applyHostKeyVerification } from '../sshHostKey.js';
import { assertNotMetadataHost } from '../../netGuard.js';
import type { DeployProvider } from '../types.js';
import { redactCommand } from '../redact.js';

// 远端部署目标路径安全约束：禁止路径穿越；可通过 DNSMGR_SSH_DEPLOY_DIRS 提供目录白名单；
// 默认拒绝写入高风险系统位置（authorized_keys、crontab、/etc/passwd、systemd 单元等），
// 避免管理员误配或凭据被滥用时覆盖远端任意可写文件实现提权/持久化。
const SSH_DENY_PREFIXES = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/group',
  '/etc/gshadow',
  '/etc/sudoers',
  '/etc/sudoers.d',
  '/etc/crontab',
  '/etc/cron.d',
  '/etc/cron.daily',
  '/etc/cron.hourly',
  '/etc/cron.weekly',
  '/etc/cron.monthly',
  '/etc/cron.yearly',
  '/etc/cron.minutely',
  '/etc/ssh',
  '/etc/ld.so.preload',
  '/etc/ld.so.conf',
  '/etc/ld.so.conf.d',
  '/etc/ld.so.cache',
  '/etc/systemd',
  '/etc/init.d',
  '/etc/rc.local',
  '/etc/rc.d',
  '/etc/rc0.d',
  '/etc/rc1.d',
  '/etc/rc2.d',
  '/etc/rc3.d',
  '/etc/rc4.d',
  '/etc/rc5.d',
  '/etc/rc6.d',
  '/etc/rcS.d',
  '/etc/profile',
  '/etc/profile.d',
  '/etc/bash.bashrc',
  '/etc/bashrc',
  '/etc/environment',
  '/etc/zsh',
  '/etc/csh',
  '/etc/security',
  '/etc/pam.d',
  '/etc/skel',
  '/etc/xdg/autostart',
  '/var/spool/cron',
  '/var/spool/at',
  '/boot',
  '/sys',
  '/proc',
  '/dev',
];

// 任何位置的 shell 启动脚本都等同于持久化执行入口；即使不在 /etc 下也不能写。
const SHELL_RC_NAMES = new Set([
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.bash_logout',
  '.profile',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.zlogin',
  '.cshrc',
  '.tcshrc',
  '.kshrc',
  'config.fish',
]);

function isShellStartupPath(low: string): boolean {
  const base = posix.basename(low);
  if (SHELL_RC_NAMES.has(base)) return true;
  if (base === 'config.fish' && low.includes('/.config/fish/')) return true;
  return false;
}

function safeRemotePath(p: any): string {
  const raw = String(p || '').trim();
  if (!raw) throw new Error('远程目标文件路径不能为空');
  const path = raw.startsWith('/') ? raw : '/' + raw;
  if (path.split('/').includes('..')) {
    throw new Error('远程路径不合法，禁止包含 .. ：' + raw);
  }
  const normalized = posix.normalize(path);
  const allowDirs = (process.env.DNSMGR_SSH_DEPLOY_DIRS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((d) => posix.normalize(d));
  if (allowDirs.length) {
    const ok = allowDirs.some((d) => normalized === d || normalized.startsWith(d.endsWith('/') ? d : d + '/'));
    if (!ok) throw new Error('远程路径不在允许目录内（可通过 DNSMGR_SSH_DEPLOY_DIRS 配置）：' + raw);
  }
  const low = normalized.toLowerCase();
  const denied =
    SSH_DENY_PREFIXES.some((pre) => low === pre || low.startsWith(pre + '/')) ||
    isShellStartupPath(low) ||
    low.includes('/.ssh/') ||
    low.endsWith('/.ssh') ||
    low.endsWith('/authorized_keys') ||
    low.endsWith('/authorized_keys2');
  if (denied) throw new Error('远程路径指向受保护的系统位置，禁止写入：' + raw);
  return normalized;
}

export class SshDeploy implements DeployProvider {
  private config: Record<string, any>;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.config = config;
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async connect(): Promise<Client> {
    const cfg = this.config;
    if (!cfg.host || !cfg.username) throw new Error('必填参数不能为空');
    if (cfg.auth === '1' && !cfg.privatekey) throw new Error('私钥不能为空');
    if (cfg.auth !== '1' && !cfg.password) throw new Error('密码不能为空');

    const connectConfig: ConnectConfig = {
      host: cfg.host,
      port: Number(cfg.port || 22),
      username: cfg.username,
    };
    if (cfg.auth === '1') {
      connectConfig.privateKey = Buffer.from(cfg.privatekey);
      if (cfg.passphrase) connectConfig.passphrase = cfg.passphrase;
    } else {
      connectConfig.password = cfg.password;
    }
    // 禁止把部署凭据发往云元数据地址（SSH 不走 safeFetch，需单独校验）
    await assertNotMetadataHost(String(cfg.host));
    // 如配置了主机密钥指纹/公钥则严格校验，防止中间人攻击
    applyHostKeyVerification(connectConfig, cfg);

    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => resolve(conn));
      conn.on('error', (err) => reject(new Error('SSH连接失败：' + err.message)));
      conn.connect(connectConfig);
    });
  }

  async check(): Promise<void> {
    const conn = await this.connect();
    conn.end();
  }

  private sftp(conn: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => (err ? reject(new Error('无法创建证书文件：' + err.message)) : resolve(sftp)));
    });
  }

  private static realpath(sftp: SFTPWrapper, path: string): Promise<string | null> {
    return new Promise((resolve) => {
      sftp.realpath(path, (err: any, resolved: string) => (err ? resolve(null) : resolve(String(resolved || '') || null)));
    });
  }

  private static lstat(sftp: SFTPWrapper, path: string): Promise<any | null> {
    return new Promise((resolve, reject) => {
      sftp.lstat(path, (err: any, stats: any) => {
        if (err) {
          // 目标不存在是允许的；其他错误（权限/路径异常）直接失败
          if (String(err.code || '') === 'ENOENT' || /no such file/i.test(String(err.message || ''))) return resolve(null);
          return reject(new Error('无法检查远端文件 ' + path + '：' + err.message));
        }
        resolve(stats);
      });
    });
  }

  /**
   * 远端写入采用「同目录临时文件 + rename」：
   * 1) 目标若是符号链接，SFTP WRITE 默认会跟随链接写穿到任意位置；rename 替换链接本身，不跟随。
   * 2) 临时文件创建时即带 0600，避免私钥先以 0644 落盘再 chmod 的窗口。
   * 3) rename 是原子的，目标文件不会出现半写状态。
   */
  private async writeFile(conn: Client, remotePath: string, data: Buffer, mode = 0o644): Promise<void> {
    const requested = safeRemotePath(remotePath);
    const sftp = await this.sftp(conn);
    // 解析父目录真实路径，防止父目录本身是指向白名单外的符号链接；
    // 目标文件不存在时 realpath 会失败，此时仍使用词法路径。
    const parentReal = await SshDeploy.realpath(sftp, posix.dirname(requested));
    const path = parentReal ? safeRemotePath(posix.join(parentReal, posix.basename(requested))) : requested;
    const st = await SshDeploy.lstat(sftp, path);
    if (st && st.isSymbolicLink?.()) throw new Error('远端目标文件是符号链接，禁止写入：' + remotePath);
    if (st && st.isDirectory?.()) throw new Error('远端目标路径是目录，禁止写入：' + remotePath);

    const dir = posix.dirname(path);
    const tmp = posix.join(dir, `.dnsmgr-${randomBytes(8).toString('hex')}.tmp`);
    try {
      await new Promise<void>((resolve, reject) => {
        sftp.writeFile(tmp, data, { mode: 0o600 }, (e: any) => {
          if (e) return reject(new Error('无法写入临时文件 ' + tmp + '：' + e.message));
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        sftp.chmod(tmp, mode, (e: any) => (e ? reject(new Error('无法设置文件权限 ' + tmp + '：' + e.message)) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        sftp.rename(tmp, path, (e: any) => (e ? reject(new Error('无法替换目标文件 ' + remotePath + '：' + e.message)) : resolve()));
      });
    } catch (e) {
      await new Promise<void>((resolve) => sftp.unlink(tmp, () => resolve()));
      throw e;
    }
  }

  private exec(conn: Client, cmd: string, display?: string): Promise<string> {
    // display 用于在命令含敏感信息（如 PFX 口令）时输出脱敏后的日志
    this.log('执行命令：' + redactCommand(display ?? cmd));
    return new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(new Error('执行命令失败：' + err.message));
        let output = '';
        let errorOutput = '';
        stream.on('data', (d: Buffer) => (output += d.toString()));
        stream.stderr.on('data', (d: Buffer) => (errorOutput += d.toString()));
        stream.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error('执行命令失败：' + (errorOutput.trim() || '退出码 ' + code)));
          } else {
            this.log('执行命令成功：' + output.trim());
            resolve(output);
          }
        });
      });
    });
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const conn = await this.connect();
    try {
      if (config.cmd_pre) {
        for (const raw of String(config.cmd_pre).split('\n')) {
          const cmd = raw.trim();
          if (!cmd) continue;
          assertCommandAllowed(cmd);
          await this.exec(conn, cmd);
        }
      }
      if (config.format === 'pem') {
        await this.writeFile(conn, config.pem_cert_file, Buffer.from(fullchain), 0o644);
        this.log('证书已保存到：' + config.pem_cert_file);
        await this.writeFile(conn, config.pem_key_file, Buffer.from(privatekey), 0o600);
        this.log('私钥已保存到：' + config.pem_key_file);
      } else if (config.format === 'pfx') {
        const pfx = await buildPfx(fullchain, privatekey, String(config.pfx_pass || ''));
        await this.writeFile(conn, config.pfx_file, pfx, 0o600);
        this.log('PFX证书已保存到：' + config.pfx_file);
        if (config.uptype === '1' && config.iis_domain) {
          const certHash = createHash('sha1').update(new X509Certificate(fullchain).raw).digest('hex');
          await this.deployIis(conn, config.iis_domain, config.pfx_file, String(config.pfx_pass || ''), certHash);
          config.cmd = null;
        }
      } else {
        throw new Error('未知的证书格式：' + String(config.format || '(空)'));
      }
      if (config.cmd) {
        for (const raw of String(config.cmd).split('\n')) {
          const cmd = raw.trim();
          if (!cmd) continue;
          assertCommandAllowed(cmd);
          await this.exec(conn, cmd);
        }
      }
    } finally {
      conn.end();
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }

  // IIS 分支的域名/密码/路径会拼进远端 shell 命令，必须严格校验字符集，防止命令注入
  private static safeIisDomain(raw: string): string {
    const domain = String(raw || '').trim();
    if (!/^[A-Za-z0-9.\-]+(:[0-9]{1,5})?$/.test(domain)) {
      throw new Error('IIS 域名不合法：' + raw);
    }
    return domain.includes(':') ? domain : domain + ':443';
  }

  private static safeIisPass(pass: string): string {
    const p = String(pass || '');
    if (!/^[A-Za-z0-9_.@#%:+\-=/]*$/.test(p)) {
      throw new Error('PFX 密码包含不支持的字符（仅允许字母、数字及 _ . @ # % : + - = / ）');
    }
    return p;
  }

  private static safeIisPath(raw: string): string {
    const f = String(raw || '').trim().replace(/^\/+/, '');
    if (!f || !/^[A-Za-z0-9._\\/:+-]+$/.test(f)) {
      throw new Error('PFX 文件路径不合法：' + raw);
    }
    return f;
  }

  private async deployIis(conn: Client, rawDomain: string, pfxFile: string, pfxPass: string, certHash: string): Promise<void> {
    const domain = SshDeploy.safeIisDomain(rawDomain);
    const ret = await this.exec(conn, 'netsh http show sslcert hostnameport=' + domain);
    const m = ret.match(/:\s+(\w{40})/);
    if (m && m[1].toLowerCase() === certHash.toLowerCase()) {
      this.log('IIS域名 ' + domain + ' 证书已存在，无需更新');
      return;
    }
    const safePass = SshDeploy.safeIisPass(pfxPass);
    const p = safePass ? '-p ' + safePass : '-p ""';
    const file = SshDeploy.safeIisPath(pfxFile);
    await this.exec(conn, 'certutil ' + p + ' -importPFX ' + file, 'certutil -p *** -importPFX ' + file);
    await this.exec(conn, 'netsh http delete sslcert hostnameport=' + domain);
    await this.exec(conn, 'netsh http add sslcert hostnameport=' + domain + ' certhash=' + certHash + ' certstorename=MY appid=\'{' + this.uuid() + '}\'');
    this.log('IIS域名 ' + domain + ' 证书已更新');
  }

  private uuid(): string {
    const guid = createHash('md5').update(Math.random() + '-' + Date.now() + '-' + Math.random()).digest('hex');
    return guid.slice(0, 8) + '-' + guid.slice(8, 12) + '-4' + guid.slice(12, 15) + '-' + guid.slice(16, 20) + '-' + guid.slice(20, 32);
  }
}