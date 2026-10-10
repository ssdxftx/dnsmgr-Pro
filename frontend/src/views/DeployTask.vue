<template>
  <div class="app-stack">
    <PageHeader :title="t('deployTask.title')" :subtitle="t('deployTask.subtitle')">
      <template #actions>
        <n-button type="primary" @click="openAdd">
          <template #icon><n-icon :component="AddOutline" /></template>
          {{ t('deployTask.add') }}
        </n-button>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="tasks.length" :label="t('common.deployTasks')" tone="primary" :icon="ListOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="activeTasks" :label="t('common.active')" tone="success" :icon="CheckmarkCircleOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="pendingTasks" :label="t('common.pending')" tone="warning" :icon="TimeOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="tasks" :loading="loading" :empty-text="t('deployTask.empty')" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('deployTask.editTitle') : t('deployTask.addTitle')" style="max-width:640px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('deployTask.account')">
          <n-select v-model:value="form.aid" :options="accountOptions" @update:value="onAccountChange" />
        </n-form-item>
        <n-form-item :label="t('deployTask.certOrder')">
          <n-select v-model:value="form.oid" :options="orderOptions" filterable :placeholder="t('deployTask.orderPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('deployTask.remark')">
          <n-input v-model:value="form.remark" :placeholder="t('deployTask.optional')" />
        </n-form-item>
        <template v-if="currentProvider">
          <n-alert v-if="currentProvider.tasknote" type="info" style="margin-bottom:12px" :show-icon="false">{{ currentProvider.tasknote }}</n-alert>
          <n-form-item v-for="(field, key) in currentProvider.taskinputs" v-show="fieldVisible(field.show, form.config)" :key="key" :label="field.name" :required="field.required">
            <n-input v-if="field.type === 'input'" v-model:value="form.config[key]" :type="isSecretField(key) ? 'password' : 'text'" show-password-on="click" :placeholder="field.placeholder || field.name" />
            <n-input v-else-if="field.type === 'textarea'" v-model:value="form.config[key]" type="textarea" :rows="3" :placeholder="field.placeholder || field.name" />
            <n-radio-group v-else-if="field.type === 'radio'" v-model:value="form.config[key]">
              <n-radio v-for="(label, val) in field.options" :key="String(val)" :value="String(val)">{{ label }}</n-radio>
            </n-radio-group>
            <n-select v-else-if="field.type === 'select'" v-model:value="form.config[key]" :options="selectOptions(field.options)" />
          </n-form-item>
        </template>
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
import { h, onMounted, reactive, ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, ListOutline, CheckmarkCircleOutline, TimeOutline } from '@vicons/ionicons5';
import { api } from '../api';
import { evalShow, isSecretField } from '../lib/safe';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const tasks = ref<any[]>([]);
const activeTasks = computed(() => tasks.value.filter((t: any) => t.active).length);
const pendingTasks = computed(() => tasks.value.filter((t: any) => t.status !== 1).length);
const providers = ref<Record<string, any>>({});
const accounts = ref<any[]>([]);
const orders = ref<any[]>([]);

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<any>({ aid: null, oid: null, remark: '', config: {} });
const currentProvider = ref<any>(null);

const accountOptions = computed(() => accounts.value.map((r: any) => ({ label: r.name + ' [' + (r.typename || r.type) + ']', value: r.id })));
const orderOptions = computed(() =>
  orders.value.map((r: any) => {
    const d = (r.domains || []).join(',');
    return { label: `${r.id}_${d}` + (r.aid === 0 ? `（${t('deployTask.manualRenew')}）` : `（${r.typename || t('deployTask.manual')}）`), value: r.id, disabled: r.status !== 3 };
  }),
);

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: t('deployTask.typeCol'),
    key: 'typename',
    width: 130,
    render(row: any) {
      return h(NTag, { size: 'small', bordered: false }, { default: () => row.typename || row.type });
    },
  },
  {
    title: t('deployTask.domainsCol'),
    key: 'domains',
    minWidth: 180,
    render(row: any) {
      const txt = (row.domains || []).join(', ');
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => txt });
    },
  },
  {
    title: t('common.status'),
    key: 'status',
    width: 90,
    render(row: any) {
      const map: any = { 0: [t('deployTask.pending'), 'default'], 1: [t('deployTask.deployed'), 'success'], [-1]: [t('deployTask.failed'), 'error'] };
      const [label, type] = map[row.status] || [row.status, 'default'];
      return h(NTag, { size: 'small', type }, { default: () => label });
    },
  },
  {
    title: t('deployTask.activeCol'),
    key: 'active',
    width: 70,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.active ? 'success' : 'default', bordered: false }, { default: () => (row.active ? t('common.yes') : t('common.no')) });
    },
  },
  { title: t('deployTask.lastDeploy'), key: 'lasttime', width: 160 },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 240,
    render(row: any) {
      const btns: any[] = [];
      if (row.status !== 1) btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => process(row) }, { default: () => t('deployTask.deploy') }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => reset(row) }, { default: () => t('deployTask.reset') }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => toggleActive(row) }, { default: () => (row.active ? t('common.disable') : t('common.enable')) }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h(NSpace, null, { default: () => btns });
    },
  },
]);

