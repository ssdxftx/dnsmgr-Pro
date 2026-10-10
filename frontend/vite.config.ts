import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // 小于 4KB 的图标/小图内联进 JS/CSS，减少请求数（请求数越少，CDN 缓存命中率越高）
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // 显式固化带内容哈希的产物命名：内容变更即换名，可被 CDN 与浏览器 immutable 长缓存
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id: string) {
          if (id.includes('/node_modules/echarts/') || id.includes('/node_modules/zrender/')) return 'vendor-charts';
          if (
            id.includes('/node_modules/naive-ui/') ||
            id.includes('/node_modules/vueuc/') ||
            id.includes('/node_modules/seemly/') ||
            id.includes('/node_modules/css-render/') ||
            id.includes('/node_modules/@css-render/')
          ) {
            return 'vendor-ui';
          }
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
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: ['.monkeycode-ai.online'],
    proxy: {
      '/api': {
        target: 'http://localhost:8082',
        changeOrigin: true,
      },
    },
  },
});