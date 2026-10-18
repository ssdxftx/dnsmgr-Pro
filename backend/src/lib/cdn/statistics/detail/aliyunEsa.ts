import { Aliyun } from '../../../clients/Aliyun.js';
import type { ProviderCatalog } from '../catalog/types.js';
import type { MetricSeries } from '../catalog/result.js';
import {
  alignByTimestamp,
  bucketMaxByTimestamp,
  combineSeries,
  isBasicWanted,
  makeSeries,
  rateSeries,
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
  const need = (key: string) => defs.some((m) => m.key === key);

  const fields: any[] = [{ FieldName: 'Traffic', Dimension: ['ALL'] }];
  if (need('bw')) fields.push({ FieldName: 'Bandwidth', Dimension: ['ALL'] });
  if (need('req') || need('qps')) {
    fields.push({ FieldName: 'Requests', Dimension: ['ALL'] });
    if (need('qps')) fields.push({ FieldName: 'Qps', Dimension: ['ALL'] });
  }
  if (need('hit_rate') || need('hit_flux')) fields.push({ FieldName: 'HitRate', Dimension: ['ALL'] });
  if (need('bs_flux')) fields.push({ FieldName: 'OriginTraffic', Dimension: ['ALL'] });
  if (need('origin_bw')) fields.push({ FieldName: 'OriginBandwidth', Dimension: ['ALL'] });

  const siteIds = Array.from(
    new Set(ctx.domains.map((d) => d.zoneId).filter((z): z is string => !!z)),
  );
  if (!siteIds.length) {
    return { series: [], breakdowns: [], errors: ['该服务商没有可查询的站点'], requests };
  }

  const acc = new Map<string, (number | null)[]>();
  const rateParts: Array<{ rate: (number | null)[]; weight: (number | null)[] }> = [];
  const add = (key: string, values: (number | null)[]) => {
    const prev = acc.get(key);
    acc.set(key, prev ? combineSeries([prev, values], 'sum', len) : values);
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

    const fluxSite = alignByTimestamp(pickPoints(data, 'Traffic', timeline), timeline);
    add('flux', fluxSite);
    let bwSite = need('bw') ? alignByTimestamp(pickPoints(data, 'Bandwidth', timeline), timeline) : null;
    if (need('req')) add('req', alignByTimestamp(pickPoints(data, 'Requests', timeline), timeline));
    if (need('qps')) add('qps', alignByTimestamp(pickPoints(data, 'Qps', timeline), timeline));
    if (need('bs_flux')) add('bs_flux', alignByTimestamp(pickPoints(data, 'OriginTraffic', timeline), timeline));
    if (need('origin_bw')) add('origin_bw', alignByTimestamp(pickPoints(data, 'OriginBandwidth', timeline), timeline));

    if (need('hit_rate') || need('hit_flux')) {
      const raw = alignByTimestamp(pickPoints(data, 'HitRate', timeline), timeline);
      const max = raw.reduce((m: number, v) => (v == null ? m : Math.max(m, v)), 0);
      const asRatio = max <= 1.5;
      rateParts.push({
        rate: raw.map((v) => (v == null ? null : asRatio ? v * 100 : v)),
        weight: fluxSite,
      });
    }

    // 小时视图的带宽峰值单独用 5min 查询，按小时取最大
    if (need('bw') && timeline.interval === 'hour') {
      requests++;
      try {
        const resp = await client.request({
          Action: 'DescribeSiteTimeSeriesData',
          SiteId: siteId,
          StartTime: formatIso(timeline.start),
          EndTime: formatIso(timeline.end),
          Interval: '300',
          Fields: JSON.stringify([{ FieldName: 'Bandwidth', Dimension: ['ALL'] }]),
        });
        const peaks = bucketMaxByTimestamp(pickPoints(resp?.Data || [], 'Bandwidth', timeline), timeline);
        if (peaks.some((v) => v != null)) bwSite = peaks;
      } catch (e: any) {
        errors.push(`站点 ${siteId} 带宽峰值: ${e?.message || e}`);
      }
    }
    if (bwSite) add('bw', bwSite);
  }

  const hitRate = new Array<number | null>(len).fill(null);
  for (let i = 0; i < len; i++) {
    let num = 0;
    let den = 0;
    for (const part of rateParts) {
      const v = part.rate[i];
      if (v == null) continue;
      const w = part.weight[i] ?? 1;
      num += v * w;
      den += w;
    }
    hitRate[i] = den > 0 ? num / den : null;
  }
  const flux = acc.get('flux') || new Array<number | null>(len).fill(null);
  const hitFlux = rateSeries(hitRate, new Array(len).fill(100)).map((rate, i) =>
    rate == null || flux[i] == null ? null : Math.round((flux[i]! * rate) / 100),
  );

  const series: MetricSeries[] = [];
  const push = (key: string, values: (number | null)[]) => {
    const def = catalog.metrics.find((m) => m.key === key);
    if (!def || !isBasicWanted(ctx.groups, def)) return;
    series.push(makeSeries(def, values));
  };
  push('flux', flux);
  if (acc.has('bw')) push('bw', acc.get('bw')!);
  if (acc.has('req')) push('req', acc.get('req')!);
  if (acc.has('qps')) push('qps', acc.get('qps')!);
  if (acc.has('hit_rate')) push('hit_rate', hitRate);
  push('hit_flux', hitFlux);
  if (acc.has('bs_flux')) push('bs_flux', acc.get('bs_flux')!);
  if (acc.has('origin_bw')) push('origin_bw', acc.get('origin_bw')!);

  return { series, breakdowns: [], errors, requests };
}
