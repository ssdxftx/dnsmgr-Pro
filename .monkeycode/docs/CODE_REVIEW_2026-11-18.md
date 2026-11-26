# 代码审查报告（第三轮）

- 审查日期：2026-11-18
- 审查基线：`1.35.9`（提交 `3d1adcf`）
- 审查范围：`backend/src`（270 个文件，约 6.8 万行）、`frontend/src`（214 个文件，约 5.6 万行）、`backend/scripts`
- 审查方式：全量静态走查、跨文件调用链核对、关键路径逐行复核、`tsc --noEmit`、`vue-tsc --noEmit`、`vite build`
- 复核标记：★ 表示已由审查人逐行复核确认，未标记条目为静态审查的高置信度问题
- 本轮结论：未发现编译或构建错误；确认 7 个严重问题、15 个高风险问题，以及一批中低风险问题，集中在权限作用域、证书/部署状态机、备份恢复完整性、审计完整性、时区与前端错误处理

本次审查初版未修改源码。2026-11-18 起按报告执行修复，严重与高风险项已完成并在下文标记。为执行类型检查与构建验证，已安装前后端依赖并生成 `frontend/dist`。

---

## 一、总览

### 1.1 风险统计

| 级别 | 数量 | 主要影响 |
|------|------|----------|
| 严重 | 7 | 跨租户 DNS 越权、旧证书误删、缓存规则失效、证书重复签发、私有凭证不可用、证书无限重试、审计丢失 |
| 高 | 15 | 备份恢复数据错位/丢失、PowerDNS 记录错位、旧 API Key 绕过治理、安装与登录态前端缺陷 |
| 中 | 100 | 鉴权细节、事务与并发、第三方适配、时区、导入导出、前端 loading 与请求竞态 |
| 低 | 13 | 类型约定、长度校验、文案、日志脱敏、可维护性 |

### 1.2 问题清单（严重与高）

| 编号 | 级别 | 模块 | 问题 | 复核 | 状态 |
|------|------|------|------|------|------|
| S1 | 严重 | 权限 | 私有域名隐式授权按名称泄漏到共享账户 | ★ | 已完成 |
| S2 | 严重 | 部署 | 腾讯云上传失败后仍删除旧证书 | ★ | 已完成 |
| S3 | 严重 | CDN | 阿里云 CDN 全局规则权重最大，覆盖具体规则 | ★ | 已完成 |
| S4 | 严重 | 证书 | 加锁前加载订单且加锁后不重读，可重复签发 | ★ | 已完成 |
| S5 | 严重 | 证书/部署 | 私有账户凭证被解为空配置 | ★ | 已完成 |
| S6 | 严重 | 证书 | 前置校验失败不落终态，订单无限重试 | ★ | 已完成 |
| S7 | 严重 | 审计 | 脱敏深度失效，深层 JSON 使审计记录丢失 | ★ | 已完成 |
| H1 | 高 | DNS | PowerDNS Zone ID 带尾点导致记录名错位 | ★ | 已完成 |
| H2 | 高 | 备份 | `cert_link_log.did` 被当作 DNS 域名 ID 映射 | ★ | 已完成 |
| H3 | 高 | 备份 | merge 导入唯一键冲突导致整单回滚 | ★ | 已完成 |
| H4 | 高 | 备份 | 恢复前快照排除部分用户，回滚数据不完整 | ★ | 已完成 |
| H5 | 高 | 备份 | 恢复后清理路径同步抛错，维护模式卡死 | ★ | 已完成 |
| H6 | 高 | 备份 | 导出中间文件含明文凭据且未登记清理 | ★ | 已完成 |
| H7 | 高 | CDN | ESA 删除全局规则后旧规则继续生效 | ★ | 已完成 |
| H8 | 高 | 统计 | EdgeOne 多站点带宽互相覆盖 | ★ | 已完成 |
| H9 | 高 | 鉴权 | 旧版明文 API Key 回退绕过新 Key 治理 | ★ | 已完成 |
| H10 | 高 | 前端 | 注册码最大使用次数字段名不匹配 | ★ | 已完成 |
| H11 | 高 | 前端 | 解析记录页切换子域名不刷新 | ★ | 已完成 |
| H12 | 高 | 前端 | 安装状态缓存导致安装完成后跳回安装页 | ★ | 已完成 |
| H13 | 高 | 前端 | TOTP 绑定后 Pinia token 不同步，登出无法吊销新会话 | ★ | 已完成 |
| H14 | 高 | 统计 | 多域名命中率使用全账户流量加权 | ★ | 已完成 |
| H15 | 高 | Cloudflare | 账户级代理开关失效，始终走系统代理 | ★ | 已完成 |

---

## 二、严重问题

### S1 跨租户 DNS 越权（高危提权）

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/accounts/visibility.ts:50-62`
- `backend/src/routes/domain.ts:259-270`、`backend/src/routes/domain.ts:425-441`、`backend/src/routes/domain.ts:1055-1063`

**问题**

`getEffectivePermissions()` 把用户自己私有 DNS 账户下的域名，按**域名名称**追加为整域名可写权限：

```ts
SELECT D.name FROM domain D JOIN account A ON D.aid = A.id
 WHERE A.visibility = 'private' AND A.owner_uid = ?
```

`writeErr()` 调用 `matchPermission()` 时只比较 `domain` 名称；`getDomainWithAccount()` 对共享账户不做归属限制。普通用户可创建私有 DNS 账户，并在自己的云账户中添加与目标同名的 Zone，随后用组织共享账户中同名域名的 `domain.id` 调用记录写入接口。

**影响**

- 已注册普通用户可读取、新增、修改、删除共享账户中同名域名的解析记录；
- 共享账户通常存放生产云凭据，影响面覆盖整站 DNS；
- 属于跨租户 DNS 劫持，可进一步用于证书签发、流量劫持。

**修复建议**

- 隐式权限携带 `domainId` 或 `aid`，写操作按目标 domain 行校验归属；
- `matchPermission` 增加账户维度，禁止仅凭名称跨账户匹配；
- 共享账户写操作要求管理员或显式授权，并在授权记录中保存 `domainId`。

---

### S2 腾讯云部署失败后仍删除旧证书

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/deploy/providers/tencent.ts:465-531`

**问题**

`updateCertNew()` 在“未检测到关联资源”分支中上传新证书，异常被 `catch` 吞掉并只写日志，`newCertId` 保持 `null`。随后：

```ts
if (config.delete_old_cert) {
  if (newCertId && newCertId === oldCertId) { /* 跳过 */ }
  else { await DeleteCertificate({ CertificateId: oldCertId }); }
}
```

资源更新分支同样在 `findNewCertId()` 返回 `null` 时删除旧证书。

**影响**

- 旧证书被删除，CDN/CLB/WAF 等实例仍引用旧 CertificateId；
- HTTPS 中断，本地 `config.cert_id` 指向已删除证书；
- 后续续签链路持续失败，需要人工恢复证书。

**修复建议**

- 上传失败直接抛错，禁止进入删除分支；
- `findNewCertId()` 为空时跳过删除并告警；
- 删除前校验目标资源已切换到新证书。

---

### S3 阿里云 CDN 全局规则权重倒置

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/cdn/providers/AliyunCDN.ts:191-219`

**问题**

权重从 `list.length + (globalRule ? 1 : 0)` 开始递减，全局规则 `/` 拿到最大权重。阿里云 CDN 的语义是权重越大优先级越高，命中后不再匹配后续规则。

**影响**

- 全局规则先命中所有请求，目录/后缀/全路径规则全部失效；
- 用户配置的细粒度 TTL 不生效，可能出现应刷新的内容长期不刷新，或动态内容被长缓存；
- 权重最大值随规则数增长，超过阿里云 1~99 限制时整批配置可能被拒绝。

**修复建议**

- 全局规则权重固定为 1，具体规则从 2 递增；
- 权重裁剪到 1~99，规则数超限时在保存阶段拒绝；
- 目录规则按阿里云要求传入规范化目录路径。

---

### S4 证书订单可被并发重复签发

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/certService.ts:118-129`、`backend/src/lib/certService.ts:216-249`

**问题**

`process()` 先 `load()` 订单并执行 `checkDomains()`，之后才 `takeLock()`；`takeLock()` 的 UPDATE 只判断 `islock/locktime`，不校验订单状态；加锁成功后没有重新读取订单。

**影响**

- 两个 worker 同时读到 `status=0` 时，可先后加锁并重复购买、创建订单、添加挑战记录、签发证书；
- 旧 worker 的 `saveResult()` 按 id 无条件更新，能覆盖新 worker 已写入的 `status=3`；
- 免费证书额度被额外消耗，订单状态与实际证书不一致。

**修复建议**

- 加锁成功后重新 `SELECT`，状态已变化则立即返回；
- 把期望状态/版本号放进加锁 UPDATE 的 WHERE 条件；
- 状态写入携带租约 token 做 fencing，租约失效时放弃写入。

---

