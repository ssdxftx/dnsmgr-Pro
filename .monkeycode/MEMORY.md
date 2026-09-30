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