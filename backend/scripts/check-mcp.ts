import assert from 'node:assert/strict';
import { McpServer } from '../src/mcp/server.js';
import { checkActionScope } from '../src/mcp/invoker.js';
import operationsTools from '../src/mcp/tools/operations.js';
import operationsManageTools from '../src/mcp/tools/operationsManage.js';
import cdnTools from '../src/mcp/tools/cdn.js';
import cdnManageTools from '../src/mcp/tools/cdnManage.js';
import cdnAdvancedTools from '../src/mcp/tools/cdnAdvanced.js';
import recordTools from '../src/mcp/tools/record.js';
import domainTools from '../src/mcp/tools/domain.js';
import certTools from '../src/mcp/tools/cert.js';
import cloudflareTools from '../src/mcp/tools/cloudflare.js';
import taskTools from '../src/mcp/tools/task.js';

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
const allToolDefs = [
  ...domainTools,
  ...recordTools,
  ...certTools,
  ...cloudflareTools,
  ...taskTools,
  ...cdnTools,
  ...cdnManageTools,
  ...cdnAdvancedTools,
  ...operationsTools,
  ...operationsManageTools,
];
const definitionCount = () => allToolDefs.reduce((n, t) => n + Object.keys(t.actions).length, 0);
const proToolNames = [
  'cdn_account_query', 'cdn_domain_query', 'cdn_zone_query', 'cdn_cache_query', 'cdn_statistics_query',
  'dnscheck_query', 'expire_query', 'audit_query', 'job_query', 'backup_query', 'system_query',
  'announcement_query', 'user_query', 'event_query', 'cf_rules_query', 'cert_settings_query', 'vault_query',
  'cdn_account_manage', 'cdn_domain_manage', 'cdn_zone_manage', 'cdn_cache_manage',
  'dnscheck_manage', 'expire_manage', 'backup_manage', 'system_manage', 'announcement_manage',
  'user_manage', 'event_manage', 'cf_rules_manage', 'cert_settings_manage',
  'cdn_rule_query', 'cdn_rule_manage', 'cdn_security_query', 'cdn_security_manage',
  'cdn_edge_query', 'cdn_edge_manage', 'cdn_traffic_query', 'cdn_traffic_manage',
  'cdn_billing_query', 'cdn_billing_manage', 'cdn_esa_api',
];