### S5 私有账户凭证在证书/部署后台任务中被解为空配置

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/certService.ts:59-66`
- `backend/src/lib/deployService.ts:26-39`

**问题**

两处都用 `decryptConfig()` 解密 `account.config`。私有账户配置由 `encryptAccountConfig(config, true, dek)` 写成 `enc:u1:` 保险库密文，`decryptConfig()` 会返回 `null`，随后以 `{}` 构造厂商客户端。项目内其他后台路径已改用 `loadAccountConfig()`（`backend/src/lib/certDns.ts:18-20`、`backend/src/lib/cdn/preheatService.ts:28`）。

**影响**

- 私有证书/部署账户签发与部署时使用空 AK/SK/Token，必然失败；
- 失败状态可能被记录为普通厂商错误，排查困难；
- 与项目内“私有账户仅所有者可用”的设计不一致。

**修复建议**

- 统一改用 `loadAccountConfig()`；
- 请求内路径优先使用会话 DEK（`findVaultDekForRequest`）；
- `locked/error` 时 fail-fast 写入明确失败状态，禁止静默降级为空配置。

---

### S6 证书订单失败无终态，会无限重试

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/certService.ts:170-193`、`backend/src/lib/certService.ts:224-249`
- `backend/src/lib/cert/certTaskService.ts:58-69`、`backend/src/lib/cert/certTaskService.ts:162-171`

**问题**

`checkDomains()` 对“域名未在本系统添加”“私有账户不属于当前证书账户”等情况只写 `error` 后 `throw`，不调用 `saveResult()`，订单保持 `status=0`。`retry2 >= 3` 时在 `process()` 入口直接抛错，同样不写终态。`findRunningOrders()` 持续选中 `status=0`，`ensureNextRun()` 每轮把 `retrytime` 推后 5 分钟。

**影响**

- 订单永久占用调度名额，日志与通知反复处理；
- 用户看到“待提交/失败”，系统永不停止重试；
- 达到最大重试次数后依然继续调度。

**修复建议**

- 所有前置校验错误统一包装为 `saveResult(-x)`；
- `retry2` 达到上限时写入明确终态，并停止被调度；
- `findRunningOrders` 增加 `retry2 < 3` 或等价终态过滤。

---

### S7 审计脱敏递归深度失效，审计记录可被静默丢弃

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/audit/mask.ts:12-30`
- `backend/src/lib/audit/hooks.ts:45-52`

**问题**

`truncate(v, depth)` 本应限制 4 层，但对象分支通过 `maskValue(k, val)` 回到 `truncate(value, 0)`，深度计数被重置：

```ts
for (const [k, val] of Object.entries(v)) out[k] = maskValue(k, val); // maskValue -> truncate(value, 0)
```

约 5000 层嵌套对象（约 25KB，低于默认 bodyLimit）即可触发 `RangeError: Maximum call stack size exceeded`。`onResponse` 中的 `try { collect() } catch {}` 会吞掉异常，该请求的审计行直接丢失。

**影响**

- 任意已登录用户对任意写接口携带深层嵌套 JSON，即可让自己的高危操作不产生审计记录；
- 审计证据完整性被破坏，事后追责困难；
- 深层嵌套还可能消耗 CPU。

**修复建议**

- 把 `depth` 贯穿到 `maskValue`/`truncate`，禁止重置为 0；
- 对请求体做深度与节点数硬限制，超限返回 413 或只记录占位符；
- `collect()` 失败时降级写入最小审计行（method/route/uid/status）。

---

## 三、高风险问题

### H1 PowerDNS Zone ID 带尾点导致记录名错位

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/dns/providers/powerdns.ts:84-118`
- `backend/src/lib/dns/providers/powerdns.ts:292-323`

**问题**

PowerDNS 的 zone `id` 形如 `example.com.`，`getDomainList()` 把 `row.id` 原样作为 `DomainId` 返回，最终存入 `domain.thirdid`。`getDomainRecords()` 先把 `row.name` 去尾点再与带尾点的 `this.domainid` 比较，比较失败；`rrsetReplace/rrsetDelete` 直接拼接 `host + '.' + this.domainid`。

**影响**

- 记录列表的名称变成完整 FQDN；
- 子域名授权过滤全部落空；
- 证书挑战记录的匹配与删除失效，产生残留 TXT；
- UI 编辑记录可能写入错误名称。

**修复建议**

- 区分“API 路径用 canonical id”和“比较/展示用去尾点域名”；
- 比较前对双方统一 `trim().toLowerCase().replace(/\.$/, '')`；
- 写入 RRset 前重新拼装规范 FQDN。

---

### H2 备份恢复把 `cert_link_log.did` 当 DNS 域名 ID 映射

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/backup/import.ts:708-746`
- `backend/src/lib/backup/export.ts:195-255`

**问题**

`cert_link_log.did` 实际是 `cdn_domain.id`（见 `backend/src/lib/cdn/certLink.ts:43`、`backend/src/routes/cdn.ts:5074-5093`），导入时却与 `domain_alias/cert_cname/dmtask` 同组使用 `didMap`；导出过滤同样用 `ex.domains/ctx.domainIds`。

**影响**

- 恢复后联动日志被丢弃，或挂到数值相同的另一个 DNS 域名；
- `setCertMode()` 回查最新订单时命中错误记录，可能启用/停用另一个加速域名的部署任务；
- 整站归档可能漏掉被排除用户的联动日志。

**修复建议**

- `cert_link_log` 单独处理，`did` 使用 `cdidMap`；
- 导出过滤改用 `ex.cdnDomains/ctx.cdnDomainIds`。

---

### H3 merge 导入遇到唯一约束冲突会整单回滚

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/backup/import.ts:714-746`
- `backend/src/migrate.ts:448-463`

**问题**

`dmtask`、`sctask`、`cdn_cache_rule`、`backup_destination` 等子表直接 `insertRow`。`migrate.ts` 为 `dmtask(did,recordid)`、`sctask(did,recordid,switchtype,switchtime)` 建了唯一索引。merge 模式复用既有域名 id 时，同一解析记录的任务必然冲突。

**影响**

- 任意一条重复 task 都会抛错，`withTransaction` 整体回滚；
- 用户看到“导入失败”，其余可合并数据也全部丢失；
- 部分表则相反，会重复插入。

**修复建议**

- 对这些表按业务唯一键先查后跳过，或捕获 `isDuplicateError` 后计入 `reused`；
- 与 `domain/account/api_key` 的合并策略保持一致。

---

### H4 恢复前的回滚快照不完整

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/backup/restore.ts:77`
- `backend/src/lib/backup/export.ts:469-476`

**问题**

`pre_restore` 快照使用 `scope:'site'`，会排除 `user_vault.exclude_from_site_backup=1` 的用户及其私有账户、域名、任务。

**影响**

- 该快照被当作恢复失败时的唯一回退点；
- replace 导入中途失败回滚时，这些用户的数据会静默丢失；
- 事后难以判断快照本身就不完整。

**修复建议**

- `kind='pre_restore'` 强制忽略 `exclude_from_site_backup`；
- 增加 `forceFull` 选项，并校验快照覆盖 `user` 全量。

---

### H5 恢复成功后清理旧备份可能抛错并卡住维护模式

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/backup/restore.ts:105-114`

**问题**

```ts
if (job.file_name) await unlink(resolveArchivePath(String(job.file_name))).catch(() => undefined);
```

`resolveArchivePath()` 对非法文件名是同步抛出，异常发生在 `unlink(...)` 求值阶段，`.catch()` 覆盖不到。该代码位于 `importArchive` 成功提交之后。

**影响**

- `backup_job.file_name` 存在历史脏值时，数据已替换成功但任务被标记失败；
- `importStarted=true` 导致不解除维护模式，全站写请求持续 503；
- 需要人工介入恢复服务。

**修复建议**

- 把 `resolveArchivePath` 放进 `try/catch`；
- 清理失败不得影响恢复结果状态；
- 对历史脏值单独记录告警。

---

