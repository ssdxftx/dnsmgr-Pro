# MCP 全模块覆盖与越权核验报告（已修复）

- 报告日期：2026-11-25
- 修复完成：2026-11-25
- 代码版本：彩虹 DNS Pro `1.35.11`
- 核验对象：`backend/src/mcp/*`、`backend/src/routes/*`、`backend/src/lib/apiKeys.ts`、`frontend/src/views/*`、`frontend/src/components/cdn/*`
- 核验方式：源码逐项核对、请求规格比对、`tools/list` 数量比对、运行期 MCP 调用、后端检查脚本
- 当前状态：本轮发现的 P0/P1/P2 问题已全部修复；管理员 69 个工具、452 个动作，普通用户 27 个工具、149 个动作

---

## 0. 修复状态

| 优先级 | 问题 | 状态 |
|---|---|---|
| P0 | `audit_query.action` 字段冲突 | 已完成 |
| P0 | 4 个动作缺少 `scope` | 已完成 |
| P0 | `checkActionScope()` 对缺少 scope 的动作 fail-open | 已完成 |
| P0 | `check:mcp` 依赖 Schema 计数，缺少作用域断言 | 已完成 |
| P1 | `schedule_manage.run` 未实现 | 已完成 |
| P1 | `optimizeip_manage.save_settings` 未实现 | 已完成 |
| P1 | `optimizeip_manage.query_api` 未实现 | 已完成 |
| P1 | `dmonitor_manage.run` 未实现 | 已完成 |
| P1 | 5 个只读动作声明与实际 POST 不一致 | 已完成 |
| P1 | `user_manage` 敏感动作缺少确认参数 | 已完成 |
| P2 | 系统级统计未按用户过滤 | 已完成 |
| P2 | CDN 推理、转码、日志、配额、域名存在性缺少 MCP 入口 | 已完成 |
| P2 | 证书/部署批量处理、系统代理测试、Cron Key、检查更新缺少 MCP 入口 | 已完成 |

验证结果：

```text
MCP 自检通过：管理员 69 个工具 / 452 个动作，普通用户 27 个工具 / 149 个动作
```

```bash
cd backend
npx tsc --noEmit
npm run check:mcp
npm run check:sqlite
npm run check:backup
npm run check:audit
```

以上检查全部通过。

---

## 1. 结论摘要

| 维度 | 结论 |
|---|---|
| 模块级覆盖 | 19 个 API Key 模块均已有查询或管理入口 |
| 端点级覆盖 | 本轮列出的业务缺口已补齐；其余未映射路径以有意排除、兼容路由和内部路由为主 |
| 动作总数 | 源码与 `tools/list` 均为 452 个；普通用户 149 个 |
| API Key 作用域 | 452 个动作全部声明 `scope`；缺少 scope 时 fail-closed |
| 越权 | 未发现跨用户 IDOR、普通用户提权或 API Key 越级写操作 |
| 旧版 Bearer 模式 | 天然不受模块 `scope` 限制，按设计使用用户全权凭据 |
| 写法一致性 | `audit_query` 筛选字段已改名；5 个只读 POST 动作已对齐 `write` 语义 |
| 检查脚本 | 按 ActionDef 统计；增加 scope 全覆盖、保留字段和已知 POST/read 对齐断言 |

---

## 2. 核验与修复范围

### 2.1 源码范围

- 工具注册与 JSON-RPC 分发：`backend/src/mcp/server.ts`、`registry.ts`
- 动作执行与作用域校验：`backend/src/mcp/invoker.ts`
- 用户等级与 API Key 上下文：`backend/src/mcp/auth.ts`
- 路由级 API Key 校验：`backend/src/index.ts`
- 各模块路由的账户、域名、证书归属校验
- 工具文件中的 `scope`、`level`、`request`、`handler`、`before`、`after`

### 2.2 修复方式

- 保留 `*_query`（只读）与 `*_manage`（写操作/长任务）分离。
- 新增写动作使用 `scope.write=true`，并要求对应模块写作用域。
- 新增长任务动作复用现有路由的异步任务、限流、审计和归属校验。
- 不修改 `/api/*` 业务逻辑，沿用路由级权限、审计、限流和二次确认。

