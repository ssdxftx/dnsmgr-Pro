import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { hasOwn } from '../lib/util.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

function insertAndGetId(sql: string, params: any[]): Promise<number> {
  return query(sql, params).then((r: any) => r.insertId || 0);
}

interface PermItem {
  domain: string;
  sub: string | null;
  readonly: number;
  expiretime: string | null;
}

function normalizePermission(input: any[]): PermItem[] {
  const out: PermItem[] = [];
  for (const item of input || []) {
    if (typeof item === 'string') {
      out.push({ domain: item, sub: null, readonly: 0, expiretime: null });
    } else if (item && typeof item === 'object' && item.domain) {
      out.push({
        domain: item.domain,
        sub: item.sub || null,
        readonly: Number(item.readonly || 0),
        expiretime: item.expiretime ? String(item.expiretime) : null,
      });
    }
  }
  return out;
}

async function savePermissions(uid: number, input: any[]) {
  await query(`DELETE FROM ${table('permission')} WHERE uid = ?`, [uid]);
  for (const p of normalizePermission(input)) {
    await query(
      `INSERT INTO ${table('permission')} (uid, domain, sub, readonly, expiretime) VALUES (?, ?, ?, ?, ?)`,
      [uid, p.domain, p.sub, p.readonly, p.expiretime],
    );
  }
}

// 超级管理员（安装服务时创建）受保护：任何其他管理员都不得修改其任何资料；
// 仅超级管理员本人可编辑自身（但仍受「不可自我降级/禁用」约束）。
function superBlocked(req: any, target: { id: number; is_super?: any }): string | null {
  if (Number(target.is_super) === 1 && Number(req.user.uid) !== Number(target.id)) {
    return '超级管理员不可被其他管理员修改';
  }
  return null;
}

function isSuper(req: any): boolean {
  return Number(req.user.is_super) === 1;
}

// 普通管理员不得管理其他管理员、也不得创建/提升管理员，避免管理员间互相降级或提权
function adminManageBlocked(req: any, target: { id: number; level?: any }, nextLevel?: number): string | null {
  if (isSuper(req)) return null;
  const targetLevel = Number(target.level || 0);
  if (Number(target.id) !== Number(req.user.uid) && targetLevel >= 2) {
    return '仅超级管理员可管理其他管理员';
  }
  if (nextLevel !== undefined && nextLevel >= 2 && Number(target.id) !== Number(req.user.uid)) {
    return '仅超级管理员可授予管理员权限';
  }
  return null;
}

