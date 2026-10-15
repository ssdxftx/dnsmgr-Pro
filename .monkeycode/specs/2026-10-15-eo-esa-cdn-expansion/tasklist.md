# 实施任务清单：EdgeOne / ESA CDN 能力扩展

Feature Name: 2026-10-15-eo-esa-cdn-expansion
Updated: 2026-10-15
依据: `design.md`（腾讯云 EdgeOne `teo`/`2022-09-01`，阿里云 ESA `2024-09-10`，接口名/字段均以该文件 §3/§4 为准）

> 约定：
> - 新增能力一律以**可选方法**加入 `lib/cdn/types.ts` 的 `CdnProvider`，避免其它 provider 被迫实现（design §六）。
> - 能力门控统一 `typeof provider.X === 'function'`；`cdnConfig` 与 `ADD_FLOW_OVERRIDES` 两处标记需同步（factory.ts）。
> - 写操作后沿用项目既有「Describe 复核」模式；ESA `SiteId` 为 integer、EO `ZoneId` 为 string；ESA 数组/对象参数 `JSON.stringify`。
> - 每阶段末尾为检查点：后端 `tsc --noEmit`、前端 `vue-tsc --noEmit` + `vite build` 通过后，方进入下一阶段并发布一个版本。

## Phase 0 基础修正与接口扩展

- [x] 0.1 修正 EO DNS 记录更新接口名
  - 将 `backend/src/lib/dns/providers/tencenteo.ts` 的 `updateDomainRecord` 由 `ModifyDnsRecord`（单数）改为 `ModifyDnsRecords`（复数），参数按官方 SDK 复数版形态传入（design §5.1）
  - 保留 `CreateDnsRecord`/`DeleteDnsRecords`/`ModifyDnsRecordsStatus` 现状
- [x] 0.2 ESA CDN 端点带 Region 与白名单
  - `backend/src/lib/cdn/providers/AliyunESA.ts` 构造函数改为 `esa.<region>.aliyuncs.com`（region 缺省 `cn-hangzhou`），region 以 `^[a-z0-9-]+$` 白名单校验，非法回退默认（design §2.2/§5.3）
  - `backend/src/lib/cdn/factory.ts` 的 `aliyun_esa` 配置增加 `region`（select：`cn-hangzhou`/`ap-southeast-1`，默认 `cn-hangzhou`）
- [x] 0.3 扩展 `CdnProvider` 可选方法组
  - `backend/src/lib/cdn/types.ts` 增加可选方法：站点、源站组/负载均衡、规则引擎、安全、四层代理、任务/统计/配额 共六组
- [x] 0.4 能力标记同步
  - `backend/src/lib/cdn/factory.ts` 新增 `providerCapabilities()`（按原型方法探测，单一事实来源），`getCdnConfigList()` 附带 `capabilities`；`GET /api/cdn/providers` 改用之
- [x] 0.5 检查点：后端 `tsc --noEmit` 通过（前端 `vue-tsc` 亦通过）

## Phase 1 站点生命周期（EO Zone / ESA Site）

- [x] 1.1 TencentEdgeOne 站点管理方法（design §3.2）
  - `createZone`、`setZonePaused`、`deleteZone`、`identifyZone`、`verifyOwnership`、`checkCnameStatus`、`getZonePaused`
- [x] 1.2 AliyunESA 站点管理方法（design §4.1）
  - `checkSiteName`、`createZone`（CreateSite）、`verifyOwnership`（VerifySite）、`getSiteNs`、`deleteZone`、`updateSiteAccessType`、`updateSiteCoverage`、`setZonePaused`/`getZonePaused`、`updateSiteNameExclusive`/`getSiteNameExclusive`、`listPlanInstances`
