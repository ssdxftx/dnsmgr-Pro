# API 与依赖检查报告

- 检查日期：2026-10-08
- 范围：后端所有调用外部云厂商/服务商 API 的模块，以及前后端依赖版本
- 方式：通读核心签名客户端与关键 provider，联网核对厂商官方文档；对原项目 netcccyun/dnsmgr 做逐模块 API 对比（见「原项目对比」章节）
- 说明：CDN 模块的能力来自 multi-cloud-cdn（阔彩 CDN），不属于本次与原项目对比范围，但仍纳入基础 API 检查

---

## 一、高风险：疑似错误

### 1. 阿里云 ESA 签名客户端（已更正：非错误）

初版基于联网资料判断「ESA（`2024-09-10`）新发布产品只能用 V3 签名」，怀疑 `dns/providers/aliyunesa.ts`、`cdn/providers/AliyunESA.ts`、`cdn/statistics/aliyunEsa.ts`、`deploy/providers/aliyun.ts` 使用老 RPC V1 客户端有误。

与原项目核对后更正：原项目 `app/lib/dns/aliyunesa.php:28` 与 `app/lib/deploy/aliyun.php:280` **同样使用 V1 `Aliyun` 客户端**处理 ESA，且原项目为长期可用版本。因此当前实现与原项目一致，ESA 走 V1 不构成错误。真正的问题是第 2 项「阿里云 V1 客户端 GET 丢弃参数」。

### 2. percentEncode 编码错误

以下三处的实现相同：

- `backend/src/lib/clients/Aliyun.ts:3-6`
- `backend/src/lib/clients/HuaweiCloud.ts:5-7`
- `backend/src/lib/clients/Volcengine.ts:5-7`

```js
encodeURIComponent(str).replace(/%2B/g, '%20').replace(/%2A/g, '%2A').replace(/%7E/g, '~')
```

问题：

- `%2B`（即 `+`）被改写成 `%20`（空格）。官方规范中 `+` 对应 `%2B`；「把 `+` 换成 `%20`」是 Java `URLEncoder` 把空格编成 `+` 之后的补偿动作，Node 的 `encodeURIComponent` 已把空格编成 `%20`，此处替换方向反了（官方示例：https://help.aliyun.com/zh/document_detail/2925843.html）
- `.replace(/%2A/g, '%2A')` 为恒等替换，无效果；`encodeURIComponent` 不转义 `*`，导致 `*` 未编码为 `%2A`

影响场景：签名参数值含 `+`（证书 PEM 全文，如 `SetDomainCertificate`、`SetVodDomainCertificate`）或 `*`（通配符解析记录的 RR/Value）时，会出现 `SignatureDoesNotMatch`。

建议：按 RFC3986 处理，至少 `.replace(/\*/g, '%2A')`，并去掉 `%2B` 到 `%20` 的替换。

---

## 二、中风险：需关注

- 华为云 CDN（`cdn/providers/HuaweiCDN.ts`）：官方接口列表标注「历史 API，未来部分接口会被弃用」，且 CDN 文档多数要求 `X-Auth-Token`，项目走 AK/SK 直签，需跟进弃用与鉴权方式
- Google 证书 EAB 依赖第三方接口 `https://gts.rat.dev/eab`（`cert/providers/google.ts:37`），非 Google 官方接口，存在失效风险；官方途径为 `publicca.googleapis.com` 或控制台
- 依赖版本落后大版本（属升级建议）：
  - 前端：`vue-router ^4.3` 对应 5.x、`pinia ^2.1.7` 对应 4.x、`vue-tsc ^2` 对应 3.x、`typescript ^5.5` 对应 7.x、`naive-ui 2.39` 对应 2.45
  - 后端：`mysql2 ^3.11` 对应 3.24、`bcryptjs ^2.4` 对应 3.x（含破坏性变更）
- 阿里云邮件 DM（`monitor/msgNotice.ts:51`，`dm 2015-11-23` + V1 签名）仍为老机制

---

## 三、已确认正常

