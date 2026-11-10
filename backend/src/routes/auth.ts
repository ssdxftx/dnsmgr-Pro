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

// 失败计数必须由数据库原子累加：先在应用层「读旧值 +1 再写绝对值」会让并发请求
// 都读到同一个旧值并写回同一数字，5 次锁定永远无法触发。
// 同时把「占用一次尝试」提前到 bcrypt 校验之前：否则并发请求都能通过 locked 检查，
// 在锁定生效前完成任意多次口令校验。只有成功占用名额的请求才能继续验证。
// 这里在达到阈值时立即置锁，但本次 UPDATE 仍成功返回：第 5 次尝试可以继续校验，
// 成功会在下方清零解锁，失败则锁定保留。这样既不会误拒第 5 次正确口令，
// 也不会因进程在第 5 次校验前崩溃而留下“计数已满但未锁定”的永久拒绝状态。
async function reserveLoginAttempt(uid: number): Promise<boolean> {
  const res: any = await query(
    `UPDATE ${table('user')}
        SET login_locked_until = CASE WHEN login_fail + 1 >= ? THEN ? ELSE login_locked_until END,
            login_fail = CASE WHEN login_fail + 1 >= ? THEN 0 ELSE login_fail + 1 END
      WHERE id = ?
        AND (login_locked_until IS NULL OR login_locked_until <= ?)
        AND login_fail < ?`,
    [MAX_AUTH_FAILURES, new Date(Date.now() + AUTH_LOCK_MS), MAX_AUTH_FAILURES, uid, new Date(), MAX_AUTH_FAILURES],
  );
  return Number(res?.affectedRows || 0) > 0;
}

/** 口令校验失败后置锁；失败次数已在 reserveLoginAttempt 中累加 */
async function markLoginFailureLock(uid: number): Promise<void> {
  await query(
    `UPDATE ${table('user')}
        SET login_locked_until = CASE WHEN login_fail >= ? THEN ? ELSE login_locked_until END,
            login_fail = CASE WHEN login_fail >= ? THEN 0 ELSE login_fail END
      WHERE id = ?`,
    [MAX_AUTH_FAILURES, new Date(Date.now() + AUTH_LOCK_MS), MAX_AUTH_FAILURES, uid],
  );
}

async function clearLoginFailure(uid: number): Promise<void> {
  await query(`UPDATE ${table('user')} SET login_fail = 0, login_locked_until = NULL WHERE id = ?`, [uid]);
}

async function reserveTotpAttempt(uid: number): Promise<boolean> {
  const res: any = await query(
    `UPDATE ${table('user')}
        SET totp_locked_until = CASE WHEN totp_fail + 1 >= ? THEN ? ELSE totp_locked_until END,
            totp_fail = CASE WHEN totp_fail + 1 >= ? THEN 0 ELSE totp_fail + 1 END
      WHERE id = ?
        AND (totp_locked_until IS NULL OR totp_locked_until <= ?)
        AND totp_fail < ?`,
    [MAX_AUTH_FAILURES, new Date(Date.now() + AUTH_LOCK_MS), MAX_AUTH_FAILURES, uid, new Date(), MAX_AUTH_FAILURES],
  );
  return Number(res?.affectedRows || 0) > 0;
}

