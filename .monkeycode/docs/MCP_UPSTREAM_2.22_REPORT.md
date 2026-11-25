# 彩虹聚合DNS v2.22 MCP 能力分析报告

- 报告日期：2026-11-25
- 分析对象：`netcccyun/dnsmgr` tag `2.22`，commit `72bd5b5`，发布日期 2026-11-09
- MCP 引入提交：`d5db267`，提交说明「新增MCP接口，可通过 AI Agent管理域名解析、容灾切换、SSL证书等功能」
- 对照版本：彩虹 DNS Pro `1.35.10`、Cloudflare Workers 版 `0.31.0`
- 分析副本：`/tmp/opencode/upstream/src`（临时目录，未改动当前工作区）
- 分析范围：MCP HTTP 入口、JSON-RPC 协议、工具定义、认证与权限、调用方式、安全边界、移植建议
- 不包含：v2.22 的在线更新、SamWaf、Kangle、AxisNow 等非 MCP 变更

---

## 1. 结论

上游 v2.22 提供了一套可用的 MCP 管理接口，核心思路是把后台控制器能力收敛成 **28 个工具、124 个动作**，通过 `/mcp` 单一 HTTP 端点暴露给 AI Agent。实现没有引入第三方 MCP SDK，也没有新增数据库表或 Composer 依赖，整体规模约 1995 行。

可复用的设计：

1. `query` / `manage` 的工具命名和模块划分清晰，适合 AI 选择。
2. 一个工具通过 `action` 枚举承载多个后台动作，减少工具数量和上下文占用。
3. `list_provider_types` 把服务商配置字段暴露给 AI，避免在提示词里硬编码。
4. `prefill` 支持编辑时只传变化字段，降低 AI 漏传字段的概率。
5. 工具 Schema 按用户等级动态过滤，普通用户看不到管理动作。
6. `readOnlyHint` / `destructiveHint` 注解可以辅助客户端展示风险。

需要重做的部分：

1. **认证层**：上游复用旧版明文 `user.apikey`，没有作用域、有效期、IP 白名单、审计和限流。Pro 已有哈希存储、带作用域和有效期的 `api_key` 体系，应直接替换。
2. **调用层**：上游直接实例化后台控制器并伪造请求，绕过请求级中间件。Pro 应通过 `app.inject()` 或共享服务层调用现有 `/api/*`，保留审计、幂等、限流和二次确认。
3. **异步层**：证书申请、证书部署、优选 IP 执行等长任务在 MCP 请求内同步执行，客户端超时重试会造成重复操作。Pro 应改为入队并返回任务 ID。
4. **安全层**：管理员 Key 可以直接删除域名、吊销证书、删除 Tunnel。需要只读 Key、写权限开关、敏感操作二次确认和完整审计。
5. **协议完整性**：当前实现是精简的 stateless Streamable HTTP，不支持 GET/SSE、会话、`resources`、`prompts` 和 OAuth。对手动配置 Header 的客户端够用，对依赖 SSE/OAuth 的托管客户端存在兼容性限制。

总体判断：**工具设计值得复用，认证、调用、审计、异步和错误处理需要按 Pro 的现有基础设施重建。**

---

## 2. 变更范围与代码结构

### 2.1 上游 MCP 相关变更

| 变更 | 内容 |
| --- | --- |
| HTTP 入口 | 新增 `app/controller/Mcp.php` |
| 协议实现 | 新增 `app/lib/mcp/McpServer.php` |
| 工具注册 | 新增 `app/lib/mcp/ToolRegistry.php` |
| 控制器调用 | 新增 `app/lib/mcp/ControllerInvoker.php` |
| 业务异常 | 新增 `app/lib/mcp/McpException.php` |
| 认证中间件 | 新增 `app/middleware/AuthMcp.php` |
| 工具定义 | 新增 `app/lib/mcp/tools/` 下 5 个文件 |
| 路由 | `route/app.php` 注册 `Route::any('/mcp', 'mcp/handle')` |
| 用户界面 | `app/view/user/user.html` 生成 MCP 客户端配置 |
| 文档 | `README.md` 增加一行 MCP 能力说明 |

