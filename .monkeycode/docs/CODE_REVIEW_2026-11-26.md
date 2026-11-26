# 彩虹 DNS Pro 全量代码审查报告

- 报告日期：2026-11-26
- 审查基线：`ae11614`（v1.36.0）及当前工作区未提交改动
- 审查范围：`backend/src`、`frontend/src`、`backend/scripts`、`frontend/scripts`、`scripts`、Docker/Compose、CI 配置、未纳入 Git 的 `workers/`
- 审查方式：静态代码审查、跨模块调用链核对、关键路径手工推演、现有自检脚本验证
- 审查结论：核心认证与权限骨架较完整；风险集中在 MCP 兼容认证、证书/CDN 联动、备份目的地、敏感操作二次确认、DNS 批量操作并发和监控探测单位

---

## 1. 风险概览

| 等级 | 数量 | 主要领域 |
| --- | --- | --- |
| 高危 | 8 | MCP 认证、保险库、备份凭据、证书复用、EdgeOne、监控探测、DNS 批量并发、Cloudflare 暂停记录 |
| 中危 | 14 | 部署/吊销并发、证书部署账户可见性、整站备份、用户创建、MCP 审计、TOTP 审计、监控类型 0、MX、前端竞态 |
| 低危/工程 | 5 | Henet 分页、通知渠道模式、审计覆盖门禁、发布脚本、Workers POC |

风险评级标准：

- 高危：可导致认证/授权绕过、凭据或私钥泄露、错误证书/解析上线、批量数据丢失。
- 中危：需要特定并发、权限或配置条件，但会造成越权、状态错乱、审计缺失或可观测性下降。
- 低危：影响局部厂商、特定配置或工程质量，修复成本低。

---

## 2. 高危问题

### H-01 MCP 旧版 `uid:apikey` 认证绕过作用域、IP 白名单、有效期和旧版接口开关

**位置**

- `backend/src/mcp/auth.ts:32-60`
- `backend/src/mcp/invoker.ts:33-41`
- `backend/src/routes/mcp.ts:90-98`

**问题**

`legacyContext()` 只校验 `user.apikey` 与 `is_api=1`，随后直接赋予 `scopes: ['*']`。`checkActionScope()` 在 `ctx.mode !== 'api_key'` 时直接返回，不做模块/读写 scope 校验。该路径也没有检查 `legacy_api_enable` 配置。

**影响**

- 旧版明文 apikey 可调用该用户等级允许的所有 MCP 动作。
- 绕过 API Key 的模块 scope、IP 白名单、过期时间。
- 管理员关闭旧版接口后，MCP 侧仍然可用。

**触发条件**

任意仍保留旧版 apikey 且 `is_api=1` 的账号，使用：

```http
Authorization: Bearer <uid>:<apikey>
```

调用 `/mcp`。

**修复建议**

- 删除 MCP legacy 分支，统一要求 API Key。
- 或让 legacy 凭据映射到受 scope、过期、IP 白名单约束的 API Key。
- 至少在 `legacyContext()` 中检查 `legacyApiEnabled()`，并在 `checkActionScope()` 中对 legacy 模式执行同等 scope 校验。

---

### H-02 保险库升级、销毁、恢复码设置只校验密码，开启 TOTP 后仍可被单因素接管

**位置**

- `backend/src/routes/vault.ts:147-167`（upgrade）
- `backend/src/routes/vault.ts:214-226`（recovery）
- `backend/src/routes/vault.ts:239-255`（destroy）
- `backend/src/routes/auth.ts:423-451`（reauth 只校验密码）

**问题**

`passphrase`、`downgrade`、`recover` 使用 `requireVaultConfirm()`，会额外校验当前 TOTP。`upgrade`、`recovery`、`destroy` 只调用 `requireLoginPassword()`。`/api/auth/reauth` 本身也只校验密码，因此 `X-Reauth-Token` 只代表密码级证明。

**影响**

攻击者持有被盗会话和登录密码，即使目标用户已开启 TOTP，也可以：

