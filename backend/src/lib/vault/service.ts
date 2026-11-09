import { randomBytes } from 'node:crypto';
import { query, queryOne, table, withTransaction } from '../../db.js';
import { getSysKey } from '../../config.js';
import {
  deriveKek,
  deriveSysKek,
  kdfParamsFromStored,
  KDF_PARAMS_JSON,
  newDek,
  newSalt,
  unwrapDek,
  wrapDek,
} from './keys.js';
import { purgePrivateAssets, removeBackupFiles } from '../users/purge.js';
import {
  clearVaultSession,
  getVaultDek,
  setVaultSession,
  vaultSessionExpiry,
} from './session.js';
import { currentRequestContext } from '../requestContext.js';

export class VaultError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type VaultMode = 'none' | 'passphrase';

interface VaultRow {
  uid: number;
  mode: VaultMode;
  kdf: string;
  kdf_params: string;
  salt: Buffer | null;
  wrapped_dek: Buffer | null;
  wrapped_dek_sys: Buffer | null;
  salt_recovery: Buffer | null;
  wrapped_dek_recovery: Buffer | null;
  recovery_hash: string | null;
  hint: string | null;
  exclude_from_site_backup: number;
  fail_count: number;
  locked_until: string | null;
}

const MAX_FAIL = 5;

function buf(v: any): Buffer | null {
  if (v === null || v === undefined) return null;
  return Buffer.isBuffer(v) ? v : Buffer.from(v);
}

/** 读取既有 KDF 参数时必须使用原始值；非法参数要报明确错误，不能静默换成默认值。 */
function storedKdf(row: VaultRow) {
  const params = kdfParamsFromStored(row.kdf_params);
  if (!params) throw new VaultError('保险库 KDF 参数不受支持，请联系管理员检查 kdf_params', 500);
  return params;
}

export async function getVaultRow(uid: number): Promise<VaultRow | null> {
  return (await queryOne<VaultRow>(`SELECT * FROM ${table('user_vault')} WHERE uid = ?`, [uid])) || null;
}

export function genRecoveryCode(): string {
  const raw = randomBytes(10).toString('hex').toUpperCase();
  return raw.match(/.{1,5}/g)!.join('-');
}

async function buildRecovery(uid: number, dek: Buffer, input: string) {
  const code = input === 'random' ? genRecoveryCode() : String(input || '').trim();
  if (code.length < 16) throw new VaultError('恢复码至少 16 个字符');
  const salt = newSalt();
  const kek = await deriveKek(code, salt);
  const wrapped = wrapDek(kek, dek, uid);
  // 不再保存恢复码的任何摘要：校验只靠 scrypt 解包裹是否成功，
  // 库里没有可离线爆破的快速哈希（recovery_hash 列保留但写 NULL，兼容老数据）。
  return { code, salt, wrapped };
}

async function sysDek(row: VaultRow | null): Promise<Buffer | null> {
  if (!row?.wrapped_dek_sys) return null;
  return unwrapDek(deriveSysKek(await getSysKey()), buf(row.wrapped_dek_sys) as Buffer, row.uid);
}

