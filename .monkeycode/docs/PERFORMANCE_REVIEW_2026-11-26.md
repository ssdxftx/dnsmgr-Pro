# 全项目性能与流畅度审查报告

- 日期：2026-11-26
- 审查版本：v1.37.0（提交 `2581e9b`）
- 审查方式：只读静态审查、路由到接口调用链梳理、构建产物体积分析、数据库索引与调度任务检查
- 审查范围：`backend`、`frontend`、`deploy`、`Dockerfile`、`docs-site`
- 排除范围：`workers/` 为独立 Cloudflare Workers PoC，不参与主 Node 服务运行
- 修改情况：报告编写阶段为只读审查；后续实施内容见第 12 节

## 1. 执行摘要

当前项目的基础优化已经比较完整：前端路由全部懒加载，构建产物带内容哈希并下发一年 immutable 缓存，后端启用 Brotli/Gzip，SPA HTML 有 ETag/304，DNS 解析记录已有 60 秒内存缓存，CDN 统计已有落库表和 30 天保留，后台任务有去重和并发上限。

项目距离“所有页面秒开”的主要差距集中在四类：

1. **缓存键和缓存开关没有真正发挥作用。** CDN 统计的 120 秒内存缓存因为结束时间精确到秒而基本不命中；统计落库缓存默认关闭。
2. **页面请求链路上仍实时调用云厂商。** CDN 站点列表、站点设置、域名列表、解析记录、Cloudflare 主机名都在请求内枚举云端。
3. **前端为了统计或下拉选项串行拉全量分页。** 多个页面最多执行 50 次串行请求，每次 500 条。
4. **SQLite 同步驱动和后台长任务会阻塞主线程。** 默认 Docker Compose 使用 SQLite，备份、统计刷新、批量清理期间可能出现整站卡顿。

重复访问通过“内存 L1 + 数据库 L2 + 后台刷新”可以做到秒开；冷启动首访仍受云厂商 API 延迟约束，目标是把首屏压到 2-3 秒，并用缓存优先和骨架屏承接等待。

## 2. 评估基线

### 2.1 部署基线

- `Dockerfile` 使用 `node --import tsx src/index.ts` 运行 TypeScript 源码。
- `docker-compose.yml` 挂载 `/app/data` 时默认使用 SQLite。
- `deploy/kubernetes.yaml` 单副本、内存 limit 512Mi，注释记录空闲 RSS 约 135MiB。
- 生产环境可以直接使用 MySQL，但默认单机路径仍是 SQLite。

### 2.2 前端构建体积

当前 `frontend/dist` 约 4.0MB，关键产物：

| 产物 | 原始体积 | gzip 体积 | 说明 |
|---|---:|---:|---|
| `vendor-charts` | 533KB | 178KB | ECharts，统计详情加载 |
| `index` 入口 | 185KB | 50KB | App、i18n、API 封装 |
| `zh-CN` | 141KB | 48KB | 中文语言包 |
| `en-US` | 146KB | 45KB | 英文语言包 |
| `vendor-vue` | 113KB | 43KB | Vue、Router、Pinia |
| `vue-i18n` | 101KB | 34KB | i18n 运行时 |
| `CdnZoneSetting` | 137KB | 27KB | 单页巨石组件 |
| `ResponsiveDataTable` | 107KB | 31KB | 表格组件 |
| `DatePicker` | 87KB | 17KB | 按页加载 |
| `TimePicker` | 70KB | 18KB | 按页加载 |

首屏入口组合约为 `index + vendor-vue + vue-i18n ≈ 128KB gzip`，再加当前路由 chunk 与 CSS。整体不算失控，主要问题是首屏等待链路和业务数据量，而不是 JS 总量。

### 2.3 已有优化

- `frontend/src/router.ts:6-69` 全部页面使用动态 import。
- `backend/src/security.ts` 已对带哈希的 `/assets/*` 下发一年缓存，HTML 使用短边缘缓存和 ETag。
- `backend/src/index.ts:154-159` 已启用 `@fastify/compress`，阈值 1KB。
- `backend/src/routes/domain.ts:132-236` 已有解析记录 60 秒缓存、条目数上限和字节上限。
- `backend/src/lib/cdn/statistics/cacheService.ts` 已有 `cdn_stat_data` 落库、30 天保留、按天/小时刷新。
- `backend/src/routes/cdn.ts:603-604` 已有 provider 5 秒短缓存。
- `backend/src/lib/jobs.ts` 已有任务去重、全局并发上限、心跳和失联回收。
- `backend/src/lib/rateLimit.ts` 已有进程内和跨实例限流。
- `docs-site` 使用 Valaxy SSG，页面为静态产物，运行时没有主服务 API 压力。

## 3. P0：影响最大、最值得先处理

### P0-1 CDN 统计内存缓存实际上不命中

**证据**

- `backend/src/routes/cdn.ts:5514-5516` 把 `end` 回退到 `Date.now() - delayMinutes`。
- `backend/src/routes/cdn.ts:5561-5562` 的缓存键使用 `fmtStatTime(start)` 和 `fmtStatTime(end)`，格式包含秒。
- `backend/src/lib/cdn/statistics/detail/cache.ts:4-5` TTL 为 120 秒。
- 前端默认 24 小时、今天、7 天、30 天查询都使用 `fmt(now)` 作为结束时间，`frontend/src/views/StatisticsDetail.vue:264-280`、`Statistics.vue:80-95`。
- 概览缓存同样使用秒级 `formatTime(end)`，`backend/src/lib/cdn/statistics/overview.ts:92-93`；概览路由也会把结束时间回退到当前时间。

**影响**

同一页面每秒刷新都会产生新的缓存键，120 秒缓存失效。管理员统计每次打开、每次自动刷新、每次切换 tab 都会打到云厂商接口。

**建议**

- 在构造时间轴之前，把 `end` 对齐到时间桶：
  - 5 分钟粒度对齐 5 分钟；
  - 小时粒度对齐整点；
  - 天粒度对齐当天。
- 使用对齐后的 `start/end/timeline` 同时参与查询和缓存键。
- 概览缓存键使用同样的对齐结果，避免 `buildProviderCard` 内部再次用当前时间生成新 key。
- 缓存键包含 `route + start + end + aid + domains 排序 + groups 排序 + filters + top`。

**预期收益**

