export interface ResourceSummary {
  /** 访问带宽峰值（小时粒度取 5min 峰值；天粒度为日均带宽） */
  bw: number;
  /** 带宽统计粒度：day 时卡片文案应显示「日均带宽」 */
  bw_interval?: 'hour' | 'day';
  /** 回源带宽峰值 */
  bs_bw: number;
  /** 访问流量（响应 + 客户端请求） */
  flux: number;
  /** 响应下行流量（与缓存命中流量同源，用于命中率分母） */
  out_flux?: number;
  /** 回源流量 */
  bs_flux: number;
}

export interface ResourceDetail {
  bw: number[];
  bs_bw: number[];
  flux: number[];
  bs_flux: number[];
  out_flux?: number[];
}

export interface ResourceStatistics {
  resource_summary: ResourceSummary;
  resource_detail: ResourceDetail;
}

export interface VisitsSummary {
  /** 请求总数 */
  req_num: number;
  /** 命中流量 */
  hit_flux: number;
  /** 请求命中次数 */
  hit_num: number;
  /** 回源请求数 */
  bs_num: number;
}

export interface VisitsDetail {
  req_num: number[];
  hit_flux: number[];
  hit_num: number[];
  bs_num: number[];
}

export interface VisitsStatistics {
  visits_summary: VisitsSummary;
  visits_detail: VisitsDetail;
}

export interface HttpCodeStatusStatistics {
  /** [2xx, 3xx, 4xx, 5xx] */
  status_summary: number[];
  status_detail: number[][];
  /** 回源状态码 */
  bs_status_summary: number[];
  bs_status_detail: number[][];
}

export interface CdnStatisticsResult {
  labels: string[];
  resource?: ResourceStatistics;
  visits?: VisitsStatistics;
  status?: HttpCodeStatusStatistics;
}

export interface StatisticsDomain {
  name: string;
  route: string;
  zoneId?: string | null;
  serviceArea?: string | null;
}
