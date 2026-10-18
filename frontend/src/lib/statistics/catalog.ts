export interface ProviderMeta {
  route: string;
  name: string;
  tone: 'primary' | 'info' | 'success' | 'warning';
  icon: 'tencent' | 'aliyun';
  groups: string[];
  delayMinutes: number;
  filters: string[];
  siteScoped: boolean;
  topDims: string[];
}

export interface ChartConfig {
  keys: string[];
  dual?: boolean;
  stack?: boolean;
  chart?: 'line' | 'bar' | 'area';
}

export const PROVIDERS: Record<string, ProviderMeta> = {
  tencent_edgeone: {
    route: 'tencent_edgeone',
    name: '腾讯云 EdgeOne',
    tone: 'primary',
    icon: 'tencent',
    groups: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin', 'status', 'performance', 'top'],
    delayMinutes: 10,
    filters: ['domain', 'url', 'referer', 'resourceType', 'protocol', 'statusCode', 'country', 'isp'],
    siteScoped: true,
    topDims: ['domain', 'url', 'referer', 'country', 'province', 'statusCode', 'resourceType', 'clientIp', 'device', 'browser', 'os'],
  },
  tencent_cdn: {
    route: 'tencent_cdn',
    name: '腾讯云 CDN',
    tone: 'info',
    icon: 'tencent',
    groups: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin', 'status'],
    delayMinutes: 5,
    filters: ['domain'],
    siteScoped: false,
    topDims: ['domain'],
  },
  aliyun_cdn: {
    route: 'aliyun_cdn',
    name: '阿里云 CDN',
    tone: 'success',
    icon: 'aliyun',
    groups: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin', 'status', 'top'],
    delayMinutes: 5,
    filters: ['domain'],
    siteScoped: false,
    topDims: ['url', 'referer'],
  },
  aliyun_esa: {
    route: 'aliyun_esa',
    name: '阿里云 ESA',
    tone: 'warning',
    icon: 'aliyun',
    groups: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin'],
    delayMinutes: 5,
    filters: ['domain'],
    siteScoped: true,
    topDims: [],
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);

export const GROUP_CHARTS: Record<string, Record<string, ChartConfig[]>> = {
  tencent_edgeone: {
    overview: [{ keys: ['flux_out', 'bw'], dual: true }],
    traffic: [{ keys: ['flux_out', 'flux_in', 'flux'] }],
    bandwidth: [{ keys: ['bw', 'bw_out', 'bw_in'] }],
    request: [{ keys: ['req', 'req_rate'], dual: true }],
    cache: [
      { keys: ['cache_flux_hit', 'cache_flux_miss', 'cache_flux_dynamic'], chart: 'bar', stack: true },
      { keys: ['hit_rate_flux'] },
    ],
    origin: [
      { keys: ['bs_flux', 'origin_flux_out'] },
      { keys: ['origin_bw_in', 'origin_bw_out'] },
      { keys: ['origin_req'] },
    ],
    status: [{ keys: ['sc_2xx', 'sc_3xx', 'sc_4xx', 'sc_5xx'], chart: 'bar', stack: true }],
    performance: [{ keys: ['resp_time', 'ttfb'] }],
    top: [],
  },
  tencent_cdn: {
    overview: [{ keys: ['flux', 'bw'], dual: true }],
    traffic: [{ keys: ['flux'] }],
    bandwidth: [{ keys: ['bw'] }],
    request: [{ keys: ['req'] }],
    cache: [{ keys: ['hit_flux'], chart: 'bar' }, { keys: ['hit_rate', 'hit_rate_req'] }],
    origin: [{ keys: ['bs_flux'] }, { keys: ['origin_bw'] }, { keys: ['origin_req'] }],
    status: [{ keys: ['sc_2xx', 'sc_3xx', 'sc_4xx', 'sc_5xx'], chart: 'bar', stack: true }],
  },
  aliyun_cdn: {
    overview: [{ keys: ['flux', 'bw'], dual: true }],
    traffic: [{ keys: ['flux'] }],
    bandwidth: [{ keys: ['bw'] }],
    request: [{ keys: ['req', 'qps'], dual: true }],
    cache: [{ keys: ['hit_flux'], chart: 'bar' }, { keys: ['hit_rate'] }],
    origin: [{ keys: ['origin_flux'] }, { keys: ['origin_bw'] }],
    status: [{ keys: ['sc_2xx', 'sc_3xx', 'sc_4xx', 'sc_5xx'], chart: 'bar', stack: true }],
    top: [],
  },
  aliyun_esa: {
    overview: [{ keys: ['flux', 'bw'], dual: true }],
    traffic: [{ keys: ['flux'] }],
    bandwidth: [{ keys: ['bw'] }],
    request: [{ keys: ['req', 'qps'], dual: true }],
    cache: [{ keys: ['hit_flux'], chart: 'bar' }, { keys: ['hit_rate'] }],
    origin: [{ keys: ['bs_flux'] }, { keys: ['origin_bw'] }],
  },
};

export const GROUP_BREAKDOWNS: Record<string, Record<string, string[]>> = {
  tencent_edgeone: {
    overview: ['domain'],
    traffic: ['domain'],
    top: ['domain', 'url', 'statusCode'],
  },
  tencent_cdn: {
    overview: ['domain'],
    traffic: ['domain'],
  },
  aliyun_cdn: {
    overview: ['url'],
    top: ['url', 'referer'],
  },
  aliyun_esa: {},
};

export function metricLabelKey(key: string): string {
  return `statistics.metric.${key}`;
}
