import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { audit } from '../lib/audit/context.js';

const TYPES = new Set(['info', 'success', 'warning', 'error']);
const MAX_TITLE = 120;
const MAX_CONTENT = 5000;

const authenticate = (app: FastifyInstance) => ({
  preHandler: async (req: any, reply: any) => {
    await (app as any).authenticate(req, reply);
    if (!req.user) return;
    if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
  },
});

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 返回 undefined 表示格式非法，null 表示留空 */
function normalizeDate(value: any): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : formatDate(d);
  }
  const s = String(value).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return undefined;
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6] || '00'),
  );
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3]) ||
    d.getHours() !== Number(m[4]) ||
    d.getMinutes() !== Number(m[5]) ||
    d.getSeconds() !== Number(m[6] || '00')
  ) {
    return undefined;
  }
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}`;
}

function auditValue(field: string, value: any): string {
  if (value == null) return '';
  if (field === 'starttime' || field === 'endtime') {
    const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) return formatDate(d);
  }
  return String(value);
}

function clampSort(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-999999, Math.min(999999, Math.trunc(n)));
}

function parseBody(body: any): { error?: string; value?: { title: string; content: string; type: string; active: number; sort_order: number; starttime: string | null; endtime: string | null } } {
  const title = String(body?.title ?? '').trim();
  const content = String(body?.content ?? '').trim();
  if (!title) return { error: '公告标题不能为空' };
  if (title.length > MAX_TITLE) return { error: `公告标题不能超过 ${MAX_TITLE} 个字符` };
  if (!content) return { error: '公告内容不能为空' };
  if (content.length > MAX_CONTENT) return { error: `公告内容不能超过 ${MAX_CONTENT} 个字符` };

  const rawType = String(body?.type ?? 'info');
  const type = TYPES.has(rawType) ? rawType : 'info';
  const active = Number(body?.active) === 0 ? 0 : 1;
  const sort_order = clampSort(body?.sort_order);

  const starttime = body?.starttime === undefined ? null : normalizeDate(body.starttime);
  if (starttime === undefined) return { error: '开始时间格式应为 YYYY-MM-DD HH:mm:ss' };
  const endtime = body?.endtime === undefined ? null : normalizeDate(body.endtime);
  if (endtime === undefined) return { error: '结束时间格式应为 YYYY-MM-DD HH:mm:ss' };
  if (starttime && endtime && endtime <= starttime) return { error: '结束时间必须晚于开始时间' };

  return { value: { title, content, type, active, sort_order, starttime, endtime } };
}

function publicRow(row: any) {
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    type: row.type,
    sort_order: Number(row.sort_order || 0),
    starttime: row.starttime,
    endtime: row.endtime,
    addtime: row.addtime,
    updatetime: row.updatetime,
  };
}

export default async function announcementRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // 公开：登录/注册页与仪表盘读取当前有效公告
  app.get('/api/announcements', async () => {
    const rows = await query(
      `SELECT id, title, content, type, sort_order, starttime, endtime, addtime, updatetime
         FROM ${table('announcement')}
        WHERE active = 1
          AND (starttime IS NULL OR starttime <= NOW())
          AND (endtime IS NULL OR endtime > NOW())
        ORDER BY sort_order DESC, id DESC
        LIMIT 20`,
    );
    return { code: 0, data: rows.map(publicRow) };
  });

  // 管理员：公告列表（含停用与未到时间的公告）
  app.get('/api/system/announcements', auth, async () => {
    const rows = await query(
      `SELECT id, title, content, type, active, sort_order, starttime, endtime, addtime, updatetime
         FROM ${table('announcement')}
        ORDER BY sort_order DESC, id DESC
        LIMIT 500`,
    );
    return { code: 0, data: rows };
  });

  // 管理员：新建公告
  app.post('/api/system/announcements', auth, async (req: any) => {
    const parsed = parseBody(req.body || {});
    if (parsed.error || !parsed.value) return { code: -1, msg: parsed.error || '参数错误' };
    const v = parsed.value;
    const res: any = await query(
      `INSERT INTO ${table('announcement')} (title, content, type, active, sort_order, starttime, endtime, addtime, updatetime)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [v.title, v.content, v.type, v.active, v.sort_order, v.starttime, v.endtime],
    );
    const id = Number(res?.insertId || 0);
    audit(req, {
      module: 'system',
      action: 'system.announcement.create',
      targetType: 'announcement',
      targetId: id,
      targetName: v.title,
      summary: `发布公告：${v.title}`,
      detail: { type: v.type, active: v.active, sort_order: v.sort_order, starttime: v.starttime, endtime: v.endtime },
    });
    return { code: 0, msg: '公告已发布', data: { id } };
  });

  // 管理员：修改公告
  app.put('/api/system/announcements/:id', auth, async (req: any) => {
    const id = Number(req.params?.id);
    if (!Number.isInteger(id) || id <= 0) return { code: -1, msg: '公告不存在' };
    const before: any = await queryOne(`SELECT * FROM ${table('announcement')} WHERE id = ? LIMIT 1`, [id]);
    if (!before) return { code: -1, msg: '公告不存在' };

    const parsed = parseBody(req.body || {});
    if (parsed.error || !parsed.value) return { code: -1, msg: parsed.error || '参数错误' };
    const v = parsed.value;
    await query(
      `UPDATE ${table('announcement')}
          SET title = ?, content = ?, type = ?, active = ?, sort_order = ?, starttime = ?, endtime = ?, updatetime = NOW()
        WHERE id = ?`,
      [v.title, v.content, v.type, v.active, v.sort_order, v.starttime, v.endtime, id],
    );

    const changes: Array<{ field: string; from: string; to: string }> = [];
    for (const field of ['title', 'type', 'active', 'sort_order', 'starttime', 'endtime'] as const) {
      const from = auditValue(field, before[field]);
      const to = auditValue(field, v[field]);
      if (from !== to) changes.push({ field, from, to });
    }
    audit(req, {
      module: 'system',
      action: 'system.announcement.update',
      targetType: 'announcement',
      targetId: id,
      targetName: v.title,
      summary: `修改公告：${v.title}`,
      changes,
      detail: { active: v.active, sort_order: v.sort_order, starttime: v.starttime, endtime: v.endtime },
    });
    return { code: 0, msg: '公告已更新' };
  });

  // 管理员：启用/停用公告
  app.post('/api/system/announcements/:id/status', auth, async (req: any) => {
    const id = Number(req.params?.id);
    if (!Number.isInteger(id) || id <= 0) return { code: -1, msg: '公告不存在' };
    const row: any = await queryOne(`SELECT id, title, active FROM ${table('announcement')} WHERE id = ? LIMIT 1`, [id]);
    if (!row) return { code: -1, msg: '公告不存在' };
    const active = Number(req.body?.active) === 0 ? 0 : 1;
    await query(`UPDATE ${table('announcement')} SET active = ?, updatetime = NOW() WHERE id = ?`, [active, id]);
    audit(req, {
      module: 'system',
      action: 'system.announcement.status',
      targetType: 'announcement',
      targetId: id,
      targetName: row.title,
      summary: `${active ? '启用' : '停用'}公告：${row.title}`,
      changes: [{ field: 'active', from: String(row.active), to: String(active) }],
    });
    return { code: 0, msg: active ? '公告已启用' : '公告已停用' };
  });

  // 管理员：删除公告
  app.delete('/api/system/announcements/:id', auth, async (req: any) => {
    const id = Number(req.params?.id);
    if (!Number.isInteger(id) || id <= 0) return { code: -1, msg: '公告不存在' };
    const row: any = await queryOne(`SELECT id, title FROM ${table('announcement')} WHERE id = ? LIMIT 1`, [id]);
    if (!row) return { code: -1, msg: '公告不存在' };
    await query(`DELETE FROM ${table('announcement')} WHERE id = ?`, [id]);
    audit(req, {
      module: 'system',
      action: 'system.announcement.delete',
      targetType: 'announcement',
      targetId: id,
      targetName: row.title,
      summary: `删除公告：${row.title}`,
    });
    return { code: 0, msg: '公告已删除' };
  });
}
