import type { FastifyInstance } from 'fastify';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { configGet, configSet, loadConfig } from '../config.js';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { sendMail, sendTelegram, sendWebhook, sendCustomWebhook, sendQqbot } from '../lib/monitor/msgNotice.js';
import { refreshAllStatCache, clearStatCache } from '../lib/cdn/statistics/cacheService.js';
import { clearOverviewCache } from '../lib/cdn/statistics/overview.js';
import { clearDetailCache } from '../lib/cdn/statistics/detail/cache.js';
import { executeAll as runScheduleAll } from '../lib/schedule/scheduleService.js';
import { executeAll as runOptimizeAll } from '../lib/optimize/optimizeService.js';
import { withDistributedLock } from '../lib/scheduler/distLock.js';
import { checkLevel } from '../auth.js';
import { SECRET_MASK, isSecretKey } from '../lib/secret.js';
import { audit } from '../lib/audit/context.js';
import { refreshGlobalProxyDispatcher } from '../lib/proxy.js';
import { requireLoginPassword } from '../lib/reauth.js';
import { isMaintenance } from '../lib/backup/maintenance.js';

// 系统设置接口仅管理员可用（/api/system/cron 走独立密钥校验，不经过此 auth）
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}
// 需要重输登录密码才能修改的敏感项：除凭据/通道配置外，注册开关、定时任务密钥、
// 审计保留期都可能被会话被盗者用来对抗取证或扩大攻击面，必须纳入二次确认。
const SENSITIVE_SETTING_RE =
  /^(proxy_|mail_|webhook_|custom_webhook_|tgbot_|wechat_|qqbot_|cron_|register_|backup_|legacy_|audit_retain_days$)/;

const authenticate = (app: FastifyInstance) => ({
  preHandler: async (req: any, reply: any) => {
    await (app as any).authenticate(req, reply);
    if (!req.user) return;
    if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
  },
});

// 允许通过系统设置接口写入的配置键白名单，避免写入任意/未知配置项
const SETTINGS_KEYS = new Set([
  'mail_type', 'mail_smtp', 'mail_port', 'mail_name', 'mail_pwd', 'mail_apiuser', 'mail_apikey', 'mail_recv',
  'wechat_apptoken', 'wechat_appuid',
  'tgbot_token', 'tgbot_chatid', 'tgbot_topicid', 'tgbot_proxy', 'tgbot_url',
  'qqbot_appid', 'qqbot_appsecret', 'qqbot_openid', 'qqbot_bind_code',
  'webhook_url', 'webhook_user',
  'custom_webhook_url', 'custom_webhook_method', 'custom_webhook_content_type', 'custom_webhook_headers', 'custom_webhook_body', 'custom_webhook_content_format',
  'vcode', 'register_enable', 'register_mode',
  'proxy_server', 'proxy_port', 'proxy_user', 'proxy_pwd', 'proxy_type',
  'cron_type', 'cron_key', 'legacy_api_enable',
  'cdn_stats_cache', 'cdn_stats_cache_interval', 'audit_retain_days',
]);

