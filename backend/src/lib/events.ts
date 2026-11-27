import { createHmac, randomBytes } from 'node:crypto';
import { query, table } from '../db.js';
import { safeFetch } from './netGuard.js';
import { decryptText } from './secret.js';

export interface EventSubscription {
  id: number;
  name: string;
  url: string;
  secret: string;
  events: string;
  active: number;
}

export function normalizeEventNames(input: any): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\s,]+/) : [];
  const out = new Set<string>();
  for (const item of raw) {
    const name = String(item || '').trim();
    if (!name) continue;
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(name)) throw new Error(`无效的事件名：${name}`);
    out.add(name);
  }
  // 空列表必须保持为空：调用方清空选择时不能被静默解释为订阅全部事件。
  return [...out];
}

const SUBS_CACHE_TTL_MS = 30_000;
let subsCache: { at: number; rows: EventSubscription[] } | null = null;

export function invalidateEventSubscriptions(): void {
  subsCache = null;
}

async function activeSubscriptions(): Promise<EventSubscription[]> {
  if (subsCache && Date.now() - subsCache.at < SUBS_CACHE_TTL_MS) return subsCache.rows;
  const rows = await query<EventSubscription>(
    `SELECT * FROM ${table('event_subscription')} WHERE active = 1`,
  );
  subsCache = { at: Date.now(), rows };
  return rows;
}

function subscriptionEvents(value: any): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function deliverToSubscription(sub: EventSubscription, event: string, data: any): Promise<void> {
  const started = Date.now();
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data,
  });
  let status = 0;
  let error = '';
  try {
    const secret = decryptText(String(sub.secret || ''));
    // 解密失败时绝不能把密文当 HMAC 密钥：接收端永远无法用配置的 secret 校验成功。
    if (!secret) throw new Error('事件密钥无法解密，请重新保存订阅密钥');
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const res = await safeFetch(
      sub.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'dnsmgr-pro/events',
          'X-DNSMGR-Event': event,
          'X-DNSMGR-Signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      },
      3,
      { requirePinnedDns: true },
    );
    status = res.status;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      error = `HTTP ${res.status}${text ? ' ' + text.replace(/\s+/g, ' ').slice(0, 300) : ''}`;
    }
  } catch (e: any) {
    error = String(e?.message || e).slice(0, 300);
  }
  const ok = status >= 200 && status < 300;
  enqueueDeliveryLog({
    subId: sub.id,
    event,
    status: ok ? 'success' : 'failed',
    httpStatus: status,
    error: error || null,
    durationMs: Date.now() - started,
  });
  queueSubscriptionUpdate(sub.id, ok, error || null);
}

interface DeliveryLogRow {
  subId: number;
  event: string;
  status: string;
  httpStatus: number;
  error: string | null;
  durationMs: number;
}

const deliveryLogs: DeliveryLogRow[] = [];
const subscriptionUpdates = new Map<number, { ok: boolean; error: string | null }>();
let deliveryFlushTimer: NodeJS.Timeout | null = null;
let deliveryFlushing = false;

function enqueueDeliveryLog(row: DeliveryLogRow): void {
  deliveryLogs.push(row);
  scheduleDeliveryFlush(deliveryLogs.length >= 100);
}

function queueSubscriptionUpdate(subId: number, ok: boolean, error: string | null): void {
  subscriptionUpdates.set(subId, { ok, error: error ? error.slice(0, 300) : null });
  scheduleDeliveryFlush(false);
}

function scheduleDeliveryFlush(immediate: boolean): void {
  if (deliveryFlushing) return;
  if (!deliveryFlushTimer) {
    deliveryFlushTimer = setTimeout(() => {
      deliveryFlushTimer = null;
      void flushDeliveryLogs();
    }, immediate ? 0 : 1000);
    deliveryFlushTimer.unref?.();
  } else if (immediate) {
    // 已排队但还没到 1s 的 flush 直接提前执行，避免批量阈值触发了仍要等计时器。
    clearTimeout(deliveryFlushTimer);
    deliveryFlushTimer = setTimeout(() => {
      deliveryFlushTimer = null;
      void flushDeliveryLogs();
    }, 0);
    deliveryFlushTimer.unref?.();
  }
}

