<template>
  <div class="app-stack">
    <PageHeader :title="t('schedule.policyTitle')" :subtitle="t('schedule.listSubtitle')">
      <template #actions>
        <n-button type="primary" @click="$router.push('/schedule-tasks/add')">
          <template #icon><n-icon :component="AddOutline" /></template>
          {{ t('schedule.addPolicy') }}
        </n-button>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="tasks.length" :label="t('common.scheduleTasks')" tone="primary" :icon="ListOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="activeTasks" :label="t('common.active')" tone="success" :icon="CheckmarkCircleOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="pausedTasks" :label="t('common.disabled')" tone="warning" :icon="PauseOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <n-space style="margin-bottom: 16px">
        <n-select v-model:value="searchType" :options="searchTypeOptions" style="width: 130px" />
        <n-input v-model:value="kw" :placeholder="t('schedule.keyword')" style="width: 200px" @keyup.enter="search" />
        <n-select v-model:value="stype" :options="stypeOptions" clearable :placeholder="t('schedule.execPlaceholder')" style="width: 130px" />
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
        :empty-text="t('schedule.empty')"
      />

      <n-space v-if="checkedRowKeys.length" style="margin-top: 12px">
        <n-button size="small" @click="batch('open')">{{ t('schedule.batchOpen') }}</n-button>
        <n-button size="small" @click="batch('close')">{{ t('schedule.batchClose') }}</n-button>
        <n-button size="small" type="error" @click="batch('delete')">{{ t('schedule.batchDelete') }}</n-button>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, SearchOutline, RefreshOutline, ListOutline, CheckmarkCircleOutline, PauseOutline } from '@vicons/ionicons5';
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
const activeTasks = computed(() => tasks.value.filter((t: any) => t.active).length);
const pausedTasks = computed(() => tasks.value.filter((t: any) => !t.active).length);
const page = ref(1);
const pageSize = ref(10);
const checkedRowKeys = ref<number[]>([]);

const searchType = ref(1);
const kw = ref('');
const stype = ref<number | null>(null);

const searchTypeOptions = computed(() => [
  { label: t('schedule.searchDomain'), value: 1 },
  { label: t('schedule.searchRecordId'), value: 2 },
  { label: t('schedule.searchValue'), value: 3 },
  { label: t('schedule.searchRemark'), value: 4 },
]);
const stypeOptions = computed(() => [
  { label: t('schedule.once'), value: 0 },
  { label: t('schedule.cycle'), value: 1 },
]);

const switchtypeMap = computed<Record<number, string>>(() => ({
  0: t('schedule.modify'),
  1: t('schedule.enable'),
  2: t('schedule.pause'),
  3: t('schedule.delete'),
}));

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

const columns = computed<any[]>(() => [
  { type: 'selection' },
  { title: 'ID', key: 'id', width: 60 },
  {
    title: t('schedule.searchDomain'),
    key: 'rr',
    minWidth: 160,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.rr + '.' + row.domain });
    },
  },
  { title: t('schedule.execType'), key: 'type', width: 90, render: (row: any) => (row.type === 1 ? t('schedule.cycleShort') : t('schedule.onceShort')) },
  {
    title: t('schedule.switchSet'),
    key: 'switchtype',
    width: 110,
    render(row: any) {
      const tagType = row.switchtype === 0 ? 'warning' : row.switchtype === 3 ? 'error' : 'default';
      return h(NTag, { size: 'small', type: tagType, bordered: false }, { default: () => switchtypeMap.value[row.switchtype] || row.switchtype });
    },
  },
  {
    title: t('schedule.running'),
    key: 'active',
    width: 70,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.active ? 'success' : 'default', bordered: false }, { default: () => (row.active ? t('dm.running') : t('dm.stopped')) });
    },
  },
  { title: t('schedule.nextRun'), key: 'nexttimestr', width: 160 },
  { title: t('schedule.lastRun'), key: 'updatetimestr', width: 160 },
  { title: t('common.remark'), key: 'remark', minWidth: 100, render: (row: any) => row.remark || '-' },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 180,
    render(row: any) {
      const btns: any[] = [];
      btns.push(h(NButton, { size: 'tiny', onClick: () => router.push('/schedule-tasks/' + row.id + '/edit') }, { default: () => t('common.edit') }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => toggleActive(row) }, { default: () => (row.active ? t('common.disable') : t('common.enable')) }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h(NSpace, null, { default: () => btns });
    },
  },
]);

async function loadTasks() {
  loading.value = true;
  const res = await api<any>('GET', '/schedule/tasks', {
    offset: (page.value - 1) * pageSize.value,
    limit: pageSize.value,
    type: searchType.value,
    kw: kw.value || undefined,
    stype: stype.value === null ? undefined : stype.value,
  });
  if (res.code === 0) {
    tasks.value = res.data.list;
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
  stype.value = null;
  searchType.value = 1;
  page.value = 1;
  loadTasks();
}
function onCheckedRowKeys(keys: number[]) {
  checkedRowKeys.value = keys;
}

function batch(act: string) {
  const ids = checkedRowKeys.value;
  if (!ids.length) return message.warning(t('schedule.noSelection'));
  dialog.warning({
    title: t('schedule.batchTitle'),
    content: t('schedule.batchConfirm', { count: ids.length }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('POST', '/schedule/tasks/batch', { act, ids });
      if (res.code === 0) message.success(res.msg);
      else message.error(res.msg);
      checkedRowKeys.value = [];
      loadTasks();
    },
  });
}

async function toggleActive(row: any) {
  const res = await api('POST', `/schedule/tasks/${row.id}/active`, { active: row.active ? 0 : 1 });
  if (res.code === 0) message.success(t('common.success'));
  else message.error(res.msg);
  loadTasks();
}

function del(row: any) {
  dialog.warning({
    title: t('schedule.deleteTitle'),
    content: t('schedule.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/schedule/tasks/${row.id}`);
      if (res.code === 0) {
        message.success(t('schedule.deleteSuccess'));
        loadTasks();
      } else message.error(res.msg);
    },
  });
}

onMounted(loadTasks);
</script>