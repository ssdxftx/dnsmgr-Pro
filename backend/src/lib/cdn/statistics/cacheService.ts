import { configGet, configSet } from '../../../config.js';
import { query, table } from '../../../db.js';
import { decryptConfig } from '../../secret.js';
import { queryByRoute, hasCdnStatistics, type StatisticsDomain } from './index.js';
import { buildLabels } from './util.js';

interface BucketData {
  flux: number;
  bs_flux: number;
  bw: number;
  bs_bw: number;
  req_num: number;
  hit_flux: number;
  hit_num: number;
  bs_num: number;
  status: number[];
  bs_status: number[];
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + (b || 0), 0);
}

function maxOf(arr: number[]): number {
  return arr.reduce((a, b) => Math.max(a, b || 0), 0);
}

function emptyBucket(): BucketData {
  return { flux: 0, bs_flux: 0, bw: 0, bs_bw: 0, req_num: 0, hit_flux: 0, hit_num: 0, bs_num: 0, status: [0, 0, 0, 0], bs_status: [0, 0, 0, 0] };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfHour(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0);
}
function safeConfig(s: any): Record<string, any> {
  if (s && typeof s === 'object') return s as Record<string, any>;
  return decryptConfig(s) || {};
}

export const STAT_RETENTION_DAYS = 30;
export const STAT_COVER_MS = 30 * 86400000;

export function isStatCacheEnabled(): Promise<boolean> {
  return configGet('cdn_stats_cache', '0').then((v) => v === '1');
}

export async function getStatCacheIntervalMs(): Promise<number> {
  const mins = parseInt((await configGet('cdn_stats_cache_interval', '30')) || '30', 10);
  return Math.max(5, Number.isFinite(mins) ? mins : 30) * 60000;
}

async function storeResult(
  route: string,
  aid: number,
  granularity: 'hour' | 'day',
  config: Record<string, any>,
  domains: StatisticsDomain[],
  start: Date,
  end: Date,
  type: string,
): Promise<void> {
  const res: any = await queryByRoute(route, config, domains, start, end, type);
  const labels: string[] = res.labels || [];
  if (!labels.length) return;
  const stepMs = granularity === 'day' ? 86400000 : 3600000;
  const rd = res.resource?.resource_detail || {};
  const vd = res.visits?.visits_detail || {};
  const sd = res.status?.status_detail || [];
  const bsd = res.status?.bs_status_detail || [];

  for (let i = 0; i < labels.length; i++) {
    const data: BucketData = {
      flux: num(rd.flux?.[i]),
      bs_flux: num(rd.bs_flux?.[i]),
      bw: num(rd.bw?.[i]),
      bs_bw: num(rd.bs_bw?.[i]),
      req_num: num(vd.req_num?.[i]),
      hit_flux: num(vd.hit_flux?.[i]),
      hit_num: num(vd.hit_num?.[i]),
      bs_num: num(vd.bs_num?.[i]),
      status: [num(sd[0]?.[i]), num(sd[1]?.[i]), num(sd[2]?.[i]), num(sd[3]?.[i])],
      bs_status: [num(bsd[0]?.[i]), num(bsd[1]?.[i]), num(bsd[2]?.[i]), num(bsd[3]?.[i])],
    };
    const ts = fmt(new Date(start.getTime() + i * stepMs));
    await query(
      `INSERT INTO ${table('cdn_stat_data')} (route, aid, granularity, ts, data, addtime) VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      [route, aid, granularity, ts, JSON.stringify(data)],
    );
  }
}

// 按服务商数据粒度拉取并落库：近 30 天按天、近 48 小时按小时
export async function refreshAllStatCache(): Promise<{ accounts: number; errors: string[] }> {
  const accounts: any[] = await query(`SELECT id, type, config FROM ${table('cdn_account')}`);
  const domains: any[] = await query(`SELECT aid, name, route, zone_id, service_area FROM ${table('cdn_domain')}`);
  const byAid = new Map<number, StatisticsDomain[]>();
  for (const d of domains) {
    const aid = Number(d.aid);
    if (!byAid.has(aid)) byAid.set(aid, []);
    byAid.get(aid)!.push({ name: d.name, route: d.route, zoneId: d.zone_id, serviceArea: d.service_area });
  }

  const now = new Date();
  const dayStart = startOfDay(new Date(now.getTime() - (STAT_RETENTION_DAYS - 1) * 86400000));
  const dayEnd = new Date(startOfDay(now).getTime() + 86400000);
  const hourStart = new Date(startOfHour(now).getTime() - 47 * 3600000);
  const hourEnd = now;

  const errors: string[] = [];
  let count = 0;
  for (const acct of accounts) {
    const route = String(acct.type || '');
    const list = byAid.get(Number(acct.id)) || [];
    if (!route || !list.length || !hasCdnStatistics(route)) continue;
    const config = safeConfig(acct.config);
    count++;
    try {
      await storeResult(route, Number(acct.id), 'day', config, list, dayStart, dayEnd, 'All');
    } catch (e: any) {
      errors.push(`${route}#${acct.id}(天): ${e?.message || e}`);
    }
    try {
      await storeResult(route, Number(acct.id), 'hour', config, list, hourStart, hourEnd, 'All');
    } catch (e: any) {
      errors.push(`${route}#${acct.id}(小时): ${e?.message || e}`);
    }
  }

  await query(`DELETE FROM ${table('cdn_stat_data')} WHERE ts < ?`, [fmt(new Date(now.getTime() - (STAT_RETENTION_DAYS + 1) * 86400000))]);
  await configSet('cdn_stats_cache_last', fmt(now));
  await configSet('cdn_stats_cache_error', errors.slice(0, 5).join('；'));
  return { accounts: count, errors };
}

