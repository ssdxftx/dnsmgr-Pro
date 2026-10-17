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
    <n-grid class="telemetry-row" cols="2 s:2 m:4" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="tasks.length" :label="t('common.monitorTasks')" tone="primary" :icon="PulseOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="normalTasks" :label="t('dnsCheck.resultOk')" tone="success" :icon="CheckmarkCircleOutline" :caption="t('dnsCheck.lastCheck')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="issueTasks" :label="t('common.abnormal')" tone="error" :icon="AlertCircleOutline" :caption="t('dnsCheck.lastCheck')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d4"><TelemetryCard :value="neverRunTasks" :label="t('dnsCheck.neverRun')" tone="info" :icon="TimeOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('dnsCheck.overview') }}</h3>
        </div>
        <n-descriptions :column="isMobile ? 2 : 4" size="small" label-placement="top">
          <n-descriptions-item :label="t('common.enable')">{{ activeTasks }}</n-descriptions-item>
          <n-descriptions-item :label="t('common.disabled')">{{ tasks.length - activeTasks }}</n-descriptions-item>
          <n-descriptions-item :label="t('dnsCheck.lastRun')">{{ lastRunAt }}</n-descriptions-item>
          <n-descriptions-item :label="t('dnsCheck.nextRun')">{{ nextRunAt }}</n-descriptions-item>
        </n-descriptions>
      </div>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('dnsCheck.listTitle') }}</h3>
        </div>
        <ResponsiveDataTable
          :columns="columns"
          :data="tasks"
          :loading="loadBusy"
          :pagination="{ pageSize: 20 }"
          :row-key="(row: any) => row.id"
          :empty-text="t('dnsCheck.empty')"
        />
      </div>
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="t('dnsCheck.taskTitle')" class="modal-md" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('dnsCheck.taskName')">
          <n-input v-model:value="form.name" :placeholder="t('dnsCheck.namePlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('dnsCheck.domain')">
          <n-select v-model:value="form.did" :options="domainOptions" filterable remote :loading="domainLoadBusy" @search="loadDomains" :placeholder="t('dnsCheck.domainPlaceholder')" @update:value="onDomainChange" />
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
          <n-time-picker v-model:value="form.runTime" format="HH:mm" value-format="HH:mm" :clearable="false" />
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
          <n-button type="primary" :loading="saveBusy" @click="save">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showResult" preset="card" :title="t('dnsCheck.resultTitle')" class="modal-md" :mask-closable="false">
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
import { NButton, NTag, NDropdown, useMessage, useDialog } from 'naive-ui';
import { AddOutline, PulseOutline, CheckmarkCircleOutline, AlertCircleOutline, TimeOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import { useAction } from '../composables/useAction';
import { useResponsive } from '../composables/useResponsive';

const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();
const { isMobile } = useResponsive();
const { busy, run } = useAction();
const loadBusy = ref(false);
const saveBusy = ref(false);
const tasks = ref<any[]>([]);
const activeTasks = computed(() => tasks.value.filter((t: any) => t.active).length);
const issueTasks = computed(() => tasks.value.filter((t: any) => t.last_run && Number(t.last_status) === 1).length);
const normalTasks = computed(() => tasks.value.filter((t: any) => t.last_run && Number(t.last_status) !== 1).length);
const neverRunTasks = computed(() => tasks.value.filter((t: any) => !t.last_run).length);
const lastRunAt = computed(() => {
  const times = tasks.value.map((t: any) => t.last_run).filter(Boolean).sort();
  return times.length ? times[times.length - 1] : '-';
});
const nextRunAt = computed(() => {
  const times = tasks.value.filter((t: any) => t.active && t.next_run).map((t: any) => t.next_run).sort();
  return times.length ? times[0] : '-';
});
const domainOptions = ref<any[]>([]);
const domainLoadBusy = ref(false);
const subOptions = ref<any[]>([]);
const showEdit = ref(false);
const editingId = ref<number | null>(null);
const showResult = ref(false);
const runningResult = ref<any>({ total: 0, issues: [], error: '' });
const typeList = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

const form = reactive<any>({ name: '', did: null, sub: null, types: [], cycle: 'daily', runTime: '04:00', intervalMin: 60, noticeEmail: '', active: true });

function normalizeHm(v: any): string {
  const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return '04:00';
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mi = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 48 },
  { title: t('dnsCheck.nameCol'), key: 'name', width: 110, render: (row: any) => row.name || '-' },
  {
    title: t('dnsCheck.domain'),
    key: 'domain_name',
    width: 170,
    render: (row: any) => (row.sub ? `${row.sub}.${row.domain_name}` : row.domain_name || '-'),
  },
  {
    title: t('dnsCheck.checkType'),
    key: 'types',
    width: 96,
    render: (row: any) => {
      const types = String(row.types || '').trim();
      return types ? types : t('dnsCheck.all');
    },
  },
  {
    title: t('dnsCheck.cycle'),
    key: 'cycle',
    width: 104,
    render: (row: any) => {
      if (row.cycle === 'interval') return h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => t('dnsCheck.everyInterval', { minutes: row.interval_min }) });
      return h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => t('dnsCheck.everyDay', { time: row.run_time || '-' }) });
    },
  },
  {
    title: t('dnsCheck.noticeEmail'),
    key: 'notice_email',
    width: 92,
    ellipsis: { tooltip: true },
    render: (row: any) => row.notice_email || t('dnsCheck.systemDefault'),
  },
  {
    title: t('common.status'),
    key: 'active',
    width: 64,
    render: (row: any) => h(NTag, { size: 'small', type: row.active ? 'success' : 'default', bordered: false }, { default: () => (row.active ? t('common.enable') : t('dnsCheck.stopped')) }),
  },
  {
    title: t('dnsCheck.resultTitle'),
    key: 'last_status',
    width: 92,
    render: (row: any) => {
      if (!row.last_run) return h(NTag, { size: 'small', type: 'default', bordered: false }, { default: () => t('dnsCheck.neverRun') });
      if (Number(row.last_status) === 1) {
        return h(NTag, { size: 'small', type: 'error', bordered: false }, { default: () => t('dnsCheck.issueCount', { count: Number(row.issue_count) || 0 }) });
      }
      return h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => t('dnsCheck.resultOk') });
    },
  },
  {
    title: t('dnsCheck.lastRun'),
    key: 'last_run',
    width: 150,
    render: (row: any) => {
      if (!row.last_run) return '-';
      return h('div', { style: 'line-height: 1.35' }, [
        h('span', null, row.last_run),
        row.next_run
          ? h('span', { style: 'display: block; font-size: 11px; color: var(--app-text-3)' }, `${t('dnsCheck.nextRun')} ${row.next_run}`)
          : null,
      ]);
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 140,
    render(row: any) {
      const rKey = `run:${row.id}`;
      const tKey = `toggle:${row.id}`;
      return h('div', { class: 'row-actions' }, [
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            type: 'primary',
            loading: !!busy[rKey],
            disabled: !!busy[rKey],
            onClick: () => run(rKey, () => runNow(row)),
          },
          { default: () => t('dnsCheck.runNow') },
        ),
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            loading: !!busy[tKey],
            disabled: !!busy[tKey],
            onClick: () => run(tKey, () => toggle(row)),
          },
          { default: () => (row.active ? t('dnsCheck.stopped') : t('common.enable')) },
        ),
        h(
          NDropdown,
          {
            trigger: 'click',
            options: [
              { label: t('common.edit'), key: 'edit' },
              { label: t('common.delete'), key: 'delete' },
            ],
            onSelect: (key: string) => (key === 'edit' ? openEdit(row) : del(row)),
          },
          { default: () => h(NButton, { size: 'tiny', quaternary: true }, { default: () => t('common.more') }) },
        ),
      ]);
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
  loadBusy.value = true;
  try {
    const res = await api<any>('GET', '/dns-check/tasks');
    if (res.code === 0) tasks.value = res.data || [];
  } finally {
    loadBusy.value = false;
  }
}

