<template>
  <div class="app-stack">
    <PageHeader :title="t('optimize.taskTitle')" :subtitle="t('optimize.listSubtitle')">
      <template #actions>
        <div class="actions">
          <n-button @click="$router.push('/optimize-settings')">
            <template #icon><n-icon :component="SettingsOutline" /></template>
            {{ t('optimize.settingsBtn') }}
          </n-button>
          <n-button type="primary" @click="$router.push('/optimize-tasks/add')">
            <template #icon><n-icon :component="AddOutline" /></template>
            {{ t('optimize.addTask') }}
          </n-button>
        </div>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="tasks.length" :label="t('common.total')" tone="primary" :icon="ListOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="activeTasks" :label="t('common.active')" tone="success" :icon="CheckmarkCircleOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="pausedTasks" :label="t('common.disabled')" tone="warning" :icon="PauseOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>
    <div class="app-toolbar">
      <n-select v-model:value="searchType" :options="searchTypeOptions" size="small" style="width: 120px" />
      <n-input v-model:value="kw" :placeholder="t('optimize.keyword')" size="small" style="width: 200px" @keyup.enter="search" />
      <n-select v-model:value="status" :options="statusOptions" clearable :placeholder="t('common.status')" size="small" style="width: 120px" />
      <n-button type="primary" size="small" @click="search"><template #icon><n-icon :component="SearchOutline" /></template>{{ t('common.search') }}</n-button>
      <n-button size="small" @click="clearSearch"><template #icon><n-icon :component="RefreshOutline" /></template>{{ t('common.refresh') }}</n-button>
    </div>

    <n-card :bordered="false">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('optimize.overview') }}</h3>
        </div>
        <n-descriptions :column="3" size="small" label-placement="top">
          <n-descriptions-item :label="t('optimize.recordCount')">{{ recordTotal }}</n-descriptions-item>
          <n-descriptions-item :label="t('common.active')">{{ activeTasks }}</n-descriptions-item>
          <n-descriptions-item :label="t('common.disabled')">{{ pausedTasks }}</n-descriptions-item>
        </n-descriptions>
      </div>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('optimize.listTitle') }}</h3>
        </div>
        <ResponsiveDataTable
          :columns="columns"
          :data="tasks"
          :loading="loadBusy"
          :pagination="pagination"
          :row-key="(row: any) => row.id"
          :empty-text="t('optimize.empty')"
        />
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, SearchOutline, RefreshOutline, SettingsOutline, ListOutline, CheckmarkCircleOutline, PauseOutline } from '@vicons/ionicons5';
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
const tasks = ref<any[]>([]);
const activeTasks = computed(() => tasks.value.filter((t: any) => t.active).length);
const pausedTasks = computed(() => tasks.value.filter((t: any) => !t.active).length);
const recordTotal = computed(() => tasks.value.reduce((sum: number, t: any) => sum + (Number(t.recordnum) || 0), 0));
const page = ref(1);
const pageSize = ref(10);

const searchType = ref(1);
const kw = ref('');
const status = ref<number | null>(null);

const searchTypeOptions = computed(() => [
  { label: t('optimize.searchDomain'), value: 1 },
  { label: t('optimize.searchRemark'), value: 2 },
]);
const statusOptions = computed(() => [
  { label: t('optimize.waiting'), value: 0 },
  { label: t('optimize.success'), value: 1 },
  { label: t('optimize.failed'), value: 2 },
]);

