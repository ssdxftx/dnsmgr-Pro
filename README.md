# 彩虹 DNS Pro

<p align="center">
  <b>多云 DNS · CDN 加速 · SSL 证书 · 自动部署</b>
</p>

彩虹 DNS Pro 是一套面向多域名、多厂商的统一运维平台，采用 **Node.js（TypeScript）+ Fastify + Vue 3** 全栈实现。系统把域名解析、CDN 接入与边缘规则、SSL 证书签发、证书自动部署、容灾切换、定时调度、备份恢复、审计与通知收敛在同一个控制台。

项目已完成整体重写，后端、前端、调度器、CDN 管理、证书与部署能力均由当前代码库独立实现。数据库表结构保持与彩虹 DNS 兼容，可在安装页直接绑定现有数据库，原管理员账号、解析记录、证书与用户数据可继续使用。

适用于个人站长、企业运维、IDC 与服务商集成等需要统一纳管多个云平台域名与加速资源的场景。

---

## 与彩虹 DNS 的兼容与差异

| 维度 | 彩虹 DNS | 彩虹 DNS Pro |
| --- | --- | --- |
| 后端 | PHP 8（ThinkPHP） | Node.js / TypeScript（Fastify） |
| 前端 | 服务端渲染 + jQuery / Bootstrap | Vue 3 + Naive UI（SPA，前后端分离） |
| 接口 | ThinkPHP 路由 | RESTful JSON API |
| 初始化 | PHP 网页安装向导 | Web 安装向导 + 启动自动迁移 |
| 用户体系 | 管理员后台添加用户 | 自助注册、TOTP、私有/共享账户、域名与子域名授权、审计日志 |
| 调度 | 依赖外部 cron | 内置调度器，也可选用 cron URL 触发 |
| 部署 | 传统 PHP 环境 | Docker、Docker Compose、Kubernetes、宿主机 |
| 数据兼容 | — | 可直接绑定彩虹 DNS 现有数据库，表结构一致 |

保留并增强的能力包括多 DNS 平台解析管理、容灾切换、定时切换、Cloudflare 优选 IP、SSL 证书申请、证书自动部署与多通道通知。

---

## 功能总览

### 域名与解析

- **22 家 DNS 服务商**：阿里云、腾讯云（DNSPod）、华为云、百度云、火山引擎、京东云、青云、西部数码、DNSLA、NameSilo、Spaceship、Cloudflare、AWS Route 53、HE DNS、PowerDNS、Technitium、dynv6、GoEdge 智能 DNS、宝塔域名、同系统对接、阿里云 ESA、腾讯云 EdgeOne。
- **账户与域名**：多账户管理，支持私有账户与共享账户；域名分类、备注、别名、批量删除、从云端拉取现有域名。
- **解析记录**：支持 A、AAAA、CNAME、MX、TXT、NS、SRV、CAA、REDIRECT_URL、FORWARD_URL 等记录类型，可设置 TTL、MX 优先级、权重、线路与备注。
- **批量操作**：批量新增、启用、暂停、删除、修改记录值、修改线路、修改备注；支持文本批量导入与全局记录搜索。
- **权重与别名**：支持权重解析、域名别名、解析日志与记录备注。
- **权限控制**：管理员与普通用户分级；按域名、子域名授权，支持只读权限；服务端逐请求校验，越权访问按不存在处理。
- **域名到期提醒**：通过 WHOIS 与 RDAP 获取注册/到期时间，按天数节点通过邮件、微信（WxPusher）、Telegram、QQ 机器人、钉钉、企业微信、飞书或 Webhook 提醒。
- **DNS 劫持检测**：本地解析与 DoH 兜底比对，支持按记录类型、子域名、周期任务检测，异常时发送邮件告警。

### CDN 与边缘

