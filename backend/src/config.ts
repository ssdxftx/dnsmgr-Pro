import { randomBytes } from 'node:crypto';
import { query, queryOne, table } from './db.js';
import { decryptText, encryptText, isSecretKey } from './lib/secret.js';

let cache: Record<string, string> = {};
let loadedAt = 0;

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

// 系统设置中的凭据与通道密钥使用与账户配置相同的 AES-GCM 加密后落库。
// sys_key 用于派生加密密钥，backup_key 需保持独立于 sys_key，二者维持明文存储。
const PLAINTEXT_CONFIG_KEYS = new Set(['sys_key', 'backup_key', 'maintenance']);

function decryptConfigValue(value: any): any {
  if (typeof value !== 'string' || !value.startsWith('enc:v1:')) return value;
  const plain = decryptText(value);
  return plain === null ? value : plain;
}

function encryptConfigValue(key: string, value: string): string {
  if (!value || PLAINTEXT_CONFIG_KEYS.has(key) || !isSecretKey(key) || value.startsWith('enc:v1:')) return value;
  try {
    return encryptText(value);
  } catch {
    // 密钥尚未初始化时保持明文，待密钥就绪后的下一次保存会重新加密。
    return value;
  }
}

export async function loadConfig(force = false): Promise<Record<string, string>> {
  if (!force && loadedAt && Date.now() - loadedAt < 60000) return cache;
  const all = await query<{ key: string; value: string }>(`SELECT \`key\`, value FROM ${table('config')}`);
  cache = {};
  for (const r of all) cache[r.key] = r.value;
  loadedAt = Date.now();
  return cache;
}

export async function configGet(key: string, def: string | null = null, force = false): Promise<string | null> {
  const cfg = force ? await loadConfig(true) : await loadConfig();
  const v = decryptConfigValue(cfg[key]);
  return isNullOrEmpty(v) ? def : v;
}

export async function configSet(key: string, value: string): Promise<void> {
  const stored = encryptConfigValue(key, String(value));
  await query(`INSERT INTO ${table('config')} (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?`, [key, stored, stored]);
  cache[key] = stored;
}

/** 启动时将历史明文系统密钥迁移为密文；sys_key/backup_key 保持原样。 */
export async function encryptLegacyConfigSecrets(): Promise<void> {
  const cfg = await loadConfig(true);
  for (const [key, raw] of Object.entries(cfg)) {
    if (!raw || PLAINTEXT_CONFIG_KEYS.has(key) || !isSecretKey(key) || raw.startsWith('enc:v1:')) continue;
    try {
      await configSet(key, raw);
    } catch (e: any) {
      console.error(`[config] 加密历史配置项 ${key} 失败：${e?.message || e}`);
    }
  }
}

/** 多副本安全初始化：先 INSERT IGNORE，再回读数据库中的唯一值，避免后写覆盖导致密文不可解 */
export async function configEnsure(key: string, generate: () => string): Promise<string> {
  const cur = await configGet(key, '');
  if (cur) return cur;
  const candidate = generate();
  await query(`INSERT IGNORE INTO ${table('config')} (\`key\`, value) VALUES (?, ?)`, [key, candidate]);
  const row: any = await queryOne(`SELECT value FROM ${table('config')} WHERE \`key\` = ?`, [key]);
  const value = row?.value || candidate;
  cache[key] = value;
  return value;
}

export async function getSysKey(): Promise<string> {
  // 缺失时生成并持久化随机密钥，避免使用固定弱密钥
  return configEnsure('sys_key', () => randomBytes(24).toString('hex'));
}
