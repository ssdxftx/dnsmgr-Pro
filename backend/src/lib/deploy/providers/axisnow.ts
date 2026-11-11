import { X509Certificate } from 'node:crypto';
import { safeFetchDeploy } from '../../netGuard.js';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

/** AxisNow 的 PUT 只能改名称，需用 SHA-256 指纹判断证书内容是否已更新。 */
function certFingerprint(pem: any): string | null {
  if (typeof pem !== 'string' || pem.trim() === '') return null;
  try {
    return new X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
  } catch {
    return null;
  }
}

export class AxisnowDeploy implements DeployProvider {
  private token: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.token = config.token || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private getErrorMessage(result: any, body: string): string {
    let errorMsg = '';
    if (result && Array.isArray(result.errors)) {
      for (const error of result.errors) {
        if (error && typeof error === 'object' && error.message) {
          errorMsg += error.message + '; ';
        } else if (typeof error === 'string') {
          errorMsg += error + '; ';
        }
      }
    }
    errorMsg = errorMsg.replace(/^;\s*|;\s*$/g, '');
    if (!errorMsg && body) {
      errorMsg = body.substring(0, 300);
    }
    if (!errorMsg) errorMsg = '请求失败';
    return errorMsg;
  }

  private async request(method: string, path: string, data?: Record<string, any>): Promise<any> {
    const url = 'https://api.axisnow.io' + path;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + this.token,
    };
    let body: string | undefined;
    if (data) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(data);
    }
    const res = await safeFetchDeploy(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }
    if (result && result.success) {
      return result.result ?? true;
    }
    throw new Error(this.getErrorMessage(result, text));
  }

  async check(): Promise<void> {
    if (!this.token) throw new Error('Token不能为空');
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + this.token,
    };
    const res = await safeFetchDeploy('https://api.axisnow.io/client/v1/certificates', {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 200) {
      await res.text().catch(() => undefined);
      return;
    }
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }
    throw new Error('Token无效或请求失败:' + this.getErrorMessage(result, text));
  }

  async deploy(fullchain: string, privatekey: string, _config: Record<string, any>, info: any): Promise<void> {
    const certInfo = parseCertPem(fullchain);
    if (!certInfo) throw new Error('证书解析失败');
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    let uuid = info.uuid || null;

    if (uuid) {
      try {
        const existing = await this.request('GET', '/client/v1/certificates/' + uuid);
        const oldFingerprint = certFingerprint(existing?.certificate);
        const newFingerprint = certFingerprint(fullchain);
        if (oldFingerprint && newFingerprint && oldFingerprint === newFingerprint) {
          this.log('相同证书' + certName + '已存在，UUID:' + uuid);
          return;
        }
        this.log('原证书内容不同或无法核对，将上传新证书，原UUID:' + uuid);
      } catch (e: any) {
        this.log('原证书获取失败(' + e.message + ')，将重新上传证书');
      }
      uuid = null;
    }

    const param = {
      type: 'upload',
      name: certName,
      certificate: fullchain,
      private_key: privatekey,
    };
    let result: any;
    try {
      result = await this.request('POST', '/client/v1/certificates', param);
    } catch (e: any) {
      throw new Error('上传证书失败:' + e.message);
    }
    const newUuid = typeof result?.uuid === 'string' ? result.uuid.trim() : '';
    if (!newUuid) throw new Error('上传证书失败:响应未返回证书UUID');

    info.uuid = newUuid;
    this.log('上传证书成功，UUID:' + newUuid);
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
