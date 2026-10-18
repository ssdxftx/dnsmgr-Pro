import type { MetricAgg, ProviderCatalog } from './catalog/types.js';
import type { MetricSeries, ProviderCard } from './catalog/result.js';
import type { StatisticsDomain } from './types.js';
import { getCatalog, listCatalogs } from './catalog/index.js';
import { fetchDetail } from './detail/index.js';
import { buildTimeline, combineSeries, aggregate, mergeRateSeries } from './detail/shared.js';
import { BASIC_KEYS, basicUnit } from './validate.js';

export interface OverviewAccount {
  id: number;
  config: Record<string, any>;
  domains: StatisticsDomain[];
}

export interface OverviewInput {
  route: string;
  accountCount: number;
  accounts: OverviewAccount[];
}

/** 基础 5 项的历史 key 与服务商实际 key 的别名（按顺序取第一个有值的） */
const BASIC_ALIAS: Record<string, string[]> = {
  bs_flux: ['bs_flux', 'origin_flux'],
  hit_rate: ['hit_rate', 'hit_rate_flux'],
};

const cache = new Map<string, { at: number; data: ProviderCard }>();
const CACHE_TTL_MS = 120_000;

export function clearOverviewCache(): void {
  cache.clear();
}

function formatTime(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function mergeSeriesList(list: MetricSeries[]): MetricSeries[] {
  const map = new Map<string, MetricSeries>();
  for (const s of list) {
    const prev = map.get(s.key);
    if (!prev) {
      map.set(s.key, { ...s });
      continue;
    }
    const len = prev.values.length;
    if (s.agg === 'rate') {
      map.set(s.key, mergeRateSeries(prev, s));
      continue;
    }
    const values = combineSeries([prev.values, s.values], s.agg as MetricAgg, len);
    map.set(s.key, { ...prev, values, summary: aggregate(values, s.agg as MetricAgg) });
  }
  return [...map.values()];
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function buildProviderCard(
  input: OverviewInput,
  start: Date,
  end: Date,
): Promise<ProviderCard> {
  const catalog = getCatalog(input.route) as ProviderCatalog;
  const acctIds = input.accounts
    .map((a) => a.id)
    .sort((x, y) => x - y)
    .join(',');
  const key = `${input.route}|${formatTime(start)}|${formatTime(end)}|${acctIds}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const started = Date.now();
  const endFor = new Date(Math.min(end.getTime(), Date.now() - catalog.delayMinutes * 60_000));
  const timeline = buildTimeline(start, endFor);
  const card: ProviderCard = {
    route: catalog.route,
    name: catalog.name,
    tone: catalog.tone,
    status: 'empty',
    accountCount: input.accountCount,
    domainCount: input.accounts.reduce((a, b) => a + b.domains.length, 0),
    basics: [],
    dataUntil: formatTime(endFor),
    cached: false,
    tookMs: 0,
  };

  if (!input.accountCount || !card.domainCount) {
    card.tookMs = Date.now() - started;
    return card;
  }

  const parts = await Promise.all(
    input.accounts.map((acct) =>
      withTimeout(
        fetchDetail(catalog, {
          config: acct.config,
          domains: acct.domains,
          timeline,
          groups: new Set(['overview']),
          filters: {},
          top: [],
        }),
        8000,
      ).catch((e: any) => ({
        series: [],
        breakdowns: [],
        errors: [String(e?.message || e)],
        requests: 0,
      })),
    ),
  );

  const merged = mergeSeriesList(parts.flatMap((p) => p.series));
  const byKey = new Map(merged.map((s) => [s.key, s]));
  const errors = parts.flatMap((p) => p.errors);
  card.basics = BASIC_KEYS.map((key) => {
    const alias = BASIC_ALIAS[key] || [key];
    const s = alias.map((k) => byKey.get(k)).find((x) => x != null);
    return { key, unit: basicUnit(key), value: s?.summary ?? null };
  });

  if (errors.length && !merged.length) {
    card.status = errors.some((e) => /timeout|超时/i.test(e)) ? 'timeout' : 'error';
    card.error = errors[0];
  } else if (errors.length) {
    card.status = 'partial';
    card.error = errors[0];
  } else if (!merged.length) {
    card.status = 'empty';
  } else {
    card.status = 'ok';
  }
  card.tookMs = Date.now() - started;
  if (card.status === 'ok' || card.status === 'partial') cache.set(key, { at: Date.now(), data: card });
  return card;
}

export async function buildOverview(
  inputs: OverviewInput[],
  start: Date,
  end: Date,
): Promise<ProviderCard[]> {
  const byRoute = new Map(inputs.map((i) => [i.route, i]));
  const cards = await Promise.all(
    listCatalogs().map((catalog) =>
      buildProviderCard(
        byRoute.get(catalog.route) || { route: catalog.route, accountCount: 0, accounts: [] },
        start,
        end,
      ),
    ),
  );
  // 只返回真正接入过（有已接入域名）的服务商
  return cards.filter((c) => c.domainCount > 0);
}
