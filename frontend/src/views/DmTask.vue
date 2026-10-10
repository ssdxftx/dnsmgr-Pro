<template>
  <div class="app-stack">
    <PageHeader :title="t('dm.policyTitle')" :subtitle="t('dm.policySubtitle')">
      <template #actions>
        <div class="actions">
          <n-button type="primary" @click="$router.push('/dm-tasks/add')">
            <template #icon><n-icon :component="AddOutline" /></template>
            {{ t('dm.addPolicy') }}
          </n-button>
          <n-dropdown trigger="click" :options="batchOptions" @select="onBatch">
            <n-button>{{ t('dm.batchOp') }}<template #icon><n-icon :component="ChevronDownOutline" /></template></n-button>
          </n-dropdown>
        </div>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="tasks.length" :label="t('common.total')" tone="primary" :icon="ListOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="typeCount" :label="t('common.type')" tone="info" :icon="LayersOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="statusCount" :label="t('common.status')" tone="success" :icon="SwapHorizontalOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <n-space style="margin-bottom: 16px">
        <n-select v-model:value="searchType" :options="searchTypeOptions" style="width: 140px" />
        <n-input v-model:value="kw" :placeholder="t('dm.keyword')" style="width: 200px" @keyup.enter="search" />
        <n-select v-model:value="status" :options="statusOptions" clearable :placeholder="t('dm.health')" style="width: 130px" />
        <n-button type="primary" @click="search"><template #icon><n-icon :component="SearchOutline" /></template>{{ t('common.search') }}</n-button>
        <n-button @click="clearSearch"><template #icon><n-icon :component="RefreshOutline" /></template>{{ t('common.refresh') }}</n-button>
      </n-space>

      <ResponsiveDataTable
        v-model:checked-row-keys="checkedRowKeys"
        :columns="columns"
        :data="tasks"
        :loading="loading"
        :pagination="pagination"
        :row-key="(row: any) => row.id"
        :empty-text="t('dm.empty')"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, SearchOutline, RefreshOutline, ChevronDownOutline, ListOutline, LayersOutline, SwapHorizontalOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();
const loading = ref(false);
const tasks = ref<any[]>([]);
const typeCount = computed(() => new Set(tasks.value.filter((r: any) => r.type != null).map((r: any) => r.type)).size);
const statusCount = computed(() => new Set(tasks.value.filter((r: any) => r.status != null).map((r: any) => r.status)).size);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const checkedRowKeys = ref<number[]>([]);

const searchType = ref(1);
const kw = ref('');
const status = ref<number | null>(null);

const searchTypeOptions = computed(() => [
  { label: t('dm.searchDomain'), value: 1 },
  { label: t('dm.searchRecordId'), value: 2 },
  { label: t('dm.searchRecord'), value: 3 },
  { label: t('dm.searchBackup'), value: 4 },
  { label: t('dm.searchRemark'), value: 5 },
]);
const statusOptions = computed(() => [
  { label: t('dm.normal'), value: 0 },
  { label: t('dm.abnormal'), value: 1 },
]);

const pagination = reactive({
  page: 1,
  pageSize: 10,
  itemCount: 0,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  onChange: (p: number) => {
    page.value = p;
    loadTasks();
  },
  onUpdatePageSize: (s: number) => {
    pageSize.value = s;
    page.value = 1;
    loadTasks();
  },
});

const typeMap = computed<Record<number, string>>(() => ({
  0: t('dm.noAction'),
  1: t('dm.pauseRecord'),
  2: t('dm.switchBackup'),
  3: t('dm.condEnableFull'),
}));
const checktypeMap: Record<number, string> = { 0: 'PING', 1: 'TCP', 2: 'HTTP(S)' };

