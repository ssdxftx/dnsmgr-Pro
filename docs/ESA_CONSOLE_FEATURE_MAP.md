# 阿里云国际版 ESA 控制台功能地图

> 调查对象：`https://esa.console.alibabacloud.com/`
> 账号：`2091655292@qq.com`（主账号，Entrance 免费版）
> 站点：`06162636.xyz`（SiteId `165290216851668`，CNAME 接入，Global，Active）
> 调查方式：登录官方控制台逐页只读查看，未保存/修改任何配置。
> 说明：国际版控制台默认英文；下文括号内为官方英文原文，便于对照。

---

## 1. 控制台两级结构

ESA 控制台分两层：账户级（左侧一级菜单）和站点级（进入某站点后的二级菜单）。

### 1.1 账户级菜单

| 菜单 | 子项 | 路径 |
|---|---|---|
| Account Overview | — | `/` |
| Websites | — | `/siteManage/list` |
| Edge Computing and AI | Functions & Pages (NEW) | `/edge/pages` |
| | Edge Container | `/edge/container` |
| | KV Storage | `/edge/storage` |
| AI CAPTCHA (BETA) | Configuration | `/captcha/configuration` |
| | Analytics | `/captcha/analysis` |
| Analytics and Logs | Account Analytics | `/data/accountAnalysis` |
| | Security Analytics | `/data/safeAnalysis` |
| | Real-time Logs | `/data/logs` |
| | Trace | `/data/trace` |
| Global Settings | Global WAF | `/global/batchConfiguration` |
| | Global Rate Limiting | `/global/traffic-limit` |
| | Lists | `/global/ip` |
| | Scenario Policies | `/global/strategy` |
| | Custom Pages | `/global/custom/blockPage` |
| Tools | IP Geolocation | `/tools/ip` |
| | ActionTrail | 跳转 `actiontrail.console.alibabacloud.com` |
| Billing Management | Plans | `/billManage/packageManagement` |
| | Usage Query | `/billManage/usageInquiry` |
| — | Go to DCDN Console | 跳转 DCDN |

### 1.2 站点级菜单

| 一级菜单 | 子项 | 路径后缀 |
|---|---|---|
| Overview | — | `/overview` |
| Settings List | — | `/config-overview` |
| Version Management | — | `/versions/environment` |
| Analytics and Logs | Account Analytics | `/data/accountAnalysis` |
| | Security Analytics | `/data/safeAnalysis` |
| | Real-time Logs | `/data/logs` |
| | Trace | `/data/trace` |
| DNS | Records | `/dns-record` |
| | DNS Analytics | `/dns-analysis` |
| | SaaS Manager | `/custom-hostname` |
| | Settings | `/dns-settings` |
| SSL/TLS | Overview | `/https/overview` |
| | Edge Certificates | `/https/config` |
| | Client Certificates | `/https/client` |
| | Origin Certificates | `/https/origin` |
| Security | Security Analytics | `/safe/analysis` |
| | Events | `/safe/event` |
| | WAF | `/safe/waf` |
| | AI Crawler Control | `/safe/ai-crawler` |
| | Bots | `/safe/bot` |
| | DDoS | `/safe/ddos/basic` |
| | API Security | `/safe/api` |
| | Origin Protection | `/safe/originDefense` |
| | Account Security (BETA) | `/safe/accountSecurity` |
| | Settings | `/safe/setting` |
| Caching | Cache Analytics | `/cache/analysis` |
| | Settings | `/cache/configuration` |
| | Purge Cache | `/cache/refresh` |
| | Prefetch Cache | `/cache/preheat` |
| | Tiered Cache | `/cache/tiered` |
| | Cache Reserve | `/cache/reserve` |
| Rules | Features Overview | `/rules/overview` |
| | HTTPS Rules | `/rules/https` |
| | Security Rules | `/rules/safe` |
| | Transform Rules | `/rules/transform` |
| | Redirect Rules | `/rules/redirect` |
| | Cache Rules | `/rules/cache` |
| | Network Optimization | `/rules/network-optimization` |
| | Content Optimization | `/rules/content-optimization` |
| | Origin Rules | `/rules/origin` |
| Speed and Network | Speed Monitor | `/rum` |
| | Optimization | `/optimization` |
| Traffic | Smart Routing | `/traffic/smart-routing` |
| | Waiting Room | `/traffic/waiting` |
| | Origin Pools | `/traffic/origins` |
| | Load Balancing | `/traffic/load-balancer` |
| TCP/UDP | Analytics | `/tcp/analysis` |
| | Settings | `/tcp` |
| ER Routes | — | `/workers` |
| Usage Cap | — | `/capping` |

