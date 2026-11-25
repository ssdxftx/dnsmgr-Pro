import { query, queryOne, table } from '../../db.js';
import { configGet } from '../../config.js';
import { CertOrderService } from '../certService.js';
import { CertDeployService } from '../deployService.js';
import { certOrderSend, certDeploySend } from '../monitor/msgNotice.js';
import { processOrderLink, logDeployResult, logOrderFailure } from '../cdn/certLink.js';
import { emitEvent } from '../events.js';

// 处理失败后再次尝试的冷却时间（分钟）
const FAIL_RETRY_COOLDOWN_MIN = 5;
// 提交 DNS 记录后等待生效的时间（秒），用于给调度器一个下次推进的时间点
const DNS_WAIT_SECONDS = 300;
// 单次调度最多处理的订单/任务数，避免一次性打满上游接口
const RENEW_LIMIT = 5;
const CONTINUE_LIMIT = 10;
const DEPLOY_LIMIT = 10;
// 与 CertDeployService.process() 的重试上限保持一致
const DEPLOY_MAX_RETRY = 6;
// 通知失败后的重试策略：只扫描最近 7 天记录，每个目标最多重试 5 次，间隔 5 分钟
const NOTICE_RETRY_BATCH = 5;
const NOTICE_MAX_ATTEMPTS = 5;
const NOTICE_RETRY_DELAY_MS = 5 * 60_000;
const NOTICE_RETRY_WINDOW_DAYS = 7;

const FAIL_STATUSES = [-1, -2, -3, -4, -5, -6, -7];
// 调度器会推进的订单状态：0 已排队、1/2 进行中、负数失败待重试
const ACTIVE_STATUSES = [0, 1, 2, ...FAIL_STATUSES];

type QueryFn = <T = any>(sql: string, params?: any[]) => Promise<T[]>;

export function parseHour(value: unknown, def: number): number {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,2}$/.test(raw)) return def;
  const n = Number(raw);
  return n >= 0 && n <= 23 ? n : def;
}

export function parseRenewDays(value: unknown, def = 7): number {
  const raw = String(value ?? '').trim();
  if (raw === '') return def;
  if (!/^\d+$/.test(raw)) return def;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 60 ? n : def;
}

export function validateRenewDays(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  if (!/^\d+$/.test(raw)) return '自动续签天数必须为 0~60 的整数';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 60) return '自动续签天数必须为 0~60 的整数';
  return null;
}

// 支持跨天时段，例如 22 至 6；起止相同视为不限制
export function inRunWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end ? hour >= start && hour <= end : hour >= start || hour <= end;
}

// 到达续签时间点、且开启自动续签的已签发订单
export async function findRenewOrders(days: number, q: QueryFn = query): Promise<any[]> {
  return q(
    `SELECT id FROM ${table('cert_order')}
      WHERE isauto = 1 AND status = 3
        AND (islock = 0 OR islock IS NULL OR locktime IS NULL OR locktime < DATE_SUB(NOW(), INTERVAL 1 HOUR))
        AND aid > 0
        AND expiretime IS NOT NULL AND expiretime <= DATE_ADD(NOW(), INTERVAL ? DAY)
      ORDER BY expiretime ASC LIMIT ?`,
    [days, RENEW_LIMIT],
  );
}

// 需要推进的订单：等待验证/签发到期，或刚创建/已排队的订单。统一以数据库时钟为准
export async function findRunningOrders(q: QueryFn = query): Promise<any[]> {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
  return q(
    `SELECT id FROM ${table('cert_order')}
       WHERE isauto = 1
         AND (islock = 0 OR islock IS NULL OR locktime IS NULL OR locktime < DATE_SUB(NOW(), INTERVAL 1 HOUR))
         AND COALESCE(retry2, 0) < 3
         AND status IN (${placeholders})
         AND (retrytime IS NULL OR retrytime <= NOW())
       ORDER BY retrytime ASC LIMIT ?`,
    [...ACTIVE_STATUSES, CONTINUE_LIMIT],
  );
}

