import { withDistributedLockResult as lockWithDriver } from '../../db.js';

export interface LockOutcome<T> {
  locked: boolean;
  result?: T;
}

// MySQL 使用命名锁（GET_LOCK）实现跨实例互斥；SQLite 使用进程内命名锁。
// waitSeconds=0 表示不等待，抢不到锁直接跳过本轮（适合 cron 语义）。
export async function withDistributedLockResult<T>(
  name: string,
  fn: () => Promise<T>,
  waitSeconds = 0,
): Promise<LockOutcome<T>> {
  return lockWithDriver(name, fn, waitSeconds);
}

export async function withDistributedLock(
  name: string,
  fn: () => Promise<unknown>,
  waitSeconds = 0,
): Promise<boolean> {
  return (await withDistributedLockResult(name, fn, waitSeconds)).locked;
}
