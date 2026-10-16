import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Naive from './plugins/naive';
import App from './App.vue';
import router from './router';
import i18n, { ensureLocale, getInitialLocale } from './i18n';
import { vReveal } from './directives/reveal';
import { installMock } from './mock';
import './styles/tokens.css';
import './styles/responsive.css';

// 静态预览构建时启用 Mock（正式构建为空操作）
installMock();

async function bootstrap() {
  // 首屏只加载当前语言包，另一种语言在切换时按需下载
  await ensureLocale(getInitialLocale());

  const app = createApp(App);
  app.directive('reveal', vReveal);
  app.use(createPinia());
  app.use(router);
  app.use(i18n);
  app.use(Naive);
  app.mount('#app');

  prefetchRoutes();
}

// 空闲时预取各路由 chunk，点击菜单时无需再等网络往返
function prefetchRoutes() {
  const run = () => {
    for (const r of router.getRoutes()) {
      const comp: any = (r.components as any)?.default;
      if (typeof comp === 'function') {
        try {
          comp();
        } catch {
          /* 单个 chunk 预取失败忽略 */
        }
      }
    }
  };
  const idle = (window as any).requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 3000 });
  else setTimeout(run, 1200);
}

bootstrap();