热访问不再产生云 API 调用，统计页从秒级等待降到百毫秒级。

### P0-2 统计详情按站点串行扇出

**证据**

- `backend/src/routes/cdn.ts:5608-5623` 只对账户做 `runPool(..., 4)`。
- `backend/src/lib/cdn/statistics/detail/tencentEdgeOne.ts:143-267` 在账户内部按 `zoneId` 串行循环。
- 单个 EdgeOne zone 在全指标场景下可能执行 16 次以上请求：访问指标 1 次、小时峰值 3 次、回源 1 次、缓存 3 次、缓存降级 2 次、状态码 8 次。
- `backend/src/lib/cdn/statistics/detail/aliyunEsa.ts:88-111` 同样按 site 串行。
- `backend/src/lib/cdn/statistics/tencentCdn.ts:86-110` 按域名 × 区域 × 指标串行。

**影响**

20 个 EdgeOne 站点可能产生 300 次以上串行 HTTP 请求；请求超时上限还是全局 300 秒，用户会长时间转圈。

**建议**

- provider 内部按 zone/site 再做 `runPool(4-6)`，账户级和站点级两层并发都设置上限。
- 同一 zone 的多个指标尽量合并到一次请求。
- 给统计详情加 15-30 秒请求级超时，超时返回部分数据和错误信息。
- 新增全局 provider 并发信号量，避免多用户同时打开统计页时把云 API 配额打满。

**预期收益**

冷查询耗时下降数倍；配合 P0-1 后，大多数访问直接命中缓存。

### P0-3 CDN 站点列表每次实时枚举云端

**证据**

- `/api/cdn/zones?aid` 直接调用 `provider.getZones()`，`backend/src/routes/cdn.ts:905`。
- `/api/cdn/accounts/:aid/sites` 同样实时枚举，`backend/src/routes/cdn.ts:992`。
- ESA 不返回暂停状态时，会对每个站点补一次 `getZonePaused`，`backend/src/routes/cdn.ts:1003`。
- `/api/cdn/accounts/:id/zones` 每次查账户、解密配置、调用云端，`backend/src/routes/account.ts:342-350`。
- `cdnForZone(aid, null)` 不进入 provider 缓存，`backend/src/routes/cdn.ts:685-688`。
- 前端 `CdnZone.vue:375` 按账户逐个请求 `/cdn/zones?aid`；`CdnZoneSetting.vue:1284` 打开设置页会再次请求；`CdnDomain.vue:1184` 打开表单也会请求。

**影响**

站点页、站点设置、域名接入表单都依赖云端枚举。账户越多、站点越多，等待越久；ESA 账户还会叠加每站点暂停状态查询。

**建议**

- 新增 `cdn:zones:{aid}` 内存缓存，TTL 30-60 秒，账户增删改、站点创建/删除后失效。
- 新增解密后账户配置缓存，TTL 5-10 分钟；私有账户按 uid/jti 隔离。
- ESA 暂停状态写入本地 `cdn_zone_meta` 或列表快照，后台任务刷新。
- 站点设置页直接使用路由参数和缓存列表，不通过 `/cdn/zones?aid` 反查。
- 域名表单只需要站点下拉选项时，调用轻量 `/cdn/accounts/:aid/zones/options`，只返回 `zoneId/zoneName/status`。

**预期收益**

站点页热访问从多次云 API 降到 0 次上游调用，接口 p95 可以进入 100ms 以内。

### P0-4 前端多处串行拉全量分页

**证据**

- `frontend/src/views/CdnDomain.vue:1080-1093` 最多 50 页 × 500 条，串行请求。
- `frontend/src/views/CdnZoneSetting.vue:1297-1307` 同样串行拉站点下全部域名。
- `frontend/src/views/StatisticsDetail.vue:351-360` 为域名下拉选项串行拉全部加速域名。
- `frontend/src/views/CachePurge.vue:140` 串行拉全部缓存任务。
- `frontend/src/views/Backup.vue:357`、`MyBackup.vue:143` 串行拉全部备份任务。

**影响**

域名 2000 个时首屏至少多 4 个 RTT；域名上万个时接近 20 个 RTT。统计页的选项加载还会和统计查询争带宽。

**建议**

- CDN 域名列表改服务端分页，表格只取当前页，统计数字由后端聚合返回。
- 新增轻量 options 接口，供统计筛选、接入表单、缓存刷新选择域名。
- 缓存任务、备份任务改服务端分页，或默认只取最近 200 条并提供“加载更多”。
- 保留批量选择能力时，使用服务端聚合或异步导出，不在首屏同步拉全量。

**预期收益**

首屏请求数从几十次降到 1-3 次，首屏时间不再随域名总量线性增长。

### P0-5 域名列表和解析记录仍在请求链路实时拉云端

**证据**

- 管理员 `/api/domains` 默认 `pageSize = 0`，没有 `LIMIT`，`backend/src/routes/domain.ts:517-525`。
- 列表 SQL 使用 `SELECT A.*`，并把账户配置等大字段一起读出。
- 非管理员按授权域名逐个 `fetchRecordTotal` / `fetchAllRecords`，`backend/src/routes/domain.ts:563-594`。
- 域名授权过滤使用 `LOWER(TRIM(TRAILING '.' FROM A.name)) IN (...)`，`backend/src/routes/domain.ts:525`，会绕开 `name` 索引。
- `/api/domains/:id/records` 每次翻页、筛选、排序都直接调用云端，没有复用已有的记录缓存，`backend/src/routes/domain.ts:985-1016`。
- `/api/records/search` 管理员读取全部域名目标，并最多扫描 100 个域名的全部记录，`backend/src/routes/domain.ts:659-719`。

**影响**

普通用户打开域名列表会产生 N 次云 API 调用；管理员域名多时单次响应体过大；解析记录页每次翻页都等云端。

**建议**

- 管理员默认分页 200 或 500，显式传 `limit=0` 才允许全量。
- 非管理员列表优先使用本地 `domain.recordcount`，展开单个域名时再拉完整记录。
- 域名写入时统一小写去尾点，查询改为索引友好的 `name IN (...)`；或新增规范化列并建索引。
- 解析记录增加 10-30 秒短缓存，key 包含 `domainId + page + pageSize + keyword + subdomain + value + type + line + status + sort`，写记录后失效。
- 记录搜索改为本地域名/别名优先，关键词长度达到阈值后再扫描云端，扫描上限降到 20-30 个域名。
- 分类、别名、账户映射增加短 TTL 缓存或批量查询。

