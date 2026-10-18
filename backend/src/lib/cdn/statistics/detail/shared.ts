import type { MetricAgg, MetricGroup, TimeInterval } from '../catalog/types.js';
import type { BreakdownItem, MetricSeries } from '../catalog/result.js';
import type { MetricDef } from '../catalog/types.js';

export interface TimePoint {
  ts: number;
  value: number;
}

export interface Timeline {
  start: Date;
  end: Date;
  interval: TimeInterval;
  stepMs: number;
  labels: string[];
}

const STEP_MS: Record<TimeInterval, number> = {
  min: 60_000,
  '5min': 300_000,
  hour: 3_600_000,
  day: 86_400_000,
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function floorTo(d: Date, stepMs: number): Date {
  return new Date(Math.floor(d.getTime() / stepMs) * stepMs);
}

/**
 * 依据查询跨度生成标签（设计 §3.5）：
 * ≤6h → 5min；6h–7d → hour；>7d → day。
 */
export function buildTimeline(start: Date, end: Date, forced?: TimeInterval): Timeline {
  const span = Math.max(0, end.getTime() - start.getTime());
  let interval: TimeInterval;
  if (forced) interval = forced;
  else if (span <= 6 * 3_600_000) interval = '5min';
  else if (span <= 7 * 86_400_000) interval = 'hour';
  else interval = 'day';

  const stepMs = STEP_MS[interval];
  const alignedStart = interval === 'day' ? startOfDay(start) : floorTo(start, stepMs);
  const count = Math.max(1, Math.ceil((end.getTime() - alignedStart.getTime()) / stepMs));
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(alignedStart.getTime() + i * stepMs);
    if (interval === 'day') labels.push(`${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    else if (interval === 'hour') labels.push(`${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`);
    else labels.push(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }
  return { start: alignedStart, end, interval, stepMs, labels };
}

/** 按绝对时间戳把点落到标签桶；无数据的桶为 null（不做左右对齐兜底） */
export function alignByTimestamp(points: TimePoint[], timeline: Timeline): (number | null)[] {
  const out = new Array<number | null>(timeline.labels.length).fill(null);
  const startMs = timeline.start.getTime();
  const stepMs = timeline.stepMs;
  for (const p of points) {
    if (!Number.isFinite(p.ts) || !Number.isFinite(p.value)) continue;
    const idx = Math.floor((p.ts - startMs) / stepMs);
    if (idx < 0 || idx >= out.length) continue;
    out[idx] = (out[idx] ?? 0) + p.value;
  }
  return out;
}

/** 同上，但同桶取最大值（带宽 5min → 小时峰值） */
export function bucketMaxByTimestamp(points: TimePoint[], timeline: Timeline): (number | null)[] {
  const out = new Array<number | null>(timeline.labels.length).fill(null);
  const startMs = timeline.start.getTime();
  const stepMs = timeline.stepMs;
  for (const p of points) {
    if (!Number.isFinite(p.ts) || !Number.isFinite(p.value)) continue;
    const idx = Math.floor((p.ts - startMs) / stepMs);
    if (idx < 0 || idx >= out.length) continue;
    out[idx] = Math.max(out[idx] ?? 0, p.value);
  }
  return out;
}

/** 聚合：忽略 null；全 null 返回 null */
export function aggregate(values: (number | null)[], agg: MetricAgg): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  switch (agg) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'max':
      return nums.reduce((a, b) => Math.max(a, b), 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'last':
      return nums[nums.length - 1];
    case 'rate':
      // 百分比序列的汇总取均值；派生命中率由调用方传入「分子/分母」汇总
      return nums.reduce((a, b) => a + b, 0) / nums.length;
  }
}

/** 命中率等派生序列：逐点相除，分母为 0 或缺失时返回 null */
export function rateSeries(
  hit: (number | null)[],
  total: (number | null)[],
): (number | null)[] {
  return hit.map((h, i) => {
    const t = total[i];
    if (h == null || t == null || t === 0) return null;
    return (h / t) * 100;
  });
}

/** 跨账户/站点合并：sum 累加，max 取大，avg 取均值，rate 由调用方重算 */
export function combineSeries(
  list: Array<(number | null)[]>,
  agg: MetricAgg,
  len: number,
): (number | null)[] {
  const out = new Array<number | null>(len).fill(null);
  if (!list.length) return out;
  if (agg === 'max') {
    for (const arr of list) {
      for (let i = 0; i < len; i++) {
        const v = arr[i];
        if (v == null) continue;
        out[i] = Math.max(out[i] ?? 0, v);
      }
    }
    return out;
  }
  if (agg === 'avg') {
    const counts = new Array<number>(len).fill(0);
    for (const arr of list) {
      for (let i = 0; i < len; i++) {
        const v = arr[i];
        if (v == null) continue;
        out[i] = (out[i] ?? 0) + v;
        counts[i]++;
      }
    }
    for (let i = 0; i < len; i++) if (out[i] != null) out[i] = out[i]! / counts[i];
    return out;
  }
  for (const arr of list) {
    for (let i = 0; i < len; i++) {
      const v = arr[i];
      if (v == null) continue;
      out[i] = (out[i] ?? 0) + v;
    }
  }
  return out;
}

/** 并发池：同一 provider 内最多 limit 个上游请求 */
export async function runPool<T>(tasks: Array<() => Promise<T>>, limit = 4): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

export function makeSeries(
  def: MetricDef,
  values: (number | null)[],
  summary?: number | null,
): MetricSeries {
  return {
    key: def.key,
    group: def.group,
    unit: def.unit,
    agg: def.agg,
    chart: def.chart,
    values,
    summary: summary === undefined ? aggregate(values, def.agg) : summary,
    stack: def.stack,
  };
}

export function mergeSeries(base: MetricSeries, add: MetricSeries): MetricSeries {
  const len = base.values.length;
  return {
    ...base,
    values: combineSeries([base.values, add.values], base.agg, len),
    summary:
      base.agg === 'rate'
        ? base.summary
        : aggregate(combineSeries([base.values, add.values], base.agg, len), base.agg),
  };
}

export function toBreakdown(
  def: { key: string; titleKey: string; unit: MetricSeries['unit'] },
  rows: Map<string, number>,
  limit = 10,
): BreakdownItem {
  const sorted = [...rows.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const total = sorted.reduce((a, b) => a + b[1], 0);
  return {
    key: def.key,
    titleKey: def.titleKey,
    unit: def.unit,
    rows: sorted.map(([label, value]) => ({
      label,
      value,
      percent: total > 0 ? (value / total) * 100 : 0,
    })),
  };
}

export function isBasicWanted(groups: Set<MetricGroup>, def: MetricDef): boolean {
  return groups.has(def.group) || (groups.has('overview') && !!def.basic);
}
