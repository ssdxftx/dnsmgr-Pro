# 彩虹 DNS Pro MCP 全模块能力覆盖调研报告

- 报告日期：2026-11-25
- 代码版本：彩虹 DNS Pro `1.35.11`
- 调研对象：`backend/src/routes/*`、`backend/src/mcp/*`、`backend/src/lib/apiKeys.ts`、`frontend/src/router.ts`
- 调研范围：现有 MCP 工具与后端业务模块的覆盖差异、缺口清单、同风格扩展方案、优先级、风险与验收标准
- 本轮产出：调研报告 + 第一批只读工具 + 第二批受控写操作 + 第三批 CDN 高级能力 + 复核修复（当前 69 个工具、452 个动作）

> 复核修复（2026-11-25）：本轮复核发现的问题已全部修复。源码与 `tools/list` 均为管理员 452 个动作、普通用户 149 个动作；`schedule_manage.run`、`optimizeip_manage.save_settings`、`optimizeip_manage.query_api` 已实现，4 个缺失 `scope` 已补齐，只读 POST 声明和系统统计过滤已修正。详见 `MCP_VERIFICATION_REPORT_2026-11-25.md`。

---

## 1. 结论

> 本节为 1.35.11 的调研基线。第一批只读工具、第二批受控写操作和第三批 CDN 高级能力已按本报告落地，实施结果见 1.1、1.2、1.3。

1.35.11 的 MCP 已完整移植上游彩虹聚合 DNS v2.22 的工具契约，管理员可见 28 个工具、124 个动作，普通用户可见 6 个工具、27 个动作。覆盖范围集中在 DNS、SSL 证书、证书部署、Cloudflare 自定义主机名/Tunnel、容灾切换、优选 IP、定时切换和操作日志。

按 `backend/src/lib/apiKeys.ts:4` 的 19 个 API Key 模块统计，当前有 scoped 动作的模块只有 8 个：

```text
dns 42、cloudflare 26、cert 19、monitor 10、deploy 9、optimize 7、schedule 6、users 1
```

其中 `users` 只有操作日志，`general` 只有工具级概况动作，CDN、DNS 检测、到期提醒、备份、保险库、系统设置、审计、异步任务、事件回调等 9 个业务模块没有模块级 MCP 动作。

最大缺口是 CDN：

- `backend/src/routes/cdn.ts`：225 个端点
- `backend/src/routes/preheat.ts`：6 个端点
- `backend/src/routes/account.ts` 中的 CDN 账户：5 个端点
- 合计约 236 个端点，当前 MCP 覆盖为 0

建议把“全模块 MCP 能力”定义为“每个业务模块有稳定的查询与管理入口”，长尾端点通过资源分组和通用入口收敛。CDN 的 225 个端点直接逐个映射会显著膨胀 `tools/list`，也会降低 AI 选择工具的准确率。

建议按三个批次推进：

1. 第一批：全模块只读查询，先建立可观测性和安全边界。
2. 第二批：CDN 核心写操作、CF 规则、DNS 检测、到期扫描、事件、公告、备份计划、系统测试类动作。
3. 第三批：CDN 规则/安全/边缘/流量/计费/ESA 长尾能力。

---

## 1.1 第一批实施进展

2026-11-25 已落地第一批只读工具，MCP 从 28 个工具、124 个动作扩展为 45 个工具、196 个动作；普通用户可见 18 个工具、66 个动作。

新增工具：

- CDN：`cdn_account_query`、`cdn_domain_query`、`cdn_zone_query`、`cdn_cache_query`、`cdn_statistics_query`
- 运维：`dnscheck_query`、`expire_query`、`audit_query`、`job_query`、`backup_query`
- 治理：`system_query`、`announcement_query`、`user_query`、`event_query`、`cf_rules_query`、`cert_settings_query`、`vault_query`

既有工具补充的只读动作：

- `get_overview(dashboard)`
- `dmonitor_query(domains, status)`
- `optimizeip_query(settings, domains, status)`
- `schedule_query(domains)`

实现方式：

- 新工具位于 `backend/src/mcp/tools/cdn.ts`、`backend/src/mcp/tools/operations.ts`
- 在 `backend/src/mcp/server.ts` 注册
- 在 `backend/src/mcp/invoker.ts` 补充 `dnscheck: '/api/dns-check'`
- `backend/scripts/check-mcp.ts` 增加 Pro 工具断言和 DNS 检测作用域断言

第一批全部为只读动作，写操作仍保留在 HTTP/UI 或后续批次。运行时已用管理员 API Key 逐个调用新增动作，未出现内部错误；普通 API Key 的作用域拒绝行为已核验。

---

## 1.2 第二批实施进展

2026-11-25 已落地第二批受控写操作，MCP 从 45 个工具、196 个动作扩展为 58 个工具、277 个动作；普通用户可见 22 个工具、93 个动作。

新增工具：

- CDN 写操作：`cdn_account_manage`、`cdn_domain_manage`、`cdn_zone_manage`、`cdn_cache_manage`
- 运维写操作：`dnscheck_manage`、`expire_manage`、`backup_manage`、`system_manage`
- 治理写操作：`announcement_manage`、`user_manage`、`event_manage`、`cf_rules_manage`、`cert_settings_manage`

