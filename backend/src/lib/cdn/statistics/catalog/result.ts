import type {
  ChartType,
  MetricAgg,
  MetricGroup,
  MetricUnit,
  TimeInterval,
} from './types.js';

export interface MetricSeries {
  key: string;
  group: MetricGroup;
  unit: MetricUnit;
  agg: MetricAgg;
  chart: ChartType;
  /** 与时序标签等长；缺失点为 null 而不是 0 */
  values: (number | null)[];
  /** 汇总值；全部缺失时为 null */
  summary: number | null;
  /** 堆叠分组名，同组堆叠 */
  stack?: string;
}

export interface ProviderCard {
  route: string;
  name: string;
  tone: string;
  status: 'ok' | 'partial' | 'empty' | 'error' | 'timeout';
  accountCount: number;
  domainCount: number;
  /** 固定 5 项：flux / bw / bs_flux / req / hit_rate */
  basics: Array<{ key: string; unit: MetricUnit; value: number | null }>;
  error?: string;
  /** 数据截止时间（已扣除上游延迟） */
  dataUntil: string;
  cached: boolean;
  tookMs: number;
}

export interface BreakdownItem {
  key: string;
  titleKey: string;
  unit: MetricUnit;
  rows: Array<{ label: string; value: number; percent: number }>;
}

export interface DetailResponse {
  route: string;
  labels: string[];
  interval: TimeInterval;
  series: MetricSeries[];
  breakdowns: BreakdownItem[];
  meta: {
    status: 'ok' | 'partial' | 'empty' | 'error';
    dataUntil: string;
    delayMinutes: number;
    cached: boolean;
    tookMs: number;
  };
  _errors?: string[];
}