---

## 2. 规则引擎（重点）

### 2.1 通用可视化结构

所有规则页点 **Create Rule** 进入独立编辑器页（不是弹窗），结构固定为：

```
Rule Name
If requests match...
  Apply to
    ○ All Requests        （对本站所有请求生效）
    ○ Filtered Requests   （仅对自定义表达式命中的流量生效）
       [匹配字段 ▼] [运算符 ▼] [值]   [And] [Or]
       Expression Preview: (http.host in {})
       [Edit Expression]  → 切换为原始表达式文本框
Then execute...
  [该规则类型专属的动作配置]
[OK] [Cancel]
```

- 匹配条件可叠加多行，行间用 **And / Or** 组合。
- 支持 **Edit Expression** 切换成原始表达式编辑（文本框直接写 `(http.host in {})` 这类语法），可再点 **Use Expression Builder** 回到可视化。
- 规则可排序（部分类型有 **Order → First / Last**）。

### 2.2 匹配字段全集

不同规则族可见字段不同，且带套餐门槛标记。

#### A. 通用规则族（HTTPS / Transform / Redirect / Cache / Network / Content / Origin Rules）——24 个字段

```
Hostname
URI
URI Full
URI Path
URI Query String
URI Query String Parameter
File Name
File Extension
Continent
Country/Region
Subdivision
Client IP
Header
Referer
User Agent
Cookie
Cookie Value Of
ASN
ISP
SSL/HTTPS
X-Forwarded-For
Request Method
HTTP Version
IP Protocol Version
Request Timestamp
```

#### B. SSL/TLS Rules ——仅 1 个字段

```
Hostname
```

SSL/TLS 规则按主机名匹配，不提供其它条件。

#### C. Security Rules / WAF Custom Rules ——完整 36 个字段

WAF 自定义规则的官方标记（Upgrade 表示当前免费版不可用）：

| 字段 | 免费版 |
|---|---|
| Hostname | 可用 |
| Client IP | 可用 |
| Header | Upgrade To Premium |
| X-Forwarded-For | Upgrade To Premium |
| User Agent | 可用 |
| Referer | 可用 |
| URI | 可用 |
| URI Full | Upgrade To Enterprise |
| URI Path | Upgrade To Pro |
| URI Query String | Upgrade To Pro |
| URI Query String Parameter | Upgrade To Pro |
| Continent | Upgrade To Premium |
| Country/Region | 可用 |
| Subdivision | 可用 |
| Full File Name | 可用 |
| File Extension | 可用 |
| Cookie | Upgrade To Premium |
| Cookie Value Of | Upgrade To Premium |
| TLS Fingerprint | Upgrade To Enterprise |
| ASN | 可用 |
| ISP | 可用 |
| HTTP Request Body | Upgrade To Enterprise |
| Body Query String | Upgrade To Enterprise |
| Client Certificate Verified | 可用 |
| SSL/HTTPS | Upgrade To Premium |
| HTTP Version | Upgrade To Premium |
| IP Protocol Version | 可用 |
| JavaScript Verified | Upgrade To Enterprise |
| MIME Type | Upgrade To Premium |
| Request Method | Upgrade To Premium |
| Serves Static Resources | Upgrade To Enterprise |
| Request Timestamp | 可用 |
| JA3 Fingerprint | Upgrade To Enterprise |
| JA4 Fingerprint | Upgrade To Enterprise |
| Header Order | Not supported |

Security Rules 页面的字段集与上表基本一致，个别字段门槛标记不同（例如 `Header`、`X-Forwarded-For` 在 Security Rules 页标 Pro），以页面实时提示为准。

