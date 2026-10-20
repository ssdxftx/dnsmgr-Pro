import { randomBytes } from 'node:crypto';
import { query, queryOne, table } from './db.js';

let cache: Record<string, string> = {};
let loadedAt = 0;

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
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
  const v = cfg[key];
  return isNullOrEmpty(v) ? def : v;
}

export async function configSet(key: string, value: string): Promise<void> {
  await query(`INSERT INTO ${table('config')} (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?`, [key, value, value]);
  cache[key] = value;
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