- 调用 `/api/vault/upgrade` 用攻击者已知口令重新包装 DEK，使原用户失去私有凭据访问能力。
- 调用 `/api/vault/destroy` 销毁全部私有凭证。
- 调用 `/api/vault/recovery` 重设恢复码。

**触发条件**

被盗会话 + 登录密码，目标用户已开启 TOTP。

**修复建议**

- 三个接口统一改用 `requireVaultConfirm()`，要求当前 TOTP。
- `/api/auth/reauth` 在用户开启 TOTP 时要求同时提交 TOTP，避免所有依赖 `X-Reauth-Token` 的操作退化为单因素。

---

### H-03 修改备份目的地 URL 可把已保存的 WebDAV/S3 凭据发送到攻击者服务器

**位置**

- `backend/src/routes/backup.ts:492-534`
- `backend/src/routes/backup.ts:644-652`
- `backend/src/lib/backup/destinations.ts:53-61`
- `backend/src/lib/secret.ts:166-210`（`mergeMaskedConfig`）

**问题**

`PUT /api/backup/destinations/:id` 没有二次确认，`mergeMaskedConfig()` 会在请求只提交新 `config.url` 时保留旧 `username/password`。随后 `/test` 或 `GET /api/backup/remote/:id` 会使用旧凭据对新 URL 发起请求，WebDAV 的 `Authorization: Basic ...` 会直接发送给攻击者。

**影响**

被盗管理员会话无需知道备份凭据，即可把已保存的 WebDAV/S3 凭据外带到攻击者服务器。

**触发条件**

1. 获取 level≥2 管理员会话。
2. `PUT /api/backup/destinations/:id`，只修改 `config.url`。
3. 调用 `POST /api/backup/destinations/:id/test` 或 `GET /api/backup/remote/:id`。

**修复建议**

- 目的地增删改、测试、远端浏览统一加 `requireLoginPassword()`。
- URL 主机变化时要求重新输入凭据，禁止跨主机复用旧凭据。
- 对 `username/password` 与 URL 主机做绑定校验，主机变化时清空旧凭据。

---

### H-04 已过期但状态仍为 3 的证书订单会被复用并直接部署

**位置**

- `backend/src/lib/cdn/certLink.ts:147-162`（`findOrderByDomains` 未检查到期）
- `backend/src/routes/cdn.ts:4857-4896`（通配符订单复用后直接部署）
- `backend/src/routes/cdn.ts:4987-4999`（精确订单复用后直接部署）
- `backend/src/lib/deployService.ts:124-135`（部署前只检查 status=3）

**问题**

`findOrderByDomains()` 只过滤 `status IN (0,1,2,3)`，没有检查 `expiretime > NOW()`。`ensureWildcardOrder()` 和 `ensureExactOrder()` 会复用已过期但 `status=3` 的订单。后续流程只检查 `status=3` 和证书字段存在，`CertDeployService.process()` 也不检查到期时间，最终会把过期证书部署到 CDN。

**影响**

- 用户点击“申请/检查并部署”后，系统可能把过期证书上传到 CDN。
- 页面显示部署成功，但浏览器访问会证书过期。
- 掩盖真正的续签失败。

**触发条件**

同一证书账户下已有同域名集合的过期订单，且 `status=3`。

**修复建议**

- 复用条件增加 `expiretime > NOW()`。
- 过期订单必须走续签或新建订单。
- `CertDeployService.process()` 部署前再次校验证书 `expiretime`，过期直接失败并提示续签。

---

### H-05 EdgeOne 单域名访问控制实际改写整个站点策略，并删除其他域名的 `dnsmgr_*` 规则

**位置**

- `backend/src/routes/cdn.ts:5921-5955`
- `backend/src/lib/cdn/providers/TencentEdgeOne.ts:789-810`
- `backend/src/lib/cdn/providers/TencentEdgeOne.ts:828-857`
- `backend/src/lib/cdn/providers/TencentEdgeOne.ts:571-586`（HTTPS 同样为站点级）

**问题**

