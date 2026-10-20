# EdgeOne / ESA 接入开发规格（已逐字段核验版）

> **本文件的作用**：替换前一版报告中**未经验证**的接口名与参数名，作为后续开发的**唯一依据**。所有接口名、请求字段、必填项、枚举值均从官方数据源**脚本化提取**，可直接照写。
>
> **核验数据源**
> - 腾讯云 EdgeOne：官方 npm SDK `tencentcloud-sdk-nodejs-teo@4.1.326`（`teo` / `v2022-09-01`），**237 个可调用 Action**，含完整 `Request`/`Response` 模型与官方注释中的枚举说明
> - 阿里云 ESA：官方 OpenAPI 元数据 `api.aliyun.com/meta/v1/products/ESA/versions/2024-09-10/api-docs.json`，**473 个 API**，含逐参数 `required` / `enum`
> - 腾讯云操作审计清单：**496 条**（仅作参考，**与 SDK 命名不一致，勿直接采用**）

---

## 一、修正后的总体数据

| 平台 | 官方 API 规模 | 官方可调用（SDK/元数据） | 本项目已实现 | 覆盖率 |
|---|---|---|---|---|
| 腾讯云 EdgeOne | 496（审计清单） | **237**（SDK） | **26**（teo 服务）＋1（SSL 服务） | **11.0%** |
| 阿里云 ESA | 473 | 473 | **18** | **3.8%** |

> 前一版报告写的「~600」「~4.5%」为错误数字，已更正。

---

## 二、通用接入约定（已核验）

### 2.1 腾讯云 EdgeOne

| 项 | 值（核验来源） |
|---|---|
| 端点 | `https://teo.tencentcloudapi.com/`（国内）/ `https://teo.intl.tencentcloudapi.com/`（国际） |
| 服务名 / 版本 | `teo` / `2022-09-01`（SDK 构造函数：`super("teo.tencentcloudapi.com", "2022-09-01", clientConfig)`） |
| 鉴权 | `TC3-HMAC-SHA256`，签名头 `Authorization`；Action 放 Header `X-TC-Action` |
| 分页 | **两套并存**：① `Offset`+`Limit`（`DescribePurgeTasks`/`DescribeOriginGroup`/`DescribeLoadBalancerList`…）② `Offset`+`Limit`+`Filters` |
| 过滤 | `Filters: Array<{Name:string, Values:string[]}>`（部分接口用 `AdvancedFilter`，多一个 `Fuzzy?:boolean`） |
| 限流 | 多数 20 QPS，数据类 100 QPS |

### 2.2 阿里云 ESA

| 项 | 值 |
|---|---|
| 端点 | `https://esa.<RegionId>.aliyuncs.com`（**必须带 Region**，如 `esa.cn-hangzhou.aliyuncs.com`） |
| 版本 | `2024-09-10` |
| 鉴权 | RPC 风格 `HMAC-SHA1`（`Aliyun` 客户端已实现） |
| 分页 | `PageNumber` + `PageSize`，返回 `TotalCount` |
| 数组/对象参数 | 需 `JSON.stringify` 后传入（如 `Fields` / `RecordList` / `Origins`） |
| 限流 | 多数 30 QPS |

---

## 三、腾讯云 EdgeOne

### 3.1 ⚠️ 命名陷阱清单（**开发前必读**）

以下均为「看起来应该叫 A，实际叫 B」的坑，是上一版报告出错的主要原因：

