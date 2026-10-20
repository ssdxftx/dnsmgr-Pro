import { computed } from 'vue';
import { api, getToken } from '../api';
import { ensureLocale, i18n, isSupportedLocale, LOCALE_STORAGE_KEY, type AppLocale } from '../i18n';

async function applyToI18n(lang: AppLocale): Promise<boolean> {
  try {
    await ensureLocale(lang);
  } catch (e) {
    // 语言包为按需网络加载，失败时不应抛出（否则调用方未 await 会产生 unhandled rejection）
    console.error('[i18n] 语言包加载失败，保持当前语言', e);
    return false;
  }
  (i18n.global as any).locale.value = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return true;
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
    const ok = await applyToI18n(lang);
    if (!ok) return;
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
  const applyUserLocale = async (lang: unknown) => {
    if (!isSupportedLocale(lang)) return;
    const ok = await applyToI18n(lang);
    if (ok) persist(lang);
  };

  return { locale, setLocale, applyUserLocale };
}
