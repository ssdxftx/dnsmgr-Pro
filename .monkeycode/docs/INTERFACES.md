# 接口文档

彩虹 DNS Pro 对外以 JSON HTTP API 提供能力。前端 `frontend/src/api.ts` 统一走 `fetch('/api' + url)`，生产环境由同一 Fastify 进程提供；开发环境由 Vite 把 `/api` 代理到 `http://localhost:8082`。

## 通用约定

### 基址与认证

- 基址：`/api`
- 健康检查：`GET /api/health`，无需登录，返回 `{ "code": 0, "data": "ok" }`
- 业务接口：请求头 `Authorization: Bearer <token>`
- 令牌来源：`POST /api/auth/login` 或 `POST /api/auth/totp` 返回的 `data.token`
- JWT payload 必须含 `type: "session"`；`totp_pre` 不能当会话用
- 服务端每次请求按 `uid` 查库（10 秒缓存），账号 `status=0` 立即 401

无需登录的路径：

| 方法 | 路径 |
|------|------|
| GET | `/api/health` |
| GET | `/api/setup/status` |
| POST | `/api/setup/check` |
| POST | `/api/setup/install` |
| POST | `/api/auth/login` |
| POST | `/api/auth/totp` |
| GET | `/api/register/config` |
| POST | `/api/register` |
| POST | `/api/register/send-code` |
| GET | `/api/system/cron`（需 cronkey 查询参数） |

### 响应格式

成功：

```json
{ "code": 0, "msg": "可选文案", "data": {} }
```

失败（业务错误仍 HTTP 200）：

```json
{ "code": -1, "msg": "错误原因" }
```

HTTP 状态例外：

| 状态 | 场景 |
|------|------|
| 401 | 未登录、令牌过期、非 session 令牌、账号已封禁 |
| 404 | `/api/*` 路径不存在 |
| 429 | 登录/注册/安装限流，带 `Retry-After` |

敏感配置字段回显为掩码 `**********`（`lib/secret.ts` 的 `SECRET_MASK`）。更新时提交掩码或空值会保留原密钥。

### 权限分层

- `level >= 2`：管理员。CDN、证书、部署、容灾、系统设置、用户管理等走管理员校验。
- `level < 2`：普通用户。可登录，域名与解析受 `permission` 表约束（域名 + 可选子域 `sub` + `readonly` + `expiretime`）。
- 前端 `frontend/src/lib/admin.ts` 的 `ADMIN_PREFIXES` 会拦截管理页；服务端仍二次校验。

### 限流（可用 `DNSMGR_RATE_LIMIT=0` 关闭）

| 路径 | 窗口 | 上限 |
|------|------|------|
| `/api/setup/*` | 60s | 15 |
| `/api/auth/login`、`/api/auth/totp` | 60s | 20 |
| `/api/register` | 60s | 10 |
| `/api/register/send-code` | 60s | 5 |

## 安装

实现：`backend/src/routes/setup.ts`、`backend/src/installer.ts`

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/setup/status` | 否 | `{ installed: boolean }` |
| POST | `/api/setup/check` | 否，且仅未安装 | 测库连接；`initialized=true` 表示已有 `prefix_config` 表 |
| POST | `/api/setup/install` | 否，且仅未安装 | 空库建表+管理员；现库绑定。成功后约 500ms `process.exit(0)` 等待重启 |

`POST /api/setup/install` 请求体：

```json
{
  "db_host": "<host>",
  "db_port": 3306,
  "db_user": "<user>",
  "db_password": "<password>",
  "db_name": "dnsmgr",
  "db_prefix": "dnsmgr_",
  "admin_username": "<admin>",
  "admin_password": "<至少8位>"
}
```

全新安装必须给管理员账号密码（至少 8 位）。绑定现库可不填管理员。表前缀仅允许字母数字下划线。

## 认证与当前用户

实现：`backend/src/routes/auth.ts`

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/auth/login` | 否 | 用户名密码登录 |
| POST | `/api/auth/totp` | 否 | 用 `pre_token` + 动态口令换 session |
| POST | `/api/auth/totp-config` | 是 | `action`: `generate` / `bind` / `close`；bind/close 必须再输登录密码 |
| GET | `/api/auth/me` | 是 | 当前用户 `id/username/level/totp_open` |

开启 TOTP 时登录返回：

```json
{ "code": -1, "msg": "需要验证动态口令", "vcode": 2, "data": { "pre_token": "<jwt>" } }
```

成功登录：

```json
{
  "code": 0,
  "msg": "登录成功",
  "data": {
    "token": "<jwt>",
    "user": { "id": 1000, "username": "admin", "level": 2, "totp_open": 0 }
  }
}
```

