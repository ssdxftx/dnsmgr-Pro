import { Client, ConnectConfig } from 'ssh2';
import { createHash, X509Certificate } from 'node:crypto';
import { posix } from 'node:path';
import { buildPfx } from '../../cert/utils.js';
import { assertCommandAllowed } from '../commandGuard.js';
import { applyHostKeyVerification } from '../sshHostKey.js';
import type { DeployProvider } from '../types.js';

// 远端部署目标路径安全约束：禁止路径穿越；可通过 DNSMGR_SSH_DEPLOY_DIRS 提供目录白名单；
// 默认拒绝写入高风险系统位置（authorized_keys、crontab、/etc/passwd、systemd 单元等），
// 避免管理员误配或凭据被滥用时覆盖远端任意可写文件实现提权/持久化。
const SSH_DENY_PREFIXES = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
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
  '/etc/profile.d',
  '/var/spool/cron',
  '/boot',
  '/sys',
  '/proc',
  '/dev',
];

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
    low.includes('/.ssh/') ||
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

  private connect(): Promise<Client> {
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

  private writeFile(conn: Client, remotePath: string, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(new Error('无法创建证书文件：' + err.message));
        let path: string;
        try {
          path = safeRemotePath(remotePath);
        } catch (e: any) {
          return reject(e);
        }
        sftp.writeFile(path, data, (e) => {
          if (e) reject(new Error('无法写入文件 ' + remotePath + '：' + e.message));
          else resolve();
        });
      });
    });
  }

  private exec(conn: Client, cmd: string): Promise<string> {
    this.log('执行命令：' + cmd);
    return new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(new Error('执行命令失败：' + err.message));
        let output = '';
        let errorOutput = '';
        stream.on('data', (d: Buffer) => (output += d.toString()));
        stream.stderr.on('data', (d: Buffer) => (errorOutput += d.toString()));
        stream.on('close', (code: number) => {
          if (code !== 0 && errorOutput.trim()) {
            reject(new Error('执行命令失败：' + errorOutput.trim()));
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
        assertCommandAllowed();
        for (const raw of String(config.cmd_pre).split('\n')) {
          const cmd = raw.trim();
          if (cmd) await this.exec(conn, cmd);
        }
      }
      if (config.format === 'pem') {
        await this.writeFile(conn, config.pem_cert_file, Buffer.from(fullchain));
        this.log('证书已保存到：' + config.pem_cert_file);
        await this.writeFile(conn, config.pem_key_file, Buffer.from(privatekey));
        this.log('私钥已保存到：' + config.pem_key_file);
      } else if (config.format === 'pfx') {
        const pfx = buildPfx(fullchain, privatekey, String(config.pfx_pass || ''));
        await this.writeFile(conn, config.pfx_file, pfx);
        this.log('PFX证书已保存到：' + config.pfx_file);
        if (config.uptype === '1' && config.iis_domain) {
          const certHash = createHash('sha1').update(new X509Certificate(fullchain).raw).digest('hex');
          await this.deployIis(conn, config.iis_domain, config.pfx_file, String(config.pfx_pass || ''), certHash);
          config.cmd = null;
        }
      }
      if (config.cmd) {
        assertCommandAllowed();
        for (const raw of String(config.cmd).split('\n')) {
          const cmd = raw.trim();
          if (cmd) await this.exec(conn, cmd);
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
    await this.exec(conn, 'certutil ' + p + ' -importPFX ' + file);
    await this.exec(conn, 'netsh http delete sslcert hostnameport=' + domain);
    await this.exec(conn, 'netsh http add sslcert hostnameport=' + domain + ' certhash=' + certHash + ' certstorename=MY appid=\'{' + this.uuid() + '}\'');
    this.log('IIS域名 ' + domain + ' 证书已更新');
  }

  private uuid(): string {
    const guid = createHash('md5').update(Math.random() + '-' + Date.now() + '-' + Math.random()).digest('hex');
    return guid.slice(0, 8) + '-' + guid.slice(8, 12) + '-4' + guid.slice(12, 15) + '-' + guid.slice(16, 20) + '-' + guid.slice(20, 32);
  }
}