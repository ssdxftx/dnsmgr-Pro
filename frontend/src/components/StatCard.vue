<template>
  <div class="stat-card">
    <div v-if="icon" class="stat-card__icon" :class="`stat-card__icon--${tone}`">
      <n-icon size="24" :component="icon" />
    </div>
    <div class="stat-card__body">
      <div class="stat-card__label">{{ label }}</div>
      <div class="stat-card__value">
        {{ value }}<span v-if="suffix" class="stat-card__suffix">{{ suffix }}</span>
      </div>
    </div>
    <slot name="extra" />
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import { NIcon } from 'naive-ui';

withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    suffix?: string;
    tone?: 'primary' | 'success' | 'warning' | 'error' | 'info';
    icon?: Component;
  }>(),
  { suffix: '', tone: 'primary', icon: undefined },
);
</script>