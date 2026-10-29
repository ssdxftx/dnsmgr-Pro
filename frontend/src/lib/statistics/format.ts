export type MetricUnit = 'byte' | 'bps' | 'count' | 'percent' | 'ms' | 'qps';

export const EMPTY = '—';

function valid(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function formatBytes(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = value;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(2)} ${units[i]}`;
}

export function formatBitRate(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  if (value <= 0) return '0 Mbps';
  const mbps = value / 1024 / 1024;
  if (mbps >= 1024) return `${(mbps / 1024).toFixed(2)} Gbps`;
  return `${mbps >= 100 ? mbps.toFixed(0) : mbps.toFixed(2)} Mbps`;
}

export function formatCount(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  return Math.round(value).toLocaleString('en-US');
}

export function formatPercent(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  return `${value.toFixed(1)}%`;
}

export function formatMs(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

export function formatQps(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  return value.toFixed(2);
}

export function formatMetric(value: number | null | undefined, unit: MetricUnit): string {
  switch (unit) {
    case 'byte':
      return formatBytes(value);
    case 'bps':
      return formatBitRate(value);
    case 'count':
      return formatCount(value);
    case 'percent':
      return formatPercent(value);
    case 'ms':
      return formatMs(value);
    case 'qps':
      return formatQps(value);
  }
}

/** 坐标轴专用：按量级固定小数位，保证同一轴刻度对齐（避免 150 ms 与 90.0 ms 混排） */
export function msAxisFormatter(digits: number): (value: number) => string {
  return (value: number) =>
    Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(digits)} ms`;
}
