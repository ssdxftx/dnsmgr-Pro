# 彩虹 DNS Pro

<p align="center">
  <b>DNS 解析 · CDN 加速 · SSL 证书 · 自动部署</b> 一体化管理平台
</p>

彩虹 DNS Pro 是基于 [彩虹聚合 DNS 管理系统（彩虹 DNS）](https://github.com/netcccyun/dnsmgr) 的现代化重构版，采用 **Node.js（TypeScript）+ Fastify + Vue 3** 全栈重写，并在原有 DNS 解析管理能力之上，融合了 [阔彩 CDN（multi-cloud-cdn）](https://github.com/qingqian844/kuocaicdn_V1A) 的 **CDN 域名管理与边缘规则引擎** 能力，形成「域名解析 → CDN 加速 → SSL 证书 → 自动部署」的完整闭环。

在单个网站内即可管理多个平台的域名解析与 CDN 加速，支持多用户权限、API 接口、批量操作，适用于 IDC 系统集成与个人/企业统一纳管。

---

## 相较于彩虹 DNS 的变化

| 维度 | 彩虹 DNS（原版） | 彩虹 DNS Pro |
| --- | --- | --- |
| 后端 | PHP 8（ThinkPHP） | Node.js / TypeScript（Fastify） |
| 前端 | 服务端渲染 + jQuery/Bootstrap | Vue 3 + Naive UI（SPA，前后端分离） |
| 接口 | ThinkPHP 路由 | RESTful JSON API | 
| 初始化 | 网页安装向导（依赖 PHP） | Web 安装向导（填库即可）+ 启动自动迁移 |
| 用户体系 | 管理员后台添加用户 | 新增**自助注册**（邮箱验证码 / 注册码，管理员可配置开关与方式）、TOTP 两步验证 |
| 数据兼容 | — | **绑定彩虹 DNS 现有数据库直接使用**，表结构一致、免迁移 |

保留并增强的能力：多 DNS 平台解析管理、容灾切换、定时切换、Cloudflare 优选 IP、SSL 证书申请、多通道通知（邮件 / 微信 / Telegram / 钉钉 / 飞书 / 企微 / Webhook）。

---

## 从 multi-cloud-cdn（阔彩 CDN）引入的能力

彩虹 DNS 原版已具备 CDN 域名管理骨架，但各平台的控制（尤其 EdgeOne）多为占位实现。彩虹 DNS Pro 将阔彩 CDN（Java 版）中的实现移植（翻译为 TypeScript）过来：

- **腾讯云 EdgeOne 规则引擎**：通过 L7 加速规则（`CreateL7AccRules` / `ModifyL7AccRule` / `DeleteL7AccRules`）+ 规则表达式完成缓存规则下发，支持文件后缀、目录、全路径三类匹配与通配符转正则。
- **腾讯云 CDN 缓存规则**：规则类型映射（all / file / directory / path）、`ttl=0` 转 NoCache、优先级反转。
- **阿里云 CDN 缓存规则**：先删旧配置再下发、`filetype_based_ttl_set` / `path_based_ttl_set` 分类、权重递减。
- **HTTPS 配置**：EdgeOne 证书禁用（`ModifyHostsCertificate`）+ 站点级强制跳转（`ForceRedirectHTTPS`）；阿里云 CDN 关闭 SSL + 强制跳转。
- **阿里云 ESA** 缓存规则 / HTTPS 规则（规则引擎式 `CacheRule` / `HttpsBasicConfiguration` / `HttpsApplicationConfiguration`，基于 ESA OpenAPI 2024-09-10 实现）。
- **工程实践**：容器化部署、数据库启动时自动初始化（幂等建表 / 迁移）的思路。

---

## 两者的联动

- **彩虹 DNS** 负责「域名解析」：多平台 DNS 记录统一管理、容灾/定时切换、优选 IP。
- **multi-cloud-cdn / 阔彩 CDN** 负责「内容加速」：CDN 域名接入、源站 / 缓存 / HTTPS / 边缘规则。
- **彩虹 DNS Pro 将二者融合**：解析记录与 CDN 加速域名同库关联，配合内置的 SSL 证书申请与 40+ 部署商自动部署，一个平台完成从「域名 → 解析 → 证书 → 加速 → 上线」的全流程，避免多系统割裂与重复配置。

---

## 功能特性

- **DNS 解析管理**：支持阿里云、腾讯云、华为云、百度云、西部数码、火山引擎、Cloudflare、DNSPod、DNSLA、Namesilo、PowerDNS、GoEdge 等 20+ 平台，多用户按域名分配权限，支持 API 接口与批量操作。
- **CDN 加速管理**：腾讯云 CDN、阿里云 CDN、腾讯云 EdgeOne、阿里云 ESA 四类平台的接入、源站、缓存规则、HTTPS 配置。
- **SSL 证书**：Let's Encrypt、ZeroSSL、Google Trust Services、阿里云、腾讯云等 8 个签发渠道，支持申请、续期、手动导入。
- **证书自动部署**：宝塔面板、宝塔 WAF、宝塔 Windows、1Panel 等面板、K8s、AWS、阿里云、腾讯云、华为云、群晖、Proxmox、SSH、FTP、Nginx Proxy Manager、DirectAdmin 等 40+ 部署商。
- **容灾切换**：ping / tcp / http(s) 检测协议，自动暂停/切换解析，多通道告警。
- **定时切换**：指定时间/周期自动修改/开启/暂停/删除解析。
- **CF 优选 IP**：自动获取最新 Cloudflare 优选 IP 并更新到解析记录。
- **多用户体系**：用户自助注册（邮箱验证码 / 管理员生成注册码，可配置开关与方式）、TOTP 两步验证、域名级权限分配、API Key。
- **多通道通知**：邮件、微信公众号（WxPusher）、Telegram、钉钉、飞书、企业微信、Webhook、自定义 Webhook。

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

启动后访问 `http://主机:8082`，首次打开会自动进入**系统安装页**：

1. 填写数据库连接信息（主机、端口、账号、密码、库名、表前缀）。
2. 点击「测试数据库连接」——系统会自动判断是「全新安装」还是「已有数据」。
3. 全新安装：填写管理员账号密码，点击「立即安装」。
4. **兼容彩虹 DNS**：若填写的是彩虹 DNS 现有数据库（表结构一致），系统会检测到已有数据并**直接绑定使用**，不删除、不覆盖原有解析、用户、证书等任何数据。

> 应用与数据库分离，数据库可自建（MySQL 5.7+ / MariaDB）。`-v dnsmgr-pro-data:/app/data` 用于持久化安装配置，请务必保留。

镜像标签（同时推送至 Docker Hub 与 GHCR，镜像内「关于」页显示的版本与容器标签一致）：

| 触发方式 | 标签 | 说明 |
| --- | --- | --- |
| 发布版本标签 `vX.Y.Z` | `X.Y.Z`、`X.Y`、`X`、`latest` | 与项目版本一致；`latest` 仅在正式版本（非预发布）更新 |
| 推送至 `main` / `master` | `edge` | 跟随主分支的最新构建，可能包含未发布改动 |
| 任意构建 | `<完整 commit SHA>`、`sha-<短 SHA>` | 按提交精确定位 |

发布时请使用 `node scripts/release.mjs`，工作流会校验 git 标签与 `backend/package.json` 版本是否一致，不一致将直接构建失败。

### 方式二：Docker Compose（自建镜像）

```bash
# 克隆仓库
git clone https://github.com/ssdxftx/dnsmgr-Pro.git dnsmgr-pro
cd dnsmgr-pro

# 构建并启动
docker compose up -d --build
```

安装流程同「方式一」；也可取消 `docker-compose.yml` 中可选 `mysql` 服务注释，一并启动数据库。

### 方式三：宿主机运行

```bash
# 后端（需 Node.js 22+，MySQL/MariaDB）
cd backend
npm install
npx tsx src/index.ts

# 前端
cd frontend
npm install
npm run dev
```

后端默认监听 `8082`，前端开发服务器代理 `/api` 到后端。数据库连接也可通过环境变量 `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PREFIX` 预置。

### 方式四：Kubernetes（容器编排）

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

- PersistentVolumeClaim 持久化安装配置（`/app/data`），重建 Pod 不丢配置。
- 数据库选项可在 Deployment 的 `env` 注释中开启环境变量预置，或在安装页填写外部数据库连接。
- 若使用 GHCR 私有镜像（`ghcr.io/<owner>/dnsmgr-pro`），需另行配置 `imagePullSecrets`；清单默认使用 Docker Hub 公开镜像 `ssdxftx/dnsmgr-pro`。

### 从彩虹 DNS 迁入

无需任何数据迁移脚本。直接在新系统安装页填写彩虹 DNS 的数据库连接信息（表前缀默认 `dnsmgr_`，如自定义过请填写实际前缀），即完成绑定，原管理员账号可直接登录。

---

## 反向代理与 CDN 部署（安全与缓存）

应用已内置一套面向公网/CDN 暴露的默认策略，无需额外配置即可工作：

- **安全响应头**：所有响应自动附带 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`、`Cross-Origin-*`，HTML 文档附带 `Content-Security-Policy`，并发送 `Strict-Transport-Security`（仅 HTTPS 下由浏览器生效）。
- **分级缓存（利于 CDN 命中率）**：
  - `/assets/*`（Vite 带哈希指纹）：`Cache-Control: public, max-age=31536000, immutable`，可长期缓存
  - HTML 入口与 SPA 回退：`Cache-Control: no-cache`，CDN 每次回源校验，发新版即时生效
  - `/api/*`：`Cache-Control: no-store`，CDN 与浏览器均不缓存，避免敏感数据被缓存
  - 其它静态文件：`public, max-age=86400`
  - 同时发送 `CDN-Cache-Control`，便于 CDN 单独控制缓存而不影响浏览器
- **前端分包**：`vue`/`naive-ui`/`echarts` 拆为独立 chunk，升级业务代码时依赖 chunk 命中缓存，提升二次访问速度。
- **接口限流**：登录、TOTP、注册、发验证码、安装等接口按 IP 限流（默认 30 次/分钟，安装 15 次/分钟），返回 `429` 与 `Retry-After`。
- **安装接口收敛**：`/api/setup/check` 仅在未安装时可用，已部署实例不会成为数据库连接探测入口。

反向代理/CDN 场景建议设置以下环境变量：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `DNSMGR_TRUST_PROXY` | 位于 Nginx/CDN 之后时设为 `true`（或具体 IP/CIDR），使日志与限流使用真实客户端 IP，取 `X-Forwarded-For` | 关闭 |
| `DNSMGR_ALLOWED_ORIGINS` | 允许跨域调用 API 的来源，逗号分隔；不设置则仅同源、不发送 CORS 头 | 同源 |
| `DNSMGR_RATE_LIMIT` | 设为 `0` 关闭敏感接口限流 | 开启 |
| `DNSMGR_HSTS` | 设为 `0` 关闭 HSTS 响应头 | 开启 |
| `DNSMGR_BODY_LIMIT` | 请求体大小上限（字节） | 2097152 |
| `DNSMGR_UPDATE_REPO` | 「关于」页检查更新所对比的仓库（`owner/repo`） | ssdxftx/dnsmgr-Pro |
| `DNSMGR_UPDATE_TOKEN` | 检查更新用的 GitHub 令牌，私有仓库或需提高 API 限流额度时配置 | 空 |

代理层注意：CDN 需保留 `Cache-Control` 与 `X-Forwarded-For`/`X-Forwarded-Proto`，且不要缓存 `/api/*`；本应用已通过响应头声明，主流 CDN 默认遵守。

---

## 技术栈与目录结构

```
dnsmgr-refactor/
├── backend/          # Node.js + TypeScript + Fastify
│   └── src/
│       ├── routes/       # 路由（认证/域名/CDN/证书/部署/注册等）
│       ├── lib/          # 平台 Provider（dns/cert/deploy/cdn/cloudflare 等）
│       ├── sql/          # 建表 SQL（schema-init.sql）
│       ├── migrate.ts    # 启动自动迁移
│       ├── installer.ts  # 安装/绑定逻辑
│       └── index.ts      # 入口
├── frontend/         # Vue 3 + Naive UI + Vite
├── scripts/          # 发布脚本（release.mjs：改版本 + 打标签 + 推送）
├── deploy/           # 容器编排清单（kubernetes.yaml）
├── Dockerfile        # 多阶段构建（前端构建 + 后端运行）
├── docker-compose.yml
└── .env.example
```

---

## 版本管理与发布

版本号遵循 `主版本.次版本.修订号`（SemVer），同时维护在 `frontend/package.json` 与 `backend/package.json`，二者保持一致。每次发布都会在仓库打上 `vX.Y.Z` 形式的标签，代码与标签在同一次推送中提交。

### 查看版本与检查更新

登录后台后进入「系统设置 → 关于」，可查看前后端版本、构建时间、运行环境、运行时长与项目仓库，并点击「检查更新」对比仓库标签判断是否有新版本；有新版本时会展示更新说明与下载入口。

检查更新优先读取 git 协议的 refs 接口（不受 GitHub REST API 限流影响），再尝试读取 Release 补充更新说明：

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

发布后 GitHub Actions 会自动构建并推送容器镜像：版本标签 `vX.Y.Z` 生成同名数字标签（`X.Y.Z`、`X.Y`、`X`）与 `latest`，同时因推送到 `main` 还会生成一个 `edge` 构建。详见「部署方式 → 方式一」中的镜像标签说明。

---

## 开源协议

本项目基于彩虹 DNS（MIT License）衍生，并融合阔彩 CDN 相关实现，采用 [MIT License](./LICENSE) 开源。

[MIT](./LICENSE) © 彩虹 DNS Pro 贡献者 · 原始版权归属 [消失的彩虹海（彩虹 DNS）](https://github.com/netcccyun/dnsmgr)