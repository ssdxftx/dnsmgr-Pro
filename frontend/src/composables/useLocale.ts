import { computed } from 'vue';
import { api, getToken } from '../api';
import { i18n, isSupportedLocale, LOCALE_STORAGE_KEY, type AppLocale } from '../i18n';

function applyToI18n(lang: AppLocale) {
  (i18n.global as any).locale.value = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

function persist(lang: AppLocale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

const locale = computed<AppLocale>(() => (i18n.global as any).locale.value as AppLocale);

export function useLocale() {
  // 用户主动切换：立即生效并持久化；已登录时同步到后端账号偏好
  const setLocale = async (lang: AppLocale, opts: { syncRemote?: boolean } = {}) => {
    if (!isSupportedLocale(lang)) return;
    applyToI18n(lang);
    persist(lang);
    if (opts.syncRemote !== false && getToken()) {
      try {
        await api('POST', '/auth/lang', { lang });
      } catch {
        /* 离线或未登录时忽略，本地偏好仍生效 */
      }
    }
  };

  // 登录 / 拉取用户信息后应用账号保存的语言偏好（不回写后端）
  const applyUserLocale = (lang: unknown) => {
    if (!isSupportedLocale(lang)) return;
    applyToI18n(lang);
    persist(lang);
  };

  return { locale, setLocale, applyUserLocale };
}
