# 代码审查报告（第二轮）

- 审查日期：2026-11-16
- 审查基线：`1.35.8`（提交 `ebf6dfb`）
- 审查范围：`backend/src`（鉴权、并发一致性、失败恢复、证书/部署、备份、调度、监控、依赖）、`frontend/src`（定时器与资源释放）
- 审查方式：静态代码走查、关键路径跨文件验证、`npm audit`、现有自检脚本
- 修复日期：2026-11-16
- 本轮结论：确认 5 个中等风险代码问题、1 组依赖中危公告、4 个低风险或优化项；高危账号接管类问题未复现，除域名列表前端分页外均已完成修复或优化

> 修复状态与验证结果见下方清单、第六节和第八节。

---

## 一、总览

### 风险统计

| 级别 | 数量 | 主要影响 |
|------|------|----------|
| 中 | 5 | 证书联动关系丢失、恢复失败后锁站、代理环境下监控失效、通知永久丢失、备份执行时间错误 |
| 依赖中危 | 1 组 | FTP/XML/静态资源依赖存在 DoS 或进程退出公告 |
| 低/优化 | 4 | 保险库尝试计数、旧版签名数组覆盖、大列表查询、前端定时器释放 |

### 问题清单

| 编号 | 级别 | 问题 | 状态 |
|------|------|------|------|
| 1 | 中 | 共享证书联动合并存在丢更新 | 已修复 |
| 2 | 中 | 恢复归档校验失败后仍停留在维护模式 | 已修复 |
| 3 | 中 | 配置系统代理后 HTTP 监控和部分回调失败 | 已修复 |
| 4 | 中 | 证书/部署成功通知失败后不会重试 | 已修复 |
| 5 | 中 | 备份计划设置为 00 点会变成 03 点 | 已修复 |
| 6 | 低 | 保险库尝试次数会被新口令格式错误消耗 | 已修复 |
| 7 | 低 | 旧版 v2 签名未覆盖数组参数的全部值 | 已修复 |
| 8 | 优化 | 大列表接口缺少分页与查询下推 | 部分完成 |
| 9 | 低 | 前端防抖定时器缺少卸载清理 | 已修复 |
| 10 | 依赖中危 | 后端依赖存在可修复的 DoS/崩溃公告 | 已修复 |

编号 1 至 5 已优先修复，编号 8 的接口层分页已完成，前端分页接入留作后续改造。

---

## 二、中等风险问题

### 1. 共享证书联动合并存在丢更新

**状态**：已修复：改为带 `link` 原值条件的 CAS 更新，冲突时重新读取合并

**位置**

- `backend/src/lib/cdn/certLink.ts:194-206`
- `backend/src/routes/cdn.ts:4954`

**问题**

`addOrderCdnLinks` 先读取订单的 `link`，在内存中追加 `cdnDomainId`，随后直接覆盖写回。整个读改写过程没有 CAS 条件，也没有分布式锁。

证书选择路径 `applyCertLink` 会在两个加速域名先后选择同一张已签发证书时并发调用该函数。两次请求都可能读到相同的旧 `link`，后写入的请求覆盖前一次的 `cdnDomainIds`。

**触发条件**

- 同一证书订单被两个加速域名并发选择；
- 或两个请求几乎同时提交 `/api/cdn/domains/:id/certlink`。

**影响**

- 其中一个域名的证书联动关系丢失；
- 后续续签或自动部署无法覆盖该域名；
- 删除域名时可能漏解绑，或错误判断证书是否仍被其他域名使用。

**修复建议**

- 改成 CAS 重试：读取 `link` 后执行 `UPDATE ... WHERE id = ? AND link = ?`，冲突时重新读取并重算；
- 或使用 `dnsmgr:cert-link:<orderId>` 分布式锁包住整个读改写过程；
- `ensureExactOrder` 已有命名锁，但证书直接选择路径仍需要独立保护。

---

### 2. 恢复归档校验失败后仍停留在维护模式

**状态**：已修复：归档解密/解压/checksum 校验通过且事务开始写库后才保留维护模式

