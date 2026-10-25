import { unlink } from 'node:fs/promises';
import { table, withTransaction } from '../../db.js';
import { resolveArchivePath } from '../backup/archive.js';

type Q = <R = any>(sql: string, params?: any[]) => Promise<R[]>;

function marks(ids: Array<string | number>): string {
  return ids.map(() => '?').join(',');
}

async function delByIds(q: Q, name: string, column: string, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await q(`DELETE FROM ${table(name)} WHERE ${column} IN (${marks(ids)})`, ids);
}

async function selectIds(q: Q, sql: string, params: any[]): Promise<number[]> {
  const rows = await q(sql, params);
  return (rows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
}

export async function removeBackupFiles(files: string[]): Promise<void> {
  for (const name of files) {
    try {
      await unlink(resolveArchivePath(name));
    } catch {
      // 文件名异常或文件已不存在时忽略
    }
  }
}

/**
 * 删除某用户的私有资产（账户、域名、CDN、证书、任务、私有域名授权、个人备份记录）。
 * 共享账户保持不动；不删除 user / log / audit_log，由调用方决定是否继续删除账号。
 * 返回需要清理的个人备份文件名。
 */
export async function purgePrivateAssets(
  q: Q,
  uid: number,
  opts: { deleteUserTasks?: boolean } = {},
): Promise<string[]> {
  const accountIds = await selectIds(
    q,
    `SELECT id FROM ${table('account')} WHERE owner_uid = ? AND visibility = 'private'`,
    [uid],
  );
  const cdnAccountIds = await selectIds(
    q,
    `SELECT id FROM ${table('cdn_account')} WHERE owner_uid = ? AND visibility = 'private'`,
    [uid],
  );
  const certAccountIds = await selectIds(
    q,
    `SELECT id FROM ${table('cert_account')} WHERE owner_uid = ? AND visibility = 'private'`,
    [uid],
  );

  const domainRows = accountIds.length
    ? await q(`SELECT id, name FROM ${table('domain')} WHERE aid IN (${marks(accountIds)})`, accountIds)
    : [];
  const domainIds = (domainRows as any[]).map((r) => Number(r.id)).filter((n) => n > 0);
  const domainNames = (domainRows as any[]).map((r) => String(r.name || '').toLowerCase()).filter(Boolean);

  // 只删除本人私有 CDN 账户下的站点；其他账户引用本人 DNS 域名的 CDN 记录不能一并删除。
  const cdnDomainIds = cdnAccountIds.length
    ? await selectIds(q, `SELECT id FROM ${table('cdn_domain')} WHERE aid IN (${marks(cdnAccountIds)})`, cdnAccountIds)
    : [];

  const certOrderIds = certAccountIds.length
    ? await selectIds(q, `SELECT id FROM ${table('cert_order')} WHERE aid IN (${marks(certAccountIds)})`, certAccountIds)
    : [];
  const taskIds = domainIds.length
    ? await selectIds(q, `SELECT id FROM ${table('dmtask')} WHERE did IN (${marks(domainIds)})`, domainIds)
    : [];
  const backupFiles = await q<any>(`SELECT file_name FROM ${table('backup_job')} WHERE owner_uid = ?`, [uid]);

  await delByIds(q, 'dmlog', 'taskid', taskIds);
  await delByIds(q, 'dmtask', 'did', domainIds);
  await delByIds(q, 'optimizeip', 'did', domainIds);
  await delByIds(q, 'sctask', 'did', domainIds);
  await delByIds(q, 'domain_alias', 'did', domainIds);
  await delByIds(q, 'cert_cname', 'did', domainIds);
  await delByIds(q, 'cert_link_log', 'did', domainIds);
  await delByIds(q, 'cert_link_log', 'oid', certOrderIds);
  await delByIds(q, 'dns_check_task', 'did', domainIds);
  if (uid && opts.deleteUserTasks) await q(`DELETE FROM ${table('dns_check_task')} WHERE uid = ?`, [uid]);
  await delByIds(q, 'cdn_cache_rule', 'did', cdnDomainIds);
  await delByIds(q, 'cdn_stat_data', 'aid', cdnAccountIds);
  await delByIds(q, 'cf_rule_credential', 'aid', cdnAccountIds);
  await delByIds(q, 'cdn_domain', 'id', cdnDomainIds);
  await delByIds(q, 'cert_domain', 'oid', certOrderIds);
  await delByIds(q, 'cert_deploy', 'oid', certOrderIds);
  await delByIds(q, 'cert_order', 'id', certOrderIds);
  await delByIds(q, 'domain', 'id', domainIds);
  if (domainNames.length) {
    await q(`DELETE FROM ${table('permission')} WHERE LOWER(domain) IN (${marks(domainNames)})`, domainNames);
  }
  await delByIds(q, 'account', 'id', accountIds);
  await delByIds(q, 'cdn_account', 'id', cdnAccountIds);
  await delByIds(q, 'cert_account', 'id', certAccountIds);
  await q(`DELETE FROM ${table('backup_job')} WHERE owner_uid = ?`, [uid]);
  await q(`DELETE FROM ${table('user_vault')} WHERE uid = ?`, [uid]);
  return (backupFiles as any[]).map((r) => String(r.file_name || '')).filter(Boolean);
}

/**
 * 删除用户及其私有资产。
 * 共享账户保持不动；只清理 visibility=private 的账户及其名下的域名、CDN、证书和任务。
 * 删除顺序遵循子表 -> 父表，避免留下引用已删除账户的孤儿数据。
 */
export async function purgeUserData(uid: number): Promise<void> {
  const backupFiles = await withTransaction(async (q) => {
    const files = await purgePrivateAssets(q, uid, { deleteUserTasks: true });
    await q(`DELETE FROM ${table('permission')} WHERE uid = ?`, [uid]);
    await q(`DELETE FROM ${table('log')} WHERE uid = ?`, [uid]);
    await q(`DELETE FROM ${table('user')} WHERE id = ?`, [uid]);
    return files;
  });
  await removeBackupFiles(backupFiles);
}
