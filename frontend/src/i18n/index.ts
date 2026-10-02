import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';

export type AppLocale = 'zh-CN' | 'en-US';

export const SUPPORTED_LOCALES: AppLocale[] = ['zh-CN', 'en-US'];
export const LOCALE_STORAGE_KEY = 'dnsmgr_lang';
export const FALLBACK_LOCALE: AppLocale = 'en-US';

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
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  } as never,
} as any);

if (typeof document !== 'undefined') {
  document.documentElement.lang = String((i18n.global as any).locale.value);
}

export default i18n;
