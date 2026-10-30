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
  return out.size ? [...out] : ['*'];
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
    const secret = decryptText(String(sub.secret || '')) ?? String(sub.secret || '');
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
  await query(
    `INSERT INTO ${table('event_delivery')}
      (sub_id, event, status, http_status, error, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [sub.id, event, ok ? 'success' : 'failed', status, error || null, Date.now() - started],
  ).catch(() => undefined);
  await query(
    `UPDATE ${table('event_subscription')}
        SET last_status = ?, last_error = ?, last_sent_at = NOW()
      WHERE id = ?`,
    [ok ? 1 : 0, error ? error.slice(0, 300) : null, sub.id],
  ).catch(() => undefined);
}

export async function emitEvent(event: string, data: any): Promise<void> {
  try {
    const rows: EventSubscription[] = await query(
      `SELECT * FROM ${table('event_subscription')} WHERE active = 1`,
    );
    for (const row of rows) {
      const events = subscriptionEvents(row.events);
      if (!events.includes('*') && !events.includes(event)) continue;
      void deliverToSubscription(row, event, data);
    }
  } catch {
    /* 事件回调不影响主流程 */
  }
}

export function newEventSecret(): string {
  return randomBytes(24).toString('base64url');
}
