# Cloudflare Workers 版未移植功能报告

- 报告日期：2026-11-24
- Workers 版本：0.31.0
- 对比基线：`backend/src/routes/*`、`backend/src/lib/*`、`frontend/src/views/*`
- 实现文件：`workers/src/worker.ts`、`workers/schema.sql`
- 对比范围：后端全部 HTTP 路由、前端实际调用、DNS/CDN/证书厂商适配器

## 1. 结论

Workers 版已经覆盖主链路：认证、TOTP、API Key、Cloudflare/Mock DNS、域名与解析记录、批量导入、记录日志、Cloudflare Tunnel、Cloudflare for SaaS、Cloudflare 规则引擎、ACME 证书、证书通知、备份、容灾监控、优选 IP、定时切换、到期提醒、审计、注册、公告、系统设置。

当前主要缺口：

1. 证书部署适配器：任务、账户、执行、日志与调度已完成，51 个适配器中已移植 48 个，剩余 3 个运行时受限适配器见 §8.3。
2. 厂商官方接口限制：阿里云 ESA 四层状态/规则、白山云 Top URL 与实时日志、七牛云独立配额等官方未开放或未提供接口。
3. 运行时能力限制：保险库口令模式、安装器、出站代理、SSH/FTP/本地部署适配器不在 Workers 运行时范围内。

后端共约 506 个路由定义，其中 CDN 222 个。Workers 版已以 Mock/本地持久化方式补齐 CDN 站点、加速域名、证书、线路切换、高级资源、事件、任务与证书部署接口，其余业务模块覆盖度较高。


## 1.1 本次补全记录（2026-11-22）

本次在 Workers 版补全以下接口，并已通过 `npm run check`（tsc + wrangler dry-run）与本地 dev 实测：

| 模块 | 完成内容 | 状态 |
|---|---|---|
| 解析检测 | `POST /api/domains/:id/records/check` 支持 active/cloudflare/not_found/mismatch；新增 `GET /api/domains/:id/quickinfo` | 已完成 |
| 关于页 | `GET /api/about`、`POST /api/about/check-update` | 已完成 |
| 认证 | `POST /api/auth/lang`、`POST /api/auth/logout-all`（token_invalid_before） | 已完成 |
| API Key | `PATCH /api/api-keys/:id`、`DELETE /api/api-keys/legacy` | 已完成 |
| 审计与操作日志 | `GET /api/audit/logs/export`（JSON/CSV）、`GET /api/logs` | 已完成 |
| 运维探针 | `GET /api/ready`、`GET /api/metrics`（Prometheus） | 已完成 |
| 到期扫描 | `POST /api/expire/scan` | 已完成 |
| 远端备份 | `DELETE /api/backup/remote/:destId`、`POST /api/backup/remote/:destId/pull` | 已完成 |
| Cron | 新增 `/cron` 别名，写入 `run_worker_first` | 已完成 |
| CDN 统计 | overview/detail 支持 EdgeOne、腾讯云 CDN、阿里云 CDN、阿里云 ESA、华为云 CDN、七牛云 CDN、百度云 CDN、火山引擎 CDN、金山云 CDN、CDNetworks、网宿 CDN、白山云 CDN 实时指标（流量、带宽、回源、请求、命中率、状态码，部分厂商支持性能与 Top 维度） | 十二种服务商已完成 |
| CDN 站点 | zones 列表/全局设置、plan-instances、sites 检查/创建/查询/验证/暂停/绑定套餐、ns/properties/更新/删除、config 导入导出、custom-variables、versions/work-mode | EdgeOne/ESA 站点名校验、站点与套餐、属性读写、暂停与删除真实；Mock 基础完成 |
| CDN 加速域名 | 列表筛选、详情、origin/cache/https/access/zone_setting、Mock 同步 | 已完成（本地存储/Mock） |
| CDN 线路切换 | `switch/sites`、`switch/check`、`switch`，同步 DNS CNAME，支持切换时配置证书 | 已完成（12 种线路） |
| CDN 证书 | 免费证书、自定义证书、候选查询、证书联动、日志、重试、模式与状态 | 已完成；EdgeOne/ESA 免费证书，腾讯云 CDN、阿里云 CDN、七牛 CDN、华为云 CDN、百度云 CDN、火山引擎 CDN、CDNetworks、金山云 CDN、白山云 CDN、网宿 CDN 自定义证书真实上传与绑定；其余为 Mock 签发与部署 |
| CDN 离线日志 | 腾讯云 CDN、阿里云 CDN、华为云 CDN、七牛云 CDN、百度云 CDN、金山云 CDN、CDNetworks、网宿 CDN、白山云 CDN、火山引擎 CDN 域名日志查询与下载地址 | 已完成 |
| CDN 站点高级设置 | environments、versions、history、deploy、work-mode | 已完成；EdgeOne 环境、配置组版本、发布历史、版本发布、版本详情、工作模式与站点自定义变量真实下发，其余本地持久化 |
| 边缘函数与 KV | 函数 CRUD/运行时/副本/绑定/规则；KV 命名空间与键读写 | 已完成；EdgeOne 函数/运行时/副本/组件绑定/函数规则与 EdgeKV 命名空间/键读写真实下发，其余本地持久化 |
| 四层与负载均衡 | L4 代理/规则/状态、源站组、负载均衡/健康检查 | EdgeOne 四层代理 CRUD/状态/规则/规则状态、源站组、负载均衡与健康检查、ESA 源站组/负载均衡/四层代理 CRUD 真实下发；ESA 四层规则/状态受官方接口限制，其他厂商本地持久化 |
| 共享 CNAME / 别名 / 错误页 | 列表、创建、修改、启停、删除 | 已完成；EdgeOne 共享 CNAME/绑定、别称域名/状态、自定义响应页面真实下发，其余本地持久化 |
| CDN 安全与规则 | IP 组、WAF/DDoS/源站防护配置、WAF 模板与绑定、JS 注入、客户端认证、API 服务/资源、规则与规则配置 | EdgeOne 与 ESA 规则引擎、EdgeOne/ESA 安全配置、EdgeOne IP 组与 WAF 模板/JS 注入/客户端认证/API 安全真实；其余本地持久化 |
| 多通道 / 推理 / 媒体 / 账单 | 网关、线路、密钥、推理服务/令牌/域名、转码模板、套餐 | 已完成；EdgeOne 多通道网关/线路/密钥/回源 ACL、推理服务/部署记录/日志/监控/Token/域名/硬件规格、即时转码模板、套餐与计费全部真实下发，其余本地持久化 |
| CDN 日志 / 配额 / 分析 / 诊断 | 实时日志任务、离线日志、配额、Top/时序、DDoS、IP 归属 | EdgeOne 实时日志、Top、缓存时序、DDoS、L4 时序与 IP 归属；腾讯云/阿里云/华为云/七牛云/百度云/CDNetworks/网宿/白山云/火山引擎/金山云 CDN 离线 L7 日志；阿里云 CDN/ESA/腾讯云/华为云/金山云/百度云/白山云/火山引擎/CDNetworks/网宿 CDN 配额真实查询；腾讯云、阿里云、华为云、百度云、CDNetworks、网宿、金山云 Top URL 真实查询 |
| 事件与任务 | 事件订阅 CRUD/测试/投递记录、异步任务查询、通知日志 | 已完成 |
| ESA API 控制台 | 官方 catalog 目录与全部 actions 执行 | 已完成（真实 ESA OpenAPI，478 个动作） |
| CDN 缓存增强 | 开发模式、缓存标签、屏蔽、分层缓存、上传/刷新、任务详情与重试 | ESA 开发模式、缓存标签、屏蔽、分层缓存、上传文件与任务列表真实下发；其余本地持久化 |
| 站点配置导入 | 解析并应用 zoneSetting、customVariables、站点属性，保存任务结果 | 已完成；EdgeOne 配置导出/导入/导入结果查询真实调用，其余本地解析应用 |
| 站点套餐绑定 | EdgeOne `BindZoneToPlan` 真实绑定并更新本地；其余更新本地 plan_id/plan_name | 已完成 |
| DNS 厂商适配 | 新增阿里云 DNS、腾讯云 DNSPod：账户验证、域名拉取、记录 CRUD/状态/备注、线路 | 已完成 |
| DNS 记录分组 | DNSPod `DescribeRecordGroupList` / `ModifyRecordToGroup`，支持记录列表分组与批量改分组 | 已完成 |
| 域名分类 | `GET/POST/PUT/DELETE /api/domains/categories`，域名列表返回 `category_name`，删除分类时解绑域名 | 已完成 |
| 厂商特有解析 | 阿里云权重解析、DNSPod 域名别名 CRUD | 已完成 |
| 更多 DNS 厂商 | 阿里云 ESA、腾讯云 EdgeOne、dynv6、PowerDNS、NameSilo、Technitium、DNSLA、Spaceship、dnsmgr、GoEdge、华为云、百度云、火山引擎、京东云、西部数码、青云、宝塔、Hurricane Electric、AWS Route 53：验证、域名、记录 CRUD/状态/备注/线路 | 已完成 |
| 数据表 | 新增 `cdn_zone`、`cdn_domain_setting`、`cdn_resource`、`cert_link_log`、`event_subscription`、`event_delivery`、`notification_log`、`async_job`，users 增加 `lang`、`token_invalid_before` | 已完成 |

当前仍未完成：白山云 Top URL 与实时日志、七牛云独立配额接口，以及各厂商未公开的高级站点管理能力。Workers 版已补齐全部 12 种 CDN 厂商实时统计、全部 22 种 DNS 厂商、全部云证书厂商、全部 12 种 CDN 厂商核心能力和 CDN 控制台的 Mock/本地能力。

## 1.2 本次补全记录（2026-11-24）

本次移植服务器版证书自动部署模块，补全 10 个 `/api/deploy/*` 接口、部署账户体系、部署日志与定时调度：