async function loadDomains(kw = '') {
  domainLoadBusy.value = true;
  try {
    const res = await api<any>('GET', '/dns-check/domains', kw ? { kw } : undefined);
    if (res.code === 0) {
      domainOptions.value = (res.data || []).map((d: any) => ({ label: d.name, value: d.id }));
    }
  } finally {
    domainLoadBusy.value = false;
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
  Object.assign(form, { name: '', did: null, sub: null, types: [], cycle: 'daily', runTime: '04:00', intervalMin: 60, noticeEmail: '', active: true });
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.name = row.name || '';
  form.did = row.did;
  form.sub = row.sub || null;
  form.types = String(row.types || '').split(/[,;，；]/).map((x: string) => x.trim()).filter(Boolean);
  form.cycle = row.cycle === 'interval' ? 'interval' : 'daily';
  form.runTime = normalizeHm(row.run_time);
  form.intervalMin = Number(row.interval_min) || 60;
  form.noticeEmail = row.notice_email || '';
  form.active = row.active == 1;
  showEdit.value = true;
  loadSubDomains(row.did);
}

async function save() {
  if (!form.did) return message.warning(t('dnsCheck.selectDomain'));
  if (form.cycle === 'interval' && (!form.intervalMin || form.intervalMin < 1)) return message.warning(t('dnsCheck.intervalRequired'));
  saveBusy.value = true;
  try {
    const runTime = form.cycle === 'daily' ? normalizeHm(form.runTime) : null;
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
    saveBusy.value = false;
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