`POST /api/cdn/domains/:id/access` 按单个加速域名调用 `setAccess()`，但 `setAccess()` 读取和写回的是 `ZoneDefaultPolicy`，生成的规则没有 `http.request.host` 条件；同时会过滤掉该 Zone 内所有以 `dnsmgr_` 开头的规则，再写入当前域名的规则。

同一实现中 `setHttps()` 使用站点级 `ModifyL7AccSetting`，单域名操作会影响整个 Zone 的强制 HTTPS 跳转。

**影响**

- 同一 EdgeOne 站点下多个加速域名的访问控制互相覆盖。
- 保存一个域名的规则会删除其他域名的 `dnsmgr_*` 防护规则。
- 单域名开启/关闭强制 HTTPS 会改变同站点全部域名行为。

**触发条件**

同一 EdgeOne 站点下存在多个加速域名，用户保存其中一个域名的访问控制或 HTTPS 配置。

**修复建议**

- 访问控制规则必须按域名生成 host 条件，或改用域名级安全规则。
- 单域名接口禁止读写整个 `ZoneDefaultPolicy`。
- HTTPS 强制跳转改用带 host 条件的域名级 L7 规则，或在接口层明确标记为站点级操作并限制权限。

---

### H-06 Ping 监控超时单位错误，1-999 秒配置实际只等待约 1 秒，可能触发错误切换

**位置**

- `backend/src/lib/monitor/taskRunner.ts:94`
- `backend/src/lib/monitor/checkUtils.ts:143-166`

**问题**

`checkCurl()` 和 `checkTcp()` 都把 `row.timeout` 当秒并乘以 1000。`checkPing()` 的参数名是 `timeoutMs`，但调用方传入的是秒，内部：

```ts
const waitSec = Math.max(1, Math.ceil((Number(timeoutMs) || 1000) / 1000));
```

因此配置 300 秒时实际执行 `ping -w 1`。

**影响**

- 网络稍慢就被判定失败。
- 连续失败后触发备用解析切换。
- 监控数据与真实可用性不一致。

**触发条件**

Ping 监控任务配置任意小于 1000 秒的超时时间。

**修复建议**

- 调用处传 `row.timeout * 1000`。
- 或让 `checkPing()` 明确接收秒并内部换算。
- 增加单元测试覆盖 1 秒、3 秒、300 秒三种配置。

---

### H-07 批量解析操作对 PowerDNS/AWS 等 rrset 型适配器并发读改写，会丢失删除或更新

**位置**

- `backend/src/routes/domain.ts:1331-1375`
- `backend/src/routes/domain.ts:2075-2095`
- `backend/src/lib/dns/providers/powerdns.ts:238-290`
- `backend/src/lib/dns/providers/aws.ts`（rrset ChangeBatch 路径）

**问题**

批量删除、暂停、改值、改线路使用 `runPool(records, 8)`。PowerDNS 的 `updateDomainRecord()` / `deleteDomainRecord()` 先读取整个 rrset，在内存中增删，再整体替换。同一 `name+type` 的多条记录并发执行时，后写请求会覆盖先写结果，出现删除被复活、更新丢失。

Legacy 批量接口还复用同一个 provider 实例，`this.error` 和 rrset 缓存会跨任务串台。

**影响**

- 批量删除后部分记录仍然存在。
- 批量改值后部分记录保持旧值。
- 用户看到“成功 N 条”，实际云端状态不一致。

**触发条件**

对同一主机名同类型的多条记录执行批量删除、暂停、改值或改线路。

**修复建议**

- 按 `name+type` 分组，单次原子替换整个 rrset。
- 同一 rrset 串行执行，不与其他 rrset 共享并发池。
- Legacy 批量接口为每个任务创建独立 provider。

---

### H-08 编辑 Cloudflare 暂停记录会静默启用该记录

**位置**

- `backend/src/lib/dns/providers/cloudflare.ts:80-85`
- `backend/src/lib/dns/providers/cloudflare.ts:136-150`
- `backend/src/routes/domain.ts:1149-1178`

**问题**

