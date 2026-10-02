<template>
  <div class="app-stack">
    <PageHeader :title="t('statistics.title')" :subtitle="t('statistics.subtitle')">
      <template #actions>
        <n-button @click="load" :loading="loading">
          <template #icon><n-icon :component="RefreshOutline" /></template>
          {{ t('common.refresh') }}
        </n-button>
      </template>
    </PageHeader>
    <n-card :bordered="false">
      <n-alert v-if="!isAdmin" type="info" :show-icon="false" style="margin-bottom: 16px">
        {{ t('statistics.cacheDataHint') }}
      </n-alert>
      <div class="filters">
        <n-radio-group v-if="!isMobile" v-model:value="range" class="filter-range" @update:value="onRangeChange">
          <n-radio-button value="24h">{{ t('statistics.range24h') }}</n-radio-button>
          <n-radio-button value="today">{{ t('statistics.rangeToday') }}</n-radio-button>
          <n-radio-button value="7d">{{ t('statistics.range7d') }}</n-radio-button>
          <n-radio-button value="30d">{{ t('statistics.range30d') }}</n-radio-button>
          <n-radio-button v-if="isAdmin" value="custom">{{ t('statistics.rangeCustom') }}</n-radio-button>
        </n-radio-group>
        <div v-else class="range-pills">
          <n-button
            v-for="opt in visibleRangeOptions"
            :key="opt.value"
            size="small"
            :type="range === opt.value ? 'primary' : 'default'"
            :secondary="range !== opt.value"
            @click="setRange(opt.value)"
          >
            {{ opt.label }}
          </n-button>
        </div>
        <n-date-picker
          v-if="range === 'custom' && !isMobile"
          v-model:value="customRange"
          type="datetimerange"
          format="yyyy-MM-dd HH:mm:ss"
          class="filter-datetime"
          clearable
          @update:value="onRangeChange"
        />
        <template v-else-if="range === 'custom' && isMobile">
          <n-date-picker
            v-model:value="customStart"
            type="datetime"
            format="yyyy-MM-dd HH:mm:ss"
            class="filter-datetime"
            :placeholder="t('statistics.startTime')"
            clearable
            @update:value="onCustomPart"
          />
          <n-date-picker
            v-model:value="customEnd"
            type="datetime"
            format="yyyy-MM-dd HH:mm:ss"
            class="filter-datetime"
            :placeholder="t('statistics.endTime')"
            clearable
            @update:value="onCustomPart"
          />
        </template>
        <n-select
          v-if="isAdmin"
          v-model:value="selectedAid"
          :options="accountOptions"
          :placeholder="t('statistics.allAccounts')"
          clearable
          class="filter-aid"
        />
        <n-select
          v-if="isAdmin"
          v-model:value="selectedDomains"
          :options="domainOptions"
          :placeholder="t('statistics.allDomains')"
          multiple
          clearable
          filterable
          class="filter-domains"
        />
      </div>

      <n-alert v-if="errors.length" type="warning" :show-icon="false" style="margin-bottom: 16px">
        {{ t('statistics.partialFail', { errors: errors.join(', ') }) }}
      </n-alert>

      <n-grid cols="1 s:2 m:3" responsive="screen" :x-gap="14" :y-gap="14">
        <n-grid-item>
          <StatCard :label="t('statistics.fluxLabel')" :value="summary.fluxText" tone="primary" :icon="CloudOutline" />
        </n-grid-item>
        <n-grid-item>
          <StatCard :label="t('statistics.bwLabel')" :value="summary.bwText" tone="info" :icon="SpeedometerOutline" />
        </n-grid-item>
        <n-grid-item>
          <StatCard :label="t('statistics.bsFluxLabel')" :value="summary.bsFluxText" tone="success" :icon="CloudDownloadOutline" />
        </n-grid-item>
        <n-grid-item>
          <StatCard :label="t('statistics.reqLabel')" :value="summary.reqText" tone="warning" :icon="BarChartOutline" />
        </n-grid-item>
        <n-grid-item>
          <StatCard :label="t('statistics.hitRateLabel')" :value="summary.hitRateText" tone="primary" :icon="FlashOutline" />
        </n-grid-item>
      </n-grid>
    </n-card>

    <n-grid cols="1 m:2" responsive="screen" :x-gap="14" :y-gap="14">
      <n-grid-item>
        <n-card :title="t('statistics.fluxTrend')" size="small">
          <div ref="fluxRef" class="chart"></div>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card :title="t('statistics.bwTrend')" size="small">
          <div ref="bwRef" class="chart"></div>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card :title="t('statistics.reqTrend')" size="small">
          <div ref="reqRef" class="chart"></div>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card :title="t('statistics.statusDist')" size="small">
          <div ref="statusRef" class="chart"></div>
        </n-card>
      </n-grid-item>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CloudOutline, RefreshOutline, SpeedometerOutline, CloudDownloadOutline, BarChartOutline, FlashOutline } from '@vicons/ionicons5';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import StatCard from '../components/StatCard.vue';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const isMobile = ref(window.innerWidth < 768);
