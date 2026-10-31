import type { FastifyInstance } from 'fastify';
import { findUserById } from '../auth.js';
import { query, queryOne, table } from '../db.js';
import { audit } from '../lib/audit/context.js';
import { requireLoginPassword } from '../lib/reauth.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import {
  API_KEY_MODULES,
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
  normalizeIpAllowlist,
  normalizeScopes,
  parseScopes,
} from '../lib/apiKeys.js';

function isAdmin(user: any): boolean {
  return Number(user?.level || 0) >= 2;
}

function isSuper(user: any): boolean {
  return Number(user?.is_super || 0) === 1;
}

function fmtDateOnly(value: any): string | null {
  if (value === undefined) return undefined as any;
  if (value === null || value === '') return null;
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) throw new Error('过期时间格式应为 YYYY-MM-DD HH:mm:ss');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  if (Number.isNaN(d.getTime())) throw new Error('过期时间无效');
  return s.length <= 10 ? `${s} 23:59:59` : s;
}

async function targetUid(req: any, input: any): Promise<number | null> {
  const self = Number(req.user?.uid || 0);
  const requested = Number(input || 0);
  if (!requested || requested === self) return self;
  if (!isAdmin(req.user)) return null;
  const user = await findUserById(requested);
  if (!user) return null;
  // 二级管理员只能管理普通用户的 Key，不能把目标指向其他管理员或超级管理员，
  // 否则可通过创建/轮换目标账号的 Key 继承对方权限。
  if (!isSuper(req.user) && (Number(user.is_super || 0) === 1 || Number(user.level || 0) >= 2)) return null;
  return requested;
}

/** 非超级管理员不得操作其他管理员/超级管理员的 Key，防止轮换后拿到更高权限的明文 Key。 */
async function canManageKey(req: any, row: any): Promise<boolean> {
  if (!row) return false;
  if (Number(row.uid) === Number(req.user?.uid || 0)) return true;
  if (!isAdmin(req.user)) return false;
  if (isSuper(req.user)) return true;
  const owner = await findUserById(Number(row.uid));
  if (!owner) return false;
  return Number(owner.is_super || 0) !== 1 && Number(owner.level || 0) < 2;
}

async function requireWriteReauth(req: any): Promise<string | null> {
  return requireLoginPassword(Number(req.user.uid), req.body?.password, req);
}