**预期收益**

域名列表热访问从 N 次云端调用降到 0 次；解析记录翻页命中缓存后进入 100ms 级。

### P0-6 SQLite 同步驱动会阻塞事件循环

**证据**

- `backend/src/db/sqlite.ts:6` 使用 `node:sqlite` 的 `DatabaseSync`。
- `backend/src/db/sqlite.ts:72-80` 设置 `PRAGMA synchronous = FULL`。
- `backend/src/db/sqlite.ts:221-243`、`274-282` 查询和写入都走同步 statement。
- `backend/src/lib/backup/export.ts:480-552` 在一致性快照内逐表读取并落盘。
- Docker Compose 默认 SQLite，因此单机部署更容易触发。

**影响**

一次大表扫描、全库备份、统计写库或审计清理都会阻塞主线程。表现为 HTTP 请求停顿、健康检查抖动、前端请求超时。

**建议**

- 备份导出、统计刷新、批量清理移到子进程或 worker。
- 大表读取分批进行，每批之间让出事件循环。
- 短期可以在低风险部署中评估 `synchronous=NORMAL`，但优先保持 `FULL` 并把重任务移出主进程。
- 多用户或大数据量部署建议默认引导 MySQL；SQLite 继续服务单用户和小规模场景。

**预期收益**

消除备份、统计期间的全站卡顿；后端 p95 更稳定。

### P0-7 前端 GET 缓存默认关闭，写操作全量清空

**证据**

- `frontend/src/api.ts:118`：`cache` 只有显式传 `true` 或数字时才生效，默认 TTL 为 0。
- 全工程 191 处 GET 中只有 8 处显式开启缓存。
- `frontend/src/api.ts:127`：带 `signal` 的 GET 不参与 in-flight 去重。
- `frontend/src/api.ts:228-231`：任意写操作成功后清空全部 GET 缓存并中止所有在途 GET。

**影响**

跨页打开 CDN 账户、厂商定义、站点列表、域名基本列表时反复回源；批量操作会让其他页面的在读请求全部中止并重试，形成请求风暴。

**建议**

- 对只读参考数据显式开启缓存：providers、accounts、zones、domains basic。
- 增加 `cache: 'swr'` 模式，先返回旧数据，后台刷新。
- 去重键与 `signal` 解耦，`signal` 只负责调用方取消。
- 写操作按 URL 前缀失效，使用已有的 `invalidateApiCache(prefix)`，不再全局清空。

**预期收益**

跨页重复请求减少 30%-50%，批量操作后的请求风暴消失。

### P0-8 首屏等待链路

**证据**

- `frontend/src/router.ts:87-102` 首次导航等待 `/api/setup/status`，最长 5 秒。
- `frontend/src/router.ts:13` 根路径默认跳 `/domains`，这是最重的列表页。
- `frontend/src/main.ts:23-25` 语言包后台加载，首帧 `messages` 为空，随后触发全页响应式重渲染。
- `frontend/src/i18n/locales/zh-CN.ts:2` 使用 `import.meta.glob(..., { eager: true })`，单语言所有命名空间全量加载。
- `frontend/src/main.ts:63` 空闲时最多预取 12 个路由 chunk。

**影响**

后端慢时白屏最长 5 秒；语言包到达后页面文案闪烁并重渲染；默认落地页直接拉最重列表。

**建议**

- 安装状态写入 `localStorage` 并设短 TTL；已安装后不再启动阻塞探测。
- 根路径改为 `/dashboard`，首屏只请求 `dashboard/summary` 和轻量账户选项。
- 启动时 await 当前语言包，或先同步加载 `core/common/nav`，大命名空间按路由加载。
- 预取降到 2-3 个高频路由，或改为 `mouseenter/focus` 触发。
- `App.vue:19` 的 naive 中英文 locale 改为按当前语言动态导入。

**预期收益**

重复访问首屏减少一个 5 秒阻塞点；默认落地页数据量下降一个数量级。

## 4. P1：明显影响体验或资源占用

### P1-1 provider/account 配置缓存范围过窄

`backend/src/routes/cdn.ts:603-604` 只缓存 5 秒，且 `685-688` 只缓存 `visibility === 'shared' && zoneId` 的组合。`cdnForZone(aid, null)` 永不命中，导致站点选择器、套餐列表、站点设置反复查库和 AES 解密。

建议缓存解密后的配置对象，key 包含 `aid + configHash + epoch`，TTL 5-10 分钟；私有账户按会话隔离。provider 实例中的可变站点状态不要跨请求复用。

### P1-2 统计落库缓存默认值

审查时 `backend/src/lib/cdn/statistics/cacheService.ts:61-63` 的 `cdn_stats_cache` 默认是 `0`。第一阶段已改为默认开启，并在服务启动后 5 秒预热一次。

建议：

- 统计页优先读缓存，允许 `stale`，后台刷新。
- 在图表上展示 `dataUntil` 和“缓存数据”标识。

### P1-3 统计实时路径仍全表读取并串行查询

`backend/src/routes/cdn.ts:5713` 在无筛选时读取整张 `cdn_domain`；`5722-5733` 逐行查账户；`5737-5750` 按账户串行调用 `queryByRoute`。

建议：

- 实时路径只作为兜底，管理员默认走统计缓存。
- `cdn_domain` 只查需要的列，并加 `LIMIT` 或先按 aid/域名过滤。
- 账户用一次 `IN` 查询批量取。
- 账户分组后 `runPool` 并发。

### P1-4 解析记录、Cloudflare 主机名缺少短缓存

- `/api/domains/:id/records` 没有复用 `allRecordsCache`。
- `/api/cloudflare/domains/:domainId/hostnames` 每次全量分页拉云端，`backend/src/routes/cloudflare.ts:458-467`。
- `findTxtRecordTargetDomains` 读取全部域名并 JOIN 账户，`backend/src/routes/cloudflare.ts:302-309`。

建议：

- 解析记录按筛选条件缓存 10-30 秒，写操作失效。
- Cloudflare 主机名缓存 30-60 秒，CF 写操作后按 zone 失效。
- TXT 目标候选缓存 60 秒，或在 SQL 侧用后缀过滤，避免全表进 Node。