前端把 token 存 `localStorage.dnsmgr_token`，用户存 `dnsmgr_user`。HTTP 401 会清 token 并跳 `/login`。

## DNS 账户与域名解析

实现：`backend/src/routes/account.ts`、`backend/src/routes/domain.ts`

### DNS 账户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dns/providers` | 22 个厂商元数据（字段、能力开关） |
| GET | `/api/dns/accounts` | 账户列表，config 已脱敏 |
| POST | `/api/dns/accounts` | 新增 |
| PUT | `/api/dns/accounts/:id` | 更新（掩码字段保留原值） |
| DELETE | `/api/dns/accounts/:id` | 删除 |

厂商 type（`lib/dns/factory.ts`）：`aliyun`、`dnspod`、`cloudflare`、`huawei`、`baidu`、`huoshan`、`jdcloud`、`west`、`powerdns`、`aliyunesa`、`tencenteo`、`dnsla`、`qingcloud`、`bt`、`namesilo`、`henet`、`spaceship`、`dnsmgr`、`goedge`、`dynv6`、`aws`、`technitium`。

### 域名与记录

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/domains` | 域名列表 |
| POST | `/api/domains` | 添加域名 |
| DELETE | `/api/domains/:id` | 删除并级联 alias / dmtask / optimizeip / sctask / dns_check_task |
| GET | `/api/domains/categories` | 分类 |
| POST | `/api/domains/categories` | 新建分类 |
| GET | `/api/dns/accounts/:aid/pull` | 从厂商拉取域名 |
| GET | `/api/domains/:id/records` | 解析记录 |
| POST | `/api/domains/:id/records` | 添加记录 |
| PUT | `/api/domains/:id/records/:recordId` | 修改 |
| DELETE | `/api/domains/:id/records/:recordId` | 删除 |
| POST | `/api/domains/:id/records/:recordId/status` | 启用/暂停 |
| POST | `/api/domains/:id/records/:recordId/remark` | 备注 |
| POST | `/api/domains/:id/records/check` | 探测记录 |
| GET | `/api/domains/:id/lines` | 线路表 |

记录结构对齐 `DnsProvider`（`lib/dns/types.ts`）：`RecordId`、`Name`、`Type`、`Value`、`Line`、`TTL`、`MX`、`Status`、`Weight`、`Remark`。

## CDN

实现：`backend/src/routes/account.ts`（账户）、`backend/src/routes/cdn.ts`、`backend/src/routes/preheat.ts`

CDN 厂商 type：`tencent_cdn`、`tencent_edgeone`、`aliyun_cdn`、`aliyun_esa`、`volcengine_cdn`、`huawei_cdn`、`baidu_cdn`、`qiniu_cdn`、`baishan_cdn`、`cdnetworks_cdn`、`kingsoft_cdn`、`wangsu_cdn`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/cdn/providers` | 厂商元数据（含 `addFlow` / `freecert` / `certlink` / `certapply`） |
| GET/POST/PUT/DELETE | `/api/cdn/accounts` | 账户 CRUD |
| GET | `/api/cdn/accounts/:id/zones` | 站点列表（EdgeOne / ESA） |
| GET | `/api/cdn/domains` | 加速域名 |
| POST | `/api/cdn/domains` | 接入；成功后可自动写 DNS CNAME |
| GET | `/api/cdn/domains/:id` | 详情 |
| DELETE | `/api/cdn/domains/:id` | 删除 |
| POST | `/api/cdn/domains/:id/status` | 启停 |
| POST | `/api/cdn/domains/:id/origin` | 源站 |
| POST | `/api/cdn/domains/:id/cache` | 缓存规则 |
| POST | `/api/cdn/domains/:id/https` | HTTPS / 强制跳转 |
| POST | `/api/cdn/domains/:id/zone_setting` | 站点设置 |
| GET | `/api/cdn/zones` | 已接入站点 |
| GET/POST | `/api/cdn/zones/setting` | 站点级配置 |
| POST | `/api/cdn/sync` | 从云端同步 |
| GET | `/api/cdn/statistics` | 流量/请求统计（腾讯 CDN/EO、阿里 CDN/ESA）；全部失败上抛真实错误 |
| POST | `/api/cdn/purge` | 刷新 |
| POST | `/api/cdn/preheat` | 预热 |
| GET | `/api/cdn/cache-tasks` | 刷新/预热任务记录 |
| GET/POST | `/api/cdn/domains/:id/access` | 访问控制 |
| POST | `/api/cdn/domains/freecert` `/freecert/check` | 平台免费证书 |
| POST | `/api/cdn/domains/cert` `/cert/check` | 上传/校验证书 |
| GET | `/api/cdn/cert/candidates` | 可联动证书 |
| POST | `/api/cdn/domains/:id/certlink` | 与本系统证书联动 |
| POST | `/api/cdn/domains/:id/cert_mode` | `freecert` / `certlink` / `certapply` |
| GET | `/api/cdn/domains/:id/cert_status` | 云端证书状态 |
| GET | `/api/cdn/domains/:id/certlink/log` | 联动进度日志 |
| POST | `/api/cdn/domains/:id/certlink/run` | 立即执行联动 |
| GET/POST/PUT/DELETE | `/api/cdn/preheat-tasks` | 定时预热任务 |
| POST | `/api/cdn/preheat-tasks/:id/toggle` | 启停 |
| POST | `/api/cdn/preheat-tasks/:id/run` | 立即执行 |