- **12 家 CDN 厂商**：腾讯云 CDN、腾讯云 EdgeOne、阿里云 CDN、阿里云 ESA、火山引擎 CDN、华为云 CDN、百度云 CDN、七牛云 CDN、白山云 CDN、CDNetworks、金山云 CDN、网宿 CDN。
- **接入与生命周期**：加速域名接入、CNAME 查询、源站配置、回源协议与端口、回源 Host、缓存规则、HTTPS 与强制跳转、启停、删除、证书配置。
- **EdgeOne / ESA 站点级能力（按厂商支持）**：站点创建与启停、归属校验、NS 查询、源站组、负载均衡、L7 规则引擎、安全 IP 组、DDoS/WAF、四层代理、内容与刷新配额、刷新/预热任务；ESA 另支持源站防护、开发模式与分级缓存。
- **缓存规则**：支持全部、文件后缀、目录、路径等匹配方式，按厂商规则模型下发缓存策略。
- **缓存刷新与预热**：手动刷新/预热，支持按 URL 或目录刷新；可创建每日或间隔执行的自动预热/刷新任务。
- **数据统计**：腾讯云 CDN、腾讯云 EdgeOne、阿里云 CDN、阿里云 ESA 的流量、请求、带宽、命中率等概览与详情统计，支持统计缓存与手动刷新。
- **Cloudflare 规则引擎**：覆盖回源、重定向、URL 重写、请求头转换、响应头转换、缓存设置、防火墙、速率限制 8 类规则阶段；默认复用 DNS 账户凭证，权限不足时可配置专用加密凭证。
- **Cloudflare 自定义主机名**：批量新增、更新、删除、刷新状态、DCV 验证、回退源站配置。
- **Cloudflare Tunnel**：隧道创建与删除、Token 查看、公共主机名、CIDR 路由、主机名路由管理。

### SSL 证书与自动部署

- **8 个证书签发渠道**：Let's Encrypt、ZeroSSL、Google SSL、LiteSSL、腾讯云免费 SSL、阿里云免费 SSL、UCloud 免费 SSL、自定义 ACME。
- **证书订单**：支持单域名与泛域名、DNS-01 验证、CNAME 代理、自动续签、手动导入、证书详情、PFX 导出与吊销。
- **50 个部署目标**：覆盖宝塔、1Panel、AMH、CloudPanel、DirectAdmin、MW、AcePanel、耗子面板、小皮面板、群晖、飞牛 OS、Proxmox VE、K8S、雷池 WAF、堡塔云 WAF、Cdnfly、LeCDN、GoEdge、南墙 WAF、AxisNow、Cachefly、阿里云、腾讯云、华为云、UCloud、七牛云、多吉云、又拍云、百度云、金山云、火山引擎、西部数码、网宿、白山云、天翼云、雨云、uniCloud、AWS、Gcore、SSH、FTP、S3 存储与本地目录等。
- **CDN 证书联动**：EdgeOne 支持厂商免费证书申请；EdgeOne / ESA 支持证书直传 CDN、站点级泛域名证书签发与自动部署。
- **自动部署任务**：证书续签或重新签发后，按任务配置自动上传到面板、WAF、CDN、云厂商或服务器。

### 容灾、调度与优选

- **容灾切换**：支持 ping（ICMP）、TCP、HTTP/HTTPS 探活；按失败次数与检测周期自动切换主备地址、暂停或恢复解析，记录切换日志并发送通知。
- **定时切换**：按每天、每周、每月或间隔执行，支持修改记录值、启用解析、暂停解析、删除解析；可批量启停与删除策略。
- **Cloudflare 优选 IP**：支持多个优选数据源、IPv4/IPv6、按线路更新 A/AAAA/CNAME 记录，可设置解析数量、TTL 与自动更新间隔，支持积分查询与任务立即执行。

### 备份、恢复与凭证安全

