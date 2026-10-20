import type { ProviderCatalog } from '../catalog/types.js';
import { fetchEdgeOneDetail, type DetailContext, type DetailPart } from './tencentEdgeOne.js';
import { fetchTencentCdnDetail } from './tencentCdn.js';
import { fetchAliyunCdnDetail } from './aliyunCdn.js';
import { fetchAliyunEsaDetail } from './aliyunEsa.js';

type Fetcher = (catalog: ProviderCatalog, ctx: DetailContext) => Promise<DetailPart>;

const fetchers: Record<string, Fetcher> = {
  tencent_edgeone: fetchEdgeOneDetail,
  tencent_cdn: fetchTencentCdnDetail,
  aliyun_cdn: fetchAliyunCdnDetail,
  aliyun_esa: fetchAliyunEsaDetail,
};

export function hasDetailFetcher(route: string): boolean {
  return typeof fetchers[route] === 'function';
}

export function fetchDetail(catalog: ProviderCatalog, ctx: DetailContext): Promise<DetailPart> {
  const fetcher = fetchers[catalog.route];
  if (!fetcher) {
    return Promise.resolve({
      series: [],
      breakdowns: [],
      errors: [`${catalog.name}: 暂不支持统计查询`],
      requests: 0,
    });
  }
  return fetcher(catalog, ctx);
}

export type { DetailContext, DetailPart } from './tencentEdgeOne.js';