| 你可能想写 | 官方正确名称 |
|---|---|
| `CreateLoadBalancing` / `ModifyLoadBalancing` / `DeleteLoadBalancing` | `CreateLoadBalancer` / `ModifyLoadBalancer` / `DeleteLoadBalancer` |
| `DescribeLoadBalancingList` / `DescribeLoadBalancingDetail` | `DescribeLoadBalancerList` |
| `ModifyZoneStatus{Status}` | `ModifyZoneStatus{**Paused**: boolean}` |
| `CheckCnameStatus{DomainNames}` | `CheckCnameStatus{**RecordNames**}` |
| `DescribeCnameStatus` | `CheckCnameStatus` |
| `DescribeZoneDetails` | `DescribeZones` / `DescribeZoneSetting` |
| `DescribeOriginGroupDetail` | `DescribeOriginGroup` |
| `CreateSecurityIPGroup{IPGroupName,Content}` | `CreateSecurityIPGroup{**IPGroup**: {GroupId,Name,Content}}` |
| `DescribeSecurityIPGroup**s**` | `DescribeSecurityIPGroup`（**单数**） |
| `DescribeDDoSPolicy` / `ModifyDDoSPolicy` / `ModifyDDoSPolicyHost` | `DescribeDDoSProtection` / `ModifyDDoSProtection` |
| `CreateSecurityTemplate` / `ModifySecurityTemplate` / `DescribeSecurityTemplates` | `CreateWebSecurityTemplate` / `ModifyWebSecurityTemplate` / `DescribeWebSecurityTemplates` |
| `ModifyRulePriority` | `ModifyL7AccRulePriority`（另有 `ModifyFunctionRulePriority`） |
| `CreateCustomErrorPage` | `Create**Customize**ErrorPage`（注意 Modify/Delete/Describe 是 `CustomErrorPage`，**词根不对称**） |
| `DescribeTopL7AnalysisData{ZoneId, MetricNames}` | `DescribeTopL7AnalysisData{**ZoneIds**, **MetricName**}`（复数/单数与直觉**相反**） |
| `DescribeTimingL7CacheData{ZoneId}` | `DescribeTimingL7CacheData{**ZoneIds**}` |
| `DescribeRules{Offset,Limit}` | `DescribeRules{**Filters**}`（无 Offset/Limit） |
| `ModifyRule{Rule}` | `ModifyRule{**RuleId**, **Rules**, RuleName, Status}` |
| `ModifyDnsRecord`（项目在用） | SDK 为 **`ModifyDnsRecords`（复数）** ⚠️ 见 §5 |
| `DescribeHostCertificates` / `CheckCertificate` / `ModifyDefaultCertificate` | SDK 中**不存在** |

### 3.2 P0 接口规格（请求字段｜`?` = 可选）

> 数据直接来自 `teo_models.d.ts`，字段顺序与官方一致。

**站点**
- `CreateZone`：`Type?`:string（`partial`=CNAME／`full`=NS／`noDomainAccess`／`dnsPodAccess`／`ai`，默认 partial）、`ZoneName?`:string、`Area?`:string（`global`／`mainland`／`overseas`，默认 overseas）、`PlanId?`:string、`AliasZoneName?`:string、`Tags?`:Tag[]、`AllowDuplicates?`(deprecated)、`JumpStart?`(deprecated) → 返回 `ZoneId`、`OwnershipVerification`
- `ModifyZoneStatus`：`ZoneId`:string、`Paused`:boolean
- `DeleteZone`：`ZoneId`:string
- `DescribeZones`：`Offset?`:number、`Limit?`:number、`Filters?`:AdvancedFilter[]、`Order?`:string、`Direction?`:string → 返回 `TotalCount`
- `IdentifyZone`：`ZoneName`:string、`Domain?`:string → 返回 `Ascription`、`FileAscription`
- `VerifyOwnership`：`Domain`:string → 返回 `Status`、`Result`
- `ImportZoneConfig`：`ZoneId`:string、`Content`:string → 返回 `TaskId`
- `ExportZoneConfig`：`ZoneId`:string、`Types?`:string[] → 返回 `Content`
- `CheckCnameStatus`：`ZoneId`:string、`RecordNames`:string[]