Cloudflare 适配器读取记录时用名称后缀 `_pause` 表示暂停，并在返回前剥离后缀、设置 `Status=0`。编辑记录时前端提交的是剥离后的 `Name`，`updateDomainRecord()` 直接用该名称 PATCH，没有恢复 `_pause` 后缀，Cloudflare 会把它当成改名并重新启用。批量改值/改线路同样受影响。

**影响**

用户编辑一条已暂停记录的值、线路或备注，记录会被静默启用，可能导致流量指向未准备好的源站。

**触发条件**

编辑或批量修改已暂停的 Cloudflare 记录。

**修复建议**

- 更新前读取当前记录状态。
- 暂停态在名称上恢复 `_pause` / `__root___pause`。
- 或提供不改名的字段级更新接口。

---

## 3. 中危问题

### M-01 部署任务编辑与后台部署并发，旧配置可能覆盖新配置

**位置**

- `backend/src/routes/cert.ts:1104-1134`
- `backend/src/lib/deployService.ts:107-176`

**问题**

`CertDeployService.process()` 在加锁前执行 `load()`，使用旧 `aid/oid/config` 构建 provider；`PUT /api/deploy/tasks/:id` 不获取任务锁，直接更新 `aid/oid/config`。后台部署仍按旧目标执行，最后 `finally` 用 `this.task.config` 合并写回，覆盖用户刚保存的新配置。

**修复建议**

编辑接口与部署 worker 共用任务租约锁；worker 在加锁后重新加载任务，写回时带 `processid` 做 fencing。

---

### M-02 证书吊销未使用订单变更锁，可能与签发/续签并发覆盖状态

**位置**

- `backend/src/routes/cert.ts:769-783`
- `backend/src/lib/certService.ts:484-489`

**问题**

`revoke()` 直接 `ensureLoaded()` 后调用 CA 吊销并 `saveResult(4)`，没有 `withMutationLock()`；`saveResult()` 在无租约令牌时按 `id` 无条件更新。调度器同时处理该订单时，双方会互相覆盖 `status/fullchain/privatekey`。

**修复建议**

吊销走 `withMutationLock()`；状态写入必须带租约令牌并在锁内复检状态。

---

### M-03 CDN 证书联动自动创建的部署账户默认是共享账户

**位置**

- `backend/src/lib/cdn/certLink.ts:298-310`
- `backend/src/migrate.ts:739-743`

**问题**

`ensureDeployAccount()` 把 CDN provider 返回的 `accountConfig`（含 SecretId/SecretKey 等）写入 `cert_account`，INSERT 未设置 `owner_uid/visibility`，数据库默认 `owner_uid=0, visibility='shared'`。私有 CDN 账户触发证书联动后，其云凭据会变成所有管理员可见、可用的共享部署账户。

**修复建议**

从源 CDN 账户继承 `owner_uid/visibility`；私有账户的部署凭据继续保持私有。

---

### M-04 整站备份导出、目的地管理、远端删除缺少二次确认

**位置**

- `backend/src/routes/backup.ts:88-137`
- `backend/src/routes/backup.ts:481-521`
- `backend/src/routes/backup.ts:542-700`

**问题**

个人备份导出有 `requireLoginPassword()`，整站导出只校验 `isAdmin`；目的地新增/修改/删除、计划增删改、立即执行、远端删除同样没有二次确认。

**影响**

被盗管理员会话可以把整站归档上传到攻击者目的地，或清空远端备份。

**修复建议**

整站导出、目的地写操作、计划写操作、远端删除统一加 `requireLoginPassword()`。

---

### M-05 创建普通用户并授予子域名权限不需要二次确认

**位置**

- `backend/src/routes/user.ts:165-224`

**问题**

创建 `level=1` 且 `is_api=0` 的用户不触发 `requireLoginPassword()`，但可以同时提交 `permission` 并设置已知密码。

**影响**

被盗管理员会话可以新建一个带 DNS 操作权限的普通账号，管理员改密或吊销会话后该账号仍然有效。

**修复建议**

任何用户创建都要求二次确认；至少“携带 permission 的创建”必须确认并记录审计。

---

