<template>
  <div class="app-stack">
    <PageHeader :title="t('record.logTitle', { name: domainName || '#' + domainId })" :subtitle="t('record.logSubtitle')" :back="`/domains/${domainId}/records`" />
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="rows.length" :label="t('common.total')" tone="primary" :icon="ListOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="typeCount" :label="t('common.type')" tone="info" :icon="LayersOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="statusCount" :label="t('common.status')" tone="success" :icon="DocumentTextOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="rows" :loading="loading" :pagination="pagination" :empty-text="t('common.noData')" />
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
const loading = ref(false);
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

async function load() {
  loading.value = true;
  const res = await api<any>('GET', `/domains/${domainId}/recordlog`, { page: page.value, pagesize: pageSize.value });
  if (res.code === 0) {
    rows.value = res.data?.list || [];
    total.value = res.data?.total || 0;
  } else message.error(res.msg);
  loading.value = false;
}

onMounted(async () => {
  const dl = await api<any>('GET', '/domains');
  if (dl.code === 0) {
    const d = (dl.data || []).find((x: any) => x.id === domainId);
    if (d) domainName.value = d._base_name || d.name;
  }
  load();
});
</script>