## 证书与部署

实现：`backend/src/routes/cert.ts`

证书厂商 type：`letsencrypt`、`zerossl`、`google`、`litessl`、`customacme`、`tencent`、`aliyun`、`ucloud`。

### 证书账户 / 订单 / CNAME / 设置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/cert/providers` | 签发渠道元数据 |
| GET/POST/PUT/DELETE | `/api/cert/accounts` | 证书账户 |
| GET/POST | `/api/cert/orders` | 订单列表 / 创建 |
| PUT/DELETE | `/api/cert/orders/:id` | 更新 / 删除 |
| POST | `/api/cert/orders/:id/process` | 推进签发 |
| POST | `/api/cert/orders/:id/reset` | 重置 |
| POST | `/api/cert/orders/:id/revoke` | 吊销 |
| POST | `/api/cert/orders/:id/setauto` | 自动续签开关 |
| GET | `/api/cert/orders/:id/info` | 证书信息 |
| GET | `/api/cert/orders/:id/log` | 处理日志 |
| GET/POST | `/api/cert/cnames` | DNS-01 委托 CNAME |
| DELETE | `/api/cert/cnames/:id` | 删除委托 |
| GET/POST | `/api/cert/settings` | 续签窗口等设置 |

订单 `status`（`lib/certService.ts` `STATUS_LABEL`）：

| 值 | 含义 |
|----|------|
| 0 | 待提交 |
| 1 | 待验证 |
| 2 | 正在验证 |
| 3 | 已签发 |
| 4 | 已吊销 |
| -1 ~ -7 | 购买/创建/加 DNS/验证 DNS/验证订单/验证未通过/签发失败 |

调度器每 5 分钟跑 `certTaskRun`：自动续签（`isauto=1` 且 `status=3` 且到期窗口内）、推进进行中订单、执行启用中的部署任务。

### 部署

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/deploy/providers` | 49 个部署商元数据（class 1 自建系统 / 2 云服务商 / 3 服务器） |
| GET/POST | `/api/deploy/tasks` | 任务列表 / 创建 |
| PUT/DELETE | `/api/deploy/tasks/:id` | 更新 / 删除 |
| POST | `/api/deploy/tasks/:id/process` | 立即部署 |
| POST | `/api/deploy/tasks/:id/reset` | 重置 |
| POST | `/api/deploy/tasks/:id/setactive` | 启停 |

部署 type 见 `backend/src/lib/deploy/factory.ts` 的 `providerMap`（含 `local`、`ftp`、`ssh`、`btpanel`、`aws`、`qzyun` 等 49 项）。任务里的 `cmd` / `cmd_pre` 默认抛错，需 `DNSMGR_ALLOW_DEPLOY_CMD=1`。

## 容灾监控

实现：`backend/src/routes/dmonitor.ts`，调度 `lib/monitor/scheduler.ts`（1 秒 tick）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dmonitor/overview` | 运行概览 |
| GET | `/api/dmonitor/domains` | 可选域名 |
| GET/POST | `/api/dmonitor/tasks` | 策略 CRUD 列表/创建 |
| PUT/DELETE | `/api/dmonitor/tasks/:id` | 更新/删除 |
| GET | `/api/dmonitor/tasks/:id` | 详情 |
| GET | `/api/dmonitor/tasks/:id/logs` | 切换日志 |
| POST | `/api/dmonitor/tasks/:id/active` | 启停 |
| POST | `/api/dmonitor/tasks/batch` | 批量 |
| POST | `/api/dmonitor/clean` | 清理日志 |
| GET | `/api/dmonitor/status` | 调度状态（`run_time` / `run_count`） |

探测协议由任务 `checktype` 决定（ping / tcp / http），实现于 `lib/monitor/checkUtils.ts`。监控目标默认禁止内网，见 `netGuard.ts`。

## 定时切换 / 优选 IP / 到期提醒 / 劫持检测

### 定时切换 `routes/schedule.ts`

