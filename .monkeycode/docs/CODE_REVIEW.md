# 代码审查报告

- 审查日期：2026-11-15
- 审查版本：1.35.7（`backend/package.json` / `frontend/package.json`）
- 审查范围：`backend/src`（鉴权、域名/DNS、证书/部署、CDN、备份、调度、审计、保险库）、`frontend/src`（Vue 3 + Naive UI）
- 审查方式：通读核心路由、服务与工具模块，逐条在源码中核对行号；对疑似问题做了跨文件验证，剔除未复现的误报
- 结论：共确认 37 个问题，其中高危 6 个、中危 19 个、低危 12 个。高危集中在证书联动、后台任务租约、备份恢复、CDN 接入并发与审计脱敏

---

## 一、总览

### 修复状态

- 修复完成：35 项（高危 6/6、中危 18/19、低危 11/12）
- 部分修复：1 项（编号 25，DNS 写入并发化留待后续）
- 保留：1 项（编号 30，需认证体系迁移到 HttpOnly Cookie）
- 验证：`backend` 执行 `npx tsc --noEmit`、`frontend` 执行 `npx vue-tsc --noEmit` 均通过

| 级别 | 数量 | 主要影响 |
|------|------|----------|
| 高危 | 6 | 证书被误吊销、任务永久卡死、备份失败锁站、并发写云资源、恢复码明文入库、cron 被缓存跳过 |
| 中危 | 19 | 会话/凭据生命周期、API Key 越权、审计丢失与泄露、分页漏数据、权限口径不一致、超时与原子性 |
| 低危 | 12 | 批量操作结果失真、参数边界、前端定时器与 loading 状态、分页与竞态 |

建议优先处理 P0 编号 1-6，再处理 P1 编号 7-25。

---

## 二、高危问题

### 1. 删除一个 CDN 域名会连带吊销其他域名仍在复用的证书

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/cdn/certLink.ts:455-512`
- 问题：`removeCertOrdersLinkedToCdnDomain` 只要订单的 `link` 包含当前 `did` 就加入 `targets`，随后无条件 `revoke()` 并删除 `cert_order`、`cert_deploy`、`cert_domain`、`cert_link_log`，没有检查 `cdnLinkIds(link)` 中是否还有别的存活域名。
- 触发条件：同一证书订单通过 `applyCertLink` 或 `addOrderCdnLinks` 关联到两个及以上加速域名，随后删除其中一个域名。
- 影响：另一台仍在使用的加速域名的证书被 CA 吊销，自动部署任务被删除，续签链路断裂；其 `cdn_domain.cert_mode` 仍为 `certlink`，`findLinkedOrder` 返回空。
- 修复建议：删除前先计算 `remaining = cdnLinkIds(link).filter(id => id !== did)`；`remaining` 非空时只从 `link` 中移除该 did 并保留订单与部署任务，为空时才吊销并删除。

### 2. 证书订单与部署任务的锁没有租约回收

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/cert/certTaskService.ts:40-71`、`backend/src/lib/certService.ts:118-137`
- 问题：`findRenewOrders`、`findRunningOrders`、`findDeployTasks` 强制 `islock = 0`，而「锁超过 1 小时可抢占」的逻辑只写在 `takeLock()` 中。进程在 `takeLock` 之后崩溃或被杀，`islock` 永久为 1，订单再也不会被调度查询选中，抢占逻辑永远没有机会执行。
- 触发条件：证书/部署处理过程中进程崩溃、容器重启，或异常发生在 `takeLock` 之后、`releaseLock` 之前。
- 影响：该订单的自动续签与部署静默停止且无告警，证书可能直接过期；只能由管理员手工处理恢复。
- 修复建议：查询条件改为 `(islock = 0 OR locktime IS NULL OR locktime < DATE_SUB(NOW(), INTERVAL 1 HOUR))`，与 `takeLock` 的租约判定保持一致；或增加定时回收过期锁的任务。

