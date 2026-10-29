import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel, getUserPermissions, matchPermission, sameDomain } from '../auth.js';
import { checkDomainRecords, calcNextRun, listSubDomains } from '../lib/dns/checkService.js';
import { fmtDateTime, escapeLike } from '../lib/util.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { withDistributedLock } from '../lib/scheduler/distLock.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MIN_INTERVAL_MIN = 5;
const MAX_TASKS_PER_USER = 50;

/** 校验告警邮箱：普通用户只能填写自己的邮箱，避免借系统邮件服务向任意地址发信 */
function noticeEmailErr(user: any, raw: any): string | null {
  const email = String(raw ?? '').trim();
  if (email === '') return null;
  if (email.length > 254 || !EMAIL_RE.test(email)) return '告警邮箱格式不正确';
  if (checkLevel(user, 2)) return null;
  const own = String(user.email || '').trim().toLowerCase();
  if (!own) return '请先在个人资料中设置邮箱，或留空使用系统通知邮箱';
  if (email.toLowerCase() !== own) return '普通用户只能将告警发送到自己的邮箱';
  return null;
}

export default async function dnsCheckRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // 任务列表：管理员看全部，普通用户只看自己的
  app.get('/api/dns-check/tasks', auth, async (req: any) => {
    const isAdmin = checkLevel(req.user, 2);
    // JOIN 域名表取名称，替代「另查前 2000 条域名做映射」（后者在域名超 2000 时任务行domain_name 为空）。
    // 私有 DNS 账户的任务只对所有者可见，管理员也不能通过任务列表读取他人私有域名信息。
    const scope = isAdmin
      ? `(A.visibility IS NULL OR A.visibility <> 'private' OR A.owner_uid = ?)`
      : `T.uid = ? AND (A.visibility IS NULL OR A.visibility <> 'private' OR A.owner_uid = ?)`;
    const params = isAdmin ? [Number(req.user.uid)] : [Number(req.user.uid), Number(req.user.uid)];
    const rows = await query(
      `SELECT T.*, D.name AS domain_name
         FROM ${table('dns_check_task')} T
         LEFT JOIN ${table('domain')} D ON T.did = D.id
         LEFT JOIN ${table('account')} A ON D.aid = A.id
        WHERE ${scope}
        ORDER BY T.id DESC`,
      params,
    );
    const data = rows.map((r: any) => ({ ...r }));
    return { code: 0, data };
  });

  // 普通用户可选的域名（其授权范围内的域名）
  app.get('/api/dns-check/domains', auth, async (req: any) => {
    const kw = String(req.query?.kw ?? '').trim();
    if (checkLevel(req.user, 2)) {
      const where = kw ? " AND D.name LIKE ? ESCAPE '!'" : '';
      const params = kw ? ['%' + escapeLike(kw) + '%'] : [];
      const rows = await query(
        `SELECT D.id, D.name FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id
          WHERE (A.visibility <> 'private' OR A.owner_uid = ?)${where} ORDER BY D.id DESC LIMIT 2000`,
        [Number(req.user.uid), ...params],
      );
      return { code: 0, data: rows };
    }
    const perms = await getUserPermissions(req.user.uid);
    const names = [...new Set(perms.map((p: any) => p.domain))];
    if (!names.length) return { code: 0, data: [] };
    const rows: any[] = await query(
      `SELECT D.id, D.name FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id
        WHERE D.name IN (${names.map(() => '?').join(',')}) AND (A.visibility <> 'private' OR A.owner_uid = ?) ORDER BY D.id DESC`,
      [...names, Number(req.user.uid)],
    );
    return { code: 0, data: rows };
  });

  // 某域名的可选检测子域名：管理员返回记录中的子域名前缀，普通用户返回其接入子域名
  app.get('/api/dns-check/domains/:id/subs', auth, async (req: any) => {
    const did = Number(req.params.id);
    if (!did) return { code: -1, msg: '参数错误' };
    const d: any = await queryOne(
      `SELECT D.name, A.visibility, A.owner_uid FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id WHERE D.id = ?`,
      [did],
    );
    if (!d || (d.visibility === 'private' && Number(d.owner_uid) !== Number(req.user.uid))) return { code: 0, data: [] };
    if (checkLevel(req.user, 2)) {
      const subs = await listSubDomains(did);
      return { code: 0, data: subs };
    }
    const perms = await getUserPermissions(req.user.uid);
    const subs = perms
      .filter((p: any) => sameDomain(p.domain, d.name) && p.sub)
      .map((p: any) => String(p.sub).toLowerCase().replace(/\.+$/, ''));
    return { code: 0, data: [...new Set(subs)] };
  });

  app.post('/api/dns-check/tasks', auth, async (req: any) => {
    const b = req.body || {};
    const did = Number(b.did) || 0;
    if (!did) return { code: -1, msg: '请选择域名' };
    if (!(await canAccessDomain(req.user, did))) return { code: -1, msg: '无权限检测该域名' };
    const sub = String(b.sub || '').trim() || null;
    if (sub && !(await canAccessSub(req.user, did, sub))) return { code: -1, msg: '无权限检测该子域名' };
    const noticeErr = noticeEmailErr(req.user, b.notice_email);
    if (noticeErr) return { code: -1, msg: noticeErr };
    const cycle = b.cycle === 'interval' ? 'interval' : 'daily';
    const intervalMin = b.cycle === 'interval' ? Math.max(MIN_INTERVAL_MIN, Number(b.interval_min) || 0) : 0;
    const runTime = cycle === 'daily' ? String(b.run_time || '00:00') : null;
    if (!checkLevel(req.user, 2)) {
      const count = Number((await queryOne(`SELECT COUNT(*) AS c FROM ${table('dns_check_task')} WHERE uid = ?`, [req.user.uid]))?.c || 0);
      if (count >= MAX_TASKS_PER_USER) return { code: -1, msg: `最多创建 ${MAX_TASKS_PER_USER} 个检测任务` };
    }
    const nextRun = fmtDateTime(calcNextRun(cycle, intervalMin, runTime));
    const id: number = await query(
      `INSERT INTO ${table('dns_check_task')} (name, did, uid, sub, types, cycle, interval_min, run_time, notice_email, active, next_run, addtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [String(b.name || ''), did, req.user.uid, sub, String(b.types || ''), cycle, intervalMin, runTime, String(b.notice_email || ''), b.active == 0 ? 0 : 1, nextRun],
    ).then((r: any) => r.insertId || 0);
    return { code: 0, msg: '创建成功', data: id };
  });

  app.put('/api/dns-check/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT * FROM ${table('dns_check_task')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '任务不存在' };
    if (!checkLevel(req.user, 2) && Number(row.uid) !== req.user.uid) return { code: -1, msg: '无权限' };
    // 管理员也必须校验任务原域名的可见性，避免改写他人私有账户下的检测任务
    if (!(await canAccessDomain(req.user, Number(row.did)))) return { code: -1, msg: '无权限检测该域名' };
    const b = req.body || {};
    const did = Number(b.did) || 0;
    if (!did) return { code: -1, msg: '请选择域名' };
    if (!(await canAccessDomain(req.user, did))) return { code: -1, msg: '无权限检测该域名' };
    const sub = String(b.sub || '').trim() || null;
    if (sub && !(await canAccessSub(req.user, did, sub))) return { code: -1, msg: '无权限检测该子域名' };
    const noticeErr = noticeEmailErr(req.user, b.notice_email);
    if (noticeErr) return { code: -1, msg: noticeErr };
    const cycle = b.cycle === 'interval' ? 'interval' : 'daily';
    const intervalMin = b.cycle === 'interval' ? Math.max(MIN_INTERVAL_MIN, Number(b.interval_min) || 0) : 0;
    const runTime = cycle === 'daily' ? String(b.run_time || '00:00') : null;
    await query(
      `UPDATE ${table('dns_check_task')} SET name = ?, did = ?, sub = ?, types = ?, cycle = ?, interval_min = ?, run_time = ?, notice_email = ?, active = ? WHERE id = ?`,
      [String(b.name || ''), did, sub, String(b.types || ''), cycle, intervalMin, runTime, String(b.notice_email || ''), b.active == 0 ? 0 : 1, id],
    );
    return { code: 0, msg: '保存成功' };
  });

  app.post('/api/dns-check/tasks/:id/toggle', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT uid, did FROM ${table('dns_check_task')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '任务不存在' };
    if (!checkLevel(req.user, 2) && Number(row.uid) !== req.user.uid) return { code: -1, msg: '无权限' };
    if (!(await canAccessDomain(req.user, Number(row.did)))) return { code: -1, msg: '无权限操作该域名的私有账户任务' };
    const active = (req.body || {}).active == 1 ? 1 : 0;
    await query(`UPDATE ${table('dns_check_task')} SET active = ? WHERE id = ?`, [active, id]);
    return { code: 0, msg: active ? '已启用' : '已停用' };
  });

  app.post('/api/dns-check/tasks/:id/run', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT * FROM ${table('dns_check_task')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '任务不存在' };
    if (!checkLevel(req.user, 2) && Number(row.uid) !== req.user.uid) return { code: -1, msg: '无权限' };
    if (!(await canAccessDomain(req.user, Number(row.did)))) return { code: -1, msg: '无权限检测该域名' };
    if (!hitRateLimit(`dnscheck:${req.user.uid}`, 6, 10 * 60_000)) {
      return { code: -1, msg: '检测执行过于频繁，请稍后再试' };
    }
    let result: any = null;
    const locked = await withDistributedLock('dnsmgr:dnscheck', async () => {
      const types = String(row.types || '').split(/[,;，；]/).map((x: string) => x.trim().toUpperCase()).filter(Boolean);
      result = await checkDomainRecords(row.did, types.length ? types : undefined, row.uid, row.sub);
      const next = fmtDateTime(calcNextRun(row.cycle, row.interval_min, row.run_time));
      const issueCount = result.issues ? result.issues.length : 0;
      await query(
        `UPDATE ${table('dns_check_task')} SET last_run = NOW(), next_run = ?, last_status = ?, issue_count = ? WHERE id = ?`,
        [next, issueCount ? 1 : 0, issueCount, id],
      );
    });
    if (!locked) return { code: -1, msg: '自动检测任务正在执行，请稍后再试' };
    return { code: 0, ...result };
  });

  app.delete('/api/dns-check/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT uid, did FROM ${table('dns_check_task')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '任务不存在' };
    if (!checkLevel(req.user, 2) && Number(row.uid) !== req.user.uid) return { code: -1, msg: '无权限' };
    if (!(await canAccessDomain(req.user, Number(row.did)))) return { code: -1, msg: '无权限操作该域名的私有账户任务' };
    await query(`DELETE FROM ${table('dns_check_task')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });
}

async function canAccessDomain(user: any, did: number): Promise<boolean> {
  const d: any = await queryOne(
    `SELECT D.name, A.visibility, A.owner_uid FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id WHERE D.id = ?`,
    [did],
  );
  if (!d) return false;
  if (d.visibility === 'private' && Number(d.owner_uid) !== Number(user.uid)) return false;
  if (checkLevel(user, 2)) return true;
  const perms = await getUserPermissions(user.uid);
  // 只读授权不能创建/修改检测任务（会周期发起外部解析并发送邮件）
  return perms.some((p: any) => sameDomain(p.domain, d.name) && Number(p.readonly) !== 1);
}

/** 校验普通用户选择的子域名是否落在其接入域名范围内 */
async function canAccessSub(user: any, did: number, sub: string): Promise<boolean> {
  const d: any = await queryOne(
    `SELECT D.name, A.visibility, A.owner_uid FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id WHERE D.id = ?`,
    [did],
  );
  if (!d) return false;
  if (d.visibility === 'private' && Number(d.owner_uid) !== Number(user.uid)) return false;
  if (checkLevel(user, 2)) return true;
  const perms = await getUserPermissions(user.uid);
  return matchPermission(perms, d.name, sub.trim().replace(/\.+$/, '')) === 0;
}