新增动作：

- `cdn_account_manage`：`add`、`edit`、`del`
- `cdn_domain_manage`：`add`、`del`、`status`、`origin`、`cache`、`https`、`access`、`switch`、`zone_setting`、`sync`、`freecert`、`freecert_check`、`cert`、`cert_check`、`certlink`、`cert_mode`、`certlink_run`
- `cdn_zone_manage`：`check`、`create`、`verify`、`pause`、`bind_plan`、`update`、`config_import`、`custom_variables_set`、`work_mode`、`del`
- `cdn_cache_manage`：`purge`、`preheat`、`retry`、`preheat_add`、`preheat_edit`、`preheat_toggle`、`preheat_run`、`preheat_del`
- `dnscheck_manage`：`add`、`edit`、`toggle`、`run`、`del`
- `expire_manage`：`save_settings`、`scan`
- `cf_rules_manage`：`credential_set`、`credential_del`、`rule_add`、`rule_update`、`rule_delete`
- `event_manage`：`add`、`edit`、`del`、`test`
- `announcement_manage`：`add`、`edit`、`status`、`del`
- `backup_manage`：`export`、`destination_add`、`destination_edit`、`destination_del`、`destination_test`、`schedule_add`、`schedule_edit`、`schedule_del`、`schedule_run`
- `system_manage`：`save_settings`、`test_mail`、`test_tg`、`test_qq`、`test_webhook`、`test_custom_webhook`、`stat_cache_clear`、`stat_cache_refresh`
- `cert_settings_manage`：`set`
- `user_manage`：`add`、`edit`、`status`、`stat_cache`、`del`

实现方式：

- CDN 写工具位于 `backend/src/mcp/tools/cdnManage.ts`
- 运维与治理写工具位于 `backend/src/mcp/tools/operationsManage.ts`
- 在 `backend/src/mcp/server.ts` 注册并更新使用指引
- `backend/scripts/check-mcp.ts` 增加写工具名单、总数和 `cdn:write` / `dnscheck:write` 作用域断言

等级与安全：

- CDN 账户、加速域名、站点写操作沿用路由的账户可见性校验，普通用户可操作自己可见账户；云端同步、证书申请/联动、证书模式和缓存任务要求 `level: 2`
- DNS 检测写操作对普通用户开放，但只允许自己的任务和有写权限的域名
- 到期提醒、备份、系统设置、公告、用户、事件、CF 规则、证书设置写操作要求 `level: 2`
- 所有写动作声明 `scope.write=true`，API Key 必须具备对应模块的 `write` 作用域
- 路由要求的二次确认继续由 `X-Confirm-Password-B64` / `X-Reauth-Token` 完成，MCP 不复制密码校验
- 用户写操作仍受 `backend/src/routes/user.ts` 的登录会话限制，API Key 请求会被路由拒绝

验证结果：后端 `tsc --noEmit`、`check:mcp`、`check:sqlite`、`check:backup`、`check:audit` 通过；前端 `vue-tsc --noEmit`、`check:i18n`、`check:format`、`build` 通过。运行时已用管理员 API Key 覆盖新增动作的主要路径（含无效 ID/参数路径；到期扫描和新建备份计划等有副作用的动作未在共享测试库执行），无内部错误；只读 Key 调用写动作被作用域拒绝。

## 1.3 第三批实施进展

2026-11-25 已落地第三批 CDN 高级能力，MCP 从 58 个工具、277 个动作扩展为 69 个工具、452 个动作；普通用户可见 27 个工具、149 个动作。

新增工具：

- 规则引擎：`cdn_rule_query`、`cdn_rule_manage`
- 安全：`cdn_security_query`、`cdn_security_manage`
- 边缘：`cdn_edge_query`、`cdn_edge_manage`
- 流量：`cdn_traffic_query`、`cdn_traffic_manage`
- 计费：`cdn_billing_query`、`cdn_billing_manage`
- ESA：`cdn_esa_api`

新增动作：

- `cdn_rule_query`：`setting`、`list`、`configs`、`actions`、`schema`
- `cdn_rule_manage`：`add`、`edit`、`del`、`priority`、`config_save`、`config_del`
- `cdn_security_query`：`ip_groups`、`ip_group_content`、`ddos`、`waf`、`origin_protection`、`origin_families`、`template`、`template_bindings`、`js_injection`、`client_attesters`、`api_services`、`api_resources`、`content_identifiers`、`l4_proxies`、`l4_proxy_rules`
- `cdn_security_manage`：IP 组 3 个、DDoS/WAF/源站防护 4 个、策略模板 2 个、JS 注入 3 个、客户端认证 3 个、API 服务 3 个、API 资源 3 个、内容标识 3 个、四层代理与规则 8 个
- `cdn_edge_query`：函数、运行时、副本、绑定、函数规则、KV 命名空间/键/读取、环境、版本、版本详情、发布历史
- `cdn_edge_manage`：函数 3 个、运行时 1 个、副本 3 个、绑定 1 个、函数规则 3 个、KV 命名空间 3 个、KV 写入/删除 2 个、版本创建/发布 2 个
- `cdn_traffic_query`：共享 CNAME、别称域名、响应页面、源站组、负载均衡、健康状态、多通道网关/线路/回源 ACL
- `cdn_traffic_manage`：共享 CNAME 4 个、别称域名 4 个、响应页面 3 个、源站组 3 个、负载均衡 3 个、多通道网关 4 个、线路 3 个、回源 ACL 确认 1 个、接入密钥 3 个
- `cdn_billing_query`：`data`、`available_plans`
- `cdn_billing_manage`：`plan_add`、`plan_edit`、`plan_renew`、`plan_upgrade`、`plan_del`、`plan_quota`、`zone_plan`
- `cdn_esa_api`：`catalog`、`execute`

