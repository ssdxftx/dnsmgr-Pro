import { Aliyun } from '../../../clients/Aliyun.js';
import type { ProviderCatalog } from '../catalog/types.js';
import type { MetricSeries } from '../catalog/result.js';
import {
  alignByTimestamp,
  isBasicWanted,
  makeSeries,
  type TimePoint,
  type Timeline,
} from './shared.js';
import type { DetailContext, DetailPart } from './tencentEdgeOne.js';

function formatIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function pickPoints(data: any[], fieldName: string, timeline: Timeline): TimePoint[] {
  for (const item of data || []) {
    if (item?.FieldName !== fieldName) continue;
    const detail = item?.DetailData;
    if (!Array.isArray(detail)) continue;
    return detail.map((it: any, i: number) => {
      const raw = it?.TimeStamp ?? it?.Time;
      const parsed = raw ? Date.parse(String(raw)) : NaN;
      const ts = Number.isFinite(parsed) ? parsed : timeline.start.getTime() + i * timeline.stepMs;
      const value = Number(it?.Value);
      return { ts, value: Number.isFinite(value) ? value : NaN };
    });
  }
  return [];
}

/** 指标 key → ESA 时序接口的 FieldName（只保留官方支持的四个） */
const ESA_FIELDS: Record<string, string> = {
  flux: 'Traffic',
  req: 'Requests',
  req_flux: 'RequestTraffic',
  pv: 'PageView',
};

export async function fetchAliyunEsaDetail(
  catalog: ProviderCatalog,
  ctx: DetailContext,
): Promise<DetailPart> {
  const region = String(ctx.config.region || '').trim();
  const validRegion = /^[a-z0-9-]+$/i.test(region) ? region : 'cn-hangzhou';
  const client = new Aliyun(
    ctx.config.AccessKeyId,
    ctx.config.AccessKeySecret,
    `esa.${validRegion}.aliyuncs.com`,
    '2024-09-10',
  );
  const { timeline } = ctx;
  const len = timeline.labels.length;
  const intervalSec = timeline.interval === 'day' ? '86400' : timeline.interval === '5min' ? '300' : '3600';
  const errors: string[] = [];
  let requests = 0;

  const defs = catalog.metrics.filter((m) => isBasicWanted(ctx.groups, m));
  const wanted = defs.map((m) => m.key).filter((k) => ESA_FIELDS[k]);
  // Traffic 始终取，overview 卡片要用它做流量
  const fieldNames = Array.from(new Set(['Traffic', ...wanted.map((k) => ESA_FIELDS[k])]));
  const fields = fieldNames.map((name) => ({ FieldName: name, Dimension: ['ALL'] }));

  const siteIds = Array.from(
    new Set(ctx.domains.map((d) => d.zoneId).filter((z): z is string => !!z)),
  );
  if (!siteIds.length) {
    return { series: [], breakdowns: [], errors: ['该服务商没有可查询的站点'], requests };
  }

  const acc = new Map<string, (number | null)[]>();
  const add = (key: string, values: (number | null)[]) => {
    const prev = acc.get(key);
    if (!prev) {
      acc.set(key, values);
      return;
    }
    const merged = new Array<number | null>(len).fill(null);
    for (let i = 0; i < len; i++) {
      const a = prev[i];
      const b = values[i];
      merged[i] = a == null && b == null ? null : (a ?? 0) + (b ?? 0);
    }
    acc.set(key, merged);
  };

  for (const siteId of siteIds) {
    requests++;
    let data: any[] = [];
    try {
      const resp = await client.request({
        Action: 'DescribeSiteTimeSeriesData',
        SiteId: siteId,
        StartTime: formatIso(timeline.start),
        EndTime: formatIso(timeline.end),
        Interval: intervalSec,
        Fields: JSON.stringify(fields),
      });
      data = resp?.Data || [];
    } catch (e: any) {
      errors.push(`站点 ${siteId}: ${e?.message || e}`);
    }

    // 同一站点下多个加速域名会命中同一 SiteId：已去重，这里按站点逐项累加
    for (const key of ['flux', ...wanted.filter((k) => k !== 'flux')]) {
      const field = ESA_FIELDS[key];
      if (!field) continue;
      add(key, alignByTimestamp(pickPoints(data, field, timeline), timeline));
    }
  }

  const series: MetricSeries[] = [];
  const push = (key: string) => {
    const def = catalog.metrics.find((m) => m.key === key);
    const values = acc.get(key);
    if (!def || !values || !isBasicWanted(ctx.groups, def)) return;
    series.push(makeSeries(def, values));
  };
  for (const key of ['flux', 'req', 'req_flux', 'pv']) push(key);

  return { series, breakdowns: [], errors, requests };
}
