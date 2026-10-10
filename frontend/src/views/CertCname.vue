<template>
  <div class="app-stack">
    <PageHeader :title="t('cname.title')" :subtitle="t('cname.subtitle')">
      <template #actions>
        <n-button type="primary" @click="showAdd = true">{{ t('cname.add') }}</n-button>
      </template>
    </PageHeader>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="rows" :loading="loading" :empty-text="t('cname.empty')" />
    </n-card>

    <n-modal v-model:show="showAdd" preset="card" :title="t('cname.addTitle')" style="max-width:480px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cname.domain')"><n-input v-model:value="form.domain" placeholder="sub.example.com" /></n-form-item>
        <n-form-item :label="t('cname.selectDomain')">
          <n-select v-model:value="form.did" :options="domainOptions" filterable />
        </n-form-item>
        <n-form-item :label="t('cname.rr')"><n-input v-model:value="form.rr" :placeholder="t('cname.rrPlaceholder')" /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAdd = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="add">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, NModal, NForm, NFormItem, NInput, NSelect, useDialog, useMessage } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const rows = ref<any[]>([]);
const loading = ref(false);
const showAdd = ref(false);
const saving = ref(false);
const domainOptions = ref<any[]>([]);
const form = reactive<any>({ domain: '', did: null, rr: '' });

const columns = computed(() => [
  { title: t('cname.domain'), key: 'domain', width: 200 },
  { title: t('cname.rr'), key: 'rr', render: (r: any) => String(r.rr || '') + '.' + String(r.cnamedomain || '') },
  {
    title: t('cname.status'),
    key: 'status',
    width: 120,
    render: (r: any) => h(NTag, { type: Number(r.status) === 1 ? 'success' : 'warning', size: 'small' }, { default: () => (Number(r.status) === 1 ? t('cname.verified') : t('cname.unverified')) }),
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 160,
    render: (r: any) =>
      h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'info', onClick: () => check(r) }, { default: () => t('cname.check') }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => del(r) }, { default: () => t('common.delete') }),
        ],
      }),
  },
]);

async function load() {
  loading.value = true;
  const res = await api<any>('GET', '/cert/cnames');
  rows.value = res.code === 0 ? res.data || [] : [];
  if (res.code !== 0) message.error(res.msg);
  loading.value = false;
}

async function loadDomains() {
  const res = await api<any>('GET', '/domains');
  if (res.code === 0) domainOptions.value = (res.data || []).map((d: any) => ({ label: d._base_name || d.name, value: d.id }));
}

async function add() {
  if (!form.domain || !form.did || !form.rr) return message.warning(t('record.fillRequired'));
  saving.value = true;
  const res = await api('POST', '/cert/cnames', { domain: form.domain, did: form.did, rr: form.rr });
  saving.value = false;
  if (res.code === 0) {
    message.success(t('cname.addSuccess'));
    showAdd.value = false;
    form.domain = '';
    form.did = null;
    form.rr = '';
    load();
  } else message.error(res.msg);
}

async function check(r: any) {
  const res = await api<any>('POST', `/cert/cnames/${r.id}/check`);
  if (res.code === 0) {
    message.success(Number(res.status) === 1 ? t('cname.verified') : t('cname.unverified'));
    load();
  } else message.error(res.msg);
}

function del(r: any) {
  dialog.warning({
    title: t('cname.deleteTitle'),
    content: t('cname.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cert/cnames/${r.id}`);
      if (res.code === 0) {
        message.success(t('cname.deleteSuccess'));
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