既有工具补充：

- `record_query`：新增 `search`，按关键词跨域名搜索解析记录，复用 `/api/records/search` 的 200 条上限和普通用户授权过滤

实现方式：

- 工具位于 `backend/src/mcp/tools/cdnAdvanced.ts`
- 在 `backend/src/mcp/server.ts` 注册并更新使用指引
- `backend/scripts/check-mcp.ts` 增加第三批工具名单、总数、普通用户等级过滤和 `cdn:write` 作用域断言

等级与安全：

- 只读查询动作默认 `level: 1`；WAF、策略模板、规则动作/Schema 等治理型查询为 `level: 2`
- 所有写操作 `level: 2`，并要求 `cdn:write` 作用域；`cdn_esa_api.execute` 仅管理员可用
- 四层代理、规则、边缘函数、计费与 ESA 通用接口继续复用路由的账户归属校验和审计
- 网关接入密钥只提供创建、更新、刷新动作，不提供读取动作；ESA 通用入口保留路由的参数白名单和必填参数校验

验证结果：后端 `tsc --noEmit`、`check:mcp`、`check:sqlite`、`check:backup`、`check:audit` 通过；前端 `vue-tsc --noEmit`、`check:i18n`、`check:format`、`build` 通过。运行时已用管理员 API Key 调用第三批全部 138 个动作（统一使用无效账户 ID，避免改写共享测试库），并验证 `record_query(search)` 跨域名搜索，未出现内部错误；只读 Key 调用写动作被作用域拒绝，缺少必填参数和未知 action 返回友好错误。

---

## 2. 现有 MCP 覆盖盘点（1.35.11 基线）

### 2.1 现有工具与模块映射

| 模块 | 现有工具 | 现有动作数 | 覆盖判断 |
|---|---|---:|---|
| dns | `dns_account_query/manage`、`domain_query/manage`、`domain_category_manage`、`record_query/manage` | 42 | 基本完整，缺全局解析搜索 |
| cloudflare | `cf_hostname_query/manage`、`cf_tunnel_query/manage` | 26 | 自定义主机名和 Tunnel 完整，缺 CF 规则引擎 |
| cert | `cert_account_query/manage`、`cert_order_query/manage`、`cert_cname_query/manage` | 19 | 缺证书全局设置 |
| monitor | `dmonitor_query/manage` | 10 | 缺可选域名、运行状态 |
| deploy | `cert_deploy_query/manage` | 9 | 完整 |
| optimize | `optimizeip_query/manage` | 7 | 缺设置、可选域名、状态、积分查询接口 |
| schedule | `schedule_query/manage` | 6 | 缺可选域名、立即执行 |
| users | `operation_log_query` | 1 | 只有操作日志，缺用户管理 |
| general | `get_overview`、`list_provider_types` | 2 个工具级动作 | 缺仪表盘汇总接口 |

### 2.2 模块缺口矩阵

| 模块 | 模块级动作 | 主要缺口 | 建议工具 |
|---|---:|---|---|
| cdn | 0 | 账户、加速域名、站点、缓存刷新/预热、统计、规则、安全、边缘能力 | `cdn_*`，见第 5 节 |
| dnscheck | 0 | 任务 CRUD、启停、立即执行、可选域名/子域名 | `dnscheck_query` / `dnscheck_manage` |
| expire | 0 | 全局设置、扫描触发；域名刷新和批量提醒已散落在 `domain_manage` | `expire_query` / `expire_manage` |
| backup | 0 | 导出、任务、目标、计划、远端存储、恢复 | `backup_query` / `backup_manage` |
| vault | 0 | 状态、解锁、锁定、口令、恢复、销毁 | 先做 `vault_query(status)` |
| users | 1 | 用户列表、详情、授权、启停、删除、统计缓存权限 | `user_query` / `user_manage` |
| system | 0 | SMTP、Telegram、QQ、Webhook、代理、统计缓存、公告、版本 | `system_query` / `system_manage`、`announcement_*` |
| audit | 0 | 审计列表、统计、CSV 导出 | `audit_query` |
| jobs | 0 | 异步任务列表、任务详情 | `job_query` |
| events | 0 | 订阅 CRUD、测试、投递记录 | `event_query` / `event_manage` |
| general | 2 | `/api/dashboard/summary` | 在 `get_overview` 增加 `dashboard` 动作 |
| cert | 19 | `/api/cert/settings` | `cert_settings_query` / `cert_settings_manage` |
| cloudflare | 26 | `/api/cf-rules/*` | `cf_rules_query` / `cf_rules_manage` |
| monitor | 10 | `/api/dmonitor/domains`、`/api/dmonitor/status` | 补既有工具动作 |
| optimize | 7 | 设置、可选域名、状态、`/api/optimize/queryapi` | 补既有工具动作 |
| schedule | 6 | `/api/schedule/domains`、`/api/schedule/tasks/:id/run` | 补既有工具动作 |
| dns | 42 | `/api/records/search` | 低优先级，可新增 `record_search` |

