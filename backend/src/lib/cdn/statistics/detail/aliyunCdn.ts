import { Aliyun } from '../../../clients/Aliyun.js';
import type { ProviderCatalog } from '../catalog/types.js';
import type { BreakdownItem, MetricSeries } from '../catalog/result.js';
import {
  aggregate,
  alignByTimestamp,
  bucketMaxByTimestamp,
  combineSeries,
  isBasicWanted,
  makeSeries,
  rateSeries,
  runPool,
  toBreakdown,
  type TimePoint,
  type Timeline,
} from './shared.js';
import type { DetailContext, DetailPart } from './tencentEdgeOne.js';

function formatIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toPoints(modules: any[], valueKey: string, timeline: Timeline): TimePoint[] {
  if (!Array.isArray(modules)) return [];
  return modules.map((it: any, i: number) => {
    const raw = it?.TimeStamp ?? it?.Time ?? it?.TimePoint;
    const parsed = raw ? Date.parse(String(raw)) : NaN;
    const ts = Number.isFinite(parsed) ? parsed : timeline.start.getTime() + i * timeline.stepMs;
    const value = Number(it?.[valueKey] ?? it?.Value ?? it?.HitRate);
    return { ts, value: Number.isFinite(value) ? value : NaN };
  });
}

function modulesOf(resp: any, ...keys: string[]): any[] {
  for (const key of keys) {
    const node = key.split('.').reduce<any>((acc, part) => (acc == null ? acc : acc[part]), resp);
    if (Array.isArray(node)) return node;
  }
  return [];
}

