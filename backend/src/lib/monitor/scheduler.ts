import { query, table } from '../../db.js';
import { configSet } from '../../config.js';
import { fmtDateTime } from '../util.js';
import { runMonitorTask } from './taskRunner.js';

let running = false;
let day = '';
let count = 0;
let lastWriteAt = 0;
let lastWrittenCount = -1;

export function startMonitorScheduler(): void {
  day = formatDay(new Date());

  setInterval(() => {
    if (running) return;
    running = true;
    tick()
      .catch(async (e: any) => {
        await configSet('run_error', e.message || String(e));
        console.error('[dmtask] 调度异常:', e.message);
      })
      .finally(() => {
        running = false;
      });
  }, 1000);
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

  for (const row of rows) {
    runMonitorTask(row);
    await query(`UPDATE ${table('dmtask')} SET checktime = ?, checknexttime = ? WHERE id = ?`, [
      now,
      now + (row.frequency || 60),
      row.id,
    ]);
    count++;
  }

  // 心跳写库降频：仅在计数变化或距上次写入超过 30s 时落库，避免每秒 2 次无条件写
  const nowMs = Date.now();
  if (count !== lastWrittenCount || nowMs - lastWriteAt >= 30_000) {
    await configSet('run_time', fmtDateTime());
    await configSet('run_count', String(count));
    lastWrittenCount = count;
    lastWriteAt = nowMs;
  }
}