没有新增数据库迁移，没有新增 Composer 依赖，也没有 MCP 专用管理页面。MCP 开关复用用户的 `is_api` 字段，密钥复用 `user.apikey`。

### 2.2 调用链

```text
POST /mcp
  -> AuthMcp
  -> Mcp::handle
  -> McpServer::handleBody
  -> ToolRegistry::call
  -> ControllerInvoker::invoke
  -> 现有后台控制器
  -> JSON 响应
  -> tools/call result
```

### 2.3 文件职责

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `app/controller/Mcp.php` | 38 | Origin 校验、POST 限制、返回 JSON 或 202 |
| `app/lib/mcp/McpServer.php` | 119 | JSON-RPC 2.0 解析、批量处理、方法分发、错误封装 |
| `app/middleware/AuthMcp.php` | 55 | Bearer `<uid>:<apikey>` 认证、用户状态与 API 开关校验 |
| `app/lib/mcp/ToolRegistry.php` | 285 | 工具加载、Schema 生成、权限过滤、默认值、预填、JSON 编码 |
| `app/lib/mcp/ControllerInvoker.php` | 115 | 伪造请求、调用控制器、结果数组化、MCP 结果封装 |
| `app/lib/mcp/McpException.php` | 10 | 业务错误类型，转为 `isError=true` 的工具结果 |
| `app/lib/mcp/tools/*.php` | 1373 | 域名、记录、证书、Cloudflare、任务工具定义 |

---

## 3. 工具与能力矩阵

| 模块 | 工具数 | 动作数 | 覆盖内容 |
| --- | ---: | ---: | --- |
| 域名、账户、日志 | 8 | 29 | 系统概况、服务商字段、DNS 账户 CRUD、域名 CRUD/批量/分类/别名/到期时间、操作日志 |
| 解析记录 | 2 | 17 | 记录查询、子域名查询、日志、分组、生效检测、权重、记录 CRUD、批量操作、按名称修改 |
| SSL 证书 | 8 | 29 | 证书账户、部署账户、证书订单、申请/重置/吊销/续期、部署任务、CNAME 代理 |
| Cloudflare | 4 | 26 | 自定义主机名、回退源、DCV、TXT 验证目标、Tunnel、Token、公网主机名、CIDR 与主机名路由 |
| 任务 | 6 | 23 | 容灾切换、优选 IP、定时切换的查询、增删改、启停、批量、立即执行、日志清理 |
| **合计** | **28** | **124** |  |

### 3.1 权限可见性

- 动作默认 `level=2`（管理员）。
- 普通用户只能看到明确标记为 `level=1` 的动作。
- 普通用户可见 **6 个工具、27 个动作**：`get_overview`、`domain_query`、`domain_manage`、`record_query`、`record_manage`、`operation_log_query`。
- 普通用户的 `domain_manage` 只保留 `update_date`、`alias_add`、`alias_delete` 三个动作。
- 管理员可见全部 28 个工具、124 个动作。

这个默认级别设置是安全的：新增动作默认只对管理员开放，普通用户只能使用显式授权的记录与域名维护能力。

### 3.2 未覆盖能力

MCP 没有覆盖以下模块：

- CDN 接入、缓存刷新、预热、统计、站点高级配置
- 整站备份、恢复、远端存储、备份密钥
- 凭据保险库
- 用户管理、API Key 管理、系统设置
- 审计日志查询（只有操作日志 `operation_log_query`）
- DNS 劫持检测、到期提醒
- 公告、事件订阅、异步任务、通知日志
- SSH/FTP/本地目录等部署适配器细节

因此它是一套聚焦 DNS 解析、证书、Cloudflare 和自动化任务的管理接口，覆盖范围小于 Pro 的完整功能面。

---

## 4. 认证、权限与审计

### 4.1 认证流程

请求头格式：

```http
Authorization: Bearer <uid>:<apikey>
```

`AuthMcp` 的处理顺序：

