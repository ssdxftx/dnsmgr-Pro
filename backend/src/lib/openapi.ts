import type { FastifyInstance } from 'fastify';
import { moduleForPath } from './apiKeys.js';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/ready',
  '/api/openapi.json',
  '/api/docs',
  '/api/setup/status',
  '/api/setup/check',
  '/api/setup/install',
  '/api/auth/login',
  '/api/auth/totp',
  '/api/register/config',
  '/api/register',
  '/api/register/send-code',
  '/api/qqbot/webhook',
  '/api/announcements',
]);

interface RouteInfo {
  method: string;
  url: string;
}

export function registerOpenApi(app: FastifyInstance): void {
  const routes: RouteInfo[] = [];

  app.addHook('onRoute', (route: any) => {
    const urls = Array.isArray(route.url) ? route.url : [route.url];
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const url of urls) {
      if (typeof url !== 'string' || !url.startsWith('/api/')) continue;
      for (const method of methods) {
        const m = String(method || '').toUpperCase();
        if (!METHODS.has(m)) continue;
        if (url === '/api/docs' || url === '/api/openapi.json') continue;
        routes.push({ method: m, url });
      }
    }
  });

  app.get('/api/openapi.json', async () => buildSpec(routes));
  app.get('/api/docs', async (_req: any, reply: any) => {
    reply.type('text/html; charset=utf-8');
    return docsHtml(buildSpec(routes));
  });
}

function pathKey(url: string): string {
  return url.replace(/^\/api/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}') || '/';
}

function pathParams(url: string): any[] {
  return [...url.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

function buildSpec(routes: RouteInfo[]): any {
  const paths: Record<string, any> = {};
  const sorted = [...routes].sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  for (const route of sorted) {
    const key = pathKey(route.url);
    const method = route.method.toLowerCase();
    const tag = moduleForPath(route.method, route.url);
    const isPublic = PUBLIC_PATHS.has(route.url);
    const operation: any = {
      tags: [tag],
      operationId: `${method}_${key.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root'}`,
      summary: `${route.method} ${key}`,
      parameters: pathParams(route.url),
      responses: {
        '200': {
          description: '业务响应（code=0 成功，code=-1 失败）',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiResponse' },
            },
          },
        },
        '401': { description: '未认证' },
        '403': { description: '无权限或 API Key 作用域不足' },
        '429': { description: '请求过于频繁' },
      },
    };
    if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
      operation.requestBody = {
        required: false,
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: true },
          },
        },
      };
    }
    if (!isPublic) operation.security = [{ bearerAuth: [] }, { apiKeyAuth: [] }];
    if (route.url === '/api/auth/reauth') {
      operation.description = '用登录密码换取 5 分钟有效的重新认证令牌，通过 X-Reauth-Token 传给敏感接口。';
    }
    if (route.url === '/api/api-keys') {
      operation.description = 'API Key 明文只在创建或轮换时返回一次。';
    }
    paths[key] ||= {};
    paths[key][method] = operation;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: '彩虹 DNS Pro API',
      version: '1.0.0',
      description:
        '统一使用 /api/v1 前缀（/api 为兼容别名）。认证支持 Authorization: Bearer <session> 与 X-API-Key: <key>。' +
        '写请求可携带 Idempotency-Key 以避免网络重试造成重复创建。',
    },
    servers: [{ url: '/api/v1' }, { url: '/api' }],
    tags: [...new Set(routes.map((r) => moduleForPath(r.method, r.url)))].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        ApiResponse: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'integer', description: '0 表示成功，-1 表示业务失败' },
            msg: { type: 'string' },
            data: {},
            requestId: { type: 'string' },
          },
        },
      },
    },
  };
}

function esc(v: any): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function docsHtml(spec: any): string {
  const rows = Object.entries(spec.paths)
    .flatMap(([path, methods]: any) =>
      Object.entries(methods).map(([method, op]: any) => {
        const secured = op.security ? '需要认证' : '公开';
        return `<tr><td><code>${esc(method.toUpperCase())}</code></td><td><code>${esc(path)}</code></td><td>${esc(op.tags?.[0] || '')}</td><td>${secured}</td></tr>`;
      }),
    )
    .join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>彩虹 DNS Pro API</title>
<style>
body{font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:28px;background:#0b1210;color:#d9e7e2}
h1{font-size:22px;margin:0 0 6px} p{color:#91a79f;margin:0 0 18px}
a{color:#2ee6b6} table{border-collapse:collapse;width:100%;margin-top:16px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #22322c;vertical-align:top}
th{color:#91a79f;font-weight:600} code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#b8f5e2}
.wrap{max-width:1100px;margin:0 auto}.hint{background:#10201a;border:1px solid #1d3a30;border-radius:10px;padding:12px 14px;margin:16px 0}
</style></head><body><div class="wrap">
<h1>彩虹 DNS Pro API</h1>
<p>OpenAPI 3.1 规范：<a href="/api/openapi.json">/api/openapi.json</a>。推荐使用 <code>/api/v1</code> 前缀。</p>
<div class="hint">认证：<code>Authorization: Bearer &lt;session&gt;</code> 或 <code>X-API-Key: &lt;key&gt;</code>。写请求支持 <code>Idempotency-Key</code>。敏感操作使用 <code>X-Reauth-Token</code>。</div>
<table><thead><tr><th>方法</th><th>路径</th><th>模块</th><th>认证</th></tr></thead><tbody>${rows}</tbody></table>
</div></body></html>`;
}