**位置**

- `backend/src/lib/backup/restore.ts:83`
- `backend/src/lib/backup/import.ts:191`
- `backend/src/lib/backup/archive.ts:663-704`

**问题**

`runRestore` 在调用 `importArchive` 之前就把 `importStarted` 设为 `true`。`importArchive` 内部的 `openArchive` 会先完成密钥校验、GCM 解密、gzip 解压和 checksum 校验，这些步骤都在数据库事务开始之前。

当归档密钥错误、文件损坏或 checksum 不一致时，业务表还没有被修改，但 `catch` 判断 `importStarted === true`，因此保留维护模式。

**触发条件**

- 在线恢复时使用了错误的备份密钥；
- 归档文件损坏或不完整；
- 归档 checksum 不一致。

**影响**

全站写请求持续返回 503，必须由管理员手动调用维护模式退出接口。这个问题与上一轮修复的“快照失败锁站”属于同一类，只是失败阶段更靠后。

**修复建议**

- 在设置 `importStarted` 之前完成归档预检；
- 或让 `importArchive` 在事务真正开始写库时回调置位；
- 或者根据错误类型区分“归档校验失败”和“导入中途失败”，前者立即解除维护模式。

---

### 3. 配置系统代理后 HTTP 监控和部分回调会全部失败

**状态**：已修复：直连任务显式关闭 `safeFetch` 的全局代理；代理加域名目标仍按 SSRF 策略拒绝

**位置**

- `backend/src/lib/monitor/checkUtils.ts:90-96`
- `backend/src/lib/netGuard.ts:333-340`

**问题**

监控任务的 `checkCurl` 会按任务配置构建 dispatcher：未勾选代理时注入直连 Agent，勾选代理时注入系统代理 Agent。但 `safeFetch` 内部仍会读取全局代理配置，并在 `proxy` 存在时执行 `requirePinnedDns` 检查。

只要系统设置中配置了代理，域名目标就会触发以下拒绝：

```text
已配置出站代理：该地址不允许经代理访问域名目标
```

即使任务显式选择直连，该检查仍然先于 dispatcher 使用发生。

**触发条件**

- 系统设置中配置了出站代理；
- 监控目标使用域名而不是 IP；
- 自定义 Webhook、Telegram、事件回调使用域名目标时会受到同样影响。

**影响**

- HTTP/HTTPS 监控任务全部显示失败；
- 任务级“是否走代理”开关实际失效；
- 通知和事件回调在代理环境下部分不可用。

**修复建议**

- 给 `safeFetch` 增加显式的 `useProxy` 或 `allowDomainTarget` 参数；
- 调用方传入直连 dispatcher 时跳过代理拒绝逻辑；
- 仅在请求确实经代理发送、且调用方要求固定 DNS 时执行 `requirePinnedDns` 检查。

---

### 4. 证书/部署成功通知失败后不会重试

**状态**：已修复：新增成功记录通知重试查询与退避上限

**位置**

- `backend/src/lib/monitor/msgNotice.ts:516`
- `backend/src/lib/monitor/msgNotice.ts:543`
- `backend/src/lib/cert/certTaskService.ts:102-120`
- `backend/src/lib/cert/certTaskService.ts:135-150`
- `backend/src/lib/cert/certTaskService.ts:46-70`

**问题**

签发或部署通知只有在所有渠道都成功时才把 `issend` 置为 1。任何渠道失败时保留 `issend = 0`，注释写明“供下一轮重试”。

但调度器的查询条件没有覆盖这些记录：

- `findRunningOrders` 只选择状态 `0`、`1`、`2` 和负数失败状态，排除已签发 `status = 3`；
- `findDeployTasks` 只选择部署任务 `status = 0` 或负数重试状态，排除已成功 `status = 1`。

因此已成功但通知失败的记录不会再次进入调度。

**触发条件**

- SMTP、Telegram、Webhook 等渠道瞬时不可用；
- 证书签发成功或部署成功时通知发送失败。

**影响**

证书签发成功或部署成功的通知永久丢失，只能等待下一次续签周期再次触发。

