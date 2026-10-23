import { readFileSync } from 'node:fs';

export interface EsaApiParam {
  name: string;
  type: string;
  required: boolean;
  desc?: string;
  example?: string;
  format?: string;
  enum?: string[];
  properties?: EsaApiParam[];
  items?: EsaApiParam[];
  itemsType?: string;
  itemsEnum?: string[];
}

export interface EsaApiAction {
  title: string;
  summary: string;
  method: string;
  methods?: string[];
  op: string;
  deprecated: boolean;
  path: string[];
  params: EsaApiParam[];
  responseFields: { name: string; type: string; desc?: string }[];
}

export interface EsaApiCatalog {
  version: string;
  generatedAt: string;
  directories: any[];
  actions: Record<string, EsaApiAction>;
}

const catalogUrl = new URL('./esaApiCatalog.json', import.meta.url);
export const ESA_API_CATALOG: EsaApiCatalog = JSON.parse(readFileSync(catalogUrl, 'utf8'));

export function getEsaApi(action: string): EsaApiAction | null {
  return ESA_API_CATALOG.actions[String(action || '').trim()] || null;
}

export function isEsaApiAction(action: string): boolean {
  return !!getEsaApi(action);
}

export function getEsaCatalog(): EsaApiCatalog {
  return ESA_API_CATALOG;
}

/** 返回缺失的必填参数名（SiteId 由站点上下文注入时跳过） */
export function missingEsaApiParams(meta: EsaApiAction, params: Record<string, any>, skip: string[] = []): string[] {
  const skipSet = new Set(skip);
  return meta.params
    .filter((p) => p.required && !skipSet.has(p.name))
    .filter((p) => {
      const v = params[p.name];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    })
    .map((p) => p.name);
}

/** 把表单里的空字符串清理掉，避免可选参数被当成空值发送 */
export function cleanEsaApiParams(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}