**源站组 / 负载均衡**
- `CreateOriginGroup`：`ZoneId`:string、`Records`:OriginRecord[]、`Name?`:string、`Type?`:string、`HostHeader?`:string → 返回 `OriginGroupId`
- `ModifyOriginGroup`：`ZoneId`、`GroupId`、`Name?`、`Type?`、`Records?`、`HostHeader?`
- `DeleteOriginGroup`：`ZoneId`、`GroupId`
- `DescribeOriginGroup`：`ZoneId?`、`Offset?`、`Limit?`、`Filters?` → `TotalCount`
- `CreateLoadBalancer`：`ZoneId`、`Name`:string、`Type`:string（`HTTP_V2`／`HTTP`／`GENERAL`）、`OriginGroups`:OriginGroupInLoadBalancer[]、`HealthChecker?`、`SteeringPolicy?`（默认 `Pritory`）、`FailoverPolicy?`（`OtherOriginGroup`／`OtherRecordInOriginGroup`）→ 返回 `InstanceId`
- `ModifyLoadBalancer`：`ZoneId`、`InstanceId`、`Name?`、`OriginGroups?`、`HealthChecker?`、`SteeringPolicy?`、`FailoverPolicy?`
- `DeleteLoadBalancer`：`ZoneId`、`InstanceId`
- `DescribeLoadBalancerList`：`ZoneId`、`Offset?`、`Limit?`、`Filters?` → `TotalCount`

**规则引擎**
- `DescribeRules`：`ZoneId`、`Filters?`:Filter[]
- `DescribeRulesSetting`：**无参数**（拉取可选匹配项/动作元数据，用于驱动前端表单）
- `CreateRule`：`ZoneId`、`RuleName`、`Status`:string、`Rules`:Rule[]、`Tags?`:string[] → 返回 `RuleId`
- `ModifyRule`：`ZoneId`、`RuleName`、`Rules`、`RuleId`、`Status`、`Tags?`
- `DeleteRules`：`ZoneId`、`RuleIds`:string[]

**安全**
- `CreateSecurityIPGroup`：`ZoneId`、`IPGroup`:IPGroup → 返回 `GroupId`
- `DescribeSecurityIPGroup`：`ZoneId`、`GroupIds?`:number[]
- `DescribeSecurityIPGroupContent`：`ZoneId`、`GroupId`:number、`Limit?`、`Offset?` → `IPTotalCount`
- `DescribeSecurityIPGroupInfo`：`ZoneId`、`Limit?`、`Offset?` → `TotalCount`
- `ModifySecurityIPGroup`：`ZoneId`、`IPGroup`、`Mode`:string
- `DeleteSecurityIPGroup`：`ZoneId`、`GroupId`:number
- `DescribeDDoSProtection`：`ZoneId` → `DDoSProtection`
- `ModifyDDoSProtection`：`ZoneId`、`DDoSProtection`
- 已有：`DescribeSecurityPolicy` / `ModifySecurityPolicy`（`ZoneId`）

**四层代理**
- `CreateL4Proxy`：`ZoneId`、`ProxyName`:string、`Area`:string、`Ipv6?`、`StaticIp?`、`AccelerateMainland?`、`DDosProtectionConfig?` → 返回 `ProxyId`
- `ModifyL4Proxy`：`ZoneId`、`ProxyId`、`Ipv6?`、`AccelerateMainland?`
- `DeleteL4Proxy`：`ZoneId`、`ProxyId`
- `DescribeL4Proxy`：`ZoneId`、`Offset?`、`Limit?`、`Filters?` → `TotalCount`
- `CreateL4ProxyRules`：`ZoneId`、`ProxyId`、`L4ProxyRules`:L4ProxyRule[]
- `DescribeL4ProxyRules`：`ZoneId`、`ProxyId`、`Offset`(**必填**)、`Limit`(**必填**)、`Filters?`
- `DeleteL4ProxyRules`：`ZoneId`、`ProxyId`、`RuleIds`:string[]

**内容 / 统计**
- `DescribePurgeTasks`：`ZoneId?`、`StartTime?`、`EndTime?`、`Offset?`、`Limit?`、`Filters?`（AdvancedFilter） → `TotalCount`
- `DescribePrefetchTasks`：同上
- `DescribeContentQuota`：`ZoneId`
- `DescribeTopL7AnalysisData`：`StartTime`、`EndTime`、`MetricName`:string、`ZoneIds`:string[]、`Limit?`、`Filters?`(QueryCondition)、`Interval?`、`Area?`
- `DescribeTimingL7CacheData`：`StartTime`、`EndTime`、`MetricNames`:string[]、`ZoneIds?`、`Filters?`、`Interval?`、`Area?`

### 3.3 嵌套模型（**最容易写错的地方**）

