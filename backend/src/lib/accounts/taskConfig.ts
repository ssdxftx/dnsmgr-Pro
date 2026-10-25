import { findAnyVaultDekForUser } from '../vault/service.js';
import { readAccountConfig } from '../secret.js';

export async function loadAccountConfig(acct: any): Promise<Record<string, any>> {
  const ownerUid = Number(acct?.owner_uid || 0);
  const dek = ownerUid > 0 ? await findAnyVaultDekForUser(ownerUid) : null;
  const { config, state } = readAccountConfig(acct?.config, dek);
  if (state === 'locked') throw new Error('保险库已锁定，无法读取私有账户凭证');
  if (state === 'error') throw new Error('私有账户凭证无法解密');
  return config;
}