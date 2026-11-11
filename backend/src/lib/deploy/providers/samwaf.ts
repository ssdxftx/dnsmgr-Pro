import { X509Certificate } from 'node:crypto';
import { safeFetchDeploy } from '../../netGuard.js';
import type { DeployProvider } from '../types.js';

interface ParsedCert {
  commonName: string;
  serialHex: string;
}

/**
 * SamWaf 证书部署：调用开放平台 API 写入证书夹。
 *
 * - 任务未保存证书 ID 时新增证书，并按证书 CN + 序列号找回 ID；
 * - 首次成功后把 ID 写入 info.config，后续续期直接更新同一张证书。
 */
export class SamwafDeploy implements DeployProvider {
  private url: string;
  private apiKey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = normalizeBaseUrl(config.url);
    this.apiKey = String(config.api_key ?? '').trim();
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  async check(): Promise<void> {
    this.assertConfigured();
    await this.request('/sysinfo/version', null, 'GET');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    this.assertConfigured();
    if (String(fullchain).trim() === '' || String(privatekey).trim() === '') {
      throw new Error('SSL 证书或私钥内容不能为空');
    }

    const id = String(config.id ?? '').trim();
    if (id !== '') {
      await this.request('/sslconfig/edit', {
        id,
        cert_content: fullchain,
        key_content: privatekey,
      });
      this.log('证书ID:' + id + '更新成功！');
      return;
    }

    const cert = parseCert(fullchain);
    const added = await this.request('/sslconfig/add', {
      cert_content: fullchain,
      key_content: privatekey,
    });

    let newId = extractId(added);
    if (newId === '') newId = await this.findCertId(cert);
    if (newId === '') throw new Error('证书添加成功但未能获取证书ID');

    this.rememberId(info, newId);
    this.log('证书ID:' + newId + '添加成功！');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }

  private assertConfigured(): void {
    if (this.url === '' || this.apiKey === '') throw new Error('请填写控制台地址和API Key');
  }

  private apiUrl(path: string, params?: Record<string, any> | null): string {
    const base = this.url.replace(/\/api\/v1$/i, '').replace(/\/+$/, '');
    const query = params ? new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)]),
    ).toString() : '';
    return base + '/api/v1' + path + (query ? '?' + query : '');
  }

  private async request(
    path: string,
    params: Record<string, any> | null,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-API-Key': this.apiKey,
    };
    let body: string | undefined;
    if (method === 'POST' && params) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(params);
    }

    const res = await safeFetchDeploy(this.apiUrl(path, method === 'GET' ? params : null), {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any = null;
    if (text.trim() !== '') {
      try {
        result = JSON.parse(text);
      } catch {
        result = null;
      }
    }

    if (result && Number(result.code) === 0) return result.data ?? true;
    const message = result && (result.msg || result.message);
    if (message) throw new Error(String(message));
    if (res.ok && text.trim() === '') return true;
    if (!result && text.trim() !== '') {
      throw new Error('SamWaf 返回非 JSON 响应(httpCode=' + res.status + ')');
    }
    throw new Error('SamWaf 请求失败(httpCode=' + res.status + ')');
  }

  private async findCertId(cert: ParsedCert): Promise<string> {
    const pageSize = 100;
    for (let page = 1; page <= 20; page++) {
      const data = await this.request('/sslconfig/list', {
        domains: cert.commonName,
        pageIndex: page,
        pageSize,
      });
      const list = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
      for (const row of list) {
        if (this.serialMatches(row?.serial_no, cert.serialHex)) return extractId(row);
      }
      if (list.length < pageSize) break;
    }
    return '';
  }

  private serialMatches(raw: any, serialHex: string): boolean {
    const serial = String(raw ?? '').trim().toLowerCase().replace(/^0x/, '').replace(/[^0-9a-f]/g, '');
    if (serial === '') return false;
    if (normalizeHex(serial) === serialHex) return true;
    if (/^[0-9]+$/.test(serial)) {
      try {
        return normalizeHex(BigInt(serial).toString(16)) === serialHex;
      } catch {
        return false;
      }
    }
    return false;
  }

  private rememberId(info: any, id: string): void {
    if (!info || typeof info !== 'object') return;
    if (!info.config || typeof info.config !== 'object') info.config = {};
    info.config.id = id;
  }
}

function normalizeBaseUrl(raw: any): string {
  const value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (value === '') return '';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SamWaf 控制台地址格式无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('SamWaf 控制台地址格式无效');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('SamWaf 控制台地址不能包含账号、密码、查询参数或片段');
  }
  return value;
}

function parseCert(pem: string): ParsedCert {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    throw new Error('证书解析失败');
  }
  const match = /(?:^|[, \n])CN=([^,\n]+)/i.exec(cert.subject);
  const commonName = match ? match[1].trim() : '';
  return {
    commonName,
    serialHex: normalizeHex(cert.serialNumber.toLowerCase().replace(/[^0-9a-f]/g, '')),
  };
}

function normalizeHex(value: string): string {
  return value.replace(/^0+/, '') || '0';
}

function extractId(value: any): string {
  if (!value || typeof value !== 'object') return '';
  for (const key of ['id', 'Id', 'cert_id', 'certId']) {
    const raw = value[key];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') return String(raw).trim();
  }
  return '';
}