export default async function systemRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // 获取全部系统配置（敏感项脱敏：JWT 签名密钥不外发，密钥/口令类字段一律以掩码返回）
  app.get('/api/system/settings', auth, async () => {
    const cfg = { ...(await loadConfig()) };
    delete cfg.sys_key;
    for (const [k, v] of Object.entries(cfg)) {
      if (v && isSecretKey(k)) cfg[k] = SECRET_MASK;
    }
    return { code: 0, data: cfg };
  });

  // 保存系统配置（忽略掩码值，避免未修改的密钥被写坏；禁止通过该接口修改签名密钥）
  app.post('/api/system/settings', auth, async (req: any) => {
    const b = req.body || {};
    if (Object.keys(b).some((key) => SENSITIVE_SETTING_RE.test(key))) {
      const passwordErr = await requireLoginPassword(Number(req.user.uid), b.password, req);
      if (passwordErr) return { code: -1, msg: passwordErr };
    }
    delete b.password;
    const before = await loadConfig();
    const changed: string[] = [];
    if (b.mail_type !== undefined && b.mail_name2 !== undefined && Number(b.mail_type) > 0) {
      b.mail_name = b.mail_name2;
      delete b.mail_name2;
    }
    // QQ 机器人 AppID/AppSecret 变更后需重新绑定，清空已记录的 openid
    if ('qqbot_appid' in b || 'qqbot_appsecret' in b) {
      const oldId = (await configGet('qqbot_appid', '')) || '';
      const oldSecret = (await configGet('qqbot_appsecret', '')) || '';
      const newId = 'qqbot_appid' in b ? String(b.qqbot_appid) : oldId;
      let newSecret = 'qqbot_appsecret' in b ? String(b.qqbot_appsecret) : oldSecret;
      if (newSecret === SECRET_MASK) newSecret = oldSecret;
      if (newId !== oldId || newSecret !== oldSecret) b.qqbot_openid = '';
    }
    for (const [key, value] of Object.entries(b)) {
      if (!key || key === 'sys_key') continue;
      if (!SETTINGS_KEYS.has(key)) continue;
      if (isSecretKey(key) && String(value) === SECRET_MASK) continue;
      if (String(before[key] ?? '') !== String(value)) changed.push(key);
      await configSet(key, String(value));
    }
    if (changed.some((k) => k.startsWith('proxy_'))) {
      await refreshGlobalProxyDispatcher().catch((e: any) =>
        console.error('[dnsmgr-backend] 应用系统代理失败:', e?.message || e),
      );
    }
    if (changed.length) {
      audit(req, {
        summary: `保存系统设置：${changed.slice(0, 8).join('、')}${changed.length > 8 ? ` 等 ${changed.length} 项` : ''}`,
        changes: changed.slice(0, 20).map((k) => ({
          field: k,
          from: isSecretKey(k) ? (before[k] ? '已设置' : '未设置') : String(before[k] ?? ''),
          to: isSecretKey(k) ? '已更新' : String(b[k] ?? ''),
        })),
        detail: { keys: changed },
      });
    }
    return { code: 0, msg: 'succ' };
  });

  // 发送测试邮件
  app.post('/api/system/mailtest', auth, async () => {
    const mailName = (await configGet('mail_recv')) || (await configGet('mail_name'));
    if (!mailName) return { code: -1, msg: '您还未设置邮箱！' };
    const result = await sendMail(mailName, '邮件发送测试。', '这是一封测试邮件！<br/><br/>来自：聚合DNS管理系统');
    if (result === true) return { code: 0, msg: '邮件发送成功！' };
    return { code: -1, msg: '邮件发送失败！' + (result as string) };
  });

  // 发送测试 Telegram
  app.post('/api/system/tgbottest', auth, async () => {
    const token = await configGet('tgbot_token');
    const chatid = await configGet('tgbot_chatid');
    if (!token || !chatid) return { code: -1, msg: '请先保存设置' };
    const content = '<strong>消息发送测试</strong>\n\n这是一封测试消息！\n\n来自：聚合DNS管理系统';
    const result = await sendTelegram(content);
    if (result === true) return { code: 0, msg: '消息发送成功！' };
    return { code: -1, msg: '消息发送失败！' + (result as string) };
  });

  // 清空 CDN 数据统计缓存
  app.post('/api/system/stat-cache-clear', auth, async () => {
    const n = await clearStatCache();
    clearOverviewCache();
    clearDetailCache();
    return { code: 0, msg: `已清空统计缓存数据（${n} 条）` };
  });

  // 立即刷新 CDN 数据统计缓存
  app.post('/api/system/stat-cache-refresh', auth, async () => {
    if ((await configGet('cdn_stats_cache', '0')) !== '1') return { code: -1, msg: '请先开启统计缓存' };
    const r = await refreshAllStatCache();
    return { code: 0, msg: `已刷新 ${r.accounts} 个账户` + (r.errors.length ? `，部分失败：${r.errors.join('；')}` : '') };
  });

  // 发送测试 QQ 机器人消息
  app.post('/api/system/qqbottest', auth, async () => {
    const appId = await configGet('qqbot_appid');
    const appSecret = await configGet('qqbot_appsecret');
    const openid = await configGet('qqbot_openid');
    if (!appId || !appSecret || !openid) return { code: -1, msg: '请先配置QQ机器人并完成绑定' };
    const result = await sendQqbot('消息发送测试', '这是一封测试消息！<br/>来自：聚合DNS管理系统');
    if (result === true) return { code: 0, msg: '消息发送成功！' };
    return { code: -1, msg: '消息发送失败！' + (result as string) };
  });

  // 发送测试 Webhook
  app.post('/api/system/webhooktest', auth, async () => {
    const url = await configGet('webhook_url');
    if (!url) return { code: -1, msg: '请先保存设置' };
    const content = '这是一封测试消息！\n来自：聚合DNS管理系统';
    const result = await sendWebhook('消息发送测试', content);
    if (result === true) return { code: 0, msg: '消息发送成功！' };
    return { code: -1, msg: '消息发送失败！' + (result as string) };
  });

  // 发送测试自定义 Webhook
  app.post('/api/system/customwebhooktest', auth, async () => {
    const url = await configGet('custom_webhook_url');
    if (!url) return { code: -1, msg: '请先保存设置' };
    const content = '这是一封测试消息！\n来自：聚合DNS管理系统';
    const result = await sendCustomWebhook('消息发送测试', content);
    if (result === true) return { code: 0, msg: '消息发送成功！' };
    return { code: -1, msg: '消息发送失败！' + (result as string) };
  });

  // 测试代理连通性
  app.post('/api/system/proxytest', auth, async (req: any) => {
    const b = req.body || {};
    const server = (b.proxy_server || '').trim();
    const port = Number(b.proxy_port || 0);
    const user = (b.proxy_user || '').trim();
    const pwd = (b.proxy_pwd || '').trim();
    const type = (b.proxy_type || 'http').trim();
    if (!server || !port) return { code: -1, msg: '代理服务器和端口不能为空' };

    let scheme = 'http';
    if (type === 'https') scheme = 'https';
    else if (type === 'sock4') scheme = 'socks4';
    else if (type === 'sock5') scheme = 'socks5';
    else if (type === 'sock5h') scheme = 'socks5h';

    const authPart = user && pwd ? `${encodeURIComponent(user)}:${encodeURIComponent(pwd)}@` : '';
    const uri = `${scheme}://${authPart}${server}:${port}`;

    const targets = ['https://myip.ipip.net/', 'http://ip-api.com/'];
    const agent = new ProxyAgent(uri);
    let lastErr = '代理连接失败';
    for (const target of targets) {
      try {
        const res = await undiciFetch(target, {
          dispatcher: agent,
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0' },
        } as any);
        if (res.status >= 200 && res.status < 400) {
          return { code: 0, msg: '连通性测试成功！' };
        }
        lastErr = 'HTTP状态码异常：' + res.status;
      } catch (e: any) {
        lastErr = e?.cause?.message || e?.message || '代理连接失败';
      }
    }
    return { code: -1, msg: lastErr };
  });

  async function runCron(req: any): Promise<{ ok: boolean; msg?: string }> {
    // 维护/恢复期间禁止外部 cron 触发解析写入，避免与恢复事务并发
    if (isMaintenance()) return { ok: false, msg: '系统正在恢复数据，请稍后再试' };
    // 优先从请求头读取，避免密钥出现在代理/CDN 访问日志与浏览器历史中；query 仅作兼容
    const authHeader = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    const key = String(req.headers?.['x-cron-key'] || authHeader || req.query?.key || '');
    const cronType = await configGet('cron_type', '0');
    const cronKey = await configGet('cron_key');
    if (cronType !== '1' || !cronKey) return { ok: false, msg: '未开启当前方式' };
    if (!safeEqual(key, cronKey)) return { ok: false, msg: '访问密钥错误' };
    // 与内嵌调度器共用分布式锁，避免外部 cron 与进程内定时器同时执行同一任务
    await withDistributedLock('dnsmgr:schedule', runScheduleAll).catch((e: any) =>
      console.error('[schedule] 定时切换解析异常:', e?.message || e),
    );
    await withDistributedLock('dnsmgr:optimize', runOptimizeAll).catch((e: any) =>
      console.error('[optimize] 优选IP调度异常:', e?.message || e),
    );
    return { ok: true };
  }

  // 计划任务触发（兼容 PHP cron URL，key 校验）
  app.get('/api/system/cron', async (req: any) => {
    const result = await runCron(req);
    return result.ok ? { code: 0, data: 'success!' } : { code: -1, msg: result.msg };
  });

  // 旧版 /cron?key= 明文输出，仅在兼容层开启时注册可用
  app.get('/cron', async (req: any, reply: any) => {
    if ((await configGet('legacy_api_enable', '0')) !== '1') return reply.code(404).type('text/plain').send('404 Not Found');
    const result = await runCron(req);
    return reply.type('text/plain').send(result.ok ? 'success!' : result.msg || '执行失败');
  });

  // 生成/获取 cron key
  app.get('/api/system/cronkey', auth, async () => {
    let cronKey = await configGet('cron_key', '');
    if (!cronKey) {
      cronKey = randomBytes(24).toString('base64url');
      await configSet('cron_key', cronKey);
    }
    const cronType = await configGet('cron_type', '0');
    return { code: 0, data: { cron_key: cronKey, cron_type: cronType } };
  });
}