**修复建议**

- 增加独立的通知重试查询，例如按 `issend = 0 AND status IN (1, 3)` 和退避时间重试；
- 或按渠道记录发送状态，避免整条通知因为单个渠道失败而重复发送；
- 重试需要设置最大次数，避免长期失败记录无限占用扫描资源。

---

### 5. 备份计划设置为 00 点会变成 03 点

**状态**：已修复：时间字段使用整数范围归一化，`0` 不再被默认值覆盖

**位置**

- `backend/src/routes/backup.ts:58`
- `frontend/src/views/Backup.vue:189`

**问题**

`computeNextRun` 使用：

```ts
next.setHours(Number(row.hour || 3), Number(row.minute || 0));
```

MySQL 的 `tinyint` 字段返回数字 `0`，`0 || 3` 的结果是 `3`。前端时间输入允许 `hour = 0`，因此用户选择 00:00 至 00:59 的备份计划会被安排到 03 点。

**触发条件**

- 创建或编辑每日/每周备份计划，小时选择 0。

**影响**

- 备份实际执行时间错误；
- 立即创建时如果请求体传字符串 `"0"`，行为可能正常；从数据库读取时又变成 3 点，表现不一致。

**修复建议**

- 改为 `row.hour ?? 3`；
- 对 `hour`、`minute`、`weekday` 做整数范围校验；
- 统一处理 `lib/dns/checkService.ts:192` 和 `lib/cdn/preheatService.ts:148` 的 `run_time`，避免非法时间生成 `Invalid Date`。

---

## 三、低风险与优化项

### 6. 保险库尝试次数会被新口令格式错误消耗

**状态**：已修复：先校验新口令格式，再消耗尝试次数；模式切换成功清零失败计数

**位置**

- `backend/src/lib/vault/service.ts:249-257`
- `backend/src/lib/vault/service.ts:277-284`
- `backend/src/lib/vault/service.ts:208-215`
- `backend/src/lib/vault/service.ts:233-239`

**问题**

`changePassphrase` 和 `recoverVault` 先调用 `claimAttempt`，再校验新口令长度。旧口令或恢复码正确、但新口令少于 12 位时，失败次数已经累加。连续 5 次客户端校验错误会锁定保险库 15 分钟。

另外，`downgradeVault` 成功路径没有清除 `fail_count` 和 `locked_until`，`upgradeVault` 也没有清零。历史失败计数可能残留到下一次口令模式。

**影响**

- 用户输入错误的新口令会消耗真实的口令尝试次数；
- 正确的旧口令也可能导致临时锁定；
- 降级后再次升级可能继承旧的锁定状态。

**修复建议**

- 在 `claimAttempt` 之前校验新口令长度和格式；
- 成功切换模式后统一写入 `fail_count = 0, locked_until = NULL`。

---

### 7. 旧版 v2 签名未覆盖数组参数的全部值

**状态**：已修复：签名规范化展开数组全部值

**位置**

- `backend/src/lib/legacyApi.ts:52-56`
- `backend/src/lib/legacyApi.ts:69-78`

**问题**

`canonicalParams` 调用 `scalar` 处理参数值，数组只取第一个元素参与签名。请求体中重复的 `key[]` 或数组参数可以在签名不变的情况下追加或修改后续元素。

**影响**

旧版接口启用 v2 签名时，截获的签名请求存在参数篡改空间。TLS 场景下风险较低，但签名完整性与设计目标不一致。

**修复建议**

- 对所有数组值按顺序稳定拼接后参与签名；
- 对不接受数组的接口直接拒绝数组参数；
- 补充签名规范测试，覆盖重复参数和 `key[]` 形式。

---

### 8. 大列表接口缺少分页与查询下推

**状态**：部分完成：域名列表支持可选分页，CDN 列表按需执行兼容查询；前端分页未接入

**位置**

- `backend/src/routes/domain.ts:490-494`
- `backend/src/routes/cdn.ts:808-813`

**问题**