### P1-5 固定请求开销偏多

- 每个已登录请求调用 `isTokenRevoked`，负缓存只有 1 秒，`backend/src/lib/auth/revocation.ts:9`。
- 每个请求调用 `refreshMaintenance`，每秒强制读取整张 `config` 表，`backend/src/index.ts:214-215`、`backend/src/config.ts:33-43`。
- CDN/域名接口的分布式限流每次 2 次数据库往返，`backend/src/lib/rateLimit.ts:46-65`。
- 权限查询每次重新查 `permission` 表，`backend/src/auth.ts:83-88`。

建议：

- 吊销负缓存延长到 5-10 秒，或使用 `token_version` 校验。
- 维护模式只在写请求分支检查。
- 限流先走进程内滑窗，跨实例计数低频落库；清理移到后台。
- 用户权限增加 5-10 秒缓存，授权变更时按 uid 失效。

### P1-6 数据库索引缺口

现有索引已覆盖大部分热路径，仍有以下缺口：

| 表 | 建议索引 | 依据 |
|---|---|---|
| `cert_order` | `(status, issend)` | `backend/src/lib/cert/certTaskService.ts:105-113` |
| `cert_deploy` | `(status, issend)` | `certTaskService.ts:117-126` |
| `domain` | `(checkstatus, checktime)` | `backend/src/lib/expire/expireNoticeService.ts:257-279` |
| `async_job` | `(uid, type, status)` | `backend/src/lib/jobs.ts:45-48` |
| `async_job` | `(status, created_at)` | `backend/src/lib/jobs.ts:68-74` |
| `log` | `(addtime)` | `backend/src/routes/user.ts:504-507` |
| `permission` | 规范化 domain 列 | `backend/src/routes/domain.ts:487` |

同时减少 `SELECT *`：

- `backend/src/routes/jobs.ts:51-63` 包含 `result mediumtext`
- `backend/src/lib/accounts/visibility.ts:96-103` 读取账户全部列，包括加密配置
- `backend/src/routes/cdn.ts:781-783`、`5409-5427`、`5713`、`5982-5985`
- `backend/src/routes/domain.ts:510-523`

### P1-7 后台任务全量扫描和串行执行

- `backend/src/lib/schedule/scheduleService.ts:53-94` 无 LIMIT，串行。
- `backend/src/lib/cdn/preheatService.ts:169-191` 无 LIMIT，串行。
- `backend/src/lib/dns/checkService.ts:206-246` 无 LIMIT，串行。
- `backend/src/lib/optimize/optimizeService.ts:168-180` 无 LIMIT，串行。
- DNS 检测每个任务全量分页拉整个 Zone，`checkService.ts:45-59`。
- 监控通知按渠道串行，单任务最坏 6×15 秒，`backend/src/lib/monitor/msgNotice.ts:346-375`。
- 手动执行直接在 HTTP 请求内跑探测，`backend/src/routes/dmonitor.ts:280-288`。

建议：

- 所有到期任务加 `LIMIT N`、有界并发池、随机抖动和失败退避。
- Zone 记录按 `did` 缓存 30-60 秒。
- 通知改独立队列，探测流程只入队。
- 手动执行改为后台任务。

### P1-8 日志、任务和事件写放大

- `dnsmgr_log` 没有自动清理，`dnsmgr_dmlog` 只有手工删除入口。
- `backend/src/lib/jobs.ts:153-157` 每次进度都序列化完整 `result`，证书批量任务形成 O(n²) 写放大。
- `backend/src/lib/events.ts:76-87` 每次投递写两条表；`115-129` 每个事件全表读订阅。
- `backend/src/index.ts:643-684` 已清理审计、通知、事件投递，尚未覆盖 `log`/`dmlog`。

建议：

- `log`/`dmlog` 增加每日分批 TTL 清理。
- 进度写库节流到 1 秒一次，只保留最近 20 条结果。
- 事件订阅缓存 30 秒，投递记录批量写，失败带退避。

### P1-9 前端重组件与大列表

- `SystemSet.vue:173-178`、`931-938` 一次渲染 500 条注册码，桌面端没有分页或虚拟滚动。
- `CdnZoneSetting.vue:2012` EO 规则表没有分页。
- `CdnZoneSetting.vue` 3961 行、51 个 computed、120 处 API 调用，chunk 27KB gzip。
- `ResponsiveDataTable.vue:259-293` 判空时会执行列 `render`，移动端同一格渲染两次。
- `ResponsiveDataTable.vue:346-398` 数据变化就重新测量布局。
- `DomainList.vue:185-190` 到期统计每行重新 `new Date()`，没有复用 `expireTs` 缓存。
- `CdnDomain.vue:961-967` 对同一数组执行 4 次 filter。
- `TotpSet.vue:51` 静态引入 `qrcode`。
- `MetricChart.vue:7-14` 的 ECharts chunk 178KB gzip，进入统计详情就加载。

建议：

- 注册码、EO 规则补分页或虚拟滚动。
- `CdnZoneSetting` 按 tab 拆异步子组件，主页面只保留 overview。
- 弹窗组件和模板数据改动态 import。
- 移动端判空复用已渲染 VNode，数据刷新不重测列宽。
- 合并列表统计的多次遍历，复用日期解析缓存。

### P1-10 构建与加载细节

- `frontend/vite.config.ts:28` 的 600KB warning 阈值掩盖了 178KB gzip 的 charts chunk。
- `index.html` 没有为默认路由 chunk 做 modulepreload。
- `theme-init.js` 是同步外链，280 字节，可内联减少一个 RTT。
- `frontend/src/main.ts:49-76` 预取 12 个 chunk，可能和首屏数据争带宽。
- 仓库没有 Service Worker，`deploy/CDN-CACHE.md` 中关于 `/sw.js` 的说明与当前实现不一致。

## 5. 本地缓存体系设计

建议采用三层缓存：

1. L1：进程内 LRU + TTL，命中直接返回。
2. L2：数据库快照表，重启后仍可秒开，多副本可共享。
3. Background refresh：过期后返回 stale 数据，同时 singleflight 刷新。

### 5.1 建议缓存项

