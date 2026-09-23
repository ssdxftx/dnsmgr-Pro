# backend/src/lib/cert 与 lib/deploy

证书签发渠道、订单状态机、部署商。路由文件 `routes/cert.ts` 同时挂 `/api/cert/*` 与 `/api/deploy/*`。

## 结构

```
lib/cert/
├── types.ts / factory.ts / utils.ts / acmeBase.ts
├── certTaskService.ts    # 5 分钟调度
└── providers/            # 8 个签发渠道

lib/acme/                 # ACMEv2 客户端
lib/certService.ts        # CertOrderService 状态机
lib/certDns.ts            # DNS-01 写记录
lib/deployService.ts      # CertDeployService
lib/deploy/
├── types.ts / factory.ts / meta.ts / commandGuard.ts
└── providers/            # 49 个部署目标
```

## 关键文件

| 文件 | 目的 |
|------|------|
| `cert/factory.ts` | `certConfig` + `getCertProvider`（未知 type 抛错） |
| `certService.ts` | `STATUS_LABEL`、加 DNS、验证、签发、吊销 |
| `certTaskService.ts` | 续签窗口、进行中订单、部署任务批次上限 |
| `deploy/meta.ts` | 前端表单（由原 PHP DeployHelper 导出） |
| `deploy/commandGuard.ts` | `DNSMGR_ALLOW_DEPLOY_CMD` |

## 依赖

**本模块依赖**: DNS factory（DNS-01）、`lib/secret.ts`、`lib/clients/*`、`ssh2` / `basic-ftp`（对应 provider）

**依赖本模块的**: `routes/cert.ts`、`lib/cdn/certLink.ts`、`index.ts` 调度

## 添加新文件

签发渠道走 `CertProvider` 生命周期：`register` → `buyCert` → `createOrder` → `authOrder` → `getAuthStatus` → `finalizeOrder`。

部署商只需 `check` + `deploy`。`meta.ts` 的 `inputs` 是账户表单，`taskinputs` 是任务表单。
