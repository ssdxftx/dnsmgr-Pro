<template>
  <div class="app-stack">
    <PageHeader :title="t('preheat.title')" :subtitle="t('preheat.subtitle')">
      <template #actions>
        <n-button type="primary" @click="openAdd">
          <template #icon><n-icon :component="AddOutline" /></template>
          {{ t('preheat.add') }}
        </n-button>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="tasks.length" :label="t('common.total')" tone="primary" :icon="ListOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="typeCount" :label="t('common.type')" tone="info" :icon="LayersOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="statusCount" :label="t('common.status')" tone="success" :icon="FlashOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <ResponsiveDataTable
        :columns="columns"
        :data="tasks"
        :loading="loading"
        :pagination="{ pageSize: 20 }"
        :row-key="(row: any) => row.id"
        :empty-text="t('preheat.empty')"
      />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="t('preheat.modalTitle')" style="max-width: 640px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('preheat.nameLabel')">
          <n-input v-model:value="form.name" :placeholder="t('preheat.namePlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('preheat.urlsLabel')">
          <n-input v-model:value="form.urls" type="textarea" :rows="6" :placeholder="t('preheat.urlsPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('preheat.opLabel')">
          <n-radio-group v-model:value="form.op">
            <n-radio-button value="preheat">{{ t('preheat.opPreheat') }}</n-radio-button>
            <n-radio-button value="purge">{{ t('preheat.opPurge') }}</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item :label="t('preheat.cycleLabel')">
          <n-radio-group v-model:value="form.cycle">
            <n-radio-button value="daily">{{ t('preheat.cycleDaily') }}</n-radio-button>
            <n-radio-button value="interval">{{ t('preheat.cycleInterval') }}</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="form.cycle === 'daily'" :label="t('preheat.dailyTimeLabel')">
          <n-time-picker v-model:value="form.runTime" format="HH:mm" :clearable="false" />
        </n-form-item>
        <n-form-item v-if="form.cycle === 'interval'" :label="t('preheat.intervalMinLabel')">
          <n-input-number v-model:value="form.intervalMin" :min="1" :max="10080" style="width: 200px" />
        </n-form-item>
        <n-form-item :label="t('common.enable')">
          <n-switch v-model:value="form.active" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { NButton, NSpace, NTag, useMessage, useDialog } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { AddOutline, ListOutline, LayersOutline, FlashOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const saving = ref(false);
const tasks = ref<any[]>([]);
const typeCount = computed(() => new Set(tasks.value.filter((r: any) => r.type != null).map((r: any) => r.type)).size);
const statusCount = computed(() => new Set(tasks.value.filter((r: any) => r.status != null).map((r: any) => r.status)).size);
const showEdit = ref(false);
const editingId = ref<number | null>(null);
const form = reactive<any>({ name: '', urls: '', op: 'preheat', cycle: 'daily', runTime: 3 * 3600000 + 30 * 60000, intervalMin: 60, active: true });

function fmtRunTime(v: number | null): string {
  if (v === null || v === undefined) return '-';
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 60 },
  { title: t('common.name'), key: 'name', width: 150, render: (row: any) => row.name || '-' },
  {
    title: t('common.type'),
    key: 'op',
    width: 100,
    render: (row: any) => h(NTag, { size: 'small', type: row.op === 'purge' ? 'warning' : 'success', bordered: false }, { default: () => (row.op === 'purge' ? t('preheat.opPurge') : t('preheat.typePreheatShort')) }),
  },
  {
    title: t('preheat.linksCol'),
    key: 'urls',
    ellipsis: { tooltip: true },
    render: (row: any) => {
      const list = String(row.urls || '').split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
      return t('preheat.linkCount', { count: list.length });
    },
  },
  {
    title: t('preheat.cycleCol'),
    key: 'cycle',
    width: 140,
    render: (row: any) => {
      if (row.cycle === 'interval') return h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => t('preheat.everyMin', { min: row.interval_min }) });
      return h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => t('preheat.dailyAt', { time: row.run_time || '-' }) });
    },
  },
  {
    title: t('common.status'),
    key: 'active',
    width: 80,
    render: (row: any) => h(NTag, { size: 'small', type: row.active ? 'success' : 'default', bordered: false }, { default: () => (row.active ? t('common.enable') : t('preheat.stopped')) }),
  },
  { title: t('preheat.lastRun'), key: 'last_run', width: 170, render: (row: any) => row.last_run || '-' },
  { title: t('preheat.nextRun'), key: 'next_run', width: 170, render: (row: any) => row.next_run || '-' },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 260,
    render(row: any) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => runNow(row) }, { default: () => t('preheat.runNow') }),
          h(NButton, { size: 'tiny', onClick: () => toggle(row) }, { default: () => (row.active ? t('preheat.stopped') : t('common.enable')) }),
          h(NButton, { size: 'tiny', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }),
        ],
      });
    },
  },
]);

