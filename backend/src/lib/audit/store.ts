import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { query, table } from '../../db.js';
import { fmtDateTime } from '../util.js';
import type { AuditRow } from './types.js';

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_BATCH = 50;
const MAX_QUEUE = 2000;
const SPOOL_PATH = path.join(process.env.DNSMGR_DATA_DIR || path.resolve(process.cwd(), 'data'), 'audit-spool.ndjson');
const SPOOL_MAX_BYTES = Number(process.env.DNSMGR_AUDIT_SPOOL_MAX || 32 * 1024 * 1024);

let queue: AuditRow[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing = false;
let draining = false;
let failCount = 0;
let deadCount = 0;
let retryAfter = 0;
let spoolBytes = 0;
const retryTimes = new WeakMap<AuditRow, number>();

try {
  spoolBytes = fs.statSync(SPOOL_PATH).size;
} catch {
  spoolBytes = 0;
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(() => void flushAudit(), FLUSH_INTERVAL_MS);
  // 不阻塞进程退出
  (timer as any).unref?.();
}

function reportDead(n: number, reason: string) {
  deadCount += n;
  if (deadCount === n || deadCount % 100 === 0) {
    console.error(`[audit] ${reason}（累计死信 ${deadCount} 条）`);
  }
}

/** 队列满时写本地 spool，避免洪泛下直接丢弃审计证据 */
function spoolRow(row: AuditRow): void {
  try {
    const line = JSON.stringify(row) + '\n';
    const size = Buffer.byteLength(line);
    if (spoolBytes + size > SPOOL_MAX_BYTES) {
      reportDead(1, '审计 spool 已达上限');
      return;
    }
    fs.mkdirSync(path.dirname(SPOOL_PATH), { recursive: true });
    fs.appendFileSync(SPOOL_PATH, line, { mode: 0o600 });
    spoolBytes += size;
  } catch (e: any) {
    reportDead(1, '审计 spool 写入失败：' + (e?.message || e));
  }
}

export function enqueueAudit(row: AuditRow): void {
  if (queue.length >= MAX_QUEUE) {
    spoolRow(row);
    ensureTimer();
    void flushAudit();
    return;
  }
  queue.push(row);
  ensureTimer();
  if (queue.length >= FLUSH_BATCH) void flushAudit();
}

async function insertBatch(batch: AuditRow[]): Promise<void> {
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
}

/** 从 spool 取一批写库，成功后再原子重写剩余内容 */
async function drainSpool(): Promise<void> {
  if (draining || spoolBytes <= 0) return;
  draining = true;
  const rows: AuditRow[] = [];
  let consumed = 0;
  let bad = 0;
  let rl: ReturnType<typeof createInterface> | null = null;
  try {
    // 逐行读取，只保留一批待写库的记录；剩余内容用流复制回临时文件，
    // 避免数据库故障时把整个 spool（最大 32MB）读进内存再 split。
    rl = createInterface({
      input: fs.createReadStream(SPOOL_PATH),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (rows.length >= FLUSH_BATCH * 4) {
        rl.close();
        break;
      }
      consumed += Buffer.byteLength(line) + 1;
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        bad++;
      }
    }
    if (rows.length) await insertBatch(rows);
    failCount = 0;
    retryAfter = 0;
    if (bad) reportDead(bad, '审计 spool 解析失败');

    const st = await fs.promises.stat(SPOOL_PATH).catch(() => null);
    if (!st || consumed >= st.size) {
      await fs.promises.unlink(SPOOL_PATH).catch(() => undefined);
      spoolBytes = 0;
      return;
    }
    const tmp = SPOOL_PATH + '.tmp';
    await pipeline(
      fs.createReadStream(SPOOL_PATH, { start: consumed }),
      fs.createWriteStream(tmp, { mode: 0o600 }),
    );
    await fs.promises.rename(tmp, SPOOL_PATH);
    spoolBytes = st.size - consumed;
  } catch (e: any) {
    if (e?.code === 'ENOENT') {
      spoolBytes = 0;
      return;
    }
    throw e;
  } finally {
    rl?.close();
    draining = false;
  }
}

export async function flushAudit(): Promise<void> {
  if (flushing) return;
  if (Date.now() < retryAfter) return;
  if (queue.length === 0) {
    await drainSpool().catch((e) => {
      retryAfter = Date.now() + 5000;
      console.error('[audit] spool 写入失败：' + (e?.message || e));
    });
    return;
  }
  flushing = true;
  const batch = queue.splice(0, FLUSH_BATCH);
  try {
    await insertBatch(batch);
    failCount = 0;
    retryAfter = 0;
  } catch (e: any) {
    // 审计失败不影响业务；批次回队重试，超过上限进入死信计数，避免静默丢数据
    failCount++;
    const retry: AuditRow[] = [];
    for (const row of batch) {
      const n = (retryTimes.get(row) || 0) + 1;
      retryTimes.set(row, n);
      if (n <= 3) retry.push(row);
      else deadCount++;
    }
    if (retry.length) queue.unshift(...retry);
    retryAfter = Date.now() + 5000;
    if (failCount === 1 || failCount % 20 === 0) {
      console.error(`[audit] 写入失败（累计 ${failCount} 次，死信 ${deadCount} 条）：${e?.message || e}`);
    }
  } finally {
    flushing = false;
    if (!retryAfter) {
      if (queue.length >= FLUSH_BATCH) void flushAudit();
      else if (spoolBytes > 0) void flushAudit();
    }
  }
}

/** 进程退出前调用，尽量把队列和 spool 刷完 */
export async function shutdownAudit(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  const deadline = Date.now() + 3000;
  while ((queue.length || spoolBytes > 0) && Date.now() < deadline) {
    const before = failCount;
    await flushAudit();
    if (failCount > before) break;
  }
}

export function nowStr(): string {
  return fmtDateTime(new Date());
}
