<template>
  <div class="app-stack">
    <PageHeader :title="t('record.logTitle', { name: domainName || '#' + domainId })" :subtitle="t('record.logSubtitle')" :back="`/domains/${domainId}/records`" />
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
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const route = useRoute();
const { t } = useI18n();
const message = useMessage();
const domainId = Number(route.params.id);
const domainName = ref('');
const rows = ref<any[]>([]);
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