- [x] 1.3 路由：站点生命周期端点
  - `backend/src/routes/cdn.ts`：`GET/POST /api/cdn/accounts/:aid/sites`、`.../sites/check`、`.../sites/verify`、`.../sites/pause`、`GET .../sites/:zoneId/ns`、`PUT/DELETE .../sites/:zoneId`、`GET .../plan-instances`（能力门控、管理员）
- [x] 1.4 前端：站点管理 UI
  - `frontend/src/views/CdnAccount.vue` 增加「站点管理」入口与弹窗（列表/创建/校验/暂停/验证/NS/删除）；i18n `cdnSite`（zh/en）
- [x] 1.5 检查点：后端 `tsc --noEmit`、前端 `vue-tsc --noEmit` + `vite build` 通过

## Phase 2 源站组 / 负载均衡

- [x] 2.1 EO 源站组 CRUD（design §3.2/§3.3）
  - `createOriginGroup`/`updateOriginGroup`/`deleteOriginGroup`/`listOriginGroups`（`DescribeOriginGroup` 分页，`Records:OriginRecord[]`，`HostHeader`）
- [x] 2.2 EO 负载均衡 CRUD
  - `createLoadBalancer`（`Type:HTTP|HTTP_V2|GENERAL`、`OriginGroups`、`HealthChecker`、`SteeringPolicy`、`FailoverPolicy`）/`updateLoadBalancer`/`deleteLoadBalancer`/`listLoadBalancers`
- [x] 2.3 ESA 源站池 / 负载均衡（design §4.1）
  - `CreateOriginPool`/`ListOriginPools`/`UpdateOriginPool`/`DeleteOriginPool`、`CreateLoadBalancer`/`ListLoadBalancers`/`UpdateLoadBalancer`/`DeleteLoadBalancer`（数组/对象参数 JSON 化）
- [x] 2.4 路由：源站组/负载均衡端点（能力门控，管理员）
  - `GET/POST/PUT/DELETE /api/cdn/accounts/:aid/origin-groups`、`.../load-balancers`
- [x] 2.5 前端：源站组/负载均衡管理 UI
  - `CdnAccount.vue` 增加「源站与负载均衡」弹窗（站点选择 + 双 Tab 列表/创建/删除）；i18n `cdnOrigin`（zh/en）
- [x] 2.6 检查点：`tsc --noEmit` + `vue-tsc --noEmit` + `vite build` 通过

## Phase 3 规则引擎

- [x] 3.1 EO L7 规则引擎（design §3.2/§3.4）
  - `getRulesSetting`（`DescribeRulesSetting`）、`listRules`（`DescribeRules`）、`createRule`/`updateRule`（`ModifyRule`）/`deleteRules`、`setRulePriority`（`ModifyL7AccRulePriority`）
- [x] 3.2 ESA 12+ 类规则 upsert（design §4.1）
  - `listRuleConfigs`（`List${kind}s`）、`upsertRuleConfig`（List→命中 Update 否则 Create）、`deleteRuleConfig`（`Delete${kind}`）；kind 覆盖重定向/重写/请求头/响应头/入站请求头/入站响应头/自定义响应码/网络优化/压缩/图片/视频/源站/缓存/HTTPS 基础与应用配置；数组/对象参数 `JSON.stringify`
- [x] 3.3 路由：规则引擎端点（能力门控，管理员）
  - EO：`GET .../rules/setting`、`GET/POST/DELETE .../rules`、`PUT .../rules/:ruleId`、`POST .../rules/priority`
  - ESA：`GET/POST .../rule-configs`、`DELETE .../rule-configs/:configId`
- [x] 3.4 前端：规则编辑器
  - `CdnAccount.vue` 增加「规则引擎」弹窗（站点/规则类型选择、列表、JSON 规则内容编辑、新建/编辑/删除）；i18n `cdnRules`（zh/en）
- [x] 3.5 检查点：`tsc --noEmit` + `vue-tsc --noEmit` + `vite build` 通过

## Phase 4 安全能力