### 2.3 关键发现

1. 现有 MCP 是上游契约的完整移植，新增 Pro 模块属于扩展，不需要改动既有 28 个工具的名称和动作。
2. `backend/src/lib/apiKeys.ts` 的模块列表已经包含 `cdn`、`dnscheck`、`expire`、`backup`、`vault`、`system`、`audit`、`jobs`、`events`，新增工具可以直接复用现有作用域体系，不需要数据库迁移。
3. `backend/src/mcp/invoker.ts:6` 的 `SCOPE_PATHS` 缺少 `dnscheck`。新增 DNS 检测工具时必须补 `dnscheck: '/api/dns-check'`，否则 `moduleForPath` 会把 `/api/dnscheck` 识别成 `general`，导致 `dnscheck:read` / `dnscheck:write` 校验失败。
4. `backend/scripts/check-mcp.ts:26` 目前硬编码 28/124 和 6/27。新增工具后建议改成“上游契约 + Pro 扩展契约”两组断言，避免只维护总数。
5. `backend/src/routes/mcp.ts` 已有 MCP 调用审计、参数脱敏、响应大小上限和速率限制。新增工具继续通过 `app.inject()` 调用现有路由即可继承这些能力。

---

## 3. 缺口详细分析

### 3.1 CDN

CDN 是当前最大的业务缺口，也是日常运维使用频率最高的 Pro 能力。建议按资源拆成 5 组核心工具，不做一个包含 225 个动作的巨型工具。

核心端点分组：

- CDN 账户：`/api/cdn/providers`、`/api/cdn/accounts`、`/api/cdn/accounts/:aid/zones`
- 加速域名：列表、详情、接入、删除、状态、回源、缓存、HTTPS、访问控制、切换线路、云端同步
- 站点：站点列表、创建、归属校验、暂停、套餐绑定、NS、属性、配置导入导出、自定义变量、工作模式
- 缓存：刷新、预热、任务历史、任务重试、定时预热任务
- 统计：概览、详情、时序、Top、缓存命中、DDoS、四层时序、IP 区域

高级能力：

- 规则引擎：EO L7 规则、ESA 12 类规则配置
- 安全：IP 组、DDoS/WAF、源站防护、模板、JS 注入、客户端认证、API 服务/资源、内容标识
- 边缘：函数、运行时、副本、绑定、函数规则、EdgeKV、版本管理
- 流量：共享 CNAME、别称域名、错误页、源站组、负载均衡、多通道网关
- 计费：套餐、续费、升级、配额
- ESA 官方 OpenAPI：478 个接口的目录与通用执行

建议在第一批只暴露账户、域名、站点、缓存、统计。规则、安全、边缘、流量、计费留到第三批，ESA 全量入口只作为管理员级通用逃生口。

### 3.2 DNS 检测

`backend/src/routes/dnscheck.ts` 有 8 个端点，当前没有 MCP 动作：

- `GET /api/dns-check/tasks`
- `GET /api/dns-check/domains`
- `GET /api/dns-check/domains/:id/subs`
- `POST /api/dns-check/tasks`
- `PUT /api/dns-check/tasks/:id`
- `POST /api/dns-check/tasks/:id/toggle`
- `POST /api/dns-check/tasks/:id/run`
- `DELETE /api/dns-check/tasks/:id`

适合按 `dnscheck_query` / `dnscheck_manage` 两件套接入。任务列表对管理员和普通用户有不同范围，工具动作的 `level` 要与路由的 `checkLevel` 和域名权限保持一致。

### 3.3 到期提醒

`backend/src/routes/expire.ts` 有 5 个端点：

- `GET/POST /api/expire/settings`
- `POST /api/expire/scan`
- `POST /api/domains/:id/update-date`
- `POST /api/domains/batch-notice`

其中域名更新和批量提醒已经通过 `domain_manage` 暴露。缺的是全局设置和扫描触发，建议增加 `expire_query(settings)`、`expire_manage(save_settings, scan)`，不要重复定义域名动作。

### 3.4 备份与保险库

备份模块有 23 个端点，覆盖导出、任务、下载、删除、导入、恢复、维护模式、密钥、目标、计划、远端存储。恢复和导入依赖文件上传，MCP 客户端传递二进制文件的能力有限，也属于高破坏性操作，建议不纳入第一批。

保险库有 12 个端点。`backend/src/routes/vault.ts:30` 对 API Key 明确拒绝初始化、改口令、降级、销毁等操作。建议 MCP 先只提供 `vault_query(status)`，解锁/锁定等能力单独评估。

### 3.5 用户、系统、审计、任务、事件

这些模块的共同特点是管理员属性强、结果数据可能较大、部分操作要求登录会话：

