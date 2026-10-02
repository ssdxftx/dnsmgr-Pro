<template>
  <div class="app-stack">
    <PageHeader :title="t('dnsCheck.title')" :subtitle="t('dnsCheck.subtitle')">
      <template #actions>
        <n-button type="primary" @click="openAdd">
          <template #icon><n-icon :component="AddOutline" /></template>
          {{ t('dnsCheck.addTask') }}
        </n-button>
      </template>
    </PageHeader>
    <n-card :bordered="false">
      <ResponsiveDataTable
        :columns="columns"
        :data="tasks"
        :loading="loading"
        :pagination="{ pageSize: 20 }"
        :row-key="(row: any) => row.id"
        :empty-text="t('dnsCheck.empty')"
      />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="t('dnsCheck.taskTitle')" style="max-width: 640px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('dnsCheck.taskName')">
          <n-input v-model:value="form.name" :placeholder="t('dnsCheck.namePlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('dnsCheck.domain')">
          <n-select v-model:value="form.did" :options="domainOptions" filterable :placeholder="t('dnsCheck.domainPlaceholder')" @update:value="onDomainChange" />
        </n-form-item>
        <n-form-item :label="t('dnsCheck.subdomain')">
          <n-select v-model:value="form.sub" :options="subOptions" filterable clearable :placeholder="t('dnsCheck.subPlaceholder')" :disabled="!form.did" />
          <n-text depth="3" style="font-size: 12px; display: block; margin-top: 4px">{{ t('dnsCheck.subHint') }}</n-text>
        </n-form-item>
        <n-form-item :label="t('dnsCheck.checkType')">
          <n-checkbox-group v-model:value="form.types">
            <n-checkbox v-for="type in typeList" :key="type" :value="type" :label="type" style="margin-right: 10px" />
          </n-checkbox-group>
          <n-text depth="3" style="font-size: 12px; display: block; margin-top: 4px">{{ t('dnsCheck.typeHint') }}</n-text>
        </n-form-item>
        <n-form-item :label="t('dnsCheck.cycle')">
          <n-radio-group v-model:value="form.cycle">
            <n-radio-button value="daily">{{ t('dnsCheck.daily') }}</n-radio-button>
            <n-radio-button value="interval">{{ t('dnsCheck.interval') }}</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="form.cycle === 'daily'" :label="t('dnsCheck.dailyTime')">
          <n-time-picker v-model:value="form.runTime" format="HH:mm" :clearable="false" />
        </n-form-item>
        <n-form-item v-if="form.cycle === 'interval'" :label="t('dnsCheck.intervalMin')">
          <n-input-number v-model:value="form.intervalMin" :min="1" :max="10080" style="width: 200px" />
        </n-form-item>
        <n-form-item :label="t('dnsCheck.noticeEmail')">
          <n-input v-model:value="form.noticeEmail" :placeholder="t('dnsCheck.emailPlaceholder')" />
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

    <n-modal v-model:show="showResult" preset="card" :title="t('dnsCheck.resultTitle')" style="max-width: 560px">
      <n-alert
        :type="runningResult.total === 0 || runningResult.issues.length ? 'warning' : 'success'"
        :show-icon="false"
        :title="runningResult.error || (runningResult.issues.length ? t('dnsCheck.issuesFound', { count: runningResult.issues.length }) : t('dnsCheck.allClear', { count: runningResult.total }))"
      />
      <ResponsiveDataTable
        v-if="runningResult.issues && runningResult.issues.length"
        :columns="issueColumns"
        :data="runningResult.issues"
        size="small"
        style="margin-top: 12px"
      />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showResult = false">{{ t('common.close') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, useMessage, useDialog } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();
const loading = ref(false);
const saving = ref(false);
const tasks = ref<any[]>([]);
const domainOptions = ref<any[]>([]);
const subOptions = ref<any[]>([]);
const showEdit = ref(false);
const editingId = ref<number | null>(null);
const showResult = ref(false);
const runningResult = ref<any>({ total: 0, issues: [], error: '' });
const typeList = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

const form = reactive<any>({ name: '', did: null, sub: null, types: [], cycle: 'daily', runTime: 4 * 3600000, intervalMin: 60, noticeEmail: '', active: true });

function hmToTs(hm: string): number {
  const [h, m] = String(hm || '04:00').split(':').map((n) => Number(n) || 0);
  return h * 3600000 + m * 60000;
}

function fmtTs(v: number | null): string {
  if (v === null || v === undefined) return '-';
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 60 },
  { title: t('dnsCheck.nameCol'), key: 'name', width: 150, render: (row: any) => row.name || '-' },
  {
    title: t('dnsCheck.domain'),
    key: 'domain_name',
    width: 200,
    render: (row: any) => (row.sub ? `${row.sub}.${row.domain_name}` : row.domain_name || '-'),
  },
  {
    title: t('dnsCheck.checkType'),
    key: 'types',
    width: 160,
    render: (row: any) => {
      const types = String(row.types || '').trim();
      return types ? types : t('dnsCheck.all');
    },
  },
  {
    title: t('dnsCheck.cycle'),
    key: 'cycle',
    width: 130,
    render: (row: any) => {
      if (row.cycle === 'interval') return h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => t('dnsCheck.everyInterval', { minutes: row.interval_min }) });
      return h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => t('dnsCheck.everyDay', { time: row.run_time || '-' }) });
    },
  },
  { title: t('dnsCheck.noticeEmail'), key: 'notice_email', width: 160, render: (row: any) => row.notice_email || t('dnsCheck.systemDefault') },
  {
    title: t('common.status'),
    key: 'active',
    width: 80,
    render: (row: any) => h(NTag, { size: 'small', type: row.active ? 'success' : 'default', bordered: false }, { default: () => (row.active ? t('common.enable') : t('dnsCheck.stopped')) }),
  },
  { title: t('dnsCheck.lastRun'), key: 'last_run', width: 170, render: (row: any) => row.last_run || '-' },
  { title: t('dnsCheck.nextRun'), key: 'next_run', width: 170, render: (row: any) => row.next_run || '-' },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 260,
    render(row: any) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', type: 'primary', onClick: () => runNow(row) }, { default: () => t('dnsCheck.runNow') }),
          h(NButton, { size: 'small', onClick: () => toggle(row) }, { default: () => (row.active ? t('dnsCheck.stopped') : t('common.enable')) }),
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
          h(NButton, { size: 'small', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }),
        ],
      });
    },
  },
]);