export default async function userRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // 域名列表（供权限选择，仅管理员）
  app.get('/api/user/domains', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const rows = await query(`SELECT id, name FROM ${table('domain')} ORDER BY id DESC`);
    return { code: 0, data: rows.map((r: any) => r.name) };
  });

  // 用户列表
  app.get('/api/users', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const q = req.query || {};
    const kw = (q.kw || '').trim();
    const offset = Number(q.offset || 0);
    const limit = Number(q.limit || 10);
    const sort = q.sortName || '';
    const orderDir = String(q.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let where = '';
    const params: any[] = [];
    if (kw) {
      where = ' WHERE (username LIKE ? OR id LIKE ?)';
      params.push('%' + kw + '%', '%' + kw + '%');
    }

    const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('user')}${where}`, params);
    const total = totalRow?.c ?? 0;

    const allowedSort: Record<string, string> = { id: 'id', username: 'username', level: 'level', is_api: 'is_api', regtime: 'regtime', lasttime: 'lasttime', status: 'status' };
    const orderBy = hasOwn(allowedSort, sort) ? `${allowedSort[sort]} ${orderDir}` : 'id DESC';

    const list = await query(
      `SELECT id, username, is_api, level, regtime, lasttime, status, totp_open, stat_cache, is_super FROM ${table('user')}${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { code: 0, data: { total, list } };
  });

  // 获取单个用户 + 权限
  app.get('/api/users/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row = await queryOne(`SELECT id, username, is_api, apikey, level, status, totp_open, check_whole, stat_cache, is_super FROM ${table('user')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '用户不存在' };
    const perms = await query(`SELECT domain, sub, readonly, expiretime FROM ${table('permission')} WHERE uid = ?`, [id]);
    row.permission = perms.map((p: any) => ({ domain: p.domain, sub: p.sub || null, readonly: Number(p.readonly || 0), expiretime: p.expiretime || null }));
    return { code: 0, data: row };
  });

  // 添加用户
  app.post('/api/users', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const b = req.body || {};
    const username = (b.username || '').trim();
    const password = (b.password || '').trim();
    const isApi = Number(b.is_api || 0);
    const apikey = (b.apikey || '').trim();
    const level = Number(b.level || 1);
    const checkWhole = Number(b.check_whole || 0);
    const permission = Array.isArray(b.permission) ? b.permission : [];

    if (!username || !password) return { code: -1, msg: '用户名或密码不能为空' };
    if (password.length < 8) return { code: -1, msg: '密码长度至少为 8 位' };
    if (level >= 2 && !isSuper(req)) return { code: -1, msg: '仅超级管理员可创建管理员账号' };
    if (isApi === 1 && !apikey) return { code: -1, msg: 'API密钥不能为空' };
    const exists = await queryOne(`SELECT id FROM ${table('user')} WHERE username = ?`, [username]);
    if (exists) return { code: -1, msg: '用户名已存在' };

    const uid = await insertAndGetId(
      `INSERT INTO ${table('user')} (username, password, is_api, apikey, level, check_whole, regtime, status) VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
      [username, await bcrypt.hash(password, 10), isApi, apikey, level, checkWhole]
    );
    if (level === 1) {
      await savePermissions(uid, permission);
    }
    return { code: 0, msg: '添加用户成功！' };
  });

  // 编辑用户
  app.put('/api/users/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row = await queryOne(`SELECT id, is_super, level FROM ${table('user')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '用户不存在' };
    const blocked = superBlocked(req, row as any);
    if (blocked) return { code: -1, msg: blocked };

    const b = req.body || {};
    const username = (b.username || '').trim();
    const isApi = Number(b.is_api || 0);
    const apikey = (b.apikey || '').trim();
    let level = Number(b.level || 1);
    const repwd = (b.repwd || '').trim();
    const checkWhole = Number(b.check_whole || 0);
    const statCache = Number(b.stat_cache) === 1 ? 1 : 0;
    const permission = Array.isArray(b.permission) ? b.permission : [];

    if (!username) return { code: -1, msg: '用户名不能为空' };
    if (isApi === 1 && !apikey) return { code: -1, msg: 'API密钥不能为空' };
    const exists = await queryOne(`SELECT id FROM ${table('user')} WHERE username = ? AND id <> ?`, [username, id]);
    if (exists) return { code: -1, msg: '用户名已存在' };
    // 密码校验前置，避免主 UPDATE 已落库后才因密码不合规而报错，产生部分更新
    if (repwd && repwd.length < 8) return { code: -1, msg: '密码长度至少为 8 位' };
    // 任何管理员（含超级管理员本人）都不能把当前登录账号降级为普通用户，避免自锁
    if (level === 1 && id === req.user.uid) {
      level = 2;
    }
    const levelBlocked = adminManageBlocked(req, row as any, level);
    if (levelBlocked) return { code: -1, msg: levelBlocked };

    await query(`UPDATE ${table('user')} SET username = ?, is_api = ?, apikey = ?, level = ?, check_whole = ?, stat_cache = ? WHERE id = ?`, [username, isApi, apikey, level, checkWhole, statCache, id]);
    if (level === 1) {
      await savePermissions(id, permission);
    } else {
      await query(`DELETE FROM ${table('permission')} WHERE uid = ?`, [id]);
    }
    if (repwd) {
      await query(`UPDATE ${table('user')} SET password = ? WHERE id = ?`, [await bcrypt.hash(repwd, 10), id]);
    }
    return { code: 0, msg: '修改用户成功！' };
  });

  // 状态切换
  app.post('/api/users/:id/status', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const status = Number((req.body || {}).status);
    const row = await queryOne(`SELECT is_super, level FROM ${table('user')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '用户不存在' };
    if (Number((row as any).is_super) === 1) return { code: -1, msg: '超级管理员不可被修改状态' };
    if (id === req.user.uid) return { code: -1, msg: '当前登录用户无法修改状态' };
    const statusBlocked = adminManageBlocked(req, { id, level: (row as any).level });
    if (statusBlocked) return { code: -1, msg: statusBlocked };
    await query(`UPDATE ${table('user')} SET status = ? WHERE id = ?`, [status, id]);
    return { code: 0, msg: '设置成功' };
  });

  // 开关用户的 CDN 统计缓存查看权限（仅管理员）
  app.post('/api/users/:id/stat-cache', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row = await queryOne(`SELECT id, is_super FROM ${table('user')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '用户不存在' };
    const blocked = superBlocked(req, row as any);
    if (blocked) return { code: -1, msg: blocked };
    const value = Number((req.body || {}).stat_cache) === 1 ? 1 : 0;
    await query(`UPDATE ${table('user')} SET stat_cache = ? WHERE id = ?`, [value, id]);
    return { code: 0, msg: value ? '已开启统计缓存查看' : '已关闭统计缓存查看' };
  });

  // 删除用户
  app.delete('/api/users/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row = await queryOne(`SELECT is_super, level FROM ${table('user')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '用户不存在' };
    if (Number((row as any).is_super) === 1) return { code: -1, msg: '超级管理员不可被删除' };
    if (id === req.user.uid) return { code: -1, msg: '当前登录用户无法删除' };
    const deleteBlocked = adminManageBlocked(req, { id, level: (row as any).level });
    if (deleteBlocked) return { code: -1, msg: deleteBlocked };
    await query(`DELETE FROM ${table('user')} WHERE id = ?`, [id]);
    await query(`DELETE FROM ${table('permission')} WHERE uid = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  // 操作日志列表
  app.get('/api/logs', auth, async (req: any) => {
    const q = req.query || {};
    const uid = (q.uid || '').trim();
    const domain = (q.domain || '').trim();
    const kw = (q.kw || '').trim();
    const offset = Number(q.offset || 0);
    const limit = Number(q.limit || 10);

    let where = ' WHERE 1=1';
    const params: any[] = [];
    if (req.user.level === 1) {
      where += ' AND uid = ?';
      params.push(req.user.uid);
    } else if (req.user.level >= 2) {
      if (!isNullOrEmpty(uid)) {
        where += ' AND uid = ?';
        params.push(Number(uid));
      }
    }
    if (kw) {
      where += ' AND (action LIKE ? OR data LIKE ?)';
      params.push('%' + kw + '%', '%' + kw + '%');
    }
    if (domain) {
      where += ' AND domain = ?';
      params.push(domain);
    }

    const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('log')}${where}`, params);
    const total = totalRow?.c ?? 0;
    const rows = await query(`SELECT * FROM ${table('log')}${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { code: 0, data: { total, list: rows } };
  });
}