import { TencentCloud } from '../../clients/TencentCloud.js';
import type { CdnStatisticsResult, StatisticsDomain } from './types.js';
import { alignSeries, buildLabels, max, sum } from './util.js';

// 访问总流量/总带宽（EdgeOne 响应 + 客户端请求），与控制台「访问流量/带宽」一致
const ACCESS_FLUX = 'l7Flow_flux';
const ACCESS_BANDWIDTH = 'l7Flow_bandwidth';
const ACCESS_REQUEST = 'l7Flow_request';
// 响应下行流量：与缓存命中流量（l7Cache_outFlux）同源，用作命中率分母
const ACCESS_OUT_FLUX = 'l7Flow_outFlux';
// 缓存命中流量：需走 DescribeTimingL7CacheData + cacheType=hit（l7Flow_hit_outFlux 不属于 DescribeTimingL7AnalysisData）
const HIT_CACHE_FLUX = 'l7Cache_outFlux';
// 回源：源站至 EdgeOne 节点方向的响应（与控制台「回源流量/带宽」一致）
const ORIGIN_FLUX = 'l7Flow_inFlux_hy';
const ORIGIN_BANDWIDTH = 'l7Flow_inBandwidth_hy';
const ORIGIN_REQUEST = 'l7Flow_request_hy';