| 数据 | 建议 TTL | 失效方式 | 存储建议 |
|---|---:|---|---|
| CDN 账户解密配置 | 5-10 分钟 | 账户增删改、epoch | 内存；私有账户按 uid/jti |
| CDN 站点列表 | 30-60 秒 | 账户/站点变更 | 内存 + 可选 L2 |
| CDN 站点设置 | 30-60 秒 | 保存设置后失效 | 内存 |
| CDN 域名列表 | 30 秒 | 接入/删除/同步后失效 | 内存 |
| DNS 解析记录 | 10-30 秒 | 记录增删改后失效 | 内存；私有账户按会话 |
| DNS 记录总数 | 5-10 分钟 | 记录增删改后失效 | 内存 |
| Cloudflare 主机名 | 30-60 秒 | CF 写操作后失效 | 内存 |
| 证书候选/CNAME 状态 | 60 秒 | 证书写操作后失效 | 内存 |
| 事件订阅列表 | 30 秒 | 订阅保存后失效 | 内存 |
| CDN 统计 | 30 天落库 + 内存 2 分钟 | 定时刷新 | `cdn_stat_data` |

### 5.2 缓存键原则

- 包含账户、资源、查询参数、分页参数、排序参数。
- 域名列表和数组参数排序后再拼接，避免顺序不同产生重复 key。
- 包含用户可见范围或账户归属，避免跨租户命中。
- 私有账户记录不写入明文缓存表；需要持久化时使用用户 DEK 加密。
- 所有 key 带业务前缀，例如 `cdn:zones:`、`dns:records:`、`cf:hostnames:`。

### 5.3 失效策略

- 账户增删改：递增账户 epoch，清除该账户全部 provider/zone/domain 缓存。
- 解析记录增删改：调用现有 `invalidateDomainRecordCaches(domainId)`，同时清除搜索缓存。
- CDN 域名接入/删除/同步：按 `aid` 清除域名列表和统计概览缓存。
- 站点设置保存：清除该 `aid + zoneId` 的设置缓存。
- Cloudflare 写操作：按 zone 清除 hostnames 缓存。
- 证书申请/部署/删除：清除证书候选和 CNAME 状态缓存。
- 系统设置保存：清除对应配置缓存，不需要全量清空。

### 5.4 防击穿

- 每个 key 使用 singleflight，多个并发请求共享一次上游调用。
- 缓存过期时先返回 stale 数据，后台刷新。
- 刷新失败保留旧值，并记录 `lastError/lastAttempt`。
- 后台刷新使用随机抖动，避免所有账户整点同时打上游。

## 6. 前端秒开路线

### 6.1 首屏

1. 安装状态本地缓存，已安装后不阻塞路由。
2. 默认落地页改 `/dashboard`。
3. 启动时 await 当前语言包，或先加载核心命名空间。
4. 只读参考数据开启缓存。
5. 预取降到 2-3 个高频路由。
6. 重页面保留 keep-alive，但证书私钥页面不缓存。

### 6.2 列表与表格

1. CDN 域名、备份任务、缓存任务改服务端分页。
2. 注册码、EO 规则补分页或虚拟滚动。
3. 移动端表格判空复用已渲染 VNode。
4. 数据刷新不重新测量列宽，只在容器变化时测量。
5. 列表统计合并为一次遍历。

### 6.3 包体

1. `CdnZoneSetting` 按 tab 拆分。
2. 规则模板、规则创建器、ESA 卡片选择器改 async component。
3. `qrcode` 改动态 import。
4. 图表在进入视口后再加载。
5. 构建质量预算按 gzip 体积设置，避免只看原始体积。

## 7. 后端资源路线

1. 备份导出、统计刷新移到子进程或 worker。
2. SQLite 大表读取分批并主动让出事件循环。
3. 统计刷新使用独立连接池或全局信号量。
4. 长任务使用短锁 + 心跳续约，避免锁池耗尽。
5. 日志表增加 TTL 清理。
6. 生产构建改预编译 JS，减少 tsx 运行时内存。
7. `esaApiCatalog.json` 改为按需加载。

## 8. 实施路线

### 第一阶段：低风险高收益，约 1-2 天

1. 修复统计缓存时间对齐。
2. 默认开启统计缓存并预热。
3. 增加 CDN 站点列表和账户配置缓存。
4. 前端只读 GET 默认缓存，按前缀失效。
5. 根路径改 `/dashboard`，安装状态本地缓存，语言包启动 await。
6. 管理员 `/api/domains` 默认分页。

### 第二阶段：结构性优化，约 3-5 天

1. CDN 域名列表服务端分页，新增轻量 options 接口。
2. 解析记录、Cloudflare 主机名、DNS 检测 Zone 记录短缓存。
3. 统计详情按 zone/site 并发，设置请求级超时。
4. 补索引、裁列、日志 TTL。
5. 通知并行化、任务进度节流、事件订阅缓存。

### 第三阶段：持久化与资源隔离，约 1-2 周

1. 增加 provider 快照 L2 缓存表。
2. 备份导出、统计刷新移出主进程。
3. 拆分 CDN 站点设置大组件和重弹窗。
4. 建立性能预算与监控：缓存命中率、上游调用数、p95、事件循环延迟。

## 9. 验收指标

| 指标 | 目标 |
|---|---|
| `/api/cdn/zones?aid` 热缓存 p95 | < 100ms，上游调用 0 次 |
| `/api/cdn/statistics/detail` 热缓存 p95 | < 200ms，上游调用 0 次 |
| `/api/domains` 默认分页响应 | < 300ms，单页载荷 < 500KB |
| `/api/domains/:id/records` 二次访问 | < 100ms |
| 前端重复访问首屏 | < 1 秒 |
| 前端冷启动首访 | < 2-3 秒 |
| 首屏 JS gzip | < 180KB |
| 单路由 chunk gzip | < 30KB |
| 后端空闲 RSS | < 200MB |
| 备份执行期间 HTTP p95 | 无秒级尖峰 |

## 10. 风险与取舍

1. **数据陈旧**：统计和列表缓存需要展示 `dataUntil`/`cached`，让用户知道数据时间。
2. **失效遗漏**：缓存键和失效点必须集中管理，避免写操作后仍返回旧数据。
3. **私有数据隔离**：私有账户的解析记录和凭证不进入共享 L2，必要时使用用户 DEK 加密。
4. **多副本一致性**：L1 缓存只适合短 TTL；需要跨副本一致时使用 L2 或按 epoch 失效。
5. **默认缓存改变行为**：先从只读参考数据开始，逐步扩大范围，避免一次性改变所有接口语义。
6. **SQLite 迁移成本**：把备份/统计移出主线程需要额外进程管理，但收益最大，建议优先做。
7. **上游配额**：并发提升必须配合全局信号量和失败退避，避免从“慢”变成“被限流”。

