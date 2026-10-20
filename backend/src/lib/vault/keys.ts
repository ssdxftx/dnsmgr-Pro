import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

// 个人凭证保险库密钥体系
// - 数据层：AES-256-GCM(DEK)，密文前缀 enc:u1:，AAD 固定 'u1|account'，便于整段搬运
// - 包裹层：口令模式 scrypt 派生 KEK；便捷模式 HKDF(sys_key) 派生 KEK，AAD 绑定 uid
const scryptAsync = promisify(scrypt) as (p: Buffer, s: Buffer, k: number, o?: any) => Promise<Buffer>;

export const U1_PREFIX = 'enc:u1:';
const DATA_AAD = Buffer.from('u1|account');
const wrapAad = (uid: number) => Buffer.from(`vault|${uid}`);

// N=32768,r=8 已占约 32MB，maxmem 必须放大到 64MB，否则 scrypt 直接抛参数错误
export const KDF_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
export const KDF_PARAMS_JSON = JSON.stringify({ N: 32768, r: 8, p: 1 });

export const newDek = (): Buffer => randomBytes(32);
export const newSalt = (): Buffer => randomBytes(16);

export async function deriveKek(passphrase: string, salt: Buffer, params = KDF_PARAMS): Promise<Buffer> {
  return scryptAsync(Buffer.from(passphrase.normalize('NFKC'), 'utf8'), salt, 32, params);
}

/** 便捷模式：与 enc:v1: 的密钥做域分离 */
export function deriveSysKek(sysKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(sysKey), Buffer.alloc(0), 'vault-escrow', 32));
}

/** 包裹：iv(12) | tag(16) | ct(32) */
export function wrapDek(kek: Buffer, dek: Buffer, uid: number): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kek, iv);
  c.setAAD(wrapAad(uid));
  const ct = Buffer.concat([c.update(dek), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function unwrapDek(kek: Buffer, wrapped: Buffer, uid: number): Buffer | null {
  try {
    if (!wrapped || wrapped.length < 60) return null;
    const d = createDecipheriv('aes-256-gcm', kek, wrapped.subarray(0, 12));
    d.setAAD(wrapAad(uid));
    d.setAuthTag(wrapped.subarray(12, 28));
    return Buffer.concat([d.update(wrapped.subarray(28)), d.final()]);
  } catch {
    return null;
  }
}

export function encryptWithDek(dek: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dek, iv);
  c.setAAD(DATA_AAD);
  const ct = Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]);
  return U1_PREFIX + [iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptWithDek(dek: Buffer, raw: string): string | null {
  if (!raw || !raw.startsWith(U1_PREFIX)) return null;
  try {
    const [ivB64, tagB64, dataB64] = raw.slice(U1_PREFIX.length).split(':');
    const d = createDecipheriv('aes-256-gcm', dek, Buffer.from(ivB64, 'base64'));
    d.setAAD(DATA_AAD);
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const isUserEncrypted = (raw: unknown): boolean =>
  typeof raw === 'string' && raw.startsWith(U1_PREFIX);
