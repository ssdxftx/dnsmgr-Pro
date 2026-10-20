import type { PoolConnection } from 'mysql2/promise';
import { getPool } from '../../db.js';

// 基于 MySQL 命名锁（GET_LOCK）的跨实例互斥：水平扩容时保证同一定时任务只有一个副本执行。
// waitSeconds=0 表示不等待，抢不到锁直接跳过本轮（适合 cron 语义）。
export async function withDistributedLock(
  name: string,
  fn: () => Promise<unknown>,
  waitSeconds = 0,
): Promise<boolean> {
  let conn: PoolConnection;
  try {
    conn = await getPool().getConnection();
  } catch {
    return false;
  }
  try {
    const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [name, waitSeconds]);
    const ok = Array.isArray(rows) && Number((rows[0] as any)?.ok) === 1;
    if (!ok) return false;
    try {
      await fn();
      return true;
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => undefined);
    }
  } finally {
    conn.release();
  }
}
