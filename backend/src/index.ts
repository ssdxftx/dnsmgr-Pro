import Fastify from 'fastify';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { configGet, getSysKey } from './config.js';
import { isInstalled, getInstallState } from './installer.js';
import { initSetupToken } from './lib/setupToken.js';
import { findUserById } from './auth.js';
import { ConfigDecryptError, setSecretKey } from './lib/secret.js';
import { migrate } from './migrate.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import domainRoutes from './routes/domain.js';
import dashboardRoutes from './routes/dashboard.js';
import cdnRoutes from './routes/cdn.js';
import certRoutes from './routes/cert.js';
import dmonitorRoutes from './routes/dmonitor.js';
import optimizeRoutes from './routes/optimizeip.js';
import scheduleRoutes from './routes/schedule.js';
import systemRoutes from './routes/system.js';
import userRoutes from './routes/user.js';
import cloudflareRoutes from './routes/cloudflare.js';
import cfRulesRoutes from './routes/cfrules.js';
import expireRoutes from './routes/expire.js';
import registerRoutes from './routes/register.js';
import setupRoutes from './routes/setup.js';
import aboutRoutes from './routes/about.js';
import preheatRoutes from './routes/preheat.js';
import dnsCheckRoutes from './routes/dnscheck.js';
import qqbotRoutes from './routes/qqbot.js';
import { startMonitorScheduler } from './lib/monitor/scheduler.js';
import { executeAll as runOptimizeAll } from './lib/optimize/optimizeService.js';
import { executeAll as runScheduleAll } from './lib/schedule/scheduleService.js';
import { expireNoticeTask } from './lib/expire/expireNoticeService.js';
import { executePreheatTasks } from './lib/cdn/preheatService.js';
import { executeCheckTasks } from './lib/dns/checkService.js';
import { certTaskRun } from './lib/cert/certTaskService.js';
import { withDistributedLock } from './lib/scheduler/distLock.js';
import { refreshAllStatCache, getStatCacheIntervalMs, isStatCacheEnabled } from './lib/cdn/statistics/cacheService.js';
import { applySecurityHeaders, createRateLimit } from './security.js';
import { query, table } from './db.js';
import { registerAuditHooks } from './lib/audit/hooks.js';
import { shutdownAudit } from './lib/audit/store.js';
import auditRoutes from './routes/audit.js';
import backupRoutes, { runDueBackupSchedules } from './routes/backup.js';
import vaultRoutes from './routes/vault.js';
import { cleanTmpFiles } from './lib/backup/export.js';
import { ensureDataDirs } from './lib/backup/archive.js';
import { initMaintenance, isMaintenance } from './lib/backup/maintenance.js';
import { refreshGlobalProxyDispatcher } from './lib/proxy.js';

process.on('unhandledRejection', (reason: any) => {
  console.error('[backend] 未捕获的异步异常:', reason?.message || reason);
});
process.on('uncaughtException', (err: any) => {
  console.error('[backend] 未捕获异常:', err?.message || err);
});

