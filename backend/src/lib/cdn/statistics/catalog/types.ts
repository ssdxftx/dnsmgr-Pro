export type MetricUnit = 'byte' | 'bps' | 'count' | 'percent' | 'ms' | 'qps';
export type MetricAgg = 'sum' | 'max' | 'avg' | 'last' | 'rate';
export type ChartType = 'line' | 'area' | 'bar';
export type MetricGroup =
  | 'overview'
  | 'traffic'
  | 'bandwidth'
  | 'request'
  | 'cache'
  | 'origin'
  | 'status'
  | 'performance'
  | 'top';
export type TimeInterval = 'min' | '5min' | 'hour' | 'day';

export interface MetricApi {
  action: string;
  metric?: string;
  metricName?: string;
  params?: Record<string, any>;
  interval?: TimeInterval;
}

/** 一条可查询的指标定义 */
export interface MetricDef {
  /** 全局唯一 key，前端用它做 i18n 与选中态 */
  key: string;
  group: MetricGroup;
  unit: MetricUnit;
  agg: MetricAgg;
  chart: ChartType;
  /** 是否作为基础卡片 5 项之一 */
  basic?: boolean;
  /** 堆叠分组名，同组堆叠 */
  stack?: string;
  /** 派生指标不单独请求，由同组数据计算 */
  derived?: (values: Record<string, (number | null)[]>) => (number | null)[];
  /** 上游接口定义；派生指标可省略 */
  api?: MetricApi;
  /** 该服务商不提供时置 false，前端隐藏 */
  supported?: boolean;
}

/** 维度 / Top 数据定义 */
export interface BreakdownDef {
  key: string;
  titleKey: string;
  metricName: string;
  unit: MetricUnit;
  limit?: number;
}

export interface ProviderCatalog {
  route: string;
  name: string;
  icon: 'tencent' | 'aliyun' | 'cloudflare';
  tone: 'primary' | 'info' | 'success' | 'warning';
  metrics: MetricDef[];
  groups: MetricGroup[];
  filters: Array<
    'domain' | 'url' | 'referer' | 'resourceType' | 'protocol' | 'statusCode' | 'country' | 'isp'
  >;
  breakdowns: BreakdownDef[];
  delayMinutes: number;
  siteScoped: boolean;
  /**
   * 卡片上的基础指标顺序。不填时用全局 BASIC_KEYS（flux/bw/bs_flux/req/hit_rate）；
   * 上游只提供部分指标时（如 ESA 只有流量与请求数），用它避免卡片出现一串「—」。
   */
  basicKeys?: string[];
}