### 3. 并发接入 CDN 域名时补偿删除会删掉另一个成功请求的资源

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/cdn.ts:4290-4365`
- 问题：「是否已接入」是普通 SELECT，创建云端域名之后才 INSERT。唯一键冲突时 `provider.deleteDomain(name)` 无条件删除云端域名，删除的可能是另一个请求刚创建的那份。接入路径也没有像 `/cdn/sync` 那样加分布式锁。
- 触发条件：同一账户对同一 `name` 双击或并发调用 `POST /api/cdn/domains`，或前端重试。
- 影响：出现「本地有记录但云端域名已被删除」或「请求 500 但实际已接入」的状态，用户重试后反复创建与删除。
- 修复建议：用 `withDistributedLockResult('dnsmgr:cdn-add:' + aid + ':' + name, ...)` 串行化；补偿删除只针对本次创建的确切回执；唯一键冲突时回查并返回「已接入」。

### 4. 保险库恢复码在失败路径以明文写入审计日志

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/vault.ts:133-145`、`backend/src/lib/audit/mask.ts:6`、`backend/src/lib/audit/hooks.ts:113`
- 问题：成功路径设置了 `scrubBody: true`，但 `/api/vault/recover`、`/api/vault/recovery` 抛错时不会调用 `audit()`，全局审计钩子会把 `req.body` 交给 `maskBody`。脱敏规则只覆盖 `password`、`passphrase`、`code` 等字段，没有 `recovery`。恢复码是重置保险库口令的等价凭据。
- 触发条件：用户调用 `/api/vault/recover`，恢复码正确但新口令长度不足；或 `/api/vault/recovery` 在密码校验失败时提交了新的恢复码。
- 影响：管理员可通过 `/api/audit/logs`、`/api/audit/logs/export` 读到普通用户的恢复码，结合管理员重置密码能力可接管用户保险库。
- 修复建议：把 `recovery`、`recovery_code` 加入 `EXTRA_SECRET`；vault 路由的失败分支同样设置 `scrubBody`；审计详情对普通用户隐藏 `errmsg`/内部字段。

### 5. 恢复流程在尚未改动数据的前置阶段失败后仍锁死维护模式

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/backup/restore.ts:71`、`backend/src/lib/backup/restore.ts:129-138`
- 问题：先 `setMaintenance(true)`，再创建快照、校验密钥。若此时 `exportBackup` 因已有备份任务持有锁而失败，或 `keyForArchive` 因口令/密钥不匹配而失败，`catch` 只重置恢复状态，注释明确「失败时仍停留在维护模式」，但此时还没有执行任何导入。
- 触发条件：一次失败的恢复尝试发生在快照或密钥校验阶段。
- 影响：全站写请求被 503 卡住，直到管理员调用 `/api/backup/maintenance/exit`；无人值守流程会让站点长时间不可写。
- 修复建议：按阶段区分处理，在 `importArchive` 开始前的失败分支恢复 `setMaintenance(false)`；只有导入已开始执行后才保留维护模式。

### 6. `/cron` 会拿到公共缓存头，CDN 可能缓存后跳过执行

**状态：已修复（2026-11-15）**


- 位置：`backend/src/security.ts:163-168`、`backend/src/routes/system.ts:252`
- 问题：`isDocument()` 把任何无扩展名的非 `/api` GET 路径当作文档，写入 `Cache-Control: public, max-age=0, s-maxage=60` 与 `CDN-Cache-Control: public, s-maxage=60`。`/cron?key=...` 是执行调度任务的 GET 接口，因此同样会得到公共缓存头。
- 触发条件：启用旧版 API 兼容与外部 cron，站点前存在 CDN 或共享缓存，同一 cron URL 在 60 秒内被重复请求。
- 影响：CDN 可能直接返回缓存的 `success!`，请求不会到达源站，`runCron` 不执行，定时切换与优选任务被跳过。
- 修复建议：把 `/cron` 加入与 `/quicklogin` 相同的 `no-store` 分支；状态变更接口改用 POST 或专用不可缓存路径。

---

## 三、中危问题

### 7. 审计记录在数据库故障超过约 15 秒后丢失

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/audit/store.ts:208-222`
- 问题：同一批次只重试 3 次，超过后 `deadCount++` 直接丢弃；备注宣称「避免静默丢数据」，但 spool 落盘只在队列达到上限时发生，已入队的旧记录仍会被丢弃。
- 影响：数据库故障窗口内的审计记录无法追溯，而这正是审计系统最需要保留的时间段。
- 修复建议：首次写入失败即写 spool，或失败批次一直保留到 spool 上限；死信也要落盘，而不是只计数。

