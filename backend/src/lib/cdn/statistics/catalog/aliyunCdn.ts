import type { ProviderCatalog } from './types.js';

export const aliyunCdnCatalog: ProviderCatalog = {
  route: 'aliyun_cdn',
  name: '阿里云 CDN',
  icon: 'aliyun',
  tone: 'success',
  delayMinutes: 5,
  siteScoped: false,
  groups: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin', 'status', 'top'],
  filters: ['domain'],
  metrics: [
    { key: 'flux', group: 'traffic', unit: 'byte', agg: 'sum', chart: 'area', basic: true, api: { action: 'DescribeDomainUsageData', params: { Field: 'traf', Type: 'all', DataProtocol: 'all', Area: 'all' } } },
    { key: 'bw', group: 'bandwidth', unit: 'bps', agg: 'max', chart: 'line', basic: true, api: { action: 'DescribeDomainUsageData', params: { Field: 'bps', Type: 'all', DataProtocol: 'all', Area: 'all' } } },
    { key: 'req', group: 'request', unit: 'count', agg: 'sum', chart: 'line', basic: true, api: { action: 'DescribeDomainHttpCodeData' } },
    { key: 'qps', group: 'request', unit: 'qps', agg: 'avg', chart: 'line', api: { action: 'DescribeDomainQpsData' } },
    { key: 'hit_rate', group: 'cache', unit: 'percent', agg: 'rate', chart: 'line', basic: true, api: { action: 'DescribeDomainHitRateData' } },
    { key: 'hit_flux', group: 'cache', unit: 'byte', agg: 'sum', chart: 'bar', stack: 'cache' },
    { key: 'origin_flux', group: 'origin', unit: 'byte', agg: 'sum', chart: 'area', basic: true, api: { action: 'DescribeDomainSrcTrafficData' } },
    { key: 'origin_bw', group: 'origin', unit: 'bps', agg: 'max', chart: 'line', api: { action: 'DescribeDomainSrcBpsData' } },
    { key: 'sc_2xx', group: 'status', unit: 'count', agg: 'sum', chart: 'bar', stack: 'edge', api: { action: 'DescribeDomainHttpCodeData' } },
    { key: 'sc_3xx', group: 'status', unit: 'count', agg: 'sum', chart: 'bar', stack: 'edge', api: { action: 'DescribeDomainHttpCodeData' } },
    { key: 'sc_4xx', group: 'status', unit: 'count', agg: 'sum', chart: 'bar', stack: 'edge', api: { action: 'DescribeDomainHttpCodeData' } },
    { key: 'sc_5xx', group: 'status', unit: 'count', agg: 'sum', chart: 'bar', stack: 'edge', api: { action: 'DescribeDomainHttpCodeData' } },
  ],
  breakdowns: [
    { key: 'url', titleKey: 'statistics.top.url', metricName: 'DescribeDomainTopUrlVisit', unit: 'byte', limit: 10 },
    { key: 'referer', titleKey: 'statistics.top.referer', metricName: 'DescribeDomainTopReferVisit', unit: 'byte', limit: 10 },
  ],
};
