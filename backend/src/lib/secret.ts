import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { decryptWithDek, encryptWithDek, isUserEncrypted, U1_PREFIX } from './vault/keys.js';

// 账号凭据（AK/SK、密码、Token 等）加密存储：AES-256-GCM，密钥由 sys_key 派生。
// 历史明文数据仍可直接解析，读取后下次保存即自动加密，无需迁移脚本。
const ENC_PREFIX = 'enc:v1:';
export const SECRET_MASK = '**********';

/** 账户配置存在且为密文，但无法解密（系统密钥变更或密文损坏） */
export class ConfigDecryptError extends Error {}

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
  // 个人凭证保险库密文：绝不能拿 sys_key 去试，否则会被误判为「配置损坏」
  if (raw.startsWith(U1_PREFIX)) return null;
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
  if (typeof config === 'string' && config.startsWith(ENC_PREFIX)) {
    throw new Error('检测到重复加密：请检查调用方是否传入了已加密的配置');
  }
  return encryptText(JSON.stringify(config ?? {}));
}

/** 是否为加密存储的配置串（用于区分「空配置」与「解密失败」） */
export function isEncryptedConfig(raw: unknown): boolean {
  return typeof raw === 'string' && raw.startsWith(ENC_PREFIX);
}

// 聚合场景读取配置：不抛错，用 configError 标记「密文无法解密」，便于单账户隔离
export function readConfigSafe(raw: any): { config: Record<string, any>; configError: boolean } {
  if (raw && typeof raw === 'object') return { config: raw as Record<string, any>, configError: false };
  const cfg = decryptConfig(raw);
  if (cfg) return { config: cfg, configError: false };
  return { config: {}, configError: isEncryptedConfig(raw) };
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

const SECRET_KEY_RE = /(secret|password|passwd|pwd|token|apikey|api_key|private_?key|accesskey|credential|passphrase|hmac|skey|spkey|kubeconfig|kube_config)/i;

export function isSecretKey(key: string): boolean {
  const k = String(key || '');
  if (SECRET_KEY_RE.test(k)) return true;
  // 收尾为 key / pass 的字段名（如 access_key、pfx_pass）同样是敏感字段
  if (/(^|_)(key|pass)$/i.test(k)) return true;
  return ['SecretId', 'AccessKeyId', 'api_password', 'skey', 'passphrase', 'kubeconfig', 'kube_config', 'pfx_pass'].includes(k);
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

// 更新配置时，以原配置为底：敏感字段缺失/掩码/空值一律沿用原值，避免前端未改密钥却把它覆盖为空
export function mergeMaskedConfig(input: any, existing: any): any {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    const ex = Array.isArray(existing) ? existing : [];
    return input.map((v, i) => mergeMaskedConfig(v, ex[i]));
  }
  if (typeof input !== 'object') return input;

  const ex = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const next: Record<string, any> = { ...input };

  // 敏感字段：请求里缺失、掩码或空值时一律沿用原值（遍历原配置，避免缺键即丢值）
  for (const k of Object.keys(ex)) {
    if (!isSecretKey(k)) continue;
    const v = next[k];
    if (v === undefined || v === SECRET_MASK || v === '' || v === null) {
      next[k] = ex[k];
    }
  }
  // 非敏感字段递归合并
  for (const k of Object.keys(next)) {
    const v = next[k];
    if (v && typeof v === 'object' && !isSecretKey(k)) {
      next[k] = mergeMaskedConfig(v, ex[k]);
    }
  }
  return next;
}


/** 保险库已锁定：需要先输入口令解锁才能读写私有凭证 */
export class VaultLockedError extends Error {
  code = 423;
  constructor() {
    super('保险库已锁定，请先解锁');
  }
}

export type ConfigState = 'ok' | 'locked' | 'error';

/** 读取账户配置并区分「可解密 / 保险库锁定 / 密文损坏」三种状态 */
export function readConfigState(raw: any): { config: Record<string, any>; state: ConfigState } {
  if (raw && typeof raw === 'object') return { config: raw, state: 'ok' };
  if (isUserEncrypted(raw)) return { config: {}, state: 'locked' };
  const cfg = decryptConfig(raw);
  if (cfg) return { config: cfg, state: 'ok' };
  return { config: {}, state: isEncryptedConfig(raw) ? 'error' : 'ok' };
}

/** 读取账户配置：私有密文用会话 DEK 解，未解锁时返回 locked */
export function readAccountConfig(raw: any, dek: Buffer | null): { config: Record<string, any>; state: ConfigState } {
  if (!isUserEncrypted(raw)) return readConfigState(raw);
  if (!dek) return { config: {}, state: 'locked' };
  const text = decryptWithDek(dek, String(raw));
  if (text === null) return { config: {}, state: 'error' };
  try {
    const v = JSON.parse(text);
    return { config: v && typeof v === 'object' ? v : {}, state: 'ok' };
  } catch {
    return { config: {}, state: 'error' };
  }
}

/** 私有账户写入保险库密文；共享账户继续用 sys_key 加密 */
export function encryptAccountConfig(rawConfig: any, isPrivate: boolean, dek: Buffer | null): string {
  if (isPrivate) {
    if (!dek) throw new VaultLockedError();
    return encryptWithDek(dek, JSON.stringify(rawConfig ?? {}));
  }
  return encryptConfig(rawConfig);
}
