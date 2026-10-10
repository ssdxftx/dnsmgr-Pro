<template>
  <div class="auth-shell">
    <!-- 氛围背景：渐变网格 + 细网格 + 颗粒 + 雷达扫掠 -->
    <div class="auth-shell__bg" aria-hidden="true">
      <span class="mesh mesh--1" />
      <span class="mesh mesh--2" />
      <span class="mesh mesh--3" />
      <span class="gridlines" />
      <span class="sweep" />
    </div>

    <div class="auth-layout">
      <!-- 左侧 Hero（桌面显示，移动收纳） -->
      <section class="auth-hero">
        <div class="auth-brand rise d1">
          <div class="auth-brand__mark">
            <n-icon size="26" :component="GlobeOutline" />
          </div>
          <div class="auth-brand__text">
            <div class="auth-brand__name font-display">聚合 DNS Pro</div>
            <div class="auth-brand__sub">{{ t('auth.brandSub') }}</div>
          </div>
        </div>

        <p class="auth-hero__eyebrow eyebrow rise d2">DNS · CDN · SSL · Control Tower</p>
        <h1 class="auth-hero__title font-display rise d3">域名基础设施<br />控制塔</h1>
        <p class="auth-hero__desc rise d4">
          在一个平台完成「域名 → 解析 → 证书 → 加速 → 上线」全流程，统一纳管多云 DNS 与 CDN 边缘规则。
        </p>

        <ul class="auth-hero__stats rise d5">
          <li>
            <span class="stat-num font-mono">{{ n1 }}<i>+</i></span>
            <span class="stat-label">DNS 平台</span>
          </li>
          <li>
            <span class="stat-num font-mono">{{ n2 }}<i>+</i></span>
            <span class="stat-label">部署商</span>
          </li>
          <li>
            <span class="stat-num font-mono">{{ n3 }}</span>
            <span class="stat-label">CDN 引擎</span>
          </li>
        </ul>
      </section>

      <!-- 右侧：玻璃认证卡 -->
      <div class="auth-panel rise d3" :style="{ maxWidth }">
        <slot />
        <div class="auth-lang">
          <button type="button" :class="{ 'is-active': locale === 'zh-CN' }" @click="setLocale('zh-CN')">中文</button>
          <span class="auth-lang__sep">/</span>
          <button type="button" :class="{ 'is-active': locale === 'en-US' }" @click="setLocale('en-US')">English</button>
        </div>
        <div class="auth-shell__foot">{{ t('auth.foot') }}</div>
      </div>
    </div>

    <!-- 底部平台跑马灯 -->
    <div class="auth-ticker" aria-hidden="true">
      <div class="auth-ticker__track">
        <span v-for="(p, i) in platforms" :key="i" class="auth-ticker__item"><i class="dot" />{{ p }}</span>
        <span v-for="(p, i) in platforms" :key="'b' + i" class="auth-ticker__item"><i class="dot" />{{ p }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { NIcon } from 'naive-ui';
import { GlobeOutline } from '@vicons/ionicons5';
import { useI18n } from 'vue-i18n';
import { useLocale } from '../composables/useLocale';

withDefaults(defineProps<{ maxWidth?: string }>(), { maxWidth: '440px' });

const { t } = useI18n();
const { locale, setLocale } = useLocale();

const platforms = [
  '阿里云', '腾讯云', '华为云', '百度云', 'Cloudflare', 'DNSPod',
  'EdgeOne', '阿里云 ESA', '火山引擎', '西部数码', 'Namesilo', 'GoEdge',
];

/* 遥测数字：计数动画 */
const n1 = ref(0);
const n2 = ref(0);
const n3 = ref(0);
function countTo(target: number, out: typeof n1, dur = 1200) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { out.value = target; return; }
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    out.value = Math.round(target * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
onMounted(() => {
  countTo(20, n1);
  countTo(40, n2, 1400);
  countTo(4, n3, 900);
});
</script>

<style scoped>
.auth-shell {
  position: relative;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--app-bg);
}

/* ---------- 氛围背景 ---------- */
.auth-shell__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.mesh {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
}
.mesh--1 {
  width: 52rem;
  height: 40rem;
  top: -14%;
  left: -10%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--app-primary) 30%, transparent), transparent 70%);
}
.mesh--2 {
  width: 44rem;
  height: 36rem;
  bottom: -16%;
  right: -8%;
  background: radial-gradient(closest-side, rgba(56, 189, 248, 0.22), transparent 70%);
}
.mesh--3 {
  width: 30rem;
  height: 30rem;
  top: 34%;
  right: 20%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--app-primary) 16%, transparent), transparent 70%);
}
.gridlines {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, var(--app-text) 5%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--app-text) 5%, transparent) 1px, transparent 1px);
  background-size: 46px 46px;
  mask-image: radial-gradient(circle at 40% 32%, #000 0%, transparent 76%);
  -webkit-mask-image: radial-gradient(circle at 40% 32%, #000 0%, transparent 76%);
}
.sweep {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 130vmax;
  height: 130vmax;
  transform: translate(-50%, -50%);
  background: conic-gradient(from 0deg, transparent 0 84%, color-mix(in srgb, var(--app-primary) 10%, transparent) 92%, transparent 100%);
  animation: sweep 9s linear infinite;
  opacity: 0.6;
}
@keyframes sweep {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

/* ---------- 布局 ---------- */
.auth-layout {
  position: relative;
  z-index: 1;
  flex: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  align-items: center;
  gap: 48px;
  padding: 48px 32px;
}

/* ---------- Hero ---------- */
.auth-hero {
  min-width: 0;
}
.auth-brand {
  display: flex;
  align-items: center;
  gap: 14px;
}
.auth-brand__mark {
  position: relative;
  overflow: hidden;
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 15px;
  color: #04140f;
  background: linear-gradient(135deg, #2ee6b6, #0a7a5c);
  box-shadow: 0 12px 32px color-mix(in srgb, var(--app-primary) 45%, transparent);
}
.auth-brand__mark::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: conic-gradient(from 0deg, transparent 0 70%, rgba(255, 255, 255, 0.55) 85%, transparent 100%);
  animation: spin 3.4s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.auth-brand__name {
  font-size: 19px;
  font-weight: 700;
  color: var(--app-text);
  line-height: 1.2;
}
.auth-brand__sub {
  font-size: 12px;
  color: var(--app-text-3);
  margin-top: 2px;
}
.auth-hero__eyebrow {
  margin: 40px 0 0;
}
.auth-hero__title {
  margin: 14px 0 0;
  font-size: clamp(40px, 5.2vw, 64px);
  line-height: 1.02;
  letter-spacing: -0.03em;
  color: var(--app-text);
}
.auth-hero__desc {
  margin: 18px 0 0;
  max-width: 46ch;
  font-size: 15px;
  line-height: 1.8;
  color: var(--app-text-2);
}
.auth-hero__stats {
  display: flex;
  gap: 36px;
  margin: 36px 0 0;
  padding: 0;
  list-style: none;
}
.auth-hero__stats li {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-num {
  font-size: 30px;
  font-weight: 600;
  color: var(--app-text);
  line-height: 1;
}
.stat-num i {
  font-style: normal;
  color: var(--app-primary);
}
.stat-label {
  font-size: 12px;
  color: var(--app-text-3);
  letter-spacing: 0.04em;
}

/* ---------- 认证面板 ---------- */
.auth-panel {
  width: 100%;
  justify-self: end;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.auth-lang {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
}
.auth-lang button {
  border: none;
  background: none;
  padding: 4px 6px;
  cursor: pointer;
  color: var(--app-text-3);
  font-size: 12px;
  border-radius: 6px;
}
.auth-lang button.is-active {
  color: var(--app-primary);
  font-weight: 600;
}
.auth-lang__sep {
  color: var(--app-text-3);
  opacity: 0.5;
}
.auth-shell__foot {
  text-align: center;
  font-size: 12px;
  color: var(--app-text-3);
}

/* 玻璃认证卡（深度作用于 Login/Register/Setup 传入的卡片） */
:deep(.auth-card) {
  width: 100%;
  border-radius: var(--app-radius-xl);
  background: var(--app-glass);
  border: 1px solid var(--app-border);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  box-shadow: var(--app-shadow-lg);
  position: relative;
  overflow: hidden;
}
:deep(.auth-card)::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--app-primary), transparent);
  opacity: 0.7;
}
:deep(.auth-card .n-card__content) {
  padding: 30px 28px 26px;
}
:deep(.auth-head) {
  text-align: center;
  margin-bottom: 22px;
}
:deep(.auth-head h2) {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--app-text);
  font-family: var(--app-font-display);
  letter-spacing: -0.01em;
}
:deep(.auth-head p) {
  margin: 0;
  color: var(--app-text-3);
  font-size: 13px;
}

/* ---------- 底部跑马灯 ---------- */
.auth-ticker {
  position: relative;
  z-index: 1;
  border-top: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-surface) 40%, transparent);
  backdrop-filter: blur(8px);
  overflow: hidden;
  padding: 12px 0;
}
.auth-ticker__track {
  display: inline-flex;
  gap: 40px;
  white-space: nowrap;
  animation: marquee 28s linear infinite;
  will-change: transform;
}
.auth-ticker:hover .auth-ticker__track {
  animation-play-state: paused;
}
@keyframes marquee {
  to { transform: translateX(-50%); }
}
.auth-ticker__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--app-font-mono);
  font-size: 12px;
  color: var(--app-text-3);
}
.auth-ticker__item .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--app-primary);
}

/* ---------- 入场编排 ---------- */
.rise {
  opacity: 0;
  transform: translateY(22px);
}
@media (prefers-reduced-motion: no-preference) {
  .rise {
    animation: rise-in 0.6s var(--app-ease) both;
  }
  .rise.d1 { animation-delay: 0.05s; }
  .rise.d2 { animation-delay: 0.15s; }
  .rise.d3 { animation-delay: 0.25s; }
  .rise.d4 { animation-delay: 0.35s; }
  .rise.d5 { animation-delay: 0.45s; }
}
@keyframes rise-in {
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .rise { opacity: 1; transform: none; }
  .sweep, .auth-brand__mark::after, .auth-ticker__track { animation: none; }
}

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .auth-layout {
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 40px 20px 28px;
    align-content: start;
  }
  .auth-hero__eyebrow { margin-top: 28px; }
  .auth-hero__title { font-size: clamp(32px, 8vw, 44px); }
  .auth-hero__stats { gap: 24px; margin-top: 24px; }
  .auth-panel { justify-self: stretch; max-width: 100% !important; }
}
@media (max-width: 480px) {
  .auth-hero__desc { display: none; }
  .auth-hero__stats { gap: 18px; }
}
</style>
