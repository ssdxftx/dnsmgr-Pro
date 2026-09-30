import { query, queryOne, table } from '../../db.js';
import { decryptConfig, encryptConfig } from '../secret.js';

export interface CfCredentialSource {
  source: 'dns' | 'dedicated';
  config: Record<string, any>;
}

/** 读取某 Cloudflare 账户保存的专用凭证（解密后返回） */
export async function getDedicatedCredential(aid: number): Promise<Record<string, any> | null> {
  const row = await queryOne<{ config: string }>(
    `SELECT config FROM ${table('cf_rule_credential')} WHERE aid = ? LIMIT 1`,
    [aid],
  );
  if (!row) return null;
  return decryptConfig(row.config);
}

export async function hasDedicatedCredential(aid: number): Promise<boolean> {
  const row = await queryOne(`SELECT id FROM ${table('cf_rule_credential')} WHERE aid = ? LIMIT 1`, [aid]);
  return !!row;
}

/** 保存（新增或覆盖）专用凭证，AES-256-GCM 加密落库 */
export async function saveDedicatedCredential(aid: number, config: Record<string, any>): Promise<void> {
  const encrypted = encryptConfig(config);
  await query(
    `INSERT INTO ${table('cf_rule_credential')} (aid, config, addtime, updatetime) VALUES (?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE config = ?, updatetime = NOW()`,
    [aid, encrypted, encrypted],
  );
}

export async function removeDedicatedCredential(aid: number): Promise<void> {
  await query(`DELETE FROM ${table('cf_rule_credential')} WHERE aid = ?`, [aid]);
}

/** 解析某 Cloudflare 账户生效的凭证：专用凭证优先，其次为该账户的 DNS 账户凭证 */
export async function resolveCredential(aid: number): Promise<CfCredentialSource> {
  const dedicated = await getDedicatedCredential(aid);
  if (dedicated && String(dedicated.apikey || '').trim()) {
    return { source: 'dedicated', config: dedicated };
  }
  const account = await queryOne<{ config: string }>(`SELECT config FROM ${table('account')} WHERE id = ?`, [aid]);
  return { source: 'dns', config: decryptConfig(account?.config) || {} };
}