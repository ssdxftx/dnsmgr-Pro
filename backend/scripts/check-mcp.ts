import assert from 'node:assert/strict';
import { McpServer } from '../src/mcp/server.js';

const server = new McpServer();
const admin: any = {
  app: {},
  req: {},
  user: { id: 1, uid: 1, level: 2 },
  uid: 1,
  level: 2,
  mode: 'legacy',
  scopes: ['*'],
  apiKeyId: 0,
  apiKeyName: '',
  ip: '127.0.0.1',
  jsonrpcId: null,
  requestHeaders: {},
};
const user: any = { ...admin, user: { id: 2, uid: 2, level: 1 }, uid: 2, level: 1 };
const actionCount = (tools: any[]) => tools.reduce((n, t) => n + (t.inputSchema.properties.action?.enum?.length || 1), 0);

const init = await server.handleBody({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, admin);
assert.equal(init.result.protocolVersion, '2025-03-26');
assert.equal(init.result.serverInfo.name, 'dnsmgr');
assert.equal(init.result.capabilities.tools.listChanged, false);

const adminList = await server.handleBody({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, admin);
assert.equal(adminList.result.tools.length, 28);
assert.equal(actionCount(adminList.result.tools), 124);

const userList = await server.handleBody({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, user);
assert.equal(userList.result.tools.length, 6);
assert.equal(actionCount(userList.result.tools), 27);
const userDomain = userList.result.tools.find((t: any) => t.name === 'domain_manage');
assert.deepEqual(userDomain.inputSchema.properties.action.enum, ['update_date', 'alias_add', 'alias_delete']);

const unknownMethod = await server.handleBody({ jsonrpc: '2.0', id: 4, method: 'nope' }, admin);
assert.equal(unknownMethod.error.code, -32601);
const unknownTool = await server.handleBody({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } }, admin);
assert.equal(unknownTool.error.code, -32602);
const badAction = await server.handleBody({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'record_query', arguments: { domain_id: 1, action: 'nope' } } }, admin);
assert.equal(badAction.result.isError, true);
const missingRequired = await server.handleBody({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'record_query', arguments: { action: 'list' } } }, admin);
assert.equal(missingRequired.result.structuredContent.msg, '缺少必填参数：domain_id');
const pingNotification = await server.handleBody({ jsonrpc: '2.0', method: 'ping' }, admin);
assert.equal(pingNotification, null);
const batch = await server.handleBody([{ jsonrpc: '2.0', id: 8, method: 'ping' }, { jsonrpc: '2.0', method: 'ping' }], admin);
assert.equal(batch.length, 1);
assert.equal(batch[0].id, 8);
const emptyBatch = await server.handleBody([], admin);
assert.equal(emptyBatch.error.code, -32600);
const parseError = await server.handleBody({}, admin, true);
assert.equal(parseError.error.code, -32700);

console.log(`MCP 自检通过：管理员 28 个工具 / 124 个动作，普通用户 6 个工具 / 27 个动作`);
