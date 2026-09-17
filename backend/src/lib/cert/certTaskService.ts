import { query, queryOne, table } from '../../db.js';
import { configGet } from '../../config.js';
import { CertOrderService } from '../certService.js';
import { certOrderSend } from '../monitor/msgNotice.js';

// 处理失败后再次尝试的冷却时间（分钟）
const FAIL_RETRY_COOLDOWN_MIN = 5;
// 提交 DNS 记录后等待生效的时间（秒），用于给调度器一个下次推进的时间点
const DNS_WAIT_SECONDS = 300;
// 单次调度最多处理的订单数，避免一次性打满上游接口
const RENEW_LIMIT = 5;
const CONTINUE_LIMIT = 10;

const FAIL_STATUSES = [-2, -3, -4, -5, -6, -7];

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

// 进行中的订单：等待验证/签发到期，或失败后已过冷却时间
export async function findRunningOrders(q: QueryFn = query): Promise<any[]> {
  const placeholders = FAIL_STATUSES.map(() => '?').join(',');
  return q(
    `SELECT id FROM ${table('cert_order')}
      WHERE isauto = 1 AND islock = 0
        AND (
          (status IN (0, 1, 2) AND retrytime IS NOT NULL AND retrytime <= NOW())
          OR (status IN (${placeholders}) AND updatetime <= DATE_SUB(NOW(), INTERVAL ? MINUTE))
        )
      ORDER BY updatetime ASC LIMIT ?`,
    [...FAIL_STATUSES, FAIL_RETRY_COOLDOWN_MIN, CONTINUE_LIMIT],
  );
}

async function processOrder(id: number): Promise<void> {
  const service = new CertOrderService(id);
  try {
    const code = await service.process();
    if (code === 3) {
      // 签发成功：每个处理周期只通知一次
      const row = await queryOne(`SELECT issend FROM ${table('cert_order')} WHERE id = ?`, [id]);
      if (!row?.issend) {
        certOrderSend(id, true).catch(() => undefined);
        console.log(`[cert] 订单 ${id} 自动续签成功`);
      }
    } else if (code === 1) {
      // 等待 DNS 生效：补一个推进时间点，避免停留在无 retrytime 的等待态
      await query(`UPDATE ${table('cert_order')} SET retrytime = IFNULL(retrytime, DATE_ADD(NOW(), INTERVAL ? SECOND)) WHERE id = ?`, [DNS_WAIT_SECONDS, id]);
      console.log(`[cert] 订单 ${id} 已提交DNS记录，等待生效`);
    }
  } catch (e: any) {
    const row = await queryOne(`SELECT status, issend FROM ${table('cert_order')} WHERE id = ?`, [id]).catch(() => null);
    // 仅在真正失败（状态为负）且本周期尚未通知时发送失败通知
    if (row && row.status < 0 && !row.issend) {
      certOrderSend(id, false).catch(() => undefined);
    }
    console.log(`[cert] 订单 ${id} 处理未完成: ${e?.message}`);
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

export async function certTaskRun(): Promise<void> {
  const start = parseHour(await configGet('deploy_hour_start', '0'), 0);
  const end = parseHour(await configGet('deploy_hour_end', '23'), 23);
  if (!inRunWindow(new Date().getHours(), start, end)) return;

  const days = Number(await configGet('cert_renewdays', '7')) || 7;
  const renewed = await renewExpiringOrders(days);
  const continued = await continueRunningOrders();
  if (renewed || continued) {
    console.log(`[cert] 本轮调度：续签 ${renewed} 个、推进 ${continued} 个订单`);
  }
}