# 彩虹 DNS Pro 文档

本目录是对照仓库源码生成的项目 Wiki，面向要读代码、加厂商、改接口或本地跑起来的开发者。当前代码版本 **1.1.3**（`backend/package.json` / `frontend/package.json`）。

**快速链接**: [架构](./ARCHITECTURE.md) | [接口](./INTERFACES.md) | [开发者指南](./DEVELOPER_GUIDE.md)

---

## 核心文档

### [架构](./ARCHITECTURE.md)
系统定位、技术栈、目录、子系统、启动/登录/证书时序。

### [接口](./INTERFACES.md)
HTTP 约定、鉴权、全部 `/api` 分组、前端路由对照、进程内 Provider 接口。

### [开发者指南](./DEVELOPER_GUIDE.md)
环境、环境变量、发布脚本、加厂商/加页面步骤、编码约定。

---

## 模块

| 模块 | 描述 | 文档 |
|------|------|------|
| 核心进程 | 入口、安装、DB、安全头、调度周期 | [backend-core](./模块/backend-core.md) |
| HTTP 路由 | `backend/src/routes/*` | [backend-routes](./模块/backend-routes.md) |
| DNS 适配 | 22 厂商 `DnsProvider` | [backend-lib-dns](./模块/backend-lib-dns.md) |
| CDN 适配 | 12 厂商、统计、certlink | [backend-lib-cdn](./模块/backend-lib-cdn.md) |
| 证书与部署 | 8 签发 + 49 部署 | [backend-lib-cert-deploy](./模块/backend-lib-cert-deploy.md) |
| 前端 SPA | Vue 3 + Naive UI | [frontend](./模块/frontend.md) |

---

## 核心概念

| 概念 | 描述 |
|------|------|
| [DNS 账户与域名](./专有概念/DNS账户与域名.md) | 厂商账户、本地域名行、解析权限 |
| [CDN 加速域名](./专有概念/CDN加速域名.md) | 接入、CNAME、证书模式 |
| [证书订单](./专有概念/证书订单.md) | 签发状态机与续签 |
| [部署任务](./专有概念/部署任务.md) | 把 PEM 推到面板/云 |
| [容灾切换](./专有概念/容灾切换.md) | 探测与自动改解析 |
| [凭据加密与会话](./专有概念/凭据加密与会话.md) | AES-GCM、JWT、TOTP |

---

## 入门指南

### 项目新人？

1. **[架构](./ARCHITECTURE.md)** — 单进程 8082、安装后才有业务路由
2. **[核心概念](#核心概念)** — 账户 / 订单 / 任务怎么串
3. **[开发者指南](./DEVELOPER_GUIDE.md)** — 起 MariaDB + 前后端
4. **[接口](./INTERFACES.md)** — 调哪些 path

### 需要集成？

1. **[接口](./INTERFACES.md)** — Bearer JWT 与 `{code,msg,data}`
2. **[架构](./ARCHITECTURE.md)** — 调度器副作用（会改云解析）

### 首次贡献？

1. **[开发者指南](./DEVELOPER_GUIDE.md)** — `npx tsc --noEmit` 与 `npm run build`
2. 加厂商走对应 factory，不要改路由里写死 type
3. 发布只用 `node scripts/release.mjs`

---

## 快速参考

```bash
cd backend && npm run dev
cd frontend && npm run dev
cd backend && npx tsc --noEmit
cd frontend && npm run build
node scripts/release.mjs 1.1.4 "feat: ..."
```

| 文件 | 目的 |
|------|------|
| `backend/src/index.ts` | 进程入口 |
| `backend/src/sql/schema-init.sql` | 新装表结构 |
| `backend/src/migrate.ts` | 存量补列 |
| `.env.example` | Compose / 宿主机变量模板 |
| `scripts/release.mjs` | 版本 + 标签 + 推送 |
| `Dockerfile` | 前端 build + 后端 tsx |

产品说明与部署命令以仓库根目录 `README.md` 为准。
