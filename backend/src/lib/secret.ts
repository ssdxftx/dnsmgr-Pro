import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// 账号凭据（AK/SK、密码、Token 等）加密存储：AES-256-GCM，密钥由 sys_key 派生。
// 历史明文数据仍可直接解析，读取后下次保存即自动加密，无需迁移脚本。
const ENC_PREFIX = 'enc:v1:';
export const SECRET_MASK = '**********';

let secretKey = '';

export function setSecretKey(key: string): void {
  secretKey = key || '';
}

function deriveKey(): Buffer {
  return createHash('sha256').update('dnsmgr-config:' + secretKey).digest();
}

export function encryptText(plain: string): string {
  // 密钥未初始化时退化为明文，避免把数据写入无法解开的格式
  if (!secretKey) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  return ENC_PREFIX + [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (!raw.startsWith(ENC_PREFIX)) return raw;
  if (!secretKey) return null;
  try {
    const [ivB64, tagB64, dataB64] = raw.slice(ENC_PREFIX.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function encryptConfig(config: any): string {
  return encryptText(JSON.stringify(config ?? {}));
}

// 解析存储的配置：兼容历史明文与新版密文
export function decryptConfig(raw: string | null | undefined): Record<string, any> | null {
  const text = decryptText(raw);
  if (text === null) return null;
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v ? v : null;
  } catch {
    return null;
  }
}

const SECRET_KEY_RE = /(secret|password|passwd|pwd|token|apikey|api_key|private_?key|accesskey|credential)/i;

export function isSecretKey(key: string): boolean {
  const k = String(key || '');
  if (SECRET_KEY_RE.test(k)) return true;
  if (/(^|_)key$/i.test(k)) return true;
  return ['SecretId', 'AccessKeyId', 'api_password'].includes(k);
}

// 返回给前端的配置：敏感字段以掩码替换，避免明文回显
export function maskConfig(config: Record<string, any> | null): Record<string, any> | null {
  if (!config) return config;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(config)) out[k] = isSecretKey(k) && v ? SECRET_MASK : v;
  return out;
}

// 更新配置时，敏感字段为掩码/空值时沿用原值，避免前端未改密钥却把它覆盖为空
export function mergeMaskedConfig(input: Record<string, any> | null, existing: Record<string, any> | null): Record<string, any> {
  const next: Record<string, any> = { ...(input || {}) };
  if (!existing) return next;
  for (const k of Object.keys(next)) {
    if (!isSecretKey(k)) continue;
    const v = next[k];
    if (v === SECRET_MASK || v === '' || v === null || v === undefined) {
      if (existing[k] !== undefined) next[k] = existing[k];
    }
  }
  return next;
}