1. 检查 `Bearer` 前缀。
2. 按第一个冒号拆分 `uid` 与 `apikey`。
3. 校验 `uid` 为数字。
4. 查询 `user` 表。
5. 校验 `apikey` 非空，并使用 `hash_equals` 比较。
6. 校验用户未被封禁。
7. 校验 `is_api=1`。
8. 写入 `request->user`，普通用户加载 `permission` 表。

失败返回 HTTP 401，并带 `WWW-Authenticate: Bearer realm="dnsmgr-mcp"`。

### 4.2 客户端配置生成

用户编辑页在满足以下条件时生成 MCP 配置：

- 当前为编辑用户
- `is_api=1`
- 用户 ID 与 `apikey` 均存在

生成格式：

```json
{
  "mcpServers": {
    "dnsmgr": {
      "url": "https://your-host/mcp",
      "headers": {
        "Authorization": "Bearer 1:xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

配置 URL 使用 `window.location.origin + '/mcp'`。应用部署在子路径时，该 URL 需要额外处理。

### 4.3 权限模型

权限分两层：

1. **工具层**：`ToolRegistry::availableActions()` 按用户等级过滤动作，`tools/list` 只返回可见动作。
2. **控制器层**：控制器内部继续执行 `checkPermission`、`checkLevel` 等业务校验，例如记录操作仍校验域名授权。

这带来两个好处：

- AI 不会看到当前用户无权执行的动作。
- 即使 AI 直接构造未公开的 `action`，`ToolRegistry::call` 仍会做等级检查，控制器还会做域名级校验。

### 4.4 审计与限流

上游 MCP 没有独立的调用审计、速率限制、请求体大小限制和 Key 作用域。部分写操作会在业务控制器内部写入操作日志，但 MCP 层的认证失败、工具选择、参数和耗时没有统一记录。

Pro 已有 `api_key`、审计钩子、限流和 `Idempotency-Key`，移植时应把 MCP 调用纳入这些机制。

---

## 5. 协议与传输

### 5.1 协议版本

`McpServer::SUPPORTED_VERSIONS`：

- `2025-06-18`
- `2025-03-26`
- `2024-11-05`

客户端请求的版本在列表内时原样返回；不在列表内时返回最新支持版本。

### 5.2 支持的方法

| 方法 | 说明 |
| --- | --- |
| `initialize` | 返回协议版本、`tools` 能力、服务名、版本、工作流提示 |
| `ping` | 返回空对象 |
| `tools/list` | 返回当前用户可见工具 |
| `tools/call` | 校验工具名、参数对象、动作权限后执行 |
| 通知消息 | 无 `id` 的消息返回 null，HTTP 202 |

### 5.3 HTTP 行为

- 只接受 `POST /mcp`。
- `GET`、`PUT` 等返回 405 和 `Allow: POST`。
- Origin 非空时必须与请求 Host 一致，否则返回 403。
- JSON-RPC 解析错误返回 HTTP 200 和 `-32700`。
- 认证错误返回 HTTP 401 和 `-32001`。
- 通知请求返回 HTTP 202。
- 批量请求返回响应数组；全部是通知时返回 202。

### 5.4 未实现的协议能力

- 不支持 GET/SSE 服务端推送。
- 不支持 `Mcp-Session-Id` 会话管理。
- 不支持 `resources`、`prompts`、`logging`、`sampling`、`elicitation`。
- 不提供 OAuth 发现、授权服务器或动态客户端注册。
- `tools/list` 没有分页游标，当前 28 个工具规模可以接受。
- 没有强制校验 `Accept`、`Content-Type` 和 `MCP-Protocol-Version` 请求头。

对于 Claude Desktop、Cline、Cherry Studio 这类支持自定义 URL 和 Header 的客户端，这套实现可以直接接入。对于只支持 SSE 或 OAuth 的托管客户端，需要额外适配。

---

## 6. 安全性评估

| 编号 | 级别 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| MCP-R01 | 高 | 管理员 Key 权限过大 | 一次工具调用可删除域名、吊销证书、删除 Tunnel | 默认发放只读 Key；写操作要求独立 Key 或二次确认 |
| MCP-R02 | 高 | 旧版明文 API Key | 无作用域、有效期、IP 白名单；密钥泄露后影响全部权限 | 复用 Pro `api_key` 表，哈希存储并绑定作用域、有效期、IP |
| MCP-R03 | 高 | 直接调用控制器 | 绕过请求级中间件、审计、幂等、限流、二次确认 | 使用 `app.inject()` 或共享服务层，保留请求级保护 |
| MCP-R04 | 高 | 破坏性操作无幂等 | 客户端超时重试会重复创建或重复执行 | 透传 `Idempotency-Key`，写操作按 Key 去重 |
| MCP-R05 | 中 | 长任务同步执行 | 证书申请、部署、优选任务可能超时；重试造成重复操作 | 改为异步任务，返回任务 ID，由客户端轮询 |
| MCP-R06 | 中 | 异常信息直接返回 | 可能泄露 SQL、路径、上游 API 响应 | 服务端记录详细错误，客户端返回通用错误码 |
| MCP-R07 | 中 | 没有 MCP 调用审计 | 无法追踪谁通过 AI 改了什么 | 记录工具、动作、Key、参数摘要、结果、耗时、IP |
| MCP-R08 | 中 | 没有速率限制 | 高频调用可能压垮上游 API 或数据库 | 按 API Key 和 IP 限流，限制并发与请求体大小 |
| MCP-R09 | 低 | `structuredContent` 可能是数组 | 部分严格客户端解析异常 | 统一包装为对象，文本内容保留完整 JSON |
| MCP-R10 | 低 | `serverInfo.version` 使用内部配置版本号（安装默认为 `1049`） | 客户端看到的版本与发布号 `2.22` 不一致 | 使用发布版本 `2.22` 或 Pro 版本号 |
| MCP-R11 | 低 | 工具参数不按 Schema 校验 | 错误类型依赖控制器兜底 | 在工具层做 JSON Schema 校验和友好错误 |
| MCP-R12 | 低 | `prefill` 在权限检查前读取记录 | 存在轻微存在性泄露 | 预填前先做权限判断，或只读取允许字段 |
| MCP-R13 | 低 | 无测试用例 | 协议边界和权限边界回归成本高 | 增加认证、工具列表、调用、批量、通知、错误路径测试 |
| MCP-R14 | 低 | Origin 同主机校验受反代影响 | 反代未正确传递 Host 时可能误拒 | 明确信任的代理头，补充部署文档 |

### 6.1 最需要关注的风险组合

风险最高的组合是 **管理员 Key + 破坏性动作 + 无审计**：

- 管理员 Key 能直接调用 `domain_manage(del)`、`cert_order_manage(revoke)`、`cf_tunnel_manage(delete)`。
- MCP 客户端只需构造一次 `tools/call`。
- 上游没有二次确认、没有 MCP 层审计、没有只读模式。

Pro 的 API Key 已经支持作用域和有效期，适合把 MCP 纳入现有凭据体系，并额外提供“只读 Key 给 AI 日常查询，写 Key 人工确认”的使用方式。

---

## 7. 与彩虹 DNS Pro 的差异

| 维度 | 上游 v2.22 | 彩虹 DNS Pro 1.35.10 |
| --- | --- | --- |
| 运行环境 | PHP 8 / ThinkPHP | Node.js / TypeScript / Fastify |
| 认证 | `Authorization: Bearer <uid>:<apikey>` | `Authorization: Bearer <JWT>` 或 `X-API-Key` |
| API Key 存储 | `user.apikey` 明文 | `api_key.key_hash` 哈希 |
| 作用域 | 无 | 模块 + read/write 作用域 |
| 有效期 | 无 | 支持 |
| IP 白名单 | 无 | 支持 |
| 审计 | 部分业务日志 | 统一审计钩子 |
| 幂等 | 无 | `Idempotency-Key` |
| 二次确认 | 无 | `X-Reauth-Token` |
| 异步任务 | 同步执行 | 任务与事件体系 |
| 调用方式 | 直接实例化控制器 | 路由 + 服务层 |
| MCP 实现 | 已有 | 已移植到 `backend/src/mcp/` |

### 7.1 上游工具到 Pro API 的映射

| 上游模块 | 上游工具 | Pro 对应接口 |
| --- | --- | --- |
| 概况 | `get_overview` | `GET /api/dashboard/summary` |
| 服务商 | `list_provider_types` | `GET /api/dns/providers`、`GET /api/cert/providers`、`GET /api/deploy/providers` |
| DNS 账户 | `dns_account_query`、`dns_account_manage` | `/api/dns/accounts` |
| 域名 | `domain_query`、`domain_manage`、`domain_category_manage` | `/api/domains`、`/api/domains/categories` |
| 解析记录 | `record_query`、`record_manage` | `/api/domains/:id/records` 及批量、状态、备注、权重接口 |
| 证书账户 | `cert_account_query`、`cert_account_manage` | `/api/cert/accounts`；部署账户使用 `?deploy=1` |
| 证书订单 | `cert_order_query`、`cert_order_manage` | `/api/cert/orders` |
| 证书部署 | `cert_deploy_query`、`cert_deploy_manage` | `/api/deploy/tasks` |
| CNAME 代理 | `cert_cname_query`、`cert_cname_manage` | `/api/cert/cnames` |
| Cloudflare 主机名 | `cf_hostname_query`、`cf_hostname_manage` | `/api/cloudflare/domains/:domainId/hostnames` |
| Cloudflare Tunnel | `cf_tunnel_query`、`cf_tunnel_manage` | `/api/cloudflare/accounts/:accountId/tunnels` |
| 容灾切换 | `dmonitor_query`、`dmonitor_manage` | `/api/dmonitor/*` |
| 优选 IP | `optimizeip_query`、`optimizeip_manage` | `/api/optimize/*` |
| 定时切换 | `schedule_query`、`schedule_manage` | `/api/schedule/*` |
| 操作日志 | `operation_log_query` | `/api/logs`、`/api/audit/logs` |

Pro 的接口路径和返回结构已经稳定，适合通过内部注入复用。工具层只需维护“工具动作到 HTTP 方法 + 路径 + 参数”的映射，不需要复制业务逻辑。

### 7.2 移植原则

1. **工具定义可复用**：保留模块分组、`query` / `manage` 命名、动作枚举和预填机制。
2. **认证必须替换**：使用 Pro 的 `X-API-Key`，按工具映射到 `dns`、`cert`、`deploy`、`cloudflare`、`monitor`、`schedule`、`optimize` 等作用域。
3. **调用走现有路由**：Node 后端使用 Fastify `app.inject()`，Workers 使用内部 dispatch/fetch，让鉴权、审计、幂等、限流继续生效。
4. **长任务异步化**：证书申请、部署执行、优选任务返回任务 ID，避免 HTTP 超时。
5. **错误统一脱敏**：工具层返回稳定错误码和简短说明，详细异常写入服务端日志。
6. **写操作显式授权**：默认只读 Key；写操作要求 `X-Reauth-Token`、写权限 Key 或 `MCP_ALLOW_WRITE=1`。
7. **补齐审计**：记录 `tool`、`action`、`api_key_id`、`uid`、参数摘要、结果、耗时、IP。
8. **补齐测试**：覆盖初始化、工具列表、工具调用、批量、通知、认证失败、未知工具、未知动作、权限不足和长任务。

---

## 8. 对 Cloudflare Workers 版的影响

Workers 版同样可以实现 `/mcp`，但需要关注运行时差异：

1. **无 Fastify**：需要复用 `worker.ts` 内部的路由分发函数，或者构造内部 `Request` 调用 fetch handler。
2. **长任务限制**：证书申请、部署、监控执行可能超过 Worker 请求时间，MCP 工具应写入任务表并立即返回任务 ID。
3. **D1 与 KV**：审计、幂等、任务状态写入 D1；短期幂等键可以使用 KV 或 D1。
4. **包体积**：28 个工具的 Schema 和描述约占几十 KB，对 Worker 包体积影响可控；工具定义可以按模块拆分。
5. **认证复用**：Workers 已有 API Key 作用域校验，MCP 入口可以复用同一套哈希校验与作用域判断。
6. **契约测试**：在 `workers/scripts/contract-check.mjs` 中增加 `/mcp` 路由、工具数量、认证失败和只读 Key 的断言。

---

## 9. 实施建议

### 9.1 分阶段落地

**第一阶段：MCP 核心与 DNS 主链路**

- `/mcp` 端点、JSON-RPC 分发、初始化、工具列表、工具调用、通知 202。
- 认证接入 Pro `X-API-Key`，支持只读与读写作用域。
- 首批工具：`get_overview`、`list_provider_types`、`domain_query`、`domain_manage`、`record_query`、`record_manage`。
- 接入审计、幂等、限流和错误脱敏。
- 覆盖普通用户与管理员两种权限视图。

**第二阶段：证书与自动化任务**

- 证书账户、证书订单、部署任务、CNAME 代理。
- 容灾切换、优选 IP、定时切换。
- 长任务改为异步执行，返回任务 ID。

**第三阶段：Cloudflare 与扩展**

- 自定义主机名、回退源、DCV、Tunnel、Token、CIDR 与主机名路由。
- 根据 Pro 的实际使用情况决定是否增加 CDN、备份、审计等工具。
- 评估 OAuth、SSE、`resources`、`prompts` 的兼容性需求。

### 9.2 安全基线

- 默认只读 Key，写 Key 单独创建并限制有效期。
- 破坏性动作要求 `X-Reauth-Token` 或写权限开关。
- 所有 MCP 调用写审计，包含工具、动作、Key、用户、IP、结果、耗时。
- 请求体大小、工具输出大小、分页数量设置上限。
- 异常信息脱敏，详细堆栈只写服务端日志。
- 按 Key 限流，限制并发写操作。
- 对批量请求中的每个动作单独做权限和审计。

### 9.3 验收清单

- `initialize` 返回支持的协议版本和 `tools` 能力。
- 不支持的方法返回 `-32601`。
- 未知工具返回 `-32602`。
- 未知动作返回 `isError=true` 的工具结果。
- 普通用户看不到管理员动作。
- 只读 Key 调用写工具返回 403。
- 无 Key、错误 Key、停用用户返回 401。
- 通知消息返回 202。
- 批量请求逐条返回结果。
- 写操作重复提交时按幂等键去重。
- 长任务立即返回任务 ID。
- 审计日志能按 `tool` 和 `action` 检索。
- 错误响应不包含 SQL、路径和上游原始错误。

---

## 10. 附录

### 10.1 工具清单

| 工具 | 动作 |
| --- | --- |
| `get_overview` | `stat` |
| `list_provider_types` | `query` |
| `dns_account_query` | `list` |
| `dns_account_manage` | `add`、`edit`、`del` |
| `domain_query` | `list`、`get`、`info`、`quickinfo`、`aliases`、`remote_list`、`categories` |
| `domain_manage` | `add`、`batch_add`、`edit`、`del`、`batch_del`、`batch_remark`、`batch_set_notice`、`refresh_expire`、`update_date`、`set_category`、`alias_add`、`alias_delete` |
| `domain_category_manage` | `add`、`edit`、`del` |
| `operation_log_query` | `list` |
| `record_query` | `list`、`subdomain`、`log`、`groups`、`check`、`weight_list` |
| `record_manage` | `add`、`update`、`delete`、`set_status`、`set_remark`、`batch`、`batch_edit`、`batch_add`、`edit_by_name`、`weight_status`、`weight_update` |
| `cert_account_query` | `list` |
| `cert_account_manage` | `add`、`edit`、`del` |
| `cert_order_query` | `list`、`get`、`show_log` |
| `cert_order_manage` | `add`、`edit`、`del`、`process`、`set_auto`、`reset`、`revoke`、`batch` |
| `cert_deploy_query` | `list`、`show_log` |
| `cert_deploy_manage` | `add`、`edit`、`del`、`set_active`、`reset`、`process`、`batch` |
| `cert_cname_query` | `list` |
| `cert_cname_manage` | `add`、`edit`、`del`、`check` |
| `cf_hostname_query` | `list`、`txt_targets`、`fallback_get`、`dcv_uuid` |
| `cf_hostname_manage` | `add`、`batch_add`、`update`、`batch_update`、`refresh`、`delete`、`batch_delete`、`fallback_set`、`fallback_delete` |
| `cf_tunnel_query` | `list`、`token`、`public_hostnames`、`cidr_routes`、`hostname_routes` |
| `cf_tunnel_manage` | `add`、`delete`、`public_hostname_save`、`public_hostname_delete`、`cidr_add`、`cidr_delete`、`hostname_route_add`、`hostname_route_delete` |
| `dmonitor_query` | `overview`、`list`、`info`、`logs` |
| `dmonitor_manage` | `add`、`edit`、`set_active`、`del`、`batch`、`clean_logs` |
| `optimizeip_query` | `list`、`api_balance` |
| `optimizeip_manage` | `add`、`edit`、`set_active`、`del`、`run` |
| `schedule_query` | `list` |
| `schedule_manage` | `add`、`edit`、`set_active`、`del`、`batch` |

### 10.2 关键实现文件

```text
app/controller/Mcp.php
app/middleware/AuthMcp.php
app/lib/mcp/McpServer.php
app/lib/mcp/McpException.php
app/lib/mcp/ToolRegistry.php
app/lib/mcp/ControllerInvoker.php
app/lib/mcp/tools/domain.php
app/lib/mcp/tools/record.php
app/lib/mcp/tools/cert.php
app/lib/mcp/tools/cloudflare.php
app/lib/mcp/tools/task.php
route/app.php
app/view/user/user.html
README.md
```

### 10.3 观察到的实现细节

- `ToolRegistry` 通过 `glob(tools/*.php)` 自动加载工具，新增模块只需增加文件。
- `availableActions()` 在生成 Schema 时过滤动作，`tools/list` 不暴露不可用动作。
- 多动作工具自动注入 `action` 枚举；单动作工具可以省略 `action`。
- `prefill()` 在编辑时从数据库补全未传字段，`config` 对象会与旧值合并。
- `normalizeRecords()` 要求批量记录必须包含 `RecordId`，并使用默认值补齐其他字段。
- `ControllerInvoker` 把布尔转 `0/1`、数字转字符串、移除 `null`，与 PHP 表单提交格式对齐。
- `ControllerInvoker` 设置 `X-Requested-With: XMLHttpRequest`，让控制器返回 JSON。
- `ControllerInvoker::result()` 同时返回 `content.text` 和 `structuredContent`，兼容文本型和结构化客户端。
- `McpServer` 支持批量请求和通知，通知不产生响应。
- `AuthMcp` 使用 `hash_equals` 比较密钥，认证比较是常量时间。


---

## 11. Pro 版移植落地（2026-11-25）

已按本报告第一阶段到第三阶段一次性落地服务器版：

- 新增 `/mcp` JSON-RPC 2.0 端点，支持 `initialize`、`ping`、`tools/list`、`tools/call`、批量请求、通知 202、Origin 校验、405/401/429 和解析错误处理。
- 工具契约与上游 v2.22 对齐：28 个工具、124 个动作；普通用户 6 个工具、27 个动作，`domain_manage` 仅保留 `update_date`、`alias_add`、`alias_delete`。
- 认证同时支持 `X-API-Key`、`Authorization: Bearer <API Key>` 和兼容旧版的 `Authorization: Bearer <uid>:<apikey>`；API Key 继续执行作用域、有效期与 IP 白名单校验。
- 工具执行通过 Fastify `app.inject()` 调用现有 `/api/*`，保留路由级权限、审计、幂等和限流；MCP 层额外记录工具、动作、Key、用户、IP 与参数摘要。
- 证书私钥、PFX、长任务等行为按 Pro 安全模型调整：API Key 读取私钥仍要求登录密码确认；旧版 `uid:apikey` 保持上游行为。
- 前端“偏好设置 → MCP 接口”展示端点和两种客户端配置模板；README 补充接口说明。
- 新增 `backend/scripts/check-mcp.ts` 与 `npm run check:mcp`，并接入 CI，断言工具数量、动作数量、权限视图和 JSON-RPC 边界。

验证结果：后端 `tsc --noEmit`、`check:mcp`、`check:sqlite`、`check:backup` 通过；前端 `vue-tsc --noEmit`、`check:i18n`、`check:format`、`vite build` 通过。


---

## 12. 第二轮对齐核验（2026-11-25）

核验范围：`/tmp/opencode/upstream/src` 的 `app/lib/mcp/*`、`app/controller/{Domain,Cert,Cloudflare,Dmonitor,Optimizeip,Schedule,Index,User}.php` 与 Pro 版 `backend/src/mcp/*`、`backend/src/routes/{mcp,domain,cert,dmonitor,optimizeip,schedule}.ts`。

结论：28 个工具名、124 个动作名、动作 level、工具级 `required`、动作级参数名与枚举均已逐项一致；差异集中在 Pro 的安全模型、响应附加字段和少数批量/长任务实现。

本轮已修正：

- 域名批量备注、批量设置分类改为单条批量 SQL，空备注按上游语义清空；`refresh_expire` 改为上游的 `checkstatus=0` 异步刷新，不再逐域名同步查询。
- 域名分类新增/编辑支持 `sort`、重名校验；删除分类在 MCP 层保留“分类下有域名时拒绝删除”。
- `record_query.subdomain` 过滤 `@` 下的 NS/SOA；`record_query.groups` 为 DNSPod 补“全部记录”；`record_manage.edit_by_name` 增加 A/AAAA/CNAME 回退、默认线路优先及 TTL/MX 覆盖。
- 解析记录默认线路改为按服务商映射（阿里云 default、DNSPod 0、华为 default_view 等），修正批量添加时 `proxy` 被错误应用为所有服务商线路 1 的问题。
- 证书/部署/CNAME 列表补齐 `sortName`/`sortOrder`，部署任务列表补齐 `aid`、`type`、`domain`、`remark` 服务端筛选与 `certtypename` 等字段；CNAME 列表补齐 `kw` 服务端筛选。
- `cert_order_query.show_log`、`cert_deploy_query.show_log` 改为优先使用 `processid`；CNAME 编辑补齐目标域名权限、重复校验，并且仅在 `rr`/`did` 变化时重置状态。
- `cert_order_manage.add` 通过 `defer=1` 保持上游“先添加、后 process”语义；上传证书编辑保留原 `isauto`。
- `dmonitor_manage` 恢复 `type=0`（仅监控）支持；`dmonitor_query.overview` 补 `swoole` 字段。
- 配置合并改为保留未传入字段，修复 MCP 只传部分字段或 `{}` 编辑账户时丢失非敏感配置的问题。
- MCP 响应移除 Pro 路由的 `requestId` 追踪字段。

仍保留的已知差异（均为 Pro 安全/产品模型，不改变上游工具契约）：

- API Key 模式读取证书私钥仍要求 `X-Confirm-Password`；旧版 `uid:apikey` 模式与上游一致。
- 账户列表返回掩码后的 `config`，上游返回明文；部署/证书任务长操作沿用 Pro 的同步路由与后台任务机制。
- 删除域名/批量删除域名时，Pro 会阻止仍被证书订单引用的域名；上游直接删除。
- `domain_manage.batch_add` 逐个调用 Pro 接入接口，以便继续执行云账户校验和权限清理；上游使用 `insertAll`，部分失败时的汇总消息不同。
- Pro 响应可能额外包含 `code`、`stats`、`status_label`、`_access`、`config_state` 等字段；上游同类接口大多只返回 `{total,rows}` 或 `{code,data}`。
- `mergeMaskedConfig` 的“未传字段沿用原值”语义同时影响 Pro 原生编辑接口，属于修复而非 MCP 专属行为。