- 核心签名：腾讯云 TC3-HMAC-SHA256、AWS SigV4、Cloudflare v4（Token/GlobalKey 双模式）、ACMEv2 符合 RFC8555
- 阿里云：Alidns `2015-01-09`、CDN `2018-05-10`、CAS `2020-04-07` 均为现行版本/Action
- 腾讯云：DNSPod `2021-03-23`、CDN `2018-06-06`、EdgeOne(teo) `2022-09-01`、SSL `2019-12-05` 均现行
- Cloudflare 规则引擎使用的 8 类 phase 与 `/rulesets` API 现行，未使用已废弃的 `firewall/rules`、`filters` API
- 证书：Let's Encrypt（`acme-v02.api.letsencrypt.org`）、ZeroSSL（`acme.zerossl.com/v2/DV90`）目录现行
- 通知：WxPusher、Telegram、钉钉、企微、飞书（交互卡片 schema 2.0）、自定义 Webhook 接口均现行
- 前端：`vite.config.ts` 的 `allowedHosts` 与 `/api` 反向代理配置正确；`src/api.ts` 鉴权与错误处理正常

---

## 四、存疑未确认

- 49 个部署商中除 AWS/阿里云/腾讯云/华为云/宝塔/NPM/群晖外的部分小众面板未逐一以官方文档核验
- Huawei CDN、火山引擎 CDN、网宿/白山/CDNetworks 的具体 Action 建议用真实账号回归

---

## 原项目对比（netcccyun/dnsmgr）

- 参照物：原项目 PHP 版（ThinkPHP），已克隆到 `/tmp/dnsmgr-orig`
- 范围：DNS、证书、ACME、部署、签名客户端、邮件/通知、Cloudflare 增强、优选 IP、到期提醒、定时任务、QQ 机器人；CDN 模块来自 multi-cloud-cdn，不在本节范围
- 方式：按同名文件成对阅读，逐项比对 endpoint、API 版本、接口名、参数名、签名算法与请求流程
- 判定：「已复核」为本次人工再次打开两侧源码确认；「子代理发现」为自动成对比对结果，建议复核后修复

### A. 高优先级确定性错误（已复核）

1. 签名日期格式错误（影响整平台鉴权）
   - 原 PHP 使用紧凑 UTC 格式 `gmdate("Ymd\THis\Z")`（`20261008T120000Z`）
   - 当前 TS 使用 `new Date().toISOString()`，得到带 `-` 与 `:` 的 `20261008T120000Z` 变体（`2026-10-08T12:00:00Z`），且 `slice(0,8)` 会得到 `2026-10-`，令 credentialScope 非法
   - 位置：
     - `clients/HuaweiCloud.ts:45`（`X-Sdk-Date`）与 `:80`（stringToSign）：华为云 DNS/CDN/部署/证书全部签名失败
     - `clients/Jdcloud.ts:51` 与 `:81`：京东云 DNS 签名失败
     - `clients/Volcengine.ts:53` 与 `:80`：火山引擎 DNS/CDN/部署签名失败
   - 参照：原 `client/HuaweiCloud.php:43,85`、`client/Jdcloud.php:53,94`、`client/Volcengine.php:64,144`；同目录 `Ksyun.ts:33`、`deploy/providers/huoshan.ts:32` 已正确处理，可作修法参照

2. 阿里云 V1 客户端 GET 丢失参数
   - 原 `client/Aliyun.php:46-48` 在 GET 时把参数拼到 URL：`$url .= '?'.http_build_query($data)`
   - 当前 `clients/Aliyun.ts:34-40` 在 GET 时不拼 query、也不发 body，等于发出无签名参数的空请求
   - 影响：`dns/providers/aliyunesa.ts:36,87,94` 的 `ListSites`/`ListRecords`/`GetRecord`，以及 `deploy/providers/aliyun.ts` 中走 GET 的 ESA/WAF 系列调用全部失败

3. percentEncode 编码错误（多客户端）
   - 原 PHP `urlencode` 后替换 `+`→`%20`、`*`→`%2A`、`%7E`→`~`（PHP 里 `urlencode` 把空格编成 `+`，故此处替换正确）
   - 当前 TS 用 `encodeURIComponent`（空格已是 `%20`、`*` 保持字面量），再执行 `%2B`→`%20`（把字面 `+` 变成空格）与 `%2A`→`%2A`（空操作），导致 `+`、`*` 编码与服务端不一致
   - 位置：`clients/Aliyun.ts:3-6`、`clients/AliyunNew.ts:87-92`、`clients/HuaweiCloud.ts:5-7`、`clients/Volcengine.ts:5-7`、`clients/Jdcloud.ts:5-7`、`clients/BaiduCloud.ts:5-7`
   - 典型触发：阿里云 `UploadUserCertificate` 的 `Cert`/`Key`（PEM 必含 `+`）、`deploy_api`/`deploy_vod` 的证书内容；含 `*` 的通配符记录（RR 或 Value）