#### D. Whitelist Rules ——35 个字段

与 WAF Custom 基本一致，但 `Header / X-Forwarded-For / Cookie` 等不带门槛标记（免费版可选），`JA3/JA4` 仍为 Enterprise，`Header Order` 不支持。

### 2.3 运算符全集

```
is in
is not in
equals
does not equal
contains
does not contain
starts with
does not start with
ends with
does not end with
matches regex            (Upgrade To Premium)
does not match regex     (Upgrade To Premium)
length equals
length greater than
length less than
is in list
is not in list
```

通用规则族（HTTPS/Transform/Redirect/Cache/Origin）不显示 regex 两项，其余相同。

### 2.4 各规则类型的执行动作

#### HTTPS Rules

页签：**SSL/TLS Rules**、**HTTPS Rules**

- **SSL/TLS Rules**（`/rules/https/basic/add`）
  - 动作：**SSL/TLS Basic Configuration**
  - 选项：SSL/TLS Encryption、Cipher Suite Group（默认 `All Cipher Suites (Default)`）、TLS Version（TLSv1.0 / 1.1 / 1.2 / 1.3）、OCSP Stapling、HTTP/2、HTTP/3 (QUIC)
- **HTTPS Rules**（`/rules/https/application/add`）
  - Always Use HTTPS（Status）
  - Opportunistic Encryption（Status）
  - HSTS（Status、Validity Period（默认 6 Months）、Apply to Subdomains、Preload）
  - Order：First / Last

#### Security Rules

`/rules/safe/add`

- 动作：**Security Level**
- 选项：I'm Under Attack / High / Medium / Low / Essentially Off / Off (Enterprise)

#### Transform Rules

页签：Rewrite URL、Modify Request Header、Modify Response Header、Custom response code、Managed Transforms

- **Rewrite URL**（`/rules/transform/url/add`）
  - Path：Retain / Rewrite to…
  - Query String：Retain / Rewrite to…
- **Modify Request Header**（`/rules/transform/request-header/add`）
  - Type：Static / Dynamic
  - Operation：Add / Delete / Change
  - Request Header Name、Request Header Value
- **Modify Response Header**（`/rules/transform/response-header/add`）
  - Type：Static / Dynamic
  - Operation：Add / Delete / Change
  - Response Header Name、Response Header Value
  - Order：First / Last
- **Custom response code**（`/rules/transform/response-code/add`）
  - Response Code：200–599
  - Response Page：Unresponsive page / 自定义页面（Manage Custom Pages）
  - Preview
- **Managed Transforms**：官方预置转换列表，无 Create，只能启用/停用

#### Redirect Rules

页签：Request Redirect、Error Code Redirect

- **Request Redirect**（`/rules/redirect/request/add`）
  - URL Redirect：Type（Static / Dynamic）、URL、Status Code（301 / 302 / 303 / 307 / 308）、Retain Query String
- **Error Code Redirect**（`/rules/redirect/error-code/add`）
  - Error Code：400 / 403 / 404 / 405 / 414 / 416 / 500 / 501 / 502 / 503 / 504
  - Redirect URL
  - 最多 11 条（Add (n/11)）

#### Cache Rules

`/rules/cache/add`

- Cache Eligibility：Bypass Cache / Eligible for Cache
- Browser Cache TTL：Honor Origin TTL / Do Not Cache / Use Custom TTL
- Edge Cache TTL：Honor Origin TTL or Use Default Cache Rule / Honor Origin TTL or Do Not Cache / Honor Origin TTL or Use Custom TTL / Do Not Cache / Use Custom TTL
- Edge Status Code Cache TTL：Status Code Cache Rule（最多 8 条）
- Custom Cache Keys：
  - Sort Query Strings：Yes / No
  - Query String：Ignore All / Retain All / Ignore Specific Parameters / Retain Specific Parameters
  - HTTP Request Header：包含名称和值 / 仅检查存在
  - Cookie：包含名称和值 / 仅检查存在
  - User：Device Type / Country/Region / Language
  - Cache Poisoning Defense