```
OriginRecord         : Record:string | Type?:string | RecordId?:string | Weight?:number | Private?:boolean
OriginGroupInLoadBalancer : Priority:string | OriginGroupId:string      ← Priority 是 string
HealthChecker        : Type:string | Port? | Interval? | Timeout? | HealthThreshold? | CriticalThreshold?
                       | Path? | Method? | ExpectedCodes?:string[] | Headers? | FollowRedirect?
                       | SendContext? | RecvContext? | ProbeCluster?
IPGroup              : GroupId:number | Name:string | Content:string[]  ← 建组时 GroupId 传 0 即可（SDK 声明为必填）
Rule                 : Conditions:RuleAndConditions[] | Actions?:Action[] | SubRules?:SubRuleItem[]
L4ProxyRule          : RuleId? | Protocol? | PortRange?:string[] | OriginType? | OriginValue?:string[]
                       | OriginPortRange? | ClientIPPassThroughMode? | SessionPersist? | SessionPersistTime?
                       | RuleTag? | Status? | BuId?
Filter               : Name:string | Values:string[]
AdvancedFilter       : Name:string | Values:string[] | Fuzzy?:boolean
QueryCondition       : Key:string | Operator:string | Value:string[]
Tag                  : TagKey:string | TagValue:string
DDosProtectionConfig : LevelMainland?:string | MaxBandwidthMainland?:number | LevelOverseas?:string
```

### 3.4 已核验代码模板（可直接落地）

```ts
// ===== 站点 =====
async createZone(zoneName: string, type: 'partial' | 'full' = 'partial',
                 area: 'global' | 'mainland' | 'overseas' = 'overseas', planId?: string) {
  const d = await this.send('CreateZone', { ZoneName: zoneName, Type: type, Area: area, PlanId: planId });
  return d ? d.ZoneId : false;                       // 未传 PlanId 时站点处于 init 未激活态
}
async setZonePaused(zoneId: string, paused: boolean) {
  return (await this.send('ModifyZoneStatus', { ZoneId: zoneId, Paused: paused })) !== false;
}
async identifyZone(zoneName: string, domain?: string) {
  return this.send('IdentifyZone', { ZoneName: zoneName, Domain: domain });   // → Ascription
}
async verifyOwnership(domain: string) {
  return this.send('VerifyOwnership', { Domain: domain });                    // → Status/Result
}
async checkCnameStatus(zoneId: string, recordNames: string[]) {
  return this.send('CheckCnameStatus', { ZoneId: zoneId, RecordNames: recordNames });
}

// ===== 源站组 / 负载均衡 =====
async createOriginGroup(zoneId: string, name: string, type: string,
                        records: { Record: string; Type?: string; Weight?: number }[]) {
  const d = await this.send('CreateOriginGroup', { ZoneId: zoneId, Name: name, Type: type, Records: records });
  return d ? d.OriginGroupId : false;
}
async createLoadBalancer(zoneId: string, name: string, type: 'HTTP' | 'HTTP_V2' | 'GENERAL',
                         groups: { Priority: string; OriginGroupId: string }[]) {
  const d = await this.send('CreateLoadBalancer', { ZoneId: zoneId, Name: name, Type: type, OriginGroups: groups });
  return d ? d.InstanceId : false;
}

// ===== 规则引擎 =====
async describeRulesSetting() { return this.send('DescribeRulesSetting', {}); }
async listRules(zoneId: string, filters?: { Name: string; Values: string[] }[]) {
  return this.send('DescribeRules', { ZoneId: zoneId, Filters: filters });
}
async createRule(zoneId: string, ruleName: string, status: string, rules: any[]) {
  const d = await this.send('CreateRule', { ZoneId: zoneId, RuleName: ruleName, Status: status, Rules: rules });
  return d ? d.RuleId : false;
}
async modifyRule(zoneId: string, ruleId: string, ruleName: string, status: string, rules: any[]) {
  return (await this.send('ModifyRule', { ZoneId: zoneId, RuleId: ruleId, RuleName: ruleName, Status: status, Rules: rules })) !== false;
}
async deleteRules(zoneId: string, ruleIds: string[]) {
  return (await this.send('DeleteRules', { ZoneId: zoneId, RuleIds: ruleIds })) !== false;
}

// ===== 安全 IP 组 =====
async createSecurityIPGroup(zoneId: string, name: string, content: string[]) {
  const d = await this.send('CreateSecurityIPGroup', { ZoneId: zoneId, IPGroup: { GroupId: 0, Name: name, Content: content } });
  return d ? d.GroupId : false;
}

// ===== 四层代理 =====
async createL4Proxy(zoneId: string, proxyName: string, area: string) {
  const d = await this.send('CreateL4Proxy', { ZoneId: zoneId, ProxyName: proxyName, Area: area });
  return d ? d.ProxyId : false;
}
async createL4ProxyRules(zoneId: string, proxyId: string, rules: any[]) {
  return (await this.send('CreateL4ProxyRules', { ZoneId: zoneId, ProxyId: proxyId, L4ProxyRules: rules })) !== false;
}

// ===== 任务 / 统计 =====
async listPurgeTasks(zoneId: string, offset = 0, limit = 20) {
  return this.send('DescribePurgeTasks', { ZoneId: zoneId, Offset: offset, Limit: limit });
}
async topL7Analysis(zoneIds: string[], startTime: string, endTime: string, metricName: string) {
  return this.send('DescribeTopL7AnalysisData', {
    ZoneIds: zoneIds, StartTime: startTime, EndTime: endTime,
    MetricName: metricName, Limit: 10, Interval: 'hour',
  });
}
```

