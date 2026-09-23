# backend/src/lib/cdn

CDN 厂商适配、缓存规则翻译、统计、证书联动与预热调度。

## 结构

```
lib/cdn/
├── types.ts
├── factory.ts            # cdnConfig、addFlow、getCdnProvider
├── pathRule.ts           # 路径/后缀匹配辅助
├── certLink.ts           # 与证书订单/部署任务联动
├── preheatService.ts     # 定时预热
├── providers/            # 12 个实现
└── statistics/           # aliyunCdn / aliyunEsa / tencentCdn / tencentEdgeOne
```

Factory 键带后缀 `_cdn` / `_edgeone` / `_esa`，与 DNS 的 `aliyun`、`tencenteo` 不是同一套 type。

## 关键文件

| 文件 | 目的 |
|------|------|
| `factory.ts` | `freecert` / `certapply` / `certlink` 能力位 + 接入向导 |
| `certLink.ts` | 写 `cert_order.link`、创建部署任务、`cert_link_log` |
| `statistics/index.ts` | 聚合四家统计；部分失败仍返回已有数据 |

## 依赖

**本模块依赖**: `lib/clients/*`、证书/部署服务（联动时）

**依赖本模块的**: `routes/cdn.ts`、`routes/preheat.ts`、`index.ts` 预热调度

## 规范

- 可选方法（`purge`、`getZones`、`applyFreeCert`…）用接口可选字段，路由里先判断再调用
- 自动写 DNS CNAME 时线路参数传 `undefined`，使用各厂商默认线路
