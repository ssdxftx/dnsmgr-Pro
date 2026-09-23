# backend/src/routes

HTTP API 层。每个文件 default export 一个 Fastify 插件，在 `index.ts` 于 `isInstalled()` 为真时注册（`setup.ts` 始终注册）。

## 结构

```
backend/src/routes/
├── setup.ts        # 安装状态 / 测库 / 安装
├── auth.ts         # 登录、TOTP、当前用户
├── account.ts      # DNS/CDN 账户与 providers
├── domain.ts       # 域名、分类、解析记录
├── cdn.ts          # 加速域名、统计、证书联动
├── cert.ts         # 证书账户/订单 + /api/deploy/*
├── dmonitor.ts     # 容灾
├── optimizeip.ts   # 优选 IP
├── schedule.ts     # 定时切换
├── expire.ts       # 到期提醒
├── preheat.ts      # 定时预热任务
├── dnscheck.ts     # 劫持检测
├── cloudflare.ts   # 自定义主机名与 Tunnel
├── register.ts     # 自助注册与注册码
├── user.ts         # 用户与日志
├── system.ts       # 系统设置与通知测试
└── about.ts        # 版本与检查更新
```

## 关键文件

| 文件 | 目的 |
|------|------|
| `setup.ts` | 未安装时唯一业务入口；install 成功后 `process.exit(0)` |
| `auth.ts` | 签发 session JWT；TOTP 预令牌 |
| `domain.ts` | 解析 CRUD + 删域级联 |
| `cdn.ts` | CDN 主体，体积最大 |
| `cert.ts` | 证书与部署共用一个插件 |

## 依赖

**本模块依赖**:
- `../auth.ts` — `checkLevel`、`findUserById`
- `../db.ts` — `query` / `table`
- `../lib/secret.ts` — 加解密与掩码
- `../lib/*/factory.ts` — 厂商实例

**依赖本模块的**:
- `backend/src/index.ts` — `app.register`
- 前端 `api.ts`

## 规范

- 登录接口：`const auth = { preHandler: (app as any).authenticate }` 或直接把 authenticate 当 preHandler
- 管理员：`if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' }`
- 返回体：`{ code: 0| -1, msg?, data? }`
- 捕获厂商异常后只回 `message`，不回堆栈

## 添加新路由文件

1. 新建 `routes/foo.ts`，default export `async function fooRoutes(app)`
2. 在 `index.ts` import 并放入 `if (installed)` 注册列表
3. 更新 [INTERFACES.md](../INTERFACES.md)