| 模块 | 完成内容 | 状态 |
|---|---|---|
| 部署账户 | `cert_account.deploy = 1`，支持创建、编辑、删除与自动部署厂商验证；证书账户与部署账户分列表查询 | 已完成 |
| 部署任务 | `GET/POST /api/deploy/tasks`、`PUT/DELETE /api/deploy/tasks/:id`，支持筛选、统计、掩码配置与编辑回填 | 已完成 |
| 部署执行 | `POST /api/deploy/tasks/:id/process`、`POST /api/deploy/tasks/batch/process`，单任务与批量执行并写入逐条结果 | 已完成 |
| 部署日志 | `GET /api/deploy/tasks/:id/logs`，新增 `cert_deploy_log` 表，按任务保存执行日志 | 已完成 |
| 部署控制 | `POST /api/deploy/tasks/:id/reset`、`POST /api/deploy/tasks/:id/setactive` | 已完成 |
| 部署厂商元数据 | `GET /api/deploy/providers`，返回全部 51 种厂商配置与 `implemented` 标记 | 已完成 |
| 部署适配器 | 已移植 48 个适配器，覆盖宝塔、宝塔 Win、Nginx Proxy Manager、Lucky、雷池、SamWAF、1Panel、GoEdge、CDNfly、LEcdn、UUSEC、七牛、又拍、白山、网宿、天翼云、uniCloud、Gcore、CacheFly、S3 存储、FTP、Kubernetes，以及腾讯云、华为云、百度云、火山引擎、阿里云、AWS、UCloud、金山云 | 已完成（48/51） |
| 定时调度 | `/cron` 每分钟处理到期且未成功的部署任务，最多 3 个，失败自动退避重试 | 已完成 |
| 数据表 | 新增 `cert_deploy`、`cert_deploy_log` 及索引 | 已完成 |

未移植的 3 个适配器：`fnos`、`ssh`、`local`。这些适配器依赖 Workers 不提供的 SSH 或本地文件系统能力，保留为服务器版专属。Kubernetes 仅支持 Bearer Token 与公网 CA。

本地 dev 已实测：部署账户创建校验、任务增删改查、单任务执行、批量执行、日志读取、重置、启停、账户删除约束均通过。

## 1.3 本次补全记录（2026-11-24，QQ 机器人）

本次补齐 QQ 机器人通知与回调链路：

| 模块 | 完成内容 | 状态 |
|---|---|---|
| QQ 机器人凭证 | AppID/AppSecret 派生 Ed25519 密钥，获取并缓存 `access_token` | 已完成 |
| QQ 机器人回调 | `POST /api/qqbot/webhook` 校验 AppID、User-Agent、Ed25519 签名与时间戳 | 已完成 |
| 回调地址验证 | `op=13` 返回 `plain_token` 与 Ed25519 签名 | 已完成 |
| 消息去重 | 新增 `qq_nonce` 表，消息 ID 一次性消费 | 已完成 |
| 通知绑定 | C2C 消息携带一次性绑定口令后写入 `qqbot_openid`，换绑通知旧账号 | 已完成 |
| 通知发送 | `notice_qqbot`、`cert_notice_qqbot`、`expire_notice_qqbot` 接入 QQ 单聊 Markdown 消息 | 已完成 |
| 连通测试 | `POST /api/system/qqbottest` 真实调用 QQ 开放平台 | 已完成 |
| 数据表 | 新增 `qq_nonce` | 已完成 |

本地 dev 已实测：有效签名 `op=13` 返回可被公钥验证的签名；C2C 消息完成绑定并清空一次性口令；无效 AppID 测试返回 QQ 开放平台错误 `[100007]`，确认请求已到达上游。

## 1.4 本次补全记录（2026-11-24，邮件发送）

本次补齐邮件发送通道：

| 模块 | 完成内容 | 状态 |
|---|---|---|
| SMTP 直连 | `mail_type=0` 支持 465 隐式 TLS、587 STARTTLS、PLAIN/LOGIN 认证、多收件人、HTML base64 编码与 20 秒超时 | 已完成 |
| 阿里云邮件推送 | `mail_type=2` 通过 `SingleSendMail` 真实调用 `dm.aliyuncs.com` | 已完成 |
| 邮件测试 | `/api/system/mailtest` 与通知、验证码共用发送实现 | 已完成 |

本地 dev 已实测：本地 SMTP 调试服务收到完整 MIME 邮件；阿里云假凭证返回 `Specified access key is not found.`，确认请求已到达上游。

## 1.5 本次补全记录（2026-11-24，旧版 API 兼容层）

本次补齐旧版彩虹 DNS API：

| 模块 | 完成内容 | 状态 |
|---|---|---|
| 旧版认证 | v2 HMAC-SHA256 绑定 method/path/uid/timestamp/nonce/参数摘要；v1 MD5 需显式开启；`legacy_nonce` 一次性校验防重放 | 已完成 |
| 域名列表 | `/api/domain` 支持关键字、账户、类型、分类、到期状态筛选与排序 | 已完成 |
| 域名详情 | `/api/domain/:id` 返回厂商配置、线路与最小 TTL | 已完成 |
| 解析记录 | `/api/record/data|add|update|delete|status|remark|batch/:id` | 已完成 |
| 证书导出 | `/api/cert/order` 仅接受 v2 签名，校验登录密码与 PFX 口令，返回证书、私钥与 PFX | 已完成 |
| 数据表 | 新增 `legacy_nonce` | 已完成 |

本地 dev 已实测：v2 列表、详情、记录增改停删、批量删除与证书 PFX 导出通过；重放同一 nonce 返回 403；v1 关闭时返回 403、开启后可用；关闭兼容开关返回 404。

## 1.6 本次补全记录（2026-11-24，FTP 部署适配器）

本次补齐 `ftp` 自动部署适配器：

| 模块 | 完成内容 | 状态 |
|---|---|---|
| FTPS 连接 | 显式 `AUTH TLS`，登录后 `PBSZ 0` / `PROT P`，控制与数据连接均加密 | 已完成 |
| 被动模式 | 优先 `EPSV`，失败回退 `PASV` | 已完成 |
| 文件上传 | PEM 证书/私钥、PFX 上传，私钥与 PFX 尝试 `SITE CHMOD 600` | 已完成 |
| 路径防护 | 拒绝 `..`、系统敏感目录、shell 启动脚本与 `authorized_keys` | 已完成 |
| 明文 FTP | 仅当 Worker 配置 `ALLOW_INSECURE_DEPLOY=1` 时允许 | 已完成 |

本地 dev 已实测：明文 FTP 上传 PEM 证书/私钥与 PFX 成功，`SITE CHMOD 600` 生效；FTPS 使用 Workers 内置证书校验，自签名证书不支持。

## 1.7 本次补全记录（2026-11-24，Kubernetes 部署适配器）

本次补齐 `k8s` 自动部署适配器：

| 模块 | 完成内容 | 状态 |
|---|---|---|
| Kubeconfig | 解析 current-context、cluster、user，支持 Bearer Token 与 auth-provider access-token | 已完成 |
| Secret 下发 | 查询不存在则创建，已存在则 merge-patch 更新 `kubernetes.io/tls` Secret | 已完成 |
| Ingress 更新 | 读取 Ingress 主机名，合并 `spec.tls` 并关联 Secret | 已完成 |
| 限制 | 仅支持公网受信任 CA；客户端证书、自定义 CA、关闭证书校验均返回明确错误 | 已完成 |

本地 dev 使用 mock Kubernetes API 实测：`/version` 校验、Secret 创建与更新、Ingress TLS 合并均通过；`/api/deploy/providers` 返回 48 个 `implemented`，未实现仅 `fnos`、`ssh`、`local`。

## 1.8 本次补全记录（2026-11-24，旧版快捷登录）

本次补齐旧版域名快捷登录：

| 模块 | 完成内容 | 状态 |
|---|---|---|
| 登录链接签发 | `/api/domain/:id` 的 `loginurl=1` 生成带签名的 `/quicklogin` URL，支持只读标记 | 已完成 |
| 链接校验 | 校验域名、时间戳 ±300 秒、MD5 签名、域名唯一性与 `is_sso` | 已完成 |
| 一次性票据 | 复用 `legacy_nonce`，同一链接重复访问返回 403 | 已完成 |
| 域名会话 | 签发 2 小时域名级 JWT，只允许访问该域名的域名列表与解析记录接口 | 已完成 |
| 只读会话 | `ro=1` 会话仅允许 GET，写操作返回 403 | 已完成 |
| 路由接入 | `/quicklogin` 加入 `run_worker_first`，避免被静态资源接管 | 已完成 |

本地 dev 已实测：快捷登录 HTML 返回可用的 `dnsmgr_token`；`/api/auth/me` 返回域名用户；域名列表仅返回授权域名；跨域名记录访问返回 404；只读会话写记录返回 403；同一链接重放返回 403；关闭兼容开关后 `/quicklogin` 返回 404。

## 1.9 本次补全记录（2026-11-24，P0/P1/P2 权限与运维能力）

本次按 `WORKERS_CF_FEASIBLE_BACKLOG.md` 补齐以下能力：