const issueColumns = computed(() => [
  { title: t('dnsCheck.hostRecord'), key: 'name', width: 120 },
  { title: t('common.type'), key: 'type', width: 70 },
  { title: t('dnsCheck.expectedValue'), key: 'value', width: 150, ellipsis: { tooltip: true } },
  {
    title: t('dnsCheck.actualValue'),
    key: 'actual',
    render: (row: any) => (row.actual && row.actual.length ? row.actual.join(', ') : t('dnsCheck.notFound')),
  },
  {
    title: t('common.status'),
    key: 'status',
    width: 90,
    render: (row: any) => h(NTag, { size: 'small', type: 'error', bordered: false }, { default: () => (row.status === 'not_found' ? t('dnsCheck.notFound') : t('dnsCheck.mismatch')) }),
  },
]);

async function load() {
  loading.value = true;
  try {
    const res = await api<any>('GET', '/dns-check/tasks');
    if (res.code === 0) tasks.value = res.data || [];
  } finally {
    loading.value = false;
  }
}

async function loadDomains() {
  const res = await api<any>('GET', '/dns-check/domains');
  if (res.code === 0) {
    domainOptions.value = (res.data || []).map((d: any) => ({ label: d.name, value: d.id }));
  }
}

async function loadSubDomains(did: number | null) {
  subOptions.value = [];
  if (!did) return;
  const res = await api<any>('GET', `/dns-check/domains/${did}/subs`);
  if (res.code === 0 && Array.isArray(res.data)) {
    subOptions.value = res.data.map((s: string) => ({ label: s, value: s }));
  }
}

function onDomainChange(v: number) {
  form.sub = null;
  loadSubDomains(v);
}

function openAdd() {
  editingId.value = null;
  subOptions.value = [];
  Object.assign(form, { name: '', did: null, sub: null, types: [], cycle: 'daily', runTime: 4 * 3600000, intervalMin: 60, noticeEmail: '', active: true });
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.name = row.name || '';
  form.did = row.did;
  form.sub = row.sub || null;
  form.types = String(row.types || '').split(/[,;，；]/).map((x: string) => x.trim()).filter(Boolean);
  form.cycle = row.cycle === 'interval' ? 'interval' : 'daily';
  form.runTime = hmToTs(row.run_time);
  form.intervalMin = Number(row.interval_min) || 60;
  form.noticeEmail = row.notice_email || '';
  form.active = row.active == 1;
  showEdit.value = true;
  loadSubDomains(row.did);
}

async function save() {
  if (!form.did) return message.warning(t('dnsCheck.selectDomain'));
  if (form.cycle === 'interval' && (!form.intervalMin || form.intervalMin < 1)) return message.warning(t('dnsCheck.intervalRequired'));
  saving.value = true;
  try {
    const runTime = form.cycle === 'daily' ? fmtTs(form.runTime) : null;
    const body: any = {
      name: form.name,
      did: form.did,
      sub: form.sub || '',
      types: form.types.join(','),
      cycle: form.cycle,
      notice_email: form.noticeEmail,
      active: form.active ? 1 : 0,
    };
    if (form.cycle === 'interval') body.interval_min = form.intervalMin;
    else body.run_time = runTime;
    const res = editingId.value
      ? await api('PUT', `/dns-check/tasks/${editingId.value}`, body)
      : await api('POST', '/dns-check/tasks', body);
    if (res.code === 0) {
      message.success(editingId.value ? t('common.saved') : t('dnsCheck.created'));
      showEdit.value = false;
      load();
    } else message.error(res.msg);
  } finally {
    saving.value = false;
  }
}

async function runNow(row: any) {
  const res = await api<any>('POST', `/dns-check/tasks/${row.id}/run`);
  if (res.code === 0) {
    runningResult.value = res;
    showResult.value = true;
    load();
  } else message.error(res.msg);
}

async function toggle(row: any) {
  const res = await api('POST', `/dns-check/tasks/${row.id}/toggle`, { active: row.active == 1 ? 0 : 1 });
  if (res.code === 0) {
    message.success(res.msg);
    load();
  } else message.error(res.msg);
}

function del(row: any) {
  dialog.warning({
    title: t('dnsCheck.deleteTitle'),
    content: t('dnsCheck.deleteConfirm', { name: row.name || `ID ${row.id}` }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/dns-check/tasks/${row.id}`);
      if (res.code === 0) {
        message.success(t('dnsCheck.deleteSuccess'));
        load();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  load();
  loadDomains();
});
</script>