- **整站与个人备份**：管理员可导出整站，普通用户可导出个人数据；归档格式为加密的 `.dnsmgrbk`，使用 AES-256-GCM 加密并对归档头做 HMAC 签名。
- **远端存储**：支持 WebDAV 与 S3 兼容存储，可测试连接、上传、下载、列出与删除远端归档。
- **计划备份**：按每天或每周执行，支持保留份数与保留天数，自动清理过期归档。
- **导入与恢复**：支持 merge 与 replace 两种导入模式、导入预检（dry-run）、在线恢复、恢复前自动备份、维护模式与恢复状态查询。
- **备份密钥**：整站备份使用独立备份密钥，可在界面查看状态并轮换密钥。
- **凭证保险库**：每个用户可启用独立保险库，支持便捷模式与口令模式、恢复码、错误锁定、口令修改、升级/降级、销毁，以及从整站备份中排除。
- **凭据加密**：DNS、CDN、证书、部署账户与敏感系统配置使用 AES-256-GCM 加密落库；接口回显时统一脱敏。
- **审计日志**：自动记录写操作，包含模块、动作、目标、结果、耗时、IP、UA、变更前后值与脱敏请求参数；支持按时间、用户、模块、结果、关键字筛选，并统计今日操作、近 7 天失败与近 30 天活跃用户。

### 多用户、通知与系统

- **多用户体系**：超级管理员、管理员、普通用户；支持自助注册（邮箱验证码或注册码，可配置开关与方式）、TOTP 两步验证、密码重置、账号启停、域名与子域名授权、只读权限、统计查看权限。
- **通知通道**：邮件（SMTP、SendCloud、阿里云邮件推送）、WxPusher、Telegram、QQ 机器人、钉钉、企业微信、飞书/Lark、自定义 Webhook。
- **接口与集成**：`/api/v1` 提供 RESTful JSON API（`/api` 为兼容别名），使用 Bearer 会话令牌或可限定作用域、有效期、IP 白名单的 `X-API-Key`；支持 `Idempotency-Key` 幂等写请求、`X-Reauth-Token` 敏感操作二次确认、统一异步任务、事件回调、`/api/openapi.json` 与 `/api/docs`；支持 CORS 来源白名单与 cron 触发地址。
- **系统设置**：站点配置、注册策略、通知配置、全局 HTTP/HTTPS/SOCKS 代理、统计缓存、审计保留天数、cron 密钥与测试发送。
- **体验**：简体中文与 English 双语、浅色/深色主题、桌面/平板/移动端响应式布局、列表页缓存、图表统计与快捷操作仪表盘。

---

## 部署方式

### 方式一：拉取镜像启动（推荐）

```bash
docker run -d \
  --name dnsmgr-pro \
  -p 8082:8082 \
  -v dnsmgr-pro-data:/app/data \
  --restart always \
  ssdxftx/dnsmgr-pro:latest
```

镜像默认以非 root 用户 `node`（UID/GID 1000）运行。新建命名卷会自动继承镜像内 `/app/data` 的权限；从旧版 root 镜像升级或使用宿主机目录挂载时，请先把数据目录所有者改为 1000:1000：

```bash
# 命名卷升级
docker run --rm -v dnsmgr-pro-data:/app/data alpine chown -R 1000:1000 /app/data

# 宿主机目录
sudo chown -R 1000:1000 /path/to/dnsmgr-data
```

启动后访问 `http://主机:8082`，首次打开会自动进入**系统安装页**：

1. 选择数据库类型：挂载了 `/app/data` 持久化卷时默认 **SQLite**，也可以切换为 MySQL；未挂载持久化卷时只允许 MySQL。
2. MySQL 填写主机、端口、账号、密码、库名、表前缀；SQLite 使用持久化目录内的 `dnsmgr.sqlite`。
3. 点击「测试数据库连接」，系统会自动判断是「全新安装」还是「已有数据」。
4. 全新安装：填写管理员账号密码，点击「立即安装」。
5. **兼容彩虹 DNS**：绑定 MySQL 现有数据库（表结构一致）时，系统会检测到已有数据并直接使用，不删除、不覆盖原有解析、用户、证书等数据。

> `-v dnsmgr-pro-data:/app/data` 用于持久化 SQLite 数据文件、安装配置、备份与审计缓冲文件，请务必保留。未挂载该卷时 SQLite 选项会被禁用，系统回退为 MySQL。