### 8. 封禁用户不吊销会话与保险库

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/user.ts:393`
- 问题：只执行 `UPDATE user SET status = ?`，没有自增 `token_version`，也没有清理该用户已解锁的保险库会话。鉴权层只在 `status === 0` 期间拒绝旧令牌。
- 触发条件：管理员封禁用户后再次解封，用户在封禁前签发的 JWT 仍在有效期内。
- 影响：解封后封禁前泄露或被盗的旧令牌重新生效；若该会话解锁过口令模式保险库，旧 jti 仍可读取私有凭据。
- 修复建议：封禁时自增 `token_version`，调用 `clearVaultSession(uid)`，并按需写入吊销表；解封不恢复旧会话。

### 9. API Key 过期时间为非法值时 fail-open

**状态：已修复（2026-11-15）**


- 位置：`backend/src/index.ts:369-374`
- 问题：`expires_at` 非空但无法解析时 `exp` 为 `NaN`，`Number.isFinite(exp) && exp <= Date.now()` 条件跳过，Key 被当作永不过期。
- 触发条件：数据库中的 `expires_at` 为 `0000-00-00 00:00:00` 等非法日期，或通过导入、手工 SQL 写入异常格式。
- 影响：本应失效的 Key 继续可用，形成凭据生命周期缺陷；列表接口的 `expired` 计算同样显示为未过期。
- 修复建议：`expires_at` 非空且解析失败时直接返回 401；创建与导入时校验日期格式。

### 10. API Key PATCH 可重新启用或延长更宽的 Key，且无作用域校验

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/apiKeys.ts:195-203`
- 问题：创建和 rotate 会执行 `apiKeyScopeError`，但 PATCH `active`、`expires_at`、`ip_allowlist` 时没有做作用域覆盖检查。
- 触发条件：用户先有一把作用域更宽、已被吊销的 Key，攻击者再用一把受限但仍含 `apikeys:write` 的 Key 将目标 Key 置为 `active=1` 或延长有效期。
- 影响：已吊销的泄露凭据被重新激活，受限 Key 间接恢复超出自身作用域的访问能力。
- 修复建议：PATCH 中对这三个字段同样调用 `apiKeyScopeError(req, parseScopes(row.scopes))`；更严格地只允许登录会话执行启用与延长。

### 11. 保险库接管级操作接受 API Key

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/reauth.ts:64-89`、`backend/src/routes/vault.ts:39-185`
- 问题：`requireLoginPassword` 只校验密码或 reauth token，不拒绝 `auth_type === 'api_key'`。作为对比，TOTP 配置和用户管理接口明确禁止 API Key。
- 触发条件：攻击者持有带 `vault:write` 的 API Key，并掌握账号登录密码，调用 `/api/vault/init`、`/api/vault/upgrade` 或 `/api/vault/destroy`。
- 影响：可绕过二次验证改变保险库保护方式或销毁私有凭据，API Key 是长期凭据且不经过 TOTP。
- 修复建议：对 vault 的 init/upgrade/downgrade/destroy/recovery/setRecovery 明确拒绝 API Key，要求真实登录会话并完成 reauth。

### 12. 注册码管理接口未拦截 API Key

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/register.ts:233-270`
- 问题：注册码查询与创建只检查 `checkLevel(req.user, 2)`。`moduleForPath` 将 `/api/register` 映射为 `users` 模块，管理员用户的 `users:read` API Key 可列出全部可用注册码，`users:write` 可批量创建注册码。
- 触发条件：管理员创建一把 `users:read` 或 `users:write` API Key；注册模式为 `reg_code` 且注册开放。
- 影响：只读作用域被用来获取可写凭据，进而创建账号，绕过 `backend/src/routes/user.ts:80` 中「API Key 不能创建账号」的限制。
- 修复建议：注册码管理接口拒绝 API Key；`users:read` 不返回注册码明文，至少返回掩码或数量。

### 13. `ConfigDecryptError` 返回 HTTP 200

**状态：已修复（2026-11-15）**


- 位置：`backend/src/index.ts:137-139`
- 问题：该分支调用 `reply.send()` 时没有设置 HTTP 状态码。`routes/cdn.ts` 与 `routes/domain.ts` 用该异常表示账户配置无法解密、保险库锁定等失败。
- 影响：HTTP 客户端、探针和 CDN 会把失败响应当作 200 成功，基于状态码的监控会漏报。
- 修复建议：按语义返回 423 或 409，保留 `{ code: -1, msg }` 结构。

