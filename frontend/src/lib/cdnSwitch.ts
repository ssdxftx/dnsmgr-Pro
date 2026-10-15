// 与后端 backend/src/lib/cdn/vendorSwitch.ts 保持同一套语义。
// 各厂商「开关」取值不统一：EdgeOne 用 enable/disable，阿里云 ESA 用 on/off。
// 统一收敛为布尔语义，避免出现 'on' 与 'enable' 直接比较导致的判断恒假
// （历史上曾导致「编辑一条已启用的 ESA 规则并保存 → 规则被静默关闭」）。

const TRUTHY = new Set(['on', 'enable', 'enabled', 'true', '1', 'yes']);
const FALSY = new Set(['off', 'disable', 'disabled', 'false', '0', 'no', '']);

export type Vendor = 'eo' | 'esa';

/** 厂商开关值 → 布尔。无法识别时按 false（未启用）处理，避免误开。 */
export function toEnabled(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  const s = String(v ?? '').trim().toLowerCase();
  if (TRUTHY.has(s)) return true;
  if (FALSY.has(s)) return false;
  return false;
}

/** 布尔 → 指定厂商的开关值。 */
export function fromEnabled(enabled: boolean, vendor: Vendor): string {
  if (vendor === 'esa') return enabled ? 'on' : 'off';
  return enabled ? 'enable' : 'disable';
}

/** 规则列表统一取布尔开关：优先 enabled（后端已归一化），回退解析 status */
export function ruleEnabled(row: any): boolean {
  if (row && typeof row.enabled === 'boolean') return row.enabled;
  return toEnabled(row?.status ?? row?.RuleEnable ?? row?.Status);
}