| 模块 | 完成内容 | 状态 |
|---|---|---|
| 权限模型 | 共享账户仅管理员、私有账户仅所有者；域名/子域名/只读授权收口到记录、域名列表、旧版 API；记录 `_access` 返回真实权限 | 已完成 |
| 账户配置 | DNS/CDN/证书账户配置掩码回显，保存时合并掩码值 | 已完成 |
| API Key | 按 HTTP 方法区分读写作用域、CIDR 白名单、`dmk_`/`dnsmgr_` 双前缀兼容 | 已完成 |
| 认证加固 | 登录锁定、TOTP 防重放、`token_version`/`jti` 吊销、二次确认绑定会话与操作 | 已完成 |
| 用户删除 | 清理私有账户、域名、CDN、证书、任务、API Key、备份与授权 | 已完成 |
| 旧版 API | 域名/记录归属校验、`minTTL` 按厂商读取、快捷登录 `sys_key` 兼容 | 已完成 |
| CDN 统计 | 基础统计聚合、`app_setting` 持久化缓存、cron 刷新、非管理员 `stat_cache` 授权 | 已完成 |
| DNS 检测 | 告警邮件、按任务所有者执行、权限与子域名范围、限流与 D1 锁、Cloudflare 代理识别 | 已完成 |
| 事件 | 证书签发/失败、部署成功/失败、备份完成、容灾切换主动投递，失败重试与并发上限 | 已完成 |
| 系统设置 | 敏感项掩码、掩码保存跳过、QQ 凭据变更清空绑定、`mail_name2` 兼容、cron `cron_type` 与 Bearer/query 鉴权、审计变更 | 已完成 |
| 公告与仪表盘 | 公告默认启用、局部更新与时间校验；普通用户仪表盘按授权统计且不返回用户总数 | 已完成 |
| 注册流程 | 发码 IP 限流与 24 小时上限、验证码失败上限、凭据消耗与建号 D1 batch、撞名消耗尝试 | 已完成 |
| 任务中心 | 到期扫描、备份、证书批量处理写入 `async_job` | 已完成 |
| 证书 | WebCrypto ECDSA P-256/P-384/P-521 CSR、`cert_cname` DNS-01 委派、腾讯/阿里/UCloud 云证书自动续签、证书 CNAME 创建/检查/删除与权限收口 | 已完成 |
| CDN 站点 | `/api/cdn/zones?aid` 云端优先并回退本地缓存、EdgeOne `DescribeL7AccSetting`/`ModifyL7AccSetting` 差异下发、非 EdgeOne 本地配置标识 | 已完成 |
| CDN 预热 | 预热/刷新任务保存账户、站点、参数、云端任务 ID；重试真实重提并记录错误与次数 | 已完成 |
| CDN 高级能力 | EdgeOne 函数/KV/安全/共享 CNAME/别名/错误页/多通道/推理/媒体/账单真实下发，ESA 源站组/负载均衡/四层/任务真实下发；本地资源统一 `source=local`、`local=true`，补齐 EdgeOne 刷新/预热任务查询 | 已完成 |
| 备份 | 整站导入/恢复、维护模式、恢复前快照、旧会话失效、SigV4 S3、个人备份 ID 重映射、备份目标掩码 | 已完成 |
| 前端契约 | 账户 `config`/`config_state`/`config_error`、记录真实 `_access`、云端站点、统计、证书能力字段 | 已完成 |
| 工程配套 | 静态路由契约脚本纳入 `npm run check`，覆盖关键路由、响应字段、权限断言与前端关键页面契约；新增 CDN 能力矩阵 | 已完成 |

本地 dev 已实测：设置掩码、cron 三种鉴权、DNS 检测授权/限流、备份事件投递、统计刷新、公告局部更新、普通用户仪表盘、注册验证码与建号、到期扫描异步任务、ECC CSR（OpenSSL 校验）、证书 CNAME 路由、站点配置本地回退、缓存任务重试真实提交、云证书续签失败落库、整站备份恢复与维护模式、个人备份 ID 重映射、备份目标掩码、CDN 本地资源来源标识。

## 2. 风险等级

| 等级 | 定义 |
|---|---|
| P0 | 前端已有入口或按钮，调用后直接报错、空白或功能不可用 |
| P1 | API 能力缺失，当前前端未强依赖，但影响接口完整性和运维能力 |
| P2 | 厂商适配缺失，影响真实生产环境使用 |
| 已排除 | 已明确不在 Workers 版范围内 |

## 3. P0：前端已有入口但接口缺失

| 功能 | 缺失接口 | 前端位置 | 影响 |
|---|---|---|---|
| 解析保存前冲突检查（已完成） | `POST /api/domains/:id/records/check`、`GET /api/domains/:id/quickinfo` | `frontend/src/components/RecordTable.vue:634` | 已支持 active/cloudflare/not_found/mismatch |
| 关于页（已完成） | `GET /api/about`、`POST /api/about/check-update` | `frontend/src/views/About.vue:230`、`:238` | 信息与更新检查可用 |
| 语言偏好同步（已完成） | `POST /api/auth/lang` | `frontend/src/composables/useLocale.ts:37` | 语言偏好写回用户 |
| API Key 旧密钥删除（已完成） | `DELETE /api/api-keys/legacy` | `frontend/src/views/Preferences.vue:274` | 可停用旧版用户密钥 |
| API Key 编辑（已完成） | `PATCH /api/api-keys/:id` | API 对等能力 | 支持名称、作用域、IP 白名单、有效期、启停 |
| 审计日志导出（已完成） | `GET /api/audit/logs/export` | API 对等能力 | 支持 JSON/CSV 导出 |
| CDN 统计（十二种服务商已完成） | `GET /api/cdn/statistics/overview`、`GET /api/cdn/statistics/detail`、`GET /api/cdn/statistics` | `frontend/src/views/Statistics.vue:118` | EdgeOne、腾讯云 CDN、阿里云 CDN、华为云 CDN、百度云 CDN、火山引擎 CDN、金山云 CDN、CDNetworks、网宿 CDN、白山云 CDN 返回流量/带宽/回源/请求/命中率与状态码；ESA 返回流量/请求/请求流量/PV；七牛云 CDN 返回流量/带宽 |
| CDN 站点列表（已完成，Mock） | `GET /api/cdn/zones`、`GET/POST /api/cdn/zones/setting` | `frontend/src/views/CdnZone.vue:374`、`CdnZoneGlobalSetting.vue:184` | Mock 站点可列表与保存配置 |
| CDN 套餐实例（已完成） | `GET /api/cdn/accounts/:aid/plan-instances` | `CdnZone.vue:294`、`CdnZoneSetting.vue:1319` | EdgeOne `DescribePlans`、ESA `ListUserRatePlanInstances` 真实查询；Mock 套餐可创建 |
| CDN 站点接入（已完成） | `POST /api/cdn/accounts/:aid/sites/check`、`POST /sites`、`POST /sites/verify`、`POST /sites/pause`、`POST /sites/bind-plan` | `CdnZone.vue:318` 等 | EdgeOne/ESA 真实接入、校验、暂停、绑定套餐；Mock 站点同样可用 |
| CDN 站点配置（已完成） | `/sites/:zoneId`、`/ns`、`/properties`、`/config/export`、`/config/import`（解析并应用）、`/custom-variables`、`/environments`、`/versions`、`/work-mode` | `CdnZoneSetting.vue` | 站点配置与高级设置可用 |
| CDN 加速域名详情（已完成） | `GET /api/cdn/domains/:id` | `CdnDomainSetting.vue:167` | 详情页可加载 |
| CDN 回源设置（已完成，本地保存） | `POST /api/cdn/domains/:id/origin` | `CdnDomainSetting.vue:274` | 源站配置可保存 |
| CDN 缓存规则（已完成） | `POST /api/cdn/domains/:id/cache` | `CdnDomainSetting.vue:206` | 12 种厂商云端下发（EdgeOne/ESA 为规则引擎） |
| CDN HTTPS 设置（已完成） | `POST /api/cdn/domains/:id/https` | `CdnDomainSetting.vue:221` | 12 种厂商云端下发 HTTPS 与强制跳转 |
| CDN 访问控制（已完成） | `GET/POST /api/cdn/domains/:id/access` | `CdnDomainSetting.vue:189`、`:239` | 12 种厂商云端下发 Referer/IP/UA（ESA 使用 WAF 规则），同时本地保存 |
| CDN 线路切换（已完成） | `GET /cdn/domains/:id/switch/sites`、`GET /switch/check`、`POST /switch` | `CdnSwitchRouteModal.vue:336` 等 | 可切换 12 种厂商线路，自动接入目标域名并同步 DNS CNAME |
| CDN 免费证书（已完成） | `POST /cdn/domains/freecert`、`POST /freecert/check` | `CdnDomain.vue:806`、`:823` | EdgeOne/ESA 真实申请，其余本地部署 |
| CDN 自定义证书（已完成，Mock） | `POST /cdn/domains/cert`、`POST /cert/check`、`GET /cdn/cert/candidates` | `CdnDomain.vue:839`、`:1430` | 可复用或创建 Mock 证书 |
| CDN 证书联动（已完成） | `POST /cdn/domains/:id/certlink`、`GET /certlink/log`、`POST /certlink/run`、`POST /cert_mode`、`GET /cert_status` | `CdnDomain.vue:733`、`:857`、`:914`、`:935` | EdgeOne/ESA/腾讯云 CDN/阿里云 CDN/七牛 CDN/华为云 CDN/百度云 CDN/火山引擎 CDN/CDNetworks/金山云 CDN/白山云 CDN/网宿 CDN 真实上传部署；其余 Mock 申请、部署与进度 |
| CDN 同步（已完成） | `POST /api/cdn/sync` | `CdnDomain.vue:1500` | 12 种真实厂商同步站点与域名；Mock 账户本地同步 |
| CDN 域名区域设置（已完成） | `POST /api/cdn/domains/:id/zone_setting` | `CdnDomainSetting.vue` | 配置本地持久化 |
| ESA API 目录（已完成） | `GET /cdn/accounts/:aid/esa/catalog` | `CdnEsaApi.vue`、`CdnEsaConsole.vue` | 返回官方动作目录 |
| ESA API 执行（已完成） | `POST /cdn/accounts/:aid/esa/actions` | `CdnEsaConsole.vue` | 校验必填参数并真实调用 ESA OpenAPI |

## 4. P1：基础 API 缺口

### 4.1 关于与认证

| 方法 | 路径 | 状态 |
|---|---|---|
| GET | `/api/about` | 已完成 |
| POST | `/api/about/check-update` | 已完成 |
| POST | `/api/auth/lang` | 已完成 |
| POST | `/api/auth/logout-all` | 已完成 |
| GET | `/quicklogin` | 已完成，域名级 JWT 会话与一次性票据 |

### 4.2 API Key 与审计

| 方法 | 路径 | 状态 |
|---|---|---|
| PATCH | `/api/api-keys/:id` | 已完成 |
| DELETE | `/api/api-keys/legacy` | 已完成 |
| GET | `/api/audit/logs/export` | 已完成 |

### 4.3 事件、可观测性与任务

| 方法 | 路径 | 状态 |
|---|---|---|
| GET | `/api/events/subscriptions` | 已完成 |
| POST | `/api/events/subscriptions` | 已完成 |
| PUT | `/api/events/subscriptions/:id` | 已完成 |
| DELETE | `/api/events/subscriptions/:id` | 已完成 |
| POST | `/api/events/subscriptions/:id/test` | 已完成 |
| GET | `/api/events/deliveries` | 已完成 |
| GET | `/api/ready` | 已完成 |
| GET | `/api/metrics` | 已完成 |
| GET | `/api/notifications/logs` | 已完成 |
| GET | `/api/jobs` | 已完成 |
| GET | `/api/jobs/:id` | 已完成 |