### 14. 审计 `errmsg` 原样回传给普通用户

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/audit/hooks.ts:40-43`、`backend/src/routes/audit.ts:68-70`
- 问题：`onError` 把原始 `err.message` 写入 `reply.__auditMsg` 并落库到 `errmsg`；`/api/audit/logs` 会把 `errmsg` 返回给普通用户自己名下的记录。
- 触发条件：普通用户触发一个未捕获异常，例如数据库约束错误、表结构错误。
- 影响：5xx 响应本身隐藏了错误信息，但同一请求的审计记录会把 SQL 片段、表名、约束名、内部路径暴露给低权限用户。
- 修复建议：审计 `errmsg` 使用统一白名单清洗；对非管理员不返回 `errmsg`；5xx 内部错误只写服务端日志。

### 15. Cloudflare Zone 超过 50 个时拉取不全

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/domain.ts:386`、`backend/src/routes/domain.ts:757`
- 问题：翻页终止条件是本页条数 `< 100`，而 Cloudflare `/zones` 的 `per_page` 上限为 50，实际第一页只会返回 50 条，随即被判为「没有下一页」。
- 触发条件：Cloudflare 账户下 Zone 数量超过 50，包括接入校验与「拉取域名」列表。
- 影响：第 51 个之后的域名无法被拉取或接入，普通用户会被误报「该域名不在所选云账户的域名列表中」。
- 修复建议：优先用响应的 `total_count` 判断（`cloud.length >= total`），终止条件改为「本页 0 条」或依据 total，而不是硬编码 100。

### 16. DNS 检测的 `check_whole` 可越过子域名授权

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/dns/checkService.ts:96-131`、`backend/src/routes/dnscheck.ts:193-204`
- 问题：`scopeAdmin = isAdmin || check_whole`，不检查用户是否真有整域名授权；`canAccessDomain` 只校验 `sameDomain` 与 `readonly`，完全忽略 `p.sub`。
- 触发条件：管理员为用户开启「整域名检测」，而该用户只被授予某个子域名（如 `www`），并创建或保留未选子域名的任务。
- 影响：越权读取并接收整个 Zone 的记录值，告警邮件会带出异常记录的期望值与实际值，形成跨子域名数据泄露。
- 修复建议：`check_whole` 仅在有整域名授权时生效；`canAccessDomain` 在 `sub` 为空时要求存在 `p.sub === null` 的整域名授权。

### 17. 证书日志在订单处理结束后不可读

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/certService.ts:134-137`、`backend/src/routes/cert.ts:800-806`
- 问题：日志文件名取自 `processid`，而 `releaseLock()` 在处理结束后把 `processid` 置为 NULL。处理完成后 `/api/cert/orders/:id/log` 读到空值，直接返回「无日志」。旧日志文件也无稳定索引，`reset()` 删不到旧文件。
- 触发条件：任何一次证书订单自动或手动处理结束后查看日志，失败场景最需要日志。
- 影响：证书日志功能实际不可用，磁盘上还会持续堆积历史日志。
- 修复建议：为订单增加独立的稳定日志标识（如订单号加时间戳）或保留 `last_processid` 字段；`processid` 只用于租约锁。

### 18. 域名批量添加按空白切分会截断记录值

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/domain.ts:1375`
- 问题：`const [name, value] = ln.split(/\s+/)` 只取前两段作为主机记录与记录值。
- 触发条件：批量添加 TXT（`@ v=spf1 include:_spf.example.com ~all`）、MX（`@ 10 mail.example.com`）、SRV 等带空格的记录。
- 影响：实际写入的值被静默截断（TXT 只写入 `v=spf1`），属于数据损坏，接口仍提示成功。
- 修复建议：只按第一个空白切出主机记录，剩余整段作为记录值；或使用明确的 Tab 分隔格式并校验。

### 19. 域名接入时清权限与插入不在同一事务

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/domain.ts:801-804`
- 问题：先执行 `clearDomainPermissions([domainName])` 清理同名授权，再单独 INSERT 域名，两步没有事务包裹。
- 触发条件：INSERT 失败，例如并发下 `(aid, name)` 唯一键冲突或数据库异常。
- 影响：旧授权已被删除但域名没有接入成功，权限丢失且无法自动恢复。
- 修复建议：把两步放进同一个 `withTransaction`，失败整体回滚。

### 20. DNS 检测任务编辑或启用后不重算 `next_run`

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/dnscheck.ts:139-154`
- 问题：编辑任务与启用/停用任务时只更新表单字段与 `active`，没有重新计算 `next_run`。
- 触发条件：修改 `cycle`、`interval_min`、`run_time`；或任务停用超过一个周期后重新启用。
- 影响：任务在错误时间执行或立即触发一次；修改频率后行为与配置不一致，直到下一次运行才纠正。
- 修复建议：命中周期字段或 `active: 1` 时调用 `calcNextRun` 更新 `next_run`；停用时可将 `next_run` 置空。

### 21. 部署任务在加锁前检查状态，可能重复部署

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/deployService.ts:106-135`
- 问题：`if (this.task.status >= 1) return` 在 `lockTask()` 之前，锁后不复检。
- 触发条件：调度器与管理员手动触发同时处理同一部署任务。
- 影响：两个调用都读到 `status=0`，A 部署成功并释放锁后，B 仍能拿到锁再部署一遍，重复上传证书、重复调用云 API，部署日志与重试计数被污染。
- 修复建议：`takeTaskLock` 成功后重新读取任务，`status >= 1` 或重试超限则立即释放返回。