- 用户管理：`backend/src/routes/user.ts:87` 对所有用户写操作拒绝 API Key。MCP 在 `X-API-Key` 模式下只能做查询；写操作保留 UI，或明确标注仅旧版 Bearer MCP 模式可用。
- 系统设置：读取接口对密钥类字段返回掩码；写入敏感项要求二次确认。MCP 应复用 `X-Confirm-Password`，不要把密码放进工具参数再写入审计。
- 审计：`/api/audit/logs` 已做权限过滤和错误信息隐藏；CSV 导出不适合作为 MCP 文本结果返回。
- 异步任务：`/api/jobs` 是长任务类工具的重要配套，建议优先接入。
- 事件回调：订阅包含回调 URL 和密钥，读取时已隐藏 secret；新增/编辑/测试需要管理员级权限。

### 3.6 证书设置与 CF 规则

`/api/cert/settings` 有 2 个端点，当前没有工具动作。前端将 `/cert-` 归为管理员入口，但后端路由只挂了 `auth`。MCP 暴露 `cert_settings_manage` 时应至少设置 `level: 2`，并建议同步补后端管理员校验，避免普通用户通过 API 修改全局证书设置。

`/api/cf-rules/*` 有 10 个端点，全部是管理员接口，适合拆成 `cf_rules_query` / `cf_rules_manage`。凭证查询返回掩码配置，保存凭证会校验 Cloudflare 权限，MCP 层不需要重复实现。

---

## 4. 目标架构与实现风格

### 4.1 保持现有分层

现有 MCP 的三层结构已经适合扩展：

```text
HTTP /mcp
  -> McpServer JSON-RPC 分发
  -> ToolRegistry 权限过滤与 action 校验
  -> ActionDef request/handler
  -> app.inject() 调用现有 /api/* 路由
  -> 路由级权限、审计、幂等、限流、二次确认
```

新增模块继续使用这套结构，不复制业务逻辑。

### 4.2 工具命名

统一使用资源级 `xxx_query` / `xxx_manage`：

- 查询工具：`readOnly: true`，只包含 GET/POST 查询类动作
- 管理工具：`destructive: true`，只包含写操作和长任务触发
- 动作名沿用现有风格：`list`、`get`、`add`、`edit`、`del`、`batch_*`、`set_active`、`show_log`、`process`、`reset`

### 4.3 Action 映射方式

纯 CRUD 使用 `request`：

```ts
{
  desc: '检测任务列表',
  level: 2,
  scope: { module: 'dnscheck' },
  defaults: { ...pagingDefaults() },
  request: (args) => ({
    method: 'GET',
    path: '/api/dns-check/tasks',
    query: {
      kw: args.kw,
      offset: args.offset,
      limit: args.limit,
    },
  }),
  after: (data) => listResponse(data),
}
```

需要跨表校验、配置合并、异步任务或聚合结果时使用 `handler`。例如 CDN 域名接入、证书联动、备份导出、保险库状态。

### 4.4 作用域与等级

新增 action 必须显式声明 `scope`：

| 能力 | scope |
|---|---|
| CDN 账户/域名/站点/缓存/统计/规则/安全 | `cdn` |
| DNS 检测 | `dnscheck` |
| 到期提醒 | `expire` |
| 备份 | `backup` |
| 保险库 | `vault` |
| 用户与操作日志 | `users` |
| 系统设置、公告、指标 | `system` |
| 审计 | `audit` |
| 异步任务 | `jobs` |
| 事件回调 | `events` |
| CF 规则 | `cloudflare` |
| 证书设置 | `cert` |
| 仪表盘与关于 | `general` |

`SCOPE_PATHS` 只需补特殊前缀：

```ts
const SCOPE_PATHS: Record<string, string> = {
  dnscheck: '/api/dns-check',
  // 其余沿用 /api/<module>
};
```

`preheat` 复用 `cdn`，`cf-rules` 复用 `cloudflare`，`announcements` 复用 `system`。

`level` 按路由现有权限设置：

- 管理员模块默认 `2`
- 个人备份、保险库状态、普通用户可见的查询使用 `1`
- 管理员可单独授权统计缓存的 CDN 统计，按路由的 `statAuth` 语义处理
- 用户写入、保险库保护方式修改等会话级操作不通过 API Key 暴露

### 4.5 注册与检查

新增工具文件后：

1. 在 `backend/src/mcp/server.ts` 增加 import 并展开到 registry。
2. 更新 `backend/src/mcp/invoker.ts` 的 `SCOPE_PATHS`。
3. 更新 `backend/scripts/check-mcp.ts`，分别断言既有上游契约和 Pro 扩展工具。
4. 更新 `README.md` 与 `.monkeycode/docs/MCP_UPSTREAM_2.22_REPORT.md` 的覆盖说明。
5. 前端 MCP 配置入口不需要改，仍使用 `/mcp` 和 `X-API-Key`。

---

## 5. 建议工具清单

### 5.1 第一批：CDN 核心