#### SQLite 使用说明

- SQLite 适合单实例、小规模部署；数据文件位于 `DNSMGR_DATA_DIR/dnsmgr.sqlite`，WAL 文件同目录。
- 启动时会在数据库文件旁创建 `dnsmgr.sqlite.lock`，第二个实例会直接拒绝启动；异常退出后如确认没有实例运行，可删除该锁文件后重试。
- 多副本、共享网络存储（NFS/CIFS）请使用 MySQL；SQLite 会按数据文件所在目录检测网络文件系统并禁用。
- 容器根文件系统不视为持久化；需要 SQLite 时请挂载卷，或显式设置 `DNSMGR_DATA_PERSISTENT=1`。SQLite 运行在非持久化目录时启动日志会给出警告。
- 即使设置 `DB_TYPE=sqlite`，未检测到持久化时也会自动回退 MySQL，避免数据写在临时文件系统。
- 备份使用系统内置的加密归档，支持在 MySQL 与 SQLite 之间导出/导入，无需手工复制数据库文件。
- SQLite 使用 Node 内置 `node:sqlite`，启动日志可能出现 `ExperimentalWarning`，不影响功能。
- 升级说明：已有 `config.json` 没有 `db_type` 字段时按 MySQL 继续运行，不会自动切换数据库，也不会改写现有 MySQL 数据。

镜像标签同时推送至 Docker Hub 与 GHCR，镜像内「关于」页显示的版本与容器标签一致：

| 触发方式 | 标签 | 说明 |
| --- | --- | --- |
| 发布版本标签 `vX.Y.Z` | `X.Y.Z`、`X.Y`、`X`、`latest` | 与项目版本一致 |
| 推送至 `main` / `master` 且版本号变更 | `X.Y.Z`、`X.Y`、`X`、`latest`、`<完整 commit SHA>`、`sha-<短 SHA>` | 版本号未变更时跳过镜像构建 |
| 手动触发 | 同上 | 可指定构建平台 |

发布时使用 `node scripts/release.mjs`，工作流会校验 git 标签与 `backend/package.json` 版本是否一致，不一致将直接构建失败。

### 方式二：Docker Compose（自建镜像）

```bash
# 克隆仓库
git clone https://github.com/ssdxftx/dnsmgr-Pro.git dnsmgr-pro
cd dnsmgr-pro

# 构建并启动
docker compose up -d --build
```

安装流程同「方式一」；也可取消 `docker-compose.yml` 中可选 `mysql` 服务的注释，一并启动数据库。

### 方式三：宿主机运行

前置条件：Node.js 22.13+（SQLite 使用内置 `node:sqlite`，推荐 22.22+）、MySQL 5.7+ 或 MariaDB；证书 PFX 导出与部署需要 `openssl`。

```bash
# 后端
cd backend
npm install
npx tsx src/index.ts

# 前端
cd frontend
npm install
npm run dev
```

后端默认监听 `8082`，前端开发服务器把 `/api` 代理到后端。数据库类型与连接也可通过环境变量 `DB_TYPE` / `DB_FILE` / `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PREFIX` 预置，安装页填写会覆盖环境变量。

生产构建：

```bash
cd frontend
npm run build
```

构建产物可由后端通过 `DNSMGR_WEB_DIR` 指向的目录直接提供，也可交给 Nginx 等静态服务器托管。

### 方式四：Kubernetes

仓库内置 Kubernetes 编排清单 `deploy/kubernetes.yaml`，包含 Namespace、PersistentVolumeClaim、Deployment、Service、Ingress 全套资源：

```bash
# 一键部署
kubectl apply -f deploy/kubernetes.yaml

# 查看运行状态
kubectl -n dnsmgr-pro get pods,svc

# 集群内访问（或临时端口转发）
kubectl -n dnsmgr-pro port-forward svc/dnsmgr-pro 8082:8082
```

