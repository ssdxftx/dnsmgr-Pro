import { TencentCloud } from '../../../clients/TencentCloud.js';
import type { MetricGroup, ProviderCatalog } from '../catalog/types.js';
import type { BreakdownItem, MetricSeries } from '../catalog/result.js';
import type { StatisticsDomain } from '../types.js';
import {
  aggregate,
  alignByTimestamp,
  bucketMaxByTimestamp,
  combineSeries,
  isBasicWanted,
  makeSeries,
  rateSeries,
  toBreakdown,
  type TimePoint,
  type Timeline,
} from './shared.js';

export interface DetailContext {
  config: Record<string, any>;
  domains: StatisticsDomain[];
  timeline: Timeline;
  groups: Set<MetricGroup>;
  filters: Record<string, string[]>;
  top: string[];
}

export interface DetailPart {
  series: MetricSeries[];
  breakdowns: BreakdownItem[];
  errors: string[];
  requests: number;
}

function formatTime(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** EO 时序：Integer 在 TypeValue[].Detail，Float 在 TypeValue[].FloatTypeValue */
export function extractEoPoints(resp: any, metricName: string): TimePoint[] {
  const records = resp?.Data || resp?.TimingDataRecords || [];
  const points: TimePoint[] = [];
  for (const rec of records || []) {
    for (const tv of rec?.TypeValue || []) {
      if (tv?.MetricName !== metricName) continue;
      const buckets = [
        ...(Array.isArray(tv?.Detail) ? tv.Detail : []),
        ...(Array.isArray(tv?.FloatTypeValue) ? tv.FloatTypeValue : []),
      ];
      for (const item of buckets) {
        const ts = Number(item?.Timestamp);
        const value = Number(item?.Value);
        if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
        points.push({ ts: ts * 1000, value });
      }
    }
  }
  return points;
}

export async function fetchEdgeOneDetail(
  catalog: ProviderCatalog,
  ctx: DetailContext,
): Promise<DetailPart> {
  const client = new TencentCloud(
    ctx.config.SecretId,
    ctx.config.SecretKey,
    'teo.tencentcloudapi.com',
    'teo',
    '2022-09-01',
  );
  const { timeline } = ctx;
  const series: MetricSeries[] = [];
  const breakdowns: BreakdownItem[] = [];
  const errors: string[] = [];
  let requests = 0;

  const filters = Object.entries(ctx.filters)
    .filter(([, values]) => values.length)
    .map(([key, values]) => ({ Key: key, Operator: 'equals', Value: values }));
  const base = {
    ZoneIds: [] as string[],
    StartTime: formatTime(timeline.start),
    EndTime: formatTime(timeline.end),
    Interval: timeline.interval,
    ...(filters.length ? { Filters: filters } : {}),
  };

  const zoneIds = Array.from(
    new Set(ctx.domains.map((d) => d.zoneId).filter((z): z is string => !!z)),
  );
  if (!zoneIds.length) {
    return { series, breakdowns, errors: ['该服务商没有可查询的站点'], requests };
  }

  const wantTraffic =
    ['overview', 'traffic', 'bandwidth', 'request', 'performance'].some((g) =>
      ctx.groups.has(g as MetricGroup),
    ) || catalog.metrics.some((m) => isBasicWanted(ctx.groups, m) && ['traffic', 'bandwidth', 'request'].includes(m.group));
  const wantCache = catalog.metrics.some((m) => isBasicWanted(ctx.groups, m) && m.group === 'cache');
  const wantOrigin = catalog.metrics.some((m) => isBasicWanted(ctx.groups, m) && m.group === 'origin');
  const wantStatus = ctx.groups.has('status');
  const wantPerformance = ctx.groups.has('performance');

  async function call(
    action: string,
    params: Record<string, any>,
    label: string,
    zoneId: string,
  ): Promise<any | null> {
    requests++;
    try {
      return await client.request(action, { ...params, ZoneIds: [zoneId] });
    } catch (e: any) {
      errors.push(`${label}: ${e?.message || e}`);
      return null;
    }
  }

  const accessPoints = new Map<string, TimePoint[]>();
  const originPoints = new Map<string, TimePoint[]>();
  const cachePoints = new Map<string, TimePoint[]>();
  const statusPoints = new Map<string, TimePoint[]>();
  let cacheFallback = false;

  const accessMetrics = [
    'l7Flow_flux',
    'l7Flow_outFlux',
    'l7Flow_inFlux',
    'l7Flow_bandwidth',
    'l7Flow_outBandwidth',
    'l7Flow_inBandwidth',
    'l7Flow_request',
    'l7Flow_requestRate',
    'l7Flow_avgResponseTime',
    'l7Flow_avgFirstByteResponseTime',
  ];

  for (const zoneId of zoneIds) {
    if (wantTraffic || wantPerformance) {
      const resp = await call('DescribeTimingL7AnalysisData', { ...base, MetricNames: accessMetrics }, '访问指标', zoneId);
      if (resp) {
        for (const name of accessMetrics) {
          const pts = extractEoPoints(resp, name);
          if (pts.length) accessPoints.set(name, [...(accessPoints.get(name) || []), ...pts]);
        }
      }
    }

    if (wantTraffic && timeline.interval === 'hour') {
      for (const name of ['l7Flow_bandwidth', 'l7Flow_outBandwidth', 'l7Flow_inBandwidth']) {
        const resp = await call(
          'DescribeTimingL7AnalysisData',
          { ...base, MetricNames: [name], Interval: '5min' },
          '带宽峰值',
          zoneId,
        );
        if (!resp) continue;
        const pts = extractEoPoints(resp, name);
        if (!pts.length) continue;
        const bucketed = bucketMaxByTimestamp(pts, timeline);
        // 5min 峰值覆盖原小时均值：用已分桶的序列重建（空桶用 NaN，对齐时保持 null）
        accessPoints.set(
          name,
          bucketed.map((v, i) => ({
            ts: timeline.start.getTime() + i * timeline.stepMs,
            value: v == null ? NaN : v,
          })),
        );
      }
    }

    if (wantOrigin) {
      const originMetrics = [
        'l7Flow_inFlux_hy',
        'l7Flow_outFlux_hy',
        'l7Flow_inBandwidth_hy',
        'l7Flow_outBandwidth_hy',
        'l7Flow_request_hy',
      ];
      const resp = await call('DescribeTimingL7OriginPullData', { ...base, MetricNames: originMetrics }, '回源指标', zoneId);
      if (resp) {
        for (const name of originMetrics) {
          const pts = extractEoPoints(resp, name);
          if (pts.length) originPoints.set(name, [...(originPoints.get(name) || []), ...pts]);
        }
      }
    }

    if (wantCache) {
      for (const cacheType of ['hit', 'miss', 'dynamic']) {
        const resp = await call(
          'DescribeTimingL7CacheData',
          {
            ...base,
            MetricNames: ['l7Cache_outFlux', 'l7Cache_request'],
            Filters: [...filters, { Key: 'cacheType', Operator: 'equals', Value: [cacheType] }],
          },
          `缓存指标(${cacheType})`,
          zoneId,
        );
        if (!resp) continue;
        for (const name of ['l7Cache_outFlux', 'l7Cache_request']) {
          const pts = extractEoPoints(resp, name);
          if (pts.length) {
            const key = `${name}:${cacheType}`;
            cachePoints.set(key, [...(cachePoints.get(key) || []), ...pts]);
          }
        }
      }
      if (!cachePoints.size) {
        cacheFallback = true;
        const resp = await call(
          'DescribeTimingL7AnalysisData',
          {
            ...base,
            MetricNames: ['l7Flow_outFlux'],
            Filters: [...filters, { Key: 'cacheType', Operator: 'equals', Value: ['hit'] }],
          },
          '缓存命中(降级)',
          zoneId,
        );
        if (resp) {
          const pts = extractEoPoints(resp, 'l7Flow_outFlux');
          if (pts.length) cachePoints.set('l7Flow_outFlux:hit', pts);
        }
      }
    }

    if (wantStatus) {
      for (const code of ['2XX', '3XX', '4XX', '5XX']) {
        const resp = await call(
          'DescribeTimingL7AnalysisData',
          { ...base, MetricNames: ['l7Flow_request'], Filters: [...filters, { Key: 'statusCode', Operator: 'equals', Value: [code] }] },
          `状态码 ${code}`,
          zoneId,
        );
        if (resp) {
          const pts = extractEoPoints(resp, 'l7Flow_request');
          if (pts.length) statusPoints.set(`edge:${code}`, [...(statusPoints.get(`edge:${code}`) || []), ...pts]);
        }
        const originResp = await call(
          'DescribeTimingL7OriginPullData',
          { ...base, MetricNames: ['l7Flow_request_hy'], Filters: [...filters, { Key: 'originStatusCode', Operator: 'equals', Value: [code] }] },
          `回源状态码 ${code}`,
          zoneId,
        );
        if (originResp) {
          const pts = extractEoPoints(originResp, 'l7Flow_request_hy');
          if (pts.length) statusPoints.set(`origin:${code}`, [...(statusPoints.get(`origin:${code}`) || []), ...pts]);
        }
      }
    }
  }

  // 概览主图额外需要响应流量/带宽，它们不属于 basic 但属于首屏
  const overviewExtras = new Set(['flux_out', 'flux_in', 'bw_out', 'bw_in']);
  const seriesOf = (key: string, points: TimePoint[] | undefined, aggOverride?: 'max'): MetricSeries | null => {
    const def = catalog.metrics.find((m) => m.key === key);
    const wanted = def && (isBasicWanted(ctx.groups, def) || (ctx.groups.has('overview') && overviewExtras.has(key)));
    if (!def || !wanted) return null;
    const values = points?.length
      ? aggOverride === 'max'
        ? bucketMaxByTimestamp(points, timeline)
        : alignByTimestamp(points, timeline, def.agg === 'avg' ? 'avg' : 'sum')
      : new Array<number | null>(timeline.labels.length).fill(null);
    return makeSeries(def, values);
  };

  const add = (s: MetricSeries | null) => {
    if (s) series.push(s);
  };

  add(seriesOf('flux', accessPoints.get('l7Flow_flux')));
  add(seriesOf('flux_out', accessPoints.get('l7Flow_outFlux')));
  add(seriesOf('flux_in', accessPoints.get('l7Flow_inFlux')));
  add(seriesOf('bw', accessPoints.get('l7Flow_bandwidth'), 'max'));
  add(seriesOf('bw_out', accessPoints.get('l7Flow_outBandwidth'), 'max'));
  add(seriesOf('bw_in', accessPoints.get('l7Flow_inBandwidth'), 'max'));
  add(seriesOf('req', accessPoints.get('l7Flow_request')));
  add(seriesOf('req_rate', accessPoints.get('l7Flow_requestRate')));
  add(seriesOf('resp_time', accessPoints.get('l7Flow_avgResponseTime')));
  add(seriesOf('ttfb', accessPoints.get('l7Flow_avgFirstByteResponseTime')));
  add(seriesOf('bs_flux', originPoints.get('l7Flow_inFlux_hy')));
  add(seriesOf('origin_flux_out', originPoints.get('l7Flow_outFlux_hy')));
  add(seriesOf('origin_bw_in', originPoints.get('l7Flow_inBandwidth_hy'), 'max'));
  add(seriesOf('origin_bw_out', originPoints.get('l7Flow_outBandwidth_hy'), 'max'));
  add(seriesOf('origin_req', originPoints.get('l7Flow_request_hy')));

  const empty = () => new Array<number | null>(timeline.labels.length).fill(null);
  const cacheFlux = {
    hit: cachePoints.get('l7Cache_outFlux:hit'),
    miss: cachePoints.get('l7Cache_outFlux:miss'),
    dynamic: cachePoints.get('l7Cache_outFlux:dynamic'),
  };
  const cacheReq = {
    hit: cachePoints.get('l7Cache_request:hit'),
    miss: cachePoints.get('l7Cache_request:miss'),
  };
  const hitFluxValues = cacheFlux.hit
    ? alignByTimestamp(cacheFlux.hit, timeline)
    : cacheFallback && cachePoints.get('l7Flow_outFlux:hit')
      ? alignByTimestamp(cachePoints.get('l7Flow_outFlux:hit')!, timeline)
      : empty();
  const missFluxValues = cacheFlux.miss
    ? alignByTimestamp(cacheFlux.miss, timeline)
    : cacheFallback
      ? alignByTimestamp(accessPoints.get('l7Flow_outFlux') || [], timeline).map((total, i) => {
          const hit = hitFluxValues[i];
          return total == null || hit == null ? null : Math.max(0, total - hit);
        })
      : empty();
  const dynamicFluxValues = cacheFlux.dynamic
    ? alignByTimestamp(cacheFlux.dynamic, timeline)
    : empty();
  const hitReqValues = cacheReq.hit ? alignByTimestamp(cacheReq.hit, timeline) : empty();
  const missReqValues = cacheReq.miss ? alignByTimestamp(cacheReq.miss, timeline) : empty();
  const totalFluxValues = combineSeries([hitFluxValues, missFluxValues, dynamicFluxValues], 'sum', timeline.labels.length);
  const totalReqValues = combineSeries([hitReqValues, missReqValues], 'sum', timeline.labels.length);
  const hitRateFlux = rateSeries(hitFluxValues, totalFluxValues);
  const hitRateReq = rateSeries(hitReqValues, totalReqValues);

  const pushCache = (key: string, values: (number | null)[], summary?: number | null) => {
    const def = catalog.metrics.find((m) => m.key === key);
    if (!def || !isBasicWanted(ctx.groups, def)) return;
    series.push(makeSeries(def, values, summary));
  };
  const pushRate = (key: string, values: (number | null)[], summary: number | null, weight: number) => {
    const def = catalog.metrics.find((m) => m.key === key);
    if (!def || !isBasicWanted(ctx.groups, def)) return;
    series.push({ ...makeSeries(def, values, summary), weight });
  };

  if (wantCache) {
    pushCache('cache_flux_hit', hitFluxValues);
    pushCache('cache_flux_miss', missFluxValues);
    pushCache('cache_flux_dynamic', dynamicFluxValues);
    pushCache('cache_req_hit', hitReqValues);
    pushCache('cache_req_miss', missReqValues);
  }
  const rateSummary = (hit: (number | null)[], total: (number | null)[]): number | null => {
    const h = aggregate(hit, 'sum');
    const t = aggregate(total, 'sum');
    if (h == null || t == null || t === 0) return null;
    return (h / t) * 100;
  };
  const fluxWeight = aggregate(totalFluxValues, 'sum') ?? 0;
  const reqWeight = aggregate(totalReqValues, 'sum') ?? 0;
  pushRate('hit_rate_flux', hitRateFlux, rateSummary(hitFluxValues, totalFluxValues), fluxWeight);
  pushRate('hit_rate_req', hitRateReq, rateSummary(hitReqValues, totalReqValues), reqWeight);

  if (wantStatus) {
    for (const code of ['2XX', '3XX', '4XX', '5XX']) {
      const def = catalog.metrics.find((m) => m.key === `sc_${code.slice(0, 1).toLowerCase()}xx`);
      if (def && isBasicWanted(ctx.groups, def)) {
        const pts = statusPoints.get(`edge:${code}`);
        series.push(makeSeries(def, pts ? alignByTimestamp(pts, timeline) : empty()));
      }
      const odef = catalog.metrics.find((m) => m.key === `origin_sc_${code.slice(0, 1).toLowerCase()}xx`);
      if (odef && isBasicWanted(ctx.groups, odef)) {
        const pts = statusPoints.get(`origin:${code}`);
        series.push(makeSeries(odef, pts ? alignByTimestamp(pts, timeline) : empty()));
      }
    }
  }

  if (ctx.top.length) {
    const wanted = ctx.top;
    for (const key of wanted) {
      const def = catalog.breakdowns.find((b) => b.key === key);
      if (!def) continue;
      const rows = new Map<string, number>();
      for (const zoneId of zoneIds) {
        requests++;
        try {
          const resp = await client.request('DescribeTopL7AnalysisData', {
            ZoneIds: [zoneId],
            StartTime: formatTime(timeline.start),
            EndTime: formatTime(timeline.end),
            MetricName: def.metricName,
            Limit: Math.min(100, def.limit || 10),
          });
          for (const rec of resp?.Data || []) {
            for (const item of rec?.DetailData || []) {
              const label = String(item?.Key ?? '');
              const value = Number(item?.Value);
              if (!label || !Number.isFinite(value)) continue;
              rows.set(label, (rows.get(label) || 0) + value);
            }
          }
        } catch (e: any) {
          errors.push(`${def.titleKey}: ${e?.message || e}`);
        }
      }
      if (rows.size) breakdowns.push(toBreakdown(def, rows, def.limit || 10));
    }
  }

  return { series, breakdowns, errors, requests };
}
