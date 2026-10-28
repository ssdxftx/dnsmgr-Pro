import { Client } from 'basic-ftp';
import { buildPfx } from '../../cert/utils.js';
import { assertNotMetadataHost } from '../../netGuard.js';
import type { DeployProvider } from '../types.js';

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
        await client.uploadFrom(Buffer.from(fullchain), config.pem_cert_file);
        this.log('证书已上传到：' + config.pem_cert_file);
        await client.uploadFrom(Buffer.from(privatekey), config.pem_key_file);
        this.log('私钥已上传到：' + config.pem_key_file);
      } else if (config.format === 'pfx') {
        const pfx = await buildPfx(fullchain, privatekey, String(config.pfx_pass || ''));
        await client.uploadFrom(pfx, config.pfx_file);
        this.log('PFX证书已上传到：' + config.pfx_file);
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