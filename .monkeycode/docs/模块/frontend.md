# frontend

Vue 3 SPA。开发时 Vite 5173 代理 `/api` 到 8082；生产构建写入 `frontend/dist`，由 Fastify static 托管。

## 结构

```
frontend/src/
├── main.ts / App.vue
├── router.ts              # 安装检测、登录、管理员前缀
├── api.ts                 # fetch 封装与 token
├── env.d.ts
├── layouts/MainLayout.vue # 侧栏菜单（桌面 sider / 移动 drawer）
├── stores/auth.ts         # Pinia，实际 token 在 api.ts
├── lib/admin.ts           # ADMIN_PREFIXES
├── lib/back.ts            # useBack(fallback)
├── lib/safe.ts            # 密钥掩码与表单 show 表达式
├── styles/responsive.css
└── views/                 # 36 个页面
```

`vite.config.ts`：`allowedHosts: ['.monkeycode-ai.online']`；manualChunks 拆 `vendor-vue` / `vendor-ui` / `vendor-charts`；注入 `__APP_VERSION__`、`__BUILD_TIME__`。

## 关键文件

| 文件 | 目的 |
|------|------|
| `router.ts` | 首次 `GET /api/setup/status`；未安装强制 `/setup` |
| `api.ts` | Bearer；GET 把 body 编成 query；401 清 token 跳登录 |
| `lib/admin.ts` | 路径前缀匹配，`level>=2` 才进管理页 |
| `lib/back.ts` | 无历史时 300ms 后 push 父路由 |

## 依赖

**本模块依赖**: 后端 `/api`、naive-ui、vue-router、pinia、echarts、qrcode、`@vicons/ionicons5`

**依赖本模块的**: Dockerfile 第一阶段 `npm run build`

## 规范

- 页面数据一律 `api(method, path, body)`，不要直连 8082
- 管理入口同时改 `ADMIN_PREFIXES` 与 `MainLayout` 菜单
- 密钥输入框空提交时后端会保留原值；前端展示用掩码
- 不要调用 `$router.back()` 作为唯一返回手段

侧栏分组：域名管理、CDN 管理、容灾切换、CF 优选IP、SSL 证书、系统设置；另有仪表盘、关于。普通用户菜单会被 `requiresAdmin` 过滤。
