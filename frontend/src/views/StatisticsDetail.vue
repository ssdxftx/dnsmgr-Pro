<template>
  <div class="app-stack detail-page">
    <PageHeader :back="'/statistics'" :title="`${meta.name} · ${t('statistics.title')}`">
      <template #actions>
        <div class="head-actions">
          <n-switch v-model:value="autoRefresh" size="small">
            <template #checked>{{ t('statistics.autoRefresh') }}</template>
            <template #unchecked>{{ t('statistics.autoRefresh') }}</template>
          </n-switch>
          <n-button @click="reload" :loading="busy">
            <template #icon><n-icon :component="RefreshOutline" /></template>
            {{ t('common.refresh') }}
          </n-button>
        </div>
      </template>
    </PageHeader>

    <n-card :bordered="false" class="filter-card">
      <n-alert v-if="!isAdmin" type="info" :show-icon="false" class="mb-3">
        {{ t('statistics.cacheDataHint') }}
      </n-alert>
      <div class="filters">
        <RangeFilter
          :range="range"
          :custom-range="customRange"
          :is-admin="isAdmin"
          @update:range="range = $event"
          @update:custom-range="customRange = $event"
          @change="reload"
        />
        <n-select
          v-if="isAdmin && accountOptions.length > 1"
          v-model:value="selectedAid"
          :options="accountOptions"
          :placeholder="t('statistics.allAccounts')"
          clearable
          class="filter-aid"
          @update:value="reload"
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
          @update:value="reload"
        />
        <StatusChip :status="detail?.meta?.status || 'ok'" :errors="errors" />
      </div>
    </n-card>

    <KpiRow :items="kpiItems" />

    <n-tabs v-model:value="tab" type="line" animated @update:value="onTab">
      <n-tab-pane v-for="g in meta.groups" :key="g" :name="g" :tab="t(`statistics.group.${g}`)">
        <div v-if="busy && !loaded.has(g)" class="tab-loading"><n-spin size="small" /></div>
        <component
          v-else
          :is="providerView"
          :group="g"
          :labels="detail?.labels || []"
          :series="seriesByGroup.get(g) || []"
          :breakdowns="breakdownsByGroup.get(g) || []"
          :top-dims="meta.topDims"
          :top-dim="topDim"
          @update:top-dim="onTopDim"
        />
      </n-tab-pane>
    </n-tabs>

    <p class="data-note">
      {{ t('statistics.delayNote', { n: detail?.meta?.delayMinutes ?? meta.delayMinutes }) }}
      · {{ t('statistics.dataNote', { time: detail?.meta?.dataUntil || '—' }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NIcon,
  NSelect,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
} from 'naive-ui';
import {
  BarChartOutline,
  CloudDownloadOutline,
  CloudOutline,
  FlashOutline,
  RefreshOutline,
  SpeedometerOutline,
} from '@vicons/ionicons5';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import KpiRow, { type KpiItem } from '../components/statistics/KpiRow.vue';
import RangeFilter from '../components/statistics/RangeFilter.vue';
import StatusChip from '../components/statistics/StatusChip.vue';
import { PROVIDERS, GROUP_BREAKDOWNS } from '../lib/statistics/catalog';
import { formatMetric, type MetricUnit } from '../lib/statistics/format';

interface MetricSeriesData {
  key: string;
  group: string;
  unit: MetricUnit;
  agg: string;
  chart: string;
  values: (number | null)[];
  summary: number | null;
  stack?: string;
}

interface BreakdownData {
  key: string;
  titleKey: string;
  unit: MetricUnit;
  rows: Array<{ label: string; value: number; percent: number }>;
}

interface DetailData {
  labels: string[];
  interval: string;
  series: MetricSeriesData[];
  breakdowns: BreakdownData[];
  meta: { status: string; dataUntil: string; delayMinutes: number; cached: boolean; tookMs: number };
  _errors?: string[];
}

const { t } = useI18n();
const route = useRoute();
const routeKey = String(route.params.route || '');
const meta = PROVIDERS[routeKey] || PROVIDERS.tencent_edgeone;
const providerView = defineAsyncComponent(
  ({
    tencent_edgeone: () => import('./statistics/DetailEdgeOne.vue'),
    tencent_cdn: () => import('./statistics/DetailTencentCdn.vue'),
    aliyun_cdn: () => import('./statistics/DetailAliyunCdn.vue'),
    aliyun_esa: () => import('./statistics/DetailAliyunEsa.vue'),
  } as Record<string, () => Promise<any>>)[routeKey] || (() => import('./statistics/DetailEdgeOne.vue')),
);
const isAdmin = computed(() => (getUser()?.level || 0) >= 2);

const range = ref('24h');
const customRange = ref<[number, number] | null>(null);
const selectedAid = ref<number | null>(null);
const selectedDomains = ref<string[]>([]);
const accountOptions = ref<Array<{ label: string; value: number }>>([]);
const domainOptions = ref<Array<{ label: string; value: string }>>([]);
const detail = ref<DetailData | null>(null);
const busy = ref(false);
const tab = ref('overview');
const topDim = ref(meta.topDims[0] || '');
const autoRefresh = ref(false);
const errors = ref<string[]>([]);
const seriesByGroup = ref(new Map<string, MetricSeriesData[]>());
const breakdownsByGroup = ref(new Map<string, BreakdownData[]>());
const loaded = ref(new Set<string>());

let timer: ReturnType<typeof setInterval> | null = null;

const seriesMap = computed(() => {
  const map = new Map<string, MetricSeriesData>();
  for (const list of seriesByGroup.value.values()) for (const s of list) map.set(s.key, s);
  return map;
});

const kpiItems = computed<KpiItem[]>(() => {
  const icons: Record<string, any> = {
    flux: CloudOutline,
    bw: SpeedometerOutline,
    bs_flux: CloudDownloadOutline,
    req: BarChartOutline,
    hit_rate: FlashOutline,
  };
  const tones: Record<string, KpiItem['tone']> = {
    flux: 'primary',
    bw: 'info',
    bs_flux: 'success',
    req: 'warning',
    hit_rate: 'primary',
  };
  return ['flux', 'bw', 'bs_flux', 'req', 'hit_rate'].map((key) => {
    const s = seriesMap.value.get(key) || (key === 'hit_rate' ? seriesMap.value.get('hit_rate_flux') : undefined);
    return {
      key,
      label:
        key === 'bw' && detail.value?.interval === 'day'
          ? t('statistics.bwDailyLabel')
          : t(`statistics.basic.${key}`),
      valueText: s ? formatMetric(s.summary, s.unit) : '—',
      tone: tones[key],
      icon: icons[key],
    };
  });
});

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function fmt(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function computeRange(): { startTime: string; endTime: string } {
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range.value === 'today') return { startTime: fmt(t0), endTime: fmt(new Date(t0.getTime() + 86400000)) };
  if (range.value === '7d') {
    return { startTime: fmt(new Date(t0.getTime() - 6 * 86400000)), endTime: fmt(new Date(t0.getTime() + 86400000)) };
  }
  if (range.value === '30d') {
    return { startTime: fmt(new Date(t0.getTime() - 29 * 86400000)), endTime: fmt(new Date(t0.getTime() + 86400000)) };
  }
  if (range.value === 'custom' && customRange.value?.length === 2) {
    return { startTime: fmt(new Date(customRange.value[0])), endTime: fmt(new Date(customRange.value[1])) };
  }
  return { startTime: fmt(new Date(now.getTime() - 86400000)), endTime: fmt(now) };
}

function onTopDim(value: string) {
  topDim.value = value;
  loadGroup('top');
}

async function loadGroup(group: string) {
  busy.value = true;
  try {
    const { startTime, endTime } = computeRange();
    const groups = Array.from(new Set(['overview', group]));
    const top = group === 'top' ? meta.topDims.join(',') : (GROUP_BREAKDOWNS[routeKey]?.[group] || []).join(',');
    const res = await api<any>('GET', '/cdn/statistics/detail', {
      route: routeKey,
      startTime,
      endTime,
      groups: groups.join(','),
      aid: selectedAid.value || undefined,
      domains: selectedDomains.value.length ? selectedDomains.value.join(',') : undefined,
      top: top || undefined,
    });
    if (res.code !== 0) throw new Error(res.msg || t('statistics.queryFailed'));
    const data = res.data as DetailData;
    detail.value = { ...data, series: [...(detail.value?.series || [])], breakdowns: [...(detail.value?.breakdowns || [])] };
    const overviewKeys = new Set(['flux', 'bw', 'bs_flux', 'req', 'hit_rate', 'hit_rate_flux']);
    const nextSeries = new Map(seriesByGroup.value);
    for (const g of groups) {
      nextSeries.set(
        g,
        g === 'overview'
          ? data.series.filter((s) => overviewKeys.has(s.key))
          : data.series.filter((s) => s.group === g),
      );
    }
    const nextBreakdowns = new Map(breakdownsByGroup.value);
    nextBreakdowns.set(group, data.breakdowns);
    seriesByGroup.value = nextSeries;
    breakdownsByGroup.value = nextBreakdowns;
    const nextLoaded = new Set(loaded.value);
    nextLoaded.add(group);
    loaded.value = nextLoaded;
    errors.value = data._errors || [];
  } catch (e: any) {
    errors.value = [e?.message || String(e)];
  } finally {
    busy.value = false;
  }
}

async function reload() {
  seriesByGroup.value = new Map();
  breakdownsByGroup.value = new Map();
  loaded.value = new Set();
  await loadGroup(tab.value);
}

function onTab(value: string) {
  if (!loaded.value.has(value)) loadGroup(value);
}

async function loadOptions() {
  if (!isAdmin.value) return;
  const [a, d] = await Promise.all([
    api<any>('GET', '/cdn/accounts').catch(() => ({ code: -1, data: [] })),
    api<any>('GET', '/cdn/domains').catch(() => ({ code: -1, data: [] })),
  ]);
  accountOptions.value = (a.data || []).map((x: any) => ({ label: `${x.name}（${x.typename || x.type}）`, value: x.id }));
  domainOptions.value = (d.data || []).map((x: any) => ({ label: x.name, value: x.name }));
}

watch(autoRefresh, (on) => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (on) timer = setInterval(() => loadGroup(tab.value), 60_000);
});

onMounted(() => {
  loadOptions();
  loadGroup('overview');
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.filter-aid {
  width: 200px;
}
.filter-domains {
  width: 260px;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.chart-grid :deep(.n-card) {
  min-width: 0;
}
.chart-card--wide {
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
.tab-loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}
.tab-empty {
  padding: 40px 0;
}
.data-note {
  margin: 0;
  font-size: 12px;
  color: var(--app-text-3);
}
.mb-3 {
  margin-bottom: 12px;
}
@media (max-width: 767px) {
  .filter-aid,
  .filter-domains {
    width: 100%;
  }
  .chart-grid,
  .breakdown-grid {
    grid-template-columns: 1fr;
  }
  .top-select {
    width: 100%;
  }
  .head-actions {
    flex-wrap: wrap;
  }
}
</style>
