<template>
  <div class="app-stack">
    <PageHeader :title="t('dnsAccount.title')" :subtitle="t('dnsAccount.subtitle')">
      <template #actions>
        <n-button type="primary" @click="openAdd">
          <template #icon><n-icon :component="AddOutline" /></template>
          {{ t('dnsAccount.add') }}
        </n-button>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="2 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="accounts.length" :label="t('common.total')" tone="primary" :icon="ServerOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="providerCount" :label="t('common.providers')" tone="info" :icon="PeopleOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="tunnelAccounts" :label="t('common.tunnelReady')" tone="success" :icon="GlobeOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="accounts" :loading="loadBusy" :empty-text="t('dnsAccount.empty')" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('dnsAccount.editTitle') : t('dnsAccount.addTitle')" class="modal-md" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-alert v-if="editingConfigError" type="error" :show-icon="true" class="mb-3">
          {{ t('dnsAccount.configDecryptError') }}
        </n-alert>
        <n-form-item :label="t('dnsAccount.provider')">
          <n-select v-model:value="form.type" :options="providerOptions" @update:value="onTypeChange" />
        </n-form-item>
        <n-form-item :label="t('dnsAccount.accountName')">
          <n-input v-model:value="form.name" :placeholder="t('dnsAccount.remarkPlaceholder')" />
        </n-form-item>
        <template v-if="currentProvider">
          <n-alert v-if="!currentProvider.implemented" type="warning" class="mb-3">
            {{ t('dnsAccount.pendingProvider') }}
          </n-alert>
          <n-form-item v-for="(field, key) in currentProvider.config" :key="key" :label="field.name">
            <n-input v-if="field.type === 'input'" v-model:value="form.config[key]" :type="isSecretField(key) ? 'password' : 'text'" show-password-on="click" :placeholder="field.placeholder || field.name" />
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
          <n-button type="primary" :loading="saveBusy" @click="save">{{ t('dnsAccount.saveVerify') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { NButton, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, ServerOutline, PeopleOutline, GlobeOutline } from '@vicons/ionicons5';
import { api } from '../api';
import { isSecretField } from '../lib/safe';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const router = useRouter();
const { t } = useI18n();

const message = useMessage();
const dialog = useDialog();
const loadBusy = ref(false);
const accounts = ref<any[]>([]);
const providerCount = computed(() => new Set(accounts.value.map((a: any) => a.type)).size);
const tunnelAccounts = computed(() => accounts.value.filter((a: any) => a.type === 'cloudflare').length);
const providers = ref<Record<string, any>>({});

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saveBusy = ref(false);
const editingConfigError = ref(false);
const form = reactive<any>({ type: '', name: '', config: {} });
const currentProvider = ref<any>(null);

const providerOptions = ref<any[]>([]);

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 60, mobile: 'hide' },
  { title: t('dnsAccount.provider'), key: 'type', width: 120 },
  {
    title: t('dnsAccount.accountName'),
    key: 'name',
    minWidth: 180,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.name });
    },
  },
  {
    title: t('common.remark'),
    key: 'remark',
    minWidth: 120,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.remark || '' });
    },
  },
  { title: t('dnsAccount.addTimeCol'), key: 'addtime', width: 170 },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 210,
    render(row: any) {
      const btns: any[] = [];
      if (row.type === 'cloudflare') {
        btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'info', onClick: () => router.push(`/cloudflare/accounts/${row.id}/tunnels`) }, { default: () => 'Tunnels' }));
      }
      btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => t('common.edit') }));
      btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h('div', { class: 'row-actions' }, btns);
    },
  },
]);

function selectOptions(options: any) {
  if (Array.isArray(options)) return options;
  return Object.entries(options || {}).map(([value, label]) => ({ label: String(label), value }));
}

async function loadProviders() {
  const res = await api<any>('GET', '/dns/providers');
  if (res.code === 0) {
    providers.value = res.data;
    providerOptions.value = Object.entries(res.data).map(([k, v]: any) => {
      const pending = v.implemented ? '' : t('dnsAccount.pendingPrefix');
      return {
        label: t('dnsAccount.providerLabel', { pending, name: v.name, key: k }),
        value: k,
        disabled: !v.implemented,
      };
    });
  }
}

async function loadAccounts() {
  loadBusy.value = true;
  const res = await api<any>('GET', '/dns/accounts');
  accounts.value = res.code === 0 ? res.data : [];
  loadBusy.value = false;
}

function onTypeChange() {
  currentProvider.value = providers.value[form.type] || null;
  const cfg: Record<string, any> = {};
  if (currentProvider.value) {
    for (const [key, field] of Object.entries<any>(currentProvider.value.config)) {
      cfg[key] = field.value !== undefined ? field.value : '';
    }
  }
  form.config = cfg;
}

function openAdd() {
  editingId.value = null;
  form.type = '';
  form.name = '';
  form.config = {};
  currentProvider.value = null;
  editingConfigError.value = false;
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.type = row.type;
  form.name = row.name;
  form.config = row.config && typeof row.config === 'object' ? { ...row.config } : safeJson(row.config) || {};
  currentProvider.value = providers.value[form.type] || null;
  editingConfigError.value = !!row.config_error;
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
  if (!form.type || !form.name) return message.warning(t('dnsAccount.fillWarning'));
  if (!currentProvider.value?.implemented) return message.warning(t('dnsAccount.providerUnsupported'));
  saveBusy.value = true;
  const body = { type: form.type, name: form.name, config: form.config };
  const res = editingId.value
    ? await api('PUT', `/dns/accounts/${editingId.value}`, body)
    : await api('POST', '/dns/accounts', body);
  saveBusy.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadAccounts();
  } else message.error(res.msg);
}

function del(row: any) {
  dialog.warning({
    title: t('dnsAccount.deleteTitle'),
    content: t('dnsAccount.deleteConfirm', { name: row.name }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/dns/accounts/${row.id}`);
      if (res.code === 0) {
        message.success(t('dnsAccount.deleteSuccess'));
        loadAccounts();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadProviders();
  loadAccounts();
});
</script>

