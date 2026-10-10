<template>
  <div class="app-stack">
    <PageHeader :title="t('route.dmTaskInfo')" :subtitle="t('dm.infoSubtitle')">
      <template #actions>
        <n-button @click="$router.push('/dm-tasks')">
          <template #icon><n-icon :component="ArrowBackOutline" /></template>
          {{ t('common.back') }}
        </n-button>
      </template>
    </PageHeader>
    <n-grid v-if="task" class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="task.fail_count || 0" :label="t('dm.infoFailCount24')" tone="error" :icon="AlertCircleOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="task.switch_count || 0" :label="t('dm.infoSwitchCount24')" tone="warning" :icon="SwapHorizontalOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="logs.length" :label="t('common.total')" tone="primary" :icon="DocumentTextOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <n-descriptions v-if="task" bordered :column="2" size="small" style="margin-bottom: 16px">
        <n-descriptions-item :label="t('dm.infoDomain')">{{ task.rr }}.{{ task.domain || '' }}</n-descriptions-item>
        <n-descriptions-item :label="t('dm.infoRecord')">{{ task.main_value }}</n-descriptions-item>
        <n-descriptions-item :label="t('dm.infoSwitchSet')">{{ typeLabel }}</n-descriptions-item>
        <n-descriptions-item :label="t('dm.infoCheckProto')">{{ checktypeLabel }}</n-descriptions-item>
        <n-descriptions-item :label="t('dm.infoStatus')">
          <n-tag :type="task.status ? 'error' : 'success'" size="small">{{ task.status ? t('dm.abnormal') : t('dm.normal') }}</n-tag>
        </n-descriptions-item>
        <n-descriptions-item :label="t('dm.infoRunStatus')">
          <n-tag :type="task.active ? 'success' : 'default'" size="small" bordered>{{ task.active ? t('dm.running') : t('dm.stopped') }}</n-tag>
        </n-descriptions-item>
        <n-descriptions-item :label="t('dm.infoFailCount24')">{{ task.fail_count }}</n-descriptions-item>
        <n-descriptions-item :label="t('dm.infoSwitchCount24')">{{ task.switch_count }}</n-descriptions-item>
      </n-descriptions>

      <n-space style="margin-bottom: 16px">
        <n-select v-model:value="actionFilter" :options="actionOptions" style="width: 140px" @update:value="loadLogs" />
        <n-button @click="loadLogs"><template #icon><n-icon :component="RefreshOutline" /></template>{{ t('common.refresh') }}</n-button>
      </n-space>

      <ResponsiveDataTable :columns="logColumns" :data="logs" :loading="loading" :pagination="pagination" :empty-text="t('dm.emptyLogs')" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useMessage } from 'naive-ui';
import { NTag } from 'naive-ui';
import { ArrowBackOutline, RefreshOutline, AlertCircleOutline, SwapHorizontalOutline, DocumentTextOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const { t } = useI18n();

const task = ref<any>(null);
const logs = ref<any[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(10);
const actionFilter = ref(0);
const total = ref(0);

const typeMap = computed<Record<number, string>>(() => ({
  0: t('dm.noAction'),
  1: t('dm.pauseRecord'),
  2: t('dm.switchBackupRecord'),
  3: t('dm.condEnableFull'),
}));
const checktypeMap: Record<number, string> = { 0: 'PING', 1: 'TCP', 2: 'HTTP(S)' };

const typeLabel = computed(() => {
  if (!task.value) return '';
  const type = task.value.type;
  if (type === 2) return t('dm.switchBackupDetail', { value: task.value.backup_value });
  return typeMap.value[type] || task.value.type;
});
const checktypeLabel = computed(() => (task.value ? checktypeMap[task.value.checktype] || task.value.checktype : ''));

const actionOptions = computed(() => [
  { label: t('dm.filterType'), value: 0 },
  { label: t('dm.actionAbnormal'), value: 1 },
  { label: t('dm.actionRecover'), value: 2 },
]);

function actionName(a: number): string {
  const type = task.value?.type;
  if (a === 1) {
    if (type === 2) return t('dm.switchToBackup');
    if (type === 3) return t('dm.enableRecord');
    return t('dm.actionAbnormal');
  }
  if (a === 2) {
    if (type === 2) return t('dm.restoreMain');
    if (type === 3) return t('dm.pauseRecord');
    return t('dm.actionRecover');
  }
  return t('common.unknown');
}

const logColumns = computed(() => [
  { title: 'ID', key: 'id', width: 80 },
  {
    title: t('dm.logAction'),
    key: 'action',
    width: 160,
    render(row: any) {
      const isAlert = row.action === 1;
      return h(NTag, { size: 'small', type: isAlert ? 'error' : 'success' }, { default: () => actionName(row.action) });
    },
  },
  { title: t('dm.logTime'), key: 'date', width: 180 },
  { title: t('dm.logError'), key: 'errmsg', render: (row: any) => row.errmsg || '-' },
]);

const pagination = reactive({
  page: 1,
  pageSize: 10,
  itemCount: 0,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  onChange: (p: number) => {
    page.value = p;
    loadLogs();
  },
  onUpdatePageSize: (s: number) => {
    pageSize.value = s;
    page.value = 1;
    loadLogs();
  },
});

async function loadInfo() {
  const id = Number(route.params.id);
  const res = await api<any>('GET', `/dmonitor/tasks/${id}`);
  if (res.code === 0) task.value = { ...res.data, domain: res.data.domain };
  else message.error(res.msg);
}

async function loadLogs() {
  const id = Number(route.params.id);
  loading.value = true;
  const res = await api<any>('GET', `/dmonitor/tasks/${id}/logs`, {
    offset: (page.value - 1) * pageSize.value,
    limit: pageSize.value,
    action: actionFilter.value,
  });
  if (res.code === 0) {
    logs.value = res.data.list;
    total.value = res.data.total;
    pagination.itemCount = res.data.total;
    pagination.page = page.value;
    pagination.pageSize = pageSize.value;
  }
  loading.value = false;
}

onMounted(() => {
  loadInfo();
  loadLogs();
});
</script>