### H6 导出中间文件含明文凭据且未登记清理

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/backup/export.ts:339-360`、`backend/src/lib/backup/export.ts:579-599`

**问题**

`spoolTables()` 把每张表写成 `data/tmp/export-*/*.ndjson`，内容来自 `encodeStoredValue`，`enc:v1/enc:v2` 会被解密为 `{__encv1: 明文}`，即 spool 目录保存了全站明文凭据。目录只设置了 `0700/0600`，没有调用 `markTempActive`。`cleanTmpFiles()` 每小时清理一次超过 6 小时且未登记的条目。

**影响**

- 单表 spool 写盘超过 6 小时，清理任务会删除正在写入的目录，导出失败；
- 进程崩溃时明文凭据滞留到下一次清理；
- 多副本部署下 `tmpRegistry` 是进程内的，其他实例看不到本实例的临时文件。

**修复建议**

- 导出 spool 目录与文件逐个 `markTempActive`/`markTempDone`；
- 清理时同时检查目录内文件的 mtime；
- 多副本场景使用持久化登记或锁文件。

---

### H7 阿里云 ESA 删除全局缓存规则后旧规则继续生效

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/cdn/providers/AliyunESA.ts:426-463`

**问题**

只有本次规则列表包含全局规则时才更新基础名称 `dnsmgr_cache_<domain>`；清理逻辑只删除 `_1.._N` 后缀规则。用户删除全局规则或清空全部缓存规则后，旧的基础名称规则永远残留，并保留旧 `Sequence`。

**影响**

- 云端仍按旧 TTL 缓存整站；
- 旧全局规则可能压过新调整的具体路径规则；
- 清理循环在 `_100` 截止，而路由允许 200 条规则。

**修复建议**

- 每次同步显式删除基础名称规则；
- 按实际历史最大编号或分页查询后清理；
- 以“目标集合”为准做全量对账。

---

### H8 EdgeOne 多站点带宽互相覆盖

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/cdn/statistics/detail/tencentEdgeOne.ts:153-173`、`backend/src/lib/cdn/statistics/detail/tencentEdgeOne.ts:280-282`

**问题**

5 分钟带宽峰值在 zone 循环内执行 `accessPoints.set(name, bucketed...)`，后一个站点覆盖前一个站点；`seriesOf(..., 'max')` 对合并后的点集取最大值，而总带宽应是各站点按时间桶求和。

**影响**

- 多站点 EdgeOne 账户的 `bw/bw_out/bw_in` 只反映最后一个站点或单站点最大值；
- 概览卡片与详情曲线显著偏低。

**修复建议**

- 按 `timeline.start + i * stepMs` 将各站点分桶峰值累加；
- 或统一使用 `combineSeries(..., 'sum')`。

---

### H9 旧版明文 API Key 回退绕过新 Key 治理

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/index.ts:396-398`
- `backend/src/auth.ts:17-21`

**问题**

新 `api_key` 表查不到记录时，回退到 `user.apikey` 明文查询，并默认 `scopes=['*']`。该凭据不受过期时间、IP 白名单、作用域、`active/revoked_at` 约束。

**影响**

- 用户吊销或过期新 API Key 后，账号保留的旧 Key 仍可全权限访问；
- 旧 Key 明文存储；
- 新 Key 的权限治理形同虚设。

**修复建议**

- 移除隐式回退，或把旧 Key 迁移为新的哈希记录；
- 旧 Key 必须经过同一套作用域/IP/过期校验；
- 提供显式吊销入口。

---

### H10 前端注册码“最大使用次数”字段名不匹配

**状态**：已完成（2026-11-18）。

**位置**

- `frontend/src/views/SystemSet.vue:461`、`frontend/src/views/SystemSet.vue:909-920`
- `backend/src/routes/register.ts:256`

**问题**

前端提交 `genForm`，字段名是 `maxUse`；后端读取 `b.max_use`。`maxUse` 被忽略，`max_use` 恒为 0。

**影响**

- 管理员设置的次数限制无效；
- 生成的注册码都是无限次使用，邀请码限制被绕过；
- 前端列表显示 `used/∞`，与管理员预期不符。

**修复建议**

- 提交前映射为 `max_use`；
- 增加接口参数契约测试；
- 后端对未知字段给出开发期告警。

---

### H11 解析记录页切换子域名不刷新

**状态**：已完成（2026-11-18）。

**位置**

- `frontend/src/views/RecordList.vue:55`、`frontend/src/views/RecordList.vue:84-90`、`frontend/src/views/RecordList.vue:126-129`
- `frontend/src/layouts/MainLayout.vue:111`

**问题**

`domainId` 只在 setup 读取一次，`subFilter` 虽然来自 `route.query.sub`，但没有 watch 重新加载。`router-view` 的 key 是 `current.path`，仅 query 变化时组件不会重新挂载。

**影响**

- 地址栏与标题显示新子域名，表格仍展示旧子域名的记录；
- 用户可能编辑或删除错误的记录；
- 子域名权限隔离在 UI 上失效。

**修复建议**

- 监听 `route.query.sub` 后重新加载；
- 或让 `router-view` 使用 `route.fullPath` 作为 key。

---

### H12 安装状态缓存导致安装完成后跳回安装页

**状态**：已完成（2026-11-18）。

**位置**

- `frontend/src/router.ts:78-94`
- `frontend/src/views/Setup.vue:251-267`

**问题**

`setupChecked/setupInstalled` 是模块级缓存，安装完成后不会刷新。用户首次访问任意非 `/setup` 页面时，守卫把 `setupInstalled` 缓存为 `false`；安装完成后 `waitRestart()` 执行 `router.push('/login')`，守卫仍按旧值重定向到 `/setup`。

**影响**

- 从安装流程进入的用户安装完成后无法进入登录页；
- 只能手动刷新恢复；
- 与“安装完成自动进入登录页”的预期不一致。

**修复建议**

- 安装成功后显式更新安装状态（例如导出 `markSetupInstalled()`）；
- 或使用 `window.location.assign('/login')` 强制重新探测；
- 守卫对 `/login` 可重新探测安装状态。

---

### H13 TOTP 绑定后 Pinia token 不同步，登出无法吊销新会话

**状态**：已完成（2026-11-18）。

**位置**

- `frontend/src/views/TotpSet.vue:106-109`、`frontend/src/views/TotpSet.vue:139-142`
- `frontend/src/stores/auth.ts:9`、`frontend/src/layouts/MainLayout.vue:377-379`

**问题**

绑定/关闭 TOTP 后后端会自增 `token_version` 并返回新 token。前端只调用 `setToken()` 更新 localStorage，Pinia 中的 `auth.token` 仍是旧 token。登出时 `MainLayout` 先 `clearToken()`，再调用 `auth.logout()`，后者使用旧 token 请求 `/api/auth/logout`。

**影响**

- 服务端按 `token_version` 判定旧 token 失效，登出请求无法吊销当前新会话；
- 被窃取的新 token 在原有效期内继续可用；
- “登出即吊销”语义被破坏。

**修复建议**

- 增加统一 `applyToken(t)` 同时更新 Pinia 与 localStorage；
- 登出时从 `getToken()` 读取最新 token；
- 或让 `auth.logout()` 接受可选 token 参数。

---

### H14 多域名命中率使用全账户流量加权

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/cdn/statistics/detail/aliyunCdn.ts:274-300`
- `backend/src/lib/cdn/statistics/detail/tencentCdn.ts:114-131`

**问题**

`flux`/`collected.get('flux')` 在进入加权循环前已经跨域名累加，循环内每个域名的命中率都乘以同一个总流量，等价于算术平均。阿里云详情还会用该命中率反推 `hit_flux`。

**影响**

- 大流量低命中与小流量高命中的账户，命中率被严重抬高或压低；
- 命中流量同步失真；
- 缓存落库后错误数据会持续保留。

**修复建议**

- 为每个域名/区域单独保存流量数组或汇总标量，按自身流量加权；
- 命中流量直接对各域名的 `hitFlux` 求和。

---

### H15 Cloudflare 账户级代理开关失效

**状态**：已完成（2026-11-18）。

**位置**

- `backend/src/lib/cloudflare/enhance.ts:31-35`

**问题**

```ts
async function getDispatcher(proxy: boolean): Promise<any> {
  const agent = await getConfiguredProxyAgent();
  if (proxy && !agent) throw new EnhanceError('代理服务器或端口未配置', 400);
  return agent;
}
```

无论 `proxy` 真假都返回已配置的 `ProxyAgent`；`proxy=0` 时仍走系统代理；无代理时返回 `undefined`，undici 回落到全局 dispatcher（本项目启动时会设为系统代理）。

**影响**

- 账户配置“直连”后流量仍经代理转发，凭据走非预期出口；
- 代理配置项形同虚设，排障困难。

**修复建议**

- `proxy===false` 时返回显式直连 Agent；
- 只有 `proxy===true` 才返回 `ProxyAgent`；
- 无代理且要求代理时抛错。

---

## 四、中风险问题

### 4.1 认证与账号（A）

- **A1 保险库降级/改口令/恢复码缺少登录二次确认**
  `backend/src/routes/vault.ts:96-160`。降级只校验保险库口令，改口令只校验旧口令，恢复码重置只校验恢复码。被盗会话可把口令模式永久降级为便捷模式。建议三者都调用 `requireLoginPassword`，开启 TOTP 的用户追加当前动态口令。

- **A2 管理员重置密码可接管他人私有保险库**
  `backend/src/routes/user.ts:289-295`。管理员可为任意 level 1 用户设置 `repwd`，只校验管理员自己的密码。便捷保险库登录后自动解锁，管理员即可读取对方私有账户，与“私有账户仅所有者可见”的模型冲突。建议禁止管理员直接重置密码，或要求超级管理员加目标用户确认，并销毁目标保险库会话、吊销目标 API Key。

- **A3 注册码过期时间非法时被视为未过期**
  `backend/src/routes/register.ts:154-158`。`new Date(expiretime).getTime()` 为 `NaN` 时比较结果为 `false`，注册码继续有效。建议显式校验 `Number.isFinite(exp)`。

- **A4 批量生成注册码无事务、备注无长度限制**
  `backend/src/routes/register.ts:257-273`。循环逐条插入，中途失败会留下部分注册码；`remark` 超长可能触发数据库错误。建议使用事务或批量插入，并对备注做截断。

- **A5 账户创建存在并发重复插入窗口**
  `backend/src/routes/account.ts:72-93`、`backend/src/routes/account.ts:207-227`。先 `SELECT` 再 `INSERT`，`account/cdn_account` 缺少 `(type,name,visibility,owner_uid)` 唯一索引。建议增加唯一索引并捕获重复错误。

- **A6 删除 DNS 账户存在竞态**
  `backend/src/routes/account.ts:156-160`。先统计域名数量再删除，两步之间其他请求可能新增域名，留下 `aid` 指向不存在账户的孤儿域名。建议放进同一事务或改用条件删除。

- **A7 安装导入令牌先消费后校验**
  `backend/src/routes/setup.ts:157-162`、`backend/src/installer.ts:148-161`。归档格式错误、密钥错误都会永久烧掉唯一一次导入机会。建议导入成功后再原子作废，或窗口内允许有限次重试。

- **A8 MySQL 分支把查询异常视为“已有管理员”**
  `backend/src/installer.ts:303-317`。`ER_NO_SUCH_TABLE` 也被当作已有管理员，`needAdmin=false`，安装报告成功但无管理员。建议识别“用户表不存在”并返回 `false`，安装成功后用 `SELECT` 复核。

- **A9 优选 IP 最小间隔校验可被非数字绕过**
  `backend/src/routes/optimizeip.ts:67`。`parseInt("abc") < 10` 为 `false`，非法值被保存；后续 `Date.now() - NaN` 使节流恒为 `false`。建议使用 `Number.isInteger` 与范围校验。

- **A10 事件订阅密钥按字符长度校验**
  `backend/src/routes/events.ts:59-61`。密文 `enc:v2:<iv>:<tag>:<data>` 含多字节字符时按字节落库会超出 `varchar(128)`。建议按 `Buffer.byteLength` 限制或扩大列。

- **A11 一次性 nonce 长度与 QQ 消息 ID 不匹配**
  `backend/src/lib/legacyApi.ts:112-116`、`backend/src/migrate.ts:485`。`t:qq:<messageId>` 在 `messageId` 超过 59 字符时超长，MySQL 严格模式插入失败，绑定回调持续 500。建议对超长 key 取哈希或扩大列。

### 4.2 数据库与备份（B）

- **B1 唯一索引迁移失败只记录日志**
  `backend/src/migrate.ts:368-397`、`backend/src/migrate.ts:425-463`。`user.username/email`、`domain(aid,name)`、`cdn_domain(aid,name)` 的唯一约束可能长期缺失，并发下会真正产生重复数据；先删旧索引再建新索引存在空窗。建议失败时终止迁移，或先建影子索引再删除旧索引。

- **B2 SQLite 与 MySQL 的字符串比较语义不一致**
  `backend/src/db/sqlite-dialect.ts:155-158`、`backend/src/migrate.ts:707-708`。SQLite 默认大小写敏感，MySQL 默认大小写不敏感；同名去重、注册码唯一性在两个后端结果不同。建议对需要对齐的列显式 `COLLATE NOCASE`，或在应用层统一 `LOWER()` 归一化。

- **B3 `IN (...)` 未分片**
  `backend/src/lib/users/purge.ts:8-15`、`backend/src/lib/users/purge.ts:114`、`backend/src/lib/backup/export.ts:72-185`。上千域名/任务时可能超过 SQLite/MySQL 参数上限，删除账号与导出整体失败。建议按 500~1000 分片执行。

- **B4 replace 模式未清理部分运行态表**
  `backend/src/lib/backup/import.ts:68`。`idempotency_key`、`async_job`、`event_delivery`、`notification_log`、`token_revocation`、`rate_limit`、`legacy_nonce`、`backup_job` 会残留。建议纳入 `REPLACE_EXTRA_TABLES` 或明确保留策略。

- **B5 导入父账户缺失时写入 `aid=0`**
  `backend/src/lib/backup/import.ts:747-778`。`cdn_domain`、`cert_order` 的 `aid` 找不到映射时写 0，后续子表继续挂到孤儿行。建议与 `domain` 逻辑一致，父记录缺失时跳过并计入 `dropped`。

- **B6 MySQL 读取隔离级别失败后固定为 REPEATABLE READ**
  `backend/src/lib/db/mysql.ts:95-125`。元数据查询失败时 `prevIsolation=''`，`normalizeIsolation('')` 返回 REPEATABLE READ 并写回 SESSION，池化连接复用后可见性语义改变。建议读不到原值时不执行恢复语句，或销毁连接。

- **B7 `SHOW TABLES LIKE` 把表名中的 `_` 当通配符**
  `backend/src/lib/db/mysql.ts:170-173`、`backend/src/installer.ts:122`。`dnsmgr_user` 会匹配 `dnsmgrXuser`，可能误判表已存在。建议使用 `information_schema.TABLES WHERE TABLE_NAME = ?` 或转义 `LIKE`。

- **B8 非法 `DNSMGR_MAX_IMPORT_BYTES` 使解压上限失效**
  `backend/src/lib/backup/archive.ts:15`、`backend/src/lib/backup/archive.ts:686-696`。`Number("abc")` 得到 `NaN`，`unpacked > NaN` 恒为 `false`。建议 `Number.isFinite` 校验并回退默认值。

- **B9 归档写盘非原子**
  `backend/src/lib/backup/archive.ts:225-247`。直接写最终文件，进程被 kill 时留下半截 `.dnsmgrbk`；文件权限未显式 `0600`。建议先写 `.tmp` 再 `rename`。

- **B10 SQLite 单实例锁在容器环境可能误判**
  `backend/src/lib/db/sqlite.ts:150-188`。共享 hostname 但 PID 命名空间独立时，另一个容器持有的锁会被当作遗留锁删除。建议锁文件记录 boot_id/容器 id 或启动时间。

- **B11 维护标志持久化失败只告警**
  `backend/src/lib/backup/maintenance.ts:55-61`。`configSet` 失败时其他副本看不到维护模式，继续写库。建议恢复入口把失败视为致命错误。

- **B12 删除用户后留下悬空的 CDN 引用**
  `backend/src/lib/users/purge.ts:104-111`。只删除本人私有 CDN 账户下的域名，其他账户引用的 `cdn_domain.did`/`cdn_cache_rule` 变成悬空引用；若新域名复用同一 id，会挂上旧 CDN 记录。建议删除域名前把引用置 0 或标记失效。

- **B13 WebDAV 探测文件残留、S3 客户端缓存是 FIFO**
  `backend/src/lib/backup/destinations.ts:132-201`。删除失败被吞掉，探测文件累积；缓存不做访问刷新，高频客户端可能被淘汰。建议记录并重试清理，缓存读取时刷新顺序。

### 4.3 DNS 与证书（C）

- **C1 DNS 检测域名列表忽略 `visibility IS NULL`**
  `backend/src/routes/dnscheck.ts:59-62`、`backend/src/routes/dnscheck.ts:69-72`。`A.visibility <> 'private'` 对 NULL 结果为 NULL，历史共享账户下的域名从列表消失。建议改为 `(A.visibility IS NULL OR A.visibility <> 'private' OR A.owner_uid = ?)`。

- **C2 权重/分组接口向子域名授权用户泄露整域名数据**
  `backend/src/routes/domain.ts:1443-1471`。校验只要求“任意授权”，读取时未按 `perms` 过滤；持有 `www` 授权的用户可看到整 Zone 的权重子域名与分组记录数。建议要求整域名授权或逐项过滤。

- **C3 QingCloud 不传 `SubDomain` 时返回主机汇总行**
  `backend/src/lib/dns/providers/qingcloud.ts:145-187`。结果 `Type/Value` 为空、`RecordId` 是域名，记录列表异常，DNS 劫持检测全部跳过，写操作找不到真实 RecordId。建议先取主机汇总再逐 host 展开。

- **C4 AWS Route53 忽略分页并跳过 Alias 记录**
  `backend/src/lib/dns/providers/aws.ts:134-183`。每次返回整个 Zone，前端翻页失效；`AliasTarget`/`SetIdentifier` 记录不可见。建议本地切片分页，并为别名/路由策略记录提供可编辑视图。

- **C5 Cloudflare SRV 记录缺少必要字段**
  `backend/src/lib/dns/providers/cloudflare.ts:174-193`。只生成 `priority/weight/port/target`，缺少 `data.service/proto/name`。建议解析记录名前缀补齐字段。

- **C6 Aliyun ESA 与 West 更新记录忽略名称**
  `backend/src/lib/dns/providers/aliyunesa.ts:135-149`、`backend/src/lib/dns/providers/west.ts:116-130`。用户重命名后接口返回成功，云端名称未变。建议映射厂商的 RecordName/host 参数，或明确返回不支持。

- **C7 Spaceship 用 `|` 拼接 RecordId**
  `backend/src/lib/dns/providers/spaceship.ts:141`。TXT 值含 `|` 时字段错位，删除请求构造错误。建议使用 JSON/base64url 编码 RecordId。

- **C8 旧版域名列表向普通用户泄露内部字段**
  `backend/src/routes/domain.ts:1713-1725`。旧版 `/api/domain` 仍返回 `aid/thirdid`，与新版 `/api/domains` 的裁剪不一致。建议统一裁剪内部字段。

- **C9 旧版记录列表用过滤后条数推算 total**
  `backend/src/routes/domain.ts:1798-1806`。第 1 页无可见记录时 `total=0`，后续页永远不可达。建议使用厂商原始页条数或厂商 total。

- **C10 `verifyDns` 期望值未归一化**
  `backend/src/lib/certDns.ts:202-225`。`valueMatches` 只做 `result.includes(expected)`，CNAME 值带尾点或大小写不同会永久验证失败。建议双方统一 `trim().toLowerCase().replace(/\.+$/,'')`。

- **C11 证书 DNS 记录只查第一页 100 条**
  `backend/src/lib/certDns.ts:112-139`、`backend/src/lib/certDns.ts:179-195`。超过 100 条后会重复添加、漏删挑战记录。建议按 `name+type+value` 定向查询并完整翻页。

- **C12 UCloud 失败重试会重复购买证书**
  `backend/src/lib/cert/providers/ucloud.ts:40-49`。重置后 `buyCert()` 再次调用 `PurchaseCertificate`，即使已有 `CertificateID`。建议重试时复用现有订单。

- **C13 `finalizeOrder` 落库在 try/catch 之外**
  `backend/src/lib/certService.ts:412-433`。数据库异常或非法日期会使订单卡在 `status=2`，`saveResult(-7)` 不执行。建议包进 try/catch 并写入失败状态。

- **C14 CNAME 代理放行父域名未入库的订单**
  `backend/src/lib/certService.ts:181-190`、`backend/src/lib/certDns.ts:77-103`。`getMainDomain` 无法解析父 Zone 时，`addDns()` 必然抛“未在本系统添加”。建议加严前置校验或在 `addDns()` 中使用完整域名查询。

- **C15 revoke/cancel/reset 未使用同一把锁**
  `backend/src/lib/certService.ts:435-452`、`backend/src/routes/cert.ts:712-726`。吊销与签发可能交叉，出现“远端已吊销、本地已签发”。建议全部走 `withMutationLock()`。

- **C16 自动续签查询与更新条件不一致**
  `backend/src/lib/cert/certTaskService.ts:45-55`、`backend/src/lib/cert/certTaskService.ts:253-263`。查询接受 `islock IS NULL`，更新只匹配 `islock = 0`，历史订单永不自动续签。建议条件统一为 `(islock = 0 OR islock IS NULL)`。

- **C17 `cert_renewdays=0` 被 `|| 7` 改成 7**
  `backend/src/lib/cert/certTaskService.ts:313`、`backend/src/routes/cert.ts:1226-1231`。0 被当作未配置，负数与超大值也未校验。建议使用显式范围校验（如 0~60）。

- **C18 证书解压与日志读取使用同步 I/O**
  `backend/src/lib/cert/utils.ts:95-192`、`backend/src/routes/cert.ts:33-45`。`execFileSync`、`readdirSync`、`openSync/readSync` 阻塞事件循环。建议改用 Promise/流式实现或 worker。

- **C19 部署任务可见性只校验部署账户**
  `backend/src/routes/cert.ts:77-82`、`backend/src/routes/cert.ts:936-953`。共享部署账户下的私有证书订单任务可被其他管理员查看与操作。建议同时校验 `canAccessCertOrder(oid)`。

- **C20 手工证书导入把 `IP Address:` SAN 当域名**
  `backend/src/routes/cert.ts:119-124`。只识别 `DNS:` 前缀，其余 SAN 也被写入。建议只接受 `DNS:` 并校验域名格式。

- **C21 私钥解密失败时回退返回密文**
  `backend/src/routes/cert.ts:774-775`、`backend/src/routes/cert.ts:1193`。`decryptText(...) ?? row.privatekey` 会把密文当私钥返回。建议仅对历史明文允许回退，密文解密失败返回明确错误。

### 4.4 CDN 与部署（D）

- **D1 部署重试时间的时区处理不一致**
  `backend/src/lib/deployService.ts:52-57`、`backend/src/lib/deployService.ts:155-157`。`toISOString().slice(0,19)` 生成 UTC 墙钟字符串，再按本地时间解析；`findDeployTasks` 用数据库 `NOW()` 比较。UTC+8 下表现为立刻重试。建议使用 `DATE_ADD(NOW(), INTERVAL ? SECOND)` 或统一以 epoch 存储。

- **D2 fnos SSH 命令缺少 error 监听与超时**
  `backend/src/lib/deploy/providers/fnos.ts:61-92`。通道错误会触发进程 `uncaughtException`，远端命令不退出会永久挂起并占用部署锁。建议补 `stream.on('error')`、settled 去重与执行超时，参考 `providers/ssh.ts:244-263`。

- **D3 k8s 响应流未监听 error**
  `backend/src/lib/deploy/providers/k8s.ts:123-127`。连接中断时流错误可能升级为未捕获异常。建议增加 `res.on('error')`。

- **D4 腾讯云更新任务未完成也报告成功**
  `backend/src/lib/deploy/providers/tencent.ts:360-372`。循环结束不检查 `DeployStatus === 1`，未完成也打印成功。建议循环结束后校验标志位并抛错。

- **D5 火山引擎部署失败被吞掉**
  `backend/src/lib/deploy/providers/huoshan.ts:148-160`、`backend/src/lib/deploy/providers/huoshan.ts:237-244`。非 success 域名只写日志，全部失败仍显示成功。建议统计失败数并抛聚合错误。

- **D6 阿里云 CLB 证书地域硬编码**
  `backend/src/lib/deploy/providers/aliyun.ts:683-696`。`AliCloudCertificateRegionId` 固定 `cn-hangzhou`，非杭州地域无法引用证书。建议改为 `this.certRegion(config)`。

- **D7 阿里云 CLB 扩展域名未匹配时静默成功**
  `backend/src/lib/deploy/providers/aliyun.ts:712-726`。域名不在扩展域名列表中时无动作、不报错。建议统计命中数量，未命中时抛错或告警。

- **D8 阿里云证书 serial 子串匹配**
  `backend/src/lib/deploy/providers/aliyun.ts:118-125`。`includes(serialNo)` 可能命中另一张证书。建议只保留精确相等匹配。

- **D9 多站点部署 provider 把部分失败当成功**
  `backend/src/lib/deploy/providers/{btwaf,mwpanel,acepanel,ratpanel,xp,kangle,kangleadmin,lucky,btwin,cloudpanel,safeline}.ts`。循环内捕获单站点异常，仅当 `success === 0` 才抛错；失败站点不会再重试。建议收集失败列表，`failures.length > 0` 即抛错。`btpanel.ts:91-93` 已有正确模式。

- **D10 FTP 私钥落盘权限与路径黑名单不足**
  `backend/src/lib/deploy/providers/ftp.ts:100`。上传后未收紧权限，取决于服务端 umask；黑名单缺 `~/.bashrc`、`~/.profile`、`~/.config/**` 等。建议支持 `SITE CHMOD 600` 并补齐拒绝规则。

- **D11 SSH 路径黑名单缺少用户级持久化目录**
  `backend/src/lib/deploy/providers/ssh.ts:14-63`。未拦截 `~/.config/systemd/user/*.service`、`~/.config/autostart/`、`/var/spool/cron/` 等。建议补齐前缀并统一 `local.ts` 的规则集。

- **D12 本地部署 Windows 受保护目录可被 8.3 短名绕过**
  `backend/src/lib/deploy/providers/local.ts:62-81`。只检查 basename，`C:\PROGRA~1\...` 不命中 `c:\program files`。建议对每个目录段检查 `~[0-9]` 或先展开短名。

- **D13 ESA 带宽单位错误**
  `backend/src/lib/cdn/statistics/aliyunEsa.ts:76-82`。`Traffic` 是字节，除以秒得到 B/s，但 `bw` 的 unit 是 `bps`，带宽恒为真实值 1/8。建议乘以 8 或修改 unit。

- **D14 `alignSeries` 对带宽/命中率也求和**
  `backend/src/lib/cdn/statistics/util.ts:35-51`。上游返回点数多于标签时，带宽重复累加，命中率相加可能超过 100%。建议按指标语义选择 `sum/max/加权平均`。

- **D15 ESA 目录与后缀条件过宽**
  `backend/src/lib/cdn/providers/AliyunESA.ts:369-385`。`starts_with("/dir")` 会匹配 `/dirname`；后缀值未转义正则元字符。建议目录使用 `^/dir(/.*)?$`，后缀先做正则转义。

- **D16 腾讯云 CDN 目录规则未补尾斜杠**
  `backend/src/lib/cdn/providers/TencentCDN.ts:141-153`。`catalogPath()` 返回 `/dir`，其他厂商均补 `/`。建议与其它 provider 对齐并核对官方要求。

- **D17 金山云域名列表只取第一页**
  `backend/src/lib/cdn/providers/KingsoftCDN.ts:108-140`。固定 `PageSize:100, PageNumber:1`，超过 100 个域名被截断。建议按 `TotalCount` 翻页。

- **D18 EdgeOne 黑白名单回读判断错误**
  `backend/src/lib/cdn/providers/TencentEdgeOne.ts:776-877`。用 `includes('not')` 判断白名单，值含 `not` 会误判；按逗号拆分会破坏含逗号的 UA/Referer。建议用 `^\s*not\s*\(` 判断并做结构化解析。

- **D19 预热/刷新 URL 拆分破坏查询串**
  `backend/src/lib/cdn/preheatService.ts:20-23`。按 `[;,]` 拆行，`?ids=1,2` 会被拆成两个 URL。建议优先按换行拆分，整行不含 `://` 时才按逗号/分号拆。

- **D20 概览查询区间可能 `endFor < start`**
  `backend/src/lib/cdn/statistics/overview.ts:101-102`。查询时间贴近当前时刻时，`endFor` 可能早于 `start`，非法区间传给上游。建议 `endFor <= start` 时直接返回空卡片。

- **D21 证书联动创建部署任务无解密兜底**
  `backend/src/lib/cdn/certLink.ts:388`。私有 CDN 账户保险库锁定时 `loadAccountConfig` 抛错，只记录为联动失败。建议捕获并写入“保险库已锁定”提示。

- **D22 Cloudflare 路由回传原始异常**
  `backend/src/routes/cloudflare.ts:445-448`。SQL 异常、连接失败信息会返回客户端。建议只对 `EnhanceError` 回显 message，其余走 `publicError(e)`。

- **D23 非管理员 CDN 概览混合私有账户与共享统计**
  `backend/src/routes/cdn.ts:5319-5382`。`routeStats` 用私有账户域名数，basics 固定读共享账户。仅被授权 `stat_cache` 的用户可能看不到卡片，有私有域名的用户看到混合数据。建议统一账户集合。

- **D24 非管理员概览固定返回 5 项基础指标**
  `backend/src/routes/cdn.ts:585-598`。ESA 不提供带宽与命中率，仍返回 `hit_rate=0`，误导判断。建议按 catalog 的 `basicKeys` 生成卡片，缺少分母时返回 null。

- **D25 非管理员详情缓存命中率恒为空**
  `backend/src/routes/cdn.ts:539-544`。`rs.out_flux` 是长度为 N 的全 0 数组，真值判断不回退到 `flux`，分母恒为 0。建议按数值汇总判断。

- **D26 `dispatchCacheOp` 未捕获单组异常**
  `backend/src/routes/cdn.ts:5809-5833`。一个分组抛错后剩余 URL 不再处理，`cdn_cache_task` 也不写记录。建议按分组 try/catch 并记录失败。

- **D27 `detailCache` 的 key 只依赖 AccessKeyId**
  `backend/src/lib/cdn/detailCache.ts`。凭证缺失时 key 可能跨账户碰撞。建议使用账户 `aid` 或凭证哈希，空凭证不缓存。

- **D28 概览对管理员私有账户使用系统密钥解密**
  `backend/src/routes/cdn.ts:5458-5476`、`backend/src/routes/cdn.ts:5585-5587`。私有账户配置永远显示“配置无法解密”。建议使用带会话 DEK 的 `accountConfigOf`，或与详情一致地排除私有账户。

- **D29 统计缓存 key/TTL 与粒度不一致**
  `backend/src/routes/cdn.ts:514-518`、`backend/src/routes/cdn.ts:5543`。管理员详情 6 小时内用 5 分钟粒度，非管理员缓存详情只有小时粒度，X 轴文案也不同。建议统一时间线构建逻辑。

- **D30 腾讯云 CDN 详情命中率在降级路径可能为 100%**
  `backend/src/lib/cdn/statistics/detail/tencentEdgeOne.ts:294-324`。只选缓存分组时缺少总流量，`missFlux` 全为 null，命中率被算成 100%。建议同时请求总流量或返回 null。

### 4.5 调度与监控（E）

- **E1 监控任务超时校验未覆盖 ping**
  `backend/src/routes/dmonitor.ts:195-197`、`backend/src/routes/dmonitor.ts:260-262`。`checktype === 0` 不受 `timeout <= frequency` 约束，上一轮未结束时下一轮再次选中，`errcount` 被并发放大。建议统一校验或增加执行中锁。

- **E2 定时切换未校验 `switchtype`**
  `backend/src/routes/schedule.ts:293-320`、`backend/src/lib/schedule/scheduleService.ts:139-155`。非法值会走“修改解析记录”分支，`value` 为空时可能写入空值。建议限定 `switchtype ∈ [1,2,3,4]`，为 4 时强制校验 `value`。

- **E3 记录归属校验未比对域名**
  `backend/src/routes/dmonitor.ts:31-51`、`backend/src/routes/schedule.ts:29-51`。只判断 `getDomainRecordInfo(recordid)` 是否有返回值，跨域名记录 ID 可通过校验。建议比对返回的 Domain 与 `did` 对应域名。

- **E4 任务并发上限存在 check-then-insert 竞态**
  `backend/src/lib/jobs.ts:52-55`。不同 `(uid,type)` 的请求可同时通过计数检查，实际运行数超过上限。建议使用全局锁或条件更新。

- **E5 七牛证书分页可能死循环、删除仍绑定的证书**
  `backend/src/lib/deploy/providers/qiniu.ts:198-218`。`do...while` 无页数上限；删除过期证书前未检查 `domainCount`。建议增加最大页数与游标去重，删除前校验未绑定域名。

- **E6 白山云 `check()` 永远通过**
  `backend/src/lib/deploy/providers/baishan.ts:45-47`。只判断 token 非空，错误 token 也返回成功。建议调用只读接口验证。

- **E7 Kangle 旧版登录用户名未编码**
  `backend/src/lib/deploy/providers/kangle.ts:151`。用户名含 `&`、`+`、`#` 时登录失败。建议使用 `encodeURIComponent`。

- **E8 手动执行计划备份未纳入分布式锁**
  `backend/src/routes/backup.ts:605-636`、`backend/src/index.ts:741`。手动与定时、或两名管理员同时点击会并发生成多份整站备份。建议同样包在 `withDistributedLock` 内。

- **E9 容灾日志清理无最小保留期**
  `backend/src/routes/dmonitor.ts:381-387`。`days` 可传极小值，`fmtDateTime(Invalid Date)` 生成非法条件并静默返回成功。建议限制保留天数范围并返回实际删除行数。

- **E10 优选 IP 代理地址明文存储**
  `backend/src/routes/optimizeip.ts:52-70`。`optimize_ip_proxy` 不在 `isSecretKey` 命中范围，含账号密码的代理地址明文入库并回显。建议拆分字段或加密/掩码。

### 4.6 前端（F）

- **F1 多处 `busy` 缺少 `finally` 或异常处理**
  `CdnDomain.vue:922-930,1482-1490`、`DeployTask.vue:306-315`、`CfTunnels.vue:258-266`、`RecordAlias.vue:66-78`、`DnsAccount.vue:151-155`、`CdnAccount.vue:136-141`、`DeployAccount.vue:147-153`、`SystemSet.vue:661-920`、`CfHostnamePanel.vue:360-503`。断网后按钮持续转圈，用户无法重试，并产生未处理 rejection。建议统一封装 `useAsyncAction`。

- **F2 用户触发的异步操作未捕获异常**
  `RecordTable.vue:627-665`、`CertOrder.vue:385-511`、`DmTask.vue:273-296`、`ScheduleList.vue:240-256`、`CdnDomainSetting.vue:202-256`。断网或网关错误时静默失败。建议统一 `catch` 后提示。

- **F3 统计详情页账户切换存在请求竞态**
  `StatisticsDetail.vue:344-379`。`loadOptions()` 无请求序号/取消，旧响应可覆盖新账户选项，分页中还可能混入两个账户的域名。建议捕获请求开始时的 `aid`，用 `loadSeq` 丢弃过期响应。

- **F4 统计自动刷新后其他 tab 保持旧数据**
  `StatisticsDetail.vue:319-341`、`StatisticsDetail.vue:387-392`。自动刷新只调用 `loadGroup(tab.value)`，`loaded` 集合不清空，其它 tab 保持旧时间范围。建议刷新时清空并重载已加载分组。

- **F5 CDN Zone 批量加载失败整页无数据**
  `CdnZone.vue:362-408`。`Promise.all` 任一账户请求失败即拒绝，`onMounted` 产生未处理 rejection，页面无提示。建议使用 `Promise.allSettled` 并展示失败账户。

- **F6 列表接口失败时清空数据**
  `CertOrder.vue:307-329`、`DeployTask.vue:246-260`。`code !== 0` 时直接置空列表且不提示，快速翻页存在旧响应覆盖。建议保留旧列表、显示错误态并增加请求序号。

- **F7 写操作后旧 GET 仍可能覆盖 UI**
  `api.ts:74-84`、`api.ts:170-189`。`invalidateApiCache()` 清空缓存与 in-flight，已发出的 GET 仍会把旧数据交给调用方。建议为 GET 维护 AbortController 或统一请求序号。

- **F8 `skipImport()` 不检查响应状态**
  `Setup.vue:237-248`。令牌缺失或过期时后端不重启，前端仍等待约 2 分钟。建议解析响应，`code !== 0` 时立即提示。

- **F9 `waitRestart()` 轮询不可取消**
  `Setup.vue:251-269`。组件卸载后定时器继续执行 `message` 与 `router.push`。建议保存 timer 并在 `onBeforeUnmount` 清理。

- **F10 移除证书配置无二次确认**
  `CdnDomain.vue:872-881`。`applyNoneMgr()` 直接提交 `mode: ''`，误点会关闭 HTTPS。建议增加确认对话框。

- **F11 ESA 控制台刷新调用错误 tab**
  `CdnZoneSetting.vue:3714-3726`。`reloadAll()` 对 ESA 仍调用 EO 的 `loadByTab(tab.value, true)`，当前 ESA 模块不刷新。建议按 `esaTab` 刷新对应模块。

- **F12 DNS 检测与预热间隔前后端不一致**
  `DnsCheckTask.vue:72`、`PreheatTask.vue:67`。前端最小 1 分钟，后端要求 5 分钟；保存后数值被改或直接报错。建议统一为 5 分钟。

- **F13 英文界面存在硬编码中文**
  `AuthShell.vue:25-90`、`MainLayout.vue:16-61`。Hero 标题、描述、跑马灯与侧边栏品牌文案未走 i18n。建议迁入语言包。

- **F14 安装状态探测失败时 fail-open**
  `router.ts:89-91`。探测失败把 `setupInstalled` 设为 `true`，数据库未安装时用户被送到登录页。建议保留“未知”状态并提示重试。

- **F15 详情/编辑页首次加载失败无恢复入口**
  `DmTaskInfo.vue:145-179`、`OptimizeForm.vue:185-189`。详情页无异常处理，编辑页 `Promise.all` 任一失败跳过 `loadTask()`。建议拆分请求并分别捕获，提供重试。

---

## 五、低风险问题

- **L1 `checkLevel` 对 `level>=2` 直接放行**
  `backend/src/auth.ts:30-34`。任何 `required>2` 的检查会失效。当前调用点都传 2，后续新增超级管理员检查时会越权。建议统一按 `user.level >= required` 判断。

- **L2 二次确认 token 在有效期内可重复使用**
  `backend/src/lib/reauth.ts:64-68`。同一 `jti` 可重复执行同一 `op` 的敏感操作。建议把 `jti` 标记为一次性。

- **L3 无 `jti` 的旧 JWT 无法单会话吊销**
  `backend/src/index.ts:513-516`。只有 `jti` 存在时才检查吊销。建议对所有会话令牌强制要求 `jti`。

- **L4 速率限制桶满时淘汰未过期桶**
  `backend/src/security.ts:200-206`、`backend/src/lib/rateLimit.ts:19-22`。攻击者可用大量不同来源挤掉目标桶。建议只淘汰过期桶，容量满时对新 key 拒绝或降级。

- **L5 安装令牌长度不匹配时提前返回**
  `backend/src/lib/setupToken.ts:19-24`。可判断令牌长度，侧信道风险较低。建议先做固定长度哈希再比较。

- **L6 幂等请求指纹只覆盖前 2KB URL 与前 64KB body**
  `backend/src/lib/idempotency.ts:44-46`。长请求尾部差异会被忽略，批量操作可能拿到上一次响应。建议对完整 body 做流式哈希。

- **L7 QQ 绑定口令处理细节**
  `backend/src/routes/qqbot.ts:80-91`。非常量时间比较，先清口令后校验 `openid`，限流使用全局固定桶。建议调整顺序、使用 `timingSafeEqual`、按来源拆分限流。

- **L8 安装令牌绑定标识过弱**
  `backend/src/lib/config-loader.ts:61-63`。`dbIdentity` 只包含数据库名，未绑定 host/port/user。建议拼接完整连接标识。

- **L9 `QueryFn` 把写操作结果声明为数组**
  `backend/src/lib/db/types.ts:22`、`backend/src/db.ts:62-68`。写操作返回 `{insertId, affectedRows}`，类型系统无法发现 `[row] = await q(...)`。建议拆分 `QueryFn/ExecFn`。

- **L10 MySQL `listColumns` 未做标识符白名单**
  `backend/src/lib/db/mysql.ts:166-168`。当前调用方都传常量，属于潜在注入点。建议在驱动层校验 `^[A-Za-z0-9_]+$`。

- **L11 SQLite 生成列遇到非法 JSON 会抛错**
  `backend/src/lib/migrate.ts:330-333`。`json_extract` 对非法 JSON 抛错，未来新写入路径可能失败。建议用 `CASE WHEN json_valid(link) THEN ... END` 包裹。

- **L12 上游原始响应与文案问题**
  `backend/src/lib/deploy/providers/goedge.ts:71` 把上游原始响应写入任务日志，可能含敏感信息；`backend/src/lib/deploy/providers/huawei.ts:140` 与 `lecdn.ts:35` 存在复制粘贴文案错误。建议日志脱敏并修正文案。

- **L13 前端 token 存储方式**
  `frontend/src/api.ts:1-13`。JWT 长期保存在 localStorage，无刷新令牌。建议缩短有效期并支持轮换，条件允许时改为 HttpOnly Cookie。

---

## 六、验证记录

| 检查项 | 命令 | 结果 |
|--------|------|------|
| 后端类型检查 | `cd backend && npx tsc --noEmit` | 通过 |
| 前端类型检查 | `cd frontend && npx vue-tsc --noEmit` | 通过 |
| 前端生产构建 | `cd frontend && npm run build` | 通过（49.4s） |
| 关键路径复核 | 逐行阅读 P0/P1 涉及文件 | 已完成 |
| 源码修改 | — | 已完成 S1-S7、H1-H15、A-F、L 全部条目修复 |
| 后端类型检查（修复后） | `cd backend && npx tsc --noEmit` | 通过 |
| 前端类型检查（修复后） | `cd frontend && npx vue-tsc --noEmit` | 通过 |
| 备份自检（修复后） | `cd backend && npx tsx scripts/check-backup.ts` | 通过 |
| 前端生产构建（修复后） | `cd frontend && npm run build` | 通过（8.7s） |
| 第四批修复后类型检查 | `cd backend && npx tsc --noEmit` | 通过 |
| 第四批修复后前端检查 | `cd frontend && npx vue-tsc --noEmit` | 通过 |
| 第四批修复后备份自检 | `cd backend && npx tsx scripts/check-backup.ts` | 通过 |
| 第四批修复后前端构建 | `cd frontend && npm run build` | 通过（8.1s） |
| 复核补充修复后后端检查 | `cd backend && npx tsc --noEmit` | 通过 |
| 复核补充修复后前端检查 | `cd frontend && npx vue-tsc --noEmit` | 通过 |
| 复核补充修复后前端构建 | `cd frontend && npm run build` | 通过（7.8s） |
| 复核补充修复后备份自检 | `cd backend && npx tsx scripts/check-backup.ts` | 通过 |

说明：类型检查与构建通过说明问题集中在运行时逻辑、权限作用域、并发一致性与错误处理，编译期无法发现。

---

## 七、修复优先级建议

1. **第一批（立即）**：S1、S2、S3、S4、S5。涉及跨租户提权、旧证书误删、缓存规则失效、重复签发与私有凭证不可用，直接造成安全或生产事故。
2. **第二批（本迭代）**：S6、S7、H1-H9。涉及无限重试、审计丢失、备份恢复数据错位、PowerDNS 记录错位与旧 Key 治理。
3. **第三批（本迭代）**：H10-H15 与前端 F1-F15。涉及安装、登录态、记录页误操作、统计失真与用户体验。
4. **第四批（持续）**：其余中危与低危。优先统一三套基础设施：后台任务凭证加载（`loadAccountConfig`）、唯一索引与事务边界、前端异步操作错误处理。

## 八、修复进度

### 8.1 已完成

| 编号 | 修复要点 |
|------|----------|
| S1 | 隐式权限携带 aid/domainId，读写按目标域名行身份校验，显式授权保持名称语义 |
| S2 | 腾讯云上传失败直接抛错，资源未确认切换不删除旧证书 |
| S3 | 阿里云 CDN 全局规则权重固定 1，具体规则 2-99，超限拒绝 |
| S4 | 加锁校验期望状态，锁后重读订单，保存带 processid 租约 fencing |
| S5 | 证书/部署后台任务改用 loadAccountConfig，锁定或失败时明确失败 |
| S6 | 前置校验失败写终态，retry2 达上限停止调度，锁条件统一 |
| S7 | 脱敏深度贯穿不重置，深度/节点上限，采集失败降级写最小审计行 |
| H1 | PowerDNS 区分 API zone id 与比较域名，统一去尾点与 FQDN 拼装 |
| H2 | cert_link_log.did 使用 cdn_domain 映射，导出按 cdnDomainIds 过滤 |
| H3 | merge 导入按业务唯一键复用或跳过，重复错误不再整单回滚 |
| H4 | pre_restore 快照强制全量，包含排除备份的用户 |
| H5 | 归档路径解析与清理异常降级为告警，不再卡维护模式 |
| H6 | 导出 spool 目录与文件登记临时生命周期，结束标记完成 |
| H7 | ESA 按目标集合全量对账并分页清理历史规则，覆盖 200 条 |
| H8 | EdgeOne 多站点带宽按时间桶求和 |
| H9 | 移除旧明文 API Key 隐式回退，未命中新表直接 401 并告警 |
| H10 | 注册码提交映射 max_use |
| H11 | 记录页监听路由参数与 sub 变化重新加载 |
| H12 | 新增 markSetupInstalled，登录页可重新探测安装状态 |
| H13 | 统一 applyToken 同步 Pinia 与 localStorage，登出使用最新 token |
| H14 | 命中率按各域名自身流量加权，命中流量分别求和 |
| H15 | 代理开关归一化，关闭时返回显式直连 Agent |

### 8.2 已完成（编译与构建验证）

以下条目已完成代码修改，并通过后端 tsc、前端 vue-tsc 与前端生产构建。

| 编号 | 说明 |
|------|------|
| A1 | 保险库降级/改口令/恢复码重置增加登录二次确认 |
| A3、A4 | 注册码过期时间校验、批量生成事务与备注截断 |
| A5、A6 | 账户创建重复捕获、删除账户事务化 |
| A9 | 优选 IP 间隔使用整数与范围校验 |
| B3 | IN 查询分片 |
| B6、B7 | MySQL 隔离级别恢复保护、表名精确匹配 |
| B10 | SQLite 锁文件绑定启动标识 |
| C1 | DNS 检测兼容 visibility IS NULL |
| C2 | 权重/分组接口按授权范围过滤 |
| C3、C4、C5 | QingCloud 展开、Route53 分页与别名、Cloudflare SRV 字段 |
| C6、C7 | ESA/West 记录改名、Spaceship RecordId 编码 |
| C8、C9 | 旧版域名字段裁剪、记录分页 total |
| C10、C11 | DNS 期望值归一化、挑战记录完整翻页 |
| C12 | UCloud 重试复用订单 |
| C13、C15、C16 | 落库异常终态、吊销/签发同锁、续签锁条件统一 |
| C14 | CNAME 父域名未入库订单落终态 |
| D1、D2、D3 | 部署重试时区、fnos 流错误与超时、k8s 流错误 |
| D4、D5 | 腾讯云更新状态校验、火山引擎失败聚合 |
| D6、D7、D8 | 阿里云 CLB 地域、扩展域名未命中、证书精确匹配 |
| D9 | 多站点 provider 失败聚合上报 |
| D10、D11、D12 | FTP/SSH/local 路径与权限加固 |
| D13、D14 | ESA 带宽单位、alignSeries 指标语义 |
| D20 | 概览非法时间区间返回空卡片 |
| E1、E2、E3 | 监控超时覆盖、switchtype 校验、记录归属比对 |
| E4、E8 | 任务并发竞态、手动备份纳入分布式锁 |
| E5、E6、E7 | 七牛分页与绑定校验、白山 check、Kangle 用户名编码 |
| E9、E10 | 容灾清理参数校验、优选 IP 代理加密/掩码 |
| F7 | GET 请求序号与中止，写后不覆盖 UI |
| L4、L5、L6 | 限流淘汰策略、安装令牌定长比较、幂等完整指纹 |
| L7、L8、L9 | QQ 绑定校验顺序与限流、安装令牌连接标识、Query/Exec 类型拆分 |
| L13 | token 集中管理 |
| A2 | 管理员重置他人密码需超级管理员确认，并清理目标保险库会话与 API Key |
| A7、A8 | 导入令牌先占用后消费、失败释放；MySQL 仅缺表视为无管理员并复核 |
| A10、A11 | 事件密钥按字节校验；QQ 超长 nonce 使用哈希键 |
| B1、B2 | 唯一索引失败终止迁移；SQLite 用户名/邮箱/域名等统一 NOCASE |
| B4、B5 | replace 清理运行态表；父账户缺失跳过而非写 aid=0 |
| B8、B9、B11、B12、B13 | 解压上限校验、归档原子写、维护标志致命错误、删除用户解绑 CDN、探测清理与 S3 LRU |
| C17、C18 | renewdays 显式范围校验；证书解压与日志读取改异步 |
| C19、C20、C21 | 部署任务双权限校验、SAN 仅收 DNS、私钥解密失败明确报错 |
| D15-D19 | ESA 条件锚定与转义、腾讯目录尾斜杠、金山分页、EdgeOne 名单解析、URL 拆分 |
| D21-D30 | 保险库锁定提示、Cloudflare 异常收敛、概览账户/指标/命中率/缓存/时间线统一、EO 缺失命中率返回 null |
| F1-F6、F8-F15 | busy 收敛、异常提示、统计竞态与刷新、Zone 批量容错、请求序号、安装轮询、i18n、详情重试 |
| L1、L2、L3、L10、L11、L12 | 权限比较统一、reauth 一次性、强制 jti、列名白名单、json_valid、日志脱敏与文案 |


### 8.3 剩余事项

| 编号 | 状态 | 说明 |
|------|------|------|
| B2 | 部分完成 | SQLite 新建表与唯一索引已使用 NOCASE；已有库升级后建议复核大小写重复数据 |

本轮修复后后端 tsc、前端 vue-tsc、备份自检与前端构建均通过。后续重点转为运行时回归：私有保险库重置流程、安装导入失败重试、SQLite/MySQL 升级迁移、CDN 统计口径与前端异常路径。


## 九、复核补充修复

第四批完成后对改动逐项复核，又发现并修复以下回归或未落地问题：

| 范围 | 问题 | 修复 |
|------|------|------|
| 定时任务 | 新增校验只接受 1-4，前端与历史数据用 0 表示修改解析，导致修改类任务无法创建/执行 | 接受 0/4 作为修改解析，并校验记录值 |
| DNS | QingCloud 展开记录时 `Domain` 写成记录 FQDN，归属校验失败；且未标记 clientPaged | 统一写 Zone 名并标记客户端分页 |
| 证书 | SAN 校验 TLD 仅允许字母，拒绝 punycode/IDN | 按标签校验，允许 xn-- 与数字 TLD |
| 证书 | Ucloud 重试复用 CertificateID 的分支未传入订单信息 | buyCert 传入 this.info |
| 部署 | 腾讯云取得 DeployRecordId 后只查一次新证书，列表延迟导致误判失败并重复提交 | 在轮询预算内继续查询新证书 |
| 备份 | replace 导入清理 backup_job，删除了恢复前安全快照记录，旧备份也无法清理 | 移除该表，恢复后仍由 restore 清理旧任务 |
| 备份 | 维护标志持久化失败发生在 try 之外，恢复状态永久停留在 running | 移入 try 并复位；恢复成功后关闭失败仅告警 |
| 迁移 | NOCASE 规则按首个后缀命中，cert_domain.domain 被 domain 规则遮蔽 | 改取最长后缀匹配 |
| CDN 统计 | 账户集合分支导致普通用户私有账户/共享账户统计缺失 | 统一为共享 + 本人私有账户 |
| CDN 预热 | 整行含协议时不再按逗号/分号拆分，多 URL 同行失效 | 仅在新协议前拆分，保留 query 内逗号 |
| 记录列表 | 子域名授权沿用厂商整 Zone total，泄露记录总数 | 一律按原始页条数估算 |
| 域名监控 | 清理接口要求天数 >=1，前端仍允许 0 | 前端下限改为 1 |
| 保险库 | 改口令/降级缺少登录密码与 TOTP，后端二次确认后必然 400 | 弹窗补充密码/动态口令并随请求提交 |
| 用户管理 | 重置他人密码未发送确认字段，被后端拒绝 | 编辑他人并填写新密码时发送 confirm_reset_password |
| 前端请求 | 写操作中止在途 GET 被页面当作错误提示；signal 已取消时控制器泄漏 | 在调用方未取消时自动重试一次，并提前检查取消状态 |

复核后后端 tsc、前端 vue-tsc、前端构建与备份/保险库自检均通过。
