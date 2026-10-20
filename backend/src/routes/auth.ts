import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { findUserByUsername, verifyPassword, findUserById, DUMMY_PASSWORD_HASH } from '../auth.js';
import { query, table } from '../db.js';
import { generateSecret, provisioningUri, verifyTOTP } from '../lib/totp.js';
import { decryptText, encryptText } from '../lib/secret.js';
import { audit } from '../lib/audit/context.js';
import { autoUnlockConvenient } from '../lib/vault/service.js';

const SUPPORTED_LANGS = new Set(['zh-CN', 'en-US']);

// TOTP 防重放：记录每个用户在有效窗口内已使用过的动态口令，拒绝重复提交
const TOTP_REPLAY_WINDOW_MS = 90_000;
const usedTotp = new Map<number, Map<string, number>>();

function markTotpUsed(uid: number, code: string): boolean {
  const now = Date.now();
  let m = usedTotp.get(uid);
  if (!m) {
    m = new Map();
    usedTotp.set(uid, m);
  }
  for (const [k, t] of m) if (now - t > TOTP_REPLAY_WINDOW_MS) m.delete(k);
  if (m.has(code)) return false;
  m.set(code, now);
  return true;
}

function publicUser(user: any) {
  return { id: user.id, username: user.username, level: user.level, totp_open: user.totp_open, stat_cache: Number(user.stat_cache || 0), is_super: Number(user.is_super || 0), lang: user.lang || '' };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req: any) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetName: String(username || ''),
        summary: `登录失败：${username || '-'}（用户名或密码为空）`,
        detail: { reason: 'empty' },
      });
      return { code: -1, msg: '用户名或密码不能为空' };
    }
    const user = await findUserByUsername(username);
    if (!user) {
      await verifyPassword(DUMMY_PASSWORD_HASH, password);
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetName: String(username),
        summary: `登录失败：${username}（用户名或密码错误）`,
        detail: { reason: 'bad_credentials' },
      });
      return { code: -1, msg: '用户名或密码错误' };
    }
    const ok = await verifyPassword(user.password, password);
    if (!ok) {
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        targetName: String(user.username),
        summary: `登录失败：${username}（密码错误）`,
        detail: { reason: 'bad_password' },
      });
      return { code: -1, msg: '用户名或密码错误' };
    }
    // 密码正确后再提示封禁，避免未认证的用户名枚举
    if (user.status == 0) {
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        targetName: String(user.username),
        summary: `登录失败：${username}（账号已封禁）`,
        detail: { reason: 'banned' },
      });
      return { code: -1, msg: '此用户已被封禁' };
    }
    if (user.totp_open == 1 && user.totp_secret) {
      const preToken = (app as any).jwt.sign({ uid: user.id, type: 'totp_pre' }, { expiresIn: '5m' });
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        targetName: String(user.username),
        summary: `登录待二次验证：${username}`,
        detail: { reason: 'totp_required' },
      });
      return { code: -1, msg: '需要验证动态口令', vcode: 2, data: { pre_token: preToken } };
    }
    const jti = randomUUID();
    const payload = { uid: user.id, username: user.username, level: user.level, totp_open: user.totp_open, token_version: Number(user.token_version || 0), type: 'session', jti };
    const token = (app as any).jwt.sign(payload);
    await autoUnlockConvenient(user.id, jti);
    await query(`UPDATE ${table('user')} SET lasttime = NOW() WHERE id = ?`, [user.id]);
    await query(`INSERT INTO ${table('log')} (uid, action, data, addtime) VALUES (?, ?, ?, NOW())`, [
      user.id,
      '登录后台',
      'IP:' + (req.ip || ''),
    ]);
    audit(req, {
      uid: user.id,
      username: user.username,
      module: 'auth',
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      targetName: String(user.username),
      summary: `登录成功（IP ${req.ip || '-'}）`,
    });
    return {
      code: 0,
      msg: '登录成功',
      data: { token, user: publicUser(user) },
    };
  });

  app.post('/api/auth/totp', async (req: any) => {
    const { pre_token, code } = req.body || {};
    const totpFail = (reason: string, msg: string, user?: any) => {
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetId: user?.id,
        targetName: String(user?.username || ''),
        summary: `登录失败：${user?.username || 'TOTP'}（${reason}）`,
        detail: { reason },
      });
      return { code: -1, msg };
    };
    if (!pre_token) return totpFail('pre_token_missing', '请重新登录');
    if (!code) return totpFail('code_missing', '请输入动态口令');
    let decoded: any;
    try {
      decoded = (app as any).jwt.verify(pre_token);
    } catch {
      return totpFail('pre_token_expired', '验证已过期，请重新登录');
    }
    if (decoded.type !== 'totp_pre') return totpFail('bad_pre_token', '请重新登录');
    const user = await findUserById(decoded.uid);
    if (!user) return totpFail('user_missing', '用户不存在');
    if (Number(user.status) === 0) return totpFail('user_disabled', '账号已被禁用', user);
    if (user.totp_open != 1 || !user.totp_secret) return totpFail('totp_not_enabled', '未开启TOTP二次验证', user);
    const totpSecret = decryptText(user.totp_secret) || '';
    if (!verifyTOTP(totpSecret, code)) return totpFail('bad_code', '动态口令错误', user);
    if (!markTotpUsed(user.id, String(code).trim())) return totpFail('code_reused', '动态口令已被使用，请稍后再试', user);

    const jti = randomUUID();
    const payload = { uid: user.id, username: user.username, level: user.level, totp_open: user.totp_open, token_version: Number(user.token_version || 0), type: 'session', jti };
    const token = (app as any).jwt.sign(payload);
    await autoUnlockConvenient(user.id, jti);
    await query(`UPDATE ${table('user')} SET lasttime = NOW() WHERE id = ?`, [user.id]);
    await query(`INSERT INTO ${table('log')} (uid, action, data, addtime) VALUES (?, ?, ?, NOW())`, [
      user.id,
      '登录后台',
      'IP:' + (req.ip || ''),
    ]);
    audit(req, {
      uid: user.id,
      username: user.username,
      module: 'auth',
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      targetName: String(user.username),
      summary: `登录成功（TOTP，IP ${req.ip || '-'}）`,
    });
    return { code: 0, msg: '登录成功', data: { token, user: publicUser(user) } };
  });

  // 保存当前登录用户的语言偏好
  app.post('/api/auth/lang', { preHandler: (app as any).authenticate }, async (req: any) => {
    const lang = String((req.body || {}).lang || '');
    if (!SUPPORTED_LANGS.has(lang)) return { code: -1, msg: '不支持的语言' };
    await query(`UPDATE ${table('user')} SET lang = ? WHERE id = ?`, [lang, req.user.uid]);
    return { code: 0, msg: '语言偏好已更新' };
  });

  app.post('/api/auth/totp-config', { preHandler: (app as any).authenticate }, async (req: any) => {
    const { action, secret, code, password } = req.body || {};
    if (action === 'generate') {
      const s = generateSecret();
      return { code: 0, data: { secret: s, qrcode: provisioningUri(s, req.user.username, 'DNS Manager') } };
    }
    if (action !== 'bind' && action !== 'close') return { code: -1, msg: '未知操作' };
    // 变更二次验证状态属于敏感操作，必须重新校验登录密码，防止会话被盗后关闭/重绑 2FA
    const user = await findUserById(req.user.uid);
    if (!user) return { code: -1, msg: '用户不存在' };
    if (!password) return { code: -1, msg: '请输入登录密码以确认操作' };
    if (!(await verifyPassword(user.password, String(password)))) return { code: -1, msg: '登录密码错误' };
    if (action === 'bind') {
      if (!secret) return { code: -1, msg: '密钥不能为空' };
      if (!code) return { code: -1, msg: '请输入动态口令' };
      if (!verifyTOTP(secret, code)) return { code: -1, msg: '动态口令错误' };
      await query(`UPDATE ${table('user')} SET totp_open = 1, totp_secret = ?, token_version = token_version + 1 WHERE id = ?`, [encryptText(secret), req.user.uid]);
      return { code: 0, msg: 'TOTP 二次验证绑定成功' };
    }
    await query(`UPDATE ${table('user')} SET totp_open = 0, totp_secret = NULL, token_version = token_version + 1 WHERE id = ?`, [req.user.uid]);
    return { code: 0, msg: '已关闭 TOTP 二次验证' };
  });

  app.get('/api/auth/me', { preHandler: (app as any).authenticate }, async (req: any) => {
    const user = await findUserById(req.user.uid);
    if (!user) return { code: -1, msg: '用户不存在' };
    return { code: 0, data: publicUser(user) };
  });
}