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
    <n-grid class="telemetry-row" cols="2 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="tasks.length" :label="t('common.scheduleTasks')" tone="primary" :icon="ListOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="activeTasks" :label="t('common.active')" tone="success" :icon="CheckmarkCircleOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="pausedTasks" :label="t('common.disabled')" tone="warning" :icon="PauseOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>
    <div class="app-toolbar">
      <n-select v-model:value="searchType" :options="searchTypeOptions" size="small" style="width: 130px" />
      <n-input v-model:value="kw" :placeholder="t('schedule.keyword')" size="small" style="width: 200px" @keyup.enter="search" />
      <n-select v-model:value="stype" :options="stypeOptions" clearable :placeholder="t('schedule.execPlaceholder')" size="small" style="width: 130px" />
      <n-button type="primary" size="small" @click="search"><template #icon><n-icon :component="SearchOutline" /></template>{{ t('common.search') }}</n-button>
      <n-button size="small" @click="clearSearch"><template #icon><n-icon :component="RefreshOutline" /></template>{{ t('common.refresh') }}</n-button>
    </div>

    <n-card :bordered="false">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('schedule.overview') }}</h3>
        </div>
        <n-descriptions :column="3" size="small" label-placement="top">
          <n-descriptions-item :label="t('schedule.cycleShort')">{{ cycleCount }}</n-descriptions-item>
          <n-descriptions-item :label="t('schedule.onceShort')">{{ tasks.length - cycleCount }}</n-descriptions-item>
          <n-descriptions-item :label="t('schedule.run24h')">{{ run24hCount }}</n-descriptions-item>
        </n-descriptions>
      </div>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('schedule.listTitle') }}</h3>
        </div>
        <ResponsiveDataTable
          v-model:checked-row-keys="checkedRowKeys"
          :columns="columns"
          :data="tasks"
          title-key="rr"
          :loading="loadBusy"
          :pagination="pagination"
          :row-key="(row: any) => row.id"
          :empty-text="t('schedule.empty')"
          :error="loadError"
          @retry="loadTasks"
        />

        <n-space v-if="checkedRowKeys.length" class="mt-3">
          <n-button size="small" @click="batch('open')">{{ t('schedule.batchOpen') }}</n-button>
          <n-button size="small" @click="batch('close')">{{ t('schedule.batchClose') }}</n-button>
          <n-button size="small" type="error" secondary @click="batch('delete')">{{ t('schedule.batchDelete') }}</n-button>
        </n-space>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, SearchOutline, RefreshOutline, ListOutline, CheckmarkCircleOutline, PauseOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import { useAction } from '../composables/useAction';

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();
const { busy, run: guard } = useAction();
const loadBusy = ref(false);
const loadError = ref(false);
const tasks = ref<any[]>([]);
const activeTasks = computed(() => tasks.value.filter((t: any) => t.active).length);
const run24hCount = computed(() => {
  const since = Date.now() - 24 * 3600 * 1000;
  return tasks.value.filter((t: any) => {
    const ts = t.updatetimestr ? new Date(String(t.updatetimestr).replace(' ', 'T')).getTime() : NaN;
    return Number.isFinite(ts) && ts >= since;
  }).length;
});
const pausedTasks = computed(() => tasks.value.filter((t: any) => !t.active).length);
const cycleCount = computed(() => tasks.value.filter((t: any) => t.type === 1).length);
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
  { title: 'ID', key: 'id', width: 60, mobile: 'hide' },
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
      btns.push(h(NButton, { size: 'tiny', quaternary: true, onClick: () => router.push('/schedule-tasks/' + row.id + '/edit') }, { default: () => t('common.edit') }));
      btns.push(
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            loading: !!busy[`active:${row.id}`],
            disabled: !!busy[`active:${row.id}`],
            onClick: () => guard(`active:${row.id}`, () => toggleActive(row)),
          },
          { default: () => (row.active ? t('common.disable') : t('common.enable')) }
        )
      );
      btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h('div', { class: 'row-actions' }, btns);
    },
  },
]);

let loadAbort: AbortController | null = null;
async function loadTasks() {
  loadAbort?.abort();
  const ac = new AbortController();
  loadAbort = ac;
  loadBusy.value = true;
  try {
    const res = await api<any>('GET', '/schedule/tasks', {
      offset: (page.value - 1) * pageSize.value,
      limit: pageSize.value,
      type: searchType.value,
      kw: kw.value || undefined,
      stype: stype.value === null ? undefined : stype.value,
    }, { signal: ac.signal });
    if (loadAbort !== ac) return;
    loadError.value = res.code !== 0;
    if (res.code === 0) {
      tasks.value = res.data.list;
      pagination.itemCount = res.data.total;
      pagination.page = page.value;
      pagination.pageSize = pageSize.value;
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') loadError.value = true;
  } finally {
    if (loadAbort === ac) loadBusy.value = false;
  }
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
  const prev = row.active ? 1 : 0;
  const target = prev ? 0 : 1;
  row.active = target; // 乐观更新
  const res = await api('POST', `/schedule/tasks/${row.id}/active`, { active: target });
  if (res.code === 0) message.success(t('common.success'));
  else {
    row.active = prev; // 失败回滚
    message.error(res.msg);
  }
}

function del(row: any) {
  dialog.warning({
    title: t('schedule.deleteTitle'),
    content: t('schedule.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const idx = tasks.value.findIndex((x: any) => Number(x.id) === Number(row.id));
      const removed = idx >= 0 ? tasks.value[idx] : null;
      if (idx >= 0) tasks.value.splice(idx, 1);
      const res = await api('DELETE', `/schedule/tasks/${row.id}`);
      if (res.code === 0) {
        message.success(t('schedule.deleteSuccess'));
        // 同步分页总数，避免「共 N 条」偏大、末页删空后停在空白页
        if (pagination.itemCount > 0) pagination.itemCount--;
        checkedRowKeys.value = checkedRowKeys.value.filter((k) => Number(k) !== Number(row.id));
      } else {
        if (removed) tasks.value.splice(idx, 0, removed); // 失败回滚
        message.error(res.msg);
      }
    },
  });
}

onMounted(loadTasks);
</script>