### 2.3 运行期验证环境

```bash
cd backend
PORT=18082 DNSMGR_DATA_DIR=/tmp/opencode/mcpdata npm run dev
```

使用管理员 Key、`dns:read` Key 和普通用户上下文调用 MCP。

---

## 3. 覆盖结果

### 3.1 模块级覆盖

| 模块 | 查询入口 | 管理入口 | 结论 |
|---|---|---|---|
| dns | `dns_account_query`、`domain_query`、`record_query`、`operation_log_query` | `dns_account_manage`、`domain_manage`、`domain_category_manage`、`record_manage` | 完整 |
| cert | `cert_account_query`、`cert_order_query`、`cert_cname_query`、`cert_settings_query` | `cert_account_manage`、`cert_order_manage`、`cert_cname_manage`、`cert_settings_manage` | 完整，含批量推进 |
| cloudflare | `cf_hostname_query`、`cf_tunnel_query`、`cf_rules_query` | `cf_hostname_manage`、`cf_tunnel_manage`、`cf_rules_manage` | 完整 |
| monitor | `dmonitor_query` | `dmonitor_manage` | 完整，含立即检测 |
| deploy | `cert_deploy_query` | `cert_deploy_manage` | 完整，含批量执行 |
| optimize | `optimizeip_query` | `optimizeip_manage` | 完整，含设置保存和积分查询 |
| schedule | `schedule_query` | `schedule_manage` | 完整，含立即执行 |
| cdn | `cdn_*_query` | `cdn_*_manage` | 完整，含推理、转码、日志、配额 |
| dnscheck | `dnscheck_query` | `dnscheck_manage` | 完整 |
| expire | `expire_query` | `expire_manage` | 完整 |
| backup | `backup_query` | `backup_manage` | 完整，恢复/导入按设计排除 |
| vault | `vault_query` | 无 | 保护方式修改按设计排除 |
| users | `user_query`、`operation_log_query` | `user_manage` | 完整，敏感动作支持确认密码；API Key 写用户按设计拒绝 |
| system | `system_query`、`announcement_query` | `system_manage`、`announcement_manage` | 完整，含代理测试、Cron Key、检查更新 |
| audit | `audit_query` | 无 | 完整，筛选字段冲突已修复 |
| jobs | `job_query` | 无 | 完整 |
| events | `event_query` | `event_manage` | 完整 |
| general | `get_overview`、`list_provider_types` | 无 | 完整，已补作用域 |
| auth / apikeys | 无 | 无 | 按设计排除 |

### 3.2 已补齐的端点级能力

#### CDN 推理与媒体

| 能力 | MCP 动作 | 状态 |
|---|---|---|
| 推理服务列表 | `cdn_zone_query.inference_services` | 已完成 |
| 推理部署记录 | `cdn_zone_query.inference_records` | 已完成 |
| 推理部署日志 | `cdn_zone_query.inference_logs` | 已完成 |
| 推理监控 | `cdn_zone_query.inference_monitor` | 已完成 |
| 推理 Token 列表 | `cdn_zone_query.inference_tokens` | 已完成 |
| 推理域名列表 | `cdn_zone_query.inference_domains` | 已完成 |
| 推理硬件规格 | `cdn_zone_query.inference_hardware` | 已完成 |
| 推理服务创建/修改/操作 | `cdn_zone_manage.inference_service_add/edit/operate` | 已完成 |
| 推理 Token 创建/删除 | `cdn_zone_manage.inference_token_add/del` | 已完成 |
| 推理域名创建/操作 | `cdn_zone_manage.inference_domain_add/operate` | 已完成 |
| 即时转码模板列表 | `cdn_zone_query.transcode_templates` | 已完成 |
| 即时转码模板创建/删除 | `cdn_zone_manage.transcode_add/del` | 已完成 |

#### CDN 日志与配额

| 能力 | MCP 动作 | 状态 |
|---|---|---|
| 实时日志任务列表 | `cdn_zone_query.realtime_logs` | 已完成 |
| 实时日志创建/修改/删除 | `cdn_zone_manage.realtime_log_add/edit/del` | 已完成 |
| 七层离线日志 | `cdn_zone_query.offline_l7` | 已完成 |
| 四层离线日志 | `cdn_zone_query.offline_l4` | 已完成 |
| 内容配额 | `cdn_zone_query.quota_content` | 已完成 |
| 刷新配额 | `cdn_zone_query.quota_purge` | 已完成 |
| 加速域名存在性检查 | `cdn_zone_query.domain_exists` | 已完成 |

