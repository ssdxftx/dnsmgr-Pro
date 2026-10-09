# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[User Instruction Summary]
- Date: 2026-09-30
- Context: 用户要求将代码推送到仓库时指定 Git 身份，并要求长期沿用
- Instructions:
  - Git 提交与推送统一使用 `user.name=ssdxftx`、`user.email=1763610087@qq.com`（已写入本仓库本地配置）
  - 远端仓库：`https://github.com/ssdxftx/dnsmgr-Pro`，主分支 `main`

[Project Knowledge Summary]
- Date: 2026-09-30
- Context: Discovered by Agent while 在本环境端到端验证 Cloudflare 规则引擎
- Category: Troubleshooting & Debugging / Environment Configuration
- Instructions:
  - 后端业务路由仅在“已安装”状态注册；本环境验证需先安装并启动 MariaDB（`apt-get install -y mariadb-server`，`service mariadb start`），再走安装向导 `POST /api/setup/install` 初始化（会执行 `migrate.ts` 建表）
  - 可用环境变量 `DNSMGR_CF_API_BASE` 覆盖 Cloudflare API 基址，指向本地 Mock 即可离线验证规则引擎与凭证降级
  - 后端类型检查 `cd backend && npx tsc --noEmit`；前端 `cd frontend && npx vue-tsc --noEmit && npx vite build`

[Project Knowledge Summary]
- Date: 2026-09-30
- Context: Discovered by Agent while 排查 1Panel 拉取镜像升级失败
- Category: Operations & Deployment / Troubleshooting & Debugging
- Instructions:
  - Dockerfile 运行阶段必须保持 root。曾改为 `USER node`，并把 `NPM_CONFIG_CACHE=/tmp/.npm` 放在 `RUN npm ci` 之前：构建期以 root 生成 `/tmp/.npm`（root 属主）并固化进镜像，运行时非 root（uid 1000）无法写入，容器启动即 `npm error EACCES`、升级回滚
  - 既有部署的数据卷 `/app/data/config.json` 为 root 属主（0600），非 root 运行会读取失败，故升级兼容性要求 root 运行
  - 版本镜像仅由推送 `vX.Y.Z` 标签触发（产出 `X.Y.Z`、`X.Y`、`X`、`latest`）；仅推送 `main` 只产出 `edge`
  - 发布流程：`node scripts/release.mjs <版本>`（要求暂存区非空，会一并提交已暂存改动 + 版本号，打标签并推送 main 与标签）
  - 本环境 `hub.docker.com` 被网络策略拦截、`gh` 未登录、GitHub 匿名 API 有限流，无法直接核验镜像产物

[Project Knowledge Summary]
- Date: 2026-10-01
- Context: Discovered by Agent while 为前端新增 i18n 多语言（zh-CN/en-US）
- Category: Build Methods / Workflow & Collaboration
- Instructions:
  - 前端 i18n 采用 vue-i18n v11（`legacy:false`，已全局安装）；语言偏好存后端 `user.lang`（varchar，迁移由 `migrate.ts` 的 `ensureColumn('user','lang',...)` 保证），登录返回 `publicUser` 携带 lang，更新走 `POST /api/auth/lang`
  - 新增文案的约定：在 `frontend/src/i18n/locales/zh-CN/*.ts` 与 `en-US/*.ts` 各放一个模块文件（`export default { '<唯一顶层命名空间>': {...} }`），由 `import.meta.glob` 自动合并；顶层命名空间必须唯一（已有 common/nav/route/layout/auth/preferences 及 login/domain/cdn/cert/dm/cf/user* 等可按阶段追加），新增模块后无需改 index.ts/core.ts
  - 视图内用 `useI18n()` 取 `t()`；含 `t()` 的 label/column/option 数组必须用 `computed` 包裹保证语言切换时响应式；带参文案用 `t('ns.key', { param })` + 语言文件中 `{param}` 占位符
  - 前端根 `n-config-provider` 的 Naive UI locale 随当前语言在 `zhCN/enUS`、`dateZhCN/dateEnUS` 间切换

[Project Knowledge Summary]
- Date: 2026-10-09
- Context: Discovered by Agent while 本地部署预览（deploy-website）
- Category: Operations & Deployment / Troubleshooting & Debugging
- Instructions:
  - 本地预览（README 方式三）：后端 `cd backend && npm start`（8082，依赖 MariaDB）；前端 `cd frontend && npm run dev`（5173，vite 已把 `/api` 代理到 8082）；对外预览请求前端端口 5173
  - 未安装时后端只注册安装路由（日志「未安装，等待初始化」），前端展示安装页
  - 初始化：`apt-get install -y mariadb-server` + `service mariadb start`，建库/建用户后 `POST /api/setup/install`，字段为 db_host/db_port/db_user/db_password/db_name/db_prefix/admin_username/admin_password；安装成功后后端会 `process.exit(0)`，必须重启后端进程才会加载业务路由与各调度器
  - 本地配置落盘于 `backend/data/config.json`（0600）
  - 为直接验证「添加记录」弹窗，可往 `dnsmgr_account` 插账户、`dnsmgr_domain` 插域名（管理员在 `/api/domains` 可见全部）；演示 provider 无凭证时 `/api/domains/:id/records` 会报错，但记录页「添加记录」按钮仍可见（access 默认 writable）

[Project Knowledge Summary]
- Date: 2026-10-09
- Context: Discovered by Agent while 排查「添加记录」弹窗缺失「主机记录」字段
- Category: Troubleshooting & Debugging
- Instructions:
  - vue-i18n 文案中的裸 `@` 会被当作「链接消息」语法（`@:key`）解析，触发 `Message compilation error: Invalid linked format`；编译失败的 `t()` 在渲染期抛错，Vue 会把对应组件（如 `n-form-item`）渲染成注释节点 `<!---->`，表现为字段凭空消失且无显式报错
  - 本仓库 `record.hostPlaceholder`（zh/en）与 `system.webhookUser`/`webhookUserPlaceholder`（zh）曾含裸 `@`；修复方式：写成字面量 `{'@'}`
  - 排查 i18n 相关渲染问题时，禁止用 mock 的 `useI18n`（返回 key）验证渲染，会掩盖消息编译错误；应以真实 i18n + 生产构建产物在真实浏览器中验证（必要时用无头浏览器驱动）