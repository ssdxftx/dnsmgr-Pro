# 移动端 UI 约定与基线

适用范围：`frontend/src`。移动端样式统一收敛在 `src/styles/responsive.css`，桌面端（≥768px）不受影响。

## 断点

| 区间 | 布局 |
|---|---|
| `< 768px` | 移动端：抽屉菜单、卡片式表格、KPI 三卡单行、表单上标签 |
| `768–1023px` | 平板：侧栏自动折叠为 72px 图标栏 |
| `≥ 1024px` | 桌面：完整侧栏、表格模式 |

## 新增页面必须遵守

1. **KPI 网格**：`<n-grid class="telemetry-row" ...>`。3 卡自动单行、4 卡自动 2×2；漏类名会退回默认列数。`npm run check:mobile` 会拦截。
2. **列宽**：中文按 14px/字、英文 7px/字符 + 28px padding 估算，或给单元格 `white-space: nowrap`。差 1px 就会折行，把行高从 49px 撑到 70px。
3. **移动卡片**：`columns` 里给 ID、创建/添加时间、备注、CNAME 这类「进去才需要」的字段加 `mobile: 'hide'`，单卡控制在 4 行内。
4. **表单**：`label-placement="left"` 在移动端已统一转为上标签，新增表单无需额外处理。
5. **触控**：页面按钮由 `.app-content .n-button` 保证 36px；`size="tiny"` 用于行内图标时宽度不必强求 32px。
6. **Mock**：新增页面前先补接口，返回结构必须与后端一致（`{list,total}` / `{info,cacheRules}`），否则 `VITE_MOCK` 预览会整页空。

## 表格横向滚动规则

`ResponsiveDataTable.vue`：列宽合计（系统列 40、无宽度列 140、固定开销 24）> 容器 × 1.05 且差值 > 20px 时才设 `scroll-x`，同时加 `rdt--scrollable` 右缘渐隐。

## 基线数值

| 指标 | 基线 |
|---|---|
| KPI 卡高 | 移动端 89px / 桌面 161px |
| 3 卡页面 | 移动端 1 行，卡宽 111–113px |
| 4 卡页面 | 移动端 2 行，卡宽 175–176px |
| 移动卡片高度 | 192–283px（≤4 行） |
| 首条记录位置（390×844） | 445–652px，均在首屏内 |
| 横向溢出 | 45 条路由均为 0 |
| 首屏体积 | ≈318 KB gzip |

改动后若任一指标偏离 ±5%，需复查 `responsive.css` 与对应页面。

## 校验

```bash
cd frontend
npm run check:mobile
npm run check:i18n
npx vue-tsc --noEmit
npm run build
```

`check:mobile` 为静态检查（无需浏览器），覆盖 `telemetry-row` 类名与旧版单列写法。布局数值仍需在 390×844 下人工或 Playwright 复核。

## 已知边界

- 记录页「跳转」、系统设置图标按钮宽度 16/26px：高度已 36px，加 `min-width` 会挤坏行内布局，暂不处理。
- 111px 宽的 KPI 卡容纳 5 位数值；出现 6 位以上数值时再加 `text-overflow: ellipsis`。
- 未做真机验证：iOS Safari 的 `100vh`、`env()` 实测值与软键盘行为仍需真机确认。