async function load() {
  loading.value = true;
  try {
    const res = await api<any>('GET', '/cdn/preheat-tasks');
    if (res.code === 0) tasks.value = res.data || [];
  } finally {
    loading.value = false;
  }
}

function openAdd() {
  editingId.value = null;
  form.name = '';
  form.urls = '';
  form.op = 'preheat';
  form.cycle = 'daily';
  form.runTime = 3 * 3600000 + 30 * 60000;
  form.intervalMin = 60;
  form.active = true;
  showEdit.value = true;
}

function hmToTimestamp(hm: string): number {
  const [h, m] = String(hm || '03:30').split(':').map((n) => Number(n) || 0);
  return h * 3600000 + m * 60000;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.name = row.name || '';
  form.urls = row.urls || '';
  form.op = row.op === 'purge' ? 'purge' : 'preheat';
  form.cycle = row.cycle === 'interval' ? 'interval' : 'daily';
  form.runTime = hmToTimestamp(row.run_time);
  form.intervalMin = Number(row.interval_min) || 60;
  form.active = row.active == 1;
  showEdit.value = true;
}

async function save() {
  if (!form.urls.trim()) return message.warning(t('preheat.pleaseInputUrls'));
  if (form.cycle === 'interval' && (!form.intervalMin || form.intervalMin < 1)) return message.warning(t('preheat.pleaseInputInterval'));
  saving.value = true;
  try {
    const runTime = form.cycle === 'daily' ? fmtRunTime(form.runTime) : null;
    const body: any = { name: form.name, urls: form.urls, op: form.op, cycle: form.cycle, active: form.active ? 1 : 0 };
    if (form.cycle === 'interval') body.interval_min = form.intervalMin;
    else body.run_time = runTime;
    const res = editingId.value
      ? await api('PUT', `/cdn/preheat-tasks/${editingId.value}`, body)
      : await api('POST', '/cdn/preheat-tasks', body);
    if (res.code === 0) {
      message.success(editingId.value ? t('common.saved') : t('preheat.created'));
      showEdit.value = false;
      load();
    } else message.error(res.msg);
  } finally {
    saving.value = false;
  }
}

async function runNow(row: any) {
  const res = await api<any>('POST', `/cdn/preheat-tasks/${row.id}/run`);
  if (res.code === 0) {
    message.success(t('preheat.runDone', { success: res.success || 0, failed: res.failed || 0 }));
    load();
  } else message.error(res.msg);
}

async function toggle(row: any) {
  const res = await api('POST', `/cdn/preheat-tasks/${row.id}/toggle`, { active: row.active == 1 ? 0 : 1 });
  if (res.code === 0) {
    message.success(res.msg);
    load();
  } else message.error(res.msg);
}

function del(row: any) {
  dialog.warning({
    title: t('preheat.deleteTitle'),
    content: t('preheat.deleteConfirm', { name: row.name || 'ID ' + row.id }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/preheat-tasks/${row.id}`);
      if (res.code === 0) {
        message.success(t('preheat.deleteSuccess'));
        load();
      } else message.error(res.msg);
    },
  });
}

onMounted(load);
</script>