## 11. 审查边界

- 本次为静态审查，未在生产数据上做压测，未测量真实云厂商 API 延迟。
- 行号基于 v1.37.0 工作区，后续改动可能导致偏移。
- 未评估第三方 CDN、对象存储、邮件服务的网络质量。
- 未对 `workers/` 做性能审查，该目录不参与主服务运行。
- 报告编写阶段未修改业务代码，实施变更见第 12 节。

## 12. 实施进度（2026-11-26）

| 批次 | 报告条目 | 状态 |
|---|---|---|
| 第一批 | P0-1 统计缓存键 | 已完成 |
| 第一批 | P0-3 CDN 站点实时枚举 | 已完成 |
| 第一批 | P0-7 前端 GET 缓存 | 已完成 |
| 第一批 | P0-8 首屏等待链路 | 已完成 |
| 第一批 | P1-1 账户配置缓存 | 已完成，共享账户配置与 provider 实例缓存均已落地 |
| 第一批 | P1-2 统计缓存默认值 | 已完成 |
| 第二批 | P0-2 统计详情串行扇出 | 已加 30 秒超时，站点级并发由第三批补齐 |
| 第二批 | P0-4 前端串行拉全量分页 | 已完成，改为轻量清单和服务端分页 |
| 第二批 | P0-5 域名与解析记录实时拉云 | 已完成，管理员分页/搜索、记录页缓存、整域名与子域名本地计数、域名规范化索引均已完成 |
| 第二批 | P1-4 解析记录短缓存 | 已完成，解析记录页与 Cloudflare 主机名均加短缓存 |
| 第二批 | P1-10 构建与加载细节 | 部分完成，预取已收敛，其余待做 |
| 第三批 | P0-2 统计详情站点级并发 | 已完成，EO/ESA 按站点并发，腾讯云 CDN 原有并发保留 |
| 第三批 | P1-3 统计实时路径 | 已完成，域名列裁剪、账户一次 IN 查询 |
| 第三批 | P1-5 固定请求开销 | 已完成，吊销负缓存、维护模式刷新、权限短缓存、分布式限流进程内预检 |
| 第三批 | P1-6 数据库索引缺口 | 部分完成，已补通知/任务/日志/域名过期索引；任务、备份、账户、证书账户、事件订阅、预热任务列表已按需取列 |
| 第三批 | P1-7 后台任务全量扫描 | 部分完成，到期批量 LIMIT、任务级有界并发、DNS Zone 短缓存、监控通知并行已完成；手动执行后台化待做 |
| 第三批 | P1-8 日志、任务和事件写放大 | 部分完成，日志 TTL、进度写库节流、订阅缓存、投递记录批量写已完成 |
| 第四批 | P0-6 SQLite 同步驱动阻塞 | 部分完成，备份快照移入只读 worker；导出、清理、统计刷新与清缓存均在批次间让出事件循环，尚未完全移出主线程 |
| 第四批 | P1-9 前端重组件与大列表 | 部分完成，注册码/EO 规则服务端分页，二维码、ECharts 与站点全局设置按需加载；CdnZoneSetting 进一步拆分待做 |
| 第五批 | P0-5 管理员域名列表与搜索降载 | 已完成，管理员默认分页 + SQL 检索 + summary，非管理员计数改本地缓存 |
| 第五批 | P1-4 Cloudflare 主机名短缓存 | 已完成，10 秒缓存，写操作后立即失效 |
| 第五批 | P1-5 分布式限流进程内预检 | 已完成，本地固定窗口预检，数据库异常时由本地镜像继续限流 |
| 第五批 | P1-6 索引与 SELECT * | 部分完成，补域名过期索引、任务列表去 result；账户列表等宽表仍待收窄 |
| 第六批 | P1-7 DNS Zone 缓存与任务并发 | 部分完成，DNS 记录 45 秒缓存、四类调度任务有界并发、监控通知并行；手动探测后台化待做 |
| 第七批 | P1-6 宽表字段收窄 | 部分完成，账户可见性查询按需取列，备份任务列表去掉 checksum/meta；通知日志等仍待处理 |
| 第八批 | P0-5 普通用户域名记录数本地化 | 已完成，整域名授权读 `domain.recordcount`，子域名授权读本地计数缓存，过期后回源 |
| 第九批 | P1-6 账户与订阅列表字段收窄 | 已完成，账户/证书账户/备份目的地显式列，事件订阅列表不再读取 secret |
| 第十批 | P1-7 上游主机并发信号量 | 部分完成，按主机限制并发与排队超时；账户级配额已在统计与 DNS 检测接入 |
| 第十一批 | P1-7 监控通知独立队列 | 已完成，探测流程只入队，通知按有界并发异步发送 |
| 第十二批 | P0-5 域名规范化索引 | 已完成，`domain.name_norm` 生成列 + 索引，授权/仪表盘查询优先走列，失败自动回退表达式 |
| 第十三批 | P1-8 事件投递写放大 | 已完成，投递记录按 1 秒/100 条批量插入，订阅状态按最后结果合并更新 |
| 第十四批 | P1-7 告警通知持久化 | 已完成，未发送通知落库，启动重放，最多重试 3 次 |
| 第十五批 | P0-5 子域名记录数本地缓存 | 已完成，`domain_subcount` 保存 10 分钟计数，记录写操作与域名删除时失效 |
| 第十六批 | P1-9 站点设置全局页懒加载 | 已完成，`CdnZoneGlobalSetting` 改为异步组件，站点设置 chunk 由 137.3KB 降到 125.9KB |
| 第十七批 | P1-6 预热任务列表去掉 URL 正文 | 已完成，列表返回 `url_count`，编辑时按 ID 读取完整任务 |
| 第十八批 | P1-9 大列表虚拟滚动 | 已完成，CDN 域名、容灾任务、操作日志超过阈值时启用虚拟滚动 |
| 第十九批 | P1-6 通知日志详情按需返回 | 已完成，MCP 通知列表默认只返回摘要，`detail=1` 才读取 8KB 详情 |
| 第二十批 | P1-7 账户级上游配额 | 部分完成，统计详情、统计刷新、DNS 检测已按账户限流，默认 8 并发 |
| 第二十一批 | P1-7 账户配额扩展到概览与站点枚举 | 已完成，统计概览、站点列表暂停状态补齐、未接入站点枚举进入账户上下文 |
| 第二十二批 | P1-9 版本管理标签页拆分 | 已完成，版本管理拆为 `CdnZoneVersionsTab.vue` 异步组件，站点设置 chunk 再降到 120.8KB |
| 第二十三批 | P1-7 批量操作接入账户配额 | 已完成，云端同步、证书批量、缓存刷新/预热、旧统计接口与站点切换补齐暂停状态均进入账户上下文 |
| 第二十四批 | P1-7 监控手动执行后台化 | 已完成，`/api/dmonitor/tasks/:id/run` 只创建去重后台任务并立即返回 `job_id`，HTTP 请求不再等待探测与通知 |
| 第二十五批 | P1-9 源站与负载均衡标签页拆分 | 已完成，源站与负载均衡拆为 `CdnZoneOriginTab.vue` 异步组件，站点设置 chunk 降到 114.7KB |
| 第二十六批 | P0-6 SQLite 批量写移出主线程 | 已完成，新增独立写 worker，统计缓存写入/清空与五类 TTL 清理按批在 worker 执行，失败整批回滚 |
| 第二十七批 | P1-9 边缘函数与 KV 标签页拆分 | 已完成，边缘函数、规则与 KV 拆为 `CdnZoneEdgeTab.vue`，站点设置 chunk 降到 94.4KB |
| 第二十八批 | P1-9 任务与统计标签页拆分 | 已完成，任务、实时日志、内容标识与诊断拆为 `CdnZoneTasksTab.vue`，站点设置 chunk 降到 79.9KB |