// 待部署任务：仅处理证书已签发且未吊销、任务处于启用状态的任务
export async function findDeployTasks(q: QueryFn = query): Promise<any[]> {
  return q(
    `SELECT D.id FROM ${table('cert_deploy')} D
       JOIN ${table('cert_order')} O ON O.id = D.oid
      WHERE D.active = 1
        AND (D.islock = 0 OR D.islock IS NULL OR D.locktime IS NULL OR D.locktime < DATE_SUB(NOW(), INTERVAL 1 HOUR))
        AND D.retry < ?
        AND O.status = 3 AND O.fullchain IS NOT NULL AND O.privatekey IS NOT NULL
        AND (D.status = 0 OR (D.status < 0 AND D.retrytime IS NOT NULL AND D.retrytime <= NOW()))
      ORDER BY D.id ASC LIMIT ?`,
    [DEPLOY_MAX_RETRY, DEPLOY_LIMIT],
  );
}

// 已成功但通知未发完的订单：状态 3 不会进入 findRunningOrders，需要单独扫描。
export async function findUnsentOrderNotices(q: QueryFn = query): Promise<any[]> {
  return q(
    `SELECT id FROM ${table('cert_order')}
      WHERE status = 3 AND issend = 0
        AND COALESCE(updatetime, issuetime, addtime) >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND COALESCE(updatetime, issuetime, addtime) <= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
      ORDER BY COALESCE(updatetime, issuetime, addtime) ASC LIMIT ?`,
    [NOTICE_RETRY_WINDOW_DAYS, NOTICE_RETRY_BATCH],
  );
}

// 已部署成功但通知未发完的任务：同样不在 findDeployTasks 的待处理状态里。
export async function findUnsentDeployNotices(q: QueryFn = query): Promise<any[]> {
  return q(
    `SELECT id FROM ${table('cert_deploy')}
      WHERE status = 1 AND issend = 0
        AND COALESCE(lasttime, issuetime, addtime) >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND COALESCE(lasttime, issuetime, addtime) <= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
      ORDER BY COALESCE(lasttime, issuetime, addtime) ASC LIMIT ?`,
    [NOTICE_RETRY_WINDOW_DAYS, NOTICE_RETRY_BATCH],
  );
}

type NoticeKind = 'order' | 'deploy';
const noticeRetryState = new Map<string, { attempts: number; nextAt: number }>();

function noticeKey(kind: NoticeKind, id: number): string {
  return `${kind}:${id}`;
}

function canSendNotice(kind: NoticeKind, id: number): boolean {
  const state = noticeRetryState.get(noticeKey(kind, id));
  if (!state) return true;
  if (state.attempts >= NOTICE_MAX_ATTEMPTS) return false;
  return Date.now() >= state.nextAt;
}

function noteNoticeResult(kind: NoticeKind, id: number, sent: boolean): void {
  const key = noticeKey(kind, id);
  if (sent) {
    noticeRetryState.delete(key);
    return;
  }
  const attempts = (noticeRetryState.get(key)?.attempts || 0) + 1;
  if (noticeRetryState.size >= 1000 && !noticeRetryState.has(key)) {
    const oldest = noticeRetryState.keys().next().value;
    if (oldest) noticeRetryState.delete(oldest);
  }
  noticeRetryState.set(key, { attempts, nextAt: Date.now() + NOTICE_RETRY_DELAY_MS });
  if (attempts >= NOTICE_MAX_ATTEMPTS) {
    console.warn(`[notice] ${kind} ${id} 通知连续失败 ${attempts} 次，停止本轮重试`);
  }
}

