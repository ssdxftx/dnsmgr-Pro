<template>
  <div class="stat-card">
    <div v-if="icon" class="stat-card__icon" :class="`stat-card__icon--${tone}`">
      <n-icon size="24" :component="icon" />
    </div>
    <div class="stat-card__body">
      <div class="stat-card__label">{{ label }}</div>
      <div class="stat-card__value" :class="{ 'is-text': isText }">
        {{ value }}<span v-if="suffix" class="stat-card__suffix">{{ suffix }}</span>
      </div>
    </div>
    <slot name="extra" />
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';
import { NIcon } from 'naive-ui';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    suffix?: string;
    tone?: 'primary' | 'success' | 'warning' | 'error' | 'info';
    icon?: Component;
  }>(),
  { suffix: '', tone: 'primary', icon: undefined },
);

// 时间串等长文本改用正文字体与较小字号，避免等宽数字字体折行、比计数还抢眼
const isText = computed(() => typeof props.value === 'string' && props.value.length > 10);
</script>