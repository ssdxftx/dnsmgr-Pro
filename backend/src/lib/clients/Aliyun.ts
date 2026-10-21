import { createHmac } from 'node:crypto';
import { safeFetch } from '../netGuard.js';

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export class AliyunError extends Error {}

export class Aliyun {
  constructor(
    private accessKeyId: string,
    private accessKeySecret: string,
    private endpoint: string,
    private version: string,
  ) {}

  async request(param: Record<string, any>, method: 'GET' | 'POST' = 'POST'): Promise<any> {
    // 先并入业务参数，再写入公共参数，确保公共参数（含 AccessKeyId/Version/Format 等）不可被覆盖
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(param)) {
      if (v === null || v === undefined) continue;
      data[k] = String(v);
    }
    data.Format = 'JSON';
    data.Version = this.version;
    data.AccessKeyId = this.accessKeyId;
    data.SignatureMethod = 'HMAC-SHA1';
    data.Timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    data.SignatureVersion = '1.0';
    data.SignatureNonce = Math.random().toString(36).slice(2, 18);
    data.Signature = this.sign(data, method);

    const url = 'https://' + this.endpoint + '/';
    const body = new URLSearchParams(data).toString();
    // 目标主机由 region 等字段拼接而来，统一走部署防护（逐跳复校 + 禁止云元数据 + IP pin）
    const res = await safeFetch(method === 'GET' ? url + '?' + body : url, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AliyunError('返回数据解析失败');
    }
    if (res.status === 200 && !(json as any).Code) {
      return json;
    }
    if (json && (json.Code || json.Message)) {
      throw new AliyunError(json.Message || json.Code);
    }
    throw new AliyunError('返回数据解析失败');
  }

  private sign(parameters: Record<string, string>, method: string): string {
    const keys = Object.keys(parameters).sort();
    let canonical = '';
    for (const key of keys) {
      canonical += '&' + percentEncode(key) + '=' + percentEncode(parameters[key]);
    }
    const stringToSign = method + '&%2F&' + percentEncode(canonical.slice(1));
    const signature = createHmac('sha1', this.accessKeySecret + '&').update(stringToSign).digest('base64');
    return signature;
  }
}