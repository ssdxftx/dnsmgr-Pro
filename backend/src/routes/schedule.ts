import type { FastifyInstance } from 'fastify';
import { query, queryOne, table, isDuplicateError } from '../db.js';
import { fmtTimestamp, hasOwn, escapeLike, clampLimit, clampOffset } from '../lib/util.js';
import { checkLevel } from '../auth.js';
import { canAccessDomainAccount } from '../lib/accounts/visibility.js';
import { getDnsProvider } from '../lib/dns/factory.js';
import { loadAccountConfig } from '../lib/accounts/taskConfig.js';
import { executeOne, updateNexttime } from '../lib/schedule/scheduleService.js';

// 定时切换解析接口仅管理员可用
const authenticate = (app: FastifyInstance) => ({
  preHandler: async (req: any, reply: any) => {
    await (app as any).authenticate(req, reply);
    if (!req.user) return;
    if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
  },
});

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

async function validateTaskRecord(did: number, recordid: string): Promise<string | null> {
  const d: any = await queryOne(
    `SELECT D.name, D.thirdid, A.type, A.config, A.owner_uid FROM ${table('domain')} D JOIN ${table('account')} A ON D.aid = A.id WHERE D.id = ?`,
    [Number(did)],
  );
  if (!d) return '域名不存在';
  let provider: any = null;
  try {
    provider = getDnsProvider(d.type, await loadAccountConfig({ config: d.config, owner_uid: d.owner_uid }), d.name, d.thirdid);
  } catch {
    return '账户配置无法解密';
  }
  if (!provider) return '该 DNS 厂商暂不支持';
  if (typeof provider.getDomainRecordInfo !== 'function') return null;
  const info = await Promise.resolve()
    .then(() => provider.getDomainRecordInfo(String(recordid)))
    .catch(() => false);
  if (!info) return '所选解析记录不属于当前域名，请重新选择';
  if (!info.Type || info.Value === null || info.Value === undefined) return '请选择具体解析记录（主机汇总行不可用）';
  return null;
}