const isAdmin = computed(() => (getUser()?.level || 0) >= 2);
const { t } = useI18n();
const loading = ref(false);
const range = ref('24h');
const rangeOptions = computed(() => [
  { label: t('statistics.range24h'), value: '24h' },
  { label: t('statistics.rangeToday'), value: 'today' },
  { label: t('statistics.range7d'), value: '7d' },
  { label: t('statistics.range30d'), value: '30d' },
  { label: t('statistics.rangeCustom'), value: 'custom' },
]);
const customRange = ref<[number, number] | null>(null);
const visibleRangeOptions = computed(() => (isAdmin.value ? rangeOptions.value : rangeOptions.value.filter((o) => o.value !== 'custom')));
const customStart = ref<number | null>(null);
const customEnd = ref<number | null>(null);
const accountOptions = ref<{ label: string; value: number }[]>([]);
const domainOptions = ref<{ label: string; value: string }[]>([]);
const selectedAid = ref<number | null>(null);
const selectedDomains = ref<string[]>([]);
const errors = ref<string[]>([]);

const fluxRef = ref<HTMLDivElement>();
const bwRef = ref<HTMLDivElement>();
const reqRef = ref<HTMLDivElement>();
const statusRef = ref<HTMLDivElement>();
const charts: echarts.ECharts[] = [];