function selectOptions(options: any) {
  if (Array.isArray(options)) return options;
  return Object.entries(options || {}).map(([value, label]) => ({ label: String(label), value }));
}

function fieldVisible(show: string | undefined, config: Record<string, any>): boolean {
  return evalShow(show, config);
}

async function loadTasks() {
  loading.value = true;
  const res = await api<any>('GET', '/deploy/tasks', { limit: 200 });
  tasks.value = res.code === 0 ? res.data : [];
  loading.value = false;
}

async function loadProviders() {
  const res = await api<any>('GET', '/deploy/providers');
  if (res.code === 0) providers.value = res.data;
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cert/accounts', { deploy: 1, limit: 200 });
  accounts.value = res.code === 0 ? res.data : [];
}

async function loadOrders() {
  const res = await api<any>('GET', '/cert/orders', { limit: 200 });
  orders.value = res.code === 0 ? res.data : [];
}

function onAccountChange() {
  const acct = accounts.value.find((a: any) => a.id === form.aid);
  currentProvider.value = providers.value[acct?.type] || null;
  const cfg: Record<string, any> = {};
  if (currentProvider.value) {
    for (const [key, field] of Object.entries<any>(currentProvider.value.taskinputs || {})) {
      cfg[key] = field.value !== undefined ? String(field.value) : '';
    }
  }
  form.config = cfg;
}

function openAdd() {
  editingId.value = null;
  form.aid = null;
  form.oid = null;
  form.remark = '';
  form.config = {};
  currentProvider.value = null;
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.aid = row.aid;
  form.oid = row.oid;
  form.remark = row.remark || '';
  form.config = row.config && typeof row.config === 'object' ? { ...row.config } : safeJson(row.config) || {};
  const acct = accounts.value.find((a: any) => a.id === row.aid);
  currentProvider.value = providers.value[acct?.type || row.type] || null;
  showEdit.value = true;
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function save() {
  if (!form.aid || !form.oid) return message.warning(t('deployTask.fillWarning'));
  saving.value = true;
  const body = { aid: form.aid, oid: form.oid, config: form.config, remark: form.remark };
  const res = editingId.value ? await api('PUT', `/deploy/tasks/${editingId.value}`, body) : await api('POST', '/deploy/tasks', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadTasks();
  } else message.error(res.msg);
}

async function process(row: any) {
  const res = await api('POST', `/deploy/tasks/${row.id}/process`, {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
  loadTasks();
}

function reset(row: any) {
  dialog.warning({
    title: t('deployTask.resetTitle'),
    content: t('deployTask.resetConfirm'),
    positiveText: t('deployTask.reset'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('POST', `/deploy/tasks/${row.id}/reset`, {});
      if (res.code === 0) message.success(t('deployTask.resetSuccess'));
      else message.error(res.msg);
      loadTasks();
    },
  });
}

async function toggleActive(row: any) {
  const res = await api('POST', `/deploy/tasks/${row.id}/setactive`, { active: row.active ? 0 : 1 });
  if (res.code === 0) message.success(t('common.success'));
  else message.error(res.msg);
  loadTasks();
}

function del(row: any) {
  dialog.warning({
    title: t('deployTask.deleteTitle'),
    content: t('deployTask.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/deploy/tasks/${row.id}`);
      if (res.code === 0) {
        message.success(t('deployTask.deleteSuccess'));
        loadTasks();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadTasks();
  loadProviders();
  loadAccounts();
  loadOrders();
});
</script>

