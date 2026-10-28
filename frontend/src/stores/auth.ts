import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getToken, getUser, clearToken } from '../api';
import { useLocale } from '../composables/useLocale';

export const useAuthStore = defineStore('auth', () => {
  const { applyUserLocale } = useLocale();
  const token = ref(getToken());
  const user = ref(getUser());

  // 启动时若本地已缓存用户，优先使用账号保存的语言偏好
  if (user.value?.lang) applyUserLocale(user.value.lang);

  // 接口层在 403/401 后会刷新用户信息，这里同步到 store，保证菜单/路由实时一致
  if (typeof window !== 'undefined') {
    window.addEventListener('dnsmgr:user-updated', (ev: Event) => {
      const next = (ev as CustomEvent).detail;
      if (!next) return;
      user.value = next;
      if (next.lang) applyUserLocale(next.lang);
    });
  }

  function setAuth(t: string, u: any) {
    token.value = t;
    user.value = u;
    if (u?.lang) applyUserLocale(u.lang);
  }
  function logout() {
    // 先通知服务端吊销当前 jti（失败不阻塞本地登出）
    const t = token.value;
    if (t) {
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).catch(() => undefined);
    }
    token.value = '';
    user.value = null;
    // 同时清理 localStorage 中的登录态与 GET 缓存，避免残留或串号
    clearToken();
  }

  return { token, user, setAuth, logout };
});