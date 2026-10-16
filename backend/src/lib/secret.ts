import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// 账号凭据（AK/SK、密码、Token 等）加密存储：AES-256-GCM，密钥由 sys_key 派生。
// 历史明文数据仍可直接解析，读取后下次保存即自动加密，无需迁移脚本。
const ENC_PREFIX = 'enc:v1:';
export const SECRET_MASK = '**********';

let secretKey = '';
let derivedKey: Buffer | null = null;

export function setSecretKey(key: string): void {
  secretKey = key || '';
  // 预计算派生密钥，避免每次加解密重复做 SHA-256
  derivedKey = secretKey ? createHash('sha256').update('dnsmgr-config:' + secretKey).digest() : null;
}

function deriveKey(): Buffer {
  if (!derivedKey) derivedKey = createHash('sha256').update('dnsmgr-config:' + secretKey).digest();
  return derivedKey;
}

export function encryptText(plain: string): string {
  // 密钥未初始化时拒绝保存，避免敏感配置被静默以明文写入数据库
  if (!secretKey) {
    throw new Error('系统密钥未初始化，出于安全考虑拒绝保存敏感配置，请重启服务后重试');
  }
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

const SECRET_KEY_RE = /(secret|password|passwd|pwd|token|apikey|api_key|private_?key|accesskey|credential|passphrase|hmac|skey|spkey)/i;

export function isSecretKey(key: string): boolean {
  const k = String(key || '');
  if (SECRET_KEY_RE.test(k)) return true;
  if (/(^|_)key$/i.test(k)) return true;
  return ['SecretId', 'AccessKeyId', 'api_password', 'skey', 'passphrase'].includes(k);
}

// 返回给前端的配置：敏感字段以掩码替换，避免明文回显（递归处理嵌套对象/数组）
export function maskConfig(config: any): any {
  if (config === null || config === undefined) return config;
  if (Array.isArray(config)) return config.map((v) => maskConfig(v));
  if (typeof config === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(config)) {
      if (isSecretKey(k) && v) out[k] = SECRET_MASK;
      else if (v && typeof v === 'object') out[k] = maskConfig(v);
      else out[k] = v;
    }
    return out;
  }
  return config;
}

// 更新配置时，敏感字段为掩码/空值时沿用原值，避免前端未改密钥却把它覆盖为空（递归处理嵌套对象）
export function mergeMaskedConfig(input: any, existing: any): any {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    const ex = Array.isArray(existing) ? existing : [];
    return input.map((v, i) => mergeMaskedConfig(v, ex[i]));
  }
  if (typeof input === 'object') {
    const next: Record<string, any> = { ...input };
    const ex = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
    for (const k of Object.keys(next)) {
      const v = next[k];
      if (isSecretKey(k) && (v === SECRET_MASK || v === '' || v === null || v === undefined)) {
        if (ex[k] !== undefined) next[k] = ex[k];
      } else if (v && typeof v === 'object') {
        next[k] = mergeMaskedConfig(v, ex[k]);
      }
    }
    return next;
  }
  return input;
}