export default async function scheduleRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  app.get('/api/schedule/domains', auth, async (req: any) => {
    const kw = String(req.query?.kw ?? '').trim();
    const where = kw ? " AND A.name LIKE ? ESCAPE '!'" : '';
    const params: any[] = [Number(req.user.uid)];
    if (kw) params.push('%' + escapeLike(kw) + '%');
    const rows = await query(
      `SELECT A.id, A.name, B.type FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id
        WHERE (B.visibility <> 'private' OR B.owner_uid = ?)${where} ORDER BY A.id DESC LIMIT 2000`,
      params,
    );
    return { code: 0, data: rows };
  });

  app.get('/api/schedule/tasks', auth, async (req: any) => {
    const q = req.query || {};
    const kw = q.kw || '';
    const stype = q.stype;
    const searchType = Number(q.type || 1);
    const offset = clampOffset(q.offset);
    const limit = clampLimit(q.limit);
    const sort = q.sortName || '';
    const orderDir = String(q.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let where = '';
    const params: any[] = [];
    if (kw) {
      if (searchType === 1) {
        where += " AND (A.rr LIKE ? ESCAPE '!' OR B.name LIKE ? ESCAPE '!')";
        params.push('%' + escapeLike(kw) + '%', '%' + escapeLike(kw) + '%');
      } else if (searchType === 2) {
        where += ' AND A.recordid = ?';
        params.push(kw);
      } else if (searchType === 3) {
        where += ' AND A.value = ?';
        params.push(kw);
      } else if (searchType === 4) {
        where += " AND A.remark LIKE ? ESCAPE '!'";
        params.push('%' + escapeLike(kw) + '%');
      }
    }
    if (!isNullOrEmpty(stype)) {
      where += ' AND A.type = ?';
      params.push(Number(stype));
    }

    const totalRow = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${table('sctask')} A JOIN ${table('domain')} B ON A.did = B.id JOIN ${table('account')} C ON B.aid = C.id WHERE 1=1 AND (C.visibility <> 'private' OR C.owner_uid = ?)${where}`,
      [Number(req.user.uid), ...params]
    );
    const total = totalRow?.c ?? 0;

    const allowedSort: Record<string, string> = {
      id: 'A.id', rr: 'A.rr', type: 'A.type', switchtype: 'A.switchtype', active: 'A.active',
      updatetimestr: 'A.updatetime', nexttimestr: 'A.nexttime', addtimestr: 'A.addtime', remark: 'A.remark',
    };
    const orderBy = hasOwn(allowedSort, sort) ? `${allowedSort[sort]} ${orderDir}` : 'A.id DESC';

    const list = await query(
      `SELECT A.*, B.name AS domain FROM ${table('sctask')} A JOIN ${table('domain')} B ON A.did = B.id JOIN ${table('account')} C ON B.aid = C.id WHERE 1=1 AND (C.visibility <> 'private' OR C.owner_uid = ?)${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [Number(req.user.uid), ...params, limit, offset]
    );

    const rows = list.map((r: any) => ({
      ...r,
      addtimestr: fmtTimestamp(r.addtime),
      updatetimestr: r.updatetime > 0 ? fmtTimestamp(r.updatetime) : '未运行',
      nexttimestr: r.nexttime > 0 ? fmtTimestamp(r.nexttime) : '无',
    }));

    return { code: 0, data: { total, list: rows } };
  });

  app.get('/api/schedule/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task = await queryOne(`SELECT * FROM ${table('sctask')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '切换策略不存在' };
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限查看该域名的私有账户任务' };
    return { code: 0, data: task };
  });

  app.post('/api/schedule/tasks', auth, async (req: any) => {
    const b = req.body || {};
    let val: any;
    try {
      val = buildTask(b);
    } catch (e: any) {
      return { code: -1, msg: e?.message || '参数错误' };
    }
    if (!val.did || !val.rr || !val.recordid) return { code: -1, msg: '必填项不能为空' };
    if (!(await canAccessDomainAccount(val.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    const recordErr = await validateTaskRecord(val.did, val.recordid);
    if (recordErr) return { code: -1, msg: recordErr };
    const exists = await queryOne(
      `SELECT id FROM ${table('sctask')} WHERE did = ? AND recordid = ? AND switchtype = ? AND switchtime = ?`,
      [val.did, val.recordid, val.switchtype, val.switchtime]
    );
    if (exists) return { code: -1, msg: '当前定时切换策略已存在' };

    try {
      await query(
        `INSERT INTO ${table('sctask')} (did, rr, recordid, type, cycle, switchtype, switchdate, switchtime, value, line, remark, recordinfo, addtime, active, owner_uid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [val.did, val.rr, val.recordid, val.type, val.cycle, val.switchtype, val.switchdate, val.switchtime, val.value, val.line, val.remark, val.recordinfo, Math.floor(Date.now() / 1000), 1, Number(req.user.uid)]
      );
    } catch (e: any) {
      if (isDuplicateError(e)) return { code: -1, msg: '当前定时切换策略已存在' };
      throw e;
    }
    const idRow = await queryOne(`SELECT id FROM ${table('sctask')} WHERE did = ? AND recordid = ? AND switchtype = ? AND switchtime = ? ORDER BY id DESC LIMIT 1`, [val.did, val.recordid, val.switchtype, val.switchtime]);
    if (idRow) {
      const row = await queryOne(`SELECT * FROM ${table('sctask')} WHERE id = ?`, [idRow.id]);
      if (row) await updateNexttime(row);
    }
    return { code: 0, msg: '添加成功' };
  });

  app.put('/api/schedule/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    // 必须先校验任务原有的域名归属，否则可通过自增 id 覆盖他人的私有账户任务
    const current: any = await queryOne(`SELECT did FROM ${table('sctask')} WHERE id = ?`, [id]);
    if (!current) return { code: -1, msg: '任务不存在' };
    if (!(await canAccessDomainAccount(current.did, req.user))) return { code: -1, msg: '无权限操作该任务的域名账户' };
    const b = req.body || {};
    let val: any;
    try {
      val = buildTask(b);
    } catch (e: any) {
      return { code: -1, msg: e?.message || '参数错误' };
    }
    if (!val.did || !val.rr || !val.recordid) return { code: -1, msg: '必填项不能为空' };
    if (!(await canAccessDomainAccount(val.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    const recordErr = await validateTaskRecord(val.did, val.recordid);
    if (recordErr) return { code: -1, msg: recordErr };
    const exists = await queryOne(
      `SELECT id FROM ${table('sctask')} WHERE did = ? AND recordid = ? AND switchtype = ? AND switchtime = ? AND id <> ?`,
      [val.did, val.recordid, val.switchtype, val.switchtime, id]
    );
    if (exists) return { code: -1, msg: '当前定时切换策略已存在' };

    await query(
      `UPDATE ${table('sctask')} SET did=?, rr=?, recordid=?, type=?, cycle=?, switchtype=?, switchdate=?, switchtime=?, value=?, line=?, remark=?, recordinfo=? WHERE id=?`,
      [val.did, val.rr, val.recordid, val.type, val.cycle, val.switchtype, val.switchdate, val.switchtime, val.value, val.line, val.remark, val.recordinfo, id]
    );
    const row = await queryOne(`SELECT * FROM ${table('sctask')} WHERE id = ?`, [id]);
    if (row) await updateNexttime(row);
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/schedule/tasks/:id/run', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task: any = await queryOne(`SELECT * FROM ${table('sctask')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '切换策略不存在' };
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    try {
      await executeOne(task);
      await query(`UPDATE ${table('sctask')} SET retry = 0 WHERE id = ?`, [id]);
      await updateNexttime(task);
      return { code: 0, msg: '已执行一次定时切换' };
    } catch (e: any) {
      return { code: -1, msg: e?.message || '执行失败' };
    }
  });

  app.post('/api/schedule/tasks/:id/active', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task: any = await queryOne(`SELECT did FROM ${table('sctask')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '切换策略不存在' };
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    const active = Number((req.body || {}).active) === 1 ? 1 : 0;
    // 重新启用等同于给任务一次干净的重试机会；否则之前累计的失败次数会在下一次
    // 失败时立刻把它再次停用。
    if (active) {
      await query(`UPDATE ${table('sctask')} SET active = 1, retry = 0 WHERE id = ?`, [id]);
    } else {
      await query(`UPDATE ${table('sctask')} SET active = 0 WHERE id = ?`, [id]);
    }
    return { code: 0, msg: '设置成功' };
  });

  app.delete('/api/schedule/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task: any = await queryOne(`SELECT did FROM ${table('sctask')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '切换策略不存在' };
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    await query(`DELETE FROM ${table('sctask')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/schedule/tasks/batch', auth, async (req: any) => {
    const { act, ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return { code: -1, msg: '参数错误' };
    const list = [...new Set(ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0))];
    if (!list.length) return { code: -1, msg: '参数错误' };
    const ph = list.map(() => '?').join(',');
    const tasks: any[] = await query(`SELECT did FROM ${table('sctask')} WHERE id IN (${ph})`, list);
    for (const task of tasks) {
      if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    }
    let success = 0;
    if (act === 'delete') {
      const res: any = await query(`DELETE FROM ${table('sctask')} WHERE id IN (${ph})`, list);
      success = Number(res?.affectedRows ?? list.length);
    } else if (act === 'open' || act === 'close') {
      if (act === 'open') {
        await query(`UPDATE ${table('sctask')} SET active = 1, retry = 0 WHERE id IN (${ph})`, list);
      } else {
        await query(`UPDATE ${table('sctask')} SET active = 0 WHERE id IN (${ph})`, list);
      }
      // UPDATE 在目标值本就相同时 affectedRows 为 0，未报错即视为成功
      success = list.length;
    }
    return { code: 0, msg: '成功操作' + success + '个定时切换策略' };
  });
}

function buildTask(b: Record<string, any>) {
  const val = {
    did: Number(b.did),
    rr: (b.rr || '').trim(),
    recordid: (b.recordid || '').trim(),
    type: Number(b.type),
    cycle: Number(b.cycle),
    switchtype: Number(b.switchtype),
    switchdate: (b.switchdate !== undefined && b.switchdate !== null ? String(b.switchdate) : '').trim(),
    switchtime: (b.switchtime || '').trim(),
    value: (b.value || '').trim(),
    line: (b.line || '').trim(),
    remark: (b.remark || '').trim(),
    recordinfo: (b.recordinfo || '').trim(),
  };
  // 周期任务的下标必须在这里就校验：switchdate 越界（如 cycle=2 传 0）会让
  // updateNexttime 算出「永远已到期」的时刻，任务被每 60s 反复执行。
  if (val.type === 1) {
    if (val.cycle === 2) {
      const day = Number(val.switchdate);
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('每月日期必须在 1-31 之间');
    } else if (val.cycle === 1) {
      const weekday = Number(val.switchdate);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('每周星期必须在 0-6 之间');
    }
    if (!/^([01]?\d|2[0-3]):[0-5]\d/.test(val.switchtime)) throw new Error('执行时间格式应为 HH:mm');
  }
  return val;
}