# 开发者指南

## 项目目的

彩虹 DNS Pro 把多云 DNS、CDN、SSL 证书和证书部署收进同一个管理面。本仓库是原 PHP 项目彩虹 DNS 的 TypeScript 重写，并接入阔彩 CDN 的加速域名/规则能力。

**核心职责**:
- 统一调用 22 家 DNS、12 家 CDN、8 家证书签发、49 家部署目标
- 提供安装向导、多用户权限、TOTP、自助注册
- 在已安装进程内跑容灾、定时切换、优选 IP、预热、劫持检测、证书续签

**相关系统**:
- [彩虹 DNS](https://github.com/netcccyun/dnsmgr) — 表结构兼容，安装页可绑定现库
- Docker Hub / GHCR `ssdxftx/dnsmgr-pro` — 发布镜像
- GitHub Actions `docker-build.yml` — 标签构建正式镜像

## 环境搭建

### 前置条件

- Node.js 22+
- MySQL 5.7+ 或 MariaDB（本地开发常用 MariaDB 10.11）
- Docker（可选，用于镜像与 Compose）
- openssl（证书导出 PFX 时 `CertOrderService.buildPfx` 会调用）

### 安装

```bash
git clone https://github.com/ssdxftx/dnsmgr-Pro.git
cd dnsmgr-Pro

cd backend
npm install

cd ../frontend
npm install
```

数据库需事先建库。连接优先读 `backend/data/config.json`，其次环境变量。代码里 **不再** 默认数据库密码；未配置时密码为空字符串。

```bash
# 示例：MariaDB
# CREATE DATABASE dnsmgr CHARACTER SET utf8mb4;
# CREATE USER 'dnsmgr'@'%' IDENTIFIED BY '<password>';
# GRANT ALL ON dnsmgr.* TO 'dnsmgr'@'%';
```

### 环境变量

| 变量 | 必需 | 描述 | 示例 |
|------|------|------|------|
| `PORT` | 否 | 后端监听端口 | `8082` |
| `DB_HOST` | 安装前可选 | 数据库主机 | `127.0.0.1` |
| `DB_PORT` | 否 | 端口 | `3306` |
| `DB_USER` | 否 | 用户 | `dnsmgr` |
| `DB_PASSWORD` | 安装前建议 | 密码；代码无内置默认 | `<DB_PASSWORD>` |
| `DB_NAME` | 否 | 库名 | `dnsmgr` |
| `DB_PREFIX` | 否 | 表前缀 | `dnsmgr_` |
| `DNSMGR_DATA_DIR` | 容器内是 | 配置目录，内含 `config.json` | `/app/data` |
| `DNSMGR_CONF` | 否 | 直接指定配置文件路径 | `/path/config.json` |
| `DNSMGR_WEB_DIR` | 容器内是 | 前端静态目录 | `/app/web` |
| `DNSMGR_TRUST_PROXY` | 反向代理时 | `true` / 数字 / CIDR | `true` |
| `DNSMGR_ALLOWED_ORIGINS` | 跨域 API 时 | 逗号分隔 Origin | `https://dns.example.com` |
| `DNSMGR_HSTS` | 否 | `0` 关闭 HSTS | `0` |
| `DNSMGR_RATE_LIMIT` | 否 | `0` 关闭敏感接口限流 | `0` |
| `DNSMGR_BODY_LIMIT` | 否 | 请求体字节上限 | `2097152` |
| `DNSMGR_ALLOW_DEPLOY_CMD` | 否 | `1` 才允许部署任务自定义命令 | `1` |
| `DNSMGR_ALLOW_PRIVATE_FETCH` | 否 | `1` 才允许监控/自定义 ACME 访问内网 | `1` |
| `DNSMGR_UPDATE_REPO` | 否 | 检查更新仓库 | `ssdxftx/dnsmgr-Pro` |
| `DNSMGR_UPDATE_TOKEN` | 否 | GitHub token（私有库/提高限额） | `<token>` |
| `TZ` | 容器默认 | 时区 | `Asia/Shanghai` |

安装向导写入的 `data/config.json` 会覆盖同名字段的环境变量。该文件含数据库密码，权限 0600，已在 `.gitignore`。

### 运行

```bash
# 后端（监听 8082，tsx 直接跑 TS）
cd backend
npm run dev
# 或 npm start  （无 watch）

# 前端（5173，/api 代理到 8082）
cd frontend
npm run dev
```

首次访问会进 `/setup`。也可用接口安装：

```bash
curl -X POST http://127.0.0.1:8082/api/setup/install \
  -H 'Content-Type: application/json' \
  -d '{"db_host":"127.0.0.1","db_port":3306,"db_user":"dnsmgr","db_password":"<password>","db_name":"dnsmgr","db_prefix":"dnsmgr_","admin_username":"admin","admin_password":"<至少8位>"}'
```

安装成功后进程会 `process.exit(0)`，必须重启后端才会加载业务路由和调度器。`npm run dev`（`tsx watch`）会自动拉起。

健康检查：`GET http://127.0.0.1:8082/api/health`。

生产构建：

```bash
cd frontend && npm run build
# 产物 frontend/dist，后端启动时 resolveWebDir 会按 DNSMGR_WEB_DIR / dist / ../frontend/dist / web 查找
```

容器：

```bash
docker compose up -d --build
# 或 docker run -p 8082:8082 -v dnsmgr-pro-data:/app/data ssdxftx/dnsmgr-pro:latest
```

仓库内 **没有** `npm test` / Jest / Vitest。后端类型检查：`cd backend && npx tsc --noEmit`。前端 `npm run build` 是 Vite 打包，不含 `vue-tsc`。

## 开发工作流

### 代码质量工具

| 工具 | 命令 | 目的 |
|------|------|------|
| TypeScript（后端） | `cd backend && npx tsc --noEmit` | 类型检查（`tsconfig` 为 `noEmit`） |
| Vite build | `cd frontend && npm run build` | 前端生产构建 |
| 无 ESLint / Prettier 配置 | — | 仓库未提供 lint/format 脚本 |

### 发布

必须在 `main` 且暂存区非空：

```bash
git add <本次改动>
node scripts/release.mjs 1.1.4 "fix: 说明"
```

脚本会改 4 个版本文件（前后端 `package.json` 与 `package-lock.json`）、提交、打 annotated 标签 `vX.Y.Z`、推送 `origin main` 与该标签。

GitHub Actions 要求 git 标签去掉 `v` 后与 `backend/package.json` 的 `version` 一致，否则构建失败。标签构建默认 `linux/amd64`；需要 arm64 时在 Actions 页面 `workflow_dispatch` 选 `linux/amd64,linux/arm64`。

同一次「推 main + 打标签」时，分支构建会因 `git describe --tags --exact-match` 跳过，正式镜像只由标签任务产出。

不要把 `.monkeycode/` 和根目录空的 `package-lock.json` 加进提交。

### 分支策略

仓库主分支是 `main`。发布脚本强制当前分支为 `main`。功能开发可在其他分支，合并回 `main` 后再 `release.mjs`。

## 常见任务

### 添加 DNS Provider

**需修改的文件**:
1. `backend/src/lib/dns/providers/<type>.ts` — 实现 `DnsProvider`
2. `backend/src/lib/dns/factory.ts` — `dnsProviders` 元数据 + `providerMap`
3. 若证书 DNS-01 需要线路：`backend/src/lib/certDns.ts`

**步骤**:
1. 按 `lib/dns/types.ts` 实现 `check` / 域名列表 / 记录 CRUD / 线路
2. 在 `dnsProviders` 声明 `config` 字段（密钥类字段名需能被 `isSecretKey` 识别）
3. 注册到 `providerMap`
4. 用真实 API 冒烟：错误密钥应返回厂商真实错误信息

### 添加 CDN Provider

**需修改的文件**:
1. `backend/src/lib/cdn/providers/<Name>.ts` — 实现 `CdnProvider`
2. `backend/src/lib/cdn/factory.ts` — `cdnConfig`、`providerMap`、必要时 `ADD_FLOW_OVERRIDES`
3. 统计（若支持）：`backend/src/lib/cdn/statistics/`

### 添加证书签发渠道

**需修改的文件**:
1. `backend/src/lib/cert/providers/<type>.ts` — 实现 `CertProvider`
2. `backend/src/lib/cert/factory.ts` — `certConfig` + `providerMap`

未知 type 会在 `getCertProvider` 抛 `证书类型不存在`。

### 添加部署商

**需修改的文件**:
1. `backend/src/lib/deploy/providers/<type>.ts` — 实现 `DeployProvider`
2. `backend/src/lib/deploy/meta.ts` — `deployConfig` 表单元数据
3. `backend/src/lib/deploy/factory.ts` — `providerMap`

自定义命令必须走 `assertCommandAllowed()`。

### 添加 API 路由

1. 在 `backend/src/routes/<domain>.ts` 用 `app.get/post/...` 注册，需要登录时挂 `auth`（即 `(app as any).authenticate`）
2. 管理员接口用 `checkLevel(req.user, 2)`
3. 在 `backend/src/index.ts` 的 `if (installed)` 块 `app.register(...)`
4. 前端在对应 `views/*.vue` 用 `api('GET', '/xxx')` 调用

### 添加前端页面

1. `frontend/src/views/Xxx.vue`
2. `frontend/src/router.ts` 的 `MainLayout` children
3. 管理页路径加入 `frontend/src/lib/admin.ts` 的 `ADMIN_PREFIXES`
4. 侧栏：`frontend/src/layouts/MainLayout.vue` 的 `menuOptions`
5. 子页若有返回箭头，用 `useBack('/parent')` 而不是裸 `$router.back()`

### 数据库变更

没有独立 migration 目录。两种方式：

- 全新安装：改 `backend/src/sql/schema-init.sql`（硬编码前缀 `dnsmgr_`，安装时替换为配置前缀）
- 已安装实例：在 `backend/src/migrate.ts` 用 `ensureColumn` 或 `CREATE TABLE IF NOT EXISTS`

不要改已经部署出去的历史 SQL 语句语义；用幂等补列/补表。

### 修复 Bug

1. 对照源项目时可参考 `/root/dnsmgr-pro-audit/CHECKED_MODULES.md`（项目外，勿提交）
2. 后端改完跑 `npx tsc --noEmit`；前端跑 `npm run build`
3. 发布走 `scripts/release.mjs`

## 编码规范

### 文件组织

- 路由：`backend/src/routes/<领域>.ts`，default export Fastify 插件
- 厂商：`lib/<dns|cdn|cert|deploy>/providers/`，factory 集中注册
- 云 SDK 封装：`lib/clients/`
- 前端一页一文件，放 `frontend/src/views/`

### 命名

| 类型 | 约定 | 示例 |
|------|------|------|
| 后端文件 | camelCase 或 厂商专有大小写 | `certService.ts`、`TencentCDN.ts` |
| Provider 类 | PascalCase | `AwsDns`、`QzyunDeploy` |
| 路由函数 | camelCase + Routes | `cdnRoutes` |
| 表逻辑名 | 无前缀，运行时 `table('user')` | `dnsmgr_user` |
| 前端视图 | PascalCase.vue | `RecordList.vue` |
| localStorage | `dnsmgr_*` | `dnsmgr_token` |

### 错误处理

路由里捕获厂商异常后返回 `{ code: -1, msg }`，不要把堆栈和密钥回给前端。CDN 统计在全部数据源失败时上抛真实 `message`。

### 密钥

- 落库走 `encryptConfig` / `encryptText`
- 回显走 `maskConfig`
- 更新走 `mergeMaskedConfig`
- 文档和示例用占位符，不要写真实密码、AK/SK、token

### 测试

仓库无自动化测试套件。手动验证入口：

- `GET /api/health`
- 登录 `POST /api/auth/login`
- 列表类接口 `/api/dns/providers`、`/api/deploy/providers`

## 修改建议区域

相对低风险、适合熟悉代码：

- 前端文案、Naive UI 布局、`useBack` 回退路径
- `lib/deploy/meta.ts` 表单文案
- `security.ts` 缓存头（改前要理解 CDN 分层）

高风险：

- `installer.ts` / `schema-init.sql` / `migrate.ts`
- `secret.ts` 与 `sys_key` 派生
- `authenticate` 与 TOTP 令牌类型
- 调度器（容灾 1s tick、证书续签）
