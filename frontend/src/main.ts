import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import i18n, { ensureLocale, getInitialLocale } from './i18n';
import { vReveal } from './directives/reveal';
import { isAdminUser, requiresAdmin } from './lib/admin';
import { getUser } from './api';
import './styles/tokens.css';
import './styles/responsive.css';
import './styles/ui-consistency.css';

async function bootstrap() {
  // Mock 数据仅在显式开启时动态加载，避免生产入口携带整份演示数据；
  // 同时必须处于开发模式，防止 VITE_MOCK=true 的构建产物被误部署成「任意密码可登录」的控制台
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === 'true') {
    const { installMock } = await import('./mock');
    installMock();
  }

  // 语言包后台加载，不阻塞首屏挂载：网络慢时先渲染应用骨架，
  // 加载完成后 setLocaleMessage 会触发响应式更新，不再出现最长 5 秒白屏。
  void ensureLocale(getInitialLocale()).catch((e) => {
    console.error('[i18n] 语言包加载失败，降级渲染', e);
  });

  const app = createApp(App);
  app.directive('reveal', vReveal);
  app.use(createPinia());
  app.use(router);
  app.use(i18n);
  app.mount('#app');

  prefetchRoutes();
}

// 空闲时只预取少量高频静态路由，避免把全部懒加载 chunk 重新下载一遍
function prefetchRoutes() {
  if (document.hidden) return;
  // 尊重省流设置：saveData、2G/3G 或低内存设备不做路由预取
  const conn: any = (navigator as any)?.connection;
  const lowMemory = Number((navigator as any)?.deviceMemory || 0);
  if (
    conn?.saveData ||
    /(^|-)2g$/.test(String(conn?.effectiveType || '')) ||
    /(^|-)3g$/.test(String(conn?.effectiveType || '')) ||
    (lowMemory > 0 && lowMemory < 4)
  ) return;
  const run = () => {
    if (document.hidden) return;
    const admin = isAdminUser(getUser());
    const prefetchPaths = ['/dashboard', '/domains', '/cdn-domains'];
    const candidates = router
      .getRoutes()
      .filter((r) => {
        if (!prefetchPaths.includes(r.path)) return false;
        if (requiresAdmin(r.path) && !admin) return false;
        const comp: any = (r.components as any)?.default;
        return typeof comp === 'function';
      });
    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length) {
        const r = candidates[cursor++];
        const comp: any = (r.components as any)?.default;
        try {
          await comp();
        } catch {
          /* 单个 chunk 预取失败忽略 */
        }
      }
    };
    void Promise.all([worker(), worker()]);
  };
  const idle = (window as any).requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}

bootstrap().catch((e) => {
  console.error('[bootstrap] 应用启动失败', e);
  const el = document.getElementById('app');
  if (el) el.innerHTML = '<div style="padding:24px;font:14px system-ui">页面加载失败，请刷新重试</div>';
});