部署后访问 `http://<NodeIP>:8082`（或你的 Ingress 域名），同样进入系统安装页完成初始化。

- PersistentVolumeClaim 持久化安装配置与备份（`/app/data`），重建 Pod 不丢配置。
- 数据库选项可在 Deployment 的 `env` 注释中开启环境变量预置，或在安装页填写外部数据库连接。
- 若使用 GHCR 私有镜像（`ghcr.io/<owner>/dnsmgr-pro`），需另行配置 `imagePullSecrets`；清单默认使用 Docker Hub 公开镜像 `ssdxftx/dnsmgr-pro`。

### 从彩虹 DNS 迁入

无需数据迁移脚本。直接在新系统安装页填写彩虹 DNS 的数据库连接信息（表前缀默认 `dnsmgr_`，如自定义过请填写实际前缀），即完成绑定，原管理员账号可直接登录。

---

## 反向代理、安全与缓存

应用已内置一套面向公网与 CDN 暴露的默认策略，无需额外配置即可工作。

### 安全响应头

所有响应自动附带 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`、`Cross-Origin-*`；HTML 文档附带 `Content-Security-Policy`，并在 HTTPS 下发送 `Strict-Transport-Security`。

### 分级缓存

- `/assets/*` 中带内容哈希的 Vite 产物：`Cache-Control: public, max-age=31536000, immutable`，浏览器与 CDN 均可缓存一年。
- 根目录公开静态文件（`favicon.webp`、`robots.txt`、`manifest.webmanifest`、字体等）：浏览器与 CDN 均缓存 30 天。
- HTML 入口与 SPA 回退：`Cache-Control: public, max-age=0, s-maxage=60, must-revalidate`，浏览器立即校验，CDN 边缘缓存 60 秒；同时发送 `ETag` / `Last-Modified`，条件请求返回 `304`。
- 公开只读接口（`/api/health`、`/api/setup/status`、`/api/register/config`）：按 5 到 300 秒分层缓存。
- 其余 `/api/*`：`Cache-Control: no-store`，CDN 与浏览器均不缓存，避免敏感数据被缓存。
- Service Worker 路径：`no-cache`，CDN 不缓存，避免旧 worker 长期驻留。
- 同时发送 `CDN-Cache-Control`（阿里云、腾讯云、Cloudflare）、`Surrogate-Control`（Fastly、Varnish）、`Edge-Control`（Akamai）、`Expires` 与 `X-Accel-Expires`（Nginx proxy_cache），覆盖不同 CDN 的缓存头解析规则。
- `Vary` 会合并 `Accept-Encoding` 与 CORS 的 `Origin`，避免压缩或跨域变体互相覆盖。
- 设置 `DNSMGR_CDN_CACHE=0` 可关闭分层策略，回退为浏览器与 CDN 同值。

更多 CDN 接入与调优说明见 `deploy/CDN-CACHE.md`。

### 接口限流与访问控制

- 登录、TOTP、注册、发验证码、安装等接口按 IP 限流：登录 20 次/分钟、注册 10 次/分钟、验证码 5 次/分钟、安装 15 次/分钟，超限返回 `429` 与 `Retry-After`。
- `/api/setup/check` 仅在未安装时可用，已部署实例不会成为数据库连接探测入口。
- 监控探活、Webhook、部署目标与备份远端存储均经过内网/回环/云元数据地址校验，降低 SSRF 风险。
- 部署命令默认禁用；开启 `DNSMGR_ALLOW_DEPLOY_CMD=1` 时必须同时配置 `DNSMGR_DEPLOY_CMD_ALLOWLIST`，命令不经过 shell，SSH 主机密钥支持校验与记录。

### 前端分包

Vue 运行时与 ECharts 拆为独立 chunk，升级业务代码时依赖 chunk 命中缓存，提升二次访问速度。

### 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `APP_PORT` | Docker Compose 对外端口 | `8082` |
| `DB_TYPE` | 数据库类型：`mysql` 或 `sqlite`；SQLite 需要持久化目录 | 全新安装且有持久化卷时 `sqlite`，否则 `mysql` |
| `DB_FILE` | SQLite 数据文件路径，默认 `DNSMGR_DATA_DIR/dnsmgr.sqlite` | `dnsmgr.sqlite` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PREFIX` | MySQL 连接预置；安装页填写会覆盖 | 空 |
| `DNSMGR_TRUST_PROXY` | 位于 Nginx/CDN 之后时设为 `true` 或具体 IP/CIDR，使日志与限流使用真实客户端 IP | 关闭 |
| `DNSMGR_ALLOWED_ORIGINS` | 允许跨域调用 API 的来源，逗号分隔；不设置则仅同源 | 同源 |
| `DNSMGR_RATE_LIMIT` | 设为 `0` 关闭敏感接口限流 | 开启 |
| `DNSMGR_API_KEY_RATE_LIMIT` | 每个 API Key 每分钟请求上限 | `600` |
| `DNSMGR_ALLOW_DEPLOY_CMD` | 设为 `1` 允许部署自定义命令，必须同时配置白名单 | 关闭 |
| `DNSMGR_DEPLOY_CMD_ALLOWLIST` | 允许的部署命令前缀，逗号分隔 | 空 |
| `DNSMGR_PROXY_ALLOW_UNRESOLVED` | 设为 `1` 允许系统代理解析本地无法解析的域名 | 关闭 |
| `DNSMGR_HSTS` | 设为 `0` 关闭 HSTS 响应头 | 开启 |
| `DNSMGR_CDN_CACHE` | 设为 `0` 关闭分层缓存，回退为浏览器与 CDN 同值 | 开启 |
| `DNSMGR_BODY_LIMIT` | 请求体大小上限（字节） | `2097152` |
| `DNSMGR_SETUP_TOKEN` | 安装令牌，未设置时首次启动自动生成并打印到日志 | 自动生成 |
| `DNSMGR_UPDATE_REPO` | 「关于」页检查更新所对比的仓库（`owner/repo`） | `ssdxftx/dnsmgr-Pro` |
| `DNSMGR_UPDATE_TOKEN` | 检查更新用的 GitHub 令牌，私有仓库或需提高 API 限流额度时配置 | 空 |
| `DNSMGR_CF_API_BASE` | 覆盖 Cloudflare API 基址，仅本地联调或自建代理使用 | 官方地址 |
| `DNSMGR_WEB_DIR` | 前端构建产物目录 | 自动探测 |
| `DNSMGR_DATA_DIR` | 安装配置、SQLite 数据文件、备份与审计缓冲目录 | `./data` |
| `DNSMGR_DATA_PERSISTENT` | 设为 `1`/`0` 显式覆盖持久化检测；用于无法读取容器挂载信息的平台 | 自动检测 |

代理层注意：CDN 需保留 `Cache-Control` 与 `X-Forwarded-For` / `X-Forwarded-Proto`，并遵循源站下发的 `/api/*` 不缓存策略。将 `DNSMGR_TRUST_PROXY=true` 仅用于受信代理之后；生产环境建议填写具体代理 IP 或网段，避免客户端伪造来源 IP 绕过限流。

---

## 技术栈与目录结构

- **后端**：Node.js 22、TypeScript、Fastify 5、mysql2 / node:sqlite、JWT、bcrypt、nodemailer、ssh2、AWS S3 SDK、undici。
- **前端**：Vue 3、Vue Router、Pinia、Naive UI、ECharts、Vite。
- **数据库**：SQLite（单实例，默认在持久化卷上启用）或 MySQL 5.7+ / MariaDB，表前缀默认 `dnsmgr_`。
- **运行方式**：生产环境由 Fastify 同进程提供 API 与前端静态文件；开发环境由 Vite 代理 `/api` 到后端。

```text
dnsmgr-Pro/
├── backend/                  # Node.js + TypeScript + Fastify
│   ├── src/
│   │   ├── routes/           # 认证、域名、CDN、证书、部署、备份、审计等接口
│   │   ├── lib/              # DNS/CDN/证书/部署 Provider、调度器、保险库、备份等
│   │   ├── db/               # MySQL / SQLite 驱动、方言翻译与元数据查询
│   │   ├── sql/              # 建表 SQL
│   │   ├── migrate.ts        # 启动自动迁移
│   │   ├── installer.ts      # 安装与绑定逻辑
│   │   └── index.ts          # 进程入口
│   └── scripts/              # 接口审计与备份校验脚本
├── frontend/                 # Vue 3 + Naive UI + Vite
│   └── src/
│       ├── views/            # 业务页面
│       ├── components/       # 通用组件
│       ├── i18n/             # 简体中文与英文
│       ├── layouts/          # 桌面与移动端布局
│       └── router.ts         # 前端路由与权限守卫
├── deploy/                   # Kubernetes 清单与 CDN 缓存文档
├── docs/                     # 移动端 UI 约定等开发文档
├── scripts/                  # 发布与缓存头校验脚本
├── Dockerfile                # 多阶段构建（前端构建 + 后端运行）
├── docker-compose.yml
└── .env.example
```

### 开发校验

```bash
# 后端类型检查
cd backend
npx tsc --noEmit
npm run check:audit
npm run check:backup
npm run check:sqlite
# 可选：MySQL 冒烟测试与 SQLite ↔ MySQL 跨库备份测试（需设置 DB_HOST / DB_USER / DB_NAME 等）
npm run check:mysql
npm run check:cross

# 前端类型检查与静态校验
cd frontend
npx vue-tsc --noEmit
npm run check:i18n
npm run check:mobile
npm run build
```

---

## 版本管理与发布

版本号遵循 `主版本.次版本.修订号`（SemVer），同时维护在 `frontend/package.json` 与 `backend/package.json`，二者保持一致。每次发布都会在仓库打上 `vX.Y.Z` 形式的标签，代码与标签在同一次推送中提交。

### 查看版本与检查更新

登录后台后进入「系统设置 → 关于」，可查看前后端版本、构建时间、运行环境、运行时长与项目仓库，并点击「检查更新」对比仓库标签判断是否有新版本；有新版本时会展示更新说明与下载入口。

检查更新优先读取 git 协议的 refs 接口，再尝试读取 Release 补充更新说明：

- 默认对比 `ssdxftx/dnsmgr-Pro`，可用 `DNSMGR_UPDATE_REPO=owner/repo` 覆盖。
- 私有仓库或遇到接口限流时，可配置 `DNSMGR_UPDATE_TOKEN`（服务端环境变量，不会下发到前端）。

### 发布新版本

```bash
# 1. 提交本次改动到暂存区
git add <本次改动的文件>

# 2. 升级版本号、提交、打标签并推送（代码与标签一次推送）
node scripts/release.mjs 1.0.1

# 3. 如需自定义提交信息
node scripts/release.mjs 1.0.1 "feat: 关于页支持检查更新"
```

发布脚本要求当前处于 `main` 分支且暂存区非空，会自动同步写入 4 个版本文件（前后端 `package.json` 及其 `package-lock.json`）。

发布后 GitHub Actions 会自动构建并推送容器镜像：版本标签 `vX.Y.Z` 生成同名数字标签（`X.Y.Z`、`X.Y`、`X`）、`latest` 与提交 SHA 标签；推送到 `main` / `master` 时仅在版本号发生变化时构建，版本号未变则跳过。详见「部署方式 → 方式一」中的镜像标签说明。

---

## 开源协议

本项目基于彩虹 DNS（MIT License）的表结构与设计理念衍生，采用 [MIT License](./LICENSE) 开源。当前仓库中的后端、前端、CDN 管理、证书与部署能力均为独立实现。

[MIT](./LICENSE) © 彩虹 DNS Pro 贡献者 · 原始版权归属 [消失的彩虹海（彩虹 DNS）](https://github.com/netcccyun/dnsmgr)
