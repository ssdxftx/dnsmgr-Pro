<template>
  <div class="app-stack">
    <PageHeader :title="t('cdnAccount.title')" :subtitle="t('cdnAccount.subtitle')">
      <template #actions>
        <n-button type="primary" @click="openAdd">
          <template #icon><n-icon :component="AddOutline" /></template>
          {{ t('cdnAccount.add') }}
        </n-button>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="2 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="accounts.length" :label="t('common.cdnAccounts')" tone="primary" :icon="CloudOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="providerCount" :label="t('common.providers')" tone="info" :icon="PeopleOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="tunnelAccounts" :label="t('common.tunnelReady')" tone="success" :icon="GlobeOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="accounts" :loading="loadBusy" :empty-text="t('cdnAccount.empty')" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('cdnAccount.editTitle') : t('cdnAccount.addTitle')" class="modal-sm" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cdnAccount.provider')">
          <EsaCardSelect
            :model-value="form.type"
            :options="providerOptions"
            compact
            @update:model-value="(v: any) => { form.type = v; onTypeChange(); }"
          />
        </n-form-item>
        <n-form-item :label="t('cdnAccount.accountName')">
          <n-input v-model:value="form.name" :placeholder="t('cdnAccount.remarkPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('common.remark')">
          <n-input v-model:value="form.remark" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" clearable />
        </n-form-item>
        <n-alert v-if="currentProvider?.note" type="info" class="mb-3">{{ currentProvider.note }}</n-alert>
        <n-form-item v-for="(field, key) in currentProvider?.config || {}" :key="key" :label="field.name">
          <EsaCardSelect
            v-if="field.type === 'select'"
            v-model="form.config[key]"
            :options="field.options || []"
            compact
            clearable
            :placeholder="field.placeholder || field.name"
          />
          <n-input v-else v-model:value="form.config[key]" :type="isSecretField(key) ? 'password' : 'text'" show-password-on="click" :placeholder="field.placeholder || field.name" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saveBusy" @click="save">{{ t('cdnAccount.saveVerify') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { NButton, NIcon, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { AddOutline, CloudOutline, PeopleOutline, GlobeOutline } from '@vicons/ionicons5';
import { api } from '../api';
import { isSecretField } from '../lib/safe';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import EsaCardSelect from '../components/cdn/EsaCardSelect.vue';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const loadBusy = ref(false);
const accounts = ref<any[]>([]);
const providerCount = computed(() => new Set(accounts.value.map((a: any) => a.type)).size);
const tunnelAccounts = computed(() => accounts.value.filter((a: any) => a.type === 'cloudflare').length);

const providers = ref<Record<string, any>>({});
const providerOptions = ref<any[]>([]);
const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saveBusy = ref(false);
const currentProvider = ref<any>(null);
const form = reactive<any>({ type: '', name: '', remark: '', config: {} as Record<string, any> });

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 60, mobile: 'hide' },
  { title: t('cdnAccount.providerCol'), key: 'typename', width: 140 },
  {
    title: t('cdnAccount.nameCol'),
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
  { title: t('cdnAccount.addTime'), key: 'addtime', width: 170 },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 160,
    render(row: any) {
      return h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }),
      ]);
    },
  },
]);

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function loadProviders() {
  const res = await api<any>('GET', '/cdn/providers');
  if (res.code === 0) {
    providers.value = res.data;
    providerOptions.value = Object.entries(res.data).map(([k, v]: any) => ({ label: v.name, value: k }));
  }
}

async function loadAccounts() {
  loadBusy.value = true;
  const res = await api<any>('GET', '/cdn/accounts');
  accounts.value = res.code === 0 ? res.data : [];
  loadBusy.value = false;
}

function onTypeChange() {
  currentProvider.value = providers.value[form.type] || null;
  const cfg: Record<string, any> = {};
  for (const key of Object.keys(currentProvider.value?.config || {})) cfg[key] = '';
  form.config = cfg;
}

function openAdd() {
  editingId.value = null;
  form.type = '';
  form.name = '';
  form.remark = '';
  form.config = {};
  currentProvider.value = null;
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.type = row.type;
  form.name = row.name;
  form.remark = row.remark || '';
  form.config = row.config && typeof row.config === 'object' ? { ...row.config } : safeJson(row.config) || {};
  currentProvider.value = providers.value[form.type] || null;
  showEdit.value = true;
}

async function save() {
  if (!form.type || !form.name) return message.warning(t('cdnAccount.fillWarning'));
  saveBusy.value = true;
  try {
    const body = { type: form.type, name: form.name, config: form.config, remark: form.remark || '' };
    const res = editingId.value
      ? await api('PUT', `/cdn/accounts/${editingId.value}`, body)
      : await api('POST', '/cdn/accounts', body);
    if (res.code === 0) {
      message.success(res.msg);
      showEdit.value = false;
      loadAccounts();
    } else message.error(res.msg);
  } catch (e: any) {
    message.error(e?.message || t('common.failed'));
  } finally {
    saveBusy.value = false;
  }
}

function del(row: any) {
  dialog.warning({
    title: t('cdnAccount.deleteTitle'),
    content: t('cdnAccount.deleteConfirm', { name: row.name }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${row.id}`);
      if (res.code === 0) {
        message.success(t('cdnAccount.deleteSuccess'));
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
