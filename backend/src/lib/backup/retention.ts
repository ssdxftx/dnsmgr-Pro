import { unlink } from 'node:fs/promises';
import { query, table } from '../../db.js';
import { resolveArchivePath } from './archive.js';
import { deleteRemote } from './destinations.js';

export interface RetentionOptions {
  kind: 'manual' | 'schedule' | 'pre_restore';
  scope: 'site' | 'user';
  /** 计划备份按 schedule_id 隔离保留集 */
  scheduleId?: number;
  /** 个人手动备份按所有者隔离保留集 */
  ownerUid?: number;
  keepCount: number;
  keepDays: number;
}

/** 删除超出数量/天数窗口的备份，先删远端对象再删本地文件与任务记录 */
export async function applyBackupRetention(opts: RetentionOptions): Promise<number> {
  const keepCount = Math.max(1, Math.floor(Number(opts.keepCount)) || 1);
  const keepDays = Math.max(1, Math.floor(Number(opts.keepDays)) || 1);
  const conds = [`kind = ?`, `scope = ?`, `status = 'success'`, 'file_name IS NOT NULL'];
  const params: any[] = [opts.kind, opts.scope];
  if (opts.kind === 'schedule') {
    conds.push('schedule_id = ?');
    params.push(Number(opts.scheduleId || 0));
  } else if (opts.kind === 'manual' && opts.scope === 'user') {
    conds.push('owner_uid = ?');
    params.push(Number(opts.ownerUid || 0));
  }
  const rows = await query<any>(
    `SELECT id, file_name, dest_id, created_at FROM ${table('backup_job')}
     WHERE ${conds.join(' AND ')}
     ORDER BY id DESC`,
    params,
  );
  const cutoff = Date.now() - keepDays * 86400_000;
  let removed = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const at = new Date(String(r.created_at).replace(' ', 'T')).getTime();
    if (i < keepCount && !(Number.isFinite(at) && at < cutoff)) continue;
    try {
      if (r.dest_id) await deleteRemote(Number(r.dest_id), String(r.file_name)).catch(() => undefined);
      await unlink(resolveArchivePath(String(r.file_name))).catch(() => undefined);
      await query(`DELETE FROM ${table('backup_job')} WHERE id = ?`, [r.id]);
      removed++;
    } catch {
      // 单条清理失败（文件名异常/磁盘错误）不阻断其余保留任务
    }
  }
  return removed;
}

/** 计划备份沿用每个计划自己的 keep_count / keep_days */
export async function applyScheduleRetention(schedule: any): Promise<number> {
  return applyBackupRetention({
    kind: 'schedule',
    scope: schedule.scope === 'user' ? 'user' : 'site',
    scheduleId: Number(schedule.id || 0),
    keepCount: Number(schedule.keep_count || 7),
    keepDays: Number(schedule.keep_days || 30),
  });
}
