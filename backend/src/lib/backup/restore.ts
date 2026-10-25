import { unlink } from 'node:fs/promises';
import { query, table } from '../../db.js';
import { loadConfig } from '../../config.js';
import { exportBackup } from './export.js';
import { importArchive } from './import.js';
import { getBackupKey } from './key.js';
import { applyBackupRetention } from './retention.js';
import { getRestoreStatus, setMaintenance, setRestoreStatus } from './maintenance.js';
import { readArchiveHeader, resolveArchivePath } from './archive.js';
import { withDistributedLock } from '../scheduler/distLock.js';
import { deleteRemote } from './destinations.js';

export interface RestoreOptions {
  fileName: string;
  mode: 'replace' | 'merge';
  actor: { uid: number; username: string };
}

/** 在线恢复：先自动快照，再进入维护模式执行导入；失败保留维护模式以便重试或回滚 */
export async function restoreBackup(opts: RestoreOptions): Promise<any> {
  let result: any;
  const locked = await withDistributedLock('dnsmgr:backup:restore', async () => {
    result = await runRestore(opts);
  });
  if (!locked) throw new Error('未获取到恢复锁（可能已有任务执行，或数据库不可用）');
  return result;
}

async function runRestore(opts: RestoreOptions): Promise<any> {
  if (getRestoreStatus().running) throw new Error('已有恢复任务正在执行');
  const archivePath = resolveArchivePath(opts.fileName);
  const header = (await readArchiveHeader(archivePath)).header;
  if (String(header.scope || '') !== 'site') {
    throw new Error('仅支持恢复整站备份');
  }
  setRestoreStatus({ running: true, stage: 'snapshot', message: '正在创建恢复前快照', startedAt: Date.now(), finishedAt: 0, ok: false });
  await setMaintenance(true);

  try {
    const snapshot = await exportBackup({ scope: 'site', kind: 'pre_restore', includeLogs: true });
    setRestoreStatus({ stage: 'import', message: `快照 ${snapshot.file} 已生成，正在导入` });

    const key = await getBackupKey();
    if (!key) throw new Error('未设置备份密钥，无法恢复');
    const report = await importArchive(archivePath, { key, mode: opts.mode, actor: opts.actor, actorIsAdmin: true, trusted: true });
    if (opts.mode === 'replace') {
      // 整站替换后，旧站点的所有备份都属于上一套数据；仅保留本次恢复前的快照，避免旧数据继续可下载。
      const keepJobId = Number(snapshot.jobId || 0);
      if (keepJobId > 0) {
        const staleJobs = await query<any>(
          `SELECT id, file_name, dest_id FROM ${table('backup_job')} WHERE id <> ?`,
          [keepJobId],
        );
        await query(`DELETE FROM ${table('backup_job')} WHERE id <> ?`, [keepJobId]);
        for (const job of staleJobs as any[]) {
          if (job.dest_id) await deleteRemote(Number(job.dest_id), String(job.file_name || '')).catch(() => undefined);
          if (job.file_name) await unlink(resolveArchivePath(String(job.file_name))).catch(() => undefined);
        }
      } else {
        const oldUserJobs = await query<any>(`SELECT file_name FROM ${table('backup_job')} WHERE scope = 'user'`);
        await query(`DELETE FROM ${table('backup_job')} WHERE scope = 'user'`);
        for (const job of oldUserJobs as any[]) {
          if (job.file_name) await unlink(resolveArchivePath(String(job.file_name))).catch(() => undefined);
        }
      }
    }
    // 导入完成后再清理旧快照：本次恢复可能正在读取其中一个旧 pre_restore 文件
    await applyBackupRetention({
      kind: 'pre_restore',
      scope: 'site',
      keepCount: Number(process.env.DNSMGR_PRE_RESTORE_KEEP_COUNT || 5),
      keepDays: Number(process.env.DNSMGR_PRE_RESTORE_KEEP_DAYS || 14),
    }).catch(() => undefined);

    setRestoreStatus({ stage: 'cleanup', message: '正在刷新缓存' });
    await loadConfig(true);
    if (opts.mode === 'replace') {
      // 恢复后强制所有会话重新登录，避免旧权限缓存与旧令牌继续生效
      await query(`UPDATE ${table('user')} SET token_version = token_version + 1`);
    }

    setRestoreStatus({
      running: false,
      stage: 'done',
      message: '恢复完成',
      finishedAt: Date.now(),
      ok: true,
      report: { snapshot: snapshot.file, import: report },
    });
    await setMaintenance(false);
    return { snapshot: snapshot.file, report };
  } catch (e: any) {
    setRestoreStatus({
      running: false,
      stage: 'failed',
      message: String(e?.message || e),
      finishedAt: Date.now(),
      ok: false,
    });
    // 失败时仍停留在维护模式，由管理员重试或从 pre_restore 快照还原
    throw e;
  }
}
