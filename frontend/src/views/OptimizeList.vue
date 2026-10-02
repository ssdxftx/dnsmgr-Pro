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
    <n-card :bordered="false">
      <n-space style="margin-bottom: 16px">
        <n-select v-model:value="searchType" :options="searchTypeOptions" style="width: 120px" />
        <n-input v-model:value="kw" :placeholder="t('optimize.keyword')" style="width: 200px" @keyup.enter="search" />
        <n-select v-model:value="status" :options="statusOptions" clearable :placeholder="t('common.status')" style="width: 120px" />
        <n-button type="primary" @click="search"><template #icon><n-icon :component="SearchOutline" /></template>{{ t('common.search') }}</n-button>
        <n-button @click="clearSearch"><template #icon><n-icon :component="RefreshOutline" /></template>{{ t('common.refresh') }}</n-button>
      </n-space>

      <ResponsiveDataTable
        :columns="columns"
        :data="tasks"
        :loading="loading"
        :pagination="pagination"
        :row-key="(row: any) => row.id"
        :empty-text="t('optimize.empty')"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, SearchOutline, RefreshOutline, SettingsOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();
const loading = ref(false);
const tasks = ref<any[]>([]);
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
      btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => run(row) }, { default: () => t('optimize.runNow') }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => router.push('/optimize-tasks/' + row.id + '/edit') }, { default: () => t('common.edit') }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => toggleActive(row) }, { default: () => (row.active ? t('common.disable') : t('common.enable')) }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h(NSpace, null, { default: () => btns });
    },
  },
]);

async function loadTasks() {
  loading.value = true;
  const res = await api<any>('GET', '/optimize/tasks', {
    offset: (page.value - 1) * pageSize.value,
    limit: pageSize.value,
    type: searchType.value,
    kw: kw.value || undefined,
    status: status.value === null ? undefined : status.value,
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
  status.value = null;
  searchType.value = 1;
  page.value = 1;
  loadTasks();
}

async function run(row: any) {
  message.loading(t('optimize.runLoading'));
  const res = await api('POST', `/optimize/tasks/${row.id}/run`, {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
  loadTasks();
}

async function toggleActive(row: any) {
  const res = await api('POST', `/optimize/tasks/${row.id}/active`, { active: row.active ? 0 : 1 });
  if (res.code === 0) message.success(t('common.success'));
  else message.error(res.msg);
  loadTasks();
}

function del(row: any) {
  dialog.warning({
    title: t('optimize.deleteTitle'),
    content: t('optimize.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/optimize/tasks/${row.id}`);
      if (res.code === 0) {
        message.success(t('optimize.deleteSuccess'));
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