---

## 四、阿里云 ESA

### 4.1 P0 接口规格（`**必填**` 已标注）

**站点**
| 接口 | 请求 |
|---|---|
| `CreateSite` | `SiteName`**必填**:string、`Coverage`**必填**（`global`\|`domestic`\|`overseas`）、`AccessType`**必填**（`NS`\|`CNAME`）、`InstanceId`**必填**:string（套餐实例 ID，可由 `ListUserRatePlanInstances` 获取）、`ResourceGroupId?`、`ResourceOwner?` → 返回 `SiteId`、`NameServerList`、`VerifyCode` |
| `CheckSiteName` | `SiteName`**必填** → `Passed` |
| `VerifySite` | `SiteId`**必填**:integer → `Passed` |
| `GetSiteCurrentNS` | `SiteId`**必填** → `NSList` |
| `DeleteSite` | `SiteId`**必填** |
| `UpdateSiteAccessType` | `SiteId`**必填**、`AccessType`**必填**（`NS`\|`CNAME`） |
| `UpdateSiteCoverage` | `SiteId`**必填**、`Coverage`**必填** |
| `UpdateSitePause` / `GetSitePause` | `SiteId`**必填** ; `Paused`:boolean |
| `UpdateSiteNameExclusive` / `GetSiteNameExclusive` | `SiteId`**必填** ; `Enable`**必填**（`on`\|`off`） |

**DNS / SaaS 域名**
| 接口 | 请求 |
|---|---|
| `BatchCreateRecords` | `SiteId`**必填**、`RecordList`**必填**(array) |
| `ExportRecords` | `SiteId`**必填** → `Content` |
| `UpdateCnameFlattening` | `SiteId`**必填**、`FlattenMode`**必填**（`flatten_all`\|`flatten_at_root`\|`flatten_off`） |
| `CreateCustomHostname` | `Hostname`**必填**、`SiteId`**必填**、`RecordId`**必填**、`SslFlag`**必填**（`on`\|`off`）、`CertType?`（`free`\|`upload`\|`cas`）、`Certificate?`、`PrivateKey?`、`CasId?`、`CasRegion?` → `HostnameId` |
| `VerifyCustomHostname` | `HostnameId`**必填**（**无 SiteId 参数**） |
| `ApplyCustomHostnameCertificate` | `HostnameId`**必填** |
| `ListCustomHostnames` | `SiteId`**必填**、`RecordId?`、`Hostname?`、`NameMatchType?`、`Status?`、`PageNumber?`、`PageSize?` → `TotalCount`、`Hostnames` |