export async function fetchAliyunCdnDetail(
  catalog: ProviderCatalog,
  ctx: DetailContext,
): Promise<DetailPart> {
  const client = new Aliyun(
    ctx.config.AccessKeyId,
    ctx.config.AccessKeySecret,
    'cdn.aliyuncs.com',
    '2018-05-10',
  );
  const { timeline } = ctx;
  const len = timeline.labels.length;
  const intervalSec = timeline.interval === 'day' ? '86400' : timeline.interval === '5min' ? '300' : '3600';
  const peakIntervalSec = timeline.interval === 'hour' ? '300' : intervalSec;
  const errors: string[] = [];
  let requests = 0;

  const defs = catalog.metrics.filter((m) => isBasicWanted(ctx.groups, m));
  const need = (key: string) => defs.some((m) => m.key === key);

  const flux = new Array<number | null>(len).fill(null);
  const bw = new Array<number | null>(len).fill(null);
  const req = new Array<number | null>(len).fill(null);
  const qps = new Array<number | null>(len).fill(null);
  const hitRate = new Array<number | null>(len).fill(null);
  const hitRateParts: (number | null)[][] = [];
  const originFlux = new Array<number | null>(len).fill(null);
  const originBw = new Array<number | null>(len).fill(null);
  const codes: Record<string, (number | null)[]> = {
    '2xx': new Array(len).fill(null),
    '3xx': new Array(len).fill(null),
    '4xx': new Array(len).fill(null),
    '5xx': new Array(len).fill(null),
  };
  const urlRows = new Map<string, number>();
  const referRows = new Map<string, number>();

  const addTo = (target: (number | null)[], values: (number | null)[]) => {
    const merged = combineSeries([target, values], 'sum', len);
    for (let i = 0; i < len; i++) target[i] = merged[i];
  };

  async function usage(domain: string, field: string, interval: string): Promise<TimePoint[]> {
    requests++;
    try {
      const resp = await client.request({
        Action: 'DescribeDomainUsageData',
        DomainName: domain,
        Field: field,
        Type: 'all',
        DataProtocol: 'all',
        Area: 'all',
        Interval: interval,
        StartTime: formatIso(timeline.start),
        EndTime: formatIso(timeline.end),
      });
      return toPoints(modulesOf(resp, 'UsageDataPerInterval.DataModule'), 'Value', timeline);
    } catch (e: any) {
      errors.push(`${domain} ${field}: ${e?.message || e}`);
      return [];
    }
  }

  async function httpCode(domain: string): Promise<any[]> {
    requests++;
    try {
      const resp = await client.request({
        Action: 'DescribeDomainHttpCodeData',
        DomainName: domain,
        Interval: intervalSec,
        StartTime: formatIso(timeline.start),
        EndTime: formatIso(timeline.end),
      });
      return modulesOf(resp, 'HttpCodeDataPerInterval.DataModule');
    } catch (e: any) {
      errors.push(`${domain} 状态码: ${e?.message || e}`);
      return [];
    }
  }

  for (const d of ctx.domains) {
    const tasks: Array<() => Promise<void>> = [];
    if (need('flux') || need('hit_rate') || need('hit_flux') || need('req')) {
      tasks.push(async () => {
        const pts = await usage(d.name, 'traf', intervalSec);
        addTo(flux, alignByTimestamp(pts, timeline));
      });
    }
    if (need('bw')) {
      tasks.push(async () => {
        const pts = await usage(d.name, 'bps', peakIntervalSec);
        addTo(bw, peakIntervalSec !== intervalSec ? bucketMaxByTimestamp(pts, timeline) : alignByTimestamp(pts, timeline, 'max'));
      });
    }
    if (need('hit_rate') || need('hit_flux')) {
      tasks.push(async () => {
        requests++;
        try {
          const resp = await client.request({
            Action: 'DescribeDomainHitRateData',
            DomainName: d.name,
            Interval: intervalSec,
            StartTime: formatIso(timeline.start),
            EndTime: formatIso(timeline.end),
          });
          const pts = toPoints(modulesOf(resp, 'HitRatePerInterval'), 'HitRate', timeline);
          hitRateParts.push(alignByTimestamp(pts, timeline, 'avg'));
        } catch (e: any) {
          errors.push(`${d.name} 命中率: ${e?.message || e}`);
        }
      });
    }
    if (need('qps')) {
      tasks.push(async () => {
        requests++;
        try {
          const resp = await client.request({
            Action: 'DescribeDomainQpsData',
            DomainName: d.name,
            Interval: intervalSec,
            StartTime: formatIso(timeline.start),
            EndTime: formatIso(timeline.end),
          });
          const pts = toPoints(modulesOf(resp, 'QpsDataPerInterval.DataModule'), 'Value', timeline);
          addTo(qps, alignByTimestamp(pts, timeline, 'avg'));
        } catch (e: any) {
          errors.push(`${d.name} QPS: ${e?.message || e}`);
        }
      });
    }
    if (need('req') || need('sc_2xx') || need('sc_3xx') || need('sc_4xx') || need('sc_5xx')) {
      tasks.push(async () => {
        const modules = await httpCode(d.name);
        const bucketReq = new Array<number | null>(len).fill(null);
        for (const m of modules) {
          const raw = m?.TimeStamp;
          const parsed = raw ? Date.parse(String(raw)) : NaN;
          const idx = Number.isFinite(parsed)
            ? Math.floor((parsed - timeline.start.getTime()) / timeline.stepMs)
            : -1;
          if (idx < 0 || idx >= len) continue;
          const value = m?.Value && typeof m.Value === 'object' ? m.Value : { all: m?.Value };
          let sum = 0;
          for (const [code, count] of Object.entries(value)) {
            const n = Number(count);
            if (!Number.isFinite(n)) continue;
            sum += n;
            const cls = /^2/.test(code) ? '2xx' : /^3/.test(code) ? '3xx' : /^4/.test(code) ? '4xx' : /^5/.test(code) ? '5xx' : '';
            if (cls) codes[cls][idx] = (codes[cls][idx] ?? 0) + n;
          }
          bucketReq[idx] = (bucketReq[idx] ?? 0) + sum;
        }
        addTo(req, bucketReq);
      });
    }
    if (need('origin_flux')) {
      tasks.push(async () => {
        requests++;
        try {
          const resp = await client.request({
            Action: 'DescribeDomainSrcTrafficData',
            DomainName: d.name,
            Interval: intervalSec,
            StartTime: formatIso(timeline.start),
            EndTime: formatIso(timeline.end),
          });
          addTo(originFlux, alignByTimestamp(toPoints(modulesOf(resp, 'SrcTrafficDataPerInterval.DataModule'), 'Value', timeline), timeline));
        } catch (e: any) {
          errors.push(`${d.name} 回源流量: ${e?.message || e}`);
        }
      });
    }
    if (need('origin_bw')) {
      tasks.push(async () => {
        requests++;
        try {
          const resp = await client.request({
            Action: 'DescribeDomainSrcBpsData',
            DomainName: d.name,
            Interval: peakIntervalSec,
            StartTime: formatIso(timeline.start),
            EndTime: formatIso(timeline.end),
          });
          const pts = toPoints(modulesOf(resp, 'SrcBpsDataPerInterval.DataModule'), 'Value', timeline);
          addTo(originBw, peakIntervalSec !== intervalSec ? bucketMaxByTimestamp(pts, timeline) : alignByTimestamp(pts, timeline, 'max'));
        } catch (e: any) {
          errors.push(`${d.name} 回源带宽: ${e?.message || e}`);
        }
      });
    }
    if (ctx.top.includes('url') || ctx.top.includes('referer')) {
      tasks.push(async () => {
        requests++;
        try {
          const resp = await client.request({
            Action: 'DescribeDomainTopUrlVisit',
            DomainName: d.name,
            SortBy: 'traf',
            StartTime: formatIso(timeline.start),
            EndTime: formatIso(timeline.end),
          });
          for (const it of resp?.UrlList || []) {
            const label = String(it?.Url ?? '');
            const value = Number(it?.Traffic ?? it?.Value ?? it?.VisitCount);
            if (label && Number.isFinite(value)) urlRows.set(label, (urlRows.get(label) || 0) + value);
          }
        } catch (e: any) {
          errors.push(`${d.name} Top URL: ${e?.message || e}`);
        }
        requests++;
        try {
          const resp = await client.request({
            Action: 'DescribeDomainTopReferVisit',
            DomainName: d.name,
            SortBy: 'traf',
            StartTime: formatIso(timeline.start),
            EndTime: formatIso(timeline.end),
          });
          for (const it of resp?.ReferList || []) {
            const label = String(it?.Refer ?? '');
            const value = Number(it?.Traffic ?? it?.Value ?? it?.VisitCount);
            if (label && Number.isFinite(value)) referRows.set(label, (referRows.get(label) || 0) + value);
          }
        } catch (e: any) {
          errors.push(`${d.name} Top Referer: ${e?.message || e}`);
        }
      });
    }
    await runPool(tasks, 4);
  }

  // 命中率跨域名按流量加权
  if (hitRateParts.length) {
    for (let i = 0; i < len; i++) {
      let num = 0;
      let den = 0;
      for (const arr of hitRateParts) {
        const v = arr[i];
        if (v == null) continue;
        const w = flux[i] ?? 1;
        num += v * w;
        den += w;
      }
      hitRate[i] = den > 0 ? num / den : null;
    }
  }

  // 请求数缺失时用 QPS 积分兜底（QPS × 桶秒数）
  const hasReq = req.some((v) => v != null);
  if (!hasReq && qps.some((v) => v != null)) {
    const seconds = timeline.stepMs / 1000;
    for (let i = 0; i < len; i++) {
      req[i] = qps[i] == null ? null : Math.round(qps[i]! * seconds);
    }
  }

  const hitFlux = rateSeries(hitRate, new Array(len).fill(100)).map((rate, i) =>
    rate == null || flux[i] == null ? null : Math.round((flux[i]! * rate) / 100),
  );

  const series: MetricSeries[] = [];
  const fluxWeight = aggregate(flux, 'sum') ?? 0;
  const push = (key: string, values: (number | null)[]) => {
    const def = catalog.metrics.find((m) => m.key === key);
    if (!def || !isBasicWanted(ctx.groups, def)) return;
    const s = makeSeries(def, values);
    series.push(def.agg === 'rate' ? { ...s, weight: fluxWeight } : s);
  };
  push('flux', flux);
  push('bw', bw);
  push('req', req);
  push('qps', qps);
  push('hit_rate', hitRate);
  push('hit_flux', hitFlux);
  push('origin_flux', originFlux);
  push('origin_bw', originBw);
  for (const cls of ['2xx', '3xx', '4xx', '5xx']) push(`sc_${cls}`, codes[cls]);

  const breakdowns: BreakdownItem[] = [];
  if (urlRows.size) {
    const def = catalog.breakdowns.find((b) => b.key === 'url');
    if (def) breakdowns.push(toBreakdown(def, urlRows, def.limit || 10));
  }
  if (referRows.size) {
    const def = catalog.breakdowns.find((b) => b.key === 'referer');
    if (def) breakdowns.push(toBreakdown(def, referRows, def.limit || 10));
  }

  return { series, breakdowns, errors, requests };
}
