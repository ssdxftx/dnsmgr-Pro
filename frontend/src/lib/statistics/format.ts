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

/** 图表 y 轴用同一套换算，避免卡片与图表单位不一致 */
export function axisFormatter(unit: MetricUnit): (value: number) => string {
  return (value: number) => {
    switch (unit) {
      case 'byte':
        return formatBytes(value);
      case 'bps':
        return formatBitRate(value);
      case 'count':
        return formatCount(value);
      case 'percent':
        return `${Math.round(value)}%`;
      case 'ms':
        return formatMs(value);
      case 'qps':
        return formatQps(value);
    }
  };
}

/** 带宽/流量图表按单位缩放到更易读的量级，返回缩放系数与轴名 */
export function chartScale(unit: MetricUnit): { divisor: number; label: string } {
  if (unit === 'byte') return { divisor: 1024 * 1024, label: 'MB' };
  if (unit === 'bps') return { divisor: 1024 * 1024, label: 'Mbps' };
  if (unit === 'ms') return { divisor: 1, label: 'ms' };
  if (unit === 'percent') return { divisor: 1, label: '%' };
  return { divisor: 1, label: '' };
}
