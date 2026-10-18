import type { ProviderCatalog } from './types.js';

export const aliyunEsaCatalog: ProviderCatalog = {
  route: 'aliyun_esa',
  name: '阿里云 ESA',
  icon: 'aliyun',
  tone: 'warning',
  delayMinutes: 5,
  siteScoped: true,
  groups: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin'],
  filters: ['domain'],
  metrics: [
    { key: 'flux', group: 'traffic', unit: 'byte', agg: 'sum', chart: 'area', basic: true, api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'Traffic' } } },
    { key: 'bw', group: 'bandwidth', unit: 'bps', agg: 'max', chart: 'line', basic: true, api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'Bandwidth' } } },
    { key: 'req', group: 'request', unit: 'count', agg: 'sum', chart: 'line', basic: true, api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'Requests' } } },
    { key: 'qps', group: 'request', unit: 'qps', agg: 'avg', chart: 'line', api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'Qps' } } },
    { key: 'hit_rate', group: 'cache', unit: 'percent', agg: 'rate', chart: 'line', basic: true, api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'HitRate' } } },
    { key: 'hit_flux', group: 'cache', unit: 'byte', agg: 'sum', chart: 'bar', stack: 'cache' },
    { key: 'bs_flux', group: 'origin', unit: 'byte', agg: 'sum', chart: 'area', basic: true, api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'OriginTraffic' } } },
    { key: 'origin_bw', group: 'origin', unit: 'bps', agg: 'max', chart: 'line', api: { action: 'DescribeSiteTimeSeriesData', params: { FieldName: 'OriginBandwidth' } } },
  ],
  breakdowns: [],
};
