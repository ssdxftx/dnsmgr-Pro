/**
 * 站点「加速区域」取值 → i18n key。
 *
 * ESA 返回 `domestic / overseas`，EdgeOne 返回 `mainland / overseas / global`，
 * 之前这些值直接透传到界面（详情里显示 "domestic"，语义不明）。
 */
const AREA_KEYS: Record<string, string> = {
  domestic: 'areaMainland',
  mainland: 'areaMainland',
  china: 'areaMainland',
  overseas: 'areaOverseas',
  global: 'areaGlobal',
};

/** 命中已知取值时返回 common.* 下的 key，否则返回 null（由调用方回退原值） */
export function zoneAreaKey(area: unknown): string | null {
  const raw = String(area ?? '').trim().toLowerCase();
  return AREA_KEYS[raw] ?? null;
}