function formatTime(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// hasDetail 表示 EO 是否返回了逐点明细：只有明细才能用于峰值/曲线，
// 仅有聚合 Sum 时若直接写入首点会造出「首点巨峰」，也会让带宽取到整段之和
function extractSeries(
  records: any[] | undefined,
  metricName: string,
  targetLen = 0,
): { values: number[]; hasDetail: boolean } {
  if (!Array.isArray(records)) return { values: [], hasDetail: false };
  const values: number[] = [];
  let hasDetail = false;
  for (const record of records) {
    for (const tv of record?.TypeValue || []) {
      if (tv?.MetricName !== metricName) continue;
      const detail = tv.Detail;
      if (Array.isArray(detail) && detail.length) {
        hasDetail = true;
        const sorted = [...detail].sort((a, b) => Number(a?.Timestamp || 0) - Number(b?.Timestamp || 0));
        for (const item of sorted) {
          const num = Number(item?.Value);
          values.push(Number.isFinite(num) ? Math.ceil(num) : 0);
        }
      } else if (Number(tv?.Sum) > 0) {
        const total = Math.ceil(Number(tv.Sum));
        // 聚合值只补在末点，保证总量正确且不制造首点巨峰
        const padLen = targetLen > 0 ? Math.max(0, targetLen - values.length - 1) : 0;
        values.push(...new Array(padLen).fill(0), total);
      }
    }
  }
  return { values, hasDetail };
}

// 把 5min 粒度的点按小时分桶取最大值：得到逐小时峰值，其最大值即区间峰值带宽
function bucketMax(values: number[], targetLen: number): number[] {
  const out = new Array(targetLen).fill(0);
  if (targetLen <= 0 || !values.length) return out;
  const per = values.length / targetLen;
  for (let i = 0; i < targetLen; i++) {
    const from = Math.floor(i * per);
    const to = Math.min(values.length, Math.max(from + 1, Math.floor((i + 1) * per)));
    let m = 0;
    for (let j = from; j < to; j++) m = Math.max(m, values[j] || 0);
    out[i] = m;
  }
  return out;
}

export async function queryTencentEdgeOneStatistics(
  config: Record<string, any>,
  domains: StatisticsDomain[],
  start: Date,
  end: Date,
  type: string,
): Promise<CdnStatisticsResult> {
  const client = new TencentCloud(config.SecretId, config.SecretKey, 'teo.tencentcloudapi.com', 'teo', '2022-09-01');
  const { labels, interval } = buildLabels(start, end);
  const len = labels.length;
  const result: CdnStatisticsResult = { labels };

  // 记录请求失败情况：全部失败时上抛真实错误，避免页面静默展示全 0
  let reqTotal = 0;
  let reqOk = 0;
  let lastError: unknown = null;

  async function access(zoneId: string, metricNames: string[]): Promise<any[]> {
    reqTotal++;
    try {
      // 按站点（Zone）聚合查询，不按域名过滤、不传 Area，取全量数据以与面板一致
      const resp = await client.request('DescribeTimingL7AnalysisData', {
        ZoneIds: [zoneId],
        MetricNames: metricNames,
        StartTime: formatTime(start),
        EndTime: formatTime(end),
        Interval: interval,
      });
      reqOk++;
      // DescribeTimingL7AnalysisData 的时序数据在 Data 字段（回源接口才是 TimingDataRecords）
      return resp?.Data || [];
    } catch (e) {
      lastError = e;
      return [];
    }
  }

  async function origin(zoneId: string, metricNames: string[]): Promise<any[]> {
    reqTotal++;
    try {
      const resp = await client.request('DescribeTimingL7OriginPullData', {
        ZoneIds: [zoneId],
        MetricNames: metricNames,
        StartTime: formatTime(start),
        EndTime: formatTime(end),
        Interval: interval,
      });
      reqOk++;
      return resp?.TimingDataRecords || [];
    } catch (e) {
      lastError = e;
      return [];
    }
  }

  async function cacheHit(zoneId: string): Promise<any[]> {
    reqTotal++;
    try {
      const resp = await client.request('DescribeTimingL7CacheData', {
        ZoneIds: [zoneId],
        MetricNames: [HIT_CACHE_FLUX],
        Filters: [{ Key: 'cacheType', Operator: 'equals', Value: ['hit'] }],
        StartTime: formatTime(start),
        EndTime: formatTime(end),
        Interval: interval,
      });
      reqOk++;
      // DescribeTimingL7CacheData 的时序数据在 Data 字段
      const data = resp?.Data || [];
      if (extractSeries(data, HIT_CACHE_FLUX).hasDetail) return data;
      // 该接口官方已标记废弃，返回空时回退到 Analysis 接口 + cacheType=hit
      reqTotal++;
      try {
        const fallback = await client.request('DescribeTimingL7AnalysisData', {
          ZoneIds: [zoneId],
          MetricNames: [ACCESS_OUT_FLUX],
          Filters: [{ Key: 'cacheType', Operator: 'equals', Value: ['hit'] }],
          StartTime: formatTime(start),
          EndTime: formatTime(end),
          Interval: interval,
        });
        reqOk++;
        return fallback?.Data || [];
      } catch (e) {
        lastError = e;
        return data;
      }
    } catch (e) {
      lastError = e;
      return [];
    }
  }

  // 控制台「峰值带宽」按 5min 粒度取最大，小时平均会削掉尖峰。
  // 仅小时粒度（≤1 天）查询 5min，按小时分桶取峰值；天粒度保持原行为。
  async function bandwidth5min(zoneId: string, len: number): Promise<number[]> {
    if (interval !== 'hour') return [];
    reqTotal++;
    try {
      const resp = await client.request('DescribeTimingL7AnalysisData', {
        ZoneIds: [zoneId],
        MetricNames: [ACCESS_BANDWIDTH],
        StartTime: formatTime(start),
        EndTime: formatTime(end),
        Interval: '5min',
      });
      reqOk++;
      const series = extractSeries(resp?.Data || [], ACCESS_BANDWIDTH);
      return series.hasDetail ? bucketMax(series.values, len) : [];
    } catch (e) {
      lastError = e;
      return [];
    }
  }

  const bw = new Array(len).fill(0);
  const bsBw = new Array(len).fill(0);
  const outFlux = new Array(len).fill(0);
  const flux = new Array(len).fill(0);
  const bsFlux = new Array(len).fill(0);
  const reqNum = new Array(len).fill(0);
  const hitFlux = new Array(len).fill(0);
  const bsNum = new Array(len).fill(0);

  const add = (target: number[], values: number[]) => {
    const aligned = alignSeries(values, len);
    for (let i = 0; i < len; i++) target[i] += aligned[i] || 0;
  };

  let bwHasDetail = false;

  // 同一站点下多个域名只查询一次，避免重复累加导致数据偏大
  const zoneIds = Array.from(new Set(domains.map((d) => d.zoneId).filter((z): z is string => !!z)));
  for (const zoneId of zoneIds) {
    if (type === 'Resource' || type === 'All') {
      const accessRecords = await access(zoneId, [ACCESS_FLUX, ACCESS_BANDWIDTH, ACCESS_OUT_FLUX]);
      add(flux, extractSeries(accessRecords, ACCESS_FLUX, len).values);
      let bwSeries = extractSeries(accessRecords, ACCESS_BANDWIDTH, len);
      const hourlyPeaks = await bandwidth5min(zoneId, len);
      if (hourlyPeaks.length) bwSeries = { values: hourlyPeaks, hasDetail: true };
      // 带宽的 Sum 是整段之和，不能画进曲线
      if (bwSeries.hasDetail) {
        add(bw, bwSeries.values);
        bwHasDetail = true;
      }
      add(outFlux, extractSeries(accessRecords, ACCESS_OUT_FLUX, len).values);
      const originRecords = await origin(zoneId, [ORIGIN_FLUX, ORIGIN_BANDWIDTH]);
      add(bsFlux, extractSeries(originRecords, ORIGIN_FLUX, len).values);
      add(bsBw, extractSeries(originRecords, ORIGIN_BANDWIDTH, len).values);
    }
    if (type === 'Visits' || type === 'All') {
      const accessRecords = await access(zoneId, [ACCESS_REQUEST]);
      add(reqNum, extractSeries(accessRecords, ACCESS_REQUEST, len).values);
      const hitRecords = await cacheHit(zoneId);
      const hitSeries = extractSeries(hitRecords, HIT_CACHE_FLUX, len);
      add(hitFlux, hitSeries.hasDetail ? hitSeries.values : extractSeries(hitRecords, ACCESS_OUT_FLUX, len).values);
      const originRecords = await origin(zoneId, [ORIGIN_REQUEST]);
      add(bsNum, extractSeries(originRecords, ORIGIN_REQUEST, len).values);
    }
  }

  // 所有请求都失败时上抛真实错误（经 _errors 展示到页面），部分失败仍返回已获取数据
  if (reqTotal > 0 && reqOk === 0 && lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  if (type === 'Resource' || type === 'All') {
    // 明细缺失时不能用 Sum 兜底值取峰值（那是整段之和）
    const bwSummary = bwHasDetail ? max(bw) : 0;
    result.resource = {
      resource_detail: { bw, bs_bw: bsBw, flux, bs_flux: bsFlux, out_flux: outFlux },
      resource_summary: { bw: bwSummary, bs_bw: max(bsBw), flux: sum(flux), bs_flux: sum(bsFlux), out_flux: sum(outFlux), bw_interval: interval },
    };
  }
  if (type === 'Visits' || type === 'All') {
    result.visits = {
      visits_detail: {
        req_num: reqNum,
        hit_flux: hitFlux,
        // EdgeOne 未提供请求命中次数指标，命中率以流量维度计算
        hit_num: new Array(len).fill(0),
        bs_num: bsNum,
      },
      visits_summary: { req_num: sum(reqNum), hit_flux: sum(hitFlux), hit_num: 0, bs_num: sum(bsNum) },
    };
  }
  return result;
}