4. Cloudflare 记录解析与写入偏差
   - 解析（`dns/providers/cloudflare.ts:59-77`）：当前对 `MX` 把 priority 前缀拼进 content，且缺少 `SRV` 的 priority 拼接；原 `dns/cloudflare.php:111-113` 只对 `SRV` 拼接、MX 从不拼接 → MX 展示为 `"10 mail.x"`，SRV 丢失 priority
   - 写入（`cloudflare.ts:104-123`）：当前缺 `CAA`/`SRV` 的 `data` 对象转换与 `REDIRECT_URL`/`FORWARD_URL`→`URI` 的类型转换；原 `cloudflare.php:173-178,186-191` 有完整处理 → CAA/SRV 创建被拒、URL 记录类型无法识别
   - 暂停/启用（`cloudflare.ts:134-137`）：当前直接返回不支持；原 `cloudflare.php:209-221` 用 `_pause` 后缀实现 → 前端状态开关对 Cloudflare 失效
   - 相关：原 `cloudflare.php:108-110,146` 用 `_pause` 推导 Status，当前恒为 `'1'`；原 `cloudflare.php:32-47` 用 `idn_to_ascii` 处理 punycode，当前 `extractName` 未处理

5. PowerDNS 写操作空响应解析失败
   - `dns/providers/powerdns.ts:50` 无条件 `await res.json()`；PowerDNS `PATCH /zones/{id}` 返回 `204 No Content`，`res.json()` 抛异常被 catch 吞掉 → add/update/delete/status 全部返回 false
   - 修法：先取 `res.text()`，非空再 `JSON.parse`，或按状态码分支

6. 优选 IP 逻辑反转与缺 AWS 映射
   - 反转：原 `service/OptimizeService.php:211` 为 `type==1 && DEF 非空 → type=0`；当前 `optimize/optimizeService.ts:199` 写成 `type===1 && (DEF 缺失) → type=0`，条件取反 → 电信 IP 被写到错误线路
   - 缺映射：原 `lib/DnsHelper.php:884` 的 `LINE_NAME` 含 `'aws'=>['DEF'=>'default']`，当前 `optimize/optimizeService.ts:7-27` 缺 `aws`，`:189` 对 AWS Route53 任务抛「不支持的DNS服务商」

7. 火山引擎证书 provider 整体缺失
   - 原 `app/lib/cert/huoshan.php`（endpoint `open.volcengineapi.com`，service `certificate_service`，version `2021-06-01`）
   - 当前无 `cert/providers/huoshan.ts`，且 `cert/factory.ts` 的 `certConfig` 与 `providerMap` 未注册 huoshan → 类型为 huoshan 的证书账户不可用

### B. 其他确定性错误（子代理发现，建议复核）