`GET/POST /api/schedule/tasks`、`PUT/DELETE /api/schedule/tasks/:id`、`POST .../active`、`POST /api/schedule/tasks/batch`、`GET /api/schedule/domains`。调度间隔 60 秒。

### 优选 IP `routes/optimizeip.ts`

设置、任务 CRUD、立即执行、连通性测试。接口密钥不再内置默认值，需在设置页填写。调度间隔 60 秒。

### 到期提醒 `routes/expire.ts`

`GET/POST /api/expire/settings`；`POST /api/domains/:id/update-date`（需域名访问权）；`POST /api/domains/batch-notice`（管理员）。调度间隔 1 小时。

### DNS 劫持检测 `routes/dnscheck.ts`

任务 CRUD、域名/子域选择、toggle、立即 run。调度间隔 60 秒。

## Cloudflare 增强

实现：`backend/src/routes/cloudflare.ts`、`lib/cloudflare/enhance.ts`

覆盖自定义主机名（含批量增删改、TXT 目标、fallback origin、DCV UUID）以及 Tunnel（token、public hostnames、CIDR 路由、hostname 路由）。路径前缀 `/api/cloudflare/domains/:domainId/...` 与 `/api/cloudflare/accounts/:accountId/tunnels/...`。

## 用户、注册、系统、关于

### 用户 `routes/user.ts`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/user/domains` | 给用户授权时的域名列表（管理员） |
| GET/POST | `/api/users` | 用户列表 / 创建（密码至少 8 位） |
| GET/PUT/DELETE | `/api/users/:id` | 详情 / 更新 / 删除 |
| POST | `/api/users/:id/status` | 启停 |
| GET | `/api/logs` | 操作日志 |

超管（用户表 `AUTO_INCREMENT=1000` 的首位管理员）密码仅本人可改。

### 注册 `routes/register.ts`

公开：`GET /api/register/config`、`POST /api/register/send-code`、`POST /api/register`。管理员：注册码 CRUD（`/api/register/codes`）。

### 系统 `routes/system.ts`

`GET/POST /api/system/settings`（不回显 `sys_key`，密钥类配置掩码）；邮件/TG/Webhook/自定义 Webhook/代理测试；`GET /api/system/cron`（外部 cron 入口，校验 cronkey）；`GET /api/system/cronkey`。

### 关于 `routes/about.ts`

`GET /api/about` 返回应用名、版本、仓库、许可证；`POST /api/about/check-update` 对比 GitHub（`DNSMGR_UPDATE_REPO` / `DNSMGR_UPDATE_TOKEN`）。

## 前端页面与 API 的对应

| 路由 | 视图 | 主要 API 前缀 |
|------|------|----------------|
| `/setup` | Setup.vue | `/api/setup` |
| `/login` | Login.vue | `/api/auth` |
| `/register` | Register.vue | `/api/register` |
| `/domains` | DomainList.vue | `/api/domains` |
| `/domains/:id/records` | RecordList.vue | `/api/domains/:id/records` |
| `/dns-accounts` | DnsAccount.vue | `/api/dns` |
| `/cdn-*` | Cdn*.vue | `/api/cdn` |
| `/cert-*` `/deploy-*` | Cert*/Deploy* | `/api/cert` `/api/deploy` |
| `/dm-*` | Dm*.vue | `/api/dmonitor` |
| `/optimize-*` | Optimize*.vue | `/api/optimize` |
| `/schedule-*` | Schedule*.vue | `/api/schedule` |
| `/totp` | TotpSet.vue | `/api/auth/totp-config` |

详情页左上角返回使用 `frontend/src/lib/back.ts` 的 `useBack(fallback)`：先 `router.back()`，300ms 内路径未变则 `router.push(fallback)`。

## Provider 编程接口（进程内）

新增厂商时实现对应接口并由 factory 注册，不要直接改路由。

```typescript
interface DnsProvider {
  check(): Promise<boolean>;
  getDomainList(...): Promise<DomainListResult | false>;
  getDomainRecords(...): Promise<RecordListResult | false>;
  addDomainRecord(...): Promise<string | false>;
  updateDomainRecord(...): Promise<boolean>;
  deleteDomainRecord(RecordId: string): Promise<boolean>;
  setDomainRecordStatus(RecordId: string, Status: string): Promise<boolean>;
  getRecordLine(): Promise<Record<string, string> | false>;
}
```

证书：`CertProvider`（`register` / `buyCert` / `createOrder` / `authOrder` / `getAuthStatus` / `finalizeOrder` / `revoke`）。

部署：`DeployProvider`（`check` / `deploy(fullchain, privatekey, config, info)` / `setLogger`）。

CDN：`CdnProvider`（接入、源站、缓存、HTTPS，以及可选的 zone / purge / preheat / access / 免费证书 / certlink）。