// 从缓存读取并按查询区间聚合；无可用数据返回 null
export async function loadCached(start: Date, end: Date, type: string, aids?: number[]): Promise<any | null> {
  const spanDays = (end.getTime() - start.getTime()) / 86400000;
  const granularity = spanDays > 1 ? 'day' : 'hour';
  const { labels } = buildLabels(start, end);
  if (!labels.length) return null;

  const params: any[] = [granularity, fmt(start), fmt(end)];
  let aidClause = '';
  if (aids && aids.length) {
    aidClause = ` AND aid IN (${aids.map(() => '?').join(',')})`;
    params.push(...aids);
  }
  const rows: any[] = await query(
    `SELECT ts, data FROM ${table('cdn_stat_data')} WHERE granularity = ? AND ts >= ? AND ts <= ?${aidClause} ORDER BY ts ASC`,
    params,
  );
  if (!rows.length) return null;

  const map = new Map<string, BucketData>();
  for (const r of rows) {
    const key = String(r.ts);
    let b = map.get(key);
    if (!b) {
      b = emptyBucket();
      map.set(key, b);
    }
    let d: BucketData;
    try {
      d = JSON.parse(r.data);
    } catch {
      continue;
    }
    b.flux += num(d.flux);
    b.bs_flux += num(d.bs_flux);
    b.bw += num(d.bw);
    b.bs_bw += num(d.bs_bw);
    b.req_num += num(d.req_num);
    b.hit_flux += num(d.hit_flux);
    b.hit_num += num(d.hit_num);
    b.bs_num += num(d.bs_num);
    for (let i = 0; i < 4; i++) {
      b.status[i] += num(d.status?.[i]);
      b.bs_status[i] += num(d.bs_status?.[i]);
    }
  }

  let tsList = [...map.keys()].sort();
  if (tsList.length > labels.length) tsList = tsList.slice(tsList.length - labels.length);
  const offset = labels.length - tsList.length;
  const series = (pick: (b: BucketData) => number): number[] => {
    const arr = new Array(labels.length).fill(0);
    tsList.forEach((k, idx) => {
      arr[offset + idx] = pick(map.get(k)!);
    });
    return arr;
  };

  const result: any = { labels };
  if (type === 'Resource' || type === 'All') {
    const flux = series((b) => b.flux);
    const bs_flux = series((b) => b.bs_flux);
    const bw = series((b) => b.bw);
    const bs_bw = series((b) => b.bs_bw);
    result.resource = {
      resource_detail: { bw, bs_bw, flux, bs_flux },
      resource_summary: { bw: maxOf(bw), bs_bw: maxOf(bs_bw), flux: sum(flux), bs_flux: sum(bs_flux) },
    };
  }
  if (type === 'Visits' || type === 'All') {
    const req_num = series((b) => b.req_num);
    const hit_flux = series((b) => b.hit_flux);
    const hit_num = series((b) => b.hit_num);
    const bs_num = series((b) => b.bs_num);
    result.visits = {
      visits_detail: { req_num, hit_flux, hit_num, bs_num },
      visits_summary: { req_num: sum(req_num), hit_flux: sum(hit_flux), hit_num: sum(hit_num), bs_num: sum(bs_num) },
    };
  }
  if (type === 'HttpCodeStatus' || type === 'All') {
    const status_detail = [0, 1, 2, 3].map((i) => series((b) => b.status[i]));
    const bs_status_detail = [0, 1, 2, 3].map((i) => series((b) => b.bs_status[i]));
    result.status = {
      status_detail,
      status_summary: status_detail.map(sum),
      bs_status_detail,
      bs_status_summary: bs_status_detail.map(sum),
    };
  }
  return result;
}