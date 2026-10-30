import type { FastifyInstance } from 'fastify';
import { resolveRoute } from './catalog.js';
import { maskBody } from './mask.js';
import { enqueueAudit, nowStr } from './store.js';
import type { AuditRow } from './types.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP_PREFIXES = ['/api/setup', '/api/health', '/api/qqbot/webhook'];
const ANON_WRITE_ROUTES = ['/api/auth/login', '/api/auth/totp', '/api/register'];

function shouldSkip(req: any, route: string): boolean {
  if (!WRITE_METHODS.has(req.method)) return true;
  if (!route) return true; // 404，无匹配路由
  const path = String(req.raw?.url || '').split('?')[0];
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (route.startsWith('/api/setup')) return true;
  if ((req as any).audit?.skip) return true;
  // 匿名且非登录接口：多半是扫描器/过期令牌，不记录
  const uid = Number(req.user?.uid || 0);
  if (!uid && !ANON_WRITE_ROUTES.includes(route)) return true;
  return false;
}

export function registerAuditHooks(app: FastifyInstance): void {
  // 先拿业务码（不受压缩/序列化影响）
  app.addHook('preSerialization', async (req: any, reply: any, payload: any) => {
    if (!WRITE_METHODS.has(req.method)) return payload;
    if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
      if (typeof (payload as any).code === 'number') (reply as any).__auditCode = (payload as any).code;
      if (typeof (payload as any).msg === 'string') (reply as any).__auditMsg = (payload as any).msg;
      else if (typeof (payload as any).message === 'string') (reply as any).__auditMsg = (payload as any).message;
    }
    return payload;
  });

  app.addHook('onError', async (req: any, reply: any, err: any) => {
    if (!WRITE_METHODS.has(req.method)) return;
    if (err && typeof err.message === 'string') (reply as any).__auditMsg = err.message;
  });

  app.addHook('onResponse', (req: any, reply: any, done: any) => {
    try {
      collect(req, reply);
    } catch {
      /* 审计自身异常绝不外抛 */
    }
    done();
  });
}

function collect(req: any, reply: any): void {
  const route = String(req.routeOptions?.url || req.routerPath || '');
  if (shouldSkip(req, route)) return;

  const meta = resolveRoute(req.method, route);
  const ctx = req.audit || {};
  const status = Number(reply.raw?.statusCode || reply.statusCode || 200);
  const code = (reply as any).__auditCode;
  const ok = typeof code === 'number' ? code === 0 : status < 400;
  const msg = String((reply as any).__auditMsg || '');

  const uid = Number(ctx.uid ?? req.user?.uid ?? 0);
  const username = String(ctx.username || req.user?.username || req.body?.username || '');
  const errmsg = ok ? '' : msg.slice(0, 500);

  const row: AuditRow = {
    uid,
    username: username.slice(0, 64),
    auth_type: String(req.user?.auth_type || 'session').slice(0, 16),
    api_key_id: Number(req.user?.api_key_id || 0),
    api_key_name: String(req.user?.api_key_name || '').slice(0, 64),
    module: String(ctx.module || meta.module).slice(0, 32),
    action: String(ctx.action || meta.action).slice(0, 48),
    method: req.method,
    path: String(req.raw?.url || '').split('?')[0].slice(0, 255),
    route: route.slice(0, 255),
    target_type: String(ctx.targetType || meta.targetType || '').slice(0, 32),
    target_id: ctx.targetId != null ? String(ctx.targetId).slice(0, 64) : '',
    target_name: String(ctx.targetName || '').slice(0, 255),
    summary: String(ctx.summary || defaultSummary(ctx.module || meta.module, ctx.action || meta.action)).slice(0, 500),
    detail: buildDetail(req, ctx.detail, ctx.scrubBody === true),
    changes: ctx.changes?.length ? JSON.stringify(ctx.changes) : null,
    result: ok ? 1 : 0,
    errmsg,
    status,
    ip: String(req.ip || '').slice(0, 64),
    ua: String(req.headers?.['user-agent'] || '').slice(0, 255),
    cost_ms: Math.round(Number(reply.getResponseTime?.() || 0)),
    addtime: nowStr(),
  };
  enqueueAudit(row);
}

function buildDetail(req: any, extra?: Record<string, any>, scrubBody = false): string | null {
  const detail = {
    params: req.params && Object.keys(req.params).length ? maskBody(req.params) : undefined,
    query: req.query && Object.keys(req.query).length ? maskBody(req.query) : undefined,
    body: scrubBody ? { _scrubbed: 'sensitive' } : maskBody(req.body),
    ...(extra ? { extra: maskBody(extra) } : {}),
  };
  const size = Buffer.byteLength(JSON.stringify(detail));
  return size > 8000 ? JSON.stringify({ _tooLarge: size }) : JSON.stringify(detail);
}

const MODULE_LABEL: Record<string, string> = {
  auth: '认证',
  domain: '域名',
  record: '解析记录',
  account: '账户',
  cdn: 'CDN',
  cert: '证书',
  user: '用户',
  system: '系统',
  cloudflare: 'Cloudflare',
  schedule: '定时任务',
  monitor: '监控',
  dnscheck: 'DNS 检测',
  optimize: '优选 IP',
  preheat: '预热',
  expire: '到期提醒',
  backup: '备份',
  vault: '凭证保险库',
  apikeys: 'API 密钥',
  jobs: '异步任务',
  events: '事件回调',
};

function defaultSummary(module: string, action: string): string {
  return `${MODULE_LABEL[module] || module}操作（${action}）`;
}