**证书**
| 接口 | 请求 |
|---|---|
| `ApplyCertificate` | `SiteId`**必填**、`Domains`**必填**:string、`Type?`、`AlgType?`（`RSA`\|`ECDSA`） → `Result` |
| `GetCertificate` / `DeleteCertificate` | `SiteId`**必填**、`Id`**必填** |
| `ListCertificatesByRecord` | `SiteId`**必填**、**`RecordName`必填**、`ValidOnly?`、`Detail?` → `Result` |
| `SetCertificate` | `SiteId`**必填**、`Type`**必填**（`cas`\|`upload`\|`keyless`\|`legacy`）、`Name?`、`CasId?`、`Certificate?`、`PrivateKey?`、`Region?`、`Id?`、`KeyServerId?` → `Id` |
| `GetCertificateQuota` | `SiteId`**必填**、`Type`**必填** → `Quota`、`QuotaUsage` |
| `ListCiphers` | `CiphersGroup`**必填** |

**缓存**
| 接口 | 请求 |
|---|---|
| `DescribePurgeTasks` | `SiteId?`、`Content?`、`Type?`（`file`\|`directory`\|`ignoreparams`\|`hostname`\|`purgeall`\|`cachetag`\|`cachekey`）、`PageNumber?`、`PageSize?`、`StartTime?`、`EndTime?`、`Status?`（`Complete`\|`Refreshing`\|`Failed`） → `TotalCount`、`Tasks` |
| `GetPurgeQuota` | `SiteId`**必填**、`Type`**必填** → `Quota`、`Usage`、`Quota30Day`、`Usage30Day` |
| `UploadFile` | `SiteId`**必填**、`Url`**必填**、`Type`**必填**（`file`\|`preload`\|`directory`\|`ignoreparams`）、`UploadTaskName`**必填** → `UploadId` |
| `ListUploadTasks` | `SiteId?`、`StartTime?`、`EndTime?`、`Type?` → `Tasks` |
| `DescribePreloadTasks` | `SiteId?`、`Content?`、`PageNumber?`、`PageSize?`、`StartTime?`、`EndTime?`、`Status?` → `TotalCount`、`Tasks` |
| `CreateScheduledPreloadJob` | `InsertWay`**必填**（`textBox`\|`oss`）、`Name`**必填**、`SiteId`**必填**、`OssUrl?`、`UrlList?` |
| `UpdateDevelopmentMode` | `SiteId`**必填**、`Enable`**必填** |
| `UpdateCacheTag` | `SiteId`**必填**、`TagName?`、`CaseInsensitive?`、`SiteVersion?` |
| `BlockObject` | `SiteId`**必填**、`Type`**必填**（`block`\|`unblock`）、`Content`**必填**(array)、`Maxage?` → `TaskId` |
| `UpdateTieredCache` | `SiteId`**必填**、`CacheArchitectureMode`**必填**（`edge`\|`edge_smart`\|`edge_regional`\|`edge_regional_smart`） |

**规则引擎（12 类统一形态）**

> 所有 `Create*Rule` / `Create*Configuration` 均返回 `ConfigId`；更新用 `Update*`（必带 `SiteId` + `ConfigId`）；列表用 `List*`（返回 `Configs`）；删除用 `Delete*`（`SiteId` + `ConfigId`）。
> **通用可选字段**：`SiteVersion?`、`RuleName?`、`RuleEnable?`（`on`\|`off`）、`Rule?`（表达式）、`Sequence?`

