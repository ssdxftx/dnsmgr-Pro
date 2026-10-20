<template>
  <div class="empty-state" :class="[`empty-state--${tone}`, { 'empty-state--compact': compact }]">
    <div v-if="icon" class="empty-state__icon">
      <n-icon size="30" :component="icon" />
    </div>
    <div v-if="title" class="empty-state__title">{{ title }}</div>
    <div v-if="description" class="empty-state__desc">{{ description }}</div>
    <div v-if="$slots.actions || $slots.default" class="empty-state__action">
      <slot name="actions">
        <slot />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import { NIcon } from 'naive-ui';

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    icon?: Component;
    tone?: 'default' | 'error';
    /** 紧凑模式：用于弹窗/卡片内的小尺寸空态 */
    compact?: boolean;
  }>(),
  { title: '', description: '', icon: undefined, tone: 'default', compact: false },
);
</script>

<style scoped>
.empty-state__action {
  margin-top: 6px;
}
</style>
