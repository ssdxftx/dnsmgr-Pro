import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Naive from './plugins/naive';
import App from './App.vue';
import router from './router';
import i18n, { ensureLocale, getInitialLocale } from './i18n';
import { vReveal } from './directives/reveal';
import { isAdminUser, requiresAdmin } from './lib/admin';
import { getUser } from './api';
import './styles/tokens.css';
import './styles/responsive.css';
import './styles/ui-consistency.css';

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
  // Mock 数据仅在显式开启时动态加载，避免生产入口携带整份演示数据
  if (import.meta.env.VITE_MOCK === 'true') {
    const { installMock } = await import('./mock');
    installMock();
  }

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
    // 跳过登录/安装页、带参数的详情页以及图表/二维码等重 chunk；
    // 最多预取 12 个静态高频路由，且限制 2 并发，避免与用户当前导航争抢带宽。
    const candidates = router
      .getRoutes()
      .filter((r) => {
        if (!r.path.startsWith('/') || r.path.includes(':')) return false;
        if (['/setup', '/login', '/register', '/totp'].includes(r.path)) return false;
        if (requiresAdmin(r.path) && !admin) return false;
        const comp: any = (r.components as any)?.default;
        return typeof comp === 'function';
      })
      .slice(0, 12);
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
