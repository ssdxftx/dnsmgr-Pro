# Requirements Document

Feature Name: cloudflare-rules-engine
Updated: 2026-09-30

## Introduction

将 [cf-manager](https://github.com/hefy2027/cf-manager) 的 **Cloudflare 规则引擎**（基于 Cloudflare Rulesets API，按 phase 管理规则）移植进彩虹 DNS Pro 的 CDN 管理模块。仅移植规则引擎，不移植隧道、自定义主机名、DNS 记录、Workers、存储、AI 等其他能力。

凭证策略：优先复用本系统已保存的 Cloudflare **DNS 账户密钥**；当该密钥不具备规则引擎所需权限时，在规则引擎页面引导管理员填写**专用 Cloudflare 凭证**，经校验后加密保存并绑定到对应 Cloudflare 账户，后续优先使用该专用凭证。全部接口仅管理员可用，UI 与现有项目保持一致。

## Glossary

- **规则引擎 / Rules Engine**：Cloudflare Ruleset Engine，按 phase 组织的规则集合。
- **Phase**：规则集阶段，本需求覆盖 8 类：回源、重定向、URL 重写、请求头转换、响应头转换、缓存设置、防火墙、速率限制。
- **站点级作用域**：以 `zone_id` 定位的 ruleset，kind 为 `zone`。
- **账户级作用域**：以 `account_id` 定位的 ruleset，kind 为 `root`。
- **DNS 账户密钥**：本系统 `account` 表中 Cloudflare 类型账户已保存的凭证（`email` / `apikey` / `auth`）。
- **专用凭证**：管理员在规则引擎页面单独填写、经校验后加密保存的 Cloudflare 凭证。
- **表达式**：Cloudflare Rules 过滤表达式，用于匹配请求。
- **Account ID**：Cloudflare 账户 ID，账户级 phase 与账户级 API 调用必需。

## Requirements

### Requirement 1：规则引擎入口与访问控制

**User Story:** AS 管理员，I want 在 CDN 管理下访问 Cloudflare 规则引擎，so that 集中管理 Cloudflare 规则。

#### Acceptance Criteria

1. The system SHALL 在侧栏「CDN 管理」分组内提供「CF 规则引擎」菜单项，该菜单项仅对 `level >= 2` 的管理员可见。
2. The system SHALL 对规则引擎全部 `/api/cf-rules/*` 接口执行管理员校验。
3. WHEN 管理员进入规则引擎页面，the system SHALL 展示本系统登记的 Cloudflare 域名（包含域名名、所属账户、Zone ID）。
4. WHEN 管理员选定域名与规则类型，the system SHALL 展示该作用域下该 phase 的规则列表。

### Requirement 2：复用 DNS 账户密钥

**User Story:** AS 管理员，I want 规则引擎优先使用已保存的 Cloudflare DNS 账户密钥，so that 无需重复填写凭证。

#### Acceptance Criteria

1. WHEN 管理员对某 Cloudflare 域名执行规则读取或写入，the system SHALL 默认使用该域名所属 Cloudflare 账户已保存的 DNS 凭证调用 Rulesets API。
2. WHILE 使用 DNS 账户凭证，the system SHALL 按目标 phase 所需权限向 Cloudflare 发起请求。
3. IF DNS 账户凭证权限不足（Cloudflare 返回 403 或权限类错误），the system SHALL 返回明确中文提示并在响应中标记该账户需要专用凭证。

### Requirement 3：专用凭证降级

**User Story:** AS 管理员，I want 在 DNS 密钥权限不足时填写专用 Cloudflare 凭证，so that 仍可管理规则。

#### Acceptance Criteria

1. WHEN 规则引擎接口或页面收到「需要专用凭证」标记，the system SHALL 展示专用凭证表单，支持「API 令牌」与「全局 API Key + 邮箱」两种认证方式。
2. WHEN 管理员提交专用凭证，the system SHALL 先调用 Cloudflare API 校验凭证有效性与所需权限，校验通过后再保存。
3. IF 专用凭证校验失败，the system SHALL 返回失败原因，并保持该账户原有凭证不变。
4. The system SHALL 以 `lib/secret.ts` 的 AES-256-GCM 加密存储专用凭证，返回给前端时对密钥字段掩码。
5. WHEN 某 Cloudflare 账户已保存专用凭证，the system SHALL 优先使用该专用凭证调用 Rulesets API。
6. WHEN 管理员移除某账户的专用凭证，the system SHALL 恢复使用该账户的 DNS 账户密钥。

### Requirement 4：规则的读取

**User Story:** AS 管理员，I want 查看指定 phase 下的规则，so that 了解当前配置。

#### Acceptance Criteria

1. WHEN 请求规则列表，the system SHALL 按作用域定位目标 phase 的 ruleset。
2. IF 目标 phase 尚无 ruleset，the system SHALL 返回空列表且在读取阶段不产生写入。
3. The system SHALL 对每条规则返回 `id`、`description`、`expression`、`action`、`action_parameters`、`enabled`。

### Requirement 5：规则的新增与编辑

**User Story:** AS 管理员，I want 增改规则，so that 配置 Cloudflare 边缘行为。

#### Acceptance Criteria

1. WHEN 管理员提交规则，the system SHALL 校验表达式非空后调用 Rulesets API 创建或更新规则；IF phase 对应 ruleset 不存在，the system SHALL 先创建空 ruleset 再写入规则。
2. The system SHALL 为 8 类 phase 提供结构化表单字段：回源端口、重定向地址与状态码、重写路径/查询、请求头/响应头 set/add/remove、缓存开关与 TTL、速率限制动作/维度/周期/阈值/缓解时长、防火墙阻断。
3. WHERE 高级 JSON 模式开启，the system SHALL 使用管理员提供的 `action` 与 `action_parameters` 原始 JSON。
4. WHEN 管理员删除规则，the system SHALL 调用 Rulesets API 删除对应规则。

### Requirement 6：表达式构建

**User Story:** AS 管理员，I want 可视化生成匹配表达式，so that 不必手写 Cloudflare 表达式。

#### Acceptance Criteria

1. The system SHALL 支持匹配类型：hostname、pathPrefix、pathRegex、hostAndPath、custom。
2. WHEN 匹配类型为 hostname，the system SHALL 生成 `(http.host eq "<主机名>")`。
3. WHEN 匹配类型为 pathPrefix，the system SHALL 生成 `(http.request.uri.path matches "^<值>.*")`。
4. WHEN 匹配类型为 pathRegex，the system SHALL 生成 `(http.request.uri.path matches "<值>")`。
5. WHEN 匹配类型为 hostAndPath，the system SHALL 生成 hostname 与 pathPrefix 条件以 `and` 组合的表达式。
6. WHEN 匹配类型为 custom，the system SHALL 原样使用管理员输入的表达式。
7. The system SHALL 在表单中实时预览将要提交的表达式。

### Requirement 7：账户级 phase 处理

**User Story:** AS 管理员，I want 账户级规则正确写入，so that 账户级 phase 可用。

#### Acceptance Criteria

1. WHERE 目标 phase 为账户级，the system SHALL 使用该 Cloudflare 账户的 Account ID 在账户作用域（kind=`root`）调用 Rulesets API。
2. WHEN 账户级 phase 缺少 Account ID，the system SHALL 优先从账户配置读取，其次通过 Cloudflare API 解析。
3. IF 仍无法确定 Account ID，the system SHALL 提示管理员补充。

### Requirement 8：UI 一致性

**User Story:** AS 管理员，I want 新模块与现有界面风格统一，so that 使用体验一致。

#### Acceptance Criteria

1. The system SHALL 复用现有 `PageHeader`、`n-card`、`ResponsiveDataTable`、`n-modal`(preset card) 与 `n-form` 组件与既有页面风格。
2. The system SHALL 遵循项目 `{ code, msg, data }` 返回约定，并使用中文文案。
3. The system SHALL 在移动端沿用现有响应式表格行为。

### Requirement 9：错误与权限提示

**User Story:** AS 管理员，I want 清晰的错误提示，so that 能自助定位权限或配置问题。

#### Acceptance Criteria

1. WHEN Cloudflare 返回 401，the system SHALL 提示凭证无效或过期。
2. WHEN Cloudflare 返回 403，the system SHALL 提示权限不足并给出所需权限名称。
3. WHEN Cloudflare 返回 429，the system SHALL 提示请求过于频繁并建议稍后重试。
4. WHEN Cloudflare 返回 5xx 或网络错误，the system SHALL 提示服务暂不可用。
5. The system SHALL 在错误响应中避免回传堆栈或凭证明文。