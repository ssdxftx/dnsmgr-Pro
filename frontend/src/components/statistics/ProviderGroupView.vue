<template>
  <div>
    <div v-if="charts.length" class="chart-grid" :class="{ 'chart-grid--single': charts.length === 1 }">
      <n-card
        v-for="(cfg, idx) in charts"
        :key="idx"
        size="small"
        :bordered="false"
        :class="{ 'chart-card--wide': idx === 0 && group === 'overview' }"
      >
        <MetricChart
          :labels="labels"
          :series="chartSeriesList[idx] || []"
          :dual="cfg.dual"
          :stack="cfg.stack"
          :height="280"
        />
      </n-card>
    </div>
    <div v-if="group === 'top' && topDims.length" class="top-toolbar">
      <n-select
        :value="topDim"
        :options="topDims.map((d) => ({ label: t(`statistics.top.${d}`), value: d }))"
        class="top-select"
        @update:value="$emit('update:topDim', $event)"
      />
    </div>
    <div v-if="shownBreakdowns.length" class="breakdown-grid">
      <n-card v-for="bd in shownBreakdowns" :key="bd.key" size="small" :bordered="false">
        <BreakdownTable :rows="bd.rows" :unit="bd.unit" :title-key="bd.titleKey" />
      </n-card>
    </div>
    <EmptyState v-if="!charts.length && !shownBreakdowns.length" :icon="BarChartOutline" :title="t('statistics.noData')" class="tab-empty" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NCard, NSelect } from 'naive-ui';
import { BarChartOutline } from '@vicons/ionicons5';
import EmptyState from '../EmptyState.vue';
import MetricChart from './MetricChart.vue';
import BreakdownTable from './BreakdownTable.vue';
import type { ChartConfig } from '../../lib/statistics/catalog';
import type { MetricUnit } from '../../lib/statistics/format';

export interface SeriesInput {
  key: string;
  group: string;
  unit: MetricUnit;
  chart: string;
  values: (number | null)[];
  summary: number | null;
}

export interface BreakdownInput {
  key: string;
  titleKey: string;
  unit: MetricUnit;
  rows: Array<{ label: string; value: number; percent: number }>;
}

const props = withDefaults(
  defineProps<{
    group: string;
    labels: string[];
    series: SeriesInput[];
    breakdowns: BreakdownInput[];
    charts: ChartConfig[];
    topDims: string[];
    topDim: string;
  }>(),
  { topDims: () => [], topDim: '' },
);

defineEmits<{ (e: 'update:topDim', value: string): void }>();

const { t } = useI18n();

const byKey = computed(() => new Map(props.series.map((s) => [s.key, s])));

// 按图表配置一次性生成稳定引用，避免模板每次渲染都新建 series 数组，
// 触发 MetricChart 的浅监听与 ECharts 全量重绘。
const chartSeriesList = computed(() =>
  props.charts.map((cfg) =>
    cfg.keys
      .map((key) => byKey.value.get(key))
      .filter((s): s is SeriesInput => !!s)
      .map((s) => ({
        key: s.key,
        label: t(`statistics.metric.${s.key}`),
        values: s.values,
        unit: s.unit,
        chart: s.chart as 'line' | 'bar' | 'area',
      })),
  ),
);

const shownBreakdowns = computed(() => {
  if (props.group !== 'top') return props.breakdowns;
  return props.topDim ? props.breakdowns.filter((b) => b.key === props.topDim) : props.breakdowns;
});
</script>

<style scoped>
.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.chart-grid :deep(.n-card) {
  min-width: 0;
}
.chart-card--wide,
.chart-grid--single > :deep(.n-card) {
  grid-column: 1 / -1;
}
.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 14px;
}
.top-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.top-select {
  width: 220px;
}
.tab-empty {
  padding: 40px 0;
}
@media (max-width: 767px) {
  .chart-grid,
  .breakdown-grid {
    grid-template-columns: 1fr;
  }
  .top-select {
    width: 100%;
  }
}
</style>