- 京东云：`dns/providers/jdcloud.ts:86-93,95-101` 缺 SRV 值拆分（原 `jdcloud.php:129-135`）；`:122-124` `addDomain` 缺 `packId:0`（原 `jdcloud.php:230-235`）；`:86,95` 默认 Line 为 `-1`，原为 `'0'`
- DNSLA：`dns/providers/dnsla.ts:51` DELETE 用 JSON body 传参，原 `dnsla.php:242-248` DELETE 走 query
- Technitium：`dns/providers/technitium.ts` 缺 APP 类型「先删后加」更新分支与 `updateDomainRecordRemark`（原 `technitium.php:331-340,363-385`）
- DNSPod：`dns/providers/dnspod.ts:61-101` 丢失 `DescribeRecordFilterList` 过滤分支（Status/Value 被静默忽略，前端 `routes/domain.ts:272,275` 确实传参）；`:170-177` 线路列表丢失 `DescribeRecordLineCategoryList` 层级
- 华为云 DNS：`dns/providers/huawei.ts:143-151` 线路列表硬编码为 5 条，原 `huawei.php:193-207` 读取全量线路数据
- 百度云：`dns/providers/baidu.ts:10` 与 `factory.ts:112-113` 用 `accessKeyId`/`secretAccessKey`，原 `DnsHelper.php:123-134` 及其他厂商统一为 `AccessKeyId`/`SecretAccessKey`，存量账户配置会读不到
- 宝塔 Windows：`deploy/providers/btwin.ts:30,98` 把 PFX 用 `toString('binary')` 存入 Blob，再按 UTF-8 重编码导致字节损坏；原 `btwin.php:67` 直接传二进制
- Kubernetes：`deploy/providers/k8s.ts:95-96` 把证书「文件路径」作为 `cert`/`key` 传给 `https.request`，Node 只接受 PEM 内容 → 使用 `client-certificate-data` 的 kubeconfig 连接失败
- SSH：`deploy/providers/ssh.ts:86-116` 缺 IIS 部署分支（原 `ssh.php:64-68,80-99` 的 `certutil` 导入与 `netsh` 绑定）
- Content-Type 缺失：`deploy/providers/cdnfly.ts:28-32`（登录 JSON）、`mwpanel.ts:19-40`（表单）、`xp.ts:17-31`（JSON）未设置 `Content-Type`，部分面板无法解析请求体
- 腾讯云证书吊销：`cert/providers/tencent.ts:120-122` 未处理 `RevokeDomainValidateAuths` 并写入 TXT 验证记录（原 `tencent.php:159-169`）
- 系统代理（proxy=1）在证书模块与多数 provider 缺失：原 PHP 在 `ACMEv2.php`、`google.php`、`zerossl.php`、云客户端等处调用 `curl_set_proxy`；当前 TS 仅实现反向代理（proxy=2），裸 `fetch` 未注入代理。仓库已有 `lib/proxy.ts:23 getConfiguredProxyAgent()` 可复用
- 阿里云线路码转换：`dns/providers/aliyun.ts:102-115` 缺原 `aliyun.php:335-342` 的 `convertLineCode()`（`'0'→'default'`、`'10=1'→'unicom'` 等）

### C. 行为差异（设计变更，建议确认调用方已适配）

- `getRecordLine` 返回结构由 `code => {name,parent}` 统一改为 `name => code`（`dns/types.ts:71`），个别处丢失 parent 信息（dnsla、goedge）
- `addDomain` 返回由 `{id,name}` 改为 `boolean`（当前无调用方，暂不影响）
- TS 接口精简：`getSubDomainRecords`、`getDomainRecordLog`、`getDomainInfo`、`getMinTTL`、`getDomainPurview`、`getRecordGroups`、`changeRecordGroup`、权重相关方法等未迁移；`certDns.ts` 改用 `getDomainRecords(subdomain)` 替代
- 硬编码线路：`dns/providers/{jdcloud,huoshan}.ts` 与 `huawei.ts` 返回固定线路，原项目按套餐动态获取
- 阿里云优选记录筛选：`optimize/optimizeService.ts:195` 用通用 `getDomainRecords(...,SubDomain)`，阿里云实现走 `DescribeDomainRecords + SearchMode=ADVANCED/RRKeyWord`（`dns/providers/aliyun.ts:53-59`）；原项目用 `DescribeSubDomainRecords` 精确子域，存在模糊匹配风险
- QingCloud：原 `qingcloud.php` 透传 `mode`（1/2/3），当前 `qingcloud.ts:192-200` 固定 mode=1，仅 Weight>0 时用 3
- SSRF 防护：`acme/ACMEv2.ts:258` 每次请求前 `assertUrlAllowed`，内网自建 ACME（customacme）默认被拦，需设 `DNSMGR_ALLOW_PRIVATE_FETCH=1`
- 严格比较、User-Agent 缺失、证书名未取整、TLS 校验开启（原 `SSL_VERIFYPEER=false`）、邮件缺 `Reply-To` 等次要差异
- `client/Ctyun.php`、`client/HuaweiOBS.php` 未单独存在，逻辑已分别内联到 `deploy/providers/ctyun.ts`、`deploy/providers/huawei.ts:141-181`，功能覆盖完整

### D. 对比结论

- 与「首次联网检查」重叠并新增的严重问题：云端签名日期（华为/京东/火山）、阿里云 GET 丢参、percentEncode、Cloudflare 记录、PowerDNS 204、优选 IP 反转、火山证书缺失
- 两份检查共同指向的根因：签名客户端层（`clients/*.ts`）相对原 PHP 存在编码与时间格式回归，建议优先统一修复并按平台回归验证
- 对比未覆盖 CDN 模块（其来源为 multi-cloud-cdn，需另立参照）

---

## 五、移植错误修复记录（2026-10-08）