function resolveWebDir(): string {
  if (process.env.DNSMGR_WEB_DIR) return process.env.DNSMGR_WEB_DIR;
  const candidates = [
    path.join(process.cwd(), 'dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), 'web'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return '';
}

function resolveTrustProxy(): boolean | string | number {
  const raw = (process.env.DNSMGR_TRUST_PROXY || '').trim();
  if (!raw) return false;
  const low = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(low)) {
    console.warn(
      '[dnsmgr-backend] DNSMGR_TRUST_PROXY=true 会信任任意 X-Forwarded-For。仅在服务确实位于受信反向代理之后时才可开启，' +
        '否则攻击者可伪造 IP 绕过登录/注册限流；建议改为配置受信代理的 IP 或网段。',
    );
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(low)) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

const app = Fastify({
  logger: false,
  // Fastify 5 类型不再声明数值形式，但运行时仍支持按跳数信任代理，故此处保留原语义
  trustProxy: resolveTrustProxy() as any,
  bodyLimit: Number(process.env.DNSMGR_BODY_LIMIT || 2 * 1024 * 1024),
});

applySecurityHeaders(app);

// 审计旁路：挂全局钩子，必须早于所有业务路由注册
registerAuditHooks(app);
// 退出前尽量刷完审计队列，避免最后 1 秒内的操作丢失
app.addHook('onClose', async () => {
  await shutdownAudit();
});

// 账户配置无法解密时返回可操作的中文提示，避免被云端「Authentication error」掩盖
app.setErrorHandler((err: any, _req: any, reply: any) => {
  if (err instanceof ConfigDecryptError) {
    return reply.send({ code: -1, msg: err.message });
  }
  reply.send(err);
});

// 响应压缩：统计数据集、证书详情（含 base64 PFX）等大 JSON 明文传输体积降 60–80%
// 仅压缩 >= 1KB 的响应，避免小响应增加 CPU 开销
await app.register(compress, {
  global: true,
  threshold: 1024,
  // deflate 已被 br/gzip 完全覆盖，去掉可减少协商与压缩分支开销
  encodings: ['br', 'gzip'],
});

// 备份导入：单文件上限 200MB，流式落盘，避免大文件进内存
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });

// 在线恢复期间只放行读请求与备份接口，写请求统一 503
app.addHook('onRequest', async (req: any, reply: any) => {
  if (!isMaintenance()) return;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const url = String(req.raw?.url || '').split('?')[0];
  // 备份接口与登录必须可用，否则重启后无人能拿到令牌退出维护模式
  if (url.startsWith('/api/backup')) return;
  if (url === '/api/auth/login' || url === '/api/auth/totp') return;
  return reply.code(503).send({ code: -1, msg: '系统正在恢复数据，请稍后再试' });
});

// 保留原始请求体，供 QQ 机器人 Webhook 的 Ed25519 签名校验使用
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req: any, body: string, done: any) => {
  // 只有 QQ Webhook 需要原始报文做 Ed25519 验签，其余 JSON 请求不保留第二份 body
  const url = String(req.raw?.url || '').split('?')[0];
  if (url === '/api/qqbot/webhook') req.rawBody = body;
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    done(err as Error, undefined);
  }
});

// 同源部署下前端与后端同域，无需 CORS；如需跨域调用 API，用 DNSMGR_ALLOWED_ORIGINS 显式放行
const allowedOrigins = (process.env.DNSMGR_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (allowedOrigins.length) {
  await app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  });
}

// 登录/注册/安装等敏感接口限流，可经 DNSMGR_RATE_LIMIT=0 关闭
if (process.env.DNSMGR_RATE_LIMIT !== '0') {
  const setupLimiter = createRateLimit({ windowMs: 60_000, max: 15 });
  const limiters: Array<{ paths: Set<string>; fn: any }> = [
    { paths: new Set(['/api/auth/login', '/api/auth/totp']), fn: createRateLimit({ windowMs: 60_000, max: 20 }) },
    { paths: new Set(['/api/register']), fn: createRateLimit({ windowMs: 60_000, max: 10 }) },
    { paths: new Set(['/api/register/send-code']), fn: createRateLimit({ windowMs: 60_000, max: 5 }) },
    { paths: new Set(['/api/qqbot/webhook']), fn: createRateLimit({ windowMs: 60_000, max: 60 }) },
  ];
  app.addHook('onRequest', async (req: any, reply: any) => {
    const url = String(req.raw.url || '').split('?')[0];
    if (url.startsWith('/api/setup/')) return setupLimiter(req, reply);
    const hit = limiters.find((l) => l.paths.has(url));
    if (hit) return hit.fn(req, reply);
    return undefined;
  });
}