async function retryUnsentNotices(): Promise<number> {
  const [orders, deploys] = await Promise.all([findUnsentOrderNotices(), findUnsentDeployNotices()]);
  let sent = 0;
  for (const row of orders as any[]) {
    const id = Number(row.id);
    if (!canSendNotice('order', id)) continue;
    const ok = await certOrderSend(id, true).catch(() => false);
    noteNoticeResult('order', id, ok);
    if (ok) sent++;
  }
  for (const row of deploys as any[]) {
    const id = Number(row.id);
    if (!canSendNotice('deploy', id)) continue;
    const ok = await certDeploySend(id, true).catch(() => false);
    noteNoticeResult('deploy', id, ok);
    if (ok) sent++;
  }
  return sent;
}

// 记录下一次推进时间点：全部使用数据库时钟，避免应用与数据库时区不一致
async function ensureNextRun(id: number): Promise<void> {
  const row = await queryOne(`SELECT status, retrytime FROM ${table('cert_order')} WHERE id = ?`, [id]);
  if (!row) return;
  const status = Number(row.status);
  if (status === 0 || FAIL_STATUSES.includes(status)) {
    await query(`UPDATE ${table('cert_order')} SET retrytime = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`, [FAIL_RETRY_COOLDOWN_MIN, id]);
  } else if ((status === 1 || status === 2) && !row.retrytime) {
    await query(`UPDATE ${table('cert_order')} SET retrytime = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?`, [DNS_WAIT_SECONDS, id]);
  }
}

async function processOrder(id: number): Promise<void> {
  let error: any = null;
  try {
    await new CertOrderService(id).process();
  } catch (e: any) {
    error = e;
  }
  await ensureNextRun(id).catch(() => undefined);

  const row = await queryOne(`SELECT status, issend FROM ${table('cert_order')} WHERE id = ?`, [id]);
  if (!row) return;
  if (Number(row.status) === 3) {
    // 与项目联动：签发成功后按订单 link 自动创建 CDN 部署任务（签发失败则不创建）
    await processOrderLink(id).catch((e: any) => console.log(`[cert] 订单 ${id} 创建联动部署任务失败: ${e?.message}`));
  }
  if (row.issend) {
    if (error) console.log(`[cert] 订单 ${id} 处理未完成: ${error?.message}`);
    return;
  }
  if (Number(row.status) === 3) {
    // 每个处理周期只通知一次（续签重置时会把 issend 清 0）
    if (canSendNotice('order', id)) {
      void certOrderSend(id, true)
        .then((sent) => noteNoticeResult('order', id, sent))
        .catch(() => noteNoticeResult('order', id, false));
    }
    void emitEvent('cert.order.issued', { order_id: id });
    console.log(`[cert] 订单 ${id} 自动续签成功`);
  } else if (Number(row.status) < 0) {
    if (canSendNotice('order', id)) {
      void certOrderSend(id, false)
        .then((sent) => noteNoticeResult('order', id, sent))
        .catch(() => noteNoticeResult('order', id, false));
    }
    void emitEvent('cert.order.failed', { order_id: id, error: error?.message || row.error || '未知错误' });
    logOrderFailure(id, error?.message || row.error || '未知错误').catch(() => undefined);
    console.log(`[cert] 订单 ${id} 处理失败: ${error?.message || '未知错误'}`);
  } else if (error) {
    console.log(`[cert] 订单 ${id} 处理未完成: ${error?.message}`);
  }
}