#### 其他模块

| 能力 | MCP 动作 | 状态 |
|---|---|---|
| 定时切换立即执行 | `schedule_manage.run` | 已完成 |
| 优选IP设置保存 | `optimizeip_manage.save_settings` | 已完成 |
| 优选IP积分查询 | `optimizeip_manage.query_api` | 已完成 |
| 容灾立即检测 | `dmonitor_manage.run` | 已完成 |
| 证书批量推进 | `cert_order_manage.batch_process` | 已完成 |
| 部署批量执行 | `cert_deploy_manage.batch_process` | 已完成 |
| 系统代理测试 | `system_manage.proxytest` | 已完成 |
| 系统 Cron Key | `system_query.cronkey` | 已完成 |
| 检查更新 | `system_query.check_update` | 已完成 |

### 3.3 有意排除的端点

以下端点保留 HTTP/UI，不纳入 MCP 符合现有安全设计：

- 登录、登出、TOTP、改密：`backend/src/routes/auth.ts`
- API Key 创建、轮换、吊销：`backend/src/routes/apiKeys.ts`
- 初始安装、注册：`backend/src/routes/setup.ts`、`register.ts`
- QQ 机器人入站 webhook：`backend/src/routes/qqbot.ts`
- 保险库初始化、改口令、恢复、销毁：`backend/src/routes/vault.ts`
- 备份恢复、导入、下载：`backend/src/routes/backup.ts`
- 审计 CSV 导出：`backend/src/routes/audit.ts`
- 指标与健康检查：`backend/src/routes/observability.ts`
- 旧版 `/api/domain`、`/api/record/*` 兼容接口

---

## 4. 已修复问题

### 4.1 `audit_query.action` 字段冲突（P0，已修复）

原问题：

- 工具属性中定义了 `action` 筛选字段。
- `buildSchema()` 先写入动作选择枚举，随后被工具属性覆盖。
- `registry.call()` 调用前删除 `action`，筛选值无法传给路由。
- 结果：动作过滤失效，Schema 缺少动作枚举，计数少 1。

修复内容：

- 筛选字段改名为 `log_action`。
- 请求映射为 `query.action = args.log_action`。
- `check:mcp` 增加保留字段冲突断言，禁止工具属性使用 `action`。

修复结果：

- `audit_query` Schema 正确返回 `logs`、`stats` 两个动作。
- 审计日志筛选条件可以正常传递。
- 管理员与普通用户动作计数不再出现 1 个偏差。

### 4.2 4 个动作缺少作用域（P0，已修复）

原问题：

- `get_overview.stat`、`list_provider_types.query`、`dns_account_query.list`、`cert_account_query.list` 没有 `scope`。
- `checkActionScope()` 在 `!action.scope` 时直接放行。
- `dns:read` Key 可在运行期读取系统统计。

修复内容：

- `get_overview.stat`、`list_provider_types.query` 补 `general`。
- `dns_account_query.list` 补 `dns`。
- `cert_account_query.list` 补 `cert`。
- `checkActionScope()` 改为 fail-closed，API Key 模式下缺少 scope 直接拒绝。

修复结果：

- 452 个动作全部声明 `scope`。
- `dns:read` Key 调用 `get_overview.stat` 返回 `API Key 缺少该操作所需的作用域`。
- `check:mcp` 遍历全部工具定义，断言每个 action 都有 `scope`。

### 4.3 5 个只读动作声明与实际 POST 不一致（P1，已修复）

| 动作 | 修复后 scope |
|---|---|
| `cf_hostname_query.txt_targets` | `cloudflare:write` |
| `cdn_edge_query.kv_get` | `cdn:write` |
| `cdn_billing_query.data` | `cdn:write` |
| `record_query.check` | `dns:write` |
| `optimizeip_query.api_balance` | `optimize:write` |

修复结果：

