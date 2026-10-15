// 厂商开关值 ⇄ 统一布尔。EO 用 enable/disable，ESA 用 on/off。
export function toEnabled(v: unknown): boolean {
  const s = String(v ?? '').toLowerCase();
  return s === 'on' || s === 'enable' || s === 'true' || s === '1';
}

export function fromEnabled(enabled: boolean, vendor: 'eo' | 'esa'): string {
  return vendor === 'esa' ? (enabled ? 'on' : 'off') : (enabled ? 'enable' : 'disable');
}
