import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Naive from './plugins/naive';
import App from './App.vue';
import router from './router';
import i18n, { ensureLocale, getInitialLocale } from './i18n';
import { vReveal } from './directives/reveal';
import { installMock } from './mock';
import { isAdminUser, requiresAdmin } from './lib/admin';
import { getUser } from './api';
import './styles/tokens.css';
import './styles/responsive.css';
import './styles/ui-consistency.css';

// 静态预览构建时启用 Mock（正式构建为空操作）
installMock();

// 语言包改为按需网络加载，需给加载失败兜底：失败时仍要挂载应用，避免整站白屏
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('locale load timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function bootstrap() {
  // 首屏只加载当前语言包，另一种语言在切换时按需下载
  try {
    await withTimeout(ensureLocale(getInitialLocale()), 5000);
  } catch (e) {
    // 降级：语言包加载失败不阻断挂载，界面以 key 兜底显示并可刷新重试
    console.error('[i18n] 语言包加载失败，降级渲染', e);
  }

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
  // 尊重省流设置：saveData 或弱网（2G/慢速）时不做路由预取
  const conn: any = (navigator as any)?.connection;
  if (conn?.saveData || /(^|-)2g$/.test(String(conn?.effectiveType || ''))) return;
  const run = () => {
    const admin = isAdminUser(getUser());
    for (const r of router.getRoutes()) {
      // 不预取普通用户无权访问的管理页 chunk，节省带宽
      if (requiresAdmin(r.path) && !admin) continue;
      const comp: any = (r.components as any)?.default;
      if (typeof comp === 'function') {
        try {
          const p = comp();
          // 动态 import 失败是异步 reject，必须显式 catch，否则产生 Uncaught (in promise)
          if (p && typeof p.catch === 'function') p.catch(() => {});
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

bootstrap().catch((e) => {
  console.error('[bootstrap] 应用启动失败', e);
  const el = document.getElementById('app');
  if (el) el.innerHTML = '<div style="padding:24px;font:14px system-ui">页面加载失败，请刷新重试</div>';
});
