# backend 核心（入口、安装、库、安全）

进程生命周期与横切能力，不包含具体厂商。

## 结构

```
backend/src/
├── index.ts           # Fastify、authenticate、路由、调度器
├── installer.ts       # 测连、建表、绑定现库、安装后退出
├── migrate.ts         # 幂等补表补列
├── db.ts              # mysql2 pool、table(name)
├── config-loader.ts   # data/config.json 优先于环境变量
├── config.ts          # config 表读写、sys_key
├── auth.ts            # 用户查询、bcrypt、域名权限
├── security.ts        # 安全头、缓存分级、内存限流
└── sql/schema-init.sql
```

## 关键文件

| 文件 | 目的 |
|------|------|
| `index.ts` | `PORT` 默认 8082；未安装只加载 setup；已安装才 migrate + 业务路由 + 调度 |
| `installer.ts` | `isInstalled` = `{prefix}config` 表可查；全新安装写入 version/mail 默认值与 `sys_key` |
| `db.ts` | `table('user')` → `` `dnsmgr_user` `` |
| `security.ts` | `/api` no-store；`/assets/*` 哈希文件 immutable 1 年；HTML CSP |

## 调度周期（仅已安装）

| 任务 | 周期 | 入口 |
|------|------|------|
| 容灾 | 1s | `startMonitorScheduler` |
| 优选 IP + 定时切换 | 60s | `optimizeService.executeAll`、`scheduleService.executeAll` |
| 到期提醒 | 1h | `expireNoticeTask` |
| CDN 预热 | 60s | `executePreheatTasks` |
| 劫持检测 | 60s | `executeCheckTasks` |
| 证书续签/部署 | 5min | `certTaskRun` |

## 依赖

**本模块依赖**: Fastify 插件、`lib/secret.setSecretKey`

**依赖本模块的**: 全部 routes 与 lib

## 规范

- 改表结构同时改 `schema-init.sql`（新装）和 `migrate.ts`（存量）
- 配置文件写入使用 `mode: 0o600`
- 表前缀安装期用 `/^[A-Za-z0-9_]+$/` 白名单
