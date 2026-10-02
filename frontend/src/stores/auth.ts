import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getToken, getUser } from '../api';
import { useLocale } from '../composables/useLocale';

export const useAuthStore = defineStore('auth', () => {
  const { applyUserLocale } = useLocale();
  const token = ref(getToken());
  const user = ref(getUser());

  // 启动时若本地已缓存用户，优先使用账号保存的语言偏好
  if (user.value?.lang) applyUserLocale(user.value.lang);

  function setAuth(t: string, u: any) {
    token.value = t;
    user.value = u;
    if (u?.lang) applyUserLocale(u.lang);
  }
  function logout() {
    token.value = '';
    user.value = null;
  }

  return { token, user, setAuth, logout };
});