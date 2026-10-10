import { createApp } from 'vue';
import { createPinia } from 'pinia';
import naive from 'naive-ui';
import App from './App.vue';
import router from './router';
import i18n from './i18n';
import { vReveal } from './directives/reveal';
import { installMock } from './mock';
import './styles/tokens.css';
import './styles/responsive.css';

// 静态预览构建时启用 Mock（正式构建为空操作）
installMock();

const app = createApp(App);
app.directive('reveal', vReveal);
app.use(createPinia());
app.use(router);
app.use(i18n);
app.use(naive);
app.mount('#app');