### 4.4 用户、备份与到期

| 方法 | 路径 | 状态 |
|---|---|---|
| GET | `/api/logs` | 已完成（映射审计日志） |
| DELETE | `/api/backup/remote/:destId` | 已完成 |
| POST | `/api/backup/remote/:destId/pull` | 已完成 |
| POST | `/api/expire/scan` | 已完成 |

备份任务的下载、删除、目标 CRUD、目标测试、计划 CRUD、计划执行已经实现。远端备份已支持 `GET /api/backup/remote/:destId` 列目录、`DELETE` 删除和 `POST /pull` 拉回本地。

### 4.5 安装器

| 方法 | 路径 | 状态 |
|---|---|---|
| GET | `/api/setup/status` | 已实现，固定返回 `installed: true` |
| POST | `/api/setup/check` | 未实现 |
| POST | `/api/setup/install` | 未实现 |
| POST | `/api/setup/skip` | 未实现 |
| POST | `/api/setup/import` | 未实现 |

Workers 版直接使用 D1，安装页没有实际作用。

### 4.6 Cron 与保险库

| 方法 | 路径 | 状态 |
|---|---|---|
| GET | `/cron` | 已完成，兼容 `/api/system/cron` |
| POST | `/api/vault/passphrase` | 未实现，口令模式已排除 |
| POST | `/api/vault/recover` | 未实现 |
| POST | `/api/vault/recovery` | 未实现 |
| POST | `/api/vault/auto-unlock` | 未实现 |
| POST | `/api/vault/destroy` | 未实现 |

`/api/vault/status`、`/init`、`/unlock`、`/lock`、`/backup-exclude`、`/upgrade`、`/downgrade` 在 Workers 版存在，但 `upgrade` 明确返回“暂仅支持便捷模式”。

### 4.7 旧版 API 兼容层

以下接口已实现，默认关闭，需开启 `legacy_api_enable`；v1 MD5 签名还需额外开启 `legacy_api_v1_enable`：

| 方法 | 路径 | 状态 |
|---|---|---|
| POST | `/api/domain` | 已完成，支持关键字、账户、类型、分类、到期状态筛选与排序 |
| POST | `/api/domain/:id` | 已完成，返回域名、厂商配置、线路与最小 TTL；`loginurl=1` 返回不支持 |
| POST | `/api/record/data/:id` | 已完成，支持筛选、排序与线路名称 |
| POST | `/api/record/add/:id` | 已完成 |
| POST | `/api/record/update/:id` | 已完成 |
| POST | `/api/record/delete/:id` | 已完成 |
| POST | `/api/record/status/:id` | 已完成 |
| POST | `/api/record/remark/:id` | 已完成 |
| POST | `/api/record/batch/:id` | 已完成 open/pause/delete/remark；分组暂不支持 |
| POST | `/api/cert/order` | 已完成，仅接受 v2 签名，需登录密码与至少 8 位 PFX 口令 |

`/api/domain/:id` 的 `loginurl=1` 已支持生成 `/quicklogin` 快捷登录 URL；`/quicklogin` 使用域名级 JWT，默认 2 小时有效。

## 5. P0：CDN 控制台缺口

### 5.1 当前 CDN 实现范围

Workers 版 CDN 仅支持：

- `GET /api/cdn/providers`
- CDN 账户基础 CRUD
- 加速域名列表、创建、删除
- 加速域名启用/停用
- 缓存刷新
- 预热提交
- 缓存任务列表
- 预热任务 CRUD、执行、启停
- Mock 账户的模拟站点列表
- 加速域名是否已存在检查
- 站点列表与全局设置（Mock）
- Mock 站点接入、套餐绑定、属性、NS、配置导入导出
- 加速域名详情、源站、缓存、HTTPS、访问控制、区域设置
- CDN 统计基础接口与 Mock 同步

12 种 CDN 厂商已接入真实账户验证、域名同步/接入/删除/启停、源站更新、刷新与预热；腾讯云 EdgeOne、阿里云 ESA 另支持站点同步、创建、删除、暂停、NS、归属验证和套餐列表。

### 5.2 加速域名列表降级

`GET /api/cdn/domains` 的 `can_freecert` 按厂商能力返回，EdgeOne/ESA 与 Mock 已开放；`can_certapply`、`can_certlink` 对 Mock、EdgeOne、ESA、腾讯云 CDN、阿里云 CDN、七牛 CDN 开放。

### 5.3 CDN 站点管理

已完成（Mock）：

- 站点列表 `/api/cdn/zones`
- 站点全局设置 `/api/cdn/zones/setting`
- 套餐实例 `/cdn/accounts/:aid/plan-instances`
- 站点接入检查、创建、校验、暂停、绑定套餐
- 站点 NS、属性、配置导出、配置导入（解析并应用）
- 站点自定义变量
- 站点删除
- 站点计费套餐绑定

已完成（本地持久化）：

- 站点环境、版本历史、版本部署、工作模式

仍未完成：

- 真实 CDN 厂商站点管理

### 5.4 CDN 边缘函数与 KV

已完成（Mock/本地持久化）：

- 边缘函数 CRUD
- 函数运行时
- 函数副本
- 函数绑定
- 函数规则
- KV 命名空间 CRUD
- KV 键列表、读取、写入、删除

仍未完成：真实厂商边缘函数与 KV 下发。

### 5.5 CDN 四层代理、负载均衡、回源组

已完成：

- 阿里云 ESA 回源组：`ListOriginPools` / `CreateOriginPool` / `UpdateOriginPool` / `DeleteOriginPool`
- 阿里云 ESA 负载均衡：`ListLoadBalancers` / `CreateLoadBalancer` / `UpdateLoadBalancer` / `DeleteLoadBalancer`
- 阿里云 ESA 四层代理：`ListTransportLayerApplications` / `CreateTransportLayerApplication` / `UpdateTransportLayerApplication` / `DeleteTransportLayerApplication`
- 四层代理状态、规则（本地持久化）
- 负载均衡健康检查、多路径网关、线路、回源 ACL、密钥、推理服务/域名/令牌/硬件/监控、媒体转码模板、套餐与账单基础接口（本地持久化）

仍未完成：四层代理状态与规则真实下发、其他厂商的负载均衡与回源组。

### 5.6 CDN 安全与规则引擎

已完成：

- 腾讯云 EdgeOne IP 分组：`DescribeSecurityIPGroup` / `CreateSecurityIPGroup` / `ModifySecurityIPGroup` / `DeleteSecurityIPGroup` / `DescribeSecurityIPGroupContent`
- 腾讯云 EdgeOne DDoS、WAF、源站防护：`DescribeDDoSProtection` / `ModifyDDoSProtection`、`DescribeWebSecurityTemplates` / `CreateWebSecurityTemplate` / `ModifyWebSecurityTemplate`、`DescribeOriginACL` / `EnableOriginACL` / `DisableOriginACL` / `ModifyOriginACL`
- 腾讯云 EdgeOne WAF 模板详情、删除与绑定：`DescribeWebSecurityTemplate`、`DeleteWebSecurityTemplate`、`DescribeSecurityTemplateBindings`、`BindSecurityTemplateToEntity`
- 腾讯云 EdgeOne JS 注入防护、客户端证明、API 服务、API 资源：分别使用 `*SecurityJSInjectionRule`、`*SecurityClientAttester`、`*SecurityAPIService`、`*SecurityAPIResource` 系列接口真实 CRUD
- 腾讯云 EdgeOne 内容标识：`DescribeContentIdentifiers` / `CreateContentIdentifier` / `ModifyContentIdentifier` / `DeleteContentIdentifier`
- 阿里云 ESA DDoS、WAF、源站防护：`DescribeHttpDDoSAttackProtection` / `SetHttpDDoSAttackProtection`、`ListWafPhases` / `CreateWafRule`、`GetOriginProtection` / `UpdateOriginProtection`
- 规则设置、规则 CRUD、优先级、规则配置、规则动作与 Schema（本地持久化）

Cloudflare 专用规则引擎继续通过 `/api/cf-rules/*` 实现。腾讯云 EdgeOne 规则引擎已真实接入：`DescribeL7AccRules`、`CreateL7AccRules`、`ModifyL7AccRule`、`DeleteL7AccRules`、`ModifyL7AccRulePriority`、`DescribeRulesSetting`、`DescribeAvailableCustomActionsForRuleEngine`；阿里云 ESA 规则通过 `List${kind}s` / `Create${kind}` / `Update${kind}` / `Delete${kind}` 真实下发，并接入官方生成的规则字段 Schema。

### 5.7 CDN 共享 CNAME、别名域名、错误页

已完成（Mock/本地持久化）：

- 共享 CNAME 列表、创建、修改、绑定、删除
- 别名域名列表、创建、修改、启停、删除
- 自定义错误页 CRUD

### 5.8 CDN 日志、配额、分析、诊断

已完成：

