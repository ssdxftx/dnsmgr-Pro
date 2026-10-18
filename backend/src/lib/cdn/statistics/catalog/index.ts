import type { ProviderCatalog } from './types.js';
import { tencentEdgeOneCatalog } from './tencentEdgeOne.js';
import { tencentCdnCatalog } from './tencentCdn.js';
import { aliyunCdnCatalog } from './aliyunCdn.js';
import { aliyunEsaCatalog } from './aliyunEsa.js';

export const CATALOGS: ProviderCatalog[] = [
  tencentEdgeOneCatalog,
  tencentCdnCatalog,
  aliyunCdnCatalog,
  aliyunEsaCatalog,
];

const byRoute = new Map(CATALOGS.map((c) => [c.route, c]));

export function getCatalog(route: string): ProviderCatalog | undefined {
  return byRoute.get(route);
}

export function listCatalogs(): ProviderCatalog[] {
  return CATALOGS;
}

export function findMetric(route: string, key: string) {
  return getCatalog(route)?.metrics.find((m) => m.key === key);
}
