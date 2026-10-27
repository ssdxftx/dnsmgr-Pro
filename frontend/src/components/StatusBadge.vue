<template>
  <n-popover v-if="errors && errors.length" trigger="click" placement="bottom-end">
    <template #trigger>
      <button
        type="button"
        class="status-badge is-clickable"
        :class="[`is-${tone}`, `is-${variant}`, `is-${size}`, { 'is-pulse': pulse }]"
        :title="title || label"
      >
        <i v-if="variant !== 'plain'" class="status-badge__dot" />
        <span v-if="label" class="status-badge__label">{{ label }}</span>
      </button>
    </template>
    <ul class="status-badge__errors">
      <li v-for="(err, i) in errors" :key="i">{{ err }}</li>
    </ul>
  </n-popover>

  <span
    v-else
    class="status-badge"
    :class="[`is-${tone}`, `is-${variant}`, `is-${size}`, { 'is-pulse': pulse }]"
    :title="title || label"
  >
    <i v-if="variant !== 'plain'" class="status-badge__dot" />
    <span v-if="label" class="status-badge__label">{{ label }}</span>
    <slot />
  </span>
</template>

<script setup lang="ts">
import { NPopover } from 'naive-ui';

/**
 * 全站统一的状态标识。
 *
 * 此前「状态」被写了 6 遍：Dashboard 的 .ok-badge、UserLog 的 .audit-result、
 * ProviderCard 的 .pcard__dot、MainLayout 的 .hdr-pulse__dot、StatisticsDetail 的 StatusChip……
 * 圆点尺寸有 6/7/8px 三种，语义色也不完全一致。这里收敛成一套。
 *
 * 四种形态：
 *   dot   纯圆点（卡片角标，文案走 title）
 *   text  圆点 + 文字，无底（表格行内状态）
 *   pill  圆点 + 文字 + 胶囊底（需要更强视觉权重时）
 *   plain 只有文字
 *
 * 传入 errors 时自动变成可点开的气泡，用于查看失败原因。
 */
withDefaults(
  defineProps<{
    tone?: 'success' | 'warning' | 'error' | 'info' | 'default';
    variant?: 'dot' | 'text' | 'pill' | 'plain';
    size?: 'sm' | 'md';
    label?: string;
    title?: string;
    /** 在线状态等需要呼吸效果时开启 */
    pulse?: boolean;
    /** 有值时显示为可点击气泡，列出明细 */
    errors?: string[];
  }>(),
  {
    tone: 'default',
    variant: 'text',
    size: 'md',
    label: '',
    title: '',
    pulse: false,
    errors: undefined,
  },
);
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.4;
  color: var(--app-text-3);
}

/* 有错误明细时渲染为 button，去掉浏览器默认外观 */
button.status-badge {
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.status-badge__dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.is-sm {
  font-size: 11.5px;
}
.is-sm .status-badge__dot {
  width: 6px;
  height: 6px;
}

/* tone 同时驱动圆点与文字，避免两处各自取色导致不同步 */
.is-success {
  color: var(--app-success);
}
.is-warning {
  color: var(--app-warning);
}
.is-error {
  color: var(--app-error);
}
.is-info {
  color: var(--app-info);
}
.is-default {
  color: var(--app-text-3);
}

/* 纯圆点：不占文字位 */
.is-dot {
  gap: 0;
}
.is-dot .status-badge__label {
  display: none;
}

/* 胶囊：需要比行内文字更强的权重时使用 */
.is-pill {
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.is-pulse .status-badge__dot {
  animation: status-badge-pulse 1.8s var(--app-ease) infinite;
}

@keyframes status-badge-pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 55%, transparent);
  }
  50% {
    opacity: 0.75;
    box-shadow: 0 0 0 4px transparent;
  }
}

.status-badge__errors {
  margin: 0;
  padding-left: 16px;
  max-width: 320px;
  max-height: 240px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
}

@media (prefers-reduced-motion: reduce) {
  .is-pulse .status-badge__dot {
    animation: none;
  }
}
</style>