管理员请求 `/api/domains` 时直接查询全部域名，没有 `LIMIT`；普通用户按全部授权域名拉取。域名数量达到数千时会形成大响应和较高内存占用。

CDN 域名列表每次请求都会执行一次 `cert_order.link LIKE '%"cdnDomainId"%'` 的兼容查询，即使当前页所有行都已经有 `cert_mode`。该查询无法有效利用普通索引，证书订单多时开销明显。

**影响**

- 大部署下域名列表首屏变慢；
- 每次 CDN 域名列表都产生额外表扫描；
- 前端收到大数组后渲染和筛选成本增加。

**修复建议**

- 域名列表增加服务端分页或 keyset 分页；
- CDN 列表只在 `rows.some(r => r.cert_mode == null)` 时执行兼容查询；
- 在证书联动变更时直接回写 `cert_mode`，减少运行时推导。

---

### 9. 前端防抖定时器缺少卸载清理

**状态**：已修复：组件卸载时清除定时器并使在途请求失效

**位置**

- `frontend/src/views/ScheduleForm.vue:129-134`
- `frontend/src/views/OptimizeForm.vue:118-123`
- `frontend/src/views/DmTaskForm.vue:152-157`

**问题**

三个表单只在下次输入时清理旧定时器，没有在 `onBeforeUnmount` 中清理。快速离开页面时，250ms 后仍会发起请求并更新已卸载组件的状态。

**影响**

无效请求和潜在的控制台警告；不影响数据正确性。

**修复建议**

引入 `onBeforeUnmount` 清理 `domainSearchTimer`，或在组件卸载时统一取消未完成的请求。

---

## 四、依赖安全公告

执行：

```bash
cd backend
npm audit --omit=dev
```

结果：后端生产依赖 5 个公告，其中 1 个 low、4 个 moderate；前端生产依赖 0 个。

| 依赖 | 风险 | 相关代码 |
|------|------|----------|
| `basic-ftp` | 密码含 CR/LF 时可能触发未捕获异常导致进程退出；MLSD 目录解析可被 `__proto__` 字段触发 DoS | `backend/src/lib/deploy/providers/ftp.ts:63-68` |
| `fast-xml-parser` | 未闭合标签解析存在二次方 CPU 消耗 | `backend/src/lib/clients/AliyunOSS.ts`、`backend/src/lib/clients/AWS.ts` |
| `@fastify/static` | 依赖的 `glob`/`minimatch` 存在取消与通配符处理 DoS 公告 | 静态资源服务 |

**建议**

- 执行 `npm audit fix` 后重新构建镜像；
- FTP 部署在调用 `client.access` 前拒绝用户名/密码中的控制字符；
- 升级后在测试环境验证静态资源缓存头、OSS/AWS 响应解析和 FTP 部署。

---

## 五、本轮复核确认

以下方面本轮未发现新的可直接利用问题：

- 登录失败锁定、TOTP 预令牌、`token_version`、单会话吊销逻辑完整；
- API Key 使用哈希存储，作用域、IP 白名单、过期时间和二次确认均有校验；
- SQL 查询以参数化为主，动态 `ORDER BY` 使用白名单，`LIKE` 使用 `escapeLike`；
- SSRF 防护覆盖 HTTP 请求、重定向逐跳校验、DNS 固定和云元数据地址；
- 本地证书部署路径包含绝对路径校验、符号链接/硬链接防护和受保护目录限制；
- 备份归档文件名做了路径穿越校验，归档解压有大小上限；
- Docker 运行阶段使用非 root 用户；
- 常见查询字段已有索引，包括 `domain(aid)`、`cdn_domain(aid, zone_id)`、`cert_order(aid)`、`cert_deploy(oid)`、审计表时间/用户索引等。

---

## 六、验证记录

```bash
# SQLite 自检
cd /workspace/backend
npm run check:sqlite

# 备份与保险库自检
cd /workspace/backend
npm run check:backup

# 后端依赖审计
cd /workspace/backend
npm audit --omit=dev

# 前端依赖审计
cd /workspace/frontend
npm audit --omit=dev
```

结果：