### 22. SSH 部署无连接与执行超时，未监听 stream error

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/deploy/providers/ssh.ts:130-158`、`backend/src/lib/deploy/providers/ssh.ts:228-250`
- 问题：`connectConfig` 未设置 `readyTimeout`；`exec` 只监听 `data`、`stderr`、`close`，未监听 `stream.on('error')`。
- 触发条件：目标主机建立 TCP 后不响应 SSH 握手；或命令执行流触发 `error` 事件。
- 影响：部署任务长时间挂起并持有 `cert_deploy.islock`（租约 1 小时），期间无法重试；`error` 事件无监听器会升级为未捕获异常。
- 修复建议：设置 `readyTimeout`；`exec` 增加 `stream.on('error', reject)` 与超时销毁。

### 23. `replace` 导入不保证导入后仍有可用管理员

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/backup/import.ts:260-269`
- 问题：事务内先对除 `config` 外的全部表执行 `DELETE FROM`，再按归档中存在的表插入；只有 `install` 模式检查了归档内是否存在 `level >= 2` 的用户。`invalidateSessions` 还会让所有 JWT 失效。
- 触发条件：以 `replace` 方式恢复不含 `user` 表、或用户表内没有管理员的整站归档（旧格式、被裁剪、导出自空用户表的实例）。
- 影响：提交后 `user` 表为空，登录接口无账号可用，自救接口也因未登录全部 403，只能进数据库手工修复。
- 修复建议：`replace` 成功后统计可用管理员数量，为 0 则抛错回滚；或在 `openArchive` 后先扫描归档确认存在可登录管理员。

### 24. CDN 缓存规则先下发云端再写库，写库失败无回滚

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/cdn.ts:4560-4566`
- 问题：`provider.setCacheRules` 成功后，`withTransaction` 内的 DELETE 与 INSERT 失败时没有补偿。
- 触发条件：云端下发成功后数据库写库失败，例如数据库抖动或连接池耗尽。
- 影响：云端已生效新规则，本地仍显示旧规则；后续按本地规则再保存会把云端覆盖回旧值，用户难以判断实际状态。
- 修复建议：捕获本地写库错误时返回明确提示并提供重新同步入口，或先写本地「待同步」状态再下发。

### 25. `syncFromCloud` 全表加载并逐域名串行写 DNS

**状态：部分修复（2026-11-15）**：已加账户级同步串行锁、改为按需列查询、唯一键冲突跳过；DNS 记录写入仍为串行，后续可改为并发池。


- 位置：`backend/src/routes/cdn.ts:5895-5935`
- 问题：每次同步把 `domain`、`account`、`cdn_domain` 整表读入内存，对每个新域名顺序调用 `dns.addDomainRecord`。`POST /api/cdn/domains` 在请求内直接调用它，且没有加锁。
- 触发条件：大型账户（数千云端域名）执行同步或接入域名；并发同步发生唯一键冲突。
- 影响：请求超时、同步中断返回 500（域名实际已创建）、重复 CNAME、多次上游调用。
- 修复建议：统一走 `dnsmgr:cdn-sync:{aid}` 锁并改为后台任务；INSERT 使用 `INSERT IGNORE` 或捕获重复键后跳过；DNS 记录写入用并发池限流。

---

## 四、低危与体验问题

### 26. 批量启用/暂停/删除全部失败仍返回 `code: 0`

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/domain.ts:1291-1311`
- 问题：写阶段无论成功多少都返回 `code: 0`，`fail` 计算后未使用；`value`、`line` 全部失败也返回 `code: 0`。
- 影响：客户端认为操作成功而实际未生效。
- 修复建议：统一返回成功与失败明细；`success === 0` 时返回错误码；`delete` 按实际成功数回写计数。

### 27. `quickinfo`、`groups`、`weight` 要求整域名授权

**状态：已修复（2026-11-15）**：`quickinfo`、`groups`、`weight` 已改为「存在该域名任意授权」；别名与解析日志返回整域名数据，仍要求整域名授权，避免子域名用户看到其他子域名的记录名。


- 位置：`backend/src/routes/domain.ts:1409-1429`
- 问题：这些接口用 `matchPermission(acc.perms, domain, '@') >= 0` 判权，只有整域名授权才通过，而子域名授权用户本可读写其子域名记录。
- 影响：批量分组、权重、别名、日志等入口对子域名授权用户不可用，与 `/records` 口径不一致。
- 修复建议：读取类辅助接口改为「存在该域名的任意授权」即可，与记录接口口径统一。