- Caching on Ports：Enterprise
- Serve Stale Content
- Cache Reserve Eligibility：Bypass Cache Reserve / Eligible for Cache Reserve
- Cache POST：Status、Body Size（1–8 KB）、CacheKey Processing（Generate MD5 hash of request body / Ignore Request Body）
- Order：First / Last

#### Network Optimization

`/rules/network-optimization/add`

- Smart Routing（Status；按请求计费 USD 0.015/万次/天）
- HTTP/2 Origin Fetch（Status）
- WebSocket（Status）
- gRPC（Status）
- Maximum Upload Size（100–500 MB）

#### Content Optimization

页签：File Compression、Image Optimization、Video Processing

- **File Compression**：Gzip / Brotli / Zstd（各自 Status）
- **Image Optimization**：Image Transform（Status）
- **Video Processing**：Video Seeking（Status，仅 MP4/FLV，依赖 URL `start` 参数）

#### Origin Rules

`/rules/origin/add`

- Origin Host（改写回源 Host）
- Origin Protocol and Port：Match Client / HTTP / HTTPS，HTTP Port、HTTPS Port
- Origin SNI
- DNS Record (DNS Override)：从站点 DNS 记录中选择
- Range Requests：Origin Mode（Match Client (Default) / Disable / Enable）、Shard Size（默认 512 KB）
- Origin Fetch Timeout（5–300 秒，默认 30）
- 301/302 Redirect Follow（Status）

### 2.5 WAF 规则族

WAF 页（`/safe/waf`）共 8 个页签：Overview、Custom Rules、Rate Limiting Rules、Managed Rules、Scan Protection Rules、Threat Intelligence Rules、Whitelist Rules、IP Access Rule。

#### Custom Rules（`/safe/waf/customRules/add`）

- 匹配：36 字段 + 17 运算符（同上）
- 动作 Action：Monitor / Block / JavaScript Challenge
- Error Page：Default Error Page / 自定义页面（Manage Custom Pages）
- Status Code
- Effective Time：Permanent / 时间范围

#### Rate Limiting Rules（`/safe/waf/frequencyControl/add`）

- 匹配条件（同 36 字段）
- Apply to Cache（是否对缓存命中请求也计数）
- **With the same characteristics**（按什么维度聚合计数）：
  ```
  Client IP
  Header (Pro)
  Cookie Value Of (Pro)
  User Agent (Enterprise)
  ASN (Premium)
  MIME Type (Enterprise)
  HTTP Version (Enterprise)
  Hostname
  URI (Premium)
  URI Path (Premium)
  URI Query String (Pro)
  URI Query String Parameter (Enterprise)
  X-Forwarded-For (Enterprise)
  JA3 / JA4 Fingerprint (Enterprise)
  IPv4 CIDR Block (/16、/24) (Enterprise)
  IPv6 CIDR Block (/64、/96) (Enterprise)
  Session (Enterprise)
  ```
- Rate：次数 / 时间窗
  - 5 Seconds (Enterprise)、10 Seconds、1 Minute (Pro)、2 Minutes (Premium)、5 Minutes (Premium)、10 Minutes (Premium)、15 Minutes、1 Hour (Enterprise)、Customize (Enterprise)
- Then execute：
  - Action：Monitor / Block / JavaScript Challenge
  - Apply to All Requests / Apply to Matched Requests (Enterprise)
  - Duration：10 Seconds / 1 Minute (Pro) / 2 Minutes (Premium) / 5 Minutes (Premium) / 10 Minutes (Pro) / 1 Hour / 1 Day (Enterprise)
  - Error Page、Status Code
- Effective Time：Permanent / 时间范围

#### Managed Rules

- Basic Protection Rules (Free)：Rule Details 27/29、Protection Level（默认 Medium (Recommended)）、Action（Block）
- More Rules (Upgrade To Pro)：Cross-site Scripting、SQL Injection、Cross-site Request Forgery、Remote File Inclusion、Protocol Non-compliance、Webshell Attacks、Path Traversal、Deserialization、Expression Injection…
- Effective Time

