import type { FastifyInstance } from 'fastify';
import { checkLevel, findUserById } from '../auth.js';
import { query, queryOne, table } from '../db.js';
import { isMaintenance } from '../lib/backup/maintenance.js';
import { getInstallState } from '../installer.js';
import { isTokenRevoked } from '../lib/auth/revocation.js';
import { clampLimit, clampOffset } from '../lib/util.js';

function line(name: string, value: number, labels?: Record<string, string>): string {
  if (!labels || !Object.keys(labels).length) return `${name} ${value}`;
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
  return `${name}{${parts.join(',')}} ${value}`;
}

export default async function observabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/ready', async (req: any, reply: any) => {
    let db = false;
    try {
      await query('SELECT 1');
      db = true;
    } catch {
      db = false;
    }
    let installState = 'unknown';
    try {
      installState = await getInstallState();
    } catch {
      installState = 'unknown';
    }
    const maintenance = isMaintenance();
    // 未安装时数据库尚未初始化，安装向导本身需要保持可访问；已安装后必须确认数据库可用。
    const ok = !maintenance && (installState === 'not_installed' || db);
    // 匿名探针只回 ready：DB 连通性、安装状态、维护模式、运行时长属于内部信息，
    // 只对已登录管理员展示，避免未认证请求把部署细节当侦察面。
    let isAdmin = false;
    if (req.headers?.authorization) {
      try {
        await req.jwtVerify();
        // 仅 jwtVerify 不够：TOTP 预令牌、已登出令牌同样能通过签名校验。
        // 必须限定 type=session、校验 jti 吊销，并回查账号状态与 token_version。
        if (req.user?.type !== 'session') throw new Error('not session');
        const jti = String(req.user?.jti || '');
        if (!jti || (await isTokenRevoked(jti))) throw new Error('revoked');
        const dbUser: any = await findUserById(Number(req.user?.uid || 0));
        if (
          dbUser &&
          Number(dbUser.status) !== 0 &&
          Number(req.user?.token_version || 0) === Number(dbUser.token_version || 0)
        ) {
          isAdmin = checkLevel(dbUser, 2);
        }
      } catch {
        // 令牌无效按匿名处理，仍然返回探针结果
      }
    }
    const data: any = { ready: ok };
    if (isAdmin) {
      data.db = db;
      data.installState = installState;
      data.maintenance = maintenance;
      data.uptime = Math.floor(process.uptime());
    }
    return reply.code(ok ? 200 : 503).send({
      code: ok ? 0 : -1,
      data,
    });
  });

  app.get('/api/notifications/logs', {
    preHandler: async (req: any, reply: any) => {
      await (app as any).authenticate(req, reply);
      if (!req.user) return;
      if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
    },
  }, async (req: any) => {
    const limit = clampLimit(req.query?.limit, 20, 200);
    const offset = clampOffset(req.query?.offset);
    const module = String(req.query?.module || '').trim();
    const event = String(req.query?.event || '').trim();
    const where: string[] = [];
    const params: any[] = [];
    if (module) {
      where.push('module = ?');
      params.push(module);
    }
    if (event) {
      where.push('event = ?');
      params.push(event);
    }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const total = Number((await queryOne(`SELECT COUNT(*) AS c FROM ${table('notification_log')}${whereSql}`, params))?.c || 0);
    const rows = await query(
      `SELECT * FROM ${table('notification_log')}${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return {
      code: 0,
      data: {
        total,
        list: rows.map((r: any) => {
          let detail: any = null;
          try {
            detail = r.detail ? JSON.parse(String(r.detail)) : null;
          } catch {
            detail = null;
          }
          return { ...r, detail };
        }),
      },
    };
  });

  app.get('/api/metrics', {
    preHandler: async (req: any, reply: any) => {
      await (app as any).authenticate(req, reply);
      if (!req.user) return;
      if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
    },
  }, async (_req: any, reply: any) => {
    const mem = process.memoryUsage();
    const [domains, certOrders, activeKeys] = await Promise.all([
      queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('domain')}`).catch(() => ({ c: 0 })),
      queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('cert_order')}`).catch(() => ({ c: 0 })),
      queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('api_key')} WHERE active = 1 AND revoked_at IS NULL`).catch(() => ({ c: 0 })),
    ]);
    const jobs: any[] = await query(`SELECT status, COUNT(*) AS c FROM ${table('async_job')} GROUP BY status`).catch(() => []);
    const out = [
      '# HELP dnsmgr_up Process liveness.',
      '# TYPE dnsmgr_up gauge',
      line('dnsmgr_up', 1),
      '# HELP dnsmgr_uptime_seconds Process uptime.',
      '# TYPE dnsmgr_uptime_seconds gauge',
      line('dnsmgr_uptime_seconds', Math.floor(process.uptime())),
      '# HELP dnsmgr_memory_bytes Process memory.',
      '# TYPE dnsmgr_memory_bytes gauge',
      line('dnsmgr_memory_bytes', mem.rss, { type: 'rss' }),
      line('dnsmgr_memory_bytes', mem.heapUsed, { type: 'heap_used' }),
      line('dnsmgr_memory_bytes', mem.heapTotal, { type: 'heap_total' }),
      '# HELP dnsmgr_maintenance Maintenance mode.',
      '# TYPE dnsmgr_maintenance gauge',
      line('dnsmgr_maintenance', isMaintenance() ? 1 : 0),
      '# HELP dnsmgr_domains_total Managed domains.',
      '# TYPE dnsmgr_domains_total gauge',
      line('dnsmgr_domains_total', Number(domains?.c || 0)),
      '# HELP dnsmgr_cert_orders_total Certificate orders.',
      '# TYPE dnsmgr_cert_orders_total gauge',
      line('dnsmgr_cert_orders_total', Number(certOrders?.c || 0)),
      '# HELP dnsmgr_api_keys_active Active API keys.',
      '# TYPE dnsmgr_api_keys_active gauge',
      line('dnsmgr_api_keys_active', Number(activeKeys?.c || 0)),
      '# HELP dnsmgr_async_jobs Async jobs by status.',
      '# TYPE dnsmgr_async_jobs gauge',
      ...jobs.map((j) => line('dnsmgr_async_jobs', Number(j.c || 0), { status: String(j.status || 'unknown') })),
    ];
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    return out.join('\n') + '\n';
  });
}