### M-06 MCP legacy 模式读取证书私钥绕过登录密码确认

**位置**

- `backend/src/mcp/tools/cert.ts:50-88`
- `backend/src/routes/cert.ts:803-811`

**问题**

`cert_order_query.get` 在 API Key 模式下转发到 `/api/cert/orders/:id/info`，该路由要求 `requireLoginPassword()`；legacy 模式直接查库并返回解密后的 `key`，可附带 PFX。

**影响**

legacy 凭据可以在没有当前登录密码的情况下读取证书私钥。

**修复建议**

删除 legacy 直查分支，统一复用内部路由并转发/校验 `x-confirm-password`；或在 handler 内调用 `requireLoginPassword()`。

---

### M-07 MCP 审计无论成功失败都记为成功，认证失败和异常请求没有审计

**位置**

- `backend/src/routes/mcp.ts:38-74`
- `backend/src/routes/mcp.ts:117`

**问题**

`auditCalls()` 在 `server.handleBody()` 执行后统一写入 `result: 1`、`status: 200`，不读取实际工具结果。未知工具、参数错误、scope 不足、权限拒绝都会被记录为成功；认证失败或 `handleBody()` 抛异常时不会调用 `auditCalls()`。

**修复建议**

让 `registry.call()` 返回成功/失败和错误信息，按实际结果写 `result/status/errmsg`；认证失败和异常分支也写失败审计。

---

### M-08 TOTP `current_code` 未脱敏写入审计日志

**位置**

- `backend/src/lib/audit/mask.ts:6`
- `backend/src/routes/auth.ts:327-362`

**问题**

`EXTRA_SECRET` 包含 `code`，但不包含 `current_code` / `totp_code`；`/api/auth/totp-config` 没有设置 `scrubBody: true`，全局审计钩子会把请求体写入 `audit_log.detail.body`。

**影响**

如果请求在密码校验阶段失败，`current_code` 尚未被 `markTotpUsed()` 消耗，日志中的有效动态口令在窗口期内仍可用于登录。

**修复建议**

把 `current_code`、`totp_code` 加入 `EXTRA_SECRET`；给 `totp-config` 审计设置 `scrubBody: true`。

---

### M-09 “仅监控、不切换”的容灾任务仍会写切换状态并发送切换通知

**位置**

- `backend/src/routes/dmonitor.ts:160-190`
- `backend/src/lib/monitor/taskRunner.ts:107-137`
- `backend/src/lib/monitor/taskRunner.ts:235-280`

**问题**

接口允许 `type=0`（无操作、仅监控），但 `taskRunner.handle()` 仍会把 `status` 在 0/1 间迁移、设置 `action=1/2`。后续 DNS 操作分支只处理 `type=1/2/3`，`type=0` 不执行任何变更，却会写 `monitor.record.switch` 审计、发送“切换备用/恢复”通知并发出 `monitor.record.switched` 事件。

**修复建议**

为 `type=0` 增加独立分支，只记录健康状态和告警，不设置切换动作、不写切换审计、不发切换通知。

---

### M-10 MX 优先级 0 被丢弃，华为云完全未下发 MX 优先级

**位置**

- `backend/src/lib/dns/providers/aliyun.ts:166`
- `backend/src/lib/dns/providers/aliyun.ts:174`
- `backend/src/lib/dns/providers/dnsmgr.ts:140`
- `backend/src/lib/dns/providers/dnsmgr.ts:150`
- `backend/src/lib/dns/providers/huawei.ts:121-139`

**问题**

阿里云和 DNSMgr 使用 `if (MX)` / `if (Type === 'MX' && MX)`，MX 优先级 0 是合法值，会被当成未传。华为云 `addDomainRecord` / `updateDomainRecord` 的参数里没有 MX 字段，读取端却从 `row.mx` 取优先级。

**影响**

创建或修改 MX 记录时优先级丢失或被云端默认值替代。

**修复建议**

显式判断 `MX !== null && MX !== undefined`；华为云按 API 要求写入 MX 优先级并补充往返测试。

---

### M-11 用户编辑弹窗请求失败时保留上一个用户的数据

