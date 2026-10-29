import { query, table } from '../../db.js';
import { configSet } from '../../config.js';
import { fmtDateTime } from '../util.js';
import { runMonitorTask } from './taskRunner.js';
import { withDistributedLock } from '../scheduler/distLock.js';
import { isMaintenance } from '../backup/maintenance.js';

let running = false;
let day = '';
let count = 0;
let lastWriteAt = 0;
let lastWrittenCount = -1;

export function startMonitorScheduler(): void {
  day = formatDay(new Date());

  setInterval(() => {
    if (isMaintenance()) return;
    if (running) return;
    running = true;
    withDistributedLock('dnsmgr:monitor', tick)
      .catch(async (e: any) => {
        await configSet('run_error', e.message || String(e));
        console.error('[dmtask] 调度异常:', e.message);
      })
      .finally(() => {
        running = false;
      });
    // 轮询间隔 5s：任务 frequency 最小为 60s，5s 精度足够；
    // 相比 3s 进一步减少空载时的连接获取、GET_LOCK 与查询次数
  }, 5000);
}

function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + m + dd;
}

async function tick(): Promise<void> {
  const today = formatDay(new Date());
  if (day !== today) {
    count = 0;
    day = today;
  }

  const now = Math.floor(Date.now() / 1000);
  const rows = await query(
    `SELECT * FROM ${table('dmtask')} WHERE checknexttime <= ? AND active = 1 ORDER BY id ASC`,
    [now]
  );

  // 任务并发执行：串行时一个慢任务（含最长 15s 的通知渠道）会拖住整轮，
  // 导致后续任务频繁错过检查窗口。并发度可通过 DNSMGR_MONITOR_CONCURRENCY 调整。
  const concurrency = Math.max(1, Math.min(8, Number(process.env.DNSMGR_MONITOR_CONCURRENCY || 3) || 3));
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= rows.length) return;
      const row = rows[idx];
      // 单个任务失败不能中断整轮：否则 Promise.all 提前结束、其他 worker 继续执行，
      // running 被清零后下一轮会与旧 worker 并发处理同一批任务。
      try {
        await runMonitorTask(row);
        // 用任务完成时刻推进下一次检查，避免单轮耗时超过 frequency 时立刻再次到期
        const doneAt = Math.floor(Date.now() / 1000);
        await query(`UPDATE ${table('dmtask')} SET checktime = ?, checknexttime = ? WHERE id = ?`, [
          doneAt,
          doneAt + (row.frequency || 60),
          row.id,
        ]);
        count++;
      } catch (e: any) {
        console.error('[dmtask] task ' + row.id + ' 调度失败:', e?.message || e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));

  // 心跳写库降频：仅在计数变化或距上次写入超过 30s 时落库，避免每秒 2 次无条件写
  const nowMs = Date.now();
  if (count !== lastWrittenCount || nowMs - lastWriteAt >= 30_000) {
    await configSet('run_time', fmtDateTime());
    await configSet('run_count', String(count));
    lastWrittenCount = count;
    lastWriteAt = nowMs;
  }
}