import { readSnapshot as readDriverSnapshot } from '../../db.js';

export type SnapshotRead = (sql: string, params?: any[]) => Promise<any[]>;

/**
 * 单连接一致性快照读取。
 * MySQL 使用 REPEATABLE READ + CONSISTENT SNAPSHOT；SQLite 使用独立连接的 BEGIN 事务。
 * 多表逐次查询必须共用同一快照，否则各表时间点不同，恢复后可能出现「用户存在但权限不存在」这类断链。
 */
export async function readSnapshot<T>(fn: (read: SnapshotRead) => Promise<T>): Promise<T> {
  return readDriverSnapshot(fn);
}
