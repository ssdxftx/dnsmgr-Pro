import type { FastifyInstance } from 'fastify';
import { query, queryOne, table, isDuplicateError } from '../db.js';
import { configGet } from '../config.js';
import { checkLevel } from '../auth.js';
import { canAccessDomainAccount } from '../lib/accounts/visibility.js';
import { fmtDateTime, fmtTimestamp, hasOwn, escapeLike, clampLimit, clampOffset } from '../lib/util.js';

// 容灾监控接口仅管理员可用
const authenticate = (app: FastifyInstance) => ({
  preHandler: async (req: any, reply: any) => {
    await (app as any).authenticate(req, reply);
    if (!req.user) return;
    if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
  },
});

function fmt(ts: number): string {
  return fmtTimestamp(ts);
}

// 心跳最多每 30s 落库一次，判定阈值取 90s（心跳周期的 3 倍），避免正常抖动被误判为异常
const RUN_STATE_STALE_MS = 90000;

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

export default async function dmonitorRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  app.get('/api/dmonitor/overview', auth, async () => {
    const day = fmtDateTime(new Date(Date.now() - 24 * 3600 * 1000));
    const switchCount = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE date >= ?`, [day]);
    const failCount = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE date >= ? AND action = 1`, [day]);

    const runTime = await configGet('run_time');
    let runState = 0;
    if (runTime) {
      const t = new Date(runTime.replace(/-/g, '/')).getTime();
      runState = Date.now() - t > RUN_STATE_STALE_MS ? 0 : 1;
    }

    return {
      code: 0,
      data: {
        run_count: parseInt((await configGet('run_count')) || '0'),
        run_time: runTime || '无',
        run_state: runState,
        run_error: await configGet('run_error'),
        switch_count: switchCount?.c ?? 0,
        fail_count: failCount?.c ?? 0,
      },
    };
  });

  app.get('/api/dmonitor/domains', auth, async (req: any) => {
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

  app.get('/api/dmonitor/tasks', auth, async (req: any) => {
    const q = req.query || {};
    const kw = q.kw || '';
    const status = q.status;
    const offset = clampOffset(q.offset);
    const limit = clampLimit(q.limit);
    const sort = q.sortName || '';
    const orderDir = String(q.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const searchType = Number(q.type || 1);

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
        where += ' AND A.main_value = ?';
        params.push(kw);
      } else if (searchType === 4) {
        where += ' AND A.backup_value = ?';
        params.push(kw);
      } else if (searchType === 5) {
        where += " AND A.remark LIKE ? ESCAPE '!'";
        params.push('%' + escapeLike(kw) + '%');
      }
    }
    if (!isNullOrEmpty(status)) {
      where += ' AND A.status = ?';
      params.push(Number(status));
    }

    const totalRow = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${table('dmtask')} A JOIN ${table('domain')} B ON A.did = B.id JOIN ${table('account')} C ON B.aid = C.id WHERE 1=1 AND (C.visibility <> 'private' OR C.owner_uid = ?)${where}`,
      [Number(req.user.uid), ...params]
    );
    const total = totalRow?.c ?? 0;

    const allowedSort: Record<string, string> = {
      id: 'A.id', rr: 'A.rr', main_value: 'A.main_value', type: 'A.type', checktype: 'A.checktype',
      frequency: 'A.frequency', status: 'A.status', active: 'A.active', checktimestr: 'A.checktime',
      addtimestr: 'A.addtime', remark: 'A.remark',
    };
    const orderBy = hasOwn(allowedSort, sort) ? `${allowedSort[sort]} ${orderDir}` : 'A.id DESC';

    const list = await query(
      `SELECT A.*, B.name AS domain FROM ${table('dmtask')} A JOIN ${table('domain')} B ON A.did = B.id JOIN ${table('account')} C ON B.aid = C.id WHERE 1=1 AND (C.visibility <> 'private' OR C.owner_uid = ?)${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [Number(req.user.uid), ...params, limit, offset]
    );

    const rows = list.map((r: any) => ({
      ...r,
      addtimestr: fmt(r.addtime),
      checktimestr: r.checktime > 0 ? fmt(r.checktime) : '未运行',
    }));

    return { code: 0, data: { total, list: rows } };
  });

  app.post('/api/dmonitor/tasks', auth, async (req: any) => {
    const b = req.body || {};
    const task = {
      did: Number(b.did),
      rr: (b.rr || '').trim(),
      recordid: (b.recordid || '').trim(),
      type: Number(b.type),
      main_value: (b.main_value || '').trim(),
      backup_value: (b.backup_value || '').trim(),
      checktype: Number(b.checktype),
      checkurl: (b.checkurl || '').trim(),
      tcpport: b.tcpport ? Number(b.tcpport) : null,
      frequency: Number(b.frequency),
      cycle: Number(b.cycle),
      timeout: Number(b.timeout),
      proxy: Number(b.proxy || 0),
      cdn: b.cdn === true || b.cdn === 'true' || b.cdn === 1 || b.cdn === '1' ? 1 : 0,
      remark: (b.remark || '').trim(),
      recordinfo: (b.recordinfo || '').trim(),
      addtime: Math.floor(Date.now() / 1000),
      active: 1,
    };

    if (!task.did || !task.rr || !task.recordid || !task.main_value || !task.frequency || !task.cycle) {
      return { code: -1, msg: '必填项不能为空' };
    }
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    if (task.checktype > 0 && task.timeout > task.frequency) {
      return { code: -1, msg: '为保障容灾切换任务正常运行，最大超时时间不能大于检测间隔' };
    }
    if (task.type === 2 && task.backup_value === task.main_value) {
      return { code: -1, msg: '主备地址不能相同' };
    }
    const exists = await queryOne(`SELECT id FROM ${table('dmtask')} WHERE recordid = ?`, [task.recordid]);
    if (exists) return { code: -1, msg: '当前容灾切换策略已存在' };

    try {
      await query(
        `INSERT INTO ${table('dmtask')} (did, rr, recordid, type, main_value, backup_value, checktype, checkurl, tcpport, frequency, cycle, timeout, proxy, cdn, remark, recordinfo, addtime, active, owner_uid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [task.did, task.rr, task.recordid, task.type, task.main_value, task.backup_value, task.checktype, task.checkurl, task.tcpport, task.frequency, task.cycle, task.timeout, task.proxy, task.cdn, task.remark, task.recordinfo, task.addtime, task.active, Number(req.user.uid)]
      );
    } catch (e: any) {
      // 唯一索引兜底：并发双击时先用后插的窗口被数据库拦下
      if (isDuplicateError(e)) return { code: -1, msg: '当前容灾切换策略已存在' };
      throw e;
    }
    return { code: 0, msg: '添加成功' };
  });

  app.put('/api/dmonitor/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const current: any = await queryOne(`SELECT did FROM ${table('dmtask')} WHERE id = ?`, [id]);
    if (!current) return { code: -1, msg: '任务不存在' };
    if (!(await canAccessDomainAccount(current.did, req.user))) return { code: -1, msg: '无权限操作该任务的域名账户' };
    const b = req.body || {};
    const task = {
      did: Number(b.did),
      rr: (b.rr || '').trim(),
      recordid: (b.recordid || '').trim(),
      type: Number(b.type),
      main_value: (b.main_value || '').trim(),
      backup_value: (b.backup_value || '').trim(),
      checktype: Number(b.checktype),
      checkurl: (b.checkurl || '').trim(),
      tcpport: b.tcpport ? Number(b.tcpport) : null,
      frequency: Number(b.frequency),
      cycle: Number(b.cycle),
      timeout: Number(b.timeout),
      proxy: Number(b.proxy || 0),
      cdn: b.cdn === true || b.cdn === 'true' || b.cdn === 1 || b.cdn === '1' ? 1 : 0,
      remark: (b.remark || '').trim(),
      recordinfo: (b.recordinfo || '').trim(),
    };

    if (!task.did || !task.rr || !task.recordid || !task.main_value || !task.frequency || !task.cycle) {
      return { code: -1, msg: '必填项不能为空' };
    }
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    if (task.checktype > 0 && task.timeout > task.frequency) {
      return { code: -1, msg: '为保障容灾切换任务正常运行，最大超时时间不能大于检测间隔' };
    }
    if (task.type === 2 && task.backup_value === task.main_value) {
      return { code: -1, msg: '主备地址不能相同' };
    }
    const exists = await queryOne(`SELECT id FROM ${table('dmtask')} WHERE recordid = ? AND id <> ?`, [task.recordid, id]);
    if (exists) return { code: -1, msg: '当前容灾切换策略已存在' };

    await query(
      `UPDATE ${table('dmtask')} SET did=?, rr=?, recordid=?, type=?, main_value=?, backup_value=?, checktype=?, checkurl=?, tcpport=?, frequency=?, cycle=?, timeout=?, proxy=?, cdn=?, remark=?, recordinfo=? WHERE id=?`,
      [task.did, task.rr, task.recordid, task.type, task.main_value, task.backup_value, task.checktype, task.checkurl, task.tcpport, task.frequency, task.cycle, task.timeout, task.proxy, task.cdn, task.remark, task.recordinfo, id]
    );
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/dmonitor/tasks/:id/active', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task: any = await queryOne(`SELECT did FROM ${table('dmtask')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '任务不存在' };
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    const active = Number((req.body || {}).active) === 1 ? 1 : 0;
    await query(`UPDATE ${table('dmtask')} SET active = ? WHERE id = ?`, [active, id]);
    return { code: 0, msg: '设置成功' };
  });

  app.delete('/api/dmonitor/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task: any = await queryOne(`SELECT did FROM ${table('dmtask')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '任务不存在' };
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    await query(`DELETE FROM ${table('dmtask')} WHERE id = ?`, [id]);
    await query(`DELETE FROM ${table('dmlog')} WHERE taskid = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/dmonitor/tasks/batch', auth, async (req: any) => {
    const { act, ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return { code: -1, msg: '参数错误' };
    const list = [...new Set(ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0))];
    if (!list.length) return { code: -1, msg: '参数错误' };
    // 批量语句替代逐条 SQL（原实现 2N 条）
    const ph = list.map(() => '?').join(',');
    const tasks: any[] = await query(`SELECT did FROM ${table('dmtask')} WHERE id IN (${ph})`, list);
    for (const task of tasks) {
      if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限操作该域名的私有账户' };
    }
    let success = 0;
    if (act === 'delete') {
      await query(`DELETE FROM ${table('dmlog')} WHERE taskid IN (${ph})`, list);
      const res: any = await query(`DELETE FROM ${table('dmtask')} WHERE id IN (${ph})`, list);
      success = Number(res?.affectedRows ?? list.length);
    } else if (act === 'retry') {
      await query(`UPDATE ${table('dmtask')} SET checknexttime = ? WHERE id IN (${ph})`, [Math.floor(Date.now() / 1000), ...list]);
      // UPDATE 在目标值本就相同时 affectedRows 为 0，不能据此判失败，未报错即视为成功
      success = list.length;
    } else if (act === 'open' || act === 'close') {
      await query(`UPDATE ${table('dmtask')} SET active = ? WHERE id IN (${ph})`, [act === 'open' ? 1 : 0, ...list]);
      success = list.length;
    }
    return { code: 0, msg: '成功操作' + success + '个容灾切换策略' };
  });

  app.get('/api/dmonitor/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task = await queryOne(
      `SELECT A.*, B.name AS domain FROM ${table('dmtask')} A JOIN ${table('domain')} B ON A.did = B.id WHERE A.id = ?`,
      [id]
    );
    if (!task) return { code: -1, msg: '切换策略不存在' };
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限查看该域名的私有账户任务' };
    const day = fmtDateTime(new Date(Date.now() - 24 * 3600 * 1000));
    const switchCount = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE taskid = ? AND date >= ?`, [id, day]);
    const failCount = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE taskid = ? AND date >= ? AND action = 1`, [id, day]);
    task.switch_count = switchCount?.c ?? 0;
    task.fail_count = failCount?.c ?? 0;
    return { code: 0, data: task };
  });

  app.get('/api/dmonitor/tasks/:id/logs', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task: any = await queryOne(`SELECT did FROM ${table('dmtask')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '切换策略不存在' };
    if (!(await canAccessDomainAccount(task.did, req.user))) return { code: -1, msg: '无权限查看该域名的私有账户任务' };
    const q = req.query || {};
    const action = Number(q.action || 0);
    const offset = clampOffset(q.offset);
    const limit = clampLimit(q.limit);
    let where = 'taskid = ?';
    const params: any[] = [id];
    if (action > 0) {
      where += ' AND action = ?';
      params.push(action);
    }
    const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE ${where}`, params);
    const list = await query(`SELECT * FROM ${table('dmlog')} WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { code: 0, data: { total: totalRow?.c ?? 0, list } };
  });

  app.post('/api/dmonitor/clean', auth, async (req: any) => {
    const days = Number((req.body || {}).days);
    if (!days || days < 0) return { code: -1, msg: '参数错误' };
    const threshold = fmtDateTime(new Date(Date.now() - days * 24 * 3600 * 1000));
    await query(`DELETE FROM ${table('dmlog')} WHERE date < ?`, [threshold]);
    return { code: 0, msg: '清理成功' };
  });

  app.get('/api/dmonitor/status', auth, async () => {
    const runTime = await configGet('run_time');
    let runState = 0;
    if (runTime) {
      const t = new Date(runTime.replace(/-/g, '/')).getTime();
      runState = Date.now() - t > RUN_STATE_STALE_MS ? 0 : 1;
    }
    return runState === 1 ? { code: 0, data: 'ok' } : { code: 0, data: 'error' };
  });
}