const columns = computed<any[]>(() => [
  { type: 'selection' },
  { title: 'ID', key: 'id', width: 60 },
  {
    title: t('dm.domain'),
    key: 'rr',
    minWidth: 160,
    render(row: any) {
      const txt = row.rr + '.' + row.domain;
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => txt });
    },
  },
  { title: t('dm.record'), key: 'main_value', minWidth: 130, render: (row: any) => h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.main_value }) },
  {
    title: t('dm.switchSet'),
    key: 'type',
    width: 130,
    render(row: any) {
      if (row.type === 2) return h(NTag, { size: 'small', bordered: false }, { default: () => t('dm.switchBackup') });
      if (row.type === 1) return h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => t('dm.pauseRecord') });
      if (row.type === 3) return h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => t('dm.condEnable') });
      return typeMap.value[row.type];
    },
  },
  { title: t('dm.checkCol'), key: 'checktype', width: 80, render: (row: any) => checktypeMap[row.checktype] || row.checktype },
  { title: t('dm.interval'), key: 'frequency', width: 70, render: (row: any) => t('dm.intervalValue', { sec: row.frequency }) },
  {
    title: t('dm.health'),
    key: 'status',
    width: 90,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.status ? 'error' : 'success' }, { default: () => (row.status ? t('dm.abnormal') : t('dm.normal')) });
    },
  },
  {
    title: t('dm.run'),
    key: 'active',
    width: 70,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.active ? 'success' : 'default', bordered: false }, { default: () => (row.active ? t('dm.running') : t('dm.stopped')) });
    },
  },
  { title: t('dm.lastCheck'), key: 'checktimestr', width: 160 },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 240,
    render(row: any) {
      const btns: any[] = [];
      btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => router.push('/dm-tasks/' + row.id) }, { default: () => t('dm.detail') }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => router.push('/dm-tasks/' + row.id + '/edit') }, { default: () => t('common.edit') }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => retry(row) }, { default: () => t('dm.retry') }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => toggleActive(row) }, { default: () => (row.active ? t('common.disable') : t('common.enable')) }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h(NSpace, null, { default: () => btns });
    },
  },
]);

async function loadTasks() {
  loading.value = true;
  const res = await api<any>('GET', '/dmonitor/tasks', {
    offset: (page.value - 1) * pageSize.value,
    limit: pageSize.value,
    type: searchType.value,
    kw: kw.value || undefined,
    status: status.value === null ? undefined : status.value,
  });
  if (res.code === 0) {
    tasks.value = res.data.list;
    total.value = res.data.total;
    pagination.itemCount = res.data.total;
    pagination.page = page.value;
    pagination.pageSize = pageSize.value;
  }
  loading.value = false;
}

function search() {
  page.value = 1;
  loadTasks();
}

function clearSearch() {
  kw.value = '';
  status.value = null;
  searchType.value = 1;
  page.value = 1;
  loadTasks();
}

function onCheckedRowKeys(keys: number[]) {
  checkedRowKeys.value = keys;
}

const batchOptions = computed(() => [
  { label: t('dm.batchOpen'), key: 'open' },
  { label: t('dm.batchClose'), key: 'close' },
  { label: t('dm.batchRetry'), key: 'retry' },
  { label: t('common.delete'), key: 'delete' },
]);

function onBatch(key: string) {
  const ids = checkedRowKeys.value;
  if (!ids.length) return message.warning(t('dm.batchNoSelection'));
  dialog.warning({
    title: t('dm.batchTitle'),
    content: t('dm.batchConfirm', { count: ids.length }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('POST', '/dmonitor/tasks/batch', { act: key, ids });
      if (res.code === 0) message.success(res.msg);
      else message.error(res.msg);
      checkedRowKeys.value = [];
      loadTasks();
    },
  });
}

async function retry(row: any) {
  const res = await api('POST', '/dmonitor/tasks/batch', { act: 'retry', ids: [row.id] });
  if (res.code === 0) message.success(t('dm.retrySet'));
  else message.error(res.msg);
  loadTasks();
}

async function toggleActive(row: any) {
  const res = await api('POST', `/dmonitor/tasks/${row.id}/active`, { active: row.active ? 0 : 1 });
  if (res.code === 0) message.success(t('common.success'));
  else message.error(res.msg);
  loadTasks();
}

function del(row: any) {
  dialog.warning({
    title: t('dm.deleteTitle'),
    content: t('dm.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/dmonitor/tasks/${row.id}`);
      if (res.code === 0) {
        message.success(t('dm.deleteSuccess'));
        loadTasks();
      } else message.error(res.msg);
    },
  });
}

onMounted(loadTasks);
</script>

<style scoped>
.actions {
  display: flex;
  gap: 8px;
}
</style>