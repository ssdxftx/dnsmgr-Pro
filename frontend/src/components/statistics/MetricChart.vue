<template>
  <div ref="el" class="metric-chart" :style="{ height: `${height}px` }" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useThemeMode } from '../../composables/useThemeMode';
import { formatMetric, msAxisFormatter, type MetricUnit } from '../../lib/statistics/format';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export interface ChartSeriesInput {
  key: string;
  label: string;
  values: (number | null)[];
  unit: MetricUnit;
  chart?: 'line' | 'bar' | 'area';
}

const props = withDefaults(
  defineProps<{
    labels: string[];
    series: ChartSeriesInput[];
    dual?: boolean;
    stack?: boolean;
    height?: number;
  }>(),
  { dual: false, stack: false, height: 280 },
);

const { isDark } = useThemeMode();

// 毫秒轴按当前轴最大值统一小数位：≥100 取整，≥10 一位，其余两位。
// 用循环求最大值，避免大数据量时 map + 展开分配大数组。
const msDigits = computed(() => {
  let maxAbs = 0;
  for (const s of props.series) {
    for (const v of s.values) {
      const abs = Math.abs(v ?? 0);
      if (abs > maxAbs) maxAbs = abs;
    }
  }
  return maxAbs >= 100 ? 0 : maxAbs >= 10 ? 1 : 2;
});
const axisFmt = (unit: MetricUnit) =>
  unit === 'ms' ? msAxisFormatter(msDigits.value) : (v: number) => formatMetric(v, unit);
const el = ref<HTMLDivElement>();
let chart: echarts.ECharts | null = null;
let observer: ResizeObserver | null = null;
let resizeRaf = 0;
let tokenCache: Record<string, string> | null = null;

function tokens(): Record<string, string> {
  if (tokenCache) return tokenCache;
  const s = getComputedStyle(document.documentElement);
  const g = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  tokenCache = {
    primary: g('--app-primary', '#0a7a5c'),
    text: g('--app-text-2', '#888'),
    faint: g('--app-text-3', '#aaa'),
    line: g('--app-divider', 'rgba(0,0,0,0.1)'),
    surface: g('--app-surface', '#fff'),
    textMain: g('--app-text', '#222'),
  };
  return tokenCache;
}

function option(): any {
  const tk = tokens();
  const colors = [tk.primary, '#38bdf8', '#fbbf24', '#fb7185', '#a78bfa', '#34d399'];
  const firstUnit = props.series[0]?.unit || 'count';
  const secondUnit = props.series[1]?.unit || firstUnit;
  const yAxis = props.dual
    ? [
        {
          type: 'value',
          axisLabel: { color: tk.faint, formatter: axisFmt(firstUnit) },
          splitLine: { lineStyle: { type: 'dashed', color: tk.line, opacity: 0.6 } },
        },
        {
          type: 'value',
          axisLabel: { color: tk.faint, formatter: axisFmt(secondUnit) },
          splitLine: { show: false },
        },
      ]
    : {
        type: 'value',
        axisLabel: { color: tk.faint, formatter: axisFmt(firstUnit) },
        splitLine: { lineStyle: { type: 'dashed', color: tk.line, opacity: 0.6 } },
      };
  return {
    color: colors,
    textStyle: { fontFamily: "'IBM Plex Mono', monospace" },
    grid: { left: 64, right: props.dual ? 64 : 20, top: 40, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: tk.surface,
      borderColor: tk.line,
      textStyle: { color: tk.textMain, fontSize: 12 },
      valueFormatter: undefined,
    },
    legend: { top: 0, textStyle: { color: tk.text }, type: 'scroll' },
    xAxis: {
      type: 'category',
      data: props.labels,
      boundaryGap: props.stack,
      axisLine: { lineStyle: { color: tk.line } },
      axisTick: { show: false },
      axisLabel: { color: tk.faint },
    },
    yAxis,
    series: props.series.map((s, i) => {
      const type = s.chart === 'bar' ? 'bar' : 'line';
      return {
        name: s.label,
        type,
        yAxisIndex: props.dual && i > 0 ? 1 : 0,
        stack: props.stack ? 'total' : undefined,
        smooth: type === 'line',
        showSymbol: false,
        connectNulls: false,
        areaStyle: s.chart === 'area' || type === 'line' ? { opacity: type === 'line' && !s.chart ? 0 : 0.12 } : undefined,
        data: s.values,
        tooltip: {
          valueFormatter: (v: any) => (v == null ? '—' : formatMetric(Number(v), s.unit)),
        },
      };
    }),
  };
}

function render() {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  chart.setOption(option(), { notMerge: true, lazyUpdate: true });
}

onMounted(() => {
  render();
  if (el.value) {
    // ResizeObserver 在侧栏动画期间可能每帧触发，合并到一帧只 resize 一次
    observer = new ResizeObserver(() => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        chart?.resize();
      });
    });
    observer.observe(el.value);
  }
});

// 父组件切换 loading/tab 时会创建新的临时数组；浅监听避免无关渲染触发全量重绘
watch(() => [props.labels, props.series, props.dual, props.stack], render, { flush: 'post' });
watch(isDark, () => {
  tokenCache = null;
  render();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = 0;
  }
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.metric-chart {
  width: 100%;
  min-width: 0;
}
@media (max-width: 767px) {
  .metric-chart {
    height: 210px !important;
  }
}
</style>
