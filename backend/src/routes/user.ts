import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { query, queryOne, table, withTransaction, isDuplicateError } from '../db.js';
import { checkLevel } from '../auth.js';
import { audit } from '../lib/audit/context.js';
import { diffFields } from '../lib/audit/mask.js';
import { hasOwn, clampLimit, clampOffset, escapeLike } from '../lib/util.js';
import { SECRET_MASK } from '../lib/secret.js';
import { purgeUserData } from '../lib/users/purge.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
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
      out.push({ domain: String(item).trim().toLowerCase().replace(/\.$/, ''), sub: null, readonly: 0, expiretime: null });
    } else if (item && typeof item === 'object' && item.domain) {
      out.push({
        domain: String(item.domain).trim().toLowerCase().replace(/\.$/, ''),
        sub: item.sub ? String(item.sub).trim().toLowerCase().replace(/\.+$/, '') : null,
        readonly: Number(item.readonly || 0),
        expiretime: item.expiretime ? String(item.expiretime) : null,
      });
    }
  }
  return out;
}

async function applyPermissions(q: any, uid: number, input: any[]) {
  await q(`DELETE FROM ${table('permission')} WHERE uid = ?`, [uid]);
  const list = normalizePermission(input);
  if (list.length) {
    // 多值 INSERT 替代逐条插入
    const values = list.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params = list.flatMap((p: any) => [uid, p.domain, p.sub, p.readonly, p.expiretime]);
    await q(`INSERT INTO ${table('permission')} (uid, domain, sub, readonly, expiretime) VALUES ${values}`, params);
  }
}

