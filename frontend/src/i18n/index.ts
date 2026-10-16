import { createI18n } from 'vue-i18n';

export type AppLocale = 'zh-CN' | 'en-US';

export const SUPPORTED_LOCALES: AppLocale[] = ['zh-CN', 'en-US'];
export const LOCALE_STORAGE_KEY = 'dnsmgr_lang';
export const FALLBACK_LOCALE: AppLocale = 'en-US';

// 语言包按需加载：首屏只加载当前语言，另一种语言仅在切换时下载，避免两包同时进入入口。
const loaders: Record<AppLocale, () => Promise<{ default: Record<string, unknown> }>> = {
  'zh-CN': () => import('./locales/zh-CN'),
  'en-US': () => import('./locales/en-US'),
};

const loadedLocales = new Set<AppLocale>();
const inflight = new Map<AppLocale, Promise<void>>();

export function isLocaleLoaded(lang: AppLocale): boolean {
  return loadedLocales.has(lang);
}

export function ensureLocale(lang: AppLocale): Promise<void> {
  if (loadedLocales.has(lang)) return Promise.resolve();
  const existing = inflight.get(lang);
  if (existing) return existing;
  const task = loaders[lang]()
    .then((mod) => {
      (i18n.global as any).setLocaleMessage(lang, mod.default);
      loadedLocales.add(lang);
    })
    .finally(() => {
      inflight.delete(lang);
    });
  inflight.set(lang, task);
  return task;
}

export function isSupportedLocale(value: unknown): value is AppLocale {
  return value === 'zh-CN' || value === 'en-US';
}

// 依据访问时浏览器语言决定初始语言：zh* -> 中文，en* -> 英文，其余语言回退英文
export function detectBrowserLocale(): AppLocale {
  if (typeof navigator === 'undefined') return FALLBACK_LOCALE;
  const list =
    (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) || [];
  for (const raw of list) {
    const lang = String(raw || '').toLowerCase();
    if (!lang) continue;
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('en')) return 'en-US';
  }
  return FALLBACK_LOCALE;
}

export function getInitialLocale(): AppLocale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(saved)) return saved;
  } catch {
    /* ignore */
  }
  return detectBrowserLocale();
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: getInitialLocale(),
  fallbackLocale: FALLBACK_LOCALE,
  messages: {},
} as any);

if (typeof document !== 'undefined') {
  document.documentElement.lang = String((i18n.global as any).locale.value);
}

export default i18n;