const cdnTypeMap: Record<number, string> = { 1: 'CloudFlare', 2: 'CloudFront', 3: 'GCore', 4: 'EdgeOne' };
const typeMap = computed<Record<number, string>>(() => ({ 0: t('optimize.lineType0'), 1: t('optimize.lineType1') }));

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
  { title: 'ID', key: 'id', width: 60 },
  {
    title: t('optimize.searchDomain'),
    key: 'rr',
    minWidth: 160,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.rr + '.' + row.domain });
    },
  },
  { title: t('optimize.cdnProvider'), key: 'cdn_type', width: 110, render: (row: any) => cdnTypeMap[row.cdn_type] || row.cdn_type },
  { title: t('optimize.lineType'), key: 'type', width: 130, render: (row: any) => typeMap.value[row.type] || row.type },
  { title: t('optimize.ipType'), key: 'ip_type', width: 80, render: (row: any) => String(row.ip_type).split(',').join('/') },
  { title: t('optimize.recordCount'), key: 'recordnum', width: 60 },
  { title: 'TTL', key: 'ttl', width: 70 },
  {
    title: t('common.status'),
    key: 'status',
    width: 90,
    render(row: any) {
      const map: any = { 0: [t('optimize.waiting'), 'default'], 1: [t('optimize.success'), 'success'], 2: [t('optimize.failed'), 'error'] };
      const [label, type] = map[row.status] || [row.status, 'default'];
      return h(NTag, { size: 'small', type }, { default: () => label });
    },
  },
  {
    title: t('optimize.run'),
    key: 'active',
    width: 70,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.active ? 'success' : 'default', bordered: false }, { default: () => (row.active ? t('dm.running') : t('dm.stopped')) });
    },
  },
  {
    title: t('optimize.errMsg'),
    key: 'errmsg',
    minWidth: 150,
    render(row: any) {
      return row.errmsg ? h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.errmsg }) : '-';
    },
  },
  { title: t('optimize.updateTime'), key: 'updatetime', width: 160 },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 220,
    render(row: any) {
      const btns: any[] = [];
      btns.push(
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            type: 'primary',
            loading: !!busy[`run:${row.id}`],
            disabled: !!busy[`run:${row.id}`],
            onClick: () => guard(`run:${row.id}`, () => run(row)),
          },
          { default: () => t('optimize.runNow') }
        )
      );
      btns.push(h(NButton, { size: 'tiny', quaternary: true, onClick: () => router.push('/optimize-tasks/' + row.id + '/edit') }, { default: () => t('common.edit') }));
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
    const res = await api<any>('GET', '/optimize/tasks', {
      offset: (page.value - 1) * pageSize.value,
      limit: pageSize.value,
      type: searchType.value,
      kw: kw.value || undefined,
      status: status.value === null ? undefined : status.value,
    }, { signal: ac.signal });
    if (loadAbort !== ac) return;
    if (res.code === 0) {
      tasks.value = res.data.list;
      pagination.itemCount = res.data.total;
      pagination.page = page.value;
      pagination.pageSize = pageSize.value;
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') return;
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
  status.value = null;
  searchType.value = 1;
  page.value = 1;
  loadTasks();
}

async function run(row: any) {
  const res = await api('POST', `/optimize/tasks/${row.id}/run`, {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
  loadTasks();
}

async function toggleActive(row: any) {
  const prev = row.active ? 1 : 0;
  const target = prev ? 0 : 1;
  row.active = target; // 乐观更新
  const res = await api('POST', `/optimize/tasks/${row.id}/active`, { active: target });
  if (res.code === 0) message.success(t('common.success'));
  else {
    row.active = prev; // 失败回滚
    message.error(res.msg);
  }
}

function del(row: any) {
  dialog.warning({
    title: t('optimize.deleteTitle'),
    content: t('optimize.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const idx = tasks.value.findIndex((x: any) => Number(x.id) === Number(row.id));
      const removed = idx >= 0 ? tasks.value[idx] : null;
      if (idx >= 0) tasks.value.splice(idx, 1);
      const res = await api('DELETE', `/optimize/tasks/${row.id}`);
      if (res.code === 0) {
        message.success(t('optimize.deleteSuccess'));
        // 同步分页总数，避免「共 N 条」偏大、末页删空后停在空白页
        if (pagination.itemCount > 0) pagination.itemCount--;
      } else {
        if (removed) tasks.value.splice(idx, 0, removed); // 失败回滚
        message.error(res.msg);
      }
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