**位置**

- `frontend/src/views/UserList.vue:391-421`

**问题**

`openEdit()` 先设置 `editingId` 并打开弹窗，请求成功后才覆盖表单；没有 `catch`。请求 500 或断网时，表单仍是上一个用户或新增表单的数据，用户再次点击保存会用旧数据写入当前 `editingId`。

**修复建议**

请求前清空并禁用表单；增加 `catch`，失败时关闭弹窗或显示错误；加载完成前禁止保存。

---

### M-12 域名批量导入过程中切换 DNS 账户，任务会写入新账户

**位置**

- `frontend/src/views/DomainList.vue:86`
- `frontend/src/views/DomainList.vue:403-426`

**问题**

`doImport()` 复制了待导入队列，但 worker 每次请求都读取可变的 `importAid.value`；导入期间账户下拉框没有禁用。用户切换账户后，已启动的 worker 会把剩余域名写入新账户。

**修复建议**

导入开始时保存 `const aid = importAid.value` 并全程使用该快照；`importBusy` 时禁用账户选择；账户变化时中止导入。

---

### M-13 多标签页切换账号后，GET 缓存和 Pinia 用户状态仍属于旧账号

**位置**

- `frontend/src/api.ts:60-125`
- `frontend/src/stores/auth.ts:15-22`

**问题**

`getCache` 只按 URL 建 key；`setToken()` / `clearToken()` 只清理当前标签页的缓存，没有监听 `storage` 事件。另一个标签页登录或登出后，本标签页的 `getToken()` 已变成新 token，但 Pinia 用户、菜单和 GET 缓存仍是旧账号数据。

**修复建议**

监听 `storage` 的 `dnsmgr_token` / `dnsmgr_user` 变化，清理缓存并同步 store；缓存 key 纳入 token 或用户标识。

---

### M-14 规则保存异常时 `ruleSaveBusy` 永久为 true

**位置**

- `frontend/src/views/CdnZoneSetting.vue:2224-2256`

**问题**

`saveRule()` 设置 `ruleSaveBusy=true` 后直接 `await` 三个分支的接口，没有 `try/catch/finally`。网络异常或超时抛出时，`ruleSaveBusy` 不会复位，保存按钮永久转圈，并产生未处理 Promise rejection。

**修复建议**

用 `try/catch/finally` 包裹，`finally` 复位 `ruleSaveBusy`，异常时提示用户。

---

## 4. 低危与工程问题

### L-01 Henet 记录详情只在前 1000 条中查找

**位置**

- `backend/src/lib/dns/providers/henet.ts:326-334`

**问题**

`getDomainRecordInfo()` 调用 `getDomainRecords(1, 1000)` 后在本页查找 `RecordId`。Zone 记录超过 1000 条时，后续记录会被判定为不存在。

**影响**

普通用户无法编辑、删除或改状态位于 1000 条之后的记录。

**修复建议**

改用 `findRecordById()`，或在详情方法内完整翻页查找。

---

### L-02 到期提醒和证书通知的 Webhook 渠道不识别模式 2

**位置**

- `backend/src/lib/monitor/msgNotice.ts:430-435`
- `backend/src/lib/monitor/msgNotice.ts:474-479`
- `backend/src/lib/expire/expireNoticeService.ts:329-337`

**问题**

启用判断把 `1` 和 `2` 都视为开启，但 `expire_notice_webhook`、`expire_notice_custom_webhook`、`cert_notice_webhook` 只判断 `=== '1'`。

**影响**

配置为 `2`（始终发送）时任务认为已启用，实际不发送，且 `noticetime/issend` 不更新，造成反复重试和通知丢失。

**修复建议**

所有渠道统一使用 `on()` 判断 `1` 或 `2`。

---

### L-03 `check:audit` 不会因未映射路由失败，CI 审计覆盖检查形同虚设

**位置**

- `backend/scripts/check-audit-coverage.ts:17-29`
- `.github/workflows/ci.yml:42-43`

**问题**