| 工具 | 主要动作 | 状态 |
|---|---|---|
| `cdn_account_query` | `list`、`providers`、`zones` | 已完成 |
| `cdn_account_manage` | `add`、`edit`、`del` | 已完成 |
| `cdn_domain_query` | `list`、`get`、`switch_sites`、`switch_check`、`cert_status`、`cert_candidates`、`certlink_log` | 已完成 |
| `cdn_domain_manage` | `add`、`del`、`status`、`origin`、`cache`、`https`、`access`、`sync`、`switch`、`zone_setting`、`freecert`、`freecert_check`、`cert`、`cert_check`、`certlink`、`cert_mode`、`certlink_run` | 已完成 |
| `cdn_zone_query` | `zones`、`sites`、`plan_instances`、`ns`、`properties`、`config_export`、`custom_variables` | 已完成 |
| `cdn_zone_manage` | `check`、`create`、`verify`、`pause`、`bind_plan`、`update`、`config_import`、`custom_variables_set`、`work_mode`、`del` | 已完成 |
| `cdn_cache_query` | `tasks`、`task_detail`、`preheat_tasks` | 已完成 |
| `cdn_cache_manage` | `purge`、`preheat`、`retry`、`preheat_add`、`preheat_edit`、`preheat_toggle`、`preheat_run`、`preheat_del` | 已完成 |
| `cdn_statistics_query` | `overview`、`detail`、`series`、`top`、`timing_cache`、`ddos_events`、`ddos_top`、`l4_timing`、`ip_region` | 已完成 |

### 5.2 第二批：运维与治理

| 工具 | 主要动作 | 状态 |
|---|---|---|
| `dnscheck_query` | `tasks`、`domains`、`subs` | 已完成 |
| `dnscheck_manage` | `add`、`edit`、`toggle`、`run`、`del` | 已完成 |
| `expire_query` | `settings` | 已完成 |
| `expire_manage` | `save_settings`、`scan` | 已完成 |
| `audit_query` | `logs`、`stats` | 已完成 |
| `job_query` | `list`、`get` | 已完成 |
| `backup_query` | `jobs`、`destinations`、`schedules`、`remote`、`key_status` | 已完成 |
| `backup_manage` | `export`、`destination_add/edit/del/test`、`schedule_add/edit/del/run` | 已完成 |
| `system_query` | `settings`、`about`、`notifications` | 已完成 |
| `system_manage` | `save_settings`、`test_mail`、`test_tg`、`test_qq`、`test_webhook`、`test_custom_webhook`、`stat_cache_clear`、`stat_cache_refresh` | 已完成 |
| `announcement_query` | `list` | 已完成 |
| `announcement_manage` | `add`、`edit`、`status`、`del` | 已完成 |
| `user_query` | `list`、`get`、`domains` | 已完成 |
| `user_manage` | `add`、`edit`、`status`、`stat_cache`、`del`；API Key 模式下由路由拒绝 | 已完成 |
| `event_query` | `subscriptions`、`deliveries` | 已完成 |
| `event_manage` | `add`、`edit`、`del`、`test` | 已完成 |
| `cf_rules_query` | `phases`、`domains`、`accounts`、`credential`、`rules` | 已完成 |
| `cf_rules_manage` | `credential_set`、`credential_del`、`rule_add`、`rule_update`、`rule_delete` | 已完成 |
| `cert_settings_query` | `get` | 已完成 |
| `cert_settings_manage` | `set` | 已完成 |
| `vault_query` | `status` | 已完成 |

### 5.3 第三批：CDN 高级能力（已完成）

| 工具 | 主要动作 | 状态 |
|---|---|---|
| `cdn_rule_query` / `cdn_rule_manage` | 规则设置、规则列表、规则配置、规则动作、规则 Schema、增删改、优先级 | 已完成 |
| `cdn_security_query` / `cdn_security_manage` | IP 组、DDoS/WAF、源站防护、模板、JS 注入、客户端认证、API 服务/资源、内容标识、四层代理 | 已完成 |
| `cdn_edge_query` / `cdn_edge_manage` | 函数、运行时、副本、绑定、函数规则、EdgeKV、版本、环境、部署 | 已完成 |
| `cdn_traffic_query` / `cdn_traffic_manage` | 共享 CNAME、别称域名、错误页、源站组、负载均衡、多通道网关 | 已完成 |
| `cdn_billing_query` / `cdn_billing_manage` | 计费数据、可用套餐、套餐增删改、续费、升级、配额 | 已完成 |
| `cdn_esa_api` | `catalog`、`execute`；仅管理员和 `cdn:write` | 已完成 |

`cdn_esa_api` 的 `execute` 属于通用 OpenAPI 代理，建议只对管理员开放，并在文档中明确风险。

### 5.4 既有工具补动作

| 工具 | 新增动作 | 状态 |
|---|---|---|
| `get_overview` | `dashboard` | 已完成 |
| `dmonitor_query` | `domains`、`status` | 已完成 |
| `optimizeip_query` | `settings`、`domains`、`status` | 已完成 |
| `optimizeip_manage` | `save_settings`、`query_api` | 已完成 |
| `schedule_query` | `domains` | 已完成 |
| `schedule_manage` | `run` | 已完成 |
| `record_query` | `search` 跨域名搜索解析记录 | 已完成 |

---

## 6. 不纳入 MCP 的能力

