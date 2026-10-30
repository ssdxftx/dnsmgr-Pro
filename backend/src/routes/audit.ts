import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { escapeLike, contentDisposition } from '../lib/util.js';

function parseJson(v: any): any {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

const TIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;

export default async function auditRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).authenticate };

  app.get('/api/audit/logs', auth, async (req: any) => {
    const q = req.query || {};
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    const offset = Math.max(0, Number(q.offset) || 0);
    const now = new Date();
    const defStart = new Date(now.getTime() - 7 * 86400_000);

    const startTime = TIME_RE.test(String(q.startTime || '')) ? String(q.startTime) : fmt(defStart);
    const endTime = TIME_RE.test(String(q.endTime || '')) ? String(q.endTime) : fmt(now);

    let where = ' WHERE addtime >= ? AND addtime <= ?';
    const params: any[] = [startTime, endTime];

    if (checkLevel(req.user, 2)) {
      if (q.uid !== undefined && q.uid !== '') {
        where += ' AND uid = ?';
        params.push(Number(q.uid));
      }
    } else {
      where += ' AND uid = ?';
      params.push(Number(req.user.uid));
    }
    for (const [k, col] of [
      ['module', 'module'],
      ['action', 'action'],
    ] as const) {
      if (q[k]) {
        where += ` AND ${col} = ?`;
        params.push(String(q[k]));
      }
    }
    if (q.result === '0' || q.result === '1' || q.result === 0 || q.result === 1) {
      where += ' AND result = ?';
      params.push(Number(q.result));
    }
    if (q.target) {
      where += " AND target_name LIKE ? ESCAPE '!'";
      params.push(`%${escapeLike(String(q.target))}%`);
    }
    if (q.kw) {
      where += " AND (summary LIKE ? ESCAPE '!' OR target_name LIKE ? ESCAPE '!' OR ip LIKE ? ESCAPE '!' OR username LIKE ? ESCAPE '!')";
      const like = `%${escapeLike(String(q.kw))}%`;
      params.push(like, like, like, like);
    }

    const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('audit_log')}${where}`, params);
    const rows = await query(
      `SELECT id, uid, username, auth_type, api_key_id, api_key_name, module, action, method, path, target_type, target_id, target_name,
              summary, detail, changes, result, errmsg, status, ip, ua, cost_ms, addtime
       FROM ${table('audit_log')}${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = Number(totalRow?.c || 0);
    return {
      code: 0,
      data: {
        total,
        // 命中过多时提示缩小时间范围，避免前端误以为只有当前页
        truncated: total > 10000,
        list: (rows as any[]).map((r) => ({ ...r, detail: parseJson(r.detail), changes: parseJson(r.changes) })),
      },
    };
  });

  app.get('/api/audit/logs/export', auth, async (req: any, reply: any) => {
    const q = req.query || {};
    const format = String(q.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
    const limit = Math.min(10000, Math.max(1, Number(q.limit) || 5000));
    const now = new Date();
    const defStart = new Date(now.getTime() - 7 * 86400_000);
    const startTime = TIME_RE.test(String(q.startTime || '')) ? String(q.startTime) : fmt(defStart);
    const endTime = TIME_RE.test(String(q.endTime || '')) ? String(q.endTime) : fmt(now);
    let where = ' WHERE addtime >= ? AND addtime <= ?';
    const params: any[] = [startTime, endTime];
    if (checkLevel(req.user, 2)) {
      if (q.uid !== undefined && q.uid !== '') {
        where += ' AND uid = ?';
        params.push(Number(q.uid));
      }
    } else {
      where += ' AND uid = ?';
      params.push(Number(req.user.uid));
    }
    for (const [k, col] of [['module', 'module'], ['action', 'action']] as const) {
      if (q[k]) {
        where += ` AND ${col} = ?`;
        params.push(String(q[k]));
      }
    }
    if (q.result === '0' || q.result === '1' || q.result === 0 || q.result === 1) {
      where += ' AND result = ?';
      params.push(Number(q.result));
    }
    if (q.kw) {
      const like = `%${escapeLike(String(q.kw))}%`;
      where += " AND (summary LIKE ? ESCAPE '!' OR target_name LIKE ? ESCAPE '!' OR username LIKE ? ESCAPE '!')";
      params.push(like, like, like);
    }
    const rows = await query(
      `SELECT id, uid, username, auth_type, api_key_id, api_key_name, module, action, method, path,
              target_type, target_id, target_name, summary, result, errmsg, status, ip, ua, cost_ms, addtime
         FROM ${table('audit_log')}${where} ORDER BY id DESC LIMIT ?`,
      [...params, limit],
    );
    if (format === 'json') return { code: 0, data: { total: rows.length, list: rows } };
    const header = ['id', 'uid', 'username', 'auth_type', 'api_key_id', 'api_key_name', 'module', 'action', 'method', 'path', 'target_type', 'target_id', 'target_name', 'summary', 'result', 'errmsg', 'status', 'ip', 'ua', 'cost_ms', 'addtime'];
    const lines = [header.join(',')];
    for (const row of rows as any[]) {
      lines.push(header.map((key) => csvCell(row[key])).join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', contentDisposition(`audit-${startTime.slice(0, 10)}.csv`));
    return '\uFEFF' + lines.join('\r\n');
  });

  // 统计卡：今日 / 近 7 天失败 / 近 30 天活跃用户
  app.get('/api/audit/stats', auth, async (req: any) => {
    const scope = checkLevel(req.user, 2) ? '' : ' AND uid = ' + Number(req.user.uid);
    const row = await queryOne<any>(
      `SELECT COUNT(*) AS total,
              SUM(addtime >= CURDATE()) AS today,
              SUM(result = 0 AND addtime >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS failed7d,
              COUNT(DISTINCT CASE WHEN uid > 0 THEN uid END) AS users30d
       FROM ${table('audit_log')}
       WHERE addtime >= DATE_SUB(NOW(), INTERVAL 30 DAY)${scope}`,
    );
    return {
      code: 0,
      data: {
        total: Number(row?.total || 0),
        today: Number(row?.today || 0),
        failed7d: Number(row?.failed7d || 0),
        users30d: Number(row?.users30d || 0),
      },
    };
  });
}

function fmt(d: Date): string {
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function csvCell(value: any): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
