// cert_order.cdn_domain_id 为 link 字段中 cdnDomainId 的生成列（见 migrate.ts）。
// 低版本 MySQL、缺少 ALTER 权限或历史 link 含非法 JSON 时，该列可能创建失败。
// 此处提供进程级可用性开关：迁移成功置 true，查询方据此在「生成列精确匹配」与
// 「link LIKE 粗筛 + 解析」之间降级，避免迁移失败后 CDN 联动相关接口整体 500。
let available = false;

export function setCdnDomainIdColumnAvailable(v: boolean): void {
  available = v;
}

export function isCdnDomainIdColumnAvailable(): boolean {
  return available;
}