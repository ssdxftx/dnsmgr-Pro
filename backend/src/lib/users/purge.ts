import { table, withTransaction } from '../../db.js';

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

/**
 * 删除用户及其私有资产。
 * 共享账户保持不动；只清理 visibility=private 的账户及其名下的域名、CDN、证书和任务。
 * 删除顺序遵循子表 -> 父表，避免留下引用已删除账户的孤儿数据。
 */
export async function purgeUserData(uid: number): Promise<void> {
  await withTransaction(async (q) => {
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

    const cdnConds: string[] = [];
    const cdnParams: any[] = [];
    if (cdnAccountIds.length) {
      cdnConds.push(`aid IN (${marks(cdnAccountIds)})`);
      cdnParams.push(...cdnAccountIds);
    }
    if (domainIds.length) {
      cdnConds.push(`did IN (${marks(domainIds)})`);
      cdnParams.push(...domainIds);
    }
    const cdnDomainIds = cdnConds.length
      ? await selectIds(q, `SELECT id FROM ${table('cdn_domain')} WHERE ${cdnConds.join(' OR ')}`, cdnParams)
      : [];

    const certOrderIds = certAccountIds.length
      ? await selectIds(q, `SELECT id FROM ${table('cert_order')} WHERE aid IN (${marks(certAccountIds)})`, certAccountIds)
      : [];
    const taskIds = domainIds.length
      ? await selectIds(q, `SELECT id FROM ${table('dmtask')} WHERE did IN (${marks(domainIds)})`, domainIds)
      : [];

    await delByIds(q, 'dmlog', 'taskid', taskIds);
    await delByIds(q, 'dmtask', 'did', domainIds);
    await delByIds(q, 'optimizeip', 'did', domainIds);
    await delByIds(q, 'sctask', 'did', domainIds);
    await delByIds(q, 'domain_alias', 'did', domainIds);
    await delByIds(q, 'cert_cname', 'did', domainIds);
    await delByIds(q, 'cert_link_log', 'did', domainIds);
    await delByIds(q, 'cert_link_log', 'oid', certOrderIds);
    await delByIds(q, 'dns_check_task', 'did', domainIds);
    if (uid) await q(`DELETE FROM ${table('dns_check_task')} WHERE uid = ?`, [uid]);
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
    await q(`DELETE FROM ${table('permission')} WHERE uid = ?`, [uid]);
    await delByIds(q, 'account', 'id', accountIds);
    await delByIds(q, 'cdn_account', 'id', cdnAccountIds);
    await delByIds(q, 'cert_account', 'id', certAccountIds);
    await q(`DELETE FROM ${table('backup_job')} WHERE owner_uid = ?`, [uid]);
    await q(`DELETE FROM ${table('user_vault')} WHERE uid = ?`, [uid]);
    await q(`DELETE FROM ${table('log')} WHERE uid = ?`, [uid]);
    await q(`DELETE FROM ${table('user')} WHERE id = ?`, [uid]);
  });
}
