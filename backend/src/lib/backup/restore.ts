import { query, table } from '../../db.js';
import { loadConfig } from '../../config.js';
import { exportBackup } from './export.js';
import { importArchive } from './import.js';
import { getBackupKey } from './key.js';
import { getRestoreStatus, setMaintenance, setRestoreStatus } from './maintenance.js';
import { resolveArchivePath } from './archive.js';
import { withDistributedLock } from '../scheduler/distLock.js';

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
  if (!locked) throw new Error('已有恢复任务正在执行');
  return result;
}

async function runRestore(opts: RestoreOptions): Promise<any> {
  if (getRestoreStatus().running) throw new Error('已有恢复任务正在执行');
  setRestoreStatus({ running: true, stage: 'snapshot', message: '正在创建恢复前快照', startedAt: Date.now(), finishedAt: 0, ok: false });
  await setMaintenance(true);

  try {
    const snapshot = await exportBackup({ scope: 'site', kind: 'pre_restore', includeLogs: true });
    setRestoreStatus({ stage: 'import', message: `快照 ${snapshot.file} 已生成，正在导入` });

    const key = await getBackupKey();
    if (!key) throw new Error('未设置备份密钥，无法恢复');
    const report = await importArchive(resolveArchivePath(opts.fileName), { key, mode: opts.mode, actor: opts.actor });

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
