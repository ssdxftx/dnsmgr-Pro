<template>
  <div class="app-stack">
    <PageHeader :title="t('record.weightTitle', { name: domainName || '#' + domainId })" :subtitle="t('record.weightSubtitle')" :back="`/domains/${domainId}/records`" />
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="rows" :loading="loading" :empty-text="t('common.noData')" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="t('record.weightConfigure')" style="max-width:640px" :mask-closable="false">
      <n-space vertical :size="10">
        <n-text depth="3">{{ current?.SubDomain }}</n-text>
        <n-table :bordered="false" :single-line="false" size="small">
          <thead><tr><th>{{ t('record.hostRecord') }}</th><th>{{ t('record.recordValue') }}</th><th style="width:140px">{{ t('record.weightValue') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in records" :key="r.RecordId">
              <td>{{ r.Name }}</td>
              <td class="mono">{{ r.Value }}</td>
              <td><n-input-number v-model:value="weights[r.RecordId]" :min="1" :max="100" size="small" /></td>
            </tr>
          </tbody>
        </n-table>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="saveWeights">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { NButton, NSpace, NTag, NModal, NText, NTable, NInputNumber, useMessage } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const route = useRoute();
const { t } = useI18n();
const message = useMessage();
const domainId = Number(route.params.id);
const domainName = ref('');
const rows = ref<any[]>([]);
const loading = ref(false);
const showEdit = ref(false);
const saving = ref(false);
const current = ref<any>(null);
const records = ref<any[]>([]);
const weights = reactive<Record<string, number>>({});

const columns = computed(() => [
  { title: t('record.weightSubdomain'), key: 'rr', width: 180 },
  { title: t('record.nameCol'), key: 'SubDomain', render: (r: any) => r.SubDomain },
  {
    title: t('record.weightStatusLabel'),
    key: 'Open',
    width: 120,
    render: (r: any) => h(NTag, { type: r.Open === true || r.Open === 'true' ? 'success' : 'default', size: 'small' }, { default: () => (r.Open === true || r.Open === 'true' ? t('record.weightOn') : t('record.weightOff')) }),
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 220,
    render: (r: any) =>
      h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', type: r.Open === true || r.Open === 'true' ? 'default' : 'success', onClick: () => toggle(r) }, { default: () => (r.Open === true || r.Open === 'true' ? t('record.weightDisable') : t('record.weightEnable')) }),
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(r) }, { default: () => t('record.weightConfigure') }),
        ],
      }),
  },
]);

async function load() {
  loading.value = true;
  const res = await api<any>('GET', `/domains/${domainId}/weight`, { pagesize: 100 });
  rows.value = res.code === 0 ? res.data?.list || [] : [];
  if (res.code !== 0) message.error(res.msg);
  loading.value = false;
}

async function toggle(r: any) {
  const open = r.Open === true || r.Open === 'true';
  const res = await api('POST', `/domains/${domainId}/weight`, { act: 'status', subdomain: r.rr, status: open ? '0' : '1', type: r.Type, line: r.Line });
  if (res.code === 0) {
    message.success(res.msg);
    load();
  } else message.error(res.msg);
}

async function openEdit(r: any) {
  current.value = r;
  const res = await api<any>('GET', `/domains/${domainId}/records`, { subdomain: r.rr, pagesize: 100 });
  records.value = res.code === 0 ? res.data?.list || [] : [];
  for (const k of Object.keys(weights)) delete weights[k];
  for (const rec of records.value) weights[rec.RecordId] = Number(rec.Weight || 1);
  showEdit.value = true;
}

async function saveWeights() {
  if (!current.value) return;
  saving.value = true;
  const res = await api('POST', `/domains/${domainId}/weight`, {
    act: 'update',
    subdomain: current.value.rr,
    status: '1',
    type: current.value.Type,
    line: current.value.Line,
    weight: { ...weights },
  });
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    load();
  } else message.error(res.msg);
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

<style scoped>
.mono {
  font-family: ui-monospace, Menlo, monospace;
  word-break: break-all;
}
</style>