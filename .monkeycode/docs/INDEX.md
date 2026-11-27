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

### [代码审查报告](./CODE_REVIEW.md)
2026-11-15 全量代码审查：6 个高危、19 个中危、12 个低危问题，含位置、影响与修复建议。

### [代码审查报告（第二轮）](./CODE_REVIEW_2026-11-16.md)
2026-11-16 基于 1.35.8 的复审：5 个中危、4 个低风险/优化项及 1 组依赖公告，含修复实施与验证记录。

### [彩虹聚合DNS v2.22 MCP 能力分析报告](./MCP_UPSTREAM_2.22_REPORT.md)
2026-11-25 基于上游 `netcccyun/dnsmgr` 2.22 分析新增 MCP 接口：28 个工具、124 个动作、JSON-RPC 2.0、`Bearer <uid>:<apikey>` 认证、控制器直接调用方式，以及认证、审计、幂等、长任务和移植到 Pro 的风险与建议。

### [MCP 全模块能力覆盖调研报告](./MCP_MODULE_COVERAGE_REPORT.md)
2026-11-25 基于 Pro 1.35.11 盘点 MCP 对 19 个 API Key 模块的覆盖差异：现有 8 个模块有动作，CDN、DNS 检测、到期提醒、备份、保险库、系统设置、审计、异步任务、事件回调等模块缺少 MCP 入口，含同风格工具拆分、三批实施计划、作用域与安全约束；第一批只读工具、第二批受控写操作与第三批 CDN 高级能力与复核修复已落地为 69 个工具、452 个动作。

### [MCP 全模块覆盖与越权核验报告](./MCP_VERIFICATION_REPORT_2026-11-25.md)
2026-11-25 对 69 个工具做覆盖与安全复核，并完成修复：当前管理员 452 个动作、普通用户 149 个动作；补齐 CDN 推理、媒体转码、日志、配额、域名存在性，修复 `audit_query` 字段冲突、4 个缺失 scope、5 个只读 POST 声明不一致、用户管理确认参数和系统统计过滤。未发现跨用户提权，全部检查通过。

### [全量代码审查报告（2026-11-26）](./CODE_REVIEW_2026-11-26.md)
2026-11-26 基于 v1.36.0 的全量静态审查：8 个高危、14 个中危、5 个低危/工程问题，覆盖 MCP 认证、保险库 TOTP、备份凭据、证书复用、EdgeOne、DNS 批量并发、监控探测和前端竞态，含验证记录与修复顺序。

### [全项目性能与流畅度审查报告（2026-11-26）](./PERFORMANCE_REVIEW_2026-11-26.md)
2026-11-26 基于 v1.37.0 的性能审查与分批实施：定位 CDN 统计缓存不命中、站点与解析记录实时拉云、前端全量串行分页、SQLite 同步阻塞等瓶颈，并已落地统计时间对齐、统计缓存默认开启、CDN 站点与账户配置缓存、前端 GET 缓存前缀失效、首屏优化、轻量域名清单、服务端分页与解析记录短缓存、SQLite 备份快照 worker、注册码与 EO 规则分页、图表与二维码按需加载、管理员域名分页与检索下推、Cloudflare 主机名短缓存、分布式限流预检、DNS Zone 短缓存与任务有界并发、账户与备份列表宽字段收窄、普通用户整域名记录数本地化、账户与订阅列表字段收窄、出站主机并发信号量、监控通知队列、统计缓存分批清理、域名规范化索引、事件投递批量写入、告警通知持久化、子域名计数缓存、站点设置全局页懒加载、预热任务列表去 URL 正文、大列表虚拟滚动、通知日志详情按需返回、账户级上游配额、账户配额扩展到概览与站点枚举、版本管理标签页拆分、CDN 批量操作账户配额、监控手动执行后台化、源站与负载均衡标签页拆分、SQLite 批量写 worker、边缘函数与任务标签页拆分。

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