#### Scan Protection Rules

Entrance 版锁定：Upgrade To Pro。

#### Threat Intelligence Rules

Entrance 版锁定：Upgrade To Enterprise（Tor 节点等风险情报）。

#### Whitelist Rules（`/safe/waf/whiteList/add`）

- 匹配：35 字段
- Then skip：All Rules / Specific Rule Category/ID
- 模板：Allow Specified IP、Allow Static Requests、Whitelist Specified Path

#### IP Access Rule

- Value：IP / CIDR
- Action：Block / Allow / JavaScript Challenge / Slider CAPTCHA
- Description
- 作用于整站 HTTP(L7) 与 TCP/UDP(L4)

### 2.6 表达式编辑器

点 **Edit Expression** 后，匹配区变成原始表达式输入框，初始值即可视化生成的表达式，例如：

```
(http.host in {})
```

可点 **Use Expression Builder** 回到可视化，或 **Discard Change** 放弃修改。表达式字段与可视化字段一一对应（`http.host`、`http.request.uri` 等）。

---

## 3. 账户级功能与选项

### 3.1 Websites（`/siteManage/list`）

- 列表列：Website、DNS Setup、Location、Status、Subscription、Tag、Actions
- 操作：Add Website、Disable、Delete
- 当前 1 个站点：`06162636.xyz`（CNAME / Global / Active / Entrance）

### 3.2 Edge Computing and AI

- **Functions & Pages**（`/edge/pages`）：Free 计划；函数配额 0/20；Create Function
- **Edge Container**（`/edge/container`）：需 Enterprise 且带宽 >100 GB
- **KV Storage**（`/edge/storage`）：Namespaces / Metrics；最多 10 个命名空间，每个 1 GB

### 3.3 AI CAPTCHA (BETA)

- **Configuration**（`/captcha/configuration`）：最多 10 条规则；验证类型
  - Click-and-Pass、Slider、Puzzle、Image Restore、Invisible CAPTCHA
  - 列：Rule ID、Rule Name、Scene ID、URI for Verification、Type、24h Verifications、Block Empty Tokens
- **Analytics**（`/captcha/analysis`）：验证量、通过量、拦截量、趋势

### 3.4 Analytics and Logs

- **Account Analytics**：Total Requests、Traffic、Peak Bandwidth、Page Views；维度含 Site/Referer/Host/Country/Path/Status/Browser/OS/Device/Client IP/HTTP Version/Cache Status/UA/ISP/ASN/Method 等
- **Security Analytics**：Request / Bot / Rate Limiting 三个页签；可按筛选条件一键 Create Custom WAF Rule
- **Real-time Logs**：Create Delivery Task（Task Name、Log Category、Destination、Status）
- **Trace**：构造 HTTP 请求，查看命中的 ESA 配置与规则；支持 Method（GET/POST/PUT/PATCH/DELETE/OPTIONS）、URL、Region/ISP、HTTP Protocol、Request Header、Skip Challenge

### 3.5 Global Settings

- **Global WAF**：仅 Enterprise
- **Global Rate Limiting**：仅 Enterprise
- **Lists**（`/global/ip`）：最多 10 组，每组最多 5000 条 IP/ASN/Host；可供 WAF 规则引用
- **Scenario Policies**（`/global/strategy`）：0/10；Major Events 场景；Policy Name、Policy Template、Effective Period
- **Custom Pages**（`/global/custom/blockPage`）：Block Page / Slider Page，各 0/10

### 3.6 Tools

- **IP Geolocation**：批量查 IP 是否属于 ESA POP（最多 20 个，IPv4/IPv6）
- **ActionTrail**：跳转操作审计

### 3.7 Billing Management

- **Plans**：Website Plans / Edge Computing；当前 Entrance，到期 2040-11-18，12 个月自动续费
- **Usage Query**：Website Plans / Edge Computing / Cache Reserve Instance；按今日/昨日/7 天/本月/上月/自定义查询

---

## 4. 站点级功能与选项

### 4.1 Settings List（`/config-overview`）