/** 动态口令校验失败后置锁；失败次数已由 reserveTotpAttempt 原子累加 */
async function markTotpFailureLock(uid: number): Promise<void> {
  await query(
    `UPDATE ${table('user')}
        SET totp_locked_until = CASE WHEN totp_fail >= ? THEN ? ELSE totp_locked_until END,
            totp_fail = CASE WHEN totp_fail >= ? THEN 0 ELSE totp_fail END
      WHERE id = ?`,
    [MAX_AUTH_FAILURES, new Date(Date.now() + AUTH_LOCK_MS), MAX_AUTH_FAILURES, uid],
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
    // 锁定检查与名额占用合并为一条原子 UPDATE：
    // 并发请求只有前 MAX_AUTH_FAILURES 个能继续校验口令，其余直接拒绝。
    if (!(await reserveLoginAttempt(Number(user.id)))) {
      // 锁定分支也要执行一次等代价的 bcrypt，避免「锁定/不存在用户」响应时间差成为用户名枚举侧信道。
      await verifyPassword(DUMMY_PASSWORD_HASH, password);
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        targetName: String(user.username),
        summary: `登录失败：${username}（账号处于临时锁定期）`,
        detail: { reason: 'login_locked' },
      });
      // 锁定分支必须与“用户名不存在/密码错误”返回完全一致，否则连发 6 次错误口令
      // 就能判断账号是否存在。锁定状态只写入审计日志。
      return { code: -1, msg: GENERIC_LOGIN_FAILED };
    }
    const ok = await verifyPassword(user.password, password);
    if (!ok) {
      // 失败次数已在 reserveLoginAttempt 中原子累加；达到阈值时在这里置锁。
      await markLoginFailureLock(Number(user.id));
      audit(req, {
        module: 'auth',
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        targetName: String(user.username),
        summary: `登录失败：${username}（密码错误）`,
        detail: { reason: 'bad_password' },
      });
      return { code: -1, msg: GENERIC_LOGIN_FAILED };
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
    // 2FA 失败锁定必须真正拒绝：动态口令只有 6 位，若锁定期内继续比对，
    // 分布式限流之外的窗口仍可被慢慢试出。锁定 15 分钟且不随失败续期。
    // 与登录一致，先原子占用尝试名额，再解密/比对，避免并发绕过锁定。
    if (user.totp_open != 1 || !user.totp_secret) return totpFail('totp_not_enabled', '未开启TOTP二次验证', user);
    if (!(await reserveTotpAttempt(Number(user.id)))) {
      return totpFail('totp_locked', '验证失败次数过多，请稍后再试', user);
    }
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
      await markTotpFailureLock(Number(user.id));
      return totpFail('bad_code', '动态口令错误', user);
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
    const { action, secret, code, password, bind_token, current_code } = req.body || {};
    // API Key 是长期自动化凭据，不应能变更第二因素；否则一把带 auth 作用域的
    // 泄露 Key 配合已泄露密码即可关闭 TOTP。
    if (String(req.user.auth_type || '') === 'api_key') {
      return { code: -1, msg: '该操作仅支持登录会话，请使用账号密码登录后再试' };
    }
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
    // 已开启 2FA 时，重绑/关闭必须再验证一次当前动态口令：
    // 仅凭“会话 + 登录密码”不足以移除第二因素。
    const requireCurrentTotp = async (): Promise<string | null> => {
      if (Number(user.totp_open) !== 1) return null;
      if (!current_code) return '请输入当前动态口令';
      const curSecret = decryptText(user.totp_secret);
      if (!curSecret) return '二次验证配置异常，请联系管理员重置';
      if (!verifyTOTP(curSecret, String(current_code))) return '当前动态口令错误';
      if (!(await markTotpUsed(Number(req.user.uid), String(current_code).trim()))) {
        return '当前动态口令已被使用，请稍后再试';
      }
      return null;
    };
    if (action === 'bind') {
      const curErr = await requireCurrentTotp();
      if (curErr) return { code: -1, msg: curErr };
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
      // token_version 已自增：为当前会话补发新令牌，避免用户刚启用 2FA 就被下一次请求踢下线。
      const nextVersion = Number(user.token_version || 0) + 1;
      const sessionToken = (app as any).jwt.sign({
        uid: user.id,
        username: user.username,
        level: user.level,
        totp_open: 1,
        token_version: nextVersion,
        type: 'session',
        jti: String(req.user.jti || '') || randomUUID(),
      });
      return { code: 0, msg: 'TOTP 二次验证绑定成功', data: { token: sessionToken } };
    }
    const closeErr = await requireCurrentTotp();
    if (closeErr) return { code: -1, msg: closeErr };
    await query(`UPDATE ${table('user')} SET totp_open = 0, totp_secret = NULL, token_version = token_version + 1 WHERE id = ?`, [req.user.uid]);
    const nextVersion = Number(user.token_version || 0) + 1;
    const sessionToken = (app as any).jwt.sign({
      uid: user.id,
      username: user.username,
      level: user.level,
      totp_open: 0,
      token_version: nextVersion,
      type: 'session',
      jti: String(req.user.jti || '') || randomUUID(),
    });
    return { code: 0, msg: '已关闭 TOTP 二次验证', data: { token: sessionToken } };
  });

  app.post('/api/auth/reauth', { preHandler: (app as any).authenticate }, async (req: any) => {
    const uid = Number(req.user.uid);
    // 二次确认令牌必须绑定到具体登录会话；API Key 的合成 jti 不能用来换取令牌。
    if (!String(req.user.jti || '') || String(req.user.auth_type || '') === 'api_key') {
      return { code: -1, msg: '二次确认仅支持登录会话，请使用账号密码登录后再试' };
    }
    // 该接口只接受登录密码，绝不接受 X-Reauth-Token：否则一张低权限的二次确认令牌
    // 可以被兑换成任意 op 的新令牌，操作绑定形同虚设。
    const password = String(req.body?.password || '');
    if (!password) return { code: -1, msg: '请输入登录密码' };
    const user: any = await findUserById(uid);
    if (!user || Number(user.status) === 0) return { code: -1, msg: '用户不存在或已禁用' };
    if (!(await hitRateLimitDistributed(`reauth:${uid}`, 10, 15 * 60_000))) {
      return { code: -1, msg: '密码确认过于频繁，请稍后再试' };
    }
    if (!(await verifyPassword(user.password, password))) return { code: -1, msg: '登录密码错误' };
    // sid 绑定签发会话、op 绑定具体操作：令牌不能再被拿去执行别的敏感操作，
    // 也不会在登出/换设备后继续有效（校验时比对当前请求的 jti）。
    const reauthOp = String(req.body?.op || '').trim().slice(0, 64);
    if (!reauthOp || reauthOp === '*') {
      return { code: -1, msg: '请指定本次二次确认的操作类型' };
    }
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
    const passwordErr = await requireLoginPassword(uid, req.body?.password, req, 'auth.logout-all');
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
    // 签名只覆盖域名名称，没有 domain id。若库中存在同名行（历史/导入数据只保证 aid+name 唯一），
    // LIMIT 1 会把会话绑定到任意账户（含他人私有账户）；这里要求名称全局唯一，否则 fail-closed。
    const rows: any[] = await query(
      `SELECT id, name, is_sso FROM ${table('domain')} WHERE name = ? LIMIT 2`,
      [domain],
    );
    if (!rows.length) return reply.code(404).type('text/plain').send('该域名不存在');
    if (rows.length > 1) {
      return reply.code(409).type('text/plain').send('该域名存在多条同名记录，无法安全快捷登录，请联系管理员处理');
    }
    const row: any = rows[0];
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
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8"><title>正在登录</title></head><body><script nonce="${nonce}">localStorage.setItem('dnsmgr_token', ${js(session)});localStorage.setItem('dnsmgr_user', ${js(user)});history.replaceState(null,'',${js(target)});location.replace(${js(target)});</script>正在登录…</body></html>`);
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