- 后端 `tsc --noEmit` 通过；
- 前端 `vue-tsc --noEmit` 通过；
- 前端 `npm run build` 通过，5052 个模块构建成功；
- `check:sqlite`、`check:backup`、`check:audit` 全部通过；
- 后端 `npm audit --omit=dev`：0 个漏洞，`package-lock.json` 已更新；
- 前端 `npm audit --omit=dev`：0 个漏洞。

本轮未执行真实云厂商 API 调用、MySQL 实例集成测试和压力测试；`check:mysql` 未运行。

---

## 七、建议修复顺序

1. 修复共享证书联动 CAS（编号 1），避免证书关系静默丢失；
2. 修复恢复归档预检与维护模式退出（编号 2），避免失败恢复锁站；
3. 修复代理环境下的监控和回调（编号 3），恢复代理部署可用性；
4. 增加通知重试调度（编号 4），避免签发/部署成功通知永久丢失；
5. 修复备份小时 `0` 被替换为 `3`（编号 5），并统一校验定时任务时间；
6. 处理保险库计数、旧版签名数组和大列表查询（编号 6、7、8）；
7. 升级依赖并补充 FTP 凭据控制字符校验（编号 10）；
8. 清理前端定时器（编号 9）。


---

## 八、修复实施记录

| 编号 | 主要改动 | 文件 |
|------|----------|------|
| 1 | 证书联动改为 CAS 重试，冲突时重新读取并合并，避免覆盖其他域名的关联 | `backend/src/lib/cdn/certLink.ts` |
| 2 | `importArchive` 增加事务写库回调；恢复流程只在实际写库后保留维护模式 | `backend/src/lib/backup/import.ts`、`backend/src/lib/backup/restore.ts` |
| 3 | `safeFetch` 增加 `useProxy` 选项；监控直连任务不再触发全局代理拒绝 | `backend/src/lib/netGuard.ts`、`backend/src/lib/monitor/checkUtils.ts` |
| 4 | 通知发送返回布尔结果；新增成功订单/部署任务的通知重试查询与进程内退避状态 | `backend/src/lib/monitor/msgNotice.ts`、`backend/src/lib/cert/certTaskService.ts` |
| 5 | 新增整数范围归一化与共享时间解析；备份计划、DNS 检测、CDN 预热统一校验 `HH:mm` | `backend/src/lib/util.ts`、`backend/src/routes/backup.ts`、`backend/src/routes/dnscheck.ts`、`backend/src/routes/preheat.ts`、`backend/src/lib/dns/checkService.ts`、`backend/src/lib/cdn/preheatService.ts` |
| 6 | 新口令格式校验前移；升级/降级成功后清零失败计数与锁定时间 | `backend/src/lib/vault/service.ts` |
| 7 | v2 签名规范化展开数组全部值，重复参数无法在签名不变时追加 | `backend/src/lib/legacyApi.ts` |
| 8 | 域名列表支持 `limit`/`offset`（管理员路径下推 SQL）；CDN 列表仅在存在未推导行时执行 `link LIKE` 兼容查询 | `backend/src/routes/domain.ts`、`backend/src/routes/cdn.ts` |
| 9 | 三个表单在 `onBeforeUnmount` 中清除防抖定时器并作废在途请求 | `frontend/src/views/ScheduleForm.vue`、`OptimizeForm.vue`、`DmTaskForm.vue` |
| 10 | 后端依赖升级至 0 漏洞；FTP 用户名/密码拒绝控制字符 | `backend/package-lock.json`、`backend/src/lib/deploy/providers/ftp.ts` |

### 后续建议

- 域名列表前端分页需要同时改造统计卡片与批量选择逻辑，当前仅完成接口层 `limit`/`offset` 支持。
- 通知重试状态保存在进程内，服务重启后会重新计数；长期运维可考虑落库 `noticetime`/`noticeretry` 字段。
- 依赖升级后建议在测试环境再验证 FTP、OSS/AWS XML 解析和静态资源服务。
- 本轮改动尚未提交 Git；发布前需按项目流程提交并提升版本号。
