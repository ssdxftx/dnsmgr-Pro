# backend/src/lib/dns

DNS 厂商适配层。路由与调度器只依赖 `DnsProvider` 接口和 `getDnsProvider(type, config, domain, domainid)`。

## 结构

```
lib/dns/
├── types.ts              # DomainInfo / RecordInfo / DnsProvider
├── factory.ts            # dnsProviders 元数据 + providerMap
├── checkService.ts       # 劫持检测调度
├── localResolve.ts
├── recordLookup.ts
└── providers/            # 22 个实现
```

`getDnsProvider` 会把 `domain`、`domainid` 合并进 config 再 `new Ctor(merged)`。未知 type 返回 `false`。

## 关键文件

| 文件 | 目的 |
|------|------|
| `factory.ts` | 前端账户表单字段、能力开关（remark/status/weight/page…） |
| `types.ts` | 必须实现的方法列表 |
| `providers/aws.ts` | Route 53，复用 `lib/clients/AWS.ts` |
| `checkService.ts` | 被 `index.ts` 每 60s 调用 |

## 依赖

**本模块依赖**: `lib/clients/*`、`lib/secret.ts`（由路由层解密后再传入纯对象 config）

**依赖本模块的**: `routes/domain.ts`、`certDns.ts`、monitor / schedule / optimize

## 添加新厂商

1. 实现 `DnsProvider`
2. 在 `dnsProviders` 增加表单元数据（含 `implemented: true`）
3. 加入 `providerMap`
4. 若 DNS-01 需要默认线路，改 `lib/certDns.ts`

账户 config 里的密钥字段命名要能被 `isSecretKey` 匹配，否则会明文回显。