以下能力保留 HTTP/UI，不通过 MCP 暴露：

| 能力 | 原因 |
|---|---|
| 登录、TOTP、登出、改密 | 会话协议入口，MCP 已使用 API Key 认证 |
| 初始安装、注册 | 公开入口，和 AI 运维无关 |
| QQ 机器人 webhook | 入站回调，不是用户主动操作 |
| API Key 创建、轮换、吊销 | 会返回明文凭据，存在自动扩权和凭据外带风险 |
| 保险库初始化、改口令、降级、销毁 | 会话级高安全操作，路由已拒绝 API Key |
| 用户密码重置、旧版 API Key 设置 | 账号接管级操作，路由已拒绝 API Key |
| 备份恢复、备份导入 | 需要文件上传，破坏性高，MCP 无法可靠传输 |
| 备份文件下载、审计 CSV 原文 | 二进制/大文本，不适合 MCP 文本响应 |
| `/api/metrics` | `text/plain` 响应，需要专用 handler，收益低于业务模块 |

---

## 7. 实施计划

### 7.1 第一批：只读覆盖（已完成）

目标：每个业务模块至少有一个查询入口，先建立安全、可观测的 AI 查询能力。

范围：

- `cdn_account_query`、`cdn_domain_query`、`cdn_zone_query`、`cdn_cache_query`、`cdn_statistics_query`
- `dnscheck_query`
- `expire_query`
- `audit_query`
- `job_query`
- `backup_query`
- `system_query`
- `user_query`
- `event_query`
- `cf_rules_query`
- `cert_settings_query`
- `vault_query`
- `get_overview(dashboard)`
- 补 `dmonitor_query`、`optimizeip_query`、`schedule_query` 的只读动作

验收重点：

- 工具列表按等级过滤正确
- 读取结果中的密钥、令牌、配置均为掩码
- 大列表有分页或数量上限
- 审计日志不记录明文敏感参数

### 7.2 第二批：受控写操作（已完成）

范围：

- [x] `cdn_account_manage`、`cdn_domain_manage`、`cdn_zone_manage`、`cdn_cache_manage`
- [x] `dnscheck_manage`
- [x] `expire_manage`
- [x] `cf_rules_manage`
- [x] `event_manage`
- [x] `announcement_manage`
- [x] `backup_manage` 中的导出和计划管理
- [x] `system_manage` 中的测试类、统计缓存类动作
- [x] `cert_settings_manage`
- [x] `user_manage`（开放工具动作；API Key 写请求仍由路由拒绝）

验收重点：

- 所有写动作要求对应 `write` scope
- 管理员模块要求 `level: 2`
- 路由要求二次确认的动作继续要求 `X-Confirm-Password` 或 `X-Reauth-Token`
- 删除、批量操作、同步、申请证书等动作不在 MCP 层复制业务校验

### 7.3 第三批：高级与长尾（已完成）

范围：

- [x] CDN 规则、安全、边缘、流量、计费
- [x] `cdn_esa_api`
- [x] `record_query(search)` 跨域名搜索解析记录

原则：

- 长尾能力优先收敛到少量工具
- 不把 478 个 ESA 接口逐个生成 action
- 高风险写操作默认管理员可见，且要求 `cdn:write`
- 控制工具总量，不按端点逐个膨胀（第三批完成后为 69 个工具）

---

## 8. 安全与工程约束

### 8.1 认证模式差异

`X-API-Key` 是推荐模式，但部分模块有登录会话限制：

- `backend/src/routes/user.ts:87`：用户写操作拒绝 API Key
- `backend/src/routes/vault.ts:30`：保险库保护方式修改拒绝 API Key
- `backend/src/routes/backup.ts`：个人备份导出要求登录密码或二次确认

新增工具必须明确每个动作在 API Key 模式下是否可用。无法在 API Key 模式下工作的写操作，应保持 UI 或标记为仅旧版 Bearer MCP 模式可用。

### 8.2 敏感数据

需要重点检查的返回字段：

- CDN 账户 `config`
- CF 规则专用凭证
- 系统 SMTP、Telegram、QQ、Webhook、代理配置
- 备份目标配置
- 保险库状态
- 用户 API Key 与权限

读取时复用 `maskConfig` / `SECRET_MASK`。写入时复用 `mergeMaskedConfig`，未传字段保持原值。MCP 审计参数走 `backend/src/routes/mcp.ts:44` 的 `maskBody`，不要额外把明文写入日志。

### 8.3 大响应

`backend/src/routes/mcp.ts` 默认响应上限为 8MB。CDN 域名、站点、审计日志、任务历史可能超过合理范围，建议：

- 列表动作统一支持 `offset` / `limit`
- 工具层用 `paging()` 和 `listResponse`
- 单页上限与路由现有 `clampLimit` 一致
- 不把配置文件、证书 PEM、CSV 全文作为列表结果返回

### 8.4 长任务

以下动作可能超过 MCP 请求时间：

- CDN 云端同步
- CDN 证书申请/联动
- 预热任务立即执行
- 备份导出
- DNS 检测立即执行
- 定时/优选任务立即执行

优先复用现有异步任务表，返回 `job_id`，由客户端调用 `job_query` 轮询。已有同步路由在第一批保持同步，第三批再评估异步化。