// JWT 密钥取自数据库 sys_key；未安装时使用进程内随机密钥（仅 setup 阶段使用）
let sysKey = randomBytes(24).toString('hex');
const bootState = await getInstallState();
if (bootState === 'not_installed') initSetupToken();
if (bootState !== 'not_installed') {
  // 已安装或状态未知（数据库不可用）：必须拿到持久化 sys_key，不能以降级随机密钥启动
  // （否则新写入的加密数据会使用临时密钥，重启后无法解密，造成不可恢复的数据损坏）
  let ok = false;
  for (let i = 0; i < 6 && !ok; i++) {
    try {
      sysKey = await getSysKey();
      ok = true;
    } catch (e: any) {
      console.error(`[dnsmgr-backend] 读取 sys_key 失败（第 ${i + 1} 次）：${e?.message || e}`);
      await new Promise((r) => setTimeout(r, Math.min(1000 * (i + 1), 5000)));
    }
  }
  if (!ok) {
    console.error('[dnsmgr-backend] 数据库不可用，无法读取 sys_key，退出进程等待编排层重启');
    process.exit(1);
  }
} else {
  try {
    sysKey = await getSysKey();
  } catch {
    // 首次部署且尚无配置：使用进程内随机密钥，仅用于安装阶段
  }
}
// 供账号凭据加解密使用（AES-256-GCM，密钥由 sys_key 派生）
setSecretKey(sysKey);
// 业务令牌默认 7 天过期；TOTP 预令牌单独指定 5 分钟。显式限定 HS256，避免算法混淆
await app.register(jwt, {
  secret: sysKey,
  sign: { algorithm: 'HS256', expiresIn: '7d' },
  verify: { algorithms: ['HS256'] },
});

// 每次请求校验账号状态与权限；用 10 秒短缓存避免高频查库
const authUserCache = new Map<number, { user: any; at: number }>();
const AUTH_USER_CACHE_MS = 10_000;

(app as any).decorate('authenticate', async function (req: any, reply: any) {
  try {
    await req.jwtVerify();
  } catch (e) {
    return reply.code(401).send({ code: -1, msg: '未登录或登录已过期' });
  }
  // 仅接受正式会话令牌，拒绝 TOTP 预令牌等一次性令牌冒充登录态
  if (req.user?.type && req.user.type !== 'session') {
    return reply.code(401).send({ code: -1, msg: '未登录或登录已过期' });
  }
  const uid = Number(req.user?.uid || 0);
  if (!uid) return reply.code(401).send({ code: -1, msg: '未登录或登录已过期' });
  // 校验账号仍然有效：封禁/删除即时生效，权限以数据库为准（短缓存降低查询压力）
  let entry = authUserCache.get(uid);
  if (!entry || Date.now() - entry.at > AUTH_USER_CACHE_MS) {
    const dbUser = await findUserById(uid);
    entry = { user: dbUser, at: Date.now() };
    authUserCache.set(uid, entry);
    // 大量账号登录时限制缓存规模，避免 Map 无界增长导致内存占用持续上升
    if (authUserCache.size > 5000) {
      const now = Date.now();
      for (const [k, v] of authUserCache) if (now - v.at > AUTH_USER_CACHE_MS) authUserCache.delete(k);
      while (authUserCache.size > 5000) {
        const oldest = authUserCache.keys().next().value;
        if (oldest === undefined) break;
        authUserCache.delete(oldest);
      }
    }
  }
  const dbUser = entry.user;
  if (!dbUser || Number(dbUser.status) === 0) {
    authUserCache.delete(uid);
    return reply.code(401).send({ code: -1, msg: '未登录或登录已过期' });
  }
  req.user.level = Number(dbUser.level);
  req.user.username = dbUser.username;
  req.user.totp_open = Number(dbUser.totp_open);
  req.user.stat_cache = Number(dbUser.stat_cache || 0);
  req.user.email = String(dbUser.email || '');
  req.user.is_super = Number(dbUser.is_super || 0);
  // 令牌版本校验：改密 / 变更 2FA 后自增，使旧令牌立即失效
  if (Number(req.user.token_version || 0) !== Number(dbUser.token_version || 0)) {
    authUserCache.delete(uid);
    return reply.code(401).send({ code: -1, msg: '登录状态已失效，请重新登录' });
  }
  return undefined;
});

app.get('/api/health', async () => ({ code: 0, data: 'ok' }));

// 安装向导路由始终注册
await app.register(setupRoutes);

// 检测安装状态：已安装才加载业务路由与迁移、调度器
const installed = await isInstalled();