async function processDeployTask(id: number): Promise<void> {
  let error: any = null;
  try {
    await new CertDeployService(id).process();
  } catch (e: any) {
    error = e;
  }

  const row = await queryOne(`SELECT status, issend FROM ${table('cert_deploy')} WHERE id = ?`, [id]);
  if (!row) return;
  if (row.issend) {
    if (error) console.log(`[cert] 部署任务 ${id} 未完成: ${error?.message}`);
    return;
  }
  if (Number(row.status) === 1) {
    if (canSendNotice('deploy', id)) {
      void certDeploySend(id, true)
        .then((sent) => noteNoticeResult('deploy', id, sent))
        .catch(() => noteNoticeResult('deploy', id, false));
    }
    void emitEvent('cert.deploy.success', { task_id: id });
    logDeployResult(id, 1).catch(() => undefined);
    console.log(`[cert] 部署任务 ${id} 自动部署成功`);
  } else if (Number(row.status) < 0) {
    if (canSendNotice('deploy', id)) {
      void certDeploySend(id, false)
        .then((sent) => noteNoticeResult('deploy', id, sent))
        .catch(() => noteNoticeResult('deploy', id, false));
    }
    void emitEvent('cert.deploy.failed', { task_id: id, error: error?.message || '未知错误' });
    logDeployResult(id, -1, error?.message || '未知错误').catch(() => undefined);
    console.log(`[cert] 部署任务 ${id} 部署失败: ${error?.message || '未知错误'}`);
  } else if (error) {
    console.log(`[cert] 部署任务 ${id} 未完成: ${error?.message}`);
  }
}

// 到期自动续签：重置为待处理并立即开始申请新证书（沿用原订单，自动部署任务无需重新关联）
async function renewExpiringOrders(days: number): Promise<number> {
  const rows = await findRenewOrders(days);
  for (const row of rows) {
    const res: any = await query(
      `UPDATE ${table('cert_order')}
        SET status = 0, retry = 0, retry2 = 0, retrytime = NOW(), processid = NULL,
            error = NULL, updatetime = NOW(), issend = 0, islock = 0
        WHERE id = ? AND status = 3
          AND (islock = 0 OR islock IS NULL OR locktime IS NULL OR locktime < DATE_SUB(NOW(), INTERVAL 1 HOUR))`,
      [row.id],
    );
    if (!res?.affectedRows) continue;
    console.log(`[cert] 订单 ${row.id} 到达续签时间，开始自动续签`);
    await processOrder(row.id);
  }
  return rows.length;
}

async function continueRunningOrders(): Promise<number> {
  const rows = await findRunningOrders();
  // 单个订单可能因 DNS 验证等待数分钟；有限并发推进，避免一个慢订单堵住整轮续签。
  const concurrency = Math.min(3, rows.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= rows.length) return;
      try {
        await processOrder(rows[index].id);
      } catch (e: any) {
        console.log(`[cert] 订单 ${rows[index].id} 推进失败: ${e?.message || e}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return rows.length;
}

async function deployPendingTasks(): Promise<number> {
  const rows = await findDeployTasks();
  for (const row of rows) {
    await processDeployTask(row.id);
  }
  return rows.length;
}

// 新建订单后立即在后台推进一次，用户无需再点「处理」；与调度器通过订单锁互斥
export function kickOrderProcessing(id: number): void {
  if (!id) return;
  // 复用调度器的完整处理流程（含签发成功后创建 CDN 联动部署任务）
  processOrder(id).catch((e: any) => console.log(`[cert] 订单 ${id} 立即处理未完成: ${e?.message}`));
}

export async function certTaskRun(): Promise<void> {
  // 通知重试不受签发时段限制：已成功但通知失败的记录只在状态 3，必须通过独立查询补发。
  await retryUnsentNotices().catch((e: any) => console.warn('[notice] 通知重试失败：' + (e?.message || e)));

  const start = parseHour(await configGet('deploy_hour_start', '0'), 0);
  const end = parseHour(await configGet('deploy_hour_end', '23'), 23);
  if (!inRunWindow(new Date().getHours(), start, end)) return;

  const days = parseRenewDays(await configGet('cert_renewdays', '7'));
  const renewed = await renewExpiringOrders(days);
  // 订单签发可能被 ACME 的 DNS 验证等待数分钟；部署任务与之并行推进，
  // 否则同一轮里已签发证书的部署会被慢订单饿死。
  const [continued, deployed] = await Promise.all([continueRunningOrders(), deployPendingTasks()]);
  if (renewed || continued || deployed) {
    console.log(`[cert] 本轮调度：续签 ${renewed} 个、推进 ${continued} 个订单、部署 ${deployed} 个任务`);
  }
}