- 实时日志任务 CRUD：腾讯云 EdgeOne `DescribeRealtimeLogDeliveryTasks` / `CreateRealtimeLogDeliveryTask` / `ModifyRealtimeLogDeliveryTask` / `DeleteRealtimeLogDeliveryTask` 真实调用，其余厂商本地持久化
- 离线日志：腾讯云 CDN、阿里云 CDN `DescribeCdnDomainLogs`，华为云 CDN `ShowLogs`，七牛云 CDN Fusion `/v2/tune/log/list`，CDNetworks `/api/report/log/downloadLink`，网宿 CDN 同接口，百度云 `/v2/log/{domain}/log`，金山云 `GetDomainLogs`，白山云 `stat/log/getList`，火山引擎 `DescribeCdnAccessLog`，EdgeOne `DownloadL7Logs` / `DownloadL4Logs` 真实查询，返回日志名称、路径、大小、时间与下载地址
- 阿里云 CDN 内容配额与刷新配额通过 `DescribeCdnUserQuota` 真实查询；ESA 通过 `GetPurgeQuota` 查询刷新配额，`DescribePurgeTasks` / `DescribePreloadTasks` 查询任务；EdgeOne 内容配额通过 `DescribeContentQuota` 查询，预热回源限速通过 `DescribePrefetchOriginLimit` / `ModifyPrefetchOriginLimit` 读写；华为云 CDN 通过 `ShowQuota` 查询刷新、目录与预热配额；金山云通过 `GetRefreshOrPreloadQuota` 查询刷新与预热剩余量；百度云通过 `/v2/cache/quota` 查询刷新与目录剩余量
- 腾讯云 CDN 通过 `DescribePurgeQuota` / `DescribePushQuota` 查询刷新与预热配额；白山云通过 `cache/refreshQuota` / `cache/prefetchQuota` 查询；火山引擎通过 `DescribeContentQuota` 查询；CDNetworks 与网宿通过 `/ccm/purge/quota` / `/ccm/prefetch/quota` 查询
- 腾讯云 EdgeOne 访问 Top、缓存时序、DDoS 事件/Top、L4 时序、IP 归属分别通过 `DescribeTopL7AnalysisData`、`DescribeTimingL7CacheData`、`DescribeDDoSAttackEvent`、`DescribeDDoSAttackTopData`、`DescribeTimingL4Data`、`DescribeIPRegion` 真实查询
- 华为云 CDN Top URL 通过 `ShowTopUrl` 查询，支持流量与请求数指标；百度云通过 `/v2/stat/query` 的 `top_urls` 指标、CDNetworks 通过 `/api/report/url/top`、金山云通过 `GetTopUrlData` 查询 Top URL 流量与请求数
- 预热源站限额：EdgeOne 真实读写，其余本地空数据；其他厂商的分析与诊断保持空占位

### 5.9 CDN 统计

基础接口已完成：

- `GET /api/cdn/statistics/overview`
- `GET /api/cdn/statistics/detail`
- `GET /api/cdn/statistics`

腾讯云 CDN 已接入真实指标：按域名与区域调用 `DescribeCdnData` / `DescribeOriginData`，支持流量、带宽、回源、请求、缓存命中率与状态码，并提供域名 Top 明细。腾讯云 EdgeOne 通过 `DescribeTimingL7AnalysisData` / `DescribeTimingL7CacheData` / `DescribeTimingL7OriginPullData` / `DescribeTopL7AnalysisData` 接入访问、缓存、回源、状态码、性能与 Top 维度。阿里云 CDN 通过 `DescribeDomainUsageData` 等接入流量、带宽、请求、命中率、状态码与 Top URL/Referer。阿里云 ESA 通过 `DescribeSiteTimeSeriesData` 接入 Traffic / Requests / RequestTraffic / PageView。华为云 CDN 通过 `ShowDomainStats` 接入流量、带宽、回源、请求、命中率与状态码，并支持按域名合并。七牛云 CDN 通过 Fusion `/v2/tune/flux` 与 `/v2/tune/bandwidth` 接入流量与带宽。百度云 CDN 通过 `/v2/stat/query` 接入流量、带宽、回源流量/带宽、请求数、字节/请求命中率与边缘/回源状态码。火山引擎 CDN 通过 `DescribeCdnData` / `DescribeCdnOriginData` 接入边缘与回源流量、带宽、请求、命中率、命中流量和状态码。金山云 CDN 通过 `GetFlowData` / `GetBandwidthData` / `GetPvData` / `GetHitRateDetailedData` 接入流量、带宽、请求与流量/请求命中率。CDNetworks 与网宿 CDN 通过 `/api/report/traffic-request`、`/api/report/traffic-request/origin`、`/api/report/request/hit-ratio/total` 接入边缘/回源流量、带宽、请求与请求命中率。白山云 CDN 通过 `stat/bandwidth`、`stat/request`、`stat/httpcode`、`stat/originBandwidth/eachDomain`、`stat/originRequest/eachDomain` 接入流量、带宽、请求、边缘状态码与回源流量/带宽/请求。

### 5.10 CDN 证书与线路切换

已完成：

- 腾讯云 EdgeOne、阿里云 ESA 平台免费证书真实申请
- 腾讯云 EdgeOne 证书订单真实上传腾讯云 SSL 并绑定站点
- 阿里云 ESA 证书订单真实上传站点证书
- 腾讯云 CDN 证书订单真实上传腾讯云 SSL 并绑定 CDN 域名
- 阿里云 CDN 证书订单真实上传并绑定 CDN 域名
- 七牛 CDN 证书订单真实上传 `sslcert` 并绑定域名
- 华为云 CDN 通过域名配置接口直传证书与私钥；百度云 CDN 通过 `/v2/domain/{domain}/certificates` 上传；火山引擎通过 `ImportCertificate` + `BatchDeployCert` 上传并绑定
- EdgeOne/ESA/腾讯云 CDN/七牛 CDN/华为云 CDN/百度云 CDN/火山引擎 CDN/CDNetworks/金山云 CDN/白山云 CDN/网宿 CDN 证书状态读取云端证书信息
- 免费证书与自定义证书批量接口按厂商能力放行
- Mock 免费证书申请与检查
- Mock 自定义证书上传与检查
- Mock 证书候选查询
- Mock 证书联动申请、日志、重试
- 证书模式切换
- 加速域名线路切换（12 种厂商真实接入并同步 DNS CNAME）

仍未完成：白山云 Top URL 与实时日志、七牛云独立配额接口，以及各厂商未公开的站点管理与套餐计费能力。

## 6. P2：DNS 厂商适配缺口

DNS 账户接口已经实现，当前 `providers` 包含：

- `cloudflare`
- `aliyun`
- `dnspod`
- `aliyunesa`
- `tencenteo`
- `dynv6`
- `powerdns`
- `namesilo`
- `technitium`
- `dnsla`
- `spaceship`
- `dnsmgr`
- `goedge`
- `mock`

后端支持的 22 种 DNS 厂商已全部实现。

受影响的 DNS 能力：

- 多厂商账户接入
- 厂商特有线路
- 阿里云解析权重
- DNSPod 域名别名
- 各厂商记录类型差异
- 各厂商域名拉取与记录同步
- 各厂商批量操作
- DNSPod 解析记录分组已接入 `DescribeRecordGroupList` / `ModifyRecordToGroup`

其中：

- `GET/POST /api/domains/:id/weight` 已完成（阿里云）。
- `GET/POST/PUT/DELETE /api/domains/:id/aliases` 已完成（DNSPod）。
- `POST /api/domains/:id/records/check` 已完成，所有厂商共用。
- `GET /api/domains/:id/quickinfo` 已完成。

后端 22 种 DNS 厂商已全部完成账户验证、域名拉取、记录 CRUD/状态/备注/线路；阿里云权重解析与 DNSPod 域名别名也已接入。

## 7. P2：CDN 厂商适配缺口

后端支持 12 种真实 CDN 厂商，已全部实现核心能力：

- 腾讯云 CDN
- 阿里云 CDN
- 火山引擎 CDN
- 华为云 CDN
- 百度云 CDN
- 七牛云 CDN
- 白山云 CDN
- CDNetworks
- 金山云 CDN
- 网宿 CDN
- 腾讯云 EdgeOne
- 阿里云 ESA

全部厂商已接入账户验证、域名同步、域名接入/删除/启停、源站更新、刷新、预热。EdgeOne、ESA 额外支持站点同步/创建/删除/暂停、NS 查询、归属验证、套餐列表。CDNetworks 与网宿官方接口不支持域名列表同步，需通过接入或刷新回填。

已接入的高级能力：12 种厂商实时统计，官方提供接口的厂商离线日志、配额、Top URL 与证书直传。尚未接入：白山云 Top URL/实时日志、七牛云独立配额、各厂商套餐计费。

已实现厂商尚未接入的高级能力：白山云 Top URL/实时日志、七牛云独立配额、站点管理与套餐计费。

## 8. 证书与部署缺口

### 8.1 云证书厂商

Workers 支持：

- Let's Encrypt
- ZeroSSL
- Google
- LiteSSL
- Custom ACME
- 腾讯云 SSL
- 阿里云 CAS
- UCloud 证书
- Mock

腾讯云、阿里云、UCloud 已完成账户验证、申请、DNS 验证记录自动写入、状态轮询、证书下载（含 ZIP 解包）与吊销状态更新。真实凭证回归仍需在对应云账号下执行。

### 8.2 证书订单

`POST /api/cert/orders/batch/process` 已实现，单次最多处理 10 个订单，并返回逐单结果。其余证书订单接口已实现，包括创建、修改、删除、签发、重置、吊销、自动续签、详情、日志。

### 8.3 证书部署任务

已完成，共 10 个接口：

| 方法 | 路径 | 状态 |
|---|---|---|
| GET | `/api/deploy/providers` | 已完成，返回 51 种厂商元数据与实现标记 |
| GET | `/api/deploy/tasks` | 已完成，支持状态、证书订单筛选与统计 |
| POST | `/api/deploy/tasks` | 已完成 |
| PUT | `/api/deploy/tasks/:id` | 已完成，掩码字段保留原值 |
| DELETE | `/api/deploy/tasks/:id` | 已完成 |
| POST | `/api/deploy/tasks/:id/process` | 已完成 |
| POST | `/api/deploy/tasks/batch/process` | 已完成，同步执行并写入 `async_job` |
| GET | `/api/deploy/tasks/:id/logs` | 已完成，读取 `cert_deploy_log` |
| POST | `/api/deploy/tasks/:id/reset` | 已完成 |
| POST | `/api/deploy/tasks/:id/setactive` | 已完成 |

部署账户通过 `cert_account.deploy = 1` 区分，支持创建、验证、编辑、删除；`/api/cert/accounts?deploy=1` 返回部署账户列表。部署任务引用部署账户与已签发证书订单，执行前校验订单状态、私钥可解密、目标地址不指向链路本地/云元数据地址。

已移植 48 个适配器，占服务器版 51 个厂商的 48 个。未移植：`fnos`、`ssh`、`local`。这些适配器依赖 Workers 不提供的 SSH 或本地文件系统能力。Kubernetes 仅支持 Bearer Token 与公网 CA。

## 9. 已实现但降级或占位的功能