| 规则类型 | `Create*` 必填（除通用外） |
|---|---|
| `CreateRedirectRule` | `SiteId`、`Type`（`static`\|`dynamic`）、`TargetUrl`、**`StatusCode`**（`301`\|`302`\|`303`\|`307`\|`308`）、`ReserveQueryString`（`on`\|`off`） |
| `CreateRewriteUrlRule` | `SiteId`（＋`RewriteUriType`/`Uri`/`RewriteQueryStringType`/`QueryString` 可选） |
| `CreateHttpRequestHeaderModificationRule` | `SiteId`、`RequestHeaderModification`(array) |
| `CreateHttpResponseHeaderModificationRule` | `SiteId`、`ResponseHeaderModification`(array) |
| `CreateHttpIncomingRequestHeaderModificationRule` | `SiteId`、`RequestHeaderModification`(array) |
| `CreateHttpIncomingResponseHeaderModificationRule` | `SiteId`、`ResponseHeaderModification`(array) |
| `CreateCustomResponseCodeRule` | `SiteId`、`ReturnCode`、`PageId` |
| `CreateNetworkOptimization` | 仅 `SiteId`（`SmartRouting`/`Http2Origin`/`Websocket`/`Grpc`/`UploadMaxFilesize` 可选） |
| `CreateCompressionRule` | 仅 `SiteId`（`Gzip`/`Brotli`/`Zstd` 可选） |
| `CreateImageTransform` | 仅 `SiteId`（`Enable`/`AutoWebp`/`AutoAvif` 可选） |
| `CreateVideoProcessing` | 仅 `SiteId`（`VideoSeekEnable`/`FlvVideoSeekMode`/`Mp4SeekStart`… 可选） |
| `CreateOriginRule` | 仅 `SiteId`（`OriginHost`/`OriginScheme`/`OriginSni`/`DnsRecord`/`OriginHttpPort`/`OriginHttpsPort`/`Follow302*` 可选） |
| `UpdateCacheRule` | `SiteId`、`ConfigId`（其余 30+ 字段全部可选，见官方） |
| `CreateHttpsBasicConfiguration` / `CreateHttpsApplicationConfiguration` | `SiteId` |

**安全 / 流量 / 其他（P1）**
- WAF：`CreateWafRule`（`SiteId`、`Phase`**必填**）、`BatchCreateWafRules`、`ListWafPhases`（`SiteId`**必填**）
- 源站防护：`GetOriginProtection` / `UpdateOriginProtection`（`SiteId`）
- DDoS：`DescribeHttpDDoSAttackProtection` / `SetHttpDDoSAttackProtection`
- 源地址池 / 负载均衡：`CreateOriginPool`（`Name`**必填**、`SiteId`**必填**）、`ListOriginPools`、`CreateLoadBalancer`、`ListLoadBalancers`、`ListLoadBalancerOriginStatus`
- 等候室：`CreateWaitingRoom`；四层代理：`CreateTransportLayerApplication`
- 网络：`UpdateIPv6`、`CreateUrlObservation`、`DescribeUrlObservationData`
- 分析日志：`DescribeSiteTopData`（`Fields`**必填**；`Limit` 枚举 `5|10|15|100|150|999|300`）、`DescribeSiteLogs`、`CreateSiteDeliveryTask`
- 边缘存储：`CreateKvNamespace`、`PutKv`
- 工具/计费：`ListESAIPInfo`、`ListUserRatePlanInstances`、`ListInstanceQuotas`

### 4.2 已核验代码模板

