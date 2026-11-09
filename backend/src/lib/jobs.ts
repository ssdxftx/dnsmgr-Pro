import os from 'node:os';
import { query, queryOne, table } from '../db.js';

/** 当前进程标识：多副本部署时便于排查任务归属 */
const WORKER_ID = `${os.hostname()}:${process.pid}`;
/** 运行中任务心跳超过该时长即视为执行实例已消失 */
const STALE_JOB_SECONDS = 120;

export type JobStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed';

export interface JobProgress {
  done: number;
  failed: number;
  result: any;
}

/** 同时未完成的后台任务上限：每个 worker 都会打厂商接口，无上限等于给自己开一个放大器 */
const MAX_ACTIVE_JOBS = Math.max(1, Math.min(32, Number(process.env.DNSMGR_MAX_BACKGROUND_JOBS || 4) || 4));
const JOB_RETENTION_DAYS = Math.max(1, Number(process.env.DNSMGR_JOB_RETENTION_DAYS || 7) || 7);

/**
 * 运行中任务的心跳超过 2 分钟未更新，说明执行它的进程已经消失（崩溃/重启/缩容）。
 * 多副本下不能只按 worker_id 或启动时间判断，否则其他实例的存活任务会被误杀，
 * 而本实例崩溃留下的任务又会在 24 小时内挡住同类任务。
 */
async function failStaleJobs(): Promise<void> {
  await query(
    `UPDATE ${table('async_job')} SET status = 'failed', error = ?, finished_at = NOW()
      WHERE status IN ('pending', 'running')
        AND (heartbeat_at IS NULL OR heartbeat_at < DATE_SUB(NOW(), INTERVAL ? SECOND))`,
    ['执行实例已失联，任务已中断，请重新发起', STALE_JOB_SECONDS],
  ).catch(() => undefined);
}

/**
 * 创建后台任务；返回 0 表示拒绝（已有同类任务在执行，或全局并发已达上限）。
 * 去重是必要的：连点按钮 / 脚本刷接口会各自起一个 worker，每个 worker 都在跑证书签发或到期扫描。
 */
export async function createJob(uid: number, type: string, total: number, detail?: any): Promise<number> {
  // 先清理失联任务，避免旧行永久占用同类任务去重名额和全局并发额度。
  await failStaleJobs();
  const existing: any = await queryOne(
    `SELECT id FROM ${table('async_job')} WHERE uid = ? AND type = ? AND status IN ('pending', 'running') ORDER BY id DESC LIMIT 1`,
    [uid, type],
  );
  if (existing) return 0;
  const active: any = await queryOne(
    `SELECT COUNT(*) AS c FROM ${table('async_job')} WHERE status IN ('pending', 'running')`,
  );
  if (Number(active?.c || 0) >= MAX_ACTIVE_JOBS) return 0;
  const res: any = await query(
    `INSERT INTO ${table('async_job')}
      (uid, type, status, total, done, failed, detail, result, error, worker_id, heartbeat_at, created_at)
     VALUES (?, ?, 'pending', ?, 0, 0, ?, NULL, NULL, ?, NOW(), NOW())`,
    [uid, type, Math.max(0, Number(total) || 0), detail ? JSON.stringify(detail) : null, WORKER_ID],
  );
  // 顺带清理历史任务：表无上限增长会让「我的任务」列表越查越慢
  if (Math.random() < 0.05) void cleanupOldJobs();
  return Number(res?.insertId || 0);
}

/** 删除超过保留期的已结束任务 */
export async function cleanupOldJobs(): Promise<void> {
  await query(
    `DELETE FROM ${table('async_job')}
      WHERE status IN ('success', 'partial', 'failed')
        AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [JOB_RETENTION_DAYS],
  ).catch(() => undefined);
}

/**
 * 进程启动时复位「假 running」：进程被 kill 后这些任务永远不会再被推进，
 * 既挡住同类新任务（去重），也让前端一直显示「进行中」。
 */
export async function resetStaleJobs(): Promise<void> {
  // 启动时也按心跳判断：同机重启/其他副本启动都不会误杀仍在心跳的任务。
  await failStaleJobs();
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
  if (!sets.length) {
    await query(`UPDATE ${table('async_job')} SET heartbeat_at = NOW() WHERE id = ?`, [id]);
    return;
  }
  sets.push('heartbeat_at = NOW()');
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
      // 长任务可能很久才调用一次 progress；独立心跳避免被其他副本的启动清理误判为失联。
      const heartbeat = setInterval(() => {
        updateJob(id, {}).catch(() => undefined);
      }, 30_000);
      heartbeat.unref?.();
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
      } finally {
        clearInterval(heartbeat);
      }
    })();
  });
}

export async function getJob(id: number): Promise<any | null> {
  return (await queryOne(`SELECT * FROM ${table('async_job')} WHERE id = ?`, [id])) || null;
}
