import { randomBytes } from 'node:crypto';
import { configEnsure, configGet, configSet } from '../../config.js';
import { readArchiveHeader } from './archive.js';
import { deriveKek } from '../vault/keys.js';

const KEY_NAME = 'backup_key';

/** 整站备份密钥（32B，Base64URL 明文存 config，接口只返回是否已设置） */
export async function getBackupKey(): Promise<Buffer | null> {
  const raw = await configGet(KEY_NAME, '');
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64url');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export async function ensureBackupKey(): Promise<Buffer> {
  const cur = await getBackupKey();
  if (cur) return cur;
  const raw = await configEnsure(KEY_NAME, () => randomBytes(32).toString('base64url'));
  return Buffer.from(raw, 'base64url');
}

export async function rotateBackupKey(): Promise<Buffer> {
  const key = randomBytes(32);
  await configSet(KEY_NAME, key.toString('base64url'));
  return key;
}

export async function hasBackupKey(): Promise<boolean> {
  return (await getBackupKey()) !== null;
}

/** 按归档头选择密钥：口令归档用用户口令派生，整站归档用 bk_ */
export async function keyForArchive(file: string, passphrase?: string): Promise<Buffer> {
  const { header } = await readArchiveHeader(file);
  if (header.kdf?.algo === 'scrypt') {
    if (!passphrase) throw new Error('该归档使用口令加密，请输入导出时使用的口令');
    return deriveKek(passphrase, Buffer.from(String(header.kdf.salt || ''), 'base64'));
  }
  const key = await getBackupKey();
  if (!key) throw new Error('未设置备份密钥，无法读取整站归档');
  return key;
}