async function savePermissions(uid: number, input: any[]) {
  await withTransaction(async (q) => {
    await applyPermissions(q, uid, input);
  });
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
    const kw = String(req.query?.kw ?? '').trim();
    const where = kw ? " WHERE name LIKE ? ESCAPE '!'" : '';
    const params = kw ? ['%' + escapeLike(kw) + '%'] : [];
    const rows = await query(`SELECT name FROM ${table('domain')}${where} ORDER BY id DESC LIMIT 2000`, params);
    return { code: 0, data: rows.map((r: any) => r.name) };
  });

  // 用户列表
  app.get('/api/users', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const q = req.query || {};
    const kw = String(q.kw ?? '').trim();
    const offset = clampOffset(q.offset);
    const limit = clampLimit(q.limit);
    const sort = q.sortName || '';
    const orderDir = String(q.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let where = '';
    const params: any[] = [];
    if (kw) {
      where = " WHERE (username LIKE ? ESCAPE '!' OR id LIKE ? ESCAPE '!')";
      params.push('%' + escapeLike(kw) + '%', '%' + escapeLike(kw) + '%');
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
    const blocked = superBlocked(req, row as any);
    if (blocked) return { code: -1, msg: blocked };
    const perms = await query(`SELECT domain, sub, readonly, expiretime FROM ${table('permission')} WHERE uid = ?`, [id]);
    row.permission = perms.map((p: any) => ({ domain: p.domain, sub: p.sub || null, readonly: Number(p.readonly || 0), expiretime: p.expiretime || null }));
    // API 密钥不回发明文，以掩码返回；编辑保存时掩码值会被识别为「未修改」
    if (row.apikey) row.apikey = SECRET_MASK;
    return { code: 0, data: row };
  });

  // 添加用户
  app.post('/api/users', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const b = req.body || {};
    const username = String(b.username ?? '').trim();
    const password = String(b.password ?? '');
    const isApi = Number(b.is_api) === 1 ? 1 : 0;
    const apikey = String(b.apikey ?? '').trim();
    const level = Number(b.level || 1);
    const checkWhole = Number(b.check_whole || 0);
    const permission = Array.isArray(b.permission) ? b.permission : [];

    if (!username || !password) return { code: -1, msg: '用户名或密码不能为空' };
    if (password.length < 8) return { code: -1, msg: '密码长度至少为 8 位' };
    if (!Number.isFinite(level) || level < 1) return { code: -1, msg: '用户等级不合法' };
    if (level >= 2 && !isSuper(req)) return { code: -1, msg: '仅超级管理员可创建管理员账号' };
    if (isApi === 1 && !apikey) return { code: -1, msg: 'API密钥不能为空' };
    const exists = await queryOne(`SELECT id FROM ${table('user')} WHERE username = ?`, [username]);
    if (exists) return { code: -1, msg: '用户名已存在' };

    let uid: number;
    try {
      // 建号与授权必须同一事务：否则中途失败会留下「用户已建但没有任何权限」的半更新数据
      uid = await withTransaction(async (q) => {
        const ins: any = await q(
          `INSERT INTO ${table('user')} (username, password, is_api, apikey, level, check_whole, regtime, status) VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
          [username, await bcrypt.hash(password, 10), isApi, apikey, level, checkWhole]
        );
        const id = Number(ins?.insertId || 0);
        if (level === 1) await applyPermissions(q, id, permission);
        return id;
      });
    } catch (e: any) {
      if (isDuplicateError(e)) return { code: -1, msg: '用户名已存在' };
      throw e;
    }
    audit(req, {
      targetType: 'user',
      targetId: uid,
      targetName: username,
      summary: `新建用户 ${username}（等级 ${level}）`,
      detail: { username, level, isApi, checkWhole },
    });
    return { code: 0, msg: '添加用户成功！' };
  });

  // 编辑用户
  app.put('/api/users/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row: any = await queryOne(
      `SELECT id, is_super, level, username, status, email, remark, apikey, is_api, check_whole, stat_cache FROM ${table('user')} WHERE id = ?`,
      [id],
    );
    if (!row) return { code: -1, msg: '用户不存在' };
    const blocked = superBlocked(req, row as any);
    if (blocked) return { code: -1, msg: blocked };

    const b = req.body || {};
    // PUT 采用“显式字段才更新”的语义：未提交的字段沿用数据库原值，
    // 避免前端局部更新时把 is_api / apikey / level / 子域名授权静默清空。
    const username = b.username !== undefined && b.username !== null ? String(b.username).trim() : String(row.username || '');
    const isApi = b.is_api !== undefined ? (Number(b.is_api) === 1 ? 1 : 0) : (Number(row.is_api) === 1 ? 1 : 0);
    const apikeyProvided = b.apikey !== undefined && b.apikey !== null;
    const apikeyRaw = apikeyProvided ? String(b.apikey).trim() : '';
    let level = b.level !== undefined ? Number(b.level) : Number(row.level || 1);
    const repwd = b.repwd !== undefined && b.repwd !== null ? String(b.repwd) : '';
    const permissionProvided = Array.isArray(b.permission);
    const permission = permissionProvided ? b.permission : [];

    if (!username) return { code: -1, msg: '用户名不能为空' };
    if (!Number.isFinite(level) || level < 1) return { code: -1, msg: '用户等级不合法' };
    const exists = await queryOne(`SELECT id FROM ${table('user')} WHERE username = ? AND id <> ?`, [username, id]);
    if (exists) return { code: -1, msg: '用户名已存在' };
    // 密码校验前置，避免主 UPDATE 已落库后才因密码不合规而报错，产生部分更新
    if (repwd && repwd.length < 8) return { code: -1, msg: '密码长度至少为 8 位' };
    // 当前登录账号不得被降级（含超级管理员本人），避免自锁
    if (id === req.user.uid && level < 2) level = 2;
    const levelBlocked = adminManageBlocked(req, row as any, level);
    if (levelBlocked) return { code: -1, msg: levelBlocked };

    // check_whole / stat_cache 仅在请求体显式携带时才更新，避免「编辑用户」这一独立接口
    // 因前端未提交该字段而把授权静默重置为 0（与 /users/:id/stat-cache 互相覆盖）
    // apikey 为掩码时表示前端未修改，沿用库中原值，避免把「**********」写回
    let apikey = apikeyProvided ? apikeyRaw : String(row.apikey ?? '');
    if (apikeyProvided && apikeyRaw === SECRET_MASK) {
      const curKey = await queryOne(`SELECT apikey FROM ${table('user')} WHERE id = ?`, [id]);
      apikey = String(curKey?.apikey ?? '');
    }
    if (isApi === 1 && !apikey) return { code: -1, msg: 'API密钥不能为空' };
    const sets: string[] = ['username = ?', 'is_api = ?', 'apikey = ?', 'level = ?'];
    const params: any[] = [username, isApi, apikey, level];
    if (b.check_whole !== undefined) {
      sets.push('check_whole = ?');
      params.push(Number(b.check_whole) === 1 ? 1 : 0);
    }
    if (b.stat_cache !== undefined) {
      sets.push('stat_cache = ?');
      params.push(Number(b.stat_cache) === 1 ? 1 : 0);
    }
    if (b.email !== undefined) {
      sets.push('email = ?');
      params.push(String(b.email ?? '').trim().slice(0, 128) || null);
    }
    if (b.remark !== undefined) {
      sets.push('remark = ?');
      params.push(String(b.remark ?? '').slice(0, 255));
    }
    params.push(id);
    try {
      await query(`UPDATE ${table('user')} SET ${sets.join(', ')} WHERE id = ?`, params);
    } catch (e: any) {
      if (isDuplicateError(e)) return { code: -1, msg: '邮箱已被其他账号使用' };
      throw e;
    }
    const prevPerm = await queryOne<any>(`SELECT COUNT(*) AS c FROM ${table('permission')} WHERE uid = ?`, [id]);
    if (level === 1) {
      // 只有显式提交 permission 时才替换，避免局部更新清空已有授权
      if (permissionProvided) await savePermissions(id, permission);
    } else if (Number(row.level) === 1 || permissionProvided) {
      // 从普通用户提升为管理员，或显式提交了空权限时才清空
      await query(`DELETE FROM ${table('permission')} WHERE uid = ?`, [id]);
    }
    if (repwd) {
      // 改密同时自增 token_version，使该用户已签发的旧 JWT 立即失效
      await query(`UPDATE ${table('user')} SET password = ?, token_version = token_version + 1 WHERE id = ?`, [await bcrypt.hash(repwd, 10), id]);
    }
    const after: Record<string, any> = {
      username,
      level,
      is_api: isApi,
      status: row.status,
      email: b.email !== undefined ? String(b.email ?? '') : row.email,
      remark: b.remark !== undefined ? String(b.remark ?? '') : row.remark,
    };
    if (b.check_whole !== undefined) after.check_whole = Number(b.check_whole) === 1 ? 1 : 0;
    if (b.stat_cache !== undefined) after.stat_cache = Number(b.stat_cache) === 1 ? 1 : 0;
    // 以 after 的键为准取旧值，避免 id / is_super 这类只存在于 before 的字段被判成「被清空」
    const before: Record<string, any> = Object.fromEntries(Object.keys(after).map((k) => [k, row[k]]));
    const changes = diffFields(before, after, {
      username: '用户名',
      level: '等级',
      is_api: 'API 访问',
      status: '状态',
      email: '邮箱',
      remark: '备注',
      check_whole: '整域名检测',
      stat_cache: '统计缓存',
    });
    if (repwd) changes.push({ field: '密码', to: '已重置' });
    if (apikeyRaw && apikeyRaw !== SECRET_MASK && apikey !== String(row.apikey ?? '')) {
      changes.push({ field: 'API 密钥', to: '已更新' });
    }
    const prevCount = Number(prevPerm?.c || 0);
    if (level === 1 && permissionProvided && prevCount !== permission.length) {
      changes.push({ field: '子域名授权', to: `${permission.length} 条` });
    } else if (level !== 1 && prevCount > 0 && (Number(row.level) === 1 || permissionProvided)) {
      changes.push({ field: '子域名授权', to: '已清空' });
    }
    audit(req, {
      targetType: 'user',
      targetId: id,
      targetName: username,
      summary: `修改用户 ${username}`,
      changes,
      detail: { username, level },
    });
    return { code: 0, msg: '修改用户成功！' };
  });

  // 状态切换
  app.post('/api/users/:id/status', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    // 仅允许 1=正常、0=封禁，避免 -1/2 等值绕过 authenticate 的封禁判断
    const status = Number((req.body || {}).status) === 1 ? 1 : 0;
    const row: any = await queryOne(`SELECT is_super, level, username, status FROM ${table('user')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '用户不存在' };
    if (Number((row as any).is_super) === 1) return { code: -1, msg: '超级管理员不可被修改状态' };
    if (id === req.user.uid) return { code: -1, msg: '当前登录用户无法修改状态' };
    const statusBlocked = adminManageBlocked(req, { id, level: (row as any).level });
    if (statusBlocked) return { code: -1, msg: statusBlocked };
    await query(`UPDATE ${table('user')} SET status = ? WHERE id = ?`, [status, id]);
    audit(req, {
      targetType: 'user',
      targetId: id,
      targetName: String(row.username || ''),
      summary: `${status ? '解封' : '封禁'}用户 ${row.username || '#' + id}`,
      changes: [{ field: '状态', from: row.status ? '正常' : '封禁', to: status ? '正常' : '封禁' }],
    });
    return { code: 0, msg: '设置成功' };
  });

  // 开关用户的 CDN 统计缓存查看权限（仅管理员）
  app.post('/api/users/:id/stat-cache', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT id, is_super, username FROM ${table('user')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '用户不存在' };
    const blocked = superBlocked(req, row as any);
    if (blocked) return { code: -1, msg: blocked };
    const value = Number((req.body || {}).stat_cache) === 1 ? 1 : 0;
    await query(`UPDATE ${table('user')} SET stat_cache = ? WHERE id = ?`, [value, id]);
    audit(req, {
      targetType: 'user',
      targetId: id,
      targetName: String(row.username || ''),
      summary: `${value ? '开启' : '关闭'}用户 ${row.username || '#' + id} 的统计缓存查看`,
    });
    return { code: 0, msg: value ? '已开启统计缓存查看' : '已关闭统计缓存查看' };
  });

  // 删除用户
  app.delete('/api/users/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT is_super, level, username FROM ${table('user')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '用户不存在' };
    if (Number((row as any).is_super) === 1) return { code: -1, msg: '超级管理员不可被删除' };
    if (id === req.user.uid) return { code: -1, msg: '当前登录用户无法删除' };
    const deleteBlocked = adminManageBlocked(req, { id, level: (row as any).level });
    if (deleteBlocked) return { code: -1, msg: deleteBlocked };
    await purgeUserData(id);
    audit(req, {
      targetType: 'user',
      targetId: id,
      targetName: String(row.username || ''),
      summary: `删除用户 ${row.username || '#' + id}`,
    });
    return { code: 0, msg: '删除成功' };
  });

  // 操作日志列表
  app.get('/api/logs', auth, async (req: any) => {
    const q = req.query || {};
    const uid = String(q.uid ?? '').trim();
    const domain = String(q.domain ?? '').trim();
    const kw = String(q.kw ?? '').trim();
    const offset = clampOffset(q.offset);
    const limit = clampLimit(q.limit);

    let where = ' WHERE 1=1';
    const params: any[] = [];
    if (Number(req.user.level) >= 2) {
      if (!isNullOrEmpty(uid)) {
        where += ' AND uid = ?';
        params.push(Number(uid));
      }
    } else {
      // level 0/1（含非法值）一律只能查看自己的日志
      where += ' AND uid = ?';
      params.push(req.user.uid);
    }
    if (kw) {
      where += " AND (action LIKE ? ESCAPE '!' OR data LIKE ? ESCAPE '!')";
      params.push('%' + escapeLike(kw) + '%', '%' + escapeLike(kw) + '%');
    }
    if (domain) {
      where += ' AND domain = ?';
      params.push(domain);
    }

    const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('log')}${where}`, params);
    const total = totalRow?.c ?? 0;
    // 显式列替代 SELECT *，减少无用 IO
    const rows = await query(`SELECT id, uid, action, domain, data, addtime FROM ${table('log')}${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { code: 0, data: { total, list: rows } };
  });
}