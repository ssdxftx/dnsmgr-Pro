import { randomBytes, timingSafeEqual } from 'node:crypto';
import { configEnsure, configGet, configSet } from '../../config.js';
import { keyCheck, readArchiveHeader } from './archive.js';
import { deriveKek } from '../vault/keys.js';

const KEY_NAME = 'backup_key';
const PREV_KEY_NAME = 'backup_key_prev';
/** 保留的历史密钥数量：轮换后旧备份仍可解密，但不会无限堆积 */
const KEEP_PREV_KEYS = 5;

function parseKey(raw: string | null): Buffer | null {
  try {
    const buf = Buffer.from(String(raw || ''), 'base64url');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * 外部托管的备份密钥（DNSMGR_BACKUP_KEY，32 字节 Base64URL）。
 * 配置后密钥不再从数据库读取：仅数据库泄露无法解密任何备份文件。
 */
function envBackupKey(): Buffer | null {
  const raw = String(process.env.DNSMGR_BACKUP_KEY || '').trim();
  if (!raw) return null;
  const key = parseKey(raw);
  if (!key) throw new Error('DNSMGR_BACKUP_KEY 格式不正确（需为 32 字节 Base64URL）');
  return key;
}

/** 整站备份密钥（32B，Base64URL 存 config，接口只返回是否已设置） */
export async function getBackupKey(): Promise<Buffer | null> {
  const fromEnv = envBackupKey();
  if (fromEnv) return fromEnv;
  // 跳过 60 秒配置缓存：多副本轮换后必须尽快看到新密钥，避免用旧密钥导出不可恢复的归档
  return parseKey(await configGet(KEY_NAME, '', true));
}

export async function ensureBackupKey(): Promise<Buffer> {
  const fromEnv = envBackupKey();
  if (fromEnv) return fromEnv;
  const cur = await getBackupKey();
  if (cur) return cur;
  const raw = await configEnsure(KEY_NAME, () => randomBytes(32).toString('base64url'));
  return Buffer.from(raw, 'base64url');
}

/**
 * 读取历史密钥（最近轮换的在前）。
 * 轮换不能只覆盖当前密钥：那会让轮换前导出的所有归档永久不可恢复。
 */
export async function getBackupKeyHistory(): Promise<Buffer[]> {
  const out: Buffer[] = [];
  const fromEnv = envBackupKey();
  if (fromEnv) out.push(fromEnv);
  // 从环境变量接管后，数据库中的旧密钥仍需参与解密历史归档
  const dbKey = parseKey(await configGet(KEY_NAME, '', true));
  if (dbKey && !out.some((k) => k.equals(dbKey))) out.push(dbKey);
  const raw = await configGet(PREV_KEY_NAME, '', true);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const buf = parseKey(String(item));
          if (buf && !out.some((k) => k.equals(buf))) out.push(buf);
        }
      }
    } catch {
      // 历史密钥损坏时忽略，当前密钥仍然可用
    }
  }
  return out;
}

export async function rotateBackupKey(): Promise<Buffer> {
  if (envBackupKey()) {
    throw new Error('备份密钥由环境变量 DNSMGR_BACKUP_KEY 托管，请直接更换该变量后重启服务');
  }
  const old = await getBackupKey();
  const key = randomBytes(32);
  if (old) {
    // 先写历史再覆盖当前：任一步失败都不会丢失可用于解密的旧密钥
    const history = (await getBackupKeyHistory()).filter((k) => !k.equals(old) && !k.equals(key));
    const next = [old, ...history].slice(0, KEEP_PREV_KEYS).map((k) => k.toString('base64url'));
    await configSet(PREV_KEY_NAME, JSON.stringify(next));
  }
  await configSet(KEY_NAME, key.toString('base64url'));
  return key;
}

export async function hasBackupKey(): Promise<boolean> {
  return (await getBackupKey()) !== null;
}

/** 按归档头选择密钥：口令归档用用户口令派生，整站归档在当前/历史密钥中匹配 */
export async function keyForArchive(file: string, passphrase?: string): Promise<Buffer> {
  const { header } = await readArchiveHeader(file);
  if (header.kdf?.algo === 'scrypt') {
    if (!passphrase) throw new Error('该归档使用口令加密，请输入导出时使用的口令');
    return deriveKek(passphrase, Buffer.from(String(header.kdf.salt || ''), 'base64'));
  }
  const candidates = await getBackupKeyHistory();
  if (!candidates.length) throw new Error('未设置备份密钥，无法读取整站归档');
  // 归档头 check 是密钥派生的校验值：轮换后仍可用历史密钥打开旧归档
  const check = Buffer.from(String(header.check || ''), 'base64');
  if (check.length) {
    const hit = candidates.find((k) => {
      const expect = keyCheck(k);
      return expect.length === check.length && timingSafeEqual(expect, check);
    });
    if (hit) return hit;
    throw new Error('备份密钥不匹配，该归档可能由其他站点或已删除的旧密钥导出');
  }
  return candidates[0];
}
