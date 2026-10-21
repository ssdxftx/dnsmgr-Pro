<template>
  <div class="app-stack">
    <PageHeader :title="t('statistics.title')" :subtitle="t('statistics.subtitle')">
      <template #actions>
        <n-button @click="load" :loading="busy">
          <template #icon><n-icon :component="RefreshOutline" /></template>
          {{ t('common.refresh') }}
        </n-button>
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
          @change="load"
        />
      </div>
    </n-card>

    <n-alert v-if="errors.length" type="warning" :show-icon="false">
      {{ t('statistics.partialFail', { errors: errors.join('; ') }) }}
    </n-alert>

    <div class="provider-grid">
      <ProviderCard
        v-for="p in providers"
        :key="p.route"
        :data="p"
        :loading="busy"
        @detail="goDetail"
      />
    </div>

    <div v-if="!busy && !errors.length && !providers.length" class="empty-panel">
      <EmptyState :icon="CloudOutline" :title="t('statistics.noProviders')">
        <template #actions>
          <n-button type="primary" @click="router.push('/cdn-accounts')">
            {{ t('statistics.goConnect') }}
          </n-button>
        </template>
      </EmptyState>
    </div>

    <p v-if="providers.length" class="data-note">{{ t('statistics.dataNote', { time: dataUntil || '—' }) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { NAlert, NButton, NCard, NIcon } from 'naive-ui';
import { CloudOutline, RefreshOutline } from '@vicons/ionicons5';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import RangeFilter from '../components/statistics/RangeFilter.vue';
import ProviderCard, { type ProviderCardData } from '../components/statistics/ProviderCard.vue';

const { t } = useI18n();
const router = useRouter();
const isAdmin = computed(() => (getUser()?.level || 0) >= 2);

const range = ref('24h');
const customRange = ref<[number, number] | null>(null);
const providers = ref<ProviderCardData[]>([]);
const busy = ref(false);
const errors = ref<string[]>([]);
const dataUntil = ref('');

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function fmt(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function computeRange(): { startTime: string; endTime: string } {
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range.value === 'today') {
    return { startTime: fmt(t0), endTime: fmt(new Date(t0.getTime() + 86400000)) };
  }
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

let loadSeq = 0;
let loadAbort: AbortController | null = null;

async function load() {
  const seq = ++loadSeq;
  loadAbort?.abort();
  const ctrl = new AbortController();
  loadAbort = ctrl;
  busy.value = true;
  try {
    const { startTime, endTime } = computeRange();
    const res = await api<any>('GET', '/cdn/statistics/overview', { startTime, endTime }, { signal: ctrl.signal });
    if (seq !== loadSeq) return;
    if (res.code !== 0) throw new Error(res.msg || t('statistics.queryFailed'));
    providers.value = res.data?.providers || [];
    dataUntil.value = res.data?.dataUntil || '';
    errors.value = providers.value
      .filter((p) => p.status === 'error' || p.status === 'timeout' || p.status === 'partial')
      .map((p) => `${p.name}: ${p.error || t(`statistics.status.${p.status}`)}`);
  } catch (e: any) {
    if (seq !== loadSeq || ctrl.signal.aborted) return;
    errors.value = [e?.message || String(e)];
  } finally {
    if (seq === loadSeq) busy.value = false;
  }
}

function goDetail(route: string) {
  router.push(`/statistics/${route}`);
}

onMounted(() => {
  load();
});
</script>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.provider-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 899px) {
  .provider-grid {
    grid-template-columns: 1fr;
  }
}
.data-note {
  margin: 0;
  font-size: 12px;
  color: var(--app-text-3);
}
.empty-panel {
  display: flex;
  justify-content: center;
  padding: 48px 0;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-lg);
}
.mb-3 {
  margin-bottom: 12px;
}
@media (max-width: 767px) {
  .provider-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .empty-panel {
    padding: 32px 0;
  }
}
</style>
