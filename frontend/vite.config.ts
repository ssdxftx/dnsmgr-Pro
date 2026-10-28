import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import pkg from './package.json' with { type: 'json' };

// 开发/预览隧道域名改为显式放行：通配整个 trycloudflare.com 会把任意临时隧道
// 当作可信 Host，扩大 DNS rebinding 面。需要时通过 VITE_ALLOWED_HOSTS 追加。
const extraAllowedHosts = (process.env.VITE_ALLOWED_HOSTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedHosts = ['.monkeycode-ai.online', ...extraAllowedHosts];

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // ECharts 已按需注册并独立成懒加载 chunk；其体积阈值放宽到 600KB，避免误报
    chunkSizeWarningLimit: 600,
    // 小于 4KB 的图标/小图内联进 JS/CSS，减少请求数（请求数越少，CDN 缓存命中率越高）
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // 显式固化带内容哈希的产物命名：内容变更即换名，可被 CDN 与浏览器 immutable 长缓存
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id: string) {
          // ECharts 已按需注册并独立成懒加载 chunk，首屏不加载；体积阈值见 chunkSizeWarningLimit
          if (id.includes('/node_modules/echarts/') || id.includes('/node_modules/zrender/')) return 'vendor-charts';
          // naive-ui / vueuc / seemly / css-render 不再强制并入单一 vendor-ui：
          // 交给 rollup 按引用图自然分块，避免整块组件库被入口静态拉成首屏强依赖。
          if (
            id.includes('/node_modules/vue/') ||
            id.includes('/node_modules/@vue/') ||
            id.includes('/node_modules/vue-router/') ||
            id.includes('/node_modules/pinia/')
          ) {
            return 'vendor-vue';
          }
          return undefined;
        },
      },
    },
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
    allowedHosts,
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    // 本地预览：仅放行平台域名；隧道域名通过 VITE_ALLOWED_HOSTS 显式追加
    allowedHosts,
    proxy: {
      '/api': {
        target: 'http://localhost:8082',
        changeOrigin: true,
      },
    },
  },
});