| 功能 | 当前行为 |
|---|---|
| DNS 厂商 | 已实现后端全部 22 种厂商与 Mock |
| CDN 厂商 | 已实现全部 12 种厂商核心能力 |
| CDN 站点查询 | Mock 账户返回本地站点；EdgeOne、ESA 真实同步 |
| CDN 真实账户验证 | 全部 12 种厂商已接入 |
| CDN 真实域名接入 | 全部 12 种厂商已接入 |
| CDN 域名证书能力字段 | 已按厂商能力动态返回 |
| CDN 刷新与预热 | 全部 12 种厂商真实下发；未匹配账户的 URL 记录 Mock 任务 |
| CDN 统计缓存刷新 | 只写设置时间戳 |
| 证书厂商 | ACME 系列、腾讯云 SSL、阿里云 CAS、UCloud 已接入 |
| 证书部署账户 | 已支持 `deploy = 1` 部署账户 |
| 证书部署适配器 | 已移植 48/51，剩余 3 个见 §8.3 |
| Kubernetes 部署 | 支持 Bearer Token 与公网 CA；客户端证书、自定义 CA、关闭证书校验不支持 |
| 保险库 | 仅便捷模式，口令模式升级返回不支持 |
| 邮件 | 支持 SMTP 直连、SendCloud 与阿里云邮件推送 |
| FTP 部署 | 支持 FTPS；明文 FTP 需配置 `ALLOW_INSECURE_DEPLOY=1`，不支持关闭 FTPS 证书校验 |
| QQ 机器人 | 回调验签、绑定、通知发送与连通测试已接入；需在 QQ 开放平台配置回调地址 |
| 出站代理 | `proxytest` 返回不支持 |
| 安装状态 | 固定返回已安装 |
| 远端备份 | 已支持列表、删除与拉回本地 |
| 用户语言 | 已写回用户 |
| API Key 旧密钥 | 已支持删除 |
| 审计日志 | 已支持查询、统计与导出 |

## 10. 已明确排除的模块

以下模块已在此前范围中排除，本报告仍列出，便于后续决策。证书部署模块已完成主体移植，剩余 3 个运行时受限适配器见 §8.3。

| 模块 | 缺失内容 |
|---|---|
| 安装器 | `setup/check`、`install`、`skip`、`import` |
| 保险库口令模式 | `vault/passphrase`、`recover`、`recovery`、`auto-unlock`、`destroy` |
| 出站代理 | 自定义 HTTP/SOCKS 代理 |
| SQLite/子进程 | Workers 运行时限制，使用 D1 与平台能力替代 |

## 11. 受影响的前端页面

| 路由 | 页面 | 现状 |
|---|---|---|
| `/domains/:id/records` | 解析记录 | 列表与冲突检查可用 |
| `/statistics` | CDN 统计 | EdgeOne、腾讯云 CDN、阿里云 CDN、ESA 实时数据可用 |
| `/cdn-zones` | CDN 站点 | EdgeOne/ESA 真实列表与创建；其他厂商本地持久化 |
| `/cdn-zones/:aid/:zoneId` | CDN 站点设置 | EdgeOne/ESA 真实站点、属性、版本与高级资源；其他厂商本地持久化 |
| `/cdn-accounts/:aid/esa-api` | ESA API | 可用（真实 ESA OpenAPI） |
| `/cdn-accounts/:aid/esa-console` | ESA 控制台 | 可用（真实 ESA OpenAPI） |
| `/cdn-domains` | 加速域名 | 12 种厂商真实同步/接入/删除/启停/回源/刷新/预热；EdgeOne/ESA 证书真实部署；线路切换真实接入并同步 DNS；其余证书联动仍为 Mock |
| `/cdn-domains/:id/setting` | 加速域名设置 | 详情、回源、HTTPS、缓存、访问控制均可用；访问控制对 12 种厂商真实下发 |
| `/deploy-accounts` | 部署账户 | 可用，支持部署账户 CRUD 与验证 |
| `/deploy-tasks` | 部署任务 | 可用，支持任务 CRUD、执行、批量执行、日志、重置与启停 |
| `/settings` | 系统设置 | QQ 机器人回调地址、绑定状态与测试消息可用 |
| `/about` | 关于 | 信息与更新检查可用 |
| `/preferences` | 偏好设置 | 语言同步、旧密钥删除可用 |
| `/domains/:id/weight` | 解析权重 | 阿里云适配已接入 |
| `/domains/:id/alias` | 域名别名 | DNSPod 适配已接入 |

## 11.1 CDN 能力矩阵

标记含义：**真实**表示调用厂商 API 并回写结果；**本地**表示 D1 持久化并在前端可用；**限制**表示厂商未开放接口或 Workers 运行时无法提供。

| 能力 | EdgeOne | 阿里云 ESA | 其他 CDN 厂商 |
|---|---|---|---|
| 账户验证、域名接入、启停、删除 | 真实 | 真实 | 真实（12 家） |
| 刷新、预热、任务重试 | 真实 | 真实 | 真实（12 家） |
| 实时统计、流量/带宽/回源/命中率 | 真实 | 真实 | 真实（12 家） |
| 离线日志下载 | 真实 | 限制（官方未开放） | 真实（多数厂商；白山限制） |
| 实时日志任务 | 真实 | 真实 | 本地 |
| 免费证书签发与部署 | 真实 | 真实 | 本地（自定义证书部分厂商真实） |
| 站点列表、创建、属性、暂停、删除 | 真实 | 真实 | 本地 |
| 站点配置导入导出、版本、工作模式、自定义变量 | 真实 | 本地 | 本地 |
| 边缘函数、运行时、副本、绑定、函数规则 | 真实 | 限制（未开放函数接口） | 本地 |
| EdgeKV 命名空间与键读写 | 真实 | 限制（未开放 KV 接口） | 本地 |
| 规则引擎与规则配置 | 真实 | 真实 | 本地 |
| IP 组、WAF、JS 注入、客户端认证、API 安全 | 真实 | 真实（安全配置） | 本地 |
| 共享 CNAME、别名域名、自定义错误页 | 真实 | 本地 | 本地 |
| 源站组、负载均衡、健康检查 | 真实 | 真实 | 本地 |
| 四层代理、规则、状态 | 真实 | 真实（规则/状态受官方限制） | 本地 |
| 多通道网关、推理服务、即时转码、账单套餐 | 真实 | 本地 | 本地 |
| 开发模式、缓存标签、缓存屏蔽、分层缓存、上传/刷新 | 本地 | 真实 | 本地 |
| 配额查询 | 限制（未开放） | 真实 | 多数真实（七牛限制） |
| Top URL、时序、DDoS、IP 归属 | 真实 | 真实 | 部分真实（白山/七牛限制） |
| 证书部署到 CDN | 真实 | 真实 | 真实（多数厂商）；其余本地 |

前端回归覆盖账户配置错误提示、解析记录只读/可写、CDN 站点、统计、证书 CNAME、CDN 高级资源和部署任务，由 `workers/scripts/contract-check.mjs` 纳入 `npm run check`。

## 11.2 调用一致性审计（2026-11-24）

对照 `backend/src/routes`、`backend/src/lib` 与 `workers/src`，按“路由/方法、请求字段、响应字段、权限、状态流转、厂商 API 动作与参数”逐项比对。已修复的高风险差异：

- 权限与账号：`PUT /api/users/:id` 恢复 API Key 会话禁止改用户；管理员列表按 `shared + 自己私有` 过滤；cf-rules 域名/账户列表按账户可见性过滤；注册码接口禁止 API Key 会话。
- 证书：订单编辑恢复重置状态/绑定域名/导入证书分支；删除订单前检查部署任务引用；批量处理上限 100；查看私钥始终校验登录密码，解密失败返回错误；证书账户按解密后配置判重。
- 域名：接入域名恢复管理员免云端校验、权限清理、客户端 `thirdid` 兜底；删除/批量删除恢复私有归属校验、证书订单引用检查、多表级联清理；批量提醒限制 500。
- DNS：Cloudflare 记录恢复 CAA/SRV/URI 的 `data` 映射与暂停/恢复；Aliyun 恢复 `SearchMode`、`Priority`、MX 读取与更新时间格式；DNSPod 恢复按状态选择 `DescribeRecordFilterList`；GoEdge 筛选分页；Spaceship 子域名全量扫描；Technitium CAA/备注；PowerDNS 备注；JDCloud 转发类型；AWS TTL；Cloudflare 最小 TTL。
- CDN：EdgeOne 实时日志恢复 `ZoneId` 与正确响应键、站点识别状态、分析 `Interval`、加速域名协议端口、按域名补站点；ESA 站点暂停状态与通用动作 HTTP 方法；Aliyun CDN 域名详情/回源/HTTPS 映射；Huawei 配置深合并；Volcengine/Qiniu/Kingsoft 任务 ID；访问控制枚举恢复 `whitelist/blacklist`；创建域名契约与 CNAME 失败处理对齐。
- 统计：Tencent CDN `Interval` 恢复 `hour/day`；统计时间轴与 EdgeOne/腾讯 CDN 请求时间统一按 Asia/Shanghai（+08:00）生成。
- 部署/备份：部署成功后合并 `info.config` 回任务配置；恢复接口 merge 模式同样要求 `RESTORE`；备份目标类型只允许 `webdav/s3`；部署目标增加本机/内网/元数据地址拦截。
- 认证：TOTP 发行者与提示文案对齐，TOTP 登录增加每账号频率限制；API Key 作用域恢复白名单校验，空作用域不再退化为 `*`。

仍保留的已知差异（运行时或厂商限制）：

- 安装器、保险库口令模式、出站代理、SSH/FTP/local/fnos 部署适配器。
- DNS 线路表：Huawei 全量线路、DNSPod 线路分类、DNSLA 线路、dnsmgr 远端线路仍使用静态/简化表；Aliyun 与 GoEdge 已改为动态查询。
- 域名列表：普通用户子域名授权的记录数仍用域名级计数，`domain_alias` 搜索与 `_key` 别名匹配未完全移植。
- EdgeOne 统计筛选条件（状态码/国家/Referer 等）尚未下发到厂商查询。
- Workers 无系统 DNS 解析能力，部署目标安全校验只拦截字面量内网地址，未做服务端 DNS pinning。
- 业务错误 HTTP 状态码仍保留 Workers 的 4xx 语义，服务器版多数为 HTTP 200 + `code=-1`；前端统一按 `code` 处理。
- 证书订单真实 ACME/云签发由每分钟 Cron 处理待申请订单，服务器版在创建后立即后台触发。

