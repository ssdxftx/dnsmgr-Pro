import { TencentCloud } from '../../../clients/TencentCloud.js';
import type { ProviderCatalog } from '../catalog/types.js';
import type { BreakdownItem, MetricSeries } from '../catalog/result.js';
import {
  aggregate,
  alignByTimestamp,
  bucketMaxByTimestamp,
  combineSeries,
  isBasicWanted,
  makeSeries,
  runPool,
  toBreakdown,
  type TimePoint,
  type Timeline,
} from './shared.js';
import type { DetailContext, DetailPart } from './tencentEdgeOne.js';

function formatTime(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toAreaList(serviceArea?: string | null): string[] {
  if (serviceArea === 'overseas' || serviceArea === 'outside_mainland_china') return ['overseas'];
  if (serviceArea === 'global') return ['mainland', 'overseas'];
  return ['mainland'];
}

function extractPoints(resp: any, origin: boolean, timeline: Timeline): TimePoint[] {
  const list = origin ? resp?.Data?.[0]?.OriginData?.[0]?.DetailData : resp?.Data?.[0]?.CdnData?.[0]?.DetailData;
  if (!Array.isArray(list)) return [];
  return list.map((it: any, i: number) => {
    const rawTs = Number(it?.Time);
    const value = Number(it?.Value);
    const ts = Number.isFinite(rawTs) && rawTs > 0 ? rawTs * 1000 : timeline.start.getTime() + i * timeline.stepMs;
    return { ts, value: Number.isFinite(value) ? value : NaN };
  });
}

export async function fetchTencentCdnDetail(
  catalog: ProviderCatalog,
  ctx: DetailContext,
): Promise<DetailPart> {
  const client = new TencentCloud(
    ctx.config.SecretId,
    ctx.config.SecretKey,
    'cdn.tencentcloudapi.com',
    'cdn',
    '2018-06-06',
  );
  const { timeline } = ctx;
  const errors: string[] = [];
  let requests = 0;
  const len = timeline.labels.length;

  const defs = catalog.metrics.filter((m) => isBasicWanted(ctx.groups, m) && m.api);

  const collected = new Map<string, (number | null)[]>();
  const rateLists = new Map<string, (number | null)[][]>();
  const domainTotals = new Map<string, number>();

  type Job = { key: string; domain: string; area: string; interval: string; metric: string; origin: boolean };
  const jobs: Job[] = [];
  for (const d of ctx.domains) {
    for (const area of toAreaList(d.serviceArea)) {
      for (const def of defs) {
        if (!def.api?.metric) continue;
        const isOrigin = def.api.action === 'DescribeOriginData';
        let interval = timeline.interval as string;
        if (def.api.interval === '5min' && timeline.interval === 'hour') interval = '5min';
        jobs.push({ key: def.key, domain: d.name, area, interval, metric: def.api.metric, origin: isOrigin });
      }
    }
  }

  await runPool(
    jobs.map((job) => async () => {
      requests++;
      try {
        const resp = await client.request(job.origin ? 'DescribeOriginData' : 'DescribeCdnData', {
          StartTime: formatTime(timeline.start),
          EndTime: formatTime(timeline.end),
          Metric: job.metric,
          Interval: job.interval,
          Domains: [job.domain],
          Area: job.area,
        });
        const points = extractPoints(resp, job.origin, timeline);
        if (!points.length) return;
        const isPeak = job.interval === '5min' && timeline.interval === 'hour';
        const values = isPeak
          ? bucketMaxByTimestamp(points, timeline)
          : alignByTimestamp(points, timeline);
        const def = defs.find((m) => m.key === job.key);
        if (def?.agg === 'rate') {
          const list = rateLists.get(job.key) || [];
          list.push(values);
          rateLists.set(job.key, list);
        } else {
          const prev = collected.get(job.key);
          collected.set(job.key, prev ? combineSeries([prev, values], 'sum', len) : values);
        }
        if (job.key === 'flux') {
          const total = aggregate(values, 'sum') || 0;
          domainTotals.set(job.domain, (domainTotals.get(job.domain) || 0) + total);
        }
      } catch (e: any) {
        errors.push(`${job.domain} ${job.key}: ${e?.message || e}`);
      }
    }),
    4,
  );

  // 百分比指标跨域名按流量加权，避免直接求和把命中率放大数倍
  for (const [key, list] of rateLists) {
    const weight = collected.get('flux');
    const out = new Array<number | null>(len).fill(null);
    for (let i = 0; i < len; i++) {
      let num = 0;
      let den = 0;
      for (const arr of list) {
        const v = arr[i];
        if (v == null) continue;
        const w = weight?.[i] ?? 1;
        num += v * w;
        den += w;
      }
      out[i] = den > 0 ? num / den : null;
    }
    collected.set(key, out);
  }

  const series: MetricSeries[] = [];
  for (const def of defs) {
    const values = collected.get(def.key);
    if (!values) continue;
    const summary =
      def.agg === 'max'
        ? aggregate(values, 'max')
        : def.agg === 'rate'
          ? aggregate(values, 'avg')
          : aggregate(values, def.agg);
    const weight =
      def.agg === 'rate'
        ? aggregate(collected.get(def.key === 'hit_rate_req' ? 'req' : 'flux') || [], 'sum') ?? 0
        : undefined;
    series.push({ ...makeSeries(def, values, summary), ...(weight === undefined ? {} : { weight }) });
  }

  const breakdowns: BreakdownItem[] = [];
  if (domainTotals.size) {
    const def = catalog.breakdowns.find((b) => b.key === 'domain');
    if (def) breakdowns.push(toBreakdown(def, domainTotals, def.limit || 10));
  }

  return { series, breakdowns, errors, requests };
}
