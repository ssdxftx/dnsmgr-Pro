<template>
  <div class="bd">
    <div class="bd__head">
      <span class="bd__title">{{ t(titleKey) }}</span>
      <span class="bd__hint">{{ t('statistics.top.share') }}</span>
    </div>
    <div v-if="!rows.length" class="bd__empty">{{ t('statistics.noData') }}</div>
    <ul v-else class="bd__list">
      <li v-for="row in visibleRows" :key="row.label" class="bd__row">
        <span class="bd__label" :title="row.label">{{ row.label }}</span>
        <span class="bd__bar"><i :style="{ width: `${Math.min(100, row.percent)}%` }" /></span>
        <span class="bd__value">{{ formatMetric(row.value, unit) }}</span>
        <span class="bd__percent">{{ row.percent.toFixed(1) }}%</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatMetric, type MetricUnit } from '../../lib/statistics/format';

const props = withDefaults(
  defineProps<{
    rows: Array<{ label: string; value: number; percent: number }>;
    unit: MetricUnit;
    titleKey: string;
    limit?: number;
  }>(),
  { limit: 10 },
);

const { t } = useI18n();
const visibleRows = computed(() => props.rows.slice(0, props.limit));
</script>

<style scoped>
.bd {
  min-width: 0;
}
.bd__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.bd__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
}
.bd__hint {
  font-size: 11px;
  color: var(--app-text-3);
}
.bd__empty {
  padding: 16px 0;
  font-size: 12px;
  color: var(--app-text-3);
}
.bd__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.bd__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px minmax(64px, auto) 48px;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  border-bottom: 1px solid var(--app-divider);
}
.bd__row:last-child {
  border-bottom: none;
}
.bd__label {
  min-width: 0;
  font-size: 12px;
  color: var(--app-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bd__bar {
  height: 6px;
  border-radius: 3px;
  background: var(--app-divider);
  overflow: hidden;
}
.bd__bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--app-primary);
}
.bd__value {
  font-family: var(--app-font-mono);
  font-size: 12px;
  color: var(--app-text);
  text-align: right;
  white-space: nowrap;
}
.bd__percent {
  font-size: 11px;
  color: var(--app-text-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 767px) {
  .bd__row {
    grid-template-columns: minmax(0, 1fr) 52px minmax(58px, auto) 42px;
    min-height: 44px;
    gap: 6px;
  }
}
</style>