## 12. 建议执行顺序

### 第一阶段：低成本补齐（已完成）

1. `POST /api/domains/:id/records/check`（已完成）
2. `GET /api/about`、`POST /api/about/check-update`（已完成）
3. `POST /api/auth/lang`（已完成）
4. `DELETE /api/api-keys/legacy`（已完成）
5. `PATCH /api/api-keys/:id`（已完成）
6. `GET /api/audit/logs/export`（已完成）

这些接口已修复现有页面和按钮。额外完成 `/api/ready`、`/api/metrics`、`/api/expire/scan`、远端备份删除/拉回、`/cron` 与 `/api/logs`。

### 第二阶段：CDN 基础控制台（已完成，Mock）

1. CDN 统计 overview/detail（基础完成）
2. CDN 站点列表与全局设置（Mock 完成）
3. 套餐实例与站点接入（Mock 完成）
4. 加速域名详情、回源、缓存、HTTPS、访问控制（完成，真实厂商云端下发）
5. 线路切换（已完成，12 种厂商真实接入）
6. 免费证书（EdgeOne/ESA 真实）、自定义证书与证书联动（Mock）

### 第三阶段：CDN 高级控制台（已完成；EdgeOne 真实，其余本地标识）

1. 边缘函数与 KV
2. 四层代理、负载均衡、回源组
3. 安全规则与 WAF
4. 共享 CNAME、别名域名、错误页
5. 日志、配额、分析、诊断
6. 计费、套餐、推理服务、媒体转码

### 第四阶段：厂商适配

1. DNS 厂商已全部补齐（22 种，含华为云、腾讯云 EdgeOne、阿里云 ESA、AWS Route 53）
2. 全部 12 种 CDN 厂商核心能力已完成
3. 云证书厂商腾讯云、阿里云、UCloud 已完成
4. 每个厂商独立验证账户、域名、记录、证书、刷新、预热、统计

### 第五阶段：证书部署（已完成主体）

1. 部署账户、任务 CRUD、单任务/批量执行、日志、重置、启停（已完成，10 个接口）
2. 48 个部署适配器（已完成，见 §8.3）
3. 定时调度到期部署任务（已完成）
4. 剩余 3 个适配器：SSH、本地文件系统与 fnos 受运行时限制

### 第六阶段：消息渠道补全（已完成）

1. QQ 机器人回调验签与绑定（已完成）
2. QQ 机器人通知发送与连通测试（已完成）

## 附录 A：CDN 未实现路由

`backend/src/routes/cdn.ts` 共 222 个路由。以下清单为初始缺口记录，当前大部分已以 Mock/本地持久化方式实现，可用于逐项对照真实厂商适配进度。

```text
GET /api/cdn/zones
GET /api/cdn/zones/setting
POST /api/cdn/zones/setting
GET /api/cdn/accounts/:aid/sites
GET /api/cdn/accounts/:aid/plan-instances
POST /api/cdn/accounts/:aid/sites/check
POST /api/cdn/accounts/:aid/sites
POST /api/cdn/accounts/:aid/sites/verify
POST /api/cdn/accounts/:aid/sites/pause
POST /api/cdn/accounts/:aid/sites/bind-plan
GET /api/cdn/accounts/:aid/sites/:zoneId/ns
GET /api/cdn/accounts/:aid/sites/:zoneId/properties
PUT /api/cdn/accounts/:aid/sites/:zoneId
GET /api/cdn/accounts/:aid/sites/:zoneId/config/export
POST /api/cdn/accounts/:aid/sites/:zoneId/config/import
GET /api/cdn/accounts/:aid/sites/:zoneId/config/import/:taskId
GET /api/cdn/accounts/:aid/sites/:zoneId/custom-variables
POST /api/cdn/accounts/:aid/sites/:zoneId/custom-variables
GET /api/cdn/accounts/:aid/functions
POST /api/cdn/accounts/:aid/functions
PUT /api/cdn/accounts/:aid/functions/:functionId
DELETE /api/cdn/accounts/:aid/functions/:functionId
GET /api/cdn/accounts/:aid/functions/:functionId/runtime
POST /api/cdn/accounts/:aid/functions/:functionId/runtime
GET /api/cdn/accounts/:aid/functions/:functionId/replicas
POST /api/cdn/accounts/:aid/functions/:functionId/replicas
PUT /api/cdn/accounts/:aid/functions/:functionId/replicas/:replicaName
DELETE /api/cdn/accounts/:aid/functions/:functionId/replicas
GET /api/cdn/accounts/:aid/functions/:functionId/bindings
POST /api/cdn/accounts/:aid/functions/:functionId/bindings
GET /api/cdn/accounts/:aid/function-rules
POST /api/cdn/accounts/:aid/function-rules
PUT /api/cdn/accounts/:aid/function-rules/:ruleId
DELETE /api/cdn/accounts/:aid/function-rules
GET /api/cdn/accounts/:aid/kv/namespaces
POST /api/cdn/accounts/:aid/kv/namespaces
PUT /api/cdn/accounts/:aid/kv/namespaces/:namespace
DELETE /api/cdn/accounts/:aid/kv/namespaces/:namespace
GET /api/cdn/accounts/:aid/kv/namespaces/:namespace/keys
POST /api/cdn/accounts/:aid/kv/namespaces/:namespace/get
POST /api/cdn/accounts/:aid/kv/namespaces/:namespace/put
POST /api/cdn/accounts/:aid/kv/namespaces/:namespace/delete
GET /api/cdn/accounts/:aid/sites/:zoneId/environments
GET /api/cdn/accounts/:aid/sites/:zoneId/versions
POST /api/cdn/accounts/:aid/sites/:zoneId/versions
GET /api/cdn/accounts/:aid/sites/:zoneId/versions/history
POST /api/cdn/accounts/:aid/sites/:zoneId/versions/deploy
GET /api/cdn/accounts/:aid/sites/:zoneId/versions/:versionId
POST /api/cdn/accounts/:aid/sites/:zoneId/work-mode
GET /api/cdn/accounts/:aid/multipath/regions
GET /api/cdn/accounts/:aid/multipath/gateways
POST /api/cdn/accounts/:aid/multipath/gateways
GET /api/cdn/accounts/:aid/multipath/gateways/:gatewayId
PUT /api/cdn/accounts/:aid/multipath/gateways/:gatewayId
DELETE /api/cdn/accounts/:aid/multipath/gateways/:gatewayId
POST /api/cdn/accounts/:aid/multipath/gateways/:gatewayId/status
POST /api/cdn/accounts/:aid/multipath/gateways/:gatewayId/lines
GET /api/cdn/accounts/:aid/multipath/gateways/:gatewayId/lines/:lineId
PUT /api/cdn/accounts/:aid/multipath/gateways/:gatewayId/lines/:lineId
DELETE /api/cdn/accounts/:aid/multipath/gateways/:gatewayId/lines/:lineId
GET /api/cdn/accounts/:aid/multipath/gateways/:gatewayId/origin-acl
POST /api/cdn/accounts/:aid/multipath/gateways/:gatewayId/origin-acl/confirm
GET /api/cdn/accounts/:aid/multipath/secret-key
POST /api/cdn/accounts/:aid/multipath/secret-key
PUT /api/cdn/accounts/:aid/multipath/secret-key
POST /api/cdn/accounts/:aid/multipath/secret-key/refresh
GET /api/cdn/accounts/:aid/inference/services
POST /api/cdn/accounts/:aid/inference/services
PUT /api/cdn/accounts/:aid/inference/services/:serviceId
POST /api/cdn/accounts/:aid/inference/services/:serviceId/operate
GET /api/cdn/accounts/:aid/inference/services/:serviceId/records
GET /api/cdn/accounts/:aid/inference/services/:serviceId/records/:recordId/logs
POST /api/cdn/accounts/:aid/inference/monitor
GET /api/cdn/accounts/:aid/inference/tokens
POST /api/cdn/accounts/:aid/inference/tokens
DELETE /api/cdn/accounts/:aid/inference/tokens/:tokenId
GET /api/cdn/accounts/:aid/inference/domains
POST /api/cdn/accounts/:aid/inference/domains
POST /api/cdn/accounts/:aid/inference/domains/operate
GET /api/cdn/accounts/:aid/inference/hardware
GET /api/cdn/accounts/:aid/media/transcode-templates
POST /api/cdn/accounts/:aid/media/transcode-templates
DELETE /api/cdn/accounts/:aid/media/transcode-templates
POST /api/cdn/accounts/:aid/billing/data
GET /api/cdn/accounts/:aid/billing/available-plans
POST /api/cdn/accounts/:aid/billing/plans
PUT /api/cdn/accounts/:aid/billing/plans/:planId
POST /api/cdn/accounts/:aid/billing/plans/:planId/renew
POST /api/cdn/accounts/:aid/billing/plans/:planId/upgrade
DELETE /api/cdn/accounts/:aid/billing/plans/:planId
POST /api/cdn/accounts/:aid/billing/plans/:planId/quota
POST /api/cdn/accounts/:aid/sites/:zoneId/billing/plan
DELETE /api/cdn/accounts/:aid/sites/:zoneId
GET /api/cdn/accounts/:aid/shared-cnames
POST /api/cdn/accounts/:aid/shared-cnames
PUT /api/cdn/accounts/:aid/shared-cnames/:sharedCname
POST /api/cdn/accounts/:aid/shared-cnames/bind
DELETE /api/cdn/accounts/:aid/shared-cnames/:sharedCname
GET /api/cdn/accounts/:aid/alias-domains
POST /api/cdn/accounts/:aid/alias-domains
PUT /api/cdn/accounts/:aid/alias-domains/:aliasName
POST /api/cdn/accounts/:aid/alias-domains/:aliasName/status
DELETE /api/cdn/accounts/:aid/alias-domains/:aliasName
GET /api/cdn/accounts/:aid/error-pages
POST /api/cdn/accounts/:aid/error-pages
PUT /api/cdn/accounts/:aid/error-pages/:pageId
DELETE /api/cdn/accounts/:aid/error-pages/:pageId
GET /api/cdn/accounts/:aid/origin-groups
POST /api/cdn/accounts/:aid/origin-groups
PUT /api/cdn/accounts/:aid/origin-groups/:groupId
DELETE /api/cdn/accounts/:aid/origin-groups/:groupId
GET /api/cdn/accounts/:aid/load-balancers
POST /api/cdn/accounts/:aid/load-balancers
PUT /api/cdn/accounts/:aid/load-balancers/:instanceId
DELETE /api/cdn/accounts/:aid/load-balancers/:instanceId
GET /api/cdn/accounts/:aid/load-balancers/:instanceId/health
GET /api/cdn/accounts/:aid/rules/setting
GET /api/cdn/accounts/:aid/rules
POST /api/cdn/accounts/:aid/rules
PUT /api/cdn/accounts/:aid/rules/:ruleId
DELETE /api/cdn/accounts/:aid/rules
POST /api/cdn/accounts/:aid/rules/priority
GET /api/cdn/accounts/:aid/rule-configs
POST /api/cdn/accounts/:aid/rule-configs
DELETE /api/cdn/accounts/:aid/rule-configs/:configId
GET /api/cdn/accounts/:aid/rule-actions
GET /api/cdn/accounts/:aid/rule-schema
GET /api/cdn/accounts/:aid/esa/catalog
POST /api/cdn/accounts/:aid/esa/actions
GET /api/cdn/accounts/:aid/security/ip-groups
POST /api/cdn/accounts/:aid/security/ip-groups
PUT /api/cdn/accounts/:aid/security/ip-groups/:groupId
DELETE /api/cdn/accounts/:aid/security/ip-groups/:groupId
GET /api/cdn/accounts/:aid/security/ip-groups/:groupId/content
GET /api/cdn/accounts/:aid/security/origin-protection/families
POST /api/cdn/accounts/:aid/security/origin-protection/confirm
GET /api/cdn/accounts/:aid/security/templates/:templateId
DELETE /api/cdn/accounts/:aid/security/templates/:templateId
GET /api/cdn/accounts/:aid/security/template-bindings
POST /api/cdn/accounts/:aid/security/template-bind
GET /api/cdn/accounts/:aid/security/js-injection
POST /api/cdn/accounts/:aid/security/js-injection
PUT /api/cdn/accounts/:aid/security/js-injection/:ruleId
DELETE /api/cdn/accounts/:aid/security/js-injection/:ruleId
GET /api/cdn/accounts/:aid/security/client-attesters
POST /api/cdn/accounts/:aid/security/client-attesters
PUT /api/cdn/accounts/:aid/security/client-attesters/:id
DELETE /api/cdn/accounts/:aid/security/client-attesters/:id
GET /api/cdn/accounts/:aid/security/api-services
POST /api/cdn/accounts/:aid/security/api-services
PUT /api/cdn/accounts/:aid/security/api-services/:id
DELETE /api/cdn/accounts/:aid/security/api-services/:id
GET /api/cdn/accounts/:aid/security/api-resources
POST /api/cdn/accounts/:aid/security/api-resources
PUT /api/cdn/accounts/:aid/security/api-resources/:id
DELETE /api/cdn/accounts/:aid/security/api-resources/:id
GET /api/cdn/accounts/:aid/content-identifiers
POST /api/cdn/accounts/:aid/content-identifiers
PUT /api/cdn/accounts/:aid/content-identifiers/:contentId
DELETE /api/cdn/accounts/:aid/content-identifiers/:contentId
GET /api/cdn/accounts/:aid/l4-proxies
POST /api/cdn/accounts/:aid/l4-proxies
PUT /api/cdn/accounts/:aid/l4-proxies/:proxyId
POST /api/cdn/accounts/:aid/l4-proxies/:proxyId/status
DELETE /api/cdn/accounts/:aid/l4-proxies/:proxyId
GET /api/cdn/accounts/:aid/l4-proxies/:proxyId/rules
POST /api/cdn/accounts/:aid/l4-proxies/:proxyId/rules
PUT /api/cdn/accounts/:aid/l4-proxies/:proxyId/rules
POST /api/cdn/accounts/:aid/l4-proxies/:proxyId/rules/status
DELETE /api/cdn/accounts/:aid/l4-proxies/:proxyId/rules
GET /api/cdn/accounts/:aid/tasks/purge
GET /api/cdn/accounts/:aid/tasks/prefetch
GET /api/cdn/accounts/:aid/logs/realtime
POST /api/cdn/accounts/:aid/logs/realtime
PUT /api/cdn/accounts/:aid/logs/realtime/:taskId
DELETE /api/cdn/accounts/:aid/logs/realtime/:taskId
GET /api/cdn/accounts/:aid/logs/offline/l7
GET /api/cdn/accounts/:aid/logs/offline/l4
GET /api/cdn/accounts/:aid/quota/content
GET /api/cdn/accounts/:aid/quota/purge
GET /api/cdn/accounts/:aid/cache/prefetch-origin-limit
POST /api/cdn/accounts/:aid/cache/prefetch-origin-limit
GET /api/cdn/accounts/:aid/analysis/top
GET /api/cdn/accounts/:aid/analysis/timing-cache
GET /api/cdn/accounts/:aid/analysis/ddos/events
GET /api/cdn/accounts/:aid/analysis/ddos/top
GET /api/cdn/accounts/:aid/analysis/l4-timing
GET /api/cdn/accounts/:aid/diagnostics/ip-region
GET /api/cdn/domains/:id/switch/sites
GET /api/cdn/domains/:id/switch/check
POST /api/cdn/domains/:id/switch
GET /api/cdn/domains/:id
POST /api/cdn/domains/:id/origin
POST /api/cdn/domains/:id/cache
POST /api/cdn/domains/:id/https
POST /api/cdn/domains/freecert
POST /api/cdn/domains/freecert/check
POST /api/cdn/domains/cert
POST /api/cdn/domains/cert/check
GET /api/cdn/cert/candidates
POST /api/cdn/domains/:id/certlink
POST /api/cdn/domains/:id/cert_mode
GET /api/cdn/domains/:id/cert_status
GET /api/cdn/domains/:id/certlink/log
POST /api/cdn/domains/:id/certlink/run
POST /api/cdn/sync
POST /api/cdn/domains/:id/zone_setting
GET /api/cdn/statistics/overview
GET /api/cdn/statistics/detail
GET /api/cdn/statistics
GET /api/cdn/cache-tasks/:id
POST /api/cdn/cache-tasks/:id/retry
GET /api/cdn/domains/:id/access
POST /api/cdn/domains/:id/access
```

