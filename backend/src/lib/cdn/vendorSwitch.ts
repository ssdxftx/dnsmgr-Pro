// 各 CDN 厂商的「开关」取值并不统一：
//   EdgeOne：enable / disable（规则状态、部分配置项）
//   阿里云 ESA：on / off（RuleEnable、站点独占等）
// 历史上前端按 EO 的语义写死 'enable'/'disable' 去判断 ESA 的 'on'，导致
// 「编辑一条已启用的 ESA 规则并保存 → 规则被静默关闭」。
// 此处集中提供归一化，供 provider 与路由复用，禁止调用方再直接做字符串比较。

const TRUTHY = new Set(['on', 'enable', 'enabled', 'true', '1', 'yes']);
const FALSY = new Set(['off', 'disable', 'disabled', 'false', '0', 'no', '']);

/** 厂商开关值 → 统一布尔语义。无法识别时按「未启用」处理，避免误开。 */
export function toEnabled(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  const s = String(v ?? '').trim().toLowerCase();
  if (TRUTHY.has(s)) return true;
  if (FALSY.has(s)) return false;
  return false;
}

/** 统一布尔语义 → 指定厂商的开关值。 */
export function fromEnabled(enabled: boolean, vendor: 'eo' | 'esa'): string {
  if (vendor === 'esa') return enabled ? 'on' : 'off';
  return enabled ? 'enable' : 'disable';
}
