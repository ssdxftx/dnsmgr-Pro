import { Readable } from 'node:stream';
import { posix } from 'node:path';
import { Client } from 'basic-ftp';
import { buildPfx } from '../../cert/utils.js';
import { assertNotMetadataHost } from '../../netGuard.js';
import type { DeployProvider } from '../types.js';

// 远端目标路径守卫：FTP 的 STOR 可写账号可到达的任意位置，
// 路径里的 .. 或系统敏感目录会把证书/私钥写到 Web 根、authorized_keys 等位置。
const FTP_DENY_PREFIXES = ['/etc', '/root', '/.ssh', '/boot', '/sys', '/proc', '/dev', '/var/spool/cron'];

function safeFtpPath(value: any): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('FTP 目标文件路径不能为空');
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new Error('FTP 目标文件路径包含非法字符');
  const abs = raw.startsWith('/') ? raw : '/' + raw;
  if (abs.split('/').includes('..')) throw new Error('FTP 目标路径不合法，禁止包含 .. ：' + raw);
  const normalized = posix.normalize(abs);
  const low = normalized.toLowerCase();
  const denied =
    FTP_DENY_PREFIXES.some((pre) => low === pre || low.startsWith(pre + '/')) ||
    low.includes('/.ssh/') ||
    low.endsWith('/authorized_keys') ||
    low.endsWith('/authorized_keys2');
  if (denied) throw new Error('FTP 目标路径指向受保护的系统位置，禁止写入：' + raw);
  return normalized;
}

export class FtpDeploy implements DeployProvider {
  private config: Record<string, any>;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.config = config;
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async connect(): Promise<any> {
    // 连接/读写超时（毫秒），避免上游无响应时任务长时间挂起
    const client = new Client(15000);
    client.ftp.verbose = false;
    // FTPS 默认校验证书，避免会话被中间人劫持窃取凭据；自签名证书可显式设置 insecure
    const insecure = this.config.insecure === '1' || this.config.insecure === 1 || this.config.insecure === true;
    if (insecure && process.env.DNSMGR_ALLOW_INSECURE_DEPLOY !== '1') {
      throw new Error('已禁止关闭证书校验：如确需连接自签名 FTP，请设置 DNSMGR_ALLOW_INSECURE_DEPLOY=1 后重启服务');
    }
    // 未显式配置时默认使用 FTPS：明文 FTP 会把账号密码暴露在网络上
    const secure =
      this.config.secure === undefined ||
      this.config.secure === '' ||
      this.config.secure === '1' ||
      this.config.secure === 1 ||
      this.config.secure === true;
    // 明文 FTP 会让账号口令与证书私钥在链路上裸奔：必须由运维显式打开环境开关
    if (!secure && process.env.DNSMGR_ALLOW_INSECURE_DEPLOY !== '1') {
      throw new Error('已禁止使用明文 FTP：如确需关闭 TLS，请设置 DNSMGR_ALLOW_INSECURE_DEPLOY=1 后重启服务');
    }
    await assertNotMetadataHost(String(this.config.host || ''));
    try {
      await client.access({
        host: this.config.host,
        port: Number(this.config.port || 21),
        user: this.config.username,
        password: this.config.password,
        secure,
        secureOptions: { rejectUnauthorized: !insecure },
      });
      return client;
    } catch (e: any) {
      client.close();
      throw new Error('FTP连接失败：' + e.message);
    }
  }

  async check(): Promise<void> {
    const client = await this.connect();
    client.close();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const client = await this.connect();
    try {
      if (config.format === 'pem') {
        const certPath = safeFtpPath(config.pem_cert_file);
        const keyPath = safeFtpPath(config.pem_key_file);
        await client.uploadFrom(Readable.from(Buffer.from(fullchain)), certPath);
        this.log('证书已上传到：' + certPath);
        await client.uploadFrom(Readable.from(Buffer.from(privatekey)), keyPath);
        this.log('私钥已上传到：' + keyPath);
      } else if (config.format === 'pfx') {
        const pfx = await buildPfx(fullchain, privatekey, String(config.pfx_pass || ''));
        const pfxPath = safeFtpPath(config.pfx_file);
        await client.uploadFrom(Readable.from(pfx), pfxPath);
        this.log('PFX证书已上传到：' + pfxPath);
      } else {
        throw new Error('未知的证书格式：' + String(config.format || '(空)'));
      }
    } catch (e: any) {
      throw new Error('FTP上传失败：' + e.message);
    } finally {
      client.close();
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}