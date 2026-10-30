import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { clampLimit, clampOffset } from '../lib/util.js';

function parseJson(v: any): any {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

function shape(row: any): any {
  return {
    ...row,
    detail: parseJson(row.detail),
    result: parseJson(row.result),
  };
}

export default async function jobRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: (app as any).authenticate };
  const admin = (user: any) => Number(user?.level || 0) >= 2;

  app.get('/api/jobs', auth, async (req: any) => {
    const limit = clampLimit(req.query?.limit, 20, 100);
    const offset = clampOffset(req.query?.offset);
    const type = String(req.query?.type || '').trim();
    const status = String(req.query?.status || '').trim();
    const where: string[] = [];
    const params: any[] = [];
    if (!admin(req.user)) {
      where.push('uid = ?');
      params.push(Number(req.user.uid));
    } else if (req.query?.uid) {
      where.push('uid = ?');
      params.push(Number(req.query.uid));
    }
    if (type) {
      where.push('type = ?');
      params.push(type);
    }
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const total = Number((await queryOne(`SELECT COUNT(*) AS c FROM ${table('async_job')}${whereSql}`, params))?.c || 0);
    const rows = await query(
      `SELECT * FROM ${table('async_job')}${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { code: 0, data: { total, list: rows.map(shape) } };
  });

  app.get('/api/jobs/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row = await queryOne(`SELECT * FROM ${table('async_job')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '任务不存在' };
    if (!admin(req.user) && Number(row.uid) !== Number(req.user.uid)) return { code: -1, msg: '无权限' };
    return { code: 0, data: shape(row) };
  });
}