async function flushDeliveryLogs(): Promise<void> {
  if (deliveryFlushing || (!deliveryLogs.length && !subscriptionUpdates.size)) return;
  deliveryFlushing = true;
  const logs = deliveryLogs.splice(0, 500);
  const updates = [...subscriptionUpdates];
  subscriptionUpdates.clear();
  try {
    if (logs.length) {
      const placeholders = logs.map(() => '(?, ?, ?, ?, ?, ?, NOW())').join(',');
      await query(
        `INSERT INTO ${table('event_delivery')}
          (sub_id, event, status, http_status, error, duration_ms, created_at)
         VALUES ${placeholders}`,
        logs.flatMap((r) => [r.subId, r.event, r.status, r.httpStatus, r.error, r.durationMs]),
      );
    }
    for (const [subId, value] of updates) {
      await query(
        `UPDATE ${table('event_subscription')}
            SET last_status = ?, last_error = ?, last_sent_at = NOW()
          WHERE id = ?`,
        [value.ok ? 1 : 0, value.error, subId],
      );
    }
  } catch (e: any) {
    console.error('[events] 投递记录批量写入失败:', e?.message || e);
    // 失败时放回队列等待重试：投递记录和订阅 last_status 不能因为一次瞬时数据库错误丢失。
    if (logs.length) deliveryLogs.unshift(...logs.slice(0, Math.max(0, 1000 - deliveryLogs.length)));
    for (const [subId, value] of updates) if (!subscriptionUpdates.has(subId)) subscriptionUpdates.set(subId, value);
  } finally {
    deliveryFlushing = false;
    if (deliveryLogs.length || subscriptionUpdates.size) scheduleDeliveryFlush(false);
  }
}

/** 等待当前队列落库；订阅测试需要立即读取 last_status，不能等 1s 防抖。 */
export async function flushEventDeliveries(): Promise<void> {
  if (deliveryFlushTimer) {
    clearTimeout(deliveryFlushTimer);
    deliveryFlushTimer = null;
  }
  while (deliveryFlushing) await new Promise((resolve) => setTimeout(resolve, 10));
  await flushDeliveryLogs();
}

const MAX_CONCURRENT_DELIVERIES = 4;
const MAX_PENDING_DELIVERIES = 1000;
let activeDeliveries = 0;
const pendingDeliveries: Array<() => Promise<void>> = [];

function pumpDeliveries(): void {
  while (activeDeliveries < MAX_CONCURRENT_DELIVERIES && pendingDeliveries.length) {
    const task = pendingDeliveries.shift()!;
    activeDeliveries++;
    void task()
      .catch(() => undefined)
      .finally(() => {
        activeDeliveries--;
        pumpDeliveries();
      });
  }
}

function enqueueDelivery(task: () => Promise<void>): void {
  // 外部回调持续失败/变慢时，队列不能无界增长；丢弃最旧任务比拖垮进程更安全。
  if (pendingDeliveries.length >= MAX_PENDING_DELIVERIES) pendingDeliveries.shift();
  pendingDeliveries.push(task);
  pumpDeliveries();
}

export async function emitEvent(event: string, data: any): Promise<void> {
  try {
    const rows = await activeSubscriptions();
    for (const row of rows) {
      const events = subscriptionEvents(row.events);
      if (!events.includes('*') && !events.includes(event)) continue;
      // 有界队列：事件风暴时不能为每个订阅同时发起外网请求
      enqueueDelivery(() => deliverToSubscription(row, event, data));
    }
  } catch {
    /* 事件回调不影响主流程 */
  }
}

export function newEventSecret(): string {
  return randomBytes(24).toString('base64url');
}