- MCP 层作用域判断与路由真实 HTTP 方法一致。
- 只读 Key 不再看到“MCP 层允许、路由层拒绝”的必然失败路径。
- `check:mcp` 对以上 5 个动作增加 `scope.write=true` 断言。

### 4.4 `user_manage` 敏感动作缺少确认参数（P1，已修复）

修复内容：

- 新增 `confirm_password` 和兼容字段 `login_password`。
- 创建管理员、启用旧版全权 Key、修改等级、改密、封禁、删除时传入对应路由字段。
- 仍保留 `X-Confirm-Password-B64`、`X-Reauth-Token` 请求头转发。
- API Key 写用户请求继续由 `apiKeyWriteBlocked()` 按设计拒绝。

修复结果：

- 旧版 Bearer 模式可以通过 MCP 完成需要登录密码确认的用户管理动作。
- 路由层的超级管理员、目标等级、确认密码校验保持不变。

### 4.5 系统级统计未按用户过滤（P2，已修复）

修复内容：

- 非管理员的 `dmtask`、`optimizeip` 统计按域名账户可见性过滤。
- 非管理员的 `cert_order`、`cert_deploy` 统计按证书账户 `visibility='private'` 和 `owner_uid` 过滤。
- 管理员保留全局统计，并继续包含 `aid=0` 的手工上传证书订单。

修复结果：

- 普通用户只看到自己有权访问的任务、证书和部署计数。
- 聚合数据不再暴露全站任务总量。

### 4.6 检查脚本硬编码计数（P2，已修复）

修复内容：

- 新增 `allToolDefs` 与 `definitionCount()`，直接按 ActionDef 统计动作数。
- 断言管理员 69 个工具、452 个动作；普通用户 27 个工具、149 个动作。
- 断言所有工具属性不能使用保留名 `action`。
- 断言所有 action 必须声明 `scope`。
- 断言 5 个已知 POST/read 动作必须 `scope.write=true`。
- 保留 `checkActionScope()` 对无 scope 动作抛错的测试。

修复结果：

```text
MCP 自检通过：管理员 69 个工具 / 452 个动作，普通用户 27 个工具 / 149 个动作
```

---

## 5. 越权与安全边界

### 5.1 已确认有效的防线

| 防线 | 位置 | 结论 |
|---|---|---|
| 用户等级 | `backend/src/mcp/registry.ts` | 普通用户调用 level 2 动作返回“无权限” |
| MCP 作用域 | `backend/src/mcp/invoker.ts` | 按模块和读写校验；缺少 scope 时 fail-closed |
| 路由作用域 | `backend/src/index.ts` | 注入的 `X-API-Key` 再按真实方法校验 |
| 账户可见性 | `backend/src/routes/cdn.ts` | 私有账户仅所有者可见 |
| 域名权限 | `backend/src/routes/domain.ts` 的 `getDomainWithAccount`、`matchPermission` | 记录与域名操作按授权子域名校验 |
| 证书/部署归属 | `canAccessCertOrder`、`canAccessDeployTask` | 订单与任务按账户可见性校验 |
| 用户管理 | `backend/src/routes/user.ts`、`adminManageBlocked`、`superBlocked` | API Key 禁止写用户；普通管理员不能管理其他管理员 |
| ESA 通用入口 | `backend/src/routes/cdn.ts` | 仅管理员、Action 必须命中官方目录、账户归属校验 |
| 路径构造 | `backend/src/mcp/tools/*` | 请求路径使用 `Number()` 或 `encodeURIComponent()`，未发现原始参数拼接 |

### 5.2 未发现的问题

- 未发现普通用户通过 `tools/call` 调用 level 2 动作成功的路径。
- 未发现只读 API Key 成功执行写路由的路径。
- 未发现通过 `aid`、`domain_id`、`recordid` 读取或修改他人私有账户资源的路径。
- 未发现 `cdn_esa_api` 绕过 Action 白名单或账户归属的路径。
- 未发现 `scope` 路径可被用户输入穿越的情况。

### 5.3 保留风险

