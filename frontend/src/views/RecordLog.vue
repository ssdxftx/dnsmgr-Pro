<template>
  <div class="app-stack">
    <PageHeader :title="t('record.logTitle', { name: domainName || '#' + domainId })" :subtitle="t('record.logSubtitle')" :back="`/domains/${domainId}/records`" />
    <n-grid class="telemetry-row" cols="2 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="rows.length" :label="t('common.total')" tone="primary" :icon="ListOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="typeCount" :label="t('common.type')" tone="info" :icon="LayersOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="statusCount" :label="t('common.status')" tone="success" :icon="DocumentTextOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="rows" :loading="loadBusy" :pagination="pagination" :empty-text="t('common.noData')" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useMessage } from 'naive-ui';
import { api } from '../api';
import { ListOutline, LayersOutline, DocumentTextOutline } from '@vicons/ionicons5';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const route = useRoute();
const { t } = useI18n();
const message = useMessage();
const domainId = Number(route.params.id);
const domainName = ref('');
const rows = ref<any[]>([]);
const typeCount = computed(() => new Set(rows.value.filter((r: any) => r.type != null).map((r: any) => r.type)).size);
const statusCount = computed(() => new Set(rows.value.filter((r: any) => r.status != null).map((r: any) => r.status)).size);
const loadBusy = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

const columns = computed(() => [
  { title: t('record.logTime'), key: 'UpdateTime', width: 200 },
  { title: t('record.logRecordId'), key: 'RecordId', width: 200 },
  { title: t('record.logName'), key: 'Name' },
]);

const pagination = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  onChange: (p: number) => {
    page.value = p;
    load();
  },
}));

let loadAbort: AbortController | null = null;
async function load() {
  // 取消上一次未完成的请求，避免快速翻页时旧响应覆盖新页数据
  loadAbort?.abort();
  const ac = new AbortController();
  loadAbort = ac;
  loadBusy.value = true;
  try {
    const res = await api<any>('GET', `/domains/${domainId}/recordlog`, { page: page.value, pagesize: pageSize.value }, { signal: ac.signal });
    if (loadAbort !== ac) return;
    if (res.code === 0) {
      rows.value = res.data?.list || [];
      total.value = res.data?.total || 0;
    } else message.error(res.msg);
  } catch (e: any) {
    if (e?.name === 'AbortError') return;
  } finally {
    if (loadAbort === ac) loadBusy.value = false;
  }
}

async function loadDomainName() {
  const dl = await api<any>('GET', '/domains', undefined, { cache: true });
  if (dl.code === 0) {
    const d = (dl.data || []).find((x: any) => x.id === domainId);
    if (d) domainName.value = d._base_name || d.name;
  }
}

onMounted(() => {
  // 名称和列表互不依赖，并行请求，避免页面首屏多等一个 RTT
  void loadDomainName();
  load();
});
</script>