一页汇总所有已配置项与默认值，按 DNS、SSL/TLS、WAF、Bots、DDoS、Origin Protection 分组，可只看已配置项。

### 4.2 DNS

- **Records**（`/dns-record`）
  - 记录类型：A/AAAA、CNAME（代理记录）；帮助文本另说明 MX、TXT、OSS 等
  - Proxy Status：Proxied / DNS only
  - TTL：Auto
  - Advanced：HTTP/HTTPS Port
  - 快捷入口：Add Record、Import、Load Balancer、Edge Function、TCP/UDP Proxy
  - 配额：1/100
- **DNS Analytics**：查询量、QPS、平均处理时间；维度 Query Name/Type/Response Code/源目的 IP/Protocol/IP 版本
- **SaaS Manager**：自定义域名接入，0/100
- **Settings**：CNAME Flattening（含 Root Domain）、Static IP (Enterprise)、Convert to NS Setup

### 4.3 SSL/TLS

- **Overview**：Edge Certificates、Client Certificates、Enforce Validation of Origin Certificate、Authenticated Origin Pulls
- **Edge Certificates**（`/https/config`）
  - 自定义证书 1/5；Let's Encrypt 0/10；DigiCert（Pro）
  - Apply for Free Certificate、Upload Custom Certificate
  - KeyServer（Enterprise）、Delegated DCV、Always Use HTTPS 等
- **Client Certificates**（`/https/client`）：mTLS 规则、创建客户端证书（ESA 托管 CA）
- **Origin Certificates**（`/https/origin`）：Origin Protocol and Port、Enforce Validation、Authenticated Origin Pulls

### 4.4 Security

- **Security Analytics**：Request / Bot / Rate Limiting
- **Events**：安全事件（Action、Client IP、UA、Path、Event Sources 等）
- **WAF**：见第 2.5 节
- **AI Crawler Control**：Pro
- **Bots**：Smart Mode / Professional Mode
  - Definite Bots：Allow / Block (Premium) / Monitor / Slider CAPTCHA (Premium)
  - Likely Bots：Configure
  - Verified Bots：Premium
  - Static Resource Protection：Enterprise
  - JavaScript Detection：Enterprise
- **DDoS**：Protection Settings / DDoS Analytics / Attack Details；基础防护 ≤10 Gbps L3/L4；HTTP DDoS 与深度学习防护为 Enterprise
- **API Security**：Pro
- **Origin Protection**：Pro
- **Account Security**：Enterprise
- **Settings**：Identify Real Client IP（IP Type：Connect IP 等）、Security Level（I'm Under Attack / High / Medium / Low / Essentially Off / Off Enterprise）

### 4.5 Caching

- **Cache Analytics**：Requests、Response Traffic、Cache Hit Ratio；维度 Version/Service Provider/Cache Status/Country/Host/Method/Path/Content Type/Status/Device
- **Settings**：Query String、Browser Cache TTL、Edge Cache TTL、Development Mode
- **Purge Cache**：By URL（每日 1000，手动输入/上传文件）、Upload Records、Purge Records
- **Prefetch Cache**：Instant / Scheduled / Records；每日 1000，每任务最多 100 URL
- **Tiered Cache**：Edge Tiered Cache / +Regional（不支持）/ +Smart Tiered Cache / All Cache Tiers（不支持）
- **Cache Reserve**：Enterprise

### 4.6 Speed and Network

- **Speed Monitor**（`/rum`）：Page Monitoring，0/1；Adaptive Optimizer
- **Optimization**：Speed Optimization / Network Optimization
  - Image Transform（限时免费）、Markdown Conversion（Pro）、Gzip、Brotli、Zstd、HTTP/2、HTTP/2 to Origin 等

### 4.7 Traffic

- **Smart Routing**：按请求计费 USD 0.015/万次/天
- **Waiting Room**：Premium
- **Origin Pools**：0/5；Pool Name、Domain Name、Origin Servers、Associated Load Balancers
- **Load Balancing**：Enterprise

### 4.8 TCP/UDP

- Analytics / Settings：需 Enterprise；支持自定义端口、免证书、L4 加速与基础 DDoS