## 附录 B：其他未实现路由

说明：以下为初始缺口快照。事件、任务、通知日志、关于页、语言同步、API Key、审计导出、运维探针、远端备份、到期扫描、Cron、证书批量处理与证书部署接口（含 10 个 `/api/deploy/*`）已完成，保留清单用于对照安装器、保险库口令模式与旧版兼容层等未实现/已排除项。

```text
GET /api/about
POST /api/about/check-update
POST /api/auth/lang
POST /api/auth/logout-all
GET /quicklogin
PATCH /api/api-keys/:id
DELETE /api/api-keys/legacy
GET /api/audit/logs/export
GET /api/events/subscriptions
POST /api/events/subscriptions
PUT /api/events/subscriptions/:id
DELETE /api/events/subscriptions/:id
POST /api/events/subscriptions/:id/test
GET /api/events/deliveries
GET /api/ready
GET /api/metrics
GET /api/notifications/logs
GET /api/jobs
GET /api/jobs/:id
GET /api/logs
DELETE /api/backup/remote/:destId
POST /api/backup/remote/:destId/pull
POST /api/expire/scan
POST /api/setup/check
POST /api/setup/install
POST /api/setup/skip
POST /api/setup/import
GET /cron
POST /api/vault/passphrase
POST /api/vault/recover
POST /api/vault/recovery
POST /api/vault/auto-unlock
POST /api/vault/destroy
POST /api/qqbot/webhook
POST /api/domains/:id/records/check
GET /api/domains/:id/quickinfo
GET /api/domains/:id/aliases
POST /api/domains/:id/aliases
PUT /api/domains/:id/aliases/:aliasId
DELETE /api/domains/:id/aliases/:aliasId
GET /api/domains/:id/weight
POST /api/domains/:id/weight
POST /api/domain
POST /api/domain/:id
POST /api/record/data/:id
POST /api/record/add/:id
POST /api/record/update/:id
POST /api/record/delete/:id
POST /api/record/status/:id
POST /api/record/remark/:id
POST /api/record/batch/:id
POST /api/cert/order
```

## 附录 C：厂商适配清单

### DNS

已实现：

- Cloudflare
- 阿里云 DNS
- 腾讯云 DNSPod
- 阿里云 ESA
- 腾讯云 EdgeOne
- dynv6
- PowerDNS
- NameSilo
- Technitium
- DNSLA
- Spaceship
- dnsmgr
- GoEdge
- 华为云
- 百度云
- 火山引擎
- 京东云
- 西部数码
- 青云
- 宝塔
- Hurricane Electric
- AWS Route 53
- Mock

未实现：无

### CDN

已实现：

- 腾讯云 CDN（核心能力）
- 阿里云 CDN（核心能力）
- 火山引擎 CDN（核心能力）
- 华为云 CDN（核心能力）
- 百度云 CDN（核心能力）
- 七牛云 CDN（核心能力）
- 白山云 CDN（核心能力）
- CDNetworks（核心能力）
- 金山云 CDN（核心能力）
- 网宿 CDN（核心能力）
- 腾讯云 EdgeOne（核心能力 + 站点）
- 阿里云 ESA（核心能力 + 站点）
- Mock

未实现：无

### 证书

已实现：

- Let's Encrypt
- ZeroSSL
- Google
- LiteSSL
- Custom ACME
- 腾讯云 SSL
- 阿里云 CAS
- UCloud 证书
- Mock

### 部署

已实现 48/51 个部署适配器；`fnos`、`ssh`、`local` 依赖 SSH 或本地文件系统，保留为服务器版专属。