export default async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: (app as any).authenticate };

  app.get('/api/api-keys/scopes', auth, async () => ({
    code: 0,
    data: {
      modules: API_KEY_MODULES,
      actions: ['read', 'write', '*'],
      examples: ['*', 'dns:read', 'dns:write', 'cdn:*', 'cert:read', 'backup:write'],
    },
  }));

  app.get('/api/api-keys', auth, async (req: any) => {
    const uid = await targetUid(req, req.query?.uid);
    if (!uid) return { code: -1, msg: '无权限' };
    const rows = await query(
      `SELECT id, uid, name, key_prefix, scopes, ip_allowlist, active, expires_at, last_used_at, last_used_ip, created_at, revoked_at
         FROM ${table('api_key')} WHERE uid = ? ORDER BY id DESC`,
      [uid],
    );
    const user: any = await findUserById(uid);
    const legacyKey = String(user?.apikey || '');
    return {
      code: 0,
      data: {
        list: rows.map((r: any) => ({
          ...r,
          scopes: parseScopes(r.scopes),
          ip_allowlist: parseIpList(r.ip_allowlist),
          expired: r.expires_at ? new Date(String(r.expires_at).replace(' ', 'T')).getTime() < Date.now() : false,
        })),
        legacy: legacyKey
          ? { enabled: Number(user?.is_api) === 1, prefix: legacyKey.slice(0, 6) + '…' }
          : { enabled: false, prefix: '' },
      },
    };
  });

  app.post('/api/api-keys', auth, async (req: any) => {
    if (!hitRateLimit(`api-key-create:${req.user.uid}`, 20, 60 * 60_000)) {
      return { code: -1, msg: 'API Key 创建过于频繁，请稍后再试' };
    }
    const uid = await targetUid(req, req.body?.uid);
    if (!uid) return { code: -1, msg: '无权限' };
    const pwErr = await requireWriteReauth(req);
    if (pwErr) return { code: -1, msg: pwErr };
    let scopes: string[];
    let ipList: string[];
    let expiresAt: string | null;
    try {
      scopes = normalizeScopes(req.body?.scopes);
      ipList = normalizeIpAllowlist(req.body?.ip_allowlist);
      expiresAt = fmtDateOnly(req.body?.expires_at);
    } catch (e: any) {
      return { code: -1, msg: e.message || '参数错误' };
    }
    const name = String(req.body?.name || 'API Key').trim().slice(0, 64) || 'API Key';
    const key = generateApiKey();
    const res: any = await query(
      `INSERT INTO ${table('api_key')}
        (uid, name, key_prefix, key_hash, scopes, ip_allowlist, active, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, NOW())`,
      [uid, name, apiKeyPrefix(key), hashApiKey(key), JSON.stringify(scopes), JSON.stringify(ipList), expiresAt],
    );
    audit(req, {
      module: 'apikeys',
      action: 'apikey.create',
      targetType: 'api_key',
      targetId: Number(res?.insertId || 0),
      targetName: name,
      summary: `创建 API Key「${name}」`,
      detail: { scopes, ip_allowlist: ipList, expires_at: expiresAt },
      scrubBody: true,
    });
    return {
      code: 0,
      msg: 'API Key 已创建，请立即保存，明文只显示一次',
      data: { id: Number(res?.insertId || 0), key, name, prefix: apiKeyPrefix(key), scopes, ip_allowlist: ipList, expires_at: expiresAt },
    };
  });

  app.patch('/api/api-keys/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return { code: -1, msg: '参数错误' };
    const row: any = await queryOne(`SELECT * FROM ${table('api_key')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: 'API Key 不存在' };
    if (!(await canManageKey(req, row))) return { code: -1, msg: '无权限' };
    const pwErr = await requireWriteReauth(req);
    if (pwErr) return { code: -1, msg: pwErr };
    const sets: string[] = [];
    const params: any[] = [];
    try {
      if (req.body?.name !== undefined) {
        const name = String(req.body.name || '').trim().slice(0, 64);
        if (!name) return { code: -1, msg: '名称不能为空' };
        sets.push('name = ?');
        params.push(name);
      }
      if (req.body?.scopes !== undefined) {
        sets.push('scopes = ?');
        params.push(JSON.stringify(normalizeScopes(req.body.scopes)));
      }
      if (req.body?.ip_allowlist !== undefined) {
        sets.push('ip_allowlist = ?');
        params.push(JSON.stringify(normalizeIpAllowlist(req.body.ip_allowlist)));
      }
      if (req.body?.expires_at !== undefined) {
        sets.push('expires_at = ?');
        params.push(fmtDateOnly(req.body.expires_at));
      }
      if (req.body?.active !== undefined) {
        sets.push('active = ?', 'revoked_at = ?');
        const active = Number(req.body.active) === 1 ? 1 : 0;
        params.push(active, active ? null : new Date());
      }
    } catch (e: any) {
      return { code: -1, msg: e.message || '参数错误' };
    }
    if (!sets.length) return { code: -1, msg: '没有可更新的字段' };
    params.push(id);
    await query(`UPDATE ${table('api_key')} SET ${sets.join(', ')} WHERE id = ?`, params);
    audit(req, {
      module: 'apikeys',
      action: 'apikey.update',
      targetType: 'api_key',
      targetId: id,
      targetName: String(row.name || ''),
      summary: `更新 API Key「${row.name || id}」`,
      scrubBody: true,
    });
    return { code: 0, msg: '已更新' };
  });

  app.post('/api/api-keys/:id/rotate', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT * FROM ${table('api_key')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: 'API Key 不存在' };
    if (!(await canManageKey(req, row))) return { code: -1, msg: '无权限' };
    const pwErr = await requireWriteReauth(req);
    if (pwErr) return { code: -1, msg: pwErr };
    const key = generateApiKey();
    await query(
      `UPDATE ${table('api_key')}
          SET key_prefix = ?, key_hash = ?, last_used_at = NULL, last_used_ip = NULL, revoked_at = NULL, active = 1
        WHERE id = ?`,
      [apiKeyPrefix(key), hashApiKey(key), id],
    );
    audit(req, {
      module: 'apikeys',
      action: 'apikey.rotate',
      targetType: 'api_key',
      targetId: id,
      targetName: String(row.name || ''),
      summary: `轮换 API Key「${row.name || id}」`,
      scrubBody: true,
    });
    return { code: 0, msg: '已轮换，请立即保存新 Key', data: { id, key, prefix: apiKeyPrefix(key) } };
  });

  app.delete('/api/api-keys/legacy', auth, async (req: any) => {
    const uid = await targetUid(req, req.body?.uid || req.query?.uid);
    if (!uid) return { code: -1, msg: '无权限' };
    const pwErr = await requireWriteReauth(req);
    if (pwErr) return { code: -1, msg: pwErr };
    await query(`UPDATE ${table('user')} SET apikey = NULL, is_api = 0 WHERE id = ?`, [uid]);
    audit(req, {
      module: 'apikeys',
      action: 'apikey.revoke',
      targetType: 'api_key',
      targetId: 'legacy',
      summary: '停用旧版 API Key',
      scrubBody: true,
    });
    return { code: 0, msg: '旧版 API Key 已停用' };
  });

  app.post('/api/api-keys/revoke-all', auth, async (req: any) => {
    const uid = await targetUid(req, req.body?.uid);
    if (!uid) return { code: -1, msg: '无权限' };
    const pwErr = await requireWriteReauth(req);
    if (pwErr) return { code: -1, msg: pwErr };
    const res: any = await query(`UPDATE ${table('api_key')} SET active = 0, revoked_at = NOW() WHERE uid = ? AND active = 1`, [uid]);
    await query(`UPDATE ${table('user')} SET apikey = NULL, is_api = 0 WHERE id = ?`, [uid]);
    audit(req, {
      module: 'apikeys',
      action: 'apikey.revokeAll',
      targetType: 'api_key',
      targetId: uid,
      summary: `吊销用户 #${uid} 的全部 API Key`,
      detail: { count: Number(res?.affectedRows || 0) },
      scrubBody: true,
    });
    return { code: 0, msg: '已吊销全部 API Key', data: { count: Number(res?.affectedRows || 0) } };
  });

  app.delete('/api/api-keys/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT * FROM ${table('api_key')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: 'API Key 不存在' };
    if (!(await canManageKey(req, row))) return { code: -1, msg: '无权限' };
    const pwErr = await requireWriteReauth(req);
    if (pwErr) return { code: -1, msg: pwErr };
    await query(`UPDATE ${table('api_key')} SET active = 0, revoked_at = NOW() WHERE id = ?`, [id]);
    audit(req, {
      module: 'apikeys',
      action: 'apikey.revoke',
      targetType: 'api_key',
      targetId: id,
      targetName: String(row.name || ''),
      summary: `吊销 API Key「${row.name || id}」`,
      scrubBody: true,
    });
    return { code: 0, msg: '已吊销' };
  });
}

function parseIpList(value: any): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
