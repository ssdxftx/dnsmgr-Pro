import { query, queryOne, table } from '../../db.js';
import { configGet } from '../../config.js';
import { CertOrderService } from '../certService.js';
import { CertDeployService } from '../deployService.js';
import { certOrderSend, certDeploySend } from '../monitor/msgNotice.js';
import { processOrderLink } from '../cdn/certLink.js';

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

const FAIL_STATUSES = [-2, -3, -4, -5, -6, -7];
// 调度器会推进的订单状态：0 已排队、1/2 进行中、负数失败待重试
const ACTIVE_STATUSES = [0, 1, 2, ...FAIL_STATUSES];

type QueryFn = <T = any>(sql: string, params?: any[]) => Promise<T[]>;

export function parseHour(value: unknown, def: number): number {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,2}$/.test(raw)) return def;
  const n = Number(raw);
  return n >= 0 && n <= 23 ? n : def;
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
      WHERE isauto = 1 AND status = 3 AND islock = 0
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
       WHERE isauto = 1 AND islock = 0
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
      WHERE D.active = 1 AND D.islock = 0 AND D.retry < ?
        AND O.status = 3 AND O.fullchain IS NOT NULL AND O.privatekey IS NOT NULL
        AND (D.status = 0 OR (D.status < 0 AND D.retrytime IS NOT NULL AND D.retrytime <= NOW()))
      ORDER BY D.id ASC LIMIT ?`,
    [DEPLOY_MAX_RETRY, DEPLOY_LIMIT],
  );
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
    certOrderSend(id, true).catch(() => undefined);
    console.log(`[cert] 订单 ${id} 自动续签成功`);
  } else if (Number(row.status) < 0) {
    certOrderSend(id, false).catch(() => undefined);
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
    certDeploySend(id, true).catch(() => undefined);
    console.log(`[cert] 部署任务 ${id} 自动部署成功`);
  } else if (Number(row.status) < 0) {
    certDeploySend(id, false).catch(() => undefined);
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
        WHERE id = ? AND status = 3 AND islock = 0`,
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
  for (const row of rows) {
    await processOrder(row.id);
  }
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
  new CertOrderService(id)
    .process()
    .catch((e: any) => console.log(`[cert] 订单 ${id} 立即处理未完成: ${e?.message}`));
}

export async function certTaskRun(): Promise<void> {
  const start = parseHour(await configGet('deploy_hour_start', '0'), 0);
  const end = parseHour(await configGet('deploy_hour_end', '23'), 23);
  if (!inRunWindow(new Date().getHours(), start, end)) return;

  const days = Number(await configGet('cert_renewdays', '7')) || 7;
  const renewed = await renewExpiringOrders(days);
  const continued = await continueRunningOrders();
  const deployed = await deployPendingTasks();
  if (renewed || continued || deployed) {
    console.log(`[cert] 本轮调度：续签 ${renewed} 个、推进 ${continued} 个订单、部署 ${deployed} 个任务`);
  }
}