脚本计算 `unmapped` 后只打印，不设置非零退出码。新增写路由未加入 `AUDIT_ROUTES` 时 CI 仍然通过。

**修复建议**

存在未映射路由时 `process.exit(1)`，并保留明确 allowlist。

---

### L-04 发布脚本缺少构建、测试和工作区校验

**位置**

- `scripts/release.mjs:42-63`

**问题**

脚本只检查暂存区非空，随后修改版本号并提交暂存区全部内容，打标签并推送 `main`。没有构建、类型检查、测试或“仅允许版本文件”的校验。

**影响**

误暂存密钥、调试文件或未通过构建的改动会被直接发布。

**修复建议**

发布前要求工作区干净，运行 `npm ci`、类型检查、构建和自检脚本；至少校验暂存文件列表并在失败时中止。

---

### L-05 未纳入 Git 的 `workers/` POC 存在硬编码密钥和默认管理员口令

**位置**

- `workers/src/worker.ts:117`
- `workers/src/worker.ts:298-303`
- `workers/src/worker.ts:499-500`
- `workers/src/worker.ts:1258-1265`
- `workers/wrangler.jsonc`

**问题**

`workers/` 当前未被 Git 跟踪，但源码中存在：

- 默认管理员口令 `admin12345`
- 缺失 `JWT_SECRET` 时使用公开硬编码密钥
- 缺失 `CONFIG_KEY` 时回退到 `JWT_SECRET` 或公开的 `workers-poc-config-key`
- `wrangler.jsonc` 未配置 `DEMO_ADMIN_PASSWORD`、`JWT_SECRET`、`CONFIG_KEY`

**影响**

如果部署该 POC，攻击者可用默认管理员登录、伪造任意用户会话或解密账户配置。

**修复建议**

将 `workers/` 明确标记为实验代码并从发布产物排除；如需部署，缺少密钥时必须 fail-closed。

---

## 5. 已核对且未发现明显问题的区域

- `backend/src/lib/secret.ts`：AES-GCM、HKDF 域分离、未知 `enc:` 版本 fail-closed。
- `backend/src/lib/apiKeys.ts`：空 scope fail-closed、CIDR/IP 校验、模块前缀匹配。
- `backend/src/lib/auth/revocation.ts`：缺少 jti 按已吊销处理，数据库异常 fail-closed。
- `backend/src/lib/setupToken.ts`：定长哈希与恒时比较。
- 备份归档路径处理：`resolveArchivePath`、`openArchive` 严格 basename、解压上限和 GCM 校验。
- 前端未发现 `v-html`、`window.open` 或开放重定向路径；动态 `href` 已走 `safeHref`。
- SQL 查询总体参数化，未发现可直接利用的 SQL 注入点。

---

## 6. 验证记录

| 命令 | 结果 |
| --- | --- |
| `cd backend && npx tsc --noEmit` | 通过 |
| `cd frontend && npm run build` | 通过 |
| `cd frontend && npm run check:i18n -- --strict` | 通过：zh-CN 3806 / en-US 3806 key |
| `cd frontend && npm run check:format` | 通过：13 项 |
| `cd backend && npm run check:mcp` | 通过：管理员 69 工具/452 动作，普通用户 27 工具/149 动作 |
| `cd backend && npm run check:audit` | 命令退出码 0，但存在 8 条 fallback 路由，脚本未失败 |

本次审查为静态审查，未执行真实云厂商 API 调用、并发压测、证书签发、备份恢复和 MCP 客户端联调。涉及并发和云平台行为的结论建议在测试环境复现后再修复。

---

## 7. 建议修复顺序

1. 第一优先级：H-01、H-02、H-03、H-04、H-05。
2. 第二优先级：H-06、H-07、H-08。
3. 第三优先级：M-01 至 M-14。
4. 工程门禁：L-03、L-04；`workers/` 按 L-05 处理。
5. 修复后补充回归用例：MCP legacy 认证、保险库 TOTP、备份目的地改 URL、过期证书复用、EdgeOne 多域名访问控制、Ping 超时、PowerDNS 批量删除、Cloudflare 暂停记录编辑。
