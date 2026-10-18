<template>
  <n-grid class="stat-grid" cols="2 s:3 m:5" responsive="screen" :x-gap="14" :y-gap="14">
    <n-grid-item v-for="item in items" :key="item.key">
      <StatCard :label="item.label" :value="item.valueText" :tone="item.tone" :icon="item.icon" />
    </n-grid-item>
  </n-grid>
</template>

<script setup lang="ts">
import { NGrid, NGridItem } from 'naive-ui';
import type { Component } from 'vue';
import StatCard from '../StatCard.vue';

export interface KpiItem {
  key: string;
  label: string;
  valueText: string;
  tone: 'primary' | 'success' | 'warning' | 'error' | 'info';
  icon?: Component;
}

defineProps<{ items: KpiItem[] }>();
</script>
