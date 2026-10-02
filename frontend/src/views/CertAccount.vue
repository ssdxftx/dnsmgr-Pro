<template>
  <div class="app-stack">
    <PageHeader :title="t('certAccount.title')" :subtitle="t('certAccount.subtitle')">
      <template #actions>
        <n-button type="primary" @click="openAdd">
          <template #icon><n-icon :component="AddOutline" /></template>
          {{ t('certAccount.add') }}
        </n-button>
      </template>
    </PageHeader>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="accounts" :loading="loading" :empty-text="t('certAccount.empty')" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('certAccount.editTitle') : t('certAccount.addTitle')" style="max-width:600px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('certAccount.provider')">
          <n-select v-model:value="form.type" :options="providerOptions" @update:value="onTypeChange" />
        </n-form-item>
        <n-form-item :label="t('certAccount.accountName')">
          <n-input v-model:value="form.name" :placeholder="t('certAccount.remarkPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('common.remark')">
          <n-input v-model:value="form.remark" :placeholder="t('certAccount.optional')" />
        </n-form-item>
        <template v-if="currentProvider">
          <n-alert v-if="currentProvider.note" type="info" style="margin-bottom:12px" :show-icon="false">
            {{ currentProvider.note }}
            <a v-if="currentProvider.noteUrl" :href="currentProvider.noteUrl" target="_blank" rel="noreferrer" style="margin-left:6px">{{ t('certAccount.view') }}</a>
          </n-alert>
          <n-form-item v-for="(field, key) in currentProvider.inputs" v-show="fieldVisible(field.show, form.config)" :key="key" :label="field.name" :required="field.required">
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
          <n-button type="primary" :loading="saving" @click="save">{{ t('certAccount.saveVerify') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NEllipsis, NTag, useMessage, useDialog } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api } from '../api';
import { evalShow, isSecretField } from '../lib/safe';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const accounts = ref<any[]>([]);
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
    title: t('certAccount.providerCol'),
    key: 'typename',
    width: 150,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.class === 1 ? 'info' : 'warning' }, { default: () => row.typename });
    },
  },
  {
    title: t('certAccount.accountName'),
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
  { title: t('certAccount.addtimeCol'), key: 'addtime', width: 170 },
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
  const res = await api<any>('GET', '/cert/providers');
  if (res.code === 0) {
    providers.value = res.data;
    classConfig.value = res.class_config || {};
    providerOptions.value = Object.entries(res.data).map(([k, v]: any) => ({
      label: v.name + '（' + k + '）',
      value: k,
    }));
  }
}

async function loadAccounts() {
  loading.value = true;
  const res = await api<any>('GET', '/cert/accounts');
  const rows = res.code === 0 ? res.data : [];
  accounts.value = rows.map((r: any) => ({ ...r, typename: r.typename || providers.value[r.type]?.name || r.type, class: providers.value[r.type]?.class }));
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
  if (!form.type || !form.name) return message.warning(t('certAccount.fillWarning'));
  saving.value = true;
  const body = { type: form.type, name: form.name, remark: form.remark, config: form.config };
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
    title: t('certAccount.deleteTitle'),
    content: t('certAccount.deleteConfirm', { name: row.name }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cert/accounts/${row.id}`);
      if (res.code === 0) {
        message.success(t('certAccount.deleteSuccess'));
        loadAccounts();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadProviders().then(loadAccounts);
});
</script>