### 28. MX 优先级 0 被静默改成 1

**状态：已修复（2026-11-15）**


- 位置：`backend/src/routes/domain.ts:1050`、`backend/src/routes/domain.ts:1140`、`backend/src/routes/domain.ts:1368`
- 问题：使用 `Number(mx || 1)`，合法的 0 被视为空值。
- 影响：无法写入 MX 优先级 0；编辑既有 MX=0 记录会被改成 1。
- 修复建议：先判断 `mx === undefined || mx === null || mx === ''` 再回退默认值，使用 `Number(mx)`。

### 29. 导入临时文件清理不检查 `isTempActive`

**状态：已修复（2026-11-15）**


- 位置：`backend/src/lib/backup/archive.ts:619-638`
- 问题：`openArchive` 特意 `markTempActive(tmp)`，但 `cleanStaleImportFiles` 只按 mtime 判断，未调用 `isTempActive`，与 `export.ts:579` 的清理任务不一致。
- 触发条件：超过 1 小时的超大归档导入正在进行，此时另一个 `openArchive` 被调用。
- 影响：正在读取的临时文件被删除，导入中途失败；该文件包含全站明文凭据。
- 修复建议：清理循环内增加 `if (isTempActive(file)) continue;`。

### 30. 前端 JWT 明文存 localStorage

**状态：保留（2026-11-15）**：改为 HttpOnly Cookie 需要前后端认证体系同步改造，本次不做；现有 CSP 与短时效令牌已降低风险。


- 位置：`frontend/src/api.ts:1-8`
- 问题：`setToken` 直接 `localStorage.setItem`，令牌不随标签页关闭失效。
- 触发条件：任意 XSS、供应链脚本或恶意扩展在页面域执行。
- 影响：攻击者可直接复用管理员令牌操作 DNS、CDN、证书与保险库。当前 CSP 已限制 `script-src 'self'`，风险有所降低。
- 修复建议：改为 HttpOnly + Secure + SameSite Cookie 会话；若必须用 Header，使用短时效 token 加刷新机制。

### 31. 证书与部署列表只取 `limit=200` 且无分页

**状态：已修复（2026-11-15）**


- 位置：`frontend/src/views/CertOrder.vue:275`、`frontend/src/views/DeployTask.vue:211`
- 问题：`GET /cert/orders?limit=200`、`GET /deploy/tasks?limit=200` 只拉第一页，表格没有分页器。
- 影响：超过 200 条的记录在界面上消失，无法查看、续期、删除或重试。
- 修复建议：改用 `offset/limit` 服务端分页并接 `itemCount`。

### 32. 网络异常后 loading 永久卡死

**状态：已修复（2026-11-15）**


- 位置：`frontend/src/views/CdnDomain.vue:802-811`（另有 817、828、841、855）、`frontend/src/views/CfTunnels.vue:238-246`
- 问题：`busy = true` 后直接 `await api(...)`，网络异常或 401 抛错时不执行后面的复位语句。
- 影响：证书管理弹窗整体永久转圈，同步按钮永久 loading，用户只能关闭重开。
- 修复建议：统一改为 `try { ... } catch { message.error } finally { busy = false }`。

### 33. CdnZone 账户站点加载失败静默丢弃，`loadPlans` 存在竞态

**状态：已修复（2026-11-15）**


- 位置：`frontend/src/views/CdnZone.vue:290-310`、`frontend/src/views/CdnZone.vue:384-403`
- 问题：失败账户的 `results[i]` 被置空且无提示；`loadPlans` 没有请求序号或 AbortController，快速切换账户时旧响应会覆盖新的 `planOptions`。
- 影响：失败账户的站点从列表中静默消失；可能以错误账户的实例与套餐提交创建请求。
- 修复建议：失败账户保留上次数据并标记错误；`loadPlans` 增加 `seq` 校验或取消旧请求。

### 34. 自定义时间范围只选一端时静默回退

**状态：已修复（2026-11-15）**


- 位置：`frontend/src/components/statistics/RangeFilter.vue:107-127`、`frontend/src/views/Statistics.vue:101-104`
- 问题：`syncParts` 在只有开始或结束时间时仍发出 `change`，并把 `customRange` 置 null；父组件直接回退为近 24 小时。
- 影响：页面显示为自定义范围，实际查询的是另一段时间，统计结论误导决策。
- 修复建议：两端未齐全时不触发查询，或给出校验提示并禁止请求。

