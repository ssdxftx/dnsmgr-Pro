// 域名规范化列：优先使用迁移生成的 name_norm（可走索引），迁移失败时回退到表达式查询。
let available = false;

export function setDomainNormAvailable(value: boolean): void {
  available = value;
}

export function domainNameNorm(alias = ''): string {
  const col = alias ? `${alias}.name_norm` : 'name_norm';
  if (available) return col;
  const name = alias ? `${alias}.name` : 'name';
  return `LOWER(TRIM(TRAILING '.' FROM ${name}))`;
}