export async function initVault(
  uid: number,
  jti: string,
  opts: { mode?: string; passphrase?: string; recovery?: string; acknowledge?: boolean; hint?: string },
): Promise<{ recoveryCode?: string }> {
  const existing = await getVaultRow(uid);
  if (existing) throw new VaultError('保险库已初始化，如需更换请使用升级/降级接口');
  const mode: VaultMode = opts.mode === 'none' ? 'none' : 'passphrase';

  if (mode === 'none') {
    if (opts.acknowledge !== true) throw new VaultError('便捷模式需要确认风险');
    const dek = newDek();
    await query(
      `INSERT INTO ${table('user_vault')} (uid, mode, kdf, kdf_params, wrapped_dek_sys, hint, created_at, updated_at)
       VALUES (?, 'none', 'scrypt', ?, ?, ?, NOW(), NOW())`,
      [uid, KDF_PARAMS_JSON, wrapDek(deriveSysKek(await getSysKey()), dek, uid), String(opts.hint || '').slice(0, 100)],
    );
    setVaultSession(uid, jti, dek);
    return {};
  }

  const pass = String(opts.passphrase || '');
  if (pass.length < 12) throw new VaultError('口令至少 12 个字符');
  const dek = newDek();
  const salt = newSalt();
  const wrapped = wrapDek(await deriveKek(pass, salt), dek, uid);
  let recovery: Awaited<ReturnType<typeof buildRecovery>> | null = null;
  if (opts.recovery) recovery = await buildRecovery(uid, dek, opts.recovery);

  await query(
    `INSERT INTO ${table('user_vault')}
       (uid, mode, kdf, kdf_params, salt, wrapped_dek, salt_recovery, wrapped_dek_recovery, recovery_hash, hint, created_at, updated_at)
     VALUES (?, 'passphrase', 'scrypt', ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      uid,
      KDF_PARAMS_JSON,
      salt,
      wrapped,
      recovery?.salt ?? null,
      recovery?.wrapped ?? null,
      null,
      String(opts.hint || '').slice(0, 100),
    ],
  );
  setVaultSession(uid, jti, dek);
  return recovery ? { recoveryCode: recovery.code } : {};
}

/**
 * 原子预占一次口令尝试。
 *
 * 旧实现是「读 locked_until/fail_count → 跑 scrypt → 再累加」，不是原子预占：
 * 并发的错误请求全部读到 fail_count=0 后一起跑完 KDF，实测把「每 15 分钟 5 次」放大到 6 倍以上。
 * 现在改成条件 UPDATE 先占额度（达到阈值的那一次顺带清零并锁定），占不到直接 429，连 scrypt 都不跑。
 */
async function claimAttempt(uid: number): Promise<void> {
  const res: any = await query(
    `UPDATE ${table('user_vault')}
        SET locked_until = CASE WHEN fail_count + 1 >= ? THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE) ELSE locked_until END,
            fail_count = CASE WHEN fail_count + 1 >= ? THEN 0 ELSE fail_count + 1 END
      WHERE uid = ? AND (locked_until IS NULL OR locked_until <= NOW()) AND fail_count < ?`,
    [MAX_FAIL, MAX_FAIL, uid, MAX_FAIL],
  );
  if (Number(res?.affectedRows || 0) > 0) return;
  const row = await getVaultRow(uid);
  const until = row?.locked_until ? new Date(String(row.locked_until).replace(' ', 'T')).getTime() : 0;
  if (until > Date.now()) {
    const mins = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
    throw new VaultError(`口令错误次数过多，请 ${mins} 分钟后再试`, 429);
  }
  throw new VaultError('口令错误次数过多，请 15 分钟后再试', 429);
}

/** 预占后口令/恢复码不匹配：失败次数已在预占时累加，这里只负责给出准确文案 */
async function failAttempt(uid: number, message = '保险库口令错误'): Promise<never> {
  const row = await getVaultRow(uid);
  const until = row?.locked_until ? new Date(String(row.locked_until).replace(' ', 'T')).getTime() : 0;
  if (until > Date.now()) throw new VaultError('口令错误次数过多，已锁定 15 分钟', 429);
  throw new VaultError(message);
}

export async function unlockVault(uid: number, jti: string, passphrase: string): Promise<number> {
  const row = await getVaultRow(uid);
  if (!row) throw new VaultError('保险库未初始化');
  if (row.mode !== 'passphrase') {
    const dek = await sysDek(row);
    if (!dek) throw new VaultError('便捷模式解锁失败，请联系管理员');
    return setVaultSession(uid, jti, dek);
  }
  const params = storedKdf(row);
  await claimAttempt(uid);
  const dek = unwrapDek(
    await deriveKek(String(passphrase || ''), buf(row.salt) as Buffer, params),
    buf(row.wrapped_dek) as Buffer,
    uid,
  );
  if (!dek) return await failAttempt(uid);
  await query(`UPDATE ${table('user_vault')} SET fail_count = 0, locked_until = NULL WHERE uid = ?`, [uid]);
  return setVaultSession(uid, jti, dek);
}

export async function upgradeVault(
  uid: number,
  jti: string,
  passphrase: string,
  recovery?: string,
): Promise<{ recoveryCode?: string }> {
  const row = await getVaultRow(uid);
  if (!row) throw new VaultError('保险库未初始化');
  if (row.mode !== 'none') throw new VaultError('当前已是口令模式');
  const dek = await sysDek(row);
  if (!dek) throw new VaultError('便捷模式解锁失败');
  const pass = String(passphrase || '');
  if (pass.length < 12) throw new VaultError('口令至少 12 个字符');
  const salt = newSalt();
  const wrapped = wrapDek(await deriveKek(pass, salt), dek, uid);
  const rec = recovery ? await buildRecovery(uid, dek, recovery) : null;
  await query(
    `UPDATE ${table('user_vault')}
     SET mode = 'passphrase', kdf = 'scrypt', kdf_params = ?, salt = ?, wrapped_dek = ?,
         wrapped_dek_sys = NULL, salt_recovery = ?, wrapped_dek_recovery = ?, recovery_hash = NULL, updated_at = NOW()
     WHERE uid = ?`,
    [KDF_PARAMS_JSON, salt, wrapped, rec?.salt ?? null, rec?.wrapped ?? null, uid],
  );
  setVaultSession(uid, jti, dek);
  return rec ? { recoveryCode: rec.code } : {};
}

export async function downgradeVault(uid: number, jti: string, passphrase: string): Promise<void> {
  const row = await getVaultRow(uid);
  if (!row) throw new VaultError('保险库未初始化');
  if (row.mode !== 'passphrase') throw new VaultError('当前已是便捷模式');
  const params = storedKdf(row);
  await claimAttempt(uid);
  const dek = unwrapDek(
    await deriveKek(String(passphrase || ''), buf(row.salt) as Buffer, params),
    buf(row.wrapped_dek) as Buffer,
    uid,
  );
  if (!dek) return await failAttempt(uid);
  await query(
    `UPDATE ${table('user_vault')}
     SET mode = 'none', salt = NULL, wrapped_dek = NULL, wrapped_dek_sys = ?, updated_at = NOW()
     WHERE uid = ?`,
    [wrapDek(deriveSysKek(await getSysKey()), dek, uid), uid],
  );
  setVaultSession(uid, jti, dek);
}

export async function changePassphrase(uid: number, jti: string, oldPass: string, nextPass: string): Promise<void> {
  const row = await getVaultRow(uid);
  if (!row) throw new VaultError('保险库未初始化');
  if (row.mode !== 'passphrase') throw new VaultError('便捷模式没有口令');
  const params = storedKdf(row);
  await claimAttempt(uid);
  const dek = unwrapDek(
    await deriveKek(String(oldPass || ''), buf(row.salt) as Buffer, params),
    buf(row.wrapped_dek) as Buffer,
    uid,
  );
  if (!dek) return await failAttempt(uid);
  const pass = String(nextPass || '');
  if (pass.length < 12) throw new VaultError('口令至少 12 个字符');
  const salt = newSalt();
  const wrapped = wrapDek(await deriveKek(pass, salt), dek, uid);
  await query(
    `UPDATE ${table('user_vault')}
     SET salt = ?, wrapped_dek = ?, kdf = 'scrypt', kdf_params = ?, fail_count = 0, locked_until = NULL, updated_at = NOW()
     WHERE uid = ?`,
    [salt, wrapped, KDF_PARAMS_JSON, uid],
  );
  setVaultSession(uid, jti, dek);
}

export async function recoverVault(uid: number, jti: string, recovery: string, nextPass: string): Promise<void> {
  const row = await getVaultRow(uid);
  if (!row) throw new VaultError('保险库未初始化');
  if (!row.salt_recovery || !row.wrapped_dek_recovery) {
    throw new VaultError('未设置恢复码，无法找回口令');
  }
  await claimAttempt(uid);
  const code = String(recovery || '').trim();
  // 恢复码的校验强度必须与口令一致：直接以 scrypt 解包裹是否成功作为判定，
  // 不再走 recovery_hash（单次 SHA-256）——那会让恢复码比口令容易爆破一个数量级。
  const dek = unwrapDek(await deriveKek(code, buf(row.salt_recovery) as Buffer), buf(row.wrapped_dek_recovery) as Buffer, uid);
  if (!dek) return await failAttempt(uid, '恢复码错误');
  const pass = String(nextPass || '');
  if (pass.length < 12) throw new VaultError('口令至少 12 个字符');
  const salt = newSalt();
  const wrapped = wrapDek(await deriveKek(pass, salt), dek, uid);
  await query(
    `UPDATE ${table('user_vault')} SET mode = 'passphrase', kdf = 'scrypt', kdf_params = ?, salt = ?, wrapped_dek = ?,
       wrapped_dek_sys = NULL, salt_recovery = NULL, wrapped_dek_recovery = NULL,
       recovery_hash = NULL, fail_count = 0, locked_until = NULL, updated_at = NOW() WHERE uid = ?`,
    [KDF_PARAMS_JSON, salt, wrapped, uid],
  );
  setVaultSession(uid, jti, dek);
}

export async function setRecovery(uid: number, jti: string, recovery: string): Promise<{ recoveryCode?: string }> {
  const row = await getVaultRow(uid);
  if (!row) throw new VaultError('保险库未初始化');
  const dek = (await getDekForWrite(uid, jti)) || (await sysDek(row));
  if (!dek) throw new VaultError('请先解锁保险库', 423);
  const rec = await buildRecovery(uid, dek, recovery);
  await query(
    `UPDATE ${table('user_vault')} SET salt_recovery = ?, wrapped_dek_recovery = ?, recovery_hash = NULL, updated_at = NOW() WHERE uid = ?`,
    [rec.salt, rec.wrapped, uid],
  );
  return rec.code === recovery ? {} : { recoveryCode: rec.code };
}

export async function setExcludeFromSiteBackup(uid: number, exclude: boolean): Promise<void> {
  await query(`UPDATE ${table('user_vault')} SET exclude_from_site_backup = ?, updated_at = NOW() WHERE uid = ?`, [
    exclude ? 1 : 0,
    uid,
  ]);
}

export async function destroyVault(uid: number, confirm: string, passphrase?: string): Promise<void> {
  if (String(confirm || '') !== 'DESTROY') throw new VaultError('请输入 DESTROY 确认销毁');
  const row = await getVaultRow(uid);
  if (row?.mode === 'passphrase') {
    const params = storedKdf(row);
    await claimAttempt(uid);
    const dek = unwrapDek(
      await deriveKek(String(passphrase || ''), buf(row.salt) as Buffer, params),
      buf(row.wrapped_dek) as Buffer,
      uid,
    );
    if (!dek) return await failAttempt(uid);
  }
  const backupFiles = await withTransaction(async (q) => await purgePrivateAssets(q, uid));
  await removeBackupFiles(backupFiles);
  clearVaultSession(uid);
}

export async function vaultStatus(uid: number, jti?: string) {
  const row = await getVaultRow(uid);
  const sessionDek = getVaultDek(uid, jti);
  let unlocked = !!sessionDek;
  if (!unlocked && row?.mode === 'none' && jti) {
    const dek = await sysDek(row);
    if (dek) {
      setVaultSession(uid, jti, dek);
      unlocked = true;
    }
  }
  return {
    initialized: !!row,
    mode: row?.mode || 'none',
    unlocked,
    expiresAt: vaultSessionExpiry(uid, jti),
    hasRecovery: !!row?.wrapped_dek_recovery,
    hint: row?.hint || '',
    excludeFromSiteBackup: Number(row?.exclude_from_site_backup || 0) === 1,
  };
}

/** 登录后调用：便捷模式自动解锁，口令模式保持锁定 */
export async function autoUnlockConvenient(uid: number, jti: string): Promise<void> {
  const row = await getVaultRow(uid);
  if (!row || row.mode !== 'none') return;
  const dek = await sysDek(row);
  if (dek) setVaultSession(uid, jti, dek);
}

/** 写私有凭证前取 DEK：便捷模式自动解 sys 包裹，口令模式必须已有会话 */
export async function getDekForWrite(uid: number, jti?: string): Promise<Buffer | null> {
  const row = await getVaultRow(uid);
  if (!row) return null;
  if (row.mode === 'none') return sysDek(row);
  return getVaultDek(uid, jti);
}

/**
 * 后台任务取 DEK：只允许便捷模式（由系统密钥解包）。
 * 口令模式没有请求 jti，不能借用该用户任意活跃会话的 DEK，否则等同于绕过“当前会话必须解锁”。
 * 需要后台任务访问私有凭证时，应由用户显式切换到便捷模式，或等后续实现独立的 service key。
 */
export async function findAnyVaultDekForUser(uid: number): Promise<Buffer | null> {
  const row = await getVaultRow(uid);
  if (!row) return null;
  if (row.mode === 'none') return sysDek(row);
  return null;
}

/**
 * 请求内读取私有凭证的 DEK：口令模式必须命中「当前请求所属会话」的 jti。
 * 旧实现取该用户任意活跃会话的 DEK，导致受害者在另一台设备解锁后，
 * 攻击者用窃取的同用户 JWT 也能读取私有凭证，绕过「必须解锁」的设计。
 */
export async function findVaultDekForRequest(uid: number, jti?: string): Promise<Buffer | null> {
  const row = await getVaultRow(uid);
  if (!row) return null;
  if (row.mode === 'none') return sysDek(row);
  const sessionJti = jti || currentRequestContext()?.jti || '';
  if (!sessionJti) return null;
  return getVaultDek(uid, sessionJti);
}
