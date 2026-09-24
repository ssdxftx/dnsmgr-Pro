<template>
  <div class="auth-shell">
    <div class="auth-shell__bg" aria-hidden="true">
      <span class="blob blob--1" />
      <span class="blob blob--2" />
      <span class="blob blob--3" />
    </div>
    <div class="auth-shell__inner" :style="{ maxWidth }">
      <div class="auth-brand">
        <div class="auth-brand__mark">
          <n-icon size="26" :component="GlobeOutline" />
        </div>
        <div class="auth-brand__text">
          <div class="auth-brand__name">聚合 DNS</div>
          <div class="auth-brand__sub">多厂商 DNS · CDN · SSL 一体化管理</div>
        </div>
      </div>
      <slot />
      <div class="auth-shell__foot">聚合 DNS 管理系统 · 安全 · 稳定 · 高效</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NIcon } from 'naive-ui';
import { GlobeOutline } from '@vicons/ionicons5';

withDefaults(defineProps<{ maxWidth?: string }>(), { maxWidth: '440px' });
</script>

<style scoped>
.auth-shell {
  position: relative;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  overflow: hidden;
  background:
    radial-gradient(1200px 600px at 15% -10%, color-mix(in srgb, var(--app-primary) 14%, transparent), transparent 60%),
    var(--app-bg-soft);
}
.auth-shell__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  filter: blur(70px);
  opacity: 0.55;
}
.blob {
  position: absolute;
  border-radius: 50%;
}
.blob--1 {
  width: 420px;
  height: 420px;
  top: -120px;
  left: -80px;
  background: color-mix(in srgb, var(--app-primary) 35%, transparent);
}
.blob--2 {
  width: 360px;
  height: 360px;
  bottom: -140px;
  right: -60px;
  background: color-mix(in srgb, #22c55e 26%, transparent);
}
.blob--3 {
  width: 300px;
  height: 300px;
  top: 40%;
  right: 18%;
  background: color-mix(in srgb, #06b6d4 22%, transparent);
}
.auth-shell__inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.auth-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.auth-brand__mark {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  color: #fff;
  background: linear-gradient(135deg, #4b7bf5, #2c59d0);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--app-primary) 35%, transparent);
}
.auth-brand__name {
  font-size: 18px;
  font-weight: 700;
  color: var(--app-text);
  line-height: 1.2;
}
.auth-brand__sub {
  font-size: 12px;
  color: var(--app-text-3);
  margin-top: 2px;
}
.auth-shell__foot {
  text-align: center;
  font-size: 12px;
  color: var(--app-text-3);
}

:deep(.auth-card) {
  width: 100%;
  border-radius: var(--app-radius-xl);
  box-shadow: var(--app-shadow-lg);
}
:deep(.auth-card .n-card__content) {
  padding: 28px 26px 24px;
}
:deep(.auth-head) {
  text-align: center;
  margin-bottom: 22px;
}
:deep(.auth-head h2) {
  margin: 0 0 5px;
  font-size: 21px;
  font-weight: 700;
  color: var(--app-text);
}
:deep(.auth-head p) {
  margin: 0;
  color: var(--app-text-3);
  font-size: 13px;
}

@media (max-width: 480px) {
  .auth-shell {
    padding: 16px 12px;
  }
}
</style>