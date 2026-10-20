import { configGet, configSet } from '../../../config.js';
import { query, table } from '../../../db.js';
import { decryptConfig } from '../../secret.js';
import { queryByRoute, hasCdnStatistics, type StatisticsDomain } from './index.js';
import { buildLabels } from './util.js';

interface BucketData {
  flux: number;
  out_flux: number;
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
  return { flux: 0, out_flux: 0, bs_flux: 0, bw: 0, bs_bw: 0, req_num: 0, hit_flux: 0, hit_num: 0, bs_num: 0, status: [0, 0, 0, 0], bs_status: [0, 0, 0, 0] };
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

// 腾讯云 EO 统计接口数据约 10 分钟延迟
export const EO_DATA_DELAY_MS = 10 * 60 * 1000;

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

  // 单账户一次多值 INSERT，替代逐行写入（近 78 行/账户/粒度 → 1 次往返）
  const placeholders: string[] = [];
  const values: any[] = [];
  for (let i = 0; i < labels.length; i++) {
    const data: BucketData = {
      flux: num(rd.flux?.[i]),
      out_flux: num(rd.out_flux?.[i]),
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
    placeholders.push('(?, ?, ?, ?, ?, NOW())');
    values.push(route, aid, granularity, ts, JSON.stringify(data));
  }
  if (placeholders.length) {
    await query(
      `INSERT INTO ${table('cdn_stat_data')} (route, aid, granularity, ts, data, addtime) VALUES ${placeholders.join(',')}
       ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      values,
    );
  }
}

// 按服务商数据粒度拉取并落库：近 30 天按天、近 48 小时按小时
export async function refreshAllStatCache(): Promise<{ accounts: number; errors: string[] }> {
  // 私有账户的统计按产品设计不参与缓存/展示，避免任何用户读到他人私有账户的聚合数据
  const accounts: any[] = await query(`SELECT id, type, config FROM ${table('cdn_account')} WHERE visibility = 'shared'`);
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
  // 小时缓存窗口需保持在 1 天内：buildLabels 以跨度 >1 天切换为「天」标签，
  // 若窗口超过 1 天，小时粒度会写入按天聚合的数据导致图表错乱
  const hourStart = new Date(startOfHour(now).getTime() - 23 * 3600000);
  // EO 数据约 10 分钟延迟，结束时间回退，避免最后一个桶只有部分数据
  const hourEnd = new Date(now.getTime() - EO_DATA_DELAY_MS);

  const errors: string[] = [];
  const jobs = accounts.filter((acct) => {
    const route = String(acct.type || '');
    const list = byAid.get(Number(acct.id)) || [];
    return !!route && list.length > 0 && hasCdnStatistics(route);
  });
  const count = jobs.length;
  // 并发工作池：串行等待所有账户云端统计会长时间占用连接池并与用户请求争抢，限流 4 并发
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const acct = jobs[cursor++];
      const route = String(acct.type || '');
      const list = byAid.get(Number(acct.id)) || [];
      const config = safeConfig(acct.config);
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
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));

  await query(`DELETE FROM ${table('cdn_stat_data')} WHERE ts < ?`, [fmt(new Date(now.getTime() - (STAT_RETENTION_DAYS + 1) * 86400000))]);
  await configSet('cdn_stats_cache_last', fmt(now));
  await configSet('cdn_stats_cache_error', errors.slice(0, 5).join('；'));
  return { accounts: count, errors };
}

// 清空全部统计缓存数据（切换指标口径或数据异常时使用）
export async function clearStatCache(): Promise<number> {
  const res: any = await query(`DELETE FROM ${table('cdn_stat_data')}`);
  await configSet('cdn_stats_cache_last', '');
  return Number(res?.affectedRows || 0);
}

// 从缓存读取并按查询区间聚合；无可用数据返回 null
export async function loadCached(start: Date, end: Date, type: string, aids?: number[]): Promise<any | null> {
  // 显式传入空账户列表表示“没有任何可见账户”，不能退化为读取全部账户
  if (aids && aids.length === 0) return null;
  const spanDays = (end.getTime() - start.getTime()) / 86400000;
  const granularity = spanDays > 1 ? 'day' : 'hour';
  const { labels } = buildLabels(start, end);
  if (!labels.length) return null;

  // 缓存桶按整点/整日写入，查询起点先对齐到桶边界再构造索引表，
  // 否则非整点起点会与所有桶都对不上，整条曲线被平移。
  // 天视图标签是日期，必须从 start 当天开始；小时视图在桶数超出标签数时
  // 后移起点，保证最新一小时不被截掉。
  const stepMs = granularity === 'day' ? 86400000 : 3600000;
  let alignedStart = granularity === 'hour' ? startOfHour(start) : startOfDay(start);
  if (granularity === 'hour') {
    const buckets = Math.floor((end.getTime() - alignedStart.getTime()) / stepMs) + 1;
    const shift = Math.max(0, buckets - labels.length);
    if (shift > 0) alignedStart = new Date(alignedStart.getTime() + shift * stepMs);
  }
  const alignedEnd = new Date(alignedStart.getTime() + labels.length * stepMs);
  const params: any[] = [granularity, fmt(alignedStart), fmt(alignedEnd)];
  let aidClause = '';
  if (aids && aids.length) {
    aidClause = ` AND aid IN (${aids.map(() => '?').join(',')})`;
    params.push(...aids);
  }
  const rows: any[] = await query(
    `SELECT ts, data FROM ${table('cdn_stat_data')} WHERE granularity = ? AND ts >= ? AND ts < ?${aidClause} ORDER BY ts ASC`,
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
    b.out_flux += num(d.out_flux);
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

  // 按绝对时间戳把缓存桶对齐到标签：避免「缺右端」（最近时段尚未刷新）时整体右移错配
  const idxByTs = new Map<string, number>();
  for (let i = 0; i < labels.length; i++) idxByTs.set(fmt(new Date(alignedStart.getTime() + i * stepMs)), i);
  const aligned = new Array<BucketData | null>(labels.length).fill(null);
  let matched = 0;
  for (const [k, b] of map) {
    const i = idxByTs.get(k);
    if (i !== undefined) {
      aligned[i] = b;
      matched++;
    }
  }
  // 桶时间戳全部无法对齐时不再静默右移（会把曲线整体平移），
  // 返回 null 让调用方走实时查询或提示「暂未缓存」
  if (matched === 0) return null;
  const series = (pick: (b: BucketData) => number) => aligned.map((b) => (b ? pick(b) : 0));

  const result: any = { labels };
  if (type === 'Resource' || type === 'All') {
    const flux = series((b) => b.flux);
    const out_flux = series((b) => b.out_flux);
    const bs_flux = series((b) => b.bs_flux);
    const bw = series((b) => b.bw);
    const bs_bw = series((b) => b.bs_bw);
    result.resource = {
      resource_detail: { bw, bs_bw, flux, bs_flux, out_flux },
      resource_summary: { bw: maxOf(bw), bs_bw: maxOf(bs_bw), flux: sum(flux), bs_flux: sum(bs_flux), out_flux: sum(out_flux), bw_interval: granularity },
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