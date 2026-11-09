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
export interface KdfParams {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}
export const KDF_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
export const KDF_PARAMS_JSON = JSON.stringify({ N: 32768, r: 8, p: 1 });

export const newDek = (): Buffer => randomBytes(32);
export const newSalt = (): Buffer => randomBytes(16);

/**
 * 解析 user_vault.kdf_params。
 *
 * 注意：这里绝不能把越界参数静默替换成默认参数。解锁/导出时换一组 KDF 参数
 * 派生出的 KEK 一定解不开原 wrapped_dek，用户会看到“口令错误”，正确口令也会
 * 累加失败次数并被锁定。因此读取路径使用 parseKdfParams() 的 null 结果报明确
 * 错误；只有新建保险库时才会用 kdfParamsFromJson() 的默认值。
 *
 * legacy=true 时允许旧版本写入过的较大参数（N<=262144、r<=32、p<=8，且内存需求
 * 不超过 512MB），这样升级前已存在的保险库仍能解锁；导入端仍用默认上限校验，
 * 避免新归档再写入大参数造成解锁时的内存消耗。
 */
export function parseKdfParams(raw: any, legacy = false): KdfParams | null {
  let parsed: any = null;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const N = Number(parsed.N);
  const r = Number(parsed.r);
  const p = Number(parsed.p);
  const maxN = legacy ? 262144 : 65536;
  const maxR = legacy ? 32 : 8;
  const maxP = legacy ? 8 : 4;
  if (!Number.isInteger(N) || N < 16384 || N > maxN || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > maxR) return null;
  if (!Number.isInteger(p) || p < 1 || p > maxP) return null;
  // scrypt 最低要求 128*N*r 字节；旧参数上限也限制在 512MB，避免极端归档把进程内存打满。
  const required = 128 * N * r;
  const maxmem = Math.max(64 * 1024 * 1024, 256 * N * r);
  if (required > 512 * 1024 * 1024 || maxmem > 1024 * 1024 * 1024) return null;
  return { N, r, p, maxmem };
}

/** 读取既有保险库：兼容旧上限；参数非法时返回 null 由调用方报错，绝不回退默认值。 */
export function kdfParamsFromStored(raw: any, legacy = true): KdfParams | null {
  return parseKdfParams(raw, legacy);
}

/** 写入/新建场景：非法或缺失时使用安全默认参数。 */
export function kdfParamsFromJson(raw: any): KdfParams {
  return parseKdfParams(raw, false) ?? KDF_PARAMS;
}

export async function deriveKek(passphrase: string, salt: Buffer, params: KdfParams = KDF_PARAMS): Promise<Buffer> {
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
