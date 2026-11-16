import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { preheatUrls, purgeUrls, calcNextRun, loadUrls } from '../lib/cdn/preheatService.js';
import { fmtDateTime, parseRunTime } from '../lib/util.js';
import { withDistributedLock } from '../lib/scheduler/distLock.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

const MAX_PREHEAT_URLS = 200;

/** 归一化并限制任务 URL 数：避免单任务保存数万条 URL 后在调度器内产生海量 DB/上游调用 */
function normalizeTaskUrls(raw: any): { text: string; error?: string } {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return { text: '', error: '请填写需要预热的链接' };
  if (lines.length > MAX_PREHEAT_URLS) return { text: '', error: `单个任务最多 ${MAX_PREHEAT_URLS} 个链接` };
  return { text: lines.join('\n') };
}

export default async function preheatRoutes(app: FastifyInstance) {
  const auth = authenticate(app);
  const isSuper = (req: any) => Number(req.user?.is_super || 0) === 1;
  const loadTask = async (req: any, id: number): Promise<any | null> => {
    const row: any = await queryOne(`SELECT * FROM ${table('cdn_preheat_task')} WHERE id = ?`, [id]);
    if (!row) return null;
    if (!isSuper(req) && Number(row.owner_uid) !== Number(req.user.uid)) return null;
    return row;
  };

  // 任务列表
  app.get('/api/cdn/preheat-tasks', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const rows = isSuper(req)
      ? await query(`SELECT * FROM ${table('cdn_preheat_task')} ORDER BY id DESC`)
      : await query(`SELECT * FROM ${table('cdn_preheat_task')} WHERE owner_uid = ? ORDER BY id DESC`, [Number(req.user.uid)]);
    return { code: 0, data: rows };
  });

  // 新建任务
  app.post('/api/cdn/preheat-tasks', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const b = req.body || {};
    const normalized = normalizeTaskUrls(b.urls);
    if (normalized.error) return { code: -1, msg: normalized.error };
    const urls = normalized.text;
    const cycle = b.cycle === 'interval' ? 'interval' : 'daily';
    const intervalMin = b.cycle === 'interval' ? Number(b.interval_min) || 0 : 0;
    const runTime = cycle === 'daily' ? String(b.run_time || '00:00') : null;
    const op = b.op === 'purge' ? 'purge' : 'preheat';
    if (cycle === 'interval' && intervalMin < 5) return { code: -1, msg: '预热间隔不能少于 5 分钟' };
    if (cycle === 'daily' && !parseRunTime(runTime).valid) return { code: -1, msg: '执行时间格式不正确，应为 HH:mm' };
    const nextRun = fmtDateTime(calcNextRun(cycle, intervalMin, runTime));
    const id: number = await query(
      `INSERT INTO ${table('cdn_preheat_task')} (name, urls, op, cycle, interval_min, run_time, active, next_run, addtime, owner_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [String(b.name || ''), urls, op, cycle, intervalMin, runTime, b.active == 0 ? 0 : 1, nextRun, Number(req.user.uid)],
    ).then((r: any) => r.insertId || 0);
    return { code: 0, msg: '创建成功', data: id };
  });

  // 编辑任务
  app.put('/api/cdn/preheat-tasks/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row: any = await loadTask(req, id);
    if (!row) return { code: -1, msg: '任务不存在' };
    const b = req.body || {};
    const normalized = normalizeTaskUrls(b.urls ?? row.urls);
    if (normalized.error) return { code: -1, msg: normalized.error };
    const urls = normalized.text;
    const cycle = b.cycle === undefined ? String(row.cycle || 'daily') : b.cycle === 'interval' ? 'interval' : 'daily';
    const intervalMin = cycle === 'interval' ? Number(b.interval_min ?? row.interval_min) || 0 : 0;
    const runTime = cycle === 'daily' ? String(b.run_time ?? row.run_time ?? '00:00') : null;
    const op = b.op === undefined ? (row.op === 'purge' ? 'purge' : 'preheat') : b.op === 'purge' ? 'purge' : 'preheat';
    const active = b.active === undefined ? Number(row.active || 0) : b.active == 0 ? 0 : 1;
    if (cycle === 'interval' && intervalMin < 5) return { code: -1, msg: '预热间隔不能少于 5 分钟' };
    if (cycle === 'daily' && !parseRunTime(runTime).valid) return { code: -1, msg: '执行时间格式不正确，应为 HH:mm' };
    const nextRun = fmtDateTime(calcNextRun(cycle, intervalMin, runTime));
    await query(
      `UPDATE ${table('cdn_preheat_task')} SET name = ?, urls = ?, op = ?, cycle = ?, interval_min = ?, run_time = ?, active = ?, next_run = ? WHERE id = ?`,
      [String(b.name ?? row.name ?? ''), urls, op, cycle, intervalMin, runTime, active, nextRun, id],
    );
    return { code: 0, msg: '保存成功' };
  });

  // 启用 / 停用
  app.post('/api/cdn/preheat-tasks/:id/toggle', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row = await loadTask(req, id);
    if (!row) return { code: -1, msg: '任务不存在' };
    const active = (req.body || {}).active == 1 ? 1 : 0;
    await query(`UPDATE ${table('cdn_preheat_task')} SET active = ? WHERE id = ?`, [active, id]);
    return { code: 0, msg: active ? '已启用' : '已停用' };
  });

  // 立即执行
  app.post('/api/cdn/preheat-tasks/:id/run', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row: any = await loadTask(req, id);
    if (!row) return { code: -1, msg: '任务不存在' };
    let result: { success: number; failed: number } | null = null;
    const locked = await withDistributedLock('dnsmgr:preheat', async () => {
      const urls = loadUrls(row.urls);
      result = row.op === 'purge' ? await purgeUrls(urls, Number(row.owner_uid) || 0) : await preheatUrls(urls, Number(row.owner_uid) || 0);
      const next = fmtDateTime(calcNextRun(row.cycle, row.interval_min, row.run_time));
      await query(`UPDATE ${table('cdn_preheat_task')} SET last_run = NOW(), next_run = ? WHERE id = ?`, [next, id]);
    });
    if (!locked) return { code: -1, msg: '自动预热任务正在执行，请稍后再试' };
    return { code: 0, ...(result || { success: 0, failed: 0 }) };
  });

  // 删除任务
  app.delete('/api/cdn/preheat-tasks/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row = await loadTask(req, id);
    if (!row) return { code: -1, msg: '任务不存在' };
    await query(`DELETE FROM ${table('cdn_preheat_task')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });
}