### 8.5 测试

每批改动需要通过：

```bash
cd backend
npx tsc --noEmit
npm run check:mcp
npm run check:sqlite
npm run check:backup
npm run check:audit
```

```bash
cd frontend
npx vue-tsc --noEmit
npm run check:i18n
npm run check:format
npm run build
```

MCP 专项验证：

- 管理员与普通用户的 `tools/list` 数量、工具名、action 枚举
- 只读 Key 调用写动作被作用域拒绝
- 未知工具返回 `-32602`
- 未知动作返回 `isError=true`
- 缺少必填参数返回友好错误
- 新模块 scope 路径正确，尤其 `dnscheck`
- 敏感字段在工具结果和 MCP 审计中均为掩码
- 大列表分页和响应上限生效

---

## 9. 风险与待确认

| 风险 | 影响 | 建议 |
|---|---|---|
| CDN 端点数量大 | 工具 Schema 膨胀、AI 选择困难 | 按资源拆组，长尾用 `cdn_esa_api` |
| API Key 会话限制 | 用户/保险库写操作在 MCP 中不可用 | 查询优先，写操作保留 UI 或明确模式 |
| 系统设置包含密钥 | 明文泄露、误写坏配置 | 读掩码、写确认、审计脱敏 |
| 备份导出含全量数据 | 数据外带风险 | 管理员 + `backup:write` + 二次确认，后续再评估 |
| CDN ESA 通用入口 | 等价于任意 OpenAPI 代理 | 仅管理员，文档标注风险，必要时加动作白名单 |
| 长任务超时 | 客户端重试造成重复操作 | 返回任务 ID，使用 `job_query` 轮询 |
| `check-mcp` 硬编码 | 每次新增工具都要改数字，容易漏测 | 改为按模块维护期望工具/动作 |
| 证书设置路由权限 | 后端只校验登录，前端按管理员展示 | MCP 设 `level: 2`，并建议补后端 `checkLevel` |

待确认项：

1. `user_manage` 是否允许在旧版 Bearer MCP 模式下使用，还是完全保留 UI。
2. `backup_manage(export)` 是否允许 API Key 触发，还是只允许登录会话。
3. CDN 高级能力是否全部通过 `cdn_esa_api` 暴露，还是只做精选 action。
4. 是否需要在工具层增加统一的 `confirm=true` 二次确认参数，还是完全依赖路由的 `X-Confirm-Password`。

---

## 10. 建议结论

建议把下一版本定位为 MCP 全模块扩展版本，版本号使用 `1.36.0`。第一批先完成只读覆盖，重点落地 CDN 五组查询、审计、异步任务、DNS 检测、到期提醒、备份查询、系统查询、用户查询、事件查询、CF 规则查询、证书设置查询和保险库状态。

第一批完成后，MCP 从“上游 7 个业务域的工具集”扩展为“覆盖 Pro 全部可运维业务模块的只读 AI 接口”。第二批按实际使用频率开放写操作，避免一次性把高风险端点全部暴露给 AI。第三批收敛 CDN 规则、安全、边缘、流量、计费和 ESA 通用入口。截至 2026-11-25，第一、二、三批已完成，当前为 69 个工具、452 个动作，普通用户 27 个工具、149 个动作。

---

## 附录 A：参考文件

- `backend/src/mcp/server.ts`
- `backend/src/mcp/registry.ts`
- `backend/src/mcp/invoker.ts`
- `backend/src/mcp/types.ts`
- `backend/src/mcp/tools/domain.ts`
- `backend/src/mcp/tools/record.ts`
- `backend/src/mcp/tools/cert.ts`
- `backend/src/mcp/tools/cloudflare.ts`
- `backend/src/mcp/tools/task.ts`
- `backend/src/routes/mcp.ts`
- `backend/src/routes/cdn.ts`
- `backend/src/routes/preheat.ts`
- `backend/src/routes/dnscheck.ts`
- `backend/src/routes/expire.ts`
- `backend/src/routes/backup.ts`
- `backend/src/routes/vault.ts`
- `backend/src/routes/user.ts`
- `backend/src/routes/system.ts`
- `backend/src/routes/audit.ts`
- `backend/src/routes/jobs.ts`
- `backend/src/routes/events.ts`
- `backend/src/routes/cfrules.ts`
- `backend/src/lib/apiKeys.ts`
- `backend/scripts/check-mcp.ts`
- `frontend/src/router.ts`
- `frontend/src/lib/admin.ts`

## 附录 B：本次调研使用的统计口径

- “模块”以 `backend/src/lib/apiKeys.ts` 的 `API_KEY_MODULES` 为主，`announcement`、`preheat`、`cf-rules`、`observability` 归入对应主模块。
- “动作数”以 `backend/src/mcp/tools/*.ts` 中 `ActionDef` 的数量为准。
- “端点”以 `app.get/post/put/patch/delete` 注册数量为准，动态循环注册的同类端点按实际循环项估算。
- CDN 端点统计包含 `cdn.ts`、`preheat.ts` 和 `account.ts` 中的 CDN 账户部分，不含 Cloudflare 自定义主机名/Tunnel。