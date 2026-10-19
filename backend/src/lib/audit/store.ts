import { query, table } from '../../db.js';
import { fmtDateTime } from '../util.js';
import type { AuditRow } from './types.js';

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_BATCH = 50;
const MAX_QUEUE = 5000;

let queue: AuditRow[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing = false;
let failCount = 0;

function ensureTimer() {
  if (timer) return;
  timer = setInterval(() => void flushAudit(), FLUSH_INTERVAL_MS);
  // 不阻塞进程退出
  (timer as any).unref?.();
}

export function enqueueAudit(row: AuditRow): void {
  if (queue.length >= MAX_QUEUE) queue.shift(); // 极端情况下丢最旧，避免内存膨胀
  queue.push(row);
  ensureTimer();
  if (queue.length >= FLUSH_BATCH) void flushAudit();
}

export async function flushAudit(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, FLUSH_BATCH);
  try {
    const cols =
      '(uid, username, module, action, method, path, route, target_type, target_id, target_name, ' +
      'summary, detail, changes, result, errmsg, status, ip, ua, cost_ms, addtime)';
    await query(`INSERT INTO ${table('audit_log')} ${cols} VALUES ?`, [
      batch.map((r) => [
        r.uid,
        r.username,
        r.module,
        r.action,
        r.method,
        r.path,
        r.route,
        r.target_type,
        r.target_id,
        r.target_name,
        r.summary,
        r.detail,
        r.changes,
        r.result,
        r.errmsg,
        r.status,
        r.ip,
        r.ua,
        r.cost_ms,
        r.addtime,
      ]),
    ]);
    failCount = 0;
  } catch (e: any) {
    // 审计失败不影响业务；每 20 次才打一条日志，避免刷屏
    failCount++;
    if (failCount === 1 || failCount % 20 === 0) {
      console.error(`[audit] 写入失败（累计 ${failCount} 次）：${e?.message || e}`);
    }
  } finally {
    flushing = false;
    if (queue.length >= FLUSH_BATCH) void flushAudit();
  }
}

/** 进程退出前调用，尽量把队列刷完 */
export async function shutdownAudit(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  for (let i = 0; i < 5 && queue.length; i++) await flushAudit();
}

export function nowStr(): string {
  return fmtDateTime(new Date());
}
