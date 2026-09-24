<template>
  <div class="empty-state">
    <div v-if="icon" class="empty-state__icon">
      <n-icon size="30" :component="icon" />
    </div>
    <div v-if="title" class="empty-state__title">{{ title }}</div>
    <div v-if="description" class="empty-state__desc">{{ description }}</div>
    <div v-if="$slots.default" class="empty-state__action">
      <slot />
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
  }>(),
  { title: '', description: '', icon: undefined },
);
</script>

<style scoped>
.empty-state__action {
  margin-top: 6px;
}
</style>