### 35. 定时器未在卸载时清理

**状态：已修复（2026-11-15）**


- 位置：`frontend/src/components/ResponsiveDataTable.vue:364-378`、`frontend/src/views/UserList.vue:322-328`、`frontend/src/views/DnsCheckTask.vue:343-348`
- 问题：`resizeTimer` 是 `onMounted` 内的局部变量，`onBeforeUnmount` 只断开 ResizeObserver；远程搜索防抖定时器卸载时也未清理。
- 影响：组件卸载后仍会执行一次测量或发出一次请求，写入已销毁组件的状态。
- 修复建议：把定时器提升到 setup 作用域，并在 `onBeforeUnmount` 中 `clearTimeout`。

### 36. 账号编辑弹窗依赖异步 providers，过早点击会丢配置项

**状态：已修复（2026-11-15）**


- 位置：`frontend/src/views/CdnAccount.vue:128-209`、`frontend/src/views/DnsAccount.vue:234-237`
- 问题：`onMounted` 并发执行 `loadProviders()` 与 `loadAccounts()`，`openEdit` 从 `providers.value[form.type]` 取 `currentProvider`，之后没有 watcher 回填。
- 触发条件：在 providers 接口返回前点击编辑，或该接口失败。
- 影响：编辑弹窗中账号密钥与配置字段全部缺失，用户无法修改凭据。
- 修复建议：先 `await loadProviders()` 再加载账户，或在 `openEdit` 时按需等待 providers 并用缓存兜底。

### 37. 乐观删除回滚使用过期索引

**状态：已修复（2026-11-15）**


- 位置：`frontend/src/views/CdnDomain.vue:1564-1580`、`frontend/src/views/UserList.vue:537-552`
- 问题：删除前记录 `idx` 并 splice，失败后用 `splice(idx, 0, removed)` 回滚；请求期间若自动刷新完成，新列表可能已重新包含该行。
- 影响：回滚后同一行出现两份或位置错乱，用户可能重复操作。
- 修复建议：回滚前按 id 重新查找位置，已存在则跳过；或失败后直接重新拉取列表。

---

## 五、核查后未发现问题的部分

- SQL 注入：动态拼接处来自白名单或数据库元数据（`schedule.ts` 排序、`CDN_SYNC_COLUMNS`、`export.ts` 的 `ORDER BY \`pk\``），未发现用户可控标识符拼接。
- 命令注入：`lib/deploy/providers/local.ts` 走 `commandArgv` + `execFile`（无 shell），`ssh.ts` 的 IIS 分支对 domain/pass/key/path 做了字符集白名单，`fnos.ts` 的单引号转义正确。
- SSRF：事件回调、WebDAV、S3、部署目标均经过 `assertUrlAllowed`、`safeFetch` 或 `assertNotMetadataHost`，重定向逐跳复校。
- `/api/v1` 前缀限流：Fastify 5 的 `wrapRouting` 会在路由前改写 `req.url`，基于 `req.raw.url` 的限流匹配不受影响，不存在此前假设的绕过。
- DNS 本地解析：`localResolve` 已对 MX、TXT、SRV 做结构映射，不存在对象被 `String()` 成 `[object Object]` 的问题。
- 前端 i18n：静态 key 与 zh-CN/en-US 双包对称，未发现缺失 key。

---

## 六、建议修复顺序

1. P0：编号 1（证书误吊销）、2（任务锁永久卡死）、3（CDN 并发补偿）、4（恢复码明文审计）、5（恢复失败锁站）、6（cron 缓存）。
2. P1 安全与凭据：编号 8（封禁不吊销）、9（Key 过期 fail-open）、10（Key PATCH 越权）、11（保险库 API Key）、12（注册码 API Key）、13（错误码 200）、14（审计 errmsg）。
3. P1 功能与数据一致性：编号 7（审计丢弃）、15（Zone 分页）、16（检测越权）、17（证书日志）、18（批量截断）、19（接入事务）、21（重复部署）。
4. P1 稳定性：编号 20、22、23、24、25。
5. 低危与前端问题随对应模块迭代处理，优先编号 31、32、35（用户可直接感知）。

---

## 附录：问题索引