已按下述清单修复「重构引入的错误」，保留有意的精简与可用改动。修复后 `backend` 通过 `tsc --noEmit`。

### 已修复

| 模块 | 文件 | 修复内容 |
| --- | --- | --- |
| 华为云客户端 | `clients/HuaweiCloud.ts` | 签名日期改回紧凑 UTC `Ymd\THis\Z`（原为带 `-:` 的 ISO，导致签名失败）；`escape` 按 PHP `urlencode` 语义修正 `+`/`*` 编码 |
| 京东云客户端 | `clients/Jdcloud.ts` | 同上：日期紧凑化；`escape` 修正 |
| 火山引擎客户端 | `clients/Volcengine.ts` | 同上：日期紧凑化；`escape` 修正 |
| 阿里云客户端 | `clients/Aliyun.ts` | GET 请求补回 query 拼接（原丢弃全部签名参数，影响 ESA DNS 等）；`percentEncode` 修正 |
| 百度云客户端 | `clients/BaiduCloud.ts` | `escape` 修正 |
| Cloudflare | `dns/providers/cloudflare.ts` | 解析：仅 `SRV` 拼 priority（去掉错误的 MX 拼接）、`_pause` 状态还原；写入：`CAA`/`SRV` 走 `data`、`REDIRECT_URL`/`FORWARD_URL`→`URI`；补齐暂停/启用开关、IDN（`domainToASCII`）处理 |
| PowerDNS | `dns/providers/powerdns.ts` | 204 空响应不再直接 `res.json()`，改为按文本判空解析 |
| 优选 IP | `optimize/optimizeService.ts` | 修正 type==1 条件取反；`LINE_NAME` 补 `aws` |
| Kubernetes | `deploy/providers/k8s.ts` | 证书由「传文件路径」改为传 PEM 内容（`client-certificate-data` 可用） |
| 宝塔 Windows | `deploy/providers/btwin.ts` | PFX 由 `toString('binary')` 字符串改为直接传 Buffer，避免二进制被 UTF-8 重编码损坏 |
| 京东云 DNS | `dns/providers/jdcloud.ts` | 补 `SRV` 值拆分、`addDomain` 补 `packId:0`、`updateDomainRecord` 补 `domainName` |
| DNSLA | `dns/providers/dnsla.ts` | `DELETE` 参数改回 query |
| Technitium | `dns/providers/technitium.ts` | 补 `APP` 记录「先删后加」更新分支与 `updateDomainRecordRemark` |
| DNSPod | `dns/providers/dnspod.ts` | 补 `DescribeRecordFilterList` 过滤分支（Status/Value）；线路列表改用 `DescribeRecordLineCategoryList` 并回退 `DescribeRecordLineList` |
| 百度云 DNS | `dns/factory.ts`、`dns/providers/baidu.ts` | 配置键统一为 `AccessKeyId`/`SecretAccessKey`，并兼容旧小写键 |
| SSH | `deploy/providers/ssh.ts` | 补 IIS 部署分支（`certutil -importPFX` + `netsh http set sslcert`，含证书哈希比对去重） |
| cdnfly / mwpanel / xp | `deploy/providers/{cdnfly,mwpanel,xp}.ts` | 补请求 `Content-Type` |
| 腾讯云证书 | `cert/providers/tencent.ts` | 吊销时处理 `RevokeDomainValidateAuths` 并写入 TXT 验证记录 |

### 有意保留（未改动）

- `getRecordLine` 返回结构（`name => code`）、`addDomain` 返回 `boolean`、精简掉未使用的 `getSubDomainRecords`/`getDomainRecordLog` 等方法
- `jdcloud`/`huoshan`/`huawei` 的线路列表精简为固定条目
- `local` 部署的路径白名单、ACME 的 SSRF `assertUrlAllowed`、严格比较等加固

### 未修复（需进一步确认或较大改动）

- 火山引擎证书 provider：原项目 `CertHelper::$cert_config` 未暴露 huoshan（仅遗留文件），不构成可用功能缺失，故未新增
- 系统代理（`proxy=1`）：原项目在所有客户端/provider 中通过 `curl_set_proxy` 生效；当前仅在 `cloudflare/enhance.ts`、`update/updateCheck.ts` 使用 `getConfiguredProxyAgent()`。全量补齐涉及约 90 个文件，风险较高，暂未改动。当前仓库已具备 `lib/proxy.ts` 基础设施，可作为后续统一改造的入口