if (installed) {
  try {
    await migrate();
  } catch (e: any) {
    console.error('[dnsmgr-backend] 迁移失败:', e?.message);
  }
  // 系统代理配置在启动时应用到全局 fetch；保存设置时还会再次刷新
  await refreshGlobalProxyDispatcher().catch((e: any) =>
    console.error('[dnsmgr-backend] 应用系统代理失败:', e?.message || e),
  );
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(domainRoutes);
  await app.register(dashboardRoutes);
  await app.register(cdnRoutes);
  await app.register(certRoutes);
  await app.register(dmonitorRoutes);
  await app.register(optimizeRoutes);
  await app.register(scheduleRoutes);
  await app.register(systemRoutes);
  await app.register(userRoutes);
  await app.register(cloudflareRoutes);
  await app.register(cfRulesRoutes);
  await app.register(expireRoutes);
  await app.register(registerRoutes);
  await app.register(preheatRoutes);
  await app.register(dnsCheckRoutes);
  await app.register(aboutRoutes);
  await app.register(qqbotRoutes);
  await app.register(auditRoutes);
  await app.register(backupRoutes);
  await app.register(vaultRoutes);
}

// 静态资源与 SPA 回退（容器内 serve 前端构建产物；本地未构建则不注册）
const webDir = resolveWebDir();
if (webDir) {
  await app.register(fastifyStatic, { root: webDir, prefix: '/' });
  const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'));
  const indexStat = fs.statSync(path.join(webDir, 'index.html'));
  const indexEtag = `"${createHash('sha256').update(indexHtml).digest('base64url')}"`;
  const indexLastModified = indexStat.mtime.toUTCString();
  const indexModifiedSec = Math.floor(indexStat.mtimeMs / 1000) * 1000;

  // SPA 回退由进程内 Buffer 返回，需自行提供 ETag/Last-Modified，
  // 否则浏览器每次导航都会重新下载整份 HTML，CDN 回源校验也无法得到 304。
  const indexNotModified = (req: any): boolean => {
    const inm = req.headers['if-none-match'];
    if (inm) {
      const raw = Array.isArray(inm) ? inm.join(',') : String(inm);
      return raw.split(',').some((part) => {
        const tag = part.trim();
        return tag === '*' || tag.replace(/^W\//, '') === indexEtag;
      });
    }
    const ims = req.headers['if-modified-since'];
    if (ims) {
      const t = Date.parse(String(ims));
      return Number.isFinite(t) && t >= indexModifiedSec;
    }
    return false;
  };

  app.setNotFoundHandler((req: any, reply: any) => {
    const u = String(req.raw.url || '').split('?')[0];
    const lower = u.toLowerCase();
    if (lower === '/api' || lower.startsWith('/api/')) {
      return reply.code(404).send({ code: -1, msg: '接口不存在', path: req.raw.url });
    }
    // SPA 回退只接受 GET/HEAD；其他方法对未知路径返回 404，避免把 HTML 当成功响应
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(404).type('text/plain').send('Not Found');
    }
    // 保留给静态资源的命名空间不能回退成 SPA HTML，否则 CDN 可能把 HTML 当作脚本/图片缓存
    if (lower === '/assets' || lower.startsWith('/assets/') || lower === '/static' || lower.startsWith('/static/') || lower === '/.well-known' || lower.startsWith('/.well-known/')) {
      return reply.code(404).type('text/plain').send('Not Found');
    }
    // 带扩展名的路径视为静态资源：未命中直接 404，避免把 SPA HTML 以 200 返回并被 CDN 长缓存
    if (/\.[a-z0-9]{2,5}$/i.test(u)) {
      return reply.code(404).type('text/plain').send('Not Found');
    }
    reply.header('ETag', indexEtag).header('Last-Modified', indexLastModified);
    if (indexNotModified(req)) return reply.code(304).send();
    return reply.type('text/html').send(indexHtml);
  });
}