已完成：

- 统计查询区间按 5 分钟/小时/天对齐，详情与概览缓存键不再随秒变化。
- 统计缓存默认开启，服务启动后 5 秒预热一次。
- 统计详情增加 30 秒请求级超时，避免单个账户拖住整页。
- CDN 站点列表增加 30 秒 L1 缓存，账户站点创建、删除、暂停、属性修改后立即失效。
- 共享 CDN 账户解密配置增加 5 分钟缓存，账户变更通过 epoch 清理。
- 前端 GET 缓存改为参考数据默认缓存，写操作按 `/api/cdn/accounts`、`/api/cdn/domains`、`/api/domains` 等前缀失效，不再中止无关请求。
- 根路径改为 `/dashboard`，安装状态写入本地缓存 10 分钟，路由预取从 12 个降到 3 个。
- 新增 `/api/cdn/domains/options` 轻量清单，统计筛选与站点设置不再串行拉取全量分页。
- CDN 域名列表、缓存任务、整站备份、个人备份改为服务端分页。
- 解析记录翻页增加 15 秒缓存，写记录后按域名失效。
- 统计缓存默认值同步到系统设置页和部署文档。
- EdgeOne / 阿里云 ESA 统计详情按站点并发查询，单账户不再串行遍历全部站点。
- 统计实时兜底路径只查必要列，账户配置改为一次 `IN` 查询，域名行不再逐条查库。
- 令牌吊销负缓存延长到 5 秒，已吊销结果缓存 60 秒；维护模式只在写请求和调度前刷新。
- 用户权限增加 5 秒短缓存，用户授权变更和删除后立即失效。
- 补齐证书通知、异步任务、操作日志索引，操作日志和解析切换日志按批 TTL 清理。
- 后台任务进度写库节流到 1 秒，事件订阅缓存 30 秒并在订阅变更/备份恢复后失效。
- 定时切换、CDN 预热、DNS 检测、IP 优选四类到期任务增加单轮批量上限。
- SQLite 备份导出的快照读取移入独立只读 worker，主线程不再承担整表扫描；`:memory:` 与 worker 启动失败自动回退同步快照。
- 备份导出分页之间、日志 TTL 分批删除之间主动让出事件循环，降低同步 SQLite 驱动的连续阻塞时长。
- 注册码管理改为服务端分页，单页 50/100/200/500 可选，生成后回到第一页，删除末页自动回退。
- EdgeOne 规则列表改为服务端分页，前端只渲染当前页；删除末页最后一条时自动回退。
- TOTP 二维码库改为绑定流程内动态加载，统计图表组件改为异步加载，避免非必要首屏依赖。
- 域名到期统计复用已缓存的时间解析，CDN 域名汇总改为单次遍历。
- 管理员 `/api/domains` 默认 500 条分页，关键词与私有账户过滤下推到 SQL，返回 `total` 与 `summary`；显式 `limit=0` 保持全量，记录页与证书页改用全量参数。
- 域名列表前端改为服务端分页，统计数字使用后端聚合；解析记录搜索扫描上限降到 30 个域名，单字符关键词不再触发云端扫描。
- Cloudflare 自定义主机名列表增加 10 秒缓存，创建、编辑、刷新、删除及批量操作后立即失效。
- 分布式限流增加进程内固定窗口预检，本地已达上限时直接拒绝，数据库异常时由本地镜像继续限流。
- 补齐 `domain(checkstatus, checktime)` 索引，异步任务列表不再返回 `result` 大字段。
- DNS 检测按域名缓存 45 秒云端记录，同一域名的多个任务和子域名列表共享一次拉取。
- 定时切换、CDN 预热、DNS 检测、IP 优选按任务增加有界并发，默认并发 4/3/4/3，可用环境变量调整；同一域名的切换任务仍串行执行。
- 监控告警的邮件、企业微信、Telegram、QQ、Webhook 改为并行发送，单渠道异常不影响其他渠道与通知日志。
- 账户可见性查询支持列白名单，Cloudflare 规则、CDN 选项、证书订单等只取 `id`，统计页只取 `id/visibility/owner_uid`。
- 备份任务列表不再读取 `checksum` 与 `meta`，减少分页响应的宽字段。
- 普通用户域名列表的整域名授权直接使用本地 `recordcount`，不再逐域请求云端计数；子域名授权仍按需拉取记录计数。
- DNS 账户、CDN 账户、证书账户、备份目的地列表改为显式列；事件订阅列表不再读取 secret，仅返回 `secret_set`。
- 出站 HTTP 增加按主机并发信号量，默认同主机 32 并发、排队 30 秒超时，可通过 `DNSMGR_HOST_CONCURRENCY` 与 `DNSMGR_HOST_QUEUE_TIMEOUT_MS` 调整。
- 出站 HTTP 增加可选的账户级并发上下文，默认每账户 8 并发，可通过 `DNSMGR_ACCOUNT_CONCURRENCY` 调整；统计详情、统计概览、统计刷新、站点枚举和 DNS 检测已接入。
- 容灾监控通知改为进程内有界队列：探测流程只入队，不再等待邮件/Webhook 的 15 秒级超时。
- 统计刷新在账户之间让出事件循环，清空统计缓存改为每批 5000 行删除并逐批让出，避免单次同步删除长时间阻塞。
- `domain` 增加 `name_norm` 生成列与索引，域名列表、记录搜索、仪表盘和 MCP 授权查询优先使用该列；生成列创建失败时自动回退原表达式。
- 事件投递记录改为每 1 秒或累计 100 条批量插入，订阅 `last_status/last_error` 按订阅合并为一次更新。
- 容灾告警通知入队时写入 `notice_queue`，发送成功后删除；进程重启后重放未完成记录，超过 3 次尝试或 7 天前的记录自动清理。
- 普通用户子域名授权记录数写入 `domain_subcount`，10 分钟内直接复用；记录增删改、批量操作和域名删除时失效，私有账户不写入持久缓存。
- `CdnZoneSetting` 的全局设置改为异步组件，仅在切换到 global 标签页时加载；站点设置路由 chunk 从 137.3KB 降到 125.9KB，入口 chunk 保持 186.1KB。
- CDN 预热任务列表默认只返回链接数量，不再传输每条任务的完整 URL 正文；编辑弹窗通过 `GET /api/cdn/preheat-tasks/:id` 单独取详情。
- CDN 域名列表超过 100 条、容灾任务与操作日志超过 50 条时启用虚拟滚动，只渲染可视区域行。
- 通知日志列表不再固定读取 `detail` 大字段：MCP 默认只返回摘要与 `has_detail`，需要完整 JSON 时传 `detail=1`；未指定参数的旧调用保持完整返回。
- 统计详情、统计概览与统计刷新在按主机限流之上叠加账户级配额；站点列表暂停状态补齐、未接入站点枚举和 DNS 检测拉取记录也使用账户上下文。
- 版本管理标签页拆分为独立异步组件，站点设置路由 chunk 从 125.9KB 降到 120.8KB，入口 chunk 保持 186.1KB。
- CDN 云端同步、免费证书与联动证书批量任务、缓存刷新/预热、旧版统计接口，以及切换线路的站点暂停状态补齐都进入账户级配额；同一账户的并发批量请求共享 8 个上游令牌。
- 容灾监控手动执行改为后台任务：接口只创建按任务去重的 `async_job` 并返回 `job_id`，探测、DNS 切换和通知不再占用 HTTP 请求。
- 源站与负载均衡标签页拆为独立异步组件，`CdnZoneSetting` 路由 chunk 从 120.8KB 降到 114.7KB，入口 chunk 保持 186.1KB；全局刷新通过 `reloadKey` 触发子组件重新拉取。
- SQLite 新增独立写 worker：CDN 统计缓存批量写入、统计缓存清空，以及审计/通知/事件投递/操作日志/容灾日志五类 TTL 清理都按批交给 worker，主线程只等待结果；批次失败整批回滚，`:memory:` 自动回退主线程。
- 边缘函数与 KV 标签页拆为独立异步组件，带函数编辑、函数规则、KV 数据、副本、绑定和运行时抽屉；站点设置 chunk 从 114.7KB 降到 94.4KB。
- 任务与统计标签页拆为独立异步组件，带缓存任务、实时/离线日志、内容标识、诊断与 Top 分析；站点设置 chunk 从 94.4KB 降到 79.9KB，入口 chunk 保持 186.1KB。

