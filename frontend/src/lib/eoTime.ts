// 时间字段单位换算：数据始终以「秒」存储并写入真实配置；
// 可视化编辑器与 JSON 视图按用户选择的单位（秒/分钟/小时/天/月）展示。
import type { Bi, EoField } from './eoRuleSchema';

export type TimeUnit = 's' | 'min' | 'h' | 'd' | 'mo';

export interface TimeUnitDef {
  value: TimeUnit;
  factor: number;
  label: Bi;
}

/** 由大到小：用于自动挑选能整除的展示单位 */
export const TIME_UNITS: TimeUnitDef[] = [
  { value: 'mo', factor: 2592000, label: { zh: '月(30天)', en: 'month (30d)' } },
  { value: 'd', factor: 86400, label: { zh: '天', en: 'day' } },
  { value: 'h', factor: 3600, label: { zh: '小时', en: 'hour' } },
  { value: 'min', factor: 60, label: { zh: '分钟', en: 'min' } },
  { value: 's', factor: 1, label: { zh: '秒', en: 'sec' } },
];

export function timeFactor(u: TimeUnit): number {
  return TIME_UNITS.find((x) => x.value === u)?.factor || 1;
}

/** 初始单位：优先选择能把秒数整除的最大单位（如 86400 → 1 天） */
export function pickTimeUnit(v: number | null | undefined): TimeUnit {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return 's';
  for (const u of TIME_UNITS) if (v % u.factor === 0 && v / u.factor >= 1) return u.value;
  return 's';
}

export function toDisplayValue(seconds: number, unit: TimeUnit): number {
  const d = seconds / timeFactor(unit);
  return Number.isInteger(d) ? d : Number(d.toFixed(6));
}

function clone<T>(v: T): T {
  return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
}

/**
 * 递归转换操作参数中的时间字段（忽略以 __ 开头的内部键，如 __units）。
 * dir='toDisplay'：秒 → 展示单位；dir='toSeconds'：展示单位 → 秒。
 */
export function timeTransform(fields: EoField[], params: Record<string, any>, dir: 'toDisplay' | 'toSeconds'): Record<string, any> {
  const src = params && typeof params === 'object' ? params : {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('__')) continue;
    out[k] = clone(v);
  }
  const units = (src.__units || {}) as Record<string, TimeUnit>;
  for (const f of fields) {
    if (f.type === 'number' && f.time) {
      const val = src[f.name];
      if (typeof val === 'number') {
        const u = units[f.name] || 's';
        out[f.name] = dir === 'toDisplay' ? toDisplayValue(val, u) : Math.round(val * timeFactor(u));
      }
    } else if (f.type === 'group') {
      if (src[f.name] && typeof src[f.name] === 'object') out[f.name] = timeTransform(f.fields || [], src[f.name], dir);
    } else if (f.type === 'oneof') {
      for (const v of f.variants || []) {
        if (src[v.key] && typeof src[v.key] === 'object') out[v.key] = timeTransform(v.fields || [], src[v.key], dir);
      }
    } else if (f.type === 'list') {
      const arr = Array.isArray(src[f.name]) ? src[f.name] : null;
      if (arr) out[f.name] = arr.map((it: any) => (it && typeof it === 'object' ? timeTransform(f.itemFields || [], it, dir) : clone(it)));
    }
  }
  return out;
}

/**
 * 按固定倍数缩放操作参数中的时间字段（结构同 timeTransform，仅处理 time 字段）。
 * 用于导入「以非秒单位表达」的外部规则，例如官方控制台导出的预制规则（数值为小时）。
 */
export function scaleTimeFields(fields: EoField[], params: Record<string, any>, factor: number): void {
  if (!params || typeof params !== 'object' || factor === 1) return;
  for (const f of fields) {
    if (f.type === 'number' && f.time) {
      if (typeof params[f.name] === 'number') params[f.name] = Math.round(params[f.name] * factor);
    } else if (f.type === 'group') {
      if (params[f.name] && typeof params[f.name] === 'object') scaleTimeFields(f.fields || [], params[f.name], factor);
    } else if (f.type === 'oneof') {
      for (const v of f.variants || []) {
        if (params[v.key] && typeof params[v.key] === 'object') scaleTimeFields(v.fields || [], params[v.key], factor);
      }
    } else if (f.type === 'list' && Array.isArray(params[f.name])) {
      for (const it of params[f.name]) if (it && typeof it === 'object') scaleTimeFields(f.itemFields || [], it, factor);
    }
  }
}

/**
 * 由 JSON 视图回填可视化模型时：沿用上一份单位选择，并把展示单位的值还原为秒。
 * neu 为 JSON 解析得到的新参数对象，prev 为转换前的可视化参数对象。
 */
export function restoreSeconds(fields: EoField[], neu: Record<string, any> | undefined, prev: Record<string, any> | undefined): void {
  if (!neu || typeof neu !== 'object') return;
  const pu = (prev && prev.__units) || {};
  if (!neu.__units || typeof neu.__units !== 'object') neu.__units = {};
  for (const f of fields) {
    if (f.type === 'number' && f.time) {
      const u = (pu[f.name] as TimeUnit) || pickTimeUnit(neu[f.name]);
      neu.__units[f.name] = u;
      if (typeof neu[f.name] === 'number') neu[f.name] = Math.round(neu[f.name] * timeFactor(u));
    } else if (f.type === 'group') {
      restoreSeconds(f.fields || [], neu[f.name], prev && prev[f.name]);
    } else if (f.type === 'oneof') {
      for (const v of f.variants || []) restoreSeconds(v.fields || [], neu[v.key], prev && prev[v.key]);
    } else if (f.type === 'list') {
      const na = Array.isArray(neu[f.name]) ? neu[f.name] : [];
      const pa = prev && Array.isArray(prev[f.name]) ? prev[f.name] : [];
      na.forEach((it: any, i: number) => restoreSeconds(f.itemFields || [], it, pa[i]));
    }
  }
}