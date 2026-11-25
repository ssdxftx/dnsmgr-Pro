import { APP_VERSION } from '../lib/version.js';
import { ToolRegistry } from './registry.js';
import type { McpContext, ToolArgs } from './types.js';
import domainTools from './tools/domain.js';
import recordTools from './tools/record.js';
import certTools from './tools/cert.js';
import cloudflareTools from './tools/cloudflare.js';
import taskTools from './tools/task.js';

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  '聚合DNS管理系统MCP接口。通常先调用 domain_query(action=list) 获取域名ID，再用 record_query / record_manage 管理解析记录。添加账户或部署任务前可调用 list_provider_types 查看各服务商需要的配置字段。';

function error(id: any, code: number, message: string): any {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export class McpServer {
  private registry: ToolRegistry;

  constructor() {
    this.registry = new ToolRegistry([
      ...domainTools,
      ...recordTools,
      ...certTools,
      ...cloudflareTools,
      ...taskTools,
    ]);
  }

  async handleBody(body: any, ctx: McpContext | null, parseError = false): Promise<any> {
    if (parseError) return error(null, -32700, 'Parse error');
    let payload: any = body;
    if (typeof body === 'string') {
      try {
        payload = JSON.parse(body);
      } catch {
        return error(null, -32700, 'Parse error');
      }
    }
    if (payload === null || typeof payload !== 'object') return error(null, -32600, 'Invalid Request');
    if (Array.isArray(payload)) {
      if (!payload.length) return error(null, -32600, 'Invalid Request');
      const responses: any[] = [];
      for (const message of payload) {
        const res = await this.handleMessage(message, ctx);
        if (res !== null) responses.push(res);
      }
      return responses.length ? responses : null;
    }
    return this.handleMessage(payload, ctx);
  }

  private initialize(params: ToolArgs): any {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
    const version = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
    return {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'dnsmgr', title: '聚合DNS管理系统', version: APP_VERSION },
      instructions: INSTRUCTIONS,
    };
  }

  private async handleMessage(message: any, ctx: McpContext | null): Promise<any> {
    if (
      !message ||
      typeof message !== 'object' ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string'
    ) {
      if (message && typeof message === 'object' && !message.method && (message.result !== undefined || message.error !== undefined)) {
        return null;
      }
      return error(message?.id ?? null, -32600, 'Invalid Request');
    }

    const isNotification = !Object.prototype.hasOwnProperty.call(message, 'id');
    const id = message.id ?? null;
    const params: ToolArgs = message.params && typeof message.params === 'object' && !Array.isArray(message.params) ? message.params : {};
    if (!ctx) return isNotification ? null : error(id, -32001, '未认证');

    try {
      switch (message.method) {
        case 'initialize':
          return isNotification ? null : { jsonrpc: '2.0', id, result: this.initialize(params) };
        case 'ping':
          return isNotification ? null : { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
          return isNotification ? null : { jsonrpc: '2.0', id, result: { tools: this.registry.listTools(ctx) } };
        case 'tools/call': {
          const name = params.name;
          if (typeof name !== 'string' || !name) {
            return isNotification ? null : error(id, -32602, 'Invalid params: name is required');
          }
          const args = params.arguments ?? {};
          if (args === null || typeof args !== 'object' || Array.isArray(args)) {
            return isNotification ? null : error(id, -32602, 'Invalid params: arguments must be an object');
          }
          if (!this.registry.has(name)) {
            return isNotification ? null : error(id, -32602, `Unknown tool: ${name}`);
          }
          const result = await this.registry.call(ctx, name, args as ToolArgs);
          return isNotification ? null : { jsonrpc: '2.0', id, result };
        }
        default:
          return isNotification ? null : error(id, -32601, `Method not found: ${message.method}`);
      }
    } catch (e: any) {
      console.error('[mcp] JSON-RPC 处理异常:', e?.message || e);
      return isNotification ? null : error(id, -32603, 'Internal error');
    }
  }
}
