<template>
  <div class="app-stack">
    <PageHeader :title="t('record.aliasTitle', { name: domainName || '#' + domainId })" :subtitle="t('record.aliasSubtitle')" :back="`/domains/${domainId}/records`" />
    <n-card :bordered="false">
      <n-space style="margin-bottom: 14px">
        <n-input v-model:value="alias" :placeholder="t('record.aliasPlaceholder')" style="width: 320px" />
        <n-button type="primary" :loading="saving" @click="add">{{ t('record.aliasAdd') }}</n-button>
      </n-space>
      <ResponsiveDataTable :columns="columns" :data="rows" :loading="loading" :empty-text="t('common.noData')" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { NButton, NSpace, useDialog, useMessage } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const route = useRoute();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const domainId = Number(route.params.id);
const domainName = ref('');
const rows = ref<any[]>([]);
const loading = ref(false);
const saving = ref(false);
const alias = ref('');

const columns = computed(() => [
  { title: t('record.aliasAdd'), key: 'DomainAlias' },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 120,
    render: (r: any) => h(NButton, { size: 'tiny', type: 'error', onClick: () => del(r) }, { default: () => t('common.delete') }),
  },
]);

async function load() {
  loading.value = true;
  const res = await api<any>('GET', `/domains/${domainId}/aliases`);
  rows.value = res.code === 0 ? res.data || [] : [];
  if (res.code !== 0) message.error(res.msg);
  loading.value = false;
}

async function add() {
  if (!alias.value.trim()) return;
  saving.value = true;
  const res = await api('POST', `/domains/${domainId}/aliases`, { alias: alias.value.trim() });
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    alias.value = '';
    load();
  } else message.error(res.msg);
}

function del(r: any) {
  dialog.warning({
    title: t('common.delete'),
    content: r.DomainAlias,
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/domains/${domainId}/aliases/${r.DomainAliasId}`);
      if (res.code === 0) {
        message.success(res.msg);
        load();
      } else message.error(res.msg);
    },
  });
}

onMounted(async () => {
  const dl = await api<any>('GET', '/domains');
  if (dl.code === 0) {
    const d = (dl.data || []).find((x: any) => x.id === domainId);
    if (d) domainName.value = d._base_name || d.name;
  }
  load();
});
</script>