### 4.9 ER Routes（`/workers`）

- Create Function、Add Route
- Route：Order、Route Name、Route Mode、Route Content、Edge Function、Bypass Mode、Status

### 4.10 Usage Cap（`/capping`）

- 最多 5 条；Rule Name、Cap Rules、Action、Status；10–15 分钟生效

---

## 5. Entrance 免费版可见但锁定的功能

| 功能 | 门槛 |
|---|---|
| 自定义证书 >5 张、DigiCert 免费证书 | Pro |
| KeyServer | Enterprise |
| 静态 IP（DNS Settings） | Enterprise |
| WAF Scan Protection | Pro |
| WAF Threat Intelligence | Enterprise |
| AI Crawler Control | Pro |
| API Security | Pro |
| Origin Protection | Pro |
| Account Security | Enterprise |
| Bots Verified Bots | Premium |
| Bots Static Resource Protection / JavaScript Detection | Enterprise |
| DDoS HTTP DDoS / Deep Learning | Enterprise |
| Waiting Room | Premium |
| Load Balancing | Enterprise |
| TCP/UDP Proxy | Enterprise |
| Cache Reserve | Enterprise |
| Caching on Ports | Enterprise |
| Global WAF / Global Rate Limiting | Enterprise |
| Version Management（灰度发布） | Premium |
| Edge Container | Enterprise（带宽 >100 GB） |

---

## 6. 对本项目的实现建议（缺口优先级）

1. **规则可视化表单**：目前通用 Action 表单无法表达「Apply to / 多条件 And-Or / 运算符 / 表达式预览」，建议新增独立规则编辑器组件，复用本文件的字段与运算符枚举。
2. **WAF 规则族**：Custom / Rate Limiting / Whitelist / IP Access / Managed 五类需各自表单；Rate Limiting 的「同特征聚合 + 速率窗口 + 封禁时长」是重点。
3. **套餐门槛**：字段与功能需按 Entrance/Pro/Premium/Enterprise 标注可用性，避免免费版用户误操作。
4. **表达式编辑**：保留「可视化 ↔ 原始表达式」双向切换，原始表达式与官方语法保持一致（如 `http.host`）。
5. **规则排序**：HTTPS/Transform(Response)/Cache 等类型支持 First/Last 排序，需要 order 字段。
6. **Settings List 汇总页**：官方有一页汇总所有配置项，建议本项目也提供同等总览。

---

## 7. 本项目实现状态

- **规则引擎**：已完成卡片式条件/动作编辑器、可视化与原始表达式双向切换、规则排序与套餐门槛提示。
- **站点级控制台**：已按官方菜单重构为 16 个页签，覆盖概览、设置清单、版本管理、分析日志、DNS、SSL/TLS、安全、缓存、规则、速度与网络、流量、TCP/UDP、ER 路由、用量上限、全局配置与 ESA 全量 API。
- **安全与 WAF**：已完成 Custom / Rate Limiting / Managed / Scan / Whitelist / IP Access / Security Level 七类页面，以及 Bots、DDoS、API、源站防护等套餐入口。
- **缓存与流量**：已完成缓存规则、缓存标签、开发模式、多级缓存、缓存保持、刷新、预热、缓存分析、等候室（含事件与规则）、源地址池、负载均衡、四层代理、ER 路由与用量上限。
- **账户级控制台**：入口位于 CDN 账户列表的「账户控制台」，路由 `/cdn-accounts/:aid/esa-console`，包含账户概览、边缘计算与 AI（函数/KV/容器入口）、AI CAPTCHA（滑块验证页）、分析与日志（账户/安全分析、实时日志、Trace）、全局设置（列表/全局 WAF/场景策略/自定义页面/全局速率限制）、工具（IP 归属/ActionTrail）与计费管理（套餐实例/用量查询/资源包）。
- **已知边界**：OpenAPI 目录未开放 AI CAPTCHA 规则接口，账户控制台管理官方滑块验证页并提示到官方控制台配置规则；账户分析使用站点级时序接口，按站点选择查询；边缘容器、全局 WAF、全局速率限制按套餐门槛展示。