let auditCleanDay = '';
async function cleanAuditLog(): Promise<void> {
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (auditCleanDay === day || now.getHours() < 3) return;
  const days = Math.max(7, Number(await configGet('audit_retain_days', '180')) || 180);
  for (let i = 0; i < 20; i++) {
    const res: any = await query(
      `DELETE FROM ${table('audit_log')} WHERE addtime < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT 5000`,
      [days],
    );
    if (!res?.affectedRows) break;
  }
  auditCleanDay = day;
}

const port = Number(process.env.PORT || 8082);
try {
  if (installed) await initMaintenance();
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[dnsmgr-backend] 已启动，端口 ${port}${installed ? '' : '（未安装，等待初始化）'}`);

  if (installed) {
    // 定时任务防重入：进程内标志避免上一轮未结束就叠加执行；
    // 叠加数据库命名锁，保证水平扩容（多副本）时同一任务只有一个实例执行
    const distributed = (name: string, fn: () => Promise<unknown>, label: string) => {
      let running = false;
      return () => {
        if (running) return;
        running = true;
        withDistributedLock('dnsmgr:' + name, fn)
          .catch((e: any) => console.error(label, e?.message || e))
          .finally(() => {
            running = false;
          });
      };
    };

    startMonitorScheduler();
    console.log('[dnsmgr-backend] 容灾监控调度器已启动');
    setInterval(distributed('optimize', runOptimizeAll, '[optimize] 优选IP调度异常:'), 60 * 1000);
    setInterval(distributed('schedule', runScheduleAll, '[schedule] 定时切换解析异常:'), 60 * 1000);
    console.log('[dnsmgr-backend] 优选IP调度器已启动');
    console.log('[dnsmgr-backend] 定时切换解析调度器已启动');
    setInterval(distributed('expire', expireNoticeTask, '[expire] 到期提醒调度异常:'), 60 * 60 * 1000);
    console.log('[dnsmgr-backend] 域名到期提醒调度器已启动');
    setInterval(distributed('preheat', executePreheatTasks, '[preheat] 自动预热调度异常:'), 60 * 1000);
    console.log('[dnsmgr-backend] CDN 自动预热调度器已启动');
    setInterval(distributed('dnscheck', executeCheckTasks, '[dnscheck] 自动检测调度异常:'), 60 * 1000);
    console.log('[dnsmgr-backend] DNS 劫持检测调度器已启动');
    setInterval(distributed('cert', certTaskRun, '[cert] SSL证书续签调度异常:'), 5 * 60 * 1000);
    console.log('[dnsmgr-backend] SSL证书续签调度器已启动');

    // CDN 数据统计缓存：按服务商数据粒度（近 30 天按天、近 48 小时按小时）定时拉取落库
    let statCacheLast = 0;
    setInterval(
      distributed('statcache', async () => {
        if (!(await isStatCacheEnabled())) return;
        const interval = await getStatCacheIntervalMs();
        if (Date.now() - statCacheLast < interval) return;
        statCacheLast = Date.now();
        const r = await refreshAllStatCache();
        if (r.errors.length) console.error('[cdn-stats-cache] 部分账户刷新失败:', r.errors.join('；'));
        else console.log(`[cdn-stats-cache] 已刷新 ${r.accounts} 个账户统计`);
      }, '[cdn-stats-cache] 刷新异常:'),
      60 * 1000,
    );
    console.log('[dnsmgr-backend] CDN 数据统计缓存调度器已启动');

    // 备份目录与临时文件清理（每小时）
    await ensureDataDirs().catch(() => undefined);
    setInterval(distributed('backuptmp', cleanTmpFiles, '[backup] 临时文件清理异常:'), 60 * 60 * 1000);

    // 备份计划任务：每分钟检查 next_run
    setInterval(distributed('backup', runDueBackupSchedules, '[backup] 计划备份执行异常:'), 60 * 1000);
    console.log('[dnsmgr-backend] 备份调度器已启动');

    // 审计日志保留策略：每天 03:20 后首次触发，分批删除超期数据
    setInterval(distributed('auditclean', cleanAuditLog, '[audit] 清理异常:'), 10 * 60 * 1000);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    void app.close().finally(() => process.exit(0));
  });
}