- [ ] 4.1 EO 安全（design §3.2）
  - `SecurityIPGroup` CRUD（`CreateSecurityIPGroup{IPGroup:{GroupId:0,Name,Content}}`、`DescribeSecurityIPGroup`（单数）/`Content`/`Info`、`ModifySecurityIPGroup{Mode}`、`DeleteSecurityIPGroup`）
  - `DescribeDDoSProtection`/`ModifyDDoSProtection`
  - `WebSecurityTemplate`（`Create/Modify/DescribeWebSecurityTemplates`）
- [ ] 4.2 ESA 安全（design §4.1）
  - WAF（`CreateWafRule{Phase}`/`BatchCreateWafRules`/`ListWafPhases`）、源站防护（`GetOriginProtection`/`UpdateOriginProtection`）、DDoS（`DescribeHttpDDoSAttackProtection`/`SetHttpDDoSAttackProtection`）
- [ ] 4.3 路由 + 前端：安全配置页（IP 组、DDoS、WAF 模板/规则），i18n
- [ ] 4.4 检查点：`tsc --noEmit` + `vue-tsc --noEmit` + `vite build` 通过

## Phase 5 四层代理、任务与统计增强

- [ ] 5.1 EO 四层代理（design §3.2）
  - `CreateL4Proxy`/`ModifyL4Proxy`/`DeleteL4Proxy`/`DescribeL4Proxy`、`CreateL4ProxyRules`/`DescribeL4ProxyRules`（`Offset`/`Limit` 必填）/`DeleteL4ProxyRules`
- [ ] 5.2 ESA 四层/等候室（design §4.1）
  - `CreateTransportLayerApplication`（列表/更新/删除同族）、`CreateWaitingRoom`
- [ ] 5.3 EO 任务/统计/配额（design §3.2）
  - `DescribePurgeTasks`/`DescribePrefetchTasks`/`DescribeContentQuota`/`DescribeTopL7AnalysisData`/`DescribeTimingL7CacheData`
- [ ] 5.4 ESA 任务/缓存/统计（design §4.1）
  - `DescribePurgeTasks`/`GetPurgeQuota`/`UploadFile`/`ListUploadTasks`/`DescribePreloadTasks`/`CreateScheduledPreloadJob`/`UpdateDevelopmentMode`/`UpdateCacheTag`/`BlockObject`/`UpdateTieredCache`/`DescribeSiteTopData`
- [ ] 5.5 路由 + 前端：四层代理页、任务/配额/统计面板（复用 `CachePurge.vue`/`Statistics.vue` 形态），i18n
- [ ] 5.6 检查点：`tsc --noEmit` + `vue-tsc --noEmit` + `vite build` 通过

## 跨阶段收尾

- [ ] 6.1 更新 `.monkeycode/docs/INTERFACES.md` 与 CDN 模块文档，登记新增可选方法与能力标记
- [ ] 6.2 全量回归：`tsc --noEmit`、`vue-tsc --noEmit`、`vite build`；无库启动冒烟（后端未安装时仍可启动）
- [ ] 6.3 分阶段发布：每个 Phase 结束后按 `node scripts/release.mjs <x.y.z> "..."` 发布并触发镜像构建

## 验收标准

- `CdnProvider` 新增能力全部为可选方法，其它 provider 无需改动即可编译通过。
- EO 与 ESA 各自新增能力仅按 design 中已核验的接口名/字段调用；`ZoneId`(string) 与 `SiteId`(integer) 不混用。
- 所有新增 `/api/cdn/*` 能力端点仅管理员可用，且按 `typeof provider.X === 'function'` 门控，未实现能力的 provider 返回明确「暂不支持」。
- ESA 端点带 region 且 region 经白名单校验；EO DNS 使用复数 `ModifyDnsRecords`。
- 每阶段前端类型检查与生产构建通过，UI 与现有项目风格一致（沿用 `ResponsiveDataTable`，i18n zh/en 对齐）。
