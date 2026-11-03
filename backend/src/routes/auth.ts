import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { findUserByUsername, verifyPassword, findUserById, DUMMY_PASSWORD_HASH, md5 } from '../auth.js';
import { query, queryOne, table } from '../db.js';
import { generateSecret, provisioningUri, verifyTOTP } from '../lib/totp.js';
import { decryptText, encryptText } from '../lib/secret.js';
import { audit } from '../lib/audit/context.js';
import { autoUnlockConvenient } from '../lib/vault/service.js';
import { hitRateLimitDistributed } from '../lib/rateLimit.js';
import { revokeToken } from '../lib/auth/revocation.js';
import { clearVaultSession } from '../lib/vault/session.js';
import { requireLoginPassword } from '../lib/reauth.js';
import { getSysKey } from '../config.js';
import { legacyApiEnabled, consumeOneTimeTicket } from '../lib/legacyApi.js';

const SUPPORTED_LANGS = new Set(['zh-CN', 'en-US']);
const MAX_AUTH_FAILURES = 5;
const AUTH_LOCK_MS = 15 * 60_000;
const GENERIC_LOGIN_FAILED = '用户名或密码错误';

function lockedUntil(value: any): number {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : new Date(String(value).replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function authLocked(value: any): boolean {
  return lockedUntil(value) > Date.now();
}

// 失败计数必须由数据库原子累加：先在应用层「读旧值 +1 再写绝对值」会让并发请求
// 都读到同一个旧值并写回同一数字，5 次锁定永远无法触发。
// 注意 MySQL 的 SET 子句从左到右求值，locked_until 必须写在 login_fail 之前复用旧计数。
async function recordLoginFailure(user: any): Promise<void> {
  await query(
    `UPDATE ${table('user')}
        SET login_locked_until = CASE WHEN login_fail + 1 >= ? THEN ? ELSE login_locked_until END,
            login_fail = CASE WHEN login_fail + 1 >= ? THEN 0 ELSE login_fail + 1 END
      WHERE id = ?`,
    [MAX_AUTH_FAILURES, new Date(Date.now() + AUTH_LOCK_MS), MAX_AUTH_FAILURES, user.id],
  );
}

async function clearLoginFailure(uid: number): Promise<void> {
  await query(`UPDATE ${table('user')} SET login_fail = 0, login_locked_until = NULL WHERE id = ?`, [uid]);
}

async function recordTotpFailure(user: any): Promise<void> {
  await query(
    `UPDATE ${table('user')}
        SET totp_locked_until = CASE WHEN totp_fail + 1 >= ? THEN ? ELSE totp_locked_until END,
            totp_fail = CASE WHEN totp_fail + 1 >= ? THEN 0 ELSE totp_fail + 1 END
      WHERE id = ?`,
    [MAX_AUTH_FAILURES, new Date(Date.now() + AUTH_LOCK_MS), MAX_AUTH_FAILURES, user.id],
  );
}

async function clearTotpFailure(uid: number): Promise<void> {
  await query(`UPDATE ${table('user')} SET totp_fail = 0, totp_locked_until = NULL WHERE id = ?`, [uid]);
}

// TOTP 防重放：记录每个用户在有效窗口内已使用过的动态口令，拒绝重复提交。
// 使用数据库唯一键而不是进程内 Map，保证多副本部署时同一口令也只能成功一次。
const TOTP_REPLAY_WINDOW_MS = 90_000;

async function markTotpUsed(uid: number, code: string): Promise<boolean> {
  const now = Date.now();
  // 每次校验前清理过期记录；表上建有 expire_at 索引，成本很低
  await query(`DELETE FROM ${table('totp_replay')} WHERE expire_at < ?`, [now]).catch(() => undefined);
  const res: any = await query(
    `INSERT IGNORE INTO ${table('totp_replay')} (uid, code, expire_at) VALUES (?, ?, ?)`,
    [uid, code, now + TOTP_REPLAY_WINDOW_MS],
  );
  return Number(res?.affectedRows || 0) === 1;
}

function publicUser(user: any) {
  return { id: user.id, username: user.username, level: user.level, totp_open: user.totp_open, stat_cache: Number(user.stat_cache || 0), is_super: Number(user.is_super || 0), lang: user.lang || '' };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req: any) => {
    // 强制字符串化：mysql2 会把对象参数展开成 key = value 表达式，
    // 直接透传 req.body 里的对象会改变查询语义并产生 500。
    const b = req.body || {};
    const username = String(b.username ?? '').trim().slice(0, 128);
    const password = String(b.password ?? '');
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
    const locked = authLocked(user.login_locked_until);
    const ok = await verifyPassword(user.password, password);
    if (!ok) {
      // 已锁定时不再累加，避免攻击者把锁定时间无限续期
      if (!locked) await recordLoginFailure(user);
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        targetName: String(user.username),
        summary: `登录失败：${username}（密码错误）`,
        detail: { reason: locked ? 'login_locked' : 'bad_password' },
      });
      return { code: -1, msg: GENERIC_LOGIN_FAILED };
    }
    // 锁定只用于记录「这个账号正在被猜」，不再阻断口令正确的登录。
    // 旧行为下任何匿名者每 15 分钟发 5 次错误口令就能把管理员永久锁在门外（纯 DoS，无安全收益）：
    // 口令本来就会在锁定期内继续被校验，锁定并没有减少一次猜测成本。
    // 爆破节奏由 per-IP 限流（/api/auth/login 20/min）+ bcrypt 成本承担。
    if (locked) {
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        targetName: String(user.username),
        summary: `账号处于失败锁定窗口内但口令正确：${username}（已放行）`,
        detail: { reason: 'login_locked_but_password_ok' },
      });
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
    await clearLoginFailure(user.id);
    if (Number(user.totp_open) !== 0) {
      // 已开启二次验证但密钥缺失/损坏时必须 fail-closed，绝不能降级为仅密码登录
      if (!user.totp_secret) {
        audit(req, {
          module: 'auth',
          action: 'auth.login',
          targetType: 'user',
          targetId: user.id,
          targetName: String(user.username),
          summary: `登录失败：${username}（二次验证配置异常）`,
          detail: { reason: 'totp_secret_missing' },
        });
        return { code: -1, msg: '二次验证配置异常，请联系管理员重置' };
      }
      const preToken = (app as any).jwt.sign({ uid: user.id, type: 'totp_pre', token_version: Number(user.token_version || 0) }, { expiresIn: '5m' });
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
    if (user.totp_open != 1) await clearTotpFailure(user.id);
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
    // 按账号做分布式限流：仅靠 IP 桶时，攻击者可用大量伪造来源分摊请求，
    // 对同一账号的 6 位口令形成有效爆破速率。
    if (!(await hitRateLimitDistributed(`totp:${decoded.uid}`, 10, 60_000))) {
      return totpFail('totp_rate_limited', '验证尝试过于频繁，请稍后再试', user);
    }
    if (Number(user.status) === 0) return totpFail('user_disabled', '账号已被禁用', user);
    // 密码/2FA 变更会自增 token_version，旧的预令牌不得继续完成登录
    if (Number(decoded.token_version || 0) !== Number(user.token_version || 0)) {
      return totpFail('token_version_changed', '登录状态已失效，请重新登录', user);
    }
    // 锁定不阻断「口令正确」的登录（否则任何拿到密码的人都能把账号锁在门外），
    // 只用来限制错误口令的累加节奏：锁定期内错误口令不再续期锁定。
    const totpLocked = authLocked(user.totp_locked_until);
    if (user.totp_open != 1 || !user.totp_secret) return totpFail('totp_not_enabled', '未开启TOTP二次验证', user);
    // 解密失败必须 fail-closed：旧实现 decryptText(user.totp_secret) || '' 会退化为空 HMAC 密钥，
    // 攻击者只需密码即可离线算出确定性的 6 位码完成登录。
    let totpSecret = '';
    try {
      totpSecret = String(decryptText(user.totp_secret) || '');
    } catch {
      totpSecret = '';
    }
    if (!totpSecret) {
      return totpFail('totp_secret_corrupt', '二次验证配置异常，请联系管理员重置', user);
    }
    if (!verifyTOTP(totpSecret, code)) {
      if (!totpLocked) await recordTotpFailure(user);
      return totpFail(totpLocked ? 'totp_locked' : 'bad_code', '动态口令错误', user);
    }
    if (!(await markTotpUsed(user.id, String(code).trim()))) return totpFail('code_reused', '动态口令已被使用，请稍后再试', user);
    await clearLoginFailure(user.id);
    await clearTotpFailure(user.id);

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
    const { action, secret, code, password, bind_token } = req.body || {};
    if (action === 'generate') {
      const s = generateSecret();
      // 密钥由服务端生成并签名进一次性令牌：绑定只能使用服务端下发的密钥，
      // 客户端自选 secret（例如 AAAAAAAA…）会让 2FA 变成可预测的固定码。
      const token = (app as any).jwt.sign(
        { uid: Number(req.user.uid), type: 'totp_pending', secret: s },
        { expiresIn: '10m', jti: randomUUID() },
      );
      return { code: 0, data: { secret: s, bind_token: token, qrcode: provisioningUri(s, req.user.username, 'DNS Manager') } };
    }
    if (action !== 'bind' && action !== 'close') return { code: -1, msg: '未知操作' };
    // 变更二次验证状态属于敏感操作，必须重新校验登录密码，防止会话被盗后关闭/重绑 2FA
    const user = await findUserById(req.user.uid);
    if (!user) return { code: -1, msg: '用户不存在' };
    if (!password) return { code: -1, msg: '请输入登录密码以确认操作' };
    // 二次验证状态变更同样允许重输密码，与其他敏感操作共用跨实例尝试限制，避免会话被盗后爆破密码
    if (!(await hitRateLimitDistributed(`reauth:${req.user.uid}`, 10, 15 * 60_000))) {
      return { code: -1, msg: '密码确认过于频繁，请稍后再试' };
    }
    if (!(await verifyPassword(user.password, String(password)))) return { code: -1, msg: '登录密码错误' };
    if (action === 'bind') {
      if (!code) return { code: -1, msg: '请输入动态口令' };
      let pending: any = null;
      if (bind_token) {
        try {
          pending = (app as any).jwt.verify(String(bind_token));
        } catch {
          return { code: -1, msg: '密钥已过期，请重新生成' };
        }
      }
      if (!pending || pending.type !== 'totp_pending' || Number(pending.uid) !== Number(req.user.uid)) {
        return { code: -1, msg: '请先点击启用获取服务端下发的密钥' };
      }
      // 客户端传回的 secret 只用于校验一致性，真正绑定的是令牌里的服务端密钥
      if (secret && String(secret) !== String(pending.secret)) {
        return { code: -1, msg: '密钥与服务端下发的不一致，请重新生成' };
      }
      const bindSecret = String(pending.secret || '');
      if (!bindSecret) return { code: -1, msg: '密钥已过期，请重新生成' };
      if (!verifyTOTP(bindSecret, code)) return { code: -1, msg: '动态口令错误' };
      // 绑定环节同样登记防重放，避免同一个口令在登录流程中被再次使用
      if (!(await markTotpUsed(Number(req.user.uid), String(code).trim()))) {
        return { code: -1, msg: '动态口令已被使用，请稍后再试' };
      }
      await query(`UPDATE ${table('user')} SET totp_open = 1, totp_secret = ?, token_version = token_version + 1 WHERE id = ?`, [encryptText(bindSecret), req.user.uid]);
      return { code: 0, msg: 'TOTP 二次验证绑定成功' };
    }
    await query(`UPDATE ${table('user')} SET totp_open = 0, totp_secret = NULL, token_version = token_version + 1 WHERE id = ?`, [req.user.uid]);
    return { code: 0, msg: '已关闭 TOTP 二次验证' };
  });

  app.post('/api/auth/reauth', { preHandler: (app as any).authenticate }, async (req: any) => {
    const uid = Number(req.user.uid);
    const passwordErr = await requireLoginPassword(uid, req.body?.password, req);
    if (passwordErr) return { code: -1, msg: passwordErr };
    const user = await findUserById(uid);
    if (!user || Number(user.status) === 0) return { code: -1, msg: '用户不存在或已禁用' };
    // sid 绑定签发会话、op 绑定具体操作：令牌不能再被拿去执行别的敏感操作，
    // 也不会在登出/换设备后继续有效（校验时比对当前请求的 jti）。
    const reauthOp = String(req.body?.op || '*').trim().slice(0, 64) || '*';
    const token = (app as any).jwt.sign(
      { uid, type: 'reauth', token_version: Number(user.token_version || 0), sid: String(req.user.jti || ''), op: reauthOp },
      { expiresIn: '5m', jti: randomUUID() },
    );
    audit(req, { module: 'auth', action: 'auth.reauth', summary: '获取敏感操作二次确认令牌', detail: { op: reauthOp }, scrubBody: true });
    return { code: 0, data: { token, expires_in: 300, op: reauthOp } };
  });

  // 服务端登出：把当前 jti 写入吊销表，令牌在过期前立即失效，而不只是清 localStorage
  app.post('/api/auth/logout', { preHandler: (app as any).authenticate }, async (req: any) => {
    const uid = Number(req.user.uid);
    const jti = String(req.user.jti || '');
    const exp = Number(req.user.exp || 0);
    if (jti) await revokeToken(jti, uid, exp ? new Date(exp * 1000) : undefined);
    clearVaultSession(uid, jti || undefined);
    return { code: 0, msg: '已退出登录' };
  });

  // 退出全部设备：自增 token_version 使所有已签发令牌失效；需重输密码确认
  app.post('/api/auth/logout-all', { preHandler: (app as any).authenticate }, async (req: any) => {
    const uid = Number(req.user.uid);
    const passwordErr = await requireLoginPassword(uid, req.body?.password, req);
    if (passwordErr) return { code: -1, msg: passwordErr };
    await query(`UPDATE ${table('user')} SET token_version = token_version + 1 WHERE id = ?`, [uid]);
    // 当前会话立即失效（其他会话最迟在鉴权缓存 TTL 内失效）
    const jti = String(req.user.jti || '');
    const exp = Number(req.user.exp || 0);
    if (jti) await revokeToken(jti, uid, exp ? new Date(exp * 1000) : undefined);
    clearVaultSession(uid);
    return { code: 0, msg: '已退出全部设备，请重新登录' };
  });

  app.get('/quicklogin', async (req: any, reply: any) => {
    if (!(await legacyApiEnabled())) return reply.code(404).type('text/plain').send('404 Not Found');
    const domain = String(req.query?.domain || '').trim();
    const timestamp = String(req.query?.timestamp || '').trim();
    const token = String(req.query?.token || '').trim();
    const sign = String(req.query?.sign || '').trim();
    // 只读标记由签发方（旧版 API）按调用者真实授权计算并参与签名，快捷登录不能自行放大
    const readonly = String(req.query?.ro ?? '0').trim() === '1' ? 1 : 0;
    if (!domain || !timestamp || !token || !sign) return reply.code(400).type('text/plain').send('参数错误');
    const ts = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    // 时间窗只用来兜住"签发后多久还能用"，重放由下面的一次性票据拦截；
    // 原来的 ±300s 窗口内同一张签名 URL 可以无限次换取 2 小时会话。
    if (!Number.isFinite(ts) || ts < now - 120 || ts > now + 120) return reply.code(400).type('text/plain').send('时间戳无效');
    const sysKey = await getSysKey();
    const expected = md5(sysKey + domain + timestamp + token + String(readonly) + sysKey);
    const ha = createHash('sha256').update(expected).digest();
    const hb = createHash('sha256').update(sign).digest();
    if (!timingSafeEqual(ha, hb)) return reply.code(400).type('text/plain').send('签名错误');
    const row: any = await queryOne(`SELECT id, name, is_sso FROM ${table('domain')} WHERE name = ? LIMIT 1`, [domain]);
    if (!row) return reply.code(404).type('text/plain').send('该域名不存在');
    if (Number(row.is_sso) !== 1) return reply.code(403).type('text/plain').send('该域名不支持快捷登录');
    // 一次性消费：sign 唯一对应一组 (domain, timestamp, token, ro)，重放同一链接直接拒绝
    if (!(await consumeOneTimeTicket(`ql:${sign}`, Number(row.id)))) {
      return reply.code(403).type('text/plain').send('该快捷登录链接已被使用，请重新获取');
    }
    const jti = randomUUID();
    const nonce = randomUUID();
    const session = (app as any).jwt.sign(
      { uid: -Number(row.id), did: Number(row.id), domain: row.name, type: 'legacy_domain', lro: readonly, jti },
      { expiresIn: '2h' },
    );
    const user = { id: 0, username: `domain:${row.name}`, level: 1, totp_open: 0, stat_cache: 0, is_super: 0, lang: '', legacy_domain: row.name, legacy_domain_readonly: readonly };
    const js = (value: any) => JSON.stringify(value).replace(/</g, '\\u003c');
    const target = `/domains/${Number(row.id)}/records`;
    audit(req, { uid: 0, username: `domain:${row.name}`, targetType: 'domain', targetId: Number(row.id), targetName: row.name, summary: `旧版域名快捷登录 ${row.name}${readonly ? '（只读）' : ''}` });
    reply.header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'; worker-src 'self' blob:`,
    );
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8"><title>正在登录</title></head><body><script nonce="${nonce}">localStorage.setItem('dnsmgr_token', ${js(session)});localStorage.setItem('dnsmgr_user', ${js(user)});location.replace(${js(target)});</script>正在登录…</body></html>`);
  });

  app.get('/api/auth/me', { preHandler: (app as any).authenticate }, async (req: any) => {
    if (req.user?.auth_type === 'legacy_domain') {
      return {
        code: 0,
        data: {
          id: 0,
          username: String(req.user.username || ''),
          level: 1,
          totp_open: 0,
          stat_cache: 0,
          is_super: 0,
          lang: '',
          legacy_domain: String(req.user.legacy_domain || ''),
        },
      };
    }
    const user = await findUserById(req.user.uid);
    if (!user) return { code: -1, msg: '用户不存在' };
    return { code: 0, data: publicUser(user) };
  });
}