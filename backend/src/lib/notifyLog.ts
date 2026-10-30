import { query, table } from '../db.js';

export function logNotify(
  module: string,
  event: string,
  ok: boolean,
  message: string,
  detail?: any,
): void {
  query(
    `INSERT INTO ${table('notification_log')} (module, event, status, message, detail, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [
      String(module || '').slice(0, 32),
      String(event || '').slice(0, 64),
      ok ? 1 : 0,
      String(message || '').slice(0, 500),
      detail == null ? null : JSON.stringify(detail).slice(0, 8000),
    ],
  ).catch(() => undefined);
}
