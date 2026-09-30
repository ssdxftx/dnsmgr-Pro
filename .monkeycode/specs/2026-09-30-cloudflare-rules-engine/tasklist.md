# 实施任务清单：Cloudflare 规则引擎（移植）

Feature Name: cloudflare-rules-engine
Updated: 2026-09-30

## 任务列表

- [x] 1. 后端：`lib/cloudflare/enhance.ts` 增加公共 `apiRequest` 薄封装
- [x] 2. 后端：新增 `lib/cloudflare/ruleset.ts`（phase 映射、ruleset 定位/创建、规则 CRUD、probe）
- [x] 3. 后端：`migrate.ts` 新增 `cf_rule_credential` 表
- [x] 4. 后端：新增 `lib/cloudflare/rulesCredential.ts`（凭证解析与专用凭证存取）
- [x] 5. 后端：新增 `routes/cfrules.ts` 并在 `index.ts` 注册
- [x] 6. 前端：新增 `views/CfRules.vue`（域名/phase、规则表、结构化表单、高级 JSON、表达式预览、专用凭证）
- [x] 7. 前端：接线 `router.ts`、`MainLayout.vue`、`lib/admin.ts`、`RecordList.vue`
- [x] 8. 文档：更新 `.monkeycode/docs/INTERFACES.md` 与相关模块文档
- [x] 9. 验证：后端 `tsc --noEmit`、前端 `vue-tsc --noEmit` + `vite build`、无库启动冒烟

## 验收标准

- 8 类 phase 规则的读取/新增/编辑/删除可用，作用域与 action 形态符合设计（重定向用站点级 `http_request_dynamic_redirect` + `from_value.target_url`）。
- 默认复用 DNS 账户密钥；权限不足返回 `needCredential` 并可保存、优先使用按账户绑定的专用凭证。
- 专用凭证 AES-256-GCM 加密存储、掩码返回。
- 全部 `/api/cf-rules/*` 仅管理员可用。
- UI 与现有项目一致，移动端沿用 `ResponsiveDataTable`。