const resource = ref<any>(null);
const visits = ref<any>(null);
const status = ref<any>(null);
const labels = ref<string[]>([]);

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function fmt(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function computeRange(): { startTime: string; endTime: string } {
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range.value === 'today') {
    const tomorrow = new Date(t.getTime() + 86400000);
    return { startTime: fmt(t), endTime: fmt(tomorrow) };
  }
  if (range.value === '7d') {
    const start = new Date(t.getTime() - 6 * 86400000);
    const end = new Date(t.getTime() + 86400000);
    return { startTime: fmt(start), endTime: fmt(end) };
  }
  if (range.value === '30d') {
    const start = new Date(t.getTime() - 29 * 86400000);
    const end = new Date(t.getTime() + 86400000);
    return { startTime: fmt(start), endTime: fmt(end) };
  }
  if (range.value === 'custom' && customRange.value && customRange.value.length === 2) {
    return { startTime: fmt(new Date(customRange.value[0])), endTime: fmt(new Date(customRange.value[1])) };
  }
  return { startTime: fmt(new Date(now.getTime() - 86400000)), endTime: fmt(now) };
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 2)} ${units[i]}`;
}

function formatBitRate(bps: number): string {
  if (!bps || bps <= 0) return '0 Mbps';
  const mbps = bps / 1024 / 1024;
  return mbps >= 100 ? `${mbps.toFixed(0)} Mbps` : `${mbps.toFixed(2)} Mbps`;
}

const summary = computed(() => {
  const rs = resource.value?.resource_summary || {};
  const vs = visits.value?.visits_summary || {};
  const flux = Number(rs.flux || 0);
  const hitFlux = Number(vs.hit_flux || 0);
  const hitRate = flux > 0 ? (hitFlux / flux) * 100 : 0;
  return {
    fluxText: formatBytes(flux),
    bwText: formatBitRate(Number(rs.bw || 0)),
    bsFluxText: formatBytes(Number(rs.bs_flux || 0)),
    reqText: String(Number(vs.req_num || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
    hitRateText: `${hitRate.toFixed(1)}%`,
  };
});

function baseOption(): any {
  return {
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    xAxis: { type: 'category', data: labels.value, boundaryGap: false },
    yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', opacity: 0.4 } } },
  };
}

function renderChart(el: HTMLDivElement | undefined, option: any, seriesData: any) {
  if (!el) return;
  let chart = echarts.getInstanceByDom(el);
  if (!chart) {
    chart = echarts.init(el);
    charts.push(chart);
  }
  chart.setOption(option, true);
  void seriesData;
}

function renderCharts() {
  const x = labels.value;
  const rs = resource.value?.resource_detail || {};
  const vs = visits.value?.visits_detail || {};
  const st = status.value || {};

  renderChart(fluxRef.value, {
    ...baseOption(),
    series: [
      { name: t('statistics.seriesFlux'), type: 'line', smooth: true, areaStyle: { opacity: 0.1 }, data: rs.flux || [], tooltip: { valueFormatter: (v: any) => formatBytes(Number(v)) } },
      { name: t('statistics.seriesBsFlux'), type: 'line', smooth: true, data: rs.bs_flux || [] },
    ],
  }, null);

  renderChart(bwRef.value, {
    ...baseOption(),
    series: [
      { name: t('statistics.seriesBw'), type: 'line', smooth: true, areaStyle: { opacity: 0.1 }, data: (rs.bw || []).map((v: number) => Math.round((v || 0) / 1024 / 1024)) },
      { name: t('statistics.seriesBsBw'), type: 'line', smooth: true, data: (rs.bs_bw || []).map((v: number) => Math.round((v || 0) / 1024 / 1024)) },
    ],
  }, null);

  renderChart(reqRef.value, {
    ...baseOption(),
    series: [
      { name: t('statistics.seriesReq'), type: 'line', smooth: true, areaStyle: { opacity: 0.1 }, data: vs.req_num || [] },
      { name: t('statistics.seriesHit'), type: 'line', smooth: true, data: vs.hit_num || [] },
      { name: t('statistics.seriesBsReq'), type: 'line', smooth: true, data: vs.bs_num || [] },
    ],
  }, null);

  const codeNames = ['2xx', '3xx', '4xx', '5xx'];
  renderChart(statusRef.value, {
    ...baseOption(),
    legend: { top: 0 },
    series: codeNames.map((name, i) => ({
      name,
      type: 'bar',
      stack: 'total',
      data: st.status_detail?.[i] || [],
    })),
  }, null);
  void x;
}

async function load() {
  loading.value = true;
  try {
    const { startTime, endTime } = computeRange();
    const res = await api<any>('GET', '/cdn/statistics', {
      startTime,
      endTime,
      type: 'All',
      domains: selectedDomains.value.length ? selectedDomains.value.join(',') : undefined,
      aid: selectedAid.value || undefined,
    });
    if (res.code !== 0) throw new Error(res.msg || t('statistics.queryFailed'));
    const data = res.data || {};
    labels.value = data.labels || [];
    resource.value = data.resource || null;
    visits.value = data.visits || null;
    status.value = data.status || null;
    errors.value = (data._errors || []).map((e: string) => String(e));
    await nextTick();
    try {
      renderCharts();
    } catch (chartErr: any) {
      // 图表渲染失败不应清空已获取的统计数据
      console.error('[statistics] 图表渲染失败:', chartErr?.message || chartErr);
    }
  } catch (e: any) {
    errors.value = [e?.message || String(e)];
  } finally {
    loading.value = false;
  }
}

function onRangeChange() {
  load();
}

function setRange(value: string) {
  range.value = value;
  load();
}

function onCustomPart() {
  if (customStart.value != null && customEnd.value != null) {
    customRange.value = [customStart.value, customEnd.value];
  } else {
    customRange.value = null;
  }
  load();
}

async function loadOptions() {
  const [a, d] = await Promise.all([
    api<any>('GET', '/cdn/accounts').catch(() => ({ code: -1, data: [] })),
    api<any>('GET', '/cdn/domains').catch(() => ({ code: -1, data: [] })),
  ]);
  accountOptions.value = (a.data || []).map((x: any) => ({ label: `${x.name}（${x.typename || x.type}）`, value: x.id }));
  domainOptions.value = (d.data || []).map((x: any) => ({ label: x.name, value: x.name }));
}

function handleResize() {
  isMobile.value = window.innerWidth < 768;
  charts.forEach((c) => c.resize());
}

onMounted(() => {
  loadOptions();
  load();
  window.addEventListener('resize', handleResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  charts.forEach((c) => c.dispose());
});
</script>

<style scoped>
.chart {
  width: 100%;
  height: 280px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.filter-datetime {
  width: 340px;
}
.filter-aid {
  width: 200px;
}
.filter-domains {
  width: 260px;
}
.filter-range {
  max-width: 100%;
}
.range-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.range-pills :deep(.n-button) {
  flex: 1 1 auto;
  min-width: 76px;
}
@media (max-width: 767px) {
  .filter-datetime,
  .filter-aid,
  .filter-domains {
    width: 100%;
  }
}
</style>