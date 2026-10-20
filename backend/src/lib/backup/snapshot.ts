import { getPool } from '../../db.js';

export type SnapshotRead = (sql: string, params?: any[]) => Promise<any[]>;

/**
 * 单连接一致性快照读取。
 * 多表逐次查询必须共用同一连接与同一个 REPEATABLE READ 快照，否则各表时间点不同，
 * 恢复后可能出现「用户存在但权限不存在」这类断链。
 */
export async function readSnapshot<T>(fn: (read: SnapshotRead) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const read: SnapshotRead = async (sql, params = []) => {
      const [rows] = await conn.query(sql, params);
      return rows as any[];
    };
    const out = await fn(read);
    await conn.query('COMMIT');
    return out;
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}