```ts
// ===== 站点（四项必填）=====
async createSite(siteName: string, coverage: 'global' | 'domestic' | 'overseas',
                 accessType: 'NS' | 'CNAME', instanceId: string) {
  const d = await this.call({
    Action: 'CreateSite', SiteName: siteName, Coverage: coverage,
    AccessType: accessType, InstanceId: instanceId,
  });
  return d ? { siteId: d.SiteId as number, nameServers: d.NameServerList } : false;
}
async verifySite(siteId: number) { return (await this.call({ Action: 'VerifySite', SiteId: siteId })) !== false; }
async updateSitePause(siteId: number, paused: boolean) {
  return (await this.call({ Action: 'UpdateSitePause', SiteId: siteId, Paused: paused })) !== false;
}
async updateCnameFlattening(siteId: number, mode: 'flatten_all' | 'flatten_at_root' | 'flatten_off') {
  return (await this.call({ Action: 'UpdateCnameFlattening', SiteId: siteId, FlattenMode: mode })) !== false;
}

// ===== DNS / 证书 =====
async batchCreateRecords(siteId: number, records: any[]) {
  return (await this.call({ Action: 'BatchCreateRecords', SiteId: siteId, RecordList: JSON.stringify(records) })) !== false;
}
async applyCertificate(siteId: number, domains: string, algType: 'RSA' | 'ECDSA' = 'RSA') {
  return this.call({ Action: 'ApplyCertificate', SiteId: siteId, Domains: domains, AlgType: algType });
}
async listCertificatesByRecord(siteId: number, recordName: string) {
  return this.call({ Action: 'ListCertificatesByRecord', SiteId: siteId, RecordName: recordName });
}

// ===== 任务 =====
async getPurgeQuota(siteId: number, type: 'file' | 'directory' | 'purgeall' | 'preload') {
  return this.call({ Action: 'GetPurgeQuota', SiteId: siteId, Type: type });
}
async listPurgeTasks(siteId: number, page = 1, size = 20) {
  return this.call({ Action: 'DescribePurgeTasks', SiteId: siteId, PageNumber: page, PageSize: size });
}

// ===== 规则引擎（以重定向规则为例，其余 11 类同构）=====
private async findRule(kind: string, siteId: number, ruleName: string) {
  const list = await this.call({ Action: `List${kind}s`, SiteId: siteId, PageNumber: 1, PageSize: 100 });
  return (list?.Configs || []).find((c: any) => c.RuleName === ruleName);
}
async upsertRedirectRule(siteId: number, r: {
  RuleName: string; Rule?: string; RuleEnable?: 'on' | 'off';
  Type: 'static' | 'dynamic'; TargetUrl: string;
  StatusCode: '301' | '302' | '303' | '307' | '308'; ReserveQueryString: 'on' | 'off';
}) {
  const exist = await this.findRule('RedirectRule', siteId, r.RuleName);
  if (exist) {
    return (await this.call({ Action: 'UpdateRedirectRule', SiteId: siteId, ConfigId: exist.ConfigId, ...r })) !== false;
  }
  return (await this.call({ Action: 'CreateRedirectRule', SiteId: siteId, ...r })) !== false;
}
```

---

## 五、项目侧待修正项（顺带发现）

1. **`ModifyDnsRecord`（单数）在官方 SDK 中名为 `ModifyDnsRecords`（复数）。**
   项目 `lib/dns/providers/tencenteo.ts:109` 调用的是单数版。官方 SDK 的 DNS 记录族为：`CreateDnsRecord`（单数）、`DescribeDnsRecords`、**`ModifyDnsRecords`（复数）**、`ModifyDnsRecordsStatus`、`DeleteDnsRecords`。
   → **建议实测**该接口是否返回 `InvalidAction`；若是，改为复数版。

2. **`DescribeCertificates` 是跨服务调用**（`ssl.tencentcloudapi.com` / `2019-12-05`），项目实现正确，但它不属于 teo 接口统计。

3. **ESA 端点建议带 Region**：`lib/cdn/providers/AliyunESA.ts:18` 用的是裸域名 `esa.aliyuncs.com`；同项目 `lib/dns/providers/aliyunesa.ts:13` 已正确使用 `esa.<region>.aliyuncs.com`。建议统一，并对 `region` 做 `^[a-z0-9-]+$` 白名单校验。

---

## 六、开发前检查清单

- [ ] 所有接口名先在本文件 §3.1 / §4.1 中查表，**不要凭记忆或凭审计清单命名**
- [ ] EO 写操作后调用对应 `Describe*` 复核（沿用项目 `findZone` / `findEdgeOneL7Rule` 既有模式）
- [ ] EO 分页注意 `Offset/Limit`，`Limit` 上限 1000，建议每页 100~200
- [ ] ESA 数组/对象参数一律 `JSON.stringify`
- [ ] ESA `SiteId` 是 **integer**（不是 string）；EO 的 `ZoneId` 是 **string** —— 两者不要混
- [ ] ESA 规则类走「List → 命中则 Update、否则 Create」的 upsert 模式（本项目 Cloudflare 页同款）
- [ ] 每个新接口落地前，用**腾讯云 API Explorer / 阿里云 OpenAPI 调试台**跑一次真实调用验证
- [ ] 新接口一律以**可选方法**加入 `CdnProvider` 接口（沿用 `purge?` / `getAccess?` 既有风格），避免其它 provider 被迫实现

---

*本规格中所有接口名、请求字段、必填标记、枚举值均由脚本从官方 SDK / OpenAPI 元数据提取，可与官方文档逐字对齐。*