仍待实施：

- `CdnZoneSetting` 的规则与安全标签页仍在主组件内；这两页与规则编辑器、WAF/共享 CNAME 等弹窗状态高度耦合，暂未拆分。

## 附录 A：重点文件清单

| 文件 | 关注点 |
|---|---|
| `backend/src/routes/cdn.ts` | 统计缓存键、站点枚举、统计扇出、域名列表 |
| `backend/src/lib/cdn/statistics/overview.ts` | 概览缓存键 |
| `backend/src/lib/cdn/statistics/detail/*` | 详情缓存与 provider 扇出 |
| `backend/src/lib/cdn/statistics/cacheService.ts` | 统计落库、刷新、默认开关 |
| `backend/src/routes/domain.ts` | 域名列表、解析记录、搜索、缓存 |
| `backend/src/routes/cloudflare.ts` | 主机名、TXT 目标 |
| `backend/src/routes/account.ts` | 账户站点枚举、配置解密 |
| `backend/src/lib/accounts/visibility.ts` | 账户可见性与 SELECT * |
| `backend/src/db/sqlite.ts` | 同步驱动、WAL、写互斥 |
| `backend/src/lib/backup/export.ts` | 快照读取与导出 |
| `backend/src/lib/jobs.ts` | 任务进度、清理、并发 |
| `backend/src/lib/events.ts` | 事件投递写放大 |
| `backend/src/lib/rateLimit.ts` | 分布式限流往返 |
| `backend/src/index.ts` | 请求钩子、维护模式、调度器 |
| `frontend/src/api.ts` | GET 缓存、写失效、去重 |
| `frontend/src/router.ts` | 安装探测、默认路由 |
| `frontend/src/main.ts` | 语言包、预取 |
| `frontend/src/views/CdnDomain.vue` | 全量分页、表格 |
| `frontend/src/views/CdnZoneSetting.vue` | 大组件、串行加载、全量分页 |
| `frontend/src/views/StatisticsDetail.vue` | 统计选项、自动刷新 |
| `frontend/src/components/ResponsiveDataTable.vue` | 判空渲染、布局测量 |
| `frontend/vite.config.ts` | 分包、体积阈值 |
| `Dockerfile` | tsx 运行与生产构建 |
| `deploy/kubernetes.yaml` | 内存与副本配置 |
