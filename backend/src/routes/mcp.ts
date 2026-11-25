import type { FastifyInstance } from 'fastify';
import { authenticateMcp, McpAuthError } from '../mcp/auth.js';
import { McpServer } from '../mcp/server.js';
import type { McpContext } from '../mcp/types.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { enqueueAudit, nowStr } from '../lib/audit/store.js';
import { maskBody } from '../lib/audit/mask.js';

function rpcError(code: number, message: string, httpCode = 200): { status: number; body: any } {
  return { status: httpCode, body: { jsonrpc: '2.0', id: null, error: { code, message } } };
}

function originAllowed(req: any): boolean {
  const raw = String(req.headers?.origin || '').trim();
  if (!raw) return true;
  try {
    const originHost = new URL(raw).hostname.toLowerCase();
    const host = String(req.hostname || req.headers?.host || '').split(':')[0].toLowerCase();
    return !!host && originHost === host;
  } catch {
    return false;
  }
}

function toolCalls(body: any): Array<{ name: string; action: string; args: any }> {
  const list = Array.isArray(body) ? body : [body];
  const out: Array<{ name: string; action: string; args: any }> = [];
  for (const msg of list) {
    if (!msg || msg.method !== 'tools/call' || !msg.params || typeof msg.params !== 'object') continue;
    const name = typeof msg.params.name === 'string' ? msg.params.name : '';
    if (!name) continue;
    const args = msg.params.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {};
    out.push({ name, action: String(args.action || ''), args });
  }
  return out;
}

function auditCalls(req: any, ctx: McpContext, body: any): void {
  const calls = toolCalls(body);
  if (!calls.length) return;
  for (const call of calls) {
    let detail = '';
    try {
      detail = JSON.stringify({ tool: call.name, action: call.action, arguments: maskBody(call.args) }).slice(0, 8000);
    } catch {
      detail = JSON.stringify({ tool: call.name, action: call.action });
    }
    enqueueAudit({
      uid: ctx.uid,
      username: String(ctx.user?.username || ''),
      auth_type: ctx.mode === 'legacy' ? 'mcp_legacy' : 'mcp_api_key',
      api_key_id: ctx.apiKeyId,
      api_key_name: ctx.apiKeyName,
      module: 'mcp',
      action: call.action ? `${call.name}.${call.action}` : call.name,
      method: 'POST',
      path: '/mcp',
      route: '/mcp',
      target_type: 'mcp_tool',
      target_id: '',
      target_name: call.name,
      summary: `MCP 调用 ${call.name}${call.action ? `(${call.action})` : ''}`,
      detail,
      changes: null,
      result: 1,
      errmsg: '',
      status: 200,
      ip: ctx.ip.slice(0, 64),
      ua: String(req.headers?.['user-agent'] || '').slice(0, 255),
      cost_ms: 0,
      addtime: nowStr(),
    });
  }
}

export default async function mcpRoutes(app: FastifyInstance): Promise<void> {
  const server = new McpServer();

  app.all('/mcp', async (req: any, reply: any) => {
    if (!originAllowed(req)) {
      const err = rpcError(-32000, 'Origin not allowed', 403);
      return reply.code(err.status).send(err.body);
    }
    if (req.method !== 'POST') {
      reply.header('Allow', 'POST');
      const err = rpcError(-32000, 'Method not allowed', 405);
      return reply.code(err.status).send(err.body);
    }

    let ctx: McpContext;
    try {
      ctx = await authenticateMcp(req);
    } catch (e: any) {
      const message = e instanceof McpAuthError ? e.message : '认证失败';
      const err = rpcError(-32001, message, 401);
      reply.header('WWW-Authenticate', 'Bearer realm="dnsmgr-mcp"');
      return reply.code(err.status).send(err.body);
    }

    if (!hitRateLimit(`mcp:${ctx.uid}:${ctx.apiKeyId || ctx.ip}`, Math.max(10, Number(process.env.DNSMGR_MCP_RATE_LIMIT || 120)), 60_000)) {
      reply.header('Retry-After', '60');
      const err = rpcError(-32000, '请求过于频繁，请稍后再试', 429);
      return reply.code(err.status).send(err.body);
    }

    const parseError = req.mcpParseError === true;
    const body = req.body === undefined ? {} : req.body;
    let result: any;
    try {
      result = await server.handleBody(body, ctx, parseError);
    } catch (e: any) {
      console.error('[mcp] 请求处理异常:', e?.message || e);
      const err = rpcError(-32603, 'Internal error', 200);
      return reply.code(err.status).send(err.body);
    }

    auditCalls(req, ctx, body);
    req.audit = { skip: true };

    if (result === null) return reply.code(202).send();
    const max = Math.max(64 * 1024, Number(process.env.DNSMGR_MCP_RESPONSE_LIMIT || 8 * 1024 * 1024));
    let text: string;
    try {
      text = JSON.stringify(result);
    } catch {
      return reply.code(200).send(rpcError(-32603, 'Internal error').body);
    }
    if (Buffer.byteLength(text) > max) {
      return reply.code(200).send(rpcError(-32603, 'Response too large').body);
    }
    reply.header('Content-Type', 'application/json; charset=utf-8');
    return reply.code(200).send(text);
  });
}
