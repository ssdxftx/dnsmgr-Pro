import type { ProviderCatalog } from './types.js';

/**
 * 阿里云 ESA 的统计能力以官方「数据分析字段」为准：
 * `DescribeSiteTimeSeriesData` 的 FieldName 只提供 Traffic / Requests / RequestTraffic / PageView，
 * EdgeResponseStatusCode、EdgeCacheStatus 这类属于维度而非指标。
 *
 * 早前这里按 CDN 的思路写了 Bandwidth / HitRate / OriginTraffic，
 * 上游并不认这些指标名，结果是详情页大面积为空。
 */
export const aliyunEsaCatalog: ProviderCatalog = {
  route: 'aliyun_esa',
  name: '阿里云 ESA',
  icon: 'aliyun',
  tone: 'warning',
  delayMinutes: 5,
  siteScoped: true,
  groups: ['overview', 'traffic', 'request'],
  // 卡片固定 4 项且都有真实数据；上游不提供的带宽 / 命中率不再占位成「—」
  basicKeys: ['flux', 'req', 'req_flux', 'pv'],
  filters: ['domain'],
  metrics: [
    {
      key: 'flux',
      group: 'traffic',
      unit: 'byte',
      agg: 'sum',
      chart: 'area',
      basic: true,
      api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'Traffic' } },
    },
    {
      key: 'req_flux',
      group: 'traffic',
      unit: 'byte',
      agg: 'sum',
      chart: 'area',
      basic: true,
      api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'RequestTraffic' } },
    },
    {
      key: 'req',
      group: 'request',
      unit: 'count',
      agg: 'sum',
      chart: 'line',
      basic: true,
      api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'Requests' } },
    },
    {
      key: 'pv',
      group: 'request',
      unit: 'count',
      agg: 'sum',
      chart: 'line',
      basic: true,
      api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'PageView' } },
    },
  ],
  breakdowns: [],
};