| 风险 | 等级 | 说明 |
|---|---|---|
| 旧版 Bearer 模式绕过模块 scope | 设计风险 | 旧版 apikey 是用户全权凭据；如需受限权限，应使用 API Key 模式 |
| `user_manage` 写操作仅旧版 Bearer 可用 | 设计限制 | API Key 写用户继续被路由拒绝；敏感动作仍需登录密码确认 |
| CDN 推理/转码/日志依赖服务商能力 | 功能限制 | 动作已接入；账户或服务商不支持时返回明确错误 |
| 系统 Cron Key 可读 | 运维风险 | 仅管理员 `system:read` 可查，用于外部 Cron 配置 |

---

## 6. 运行期验证记录

| 场景 | 结果 |
|---|---|
| 管理员 `tools/list` | 69 个工具、452 个动作 |
| 普通用户 `tools/list` | 27 个工具、149 个动作 |
| 普通用户调用 `user_query.list` | `无权限` |
| 普通用户调用 `cdn_rule_manage.add` | `无权限` |
| `dns:read` Key 调用 `record_manage.add` | `API Key 缺少该操作所需的作用域` |
| `dns:read` Key 调用 `get_overview.stat` | `API Key 缺少该操作所需的作用域`，原作用域绕过已关闭 |
| `dns:read` Key 调用 `cert_account_query.list` | `API Key 缺少该操作所需的作用域` |
| 管理员调用 `schedule_manage.run`（不存在ID） | `切换策略不存在`，动作已接入 |
| 管理员调用 `dmonitor_manage.run`（不存在ID） | `任务不存在`，动作已接入 |
| 管理员调用 `optimizeip_manage.save_settings`（非法间隔） | `自动更新时间间隔需为 10-10080 分钟之间的整数`，动作已接入 |
| `audit_query` Schema | 包含 `logs`、`stats` 枚举和 `log_action` 筛选字段 |
| `cdn_zone_query` Schema | 包含推理、转码、实时日志、离线日志、配额、域名存在性动作 |
| `user_manage` Schema | 包含 `confirm_password` 和 `login_password` |
| 后端日志 | 未出现 `[mcp] 工具执行异常` 或内部 500 |

---

## 7. 完成清单

### P0

- [x] 重命名 `audit_query` 筛选字段为 `log_action`
- [x] 恢复 `audit_query` 动作枚举和筛选功能
- [x] 给 4 个动作补 `scope`
- [x] 将 `checkActionScope()` 改为 fail-closed
- [x] 按 ActionDef 统计动作数
- [x] 增加 scope 全覆盖、保留字段和已知 POST/read 对齐断言

### P1

- [x] 增加 `schedule_manage.run`
- [x] 增加 `optimizeip_manage.save_settings`
- [x] 增加 `optimizeip_manage.query_api`
- [x] 增加 `dmonitor_manage.run`
- [x] 增加证书订单批量推进
- [x] 增加部署任务批量执行
- [x] 统一 5 个只读 POST 动作的 `scope.write`
- [x] 为 `user_manage` 增加确认密码参数

### P2

- [x] 增加 CDN 推理服务查询与管理
- [x] 增加 CDN 推理 Token 和域名管理
- [x] 增加 CDN 媒体转码模板查询与管理
- [x] 增加 CDN 实时日志和离线日志查询与管理
- [x] 增加 CDN 配额查询和域名存在性检查
- [x] 增加系统代理测试
- [x] 增加系统 Cron Key 查询
- [x] 增加检查更新动作
- [x] 系统统计按用户可见性过滤
- [x] 同步文档计数与完成状态

### 验证

- [x] 后端 `npx tsc --noEmit`
- [x] `npm run check:mcp`
- [x] `npm run check:sqlite`
- [x] `npm run check:backup`
- [x] `npm run check:audit`
- [x] 运行期 MCP 调用验证

---

## 8. 最终结论

MCP 现已覆盖全部 19 个 API Key 模块，管理员可用 69 个工具、452 个动作，普通用户可用 27 个工具、149 个动作。

本轮核验列出的作用域绕过、Schema 冲突、只读 POST 声明不一致、用户管理确认参数缺失、系统统计未过滤和 CDN 长尾能力缺口均已修复。

等级、作用域、路由权限、账户归属四层校验仍然有效，未发现跨用户提权或 IDOR。剩余风险集中在旧版 Bearer 全权凭据设计、API Key 写用户限制，以及 CDN 服务商自身能力差异。