const init = await server.handleBody({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, admin);
assert.equal(init.result.protocolVersion, '2025-03-26');
assert.equal(init.result.serverInfo.name, 'dnsmgr');
assert.equal(init.result.capabilities.tools.listChanged, false);

const adminList = await server.handleBody({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, admin);
assert.equal(adminList.result.tools.length, 69);
assert.equal(definitionCount(), 452);
assert.equal(actionCount(adminList.result.tools), 452);
for (const tool of allToolDefs) {
  assert.ok(!Object.prototype.hasOwnProperty.call(tool.properties || {}, 'action'), `${tool.name} 不能使用保留字段 action`);
  for (const [name, action] of Object.entries(tool.actions)) {
    assert.ok(action.scope, `${tool.name}.${name} 缺少 scope`);
  }
}
for (const name of proToolNames) assert.ok(adminList.result.tools.some((t: any) => t.name === name), `缺少工具：${name}`);

const userList = await server.handleBody({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, user);
assert.equal(userList.result.tools.length, 27);
assert.equal(actionCount(userList.result.tools), 149);
const userDomain = userList.result.tools.find((t: any) => t.name === 'domain_manage');
assert.deepEqual(userDomain.inputSchema.properties.action.enum, ['update_date', 'alias_add', 'alias_delete']);
for (const name of ['user_manage', 'backup_manage', 'system_manage', 'cdn_cache_manage', 'event_manage']) {
  assert.ok(!userList.result.tools.some((t: any) => t.name === name), `普通用户不应看到工具：${name}`);
}
const userCdnDomain = userList.result.tools.find((t: any) => t.name === 'cdn_domain_manage');
assert.ok(userCdnDomain);
assert.ok(userCdnDomain.inputSchema.properties.action.enum.includes('origin'));
assert.ok(!userCdnDomain.inputSchema.properties.action.enum.includes('certlink'));
for (const name of ['cdn_rule_manage', 'cdn_security_manage', 'cdn_edge_manage', 'cdn_traffic_manage', 'cdn_billing_manage', 'cdn_esa_api']) {
  assert.ok(!userList.result.tools.some((t: any) => t.name === name), `普通用户不应看到工具：${name}`);
}
for (const name of ['cdn_rule_query', 'cdn_security_query', 'cdn_edge_query', 'cdn_traffic_query', 'cdn_billing_query']) {
  assert.ok(userList.result.tools.some((t: any) => t.name === name), `普通用户应看到工具：${name}`);
}
const userRuleQuery = userList.result.tools.find((t: any) => t.name === 'cdn_rule_query');
assert.deepEqual(userRuleQuery.inputSchema.properties.action.enum, ['setting', 'list', 'configs']);
const userSecurityQuery = userList.result.tools.find((t: any) => t.name === 'cdn_security_query');
assert.ok(userSecurityQuery.inputSchema.properties.action.enum.includes('ip_groups'));
assert.ok(!userSecurityQuery.inputSchema.properties.action.enum.includes('waf'));

const dnscheckTool = operationsTools.find((t) => t.name === 'dnscheck_query');
assert.ok(dnscheckTool);
const apiCtx: any = { ...admin, mode: 'api_key', scopes: ['dnscheck:read'] };
assert.doesNotThrow(() => checkActionScope(apiCtx, dnscheckTool!.actions.tasks));
assert.throws(() => checkActionScope(apiCtx, { desc: 'no scope' } as any), /作用域/);
const cfQuery = cloudflareTools.find((t) => t.name === 'cf_hostname_query');
assert.ok(cfQuery);
assert.equal(cfQuery!.actions.txt_targets.scope?.write, true);
const cdnEdgeQuery = cdnAdvancedTools.find((t) => t.name === 'cdn_edge_query');
assert.ok(cdnEdgeQuery);
assert.equal(cdnEdgeQuery!.actions.kv_get.scope?.write, true);
const cdnBillingQuery = cdnAdvancedTools.find((t) => t.name === 'cdn_billing_query');
assert.ok(cdnBillingQuery);
assert.equal(cdnBillingQuery!.actions.data.scope?.write, true);
const recordCheck = recordTools.find((t) => t.name === 'record_query');
assert.ok(recordCheck);
assert.equal(recordCheck!.actions.check.scope?.write, true);
const optimizeQuery = taskTools.find((t) => t.name === 'optimizeip_query');
assert.ok(optimizeQuery);
assert.equal(optimizeQuery!.actions.api_balance.scope?.write, true);
const recordQuery = adminList.result.tools.find((t: any) => t.name === 'record_query');
assert.ok(recordQuery);
const recordQueryDef = recordTools.find((t) => t.name === 'record_query');
assert.ok(recordQueryDef);
assert.doesNotThrow(() => checkActionScope({ ...apiCtx, scopes: ['dns:read'] }, recordQueryDef!.actions.search));
assert.throws(() => checkActionScope({ ...apiCtx, scopes: ['cdn:read'] }, recordQueryDef!.actions.search), /作用域/);
assert.throws(() => checkActionScope({ ...apiCtx, scopes: ['dns:read'] }, dnscheckTool!.actions.tasks), /作用域/);
const dnscheckManage = operationsManageTools.find((t) => t.name === 'dnscheck_manage');
assert.ok(dnscheckManage);
assert.doesNotThrow(() => checkActionScope({ ...apiCtx, scopes: ['dnscheck:write'] }, dnscheckManage!.actions.add));
assert.throws(() => checkActionScope({ ...apiCtx, scopes: ['dnscheck:read'] }, dnscheckManage!.actions.add), /作用域/);
const cdnManage = cdnManageTools.find((t) => t.name === 'cdn_domain_manage');
assert.ok(cdnManage);
assert.doesNotThrow(() => checkActionScope({ ...apiCtx, scopes: ['cdn:write'] }, cdnManage!.actions.origin));
assert.throws(() => checkActionScope({ ...apiCtx, scopes: ['cdn:read'] }, cdnManage!.actions.origin), /作用域/);
const cdnRuleManage = cdnAdvancedTools.find((t) => t.name === 'cdn_rule_manage');
assert.ok(cdnRuleManage);
assert.doesNotThrow(() => checkActionScope({ ...apiCtx, scopes: ['cdn:write'] }, cdnRuleManage!.actions.add));
assert.throws(() => checkActionScope({ ...apiCtx, scopes: ['cdn:read'] }, cdnRuleManage!.actions.add), /作用域/);
const cdnEsaApi = cdnAdvancedTools.find((t) => t.name === 'cdn_esa_api');
assert.ok(cdnEsaApi);
assert.doesNotThrow(() => checkActionScope({ ...apiCtx, scopes: ['cdn:write'] }, cdnEsaApi!.actions.execute));
assert.throws(() => checkActionScope({ ...apiCtx, scopes: ['cdn:read'] }, cdnEsaApi!.actions.execute), /作用域/);
const unknownMethod = await server.handleBody({ jsonrpc: '2.0', id: 4, method: 'nope' }, admin);
assert.equal(unknownMethod.error.code, -32601);
const unknownTool = await server.handleBody({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } }, admin);
assert.equal(unknownTool.error.code, -32602);
const badAction = await server.handleBody({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'record_query', arguments: { domain_id: 1, action: 'nope' } } }, admin);
assert.equal(badAction.result.isError, true);
const missingRequired = await server.handleBody({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'record_query', arguments: { action: 'list' } } }, admin);
assert.equal(missingRequired.result.structuredContent.msg, '缺少必填参数：domain_id');
const searchMissing = await server.handleBody({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'record_query', arguments: { action: 'search' } } }, admin);
assert.equal(searchMissing.result.structuredContent.msg, '缺少必填参数：keyword');
const pingNotification = await server.handleBody({ jsonrpc: '2.0', method: 'ping' }, admin);
assert.equal(pingNotification, null);
const batch = await server.handleBody([{ jsonrpc: '2.0', id: 8, method: 'ping' }, { jsonrpc: '2.0', method: 'ping' }], admin);
assert.equal(batch.length, 1);
assert.equal(batch[0].id, 8);
const emptyBatch = await server.handleBody([], admin);
assert.equal(emptyBatch.error.code, -32600);
const parseError = await server.handleBody({}, admin, true);
assert.equal(parseError.error.code, -32700);

console.log(`MCP 自检通过：管理员 ${adminList.result.tools.length} 个工具 / ${actionCount(adminList.result.tools)} 个动作，普通用户 ${userList.result.tools.length} 个工具 / ${actionCount(userList.result.tools)} 个动作`);
