<template>
  <div class="app-stack">
    <PageHeader :title="t('deployAccount.title')" :subtitle="t('deployAccount.subtitle')">
      <template #actions>
        <n-button type="primary" @click="openAdd">
          <template #icon><n-icon :component="AddOutline" /></template>
          {{ t('deployAccount.add') }}
        </n-button>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="accounts.length" :label="t('common.total')" tone="primary" :icon="ListOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="typeCount" :label="t('common.type')" tone="info" :icon="LayersOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="statusCount" :label="t('common.status')" tone="success" :icon="CloudOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="accounts" :loading="loading" :empty-text="t('deployAccount.empty')" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('deployAccount.editTitle') : t('deployAccount.addTitle')" style="max-width:600px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('deployAccount.deployType')">
          <n-select v-model:value="form.type" :options="providerOptions" @update:value="onTypeChange" />
        </n-form-item>
        <n-form-item :label="t('deployAccount.accountName')">
          <n-input v-model:value="form.name" :placeholder="t('deployAccount.remarkPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('common.remark')">
          <n-input v-model:value="form.remark" :placeholder="t('deployAccount.optional')" />
        </n-form-item>
        <template v-if="currentProvider">
          <n-alert v-if="!currentProvider.implemented" type="warning" style="margin-bottom:12px">{{ t('deployAccount.pending') }}</n-alert>
          <n-alert v-if="currentProvider.desc || currentProvider.note" type="info" style="margin-bottom:12px" :show-icon="false">
            {{ currentProvider.desc || currentProvider.note }}
          </n-alert>
          <n-form-item v-for="(field, key) in currentProvider.inputs" v-show="fieldVisible(field.show, form.config)" :key="key" :label="field.name" :required="field.required">
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
          <n-button type="primary" :loading="saving" @click="save">{{ t('deployAccount.saveVerify') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NEllipsis, NTag, useMessage, useDialog } from 'naive-ui';
import { AddOutline, ListOutline, LayersOutline, CloudOutline } from '@vicons/ionicons5';
import { api } from '../api';
import { evalShow, isSecretField } from '../lib/safe';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const accounts = ref<any[]>([]);
const typeCount = computed(() => new Set(accounts.value.filter((r: any) => r.type != null).map((r: any) => r.type)).size);
const statusCount = computed(() => new Set(accounts.value.filter((r: any) => r.status != null).map((r: any) => r.status)).size);
const providers = ref<Record<string, any>>({});
const classConfig = ref<Record<string, string>>({});

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<any>({ type: '', name: '', remark: '', config: {} });
const currentProvider = ref<any>(null);
const providerOptions = ref<any[]>([]);

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: t('deployAccount.typeCol'),
    key: 'typename',
    width: 150,
    render(row: any) {
      const cls = providers.value[row.type]?.class;
      return h(NTag, { size: 'small', type: cls === 3 ? 'default' : cls === 2 ? 'warning' : 'info' }, { default: () => row.typename });
    },
  },
  {
    title: t('deployAccount.accountName'),
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
  { title: t('deployAccount.addtimeCol'), key: 'addtime', width: 170 },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 160,
    render(row: any) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }),
        ],
      });
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

async function loadProviders() {
  const res = await api<any>('GET', '/deploy/providers');
  if (res.code === 0) {
    providers.value = res.data;
    classConfig.value = res.class_config || {};
    providerOptions.value = Object.entries(res.data).map(([k, v]: any) => ({
      label: (v.implemented ? '' : t('deployAccount.pendingPrefix')) + v.name + '（' + k + '）',
      value: k,
      disabled: !v.implemented,
    }));
  }
}

async function loadAccounts() {
  loading.value = true;
  const res = await api<any>('GET', '/cert/accounts', { deploy: 1, limit: 200 });
  const rows = res.code === 0 ? res.data : [];
  accounts.value = rows.map((r: any) => ({ ...r, typename: r.typename || providers.value[r.type]?.name || r.type }));
  loading.value = false;
}

function onTypeChange() {
  currentProvider.value = providers.value[form.type] || null;
  const cfg: Record<string, any> = {};
  if (currentProvider.value) {
    for (const [key, field] of Object.entries<any>(currentProvider.value.inputs)) {
      cfg[key] = field.value !== undefined ? String(field.value) : '';
    }
  }
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

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function save() {
  if (!form.type || !form.name) return message.warning(t('deployAccount.fillWarning'));
  if (currentProvider.value && !currentProvider.value.implemented) return message.warning(t('deployAccount.unsupported'));
  saving.value = true;
  const body = { type: form.type, name: form.name, remark: form.remark, config: form.config, deploy: 1 };
  const res = editingId.value
    ? await api('PUT', `/cert/accounts/${editingId.value}`, body)
    : await api('POST', '/cert/accounts', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadAccounts();
  } else message.error(res.msg);
}

function del(row: any) {
  dialog.warning({
    title: t('deployAccount.deleteTitle'),
    content: t('deployAccount.deleteConfirm', { name: row.name }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cert/accounts/${row.id}?deploy=1`);
      if (res.code === 0) {
        message.success(t('deployAccount.deleteSuccess'));
        loadAccounts();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadProviders().then(loadAccounts);
});
</script>

