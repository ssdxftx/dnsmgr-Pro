import { query, queryOne, table } from '../db.js';

export type JobStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed';

export interface JobProgress {
  done: number;
  failed: number;
  result: any;
}

export async function createJob(uid: number, type: string, total: number, detail?: any): Promise<number> {
  const res: any = await query(
    `INSERT INTO ${table('async_job')}
      (uid, type, status, total, done, failed, detail, result, error, created_at)
     VALUES (?, ?, 'pending', ?, 0, 0, ?, NULL, NULL, NOW())`,
    [uid, type, Math.max(0, Number(total) || 0), detail ? JSON.stringify(detail) : null],
  );
  return Number(res?.insertId || 0);
}

export async function updateJob(
  id: number,
  patch: { status?: JobStatus; done?: number; failed?: number; result?: any; error?: string | null },
): Promise<void> {
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.status) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.done !== undefined) {
    sets.push('done = ?');
    params.push(Math.max(0, Number(patch.done) || 0));
  }
  if (patch.failed !== undefined) {
    sets.push('failed = ?');
    params.push(Math.max(0, Number(patch.failed) || 0));
  }
  if (patch.result !== undefined) {
    sets.push('result = ?');
    params.push(patch.result == null ? null : JSON.stringify(patch.result));
  }
  if (patch.error !== undefined) {
    sets.push('error = ?');
    params.push(patch.error == null ? null : String(patch.error).slice(0, 500));
  }
  if (!sets.length) return;
  if (patch.status === 'running') sets.push('started_at = COALESCE(started_at, NOW())');
  if (patch.status === 'success' || patch.status === 'partial' || patch.status === 'failed') {
    sets.push('finished_at = NOW()');
  }
  params.push(id);
  await query(`UPDATE ${table('async_job')} SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function runJobInBackground(
  id: number,
  worker: (progress: (done: number, failed: number, result?: any) => Promise<void>) => Promise<any>,
): void {
  setImmediate(() => {
    void (async () => {
      await updateJob(id, { status: 'running' }).catch(() => undefined);
      let done = 0;
      let failed = 0;
      const progress = async (nextDone: number, nextFailed: number, result?: any) => {
        done = Math.max(0, Number(nextDone) || 0);
        failed = Math.max(0, Number(nextFailed) || 0);
        await updateJob(id, { done, failed, result }).catch(() => undefined);
      };
      try {
        const finalResult = await worker(progress);
        await updateJob(id, {
          status: failed > 0 ? (done > 0 ? 'partial' : 'failed') : 'success',
          done,
          failed,
          result: finalResult,
        });
      } catch (e: any) {
        await updateJob(id, { status: 'failed', done, failed, error: e?.message || String(e) }).catch(() => undefined);
      }
    })();
  });
}

export async function getJob(id: number): Promise<any | null> {
  return (await queryOne(`SELECT * FROM ${table('async_job')} WHERE id = ?`, [id])) || null;
}
