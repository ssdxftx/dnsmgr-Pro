import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getSysKey } from './config.js';
import { isInstalled } from './installer.js';
import { findUserById } from './auth.js';
import { setSecretKey } from './lib/secret.js';
import { migrate } from './migrate.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import domainRoutes from './routes/domain.js';
import cdnRoutes from './routes/cdn.js';
import certRoutes from './routes/cert.js';
import dmonitorRoutes from './routes/dmonitor.js';
import optimizeRoutes from './routes/optimizeip.js';
import scheduleRoutes from './routes/schedule.js';
import systemRoutes from './routes/system.js';
import userRoutes from './routes/user.js';
import cloudflareRoutes from './routes/cloudflare.js';
import expireRoutes from './routes/expire.js';
import registerRoutes from './routes/register.js';
import setupRoutes from './routes/setup.js';
import aboutRoutes from './routes/about.js';
import preheatRoutes from './routes/preheat.js';
import dnsCheckRoutes from './routes/dnscheck.js';
import { startMonitorScheduler } from './lib/monitor/scheduler.js';
import { executeAll as runOptimizeAll } from './lib/optimize/optimizeService.js';
import { executeAll as runScheduleAll } from './lib/schedule/scheduleService.js';
import { expireNoticeTask } from './lib/expire/expireNoticeService.js';
import { executePreheatTasks } from './lib/cdn/preheatService.js';
import { executeCheckTasks } from './lib/dns/checkService.js';
import { certTaskRun } from './lib/cert/certTaskService.js';
import { applySecurityHeaders, createRateLimit } from './security.js';

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
  if (['1', 'true', 'yes', 'on'].includes(low)) return true;
  if (['0', 'false', 'no', 'off'].includes(low)) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

const app = Fastify({
  logger: false,
  trustProxy: resolveTrustProxy(),
  bodyLimit: Number(process.env.DNSMGR_BODY_LIMIT || 2 * 1024 * 1024),
});

applySecurityHeaders(app);

// 同源部署下前端与后端同域，无需 CORS；如需跨域调用 API，用 DNSMGR_ALLOWED_ORIGINS 显式放行
const allowedOrigins = (process.env.DNSMGR_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (allowedOrigins.length) {
  await app.register(cors, { origin: allowedOrigins });
}

// 登录/注册/安装等敏感接口限流，可经 DNSMGR_RATE_LIMIT=0 关闭
if (process.env.DNSMGR_RATE_LIMIT !== '0') {
  const setupLimiter = createRateLimit({ windowMs: 60_000, max: 15 });
  const limiters: Array<{ paths: Set<string>; fn: any }> = [
    { paths: new Set(['/api/auth/login', '/api/auth/totp']), fn: createRateLimit({ windowMs: 60_000, max: 20 }) },
    { paths: new Set(['/api/register']), fn: createRateLimit({ windowMs: 60_000, max: 10 }) },
    { paths: new Set(['/api/register/send-code']), fn: createRateLimit({ windowMs: 60_000, max: 5 }) },
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
try {
  sysKey = await getSysKey();
} catch {
  // 未安装，忽略
}
// 供账号凭据加解密使用（AES-256-GCM，密钥由 sys_key 派生）
setSecretKey(sysKey);
// 业务令牌默认 7 天过期；TOTP 预令牌单独指定 5 分钟
await app.register(jwt, { secret: sysKey, sign: { expiresIn: '7d' } });

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
  }
  const dbUser = entry.user;
  if (!dbUser || Number(dbUser.status) === 0) {
    authUserCache.delete(uid);
    return reply.code(401).send({ code: -1, msg: '未登录或登录已过期' });
  }
  req.user.level = Number(dbUser.level);
  req.user.username = dbUser.username;
  req.user.totp_open = Number(dbUser.totp_open);
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
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(domainRoutes);
  await app.register(cdnRoutes);
  await app.register(certRoutes);
  await app.register(dmonitorRoutes);
  await app.register(optimizeRoutes);
  await app.register(scheduleRoutes);
  await app.register(systemRoutes);
  await app.register(userRoutes);
  await app.register(cloudflareRoutes);
  await app.register(expireRoutes);
  await app.register(registerRoutes);
  await app.register(preheatRoutes);
  await app.register(dnsCheckRoutes);
  await app.register(aboutRoutes);
}

// 静态资源与 SPA 回退（容器内 serve 前端构建产物；本地未构建则不注册）
const webDir = resolveWebDir();
if (webDir) {
  await app.register(fastifyStatic, { root: webDir, prefix: '/' });
  const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'));
  app.setNotFoundHandler((req: any, reply: any) => {
    if (req.raw.url && req.raw.url.startsWith('/api/')) {
      return reply.code(404).send({ code: -1, msg: '接口不存在', path: req.raw.url });
    }
    return reply.type('text/html').send(indexHtml);
  });
}

const port = Number(process.env.PORT || 8082);
try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[dnsmgr-backend] 已启动，端口 ${port}${installed ? '' : '（未安装，等待初始化）'}`);

  if (installed) {
    startMonitorScheduler();
    console.log('[dnsmgr-backend] 容灾监控调度器已启动');
    setInterval(() => {
      runOptimizeAll().catch((e: any) => console.error('[optimize] 优选IP调度异常:', e.message));
      runScheduleAll().catch((e: any) => console.error('[schedule] 定时切换解析异常:', e.message));
    }, 60 * 1000);
    console.log('[dnsmgr-backend] 优选IP调度器已启动');
    console.log('[dnsmgr-backend] 定时切换解析调度器已启动');
    setInterval(() => {
      expireNoticeTask().catch((e: any) => console.error('[expire] 到期提醒调度异常:', e.message));
    }, 60 * 60 * 1000);
    console.log('[dnsmgr-backend] 域名到期提醒调度器已启动');
    setInterval(() => {
      executePreheatTasks().catch((e: any) => console.error('[preheat] 自动预热调度异常:', e.message));
    }, 60 * 1000);
    console.log('[dnsmgr-backend] CDN 自动预热调度器已启动');
    setInterval(() => {
      executeCheckTasks().catch((e: any) => console.error('[dnscheck] 自动检测调度异常:', e.message));
    }, 60 * 1000);
    console.log('[dnsmgr-backend] DNS 劫持检测调度器已启动');
    setInterval(() => {
      certTaskRun().catch((e: any) => console.error('[cert] SSL证书续签调度异常:', e.message));
    }, 5 * 60 * 1000);
    console.log('[dnsmgr-backend] SSL证书续签调度器已启动');
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}