| 编号 | 级别 | 位置 | 摘要 |
|------|------|------|------|
| 1 | 高危 | `backend/src/lib/cdn/certLink.ts:455-512` | 删除 CDN 域名连带吊销共享证书 |
| 2 | 高危 | `backend/src/lib/cert/certTaskService.ts:40-71`、`backend/src/lib/certService.ts:118-137` | 任务锁无租约回收 |
| 3 | 高危 | `backend/src/routes/cdn.ts:4290-4365` | CDN 接入并发补偿误删 |
| 4 | 高危 | `backend/src/routes/vault.ts:133-145`、`backend/src/lib/audit/mask.ts:6` | 恢复码明文入审计 |
| 5 | 高危 | `backend/src/lib/backup/restore.ts:71,129-138` | 恢复失败仍锁维护模式 |
| 6 | 高危 | `backend/src/security.ts:163-168`、`backend/src/routes/system.ts:252` | `/cron` 被公共缓存 |
| 7 | 中危 | `backend/src/lib/audit/store.ts:208-222` | 审计重试超限丢弃 |
| 8 | 中危 | `backend/src/routes/user.ts:393` | 封禁不吊销会话与保险库 |
| 9 | 中危 | `backend/src/index.ts:369-374` | API Key 过期时间 fail-open |
| 10 | 中危 | `backend/src/routes/apiKeys.ts:195-203` | Key PATCH 越权启用/延长 |
| 11 | 中危 | `backend/src/lib/reauth.ts:64-89`、`backend/src/routes/vault.ts:39-185` | 保险库操作接受 API Key |
| 12 | 中危 | `backend/src/routes/register.ts:233-270` | 注册码接口未拦截 API Key |
| 13 | 中危 | `backend/src/index.ts:137-139` | 解密错误返回 200 |
| 14 | 中危 | `backend/src/lib/audit/hooks.ts:40-43`、`backend/src/routes/audit.ts:68-70` | 审计 errmsg 泄露内部信息 |
| 15 | 中危 | `backend/src/routes/domain.ts:386,757` | Cloudflare Zone 分页漏数据 |
| 16 | 中危 | `backend/src/lib/dns/checkService.ts:96-131` | 检测越权到整域名 |
| 17 | 中危 | `backend/src/lib/certService.ts:134-137`、`backend/src/routes/cert.ts:800-806` | 证书日志不可读 |
| 18 | 中危 | `backend/src/routes/domain.ts:1375` | 批量添加截断记录值 |
| 19 | 中危 | `backend/src/routes/domain.ts:801-804` | 接入清权限与插入非事务 |
| 20 | 中危 | `backend/src/routes/dnscheck.ts:139-154` | 任务编辑不重算 next_run |
| 21 | 中危 | `backend/src/lib/deployService.ts:106-135` | 部署任务重复执行 |
| 22 | 中危 | `backend/src/lib/deploy/providers/ssh.ts:130-158,228-250` | SSH 无超时与 error 监听 |
| 23 | 中危 | `backend/src/lib/backup/import.ts:260-269` | replace 导入可致无管理员 |
| 24 | 中危 | `backend/src/routes/cdn.ts:4560-4566` | 缓存规则云端/本地不一致 |
| 25 | 中危 | `backend/src/routes/cdn.ts:5895-5935` | 同步全表加载与串行写 |
| 26 | 低危 | `backend/src/routes/domain.ts:1291-1311` | 批量操作恒返回成功 |
| 27 | 低危 | `backend/src/routes/domain.ts:1409-1429` | 辅助接口要求整域名授权 |
| 28 | 低危 | `backend/src/routes/domain.ts:1050,1140,1368` | MX 优先级 0 变 1 |
| 29 | 低危 | `backend/src/lib/backup/archive.ts:619-638` | 清理不看 isTempActive |
| 30 | 低危 | `frontend/src/api.ts:1-8` | JWT 明文存 localStorage |
| 31 | 低危 | `frontend/src/views/CertOrder.vue:275`、`DeployTask.vue:211` | 列表限 200 无分页 |
| 32 | 低危 | `frontend/src/views/CdnDomain.vue:802-811`、`CfTunnels.vue:238-246` | 异常后 loading 卡死 |
| 33 | 低危 | `frontend/src/views/CdnZone.vue:290-310,384-403` | 静默丢站点与套餐竞态 |
| 34 | 低危 | `frontend/src/components/statistics/RangeFilter.vue:107-127` | 自定义范围静默回退 |
| 35 | 低危 | `frontend/src/components/ResponsiveDataTable.vue:364-378`、`UserList.vue:322-328` | 定时器未清理 |
| 36 | 低危 | `frontend/src/views/CdnAccount.vue:128-209`、`DnsAccount.vue:234-237` | 编辑依赖 providers 竞态 |
| 37 | 低危 | `frontend/src/views/CdnDomain.vue:1564-1580`、`UserList.vue:537-552` | 乐观回滚索引过期 |
