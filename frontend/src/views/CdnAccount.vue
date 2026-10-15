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
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="accounts.length" :label="t('common.cdnAccounts')" tone="primary" :icon="CloudOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="providerCount" :label="t('common.providers')" tone="info" :icon="PeopleOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="tunnelAccounts" :label="t('common.tunnelReady')" tone="success" :icon="GlobeOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="accounts" :loading="loading" :empty-text="t('cdnAccount.empty')" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('cdnAccount.editTitle') : t('cdnAccount.addTitle')" style="max-width:520px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cdnAccount.provider')">
          <n-select v-model:value="form.type" :options="providerOptions" @update:value="onTypeChange" />
        </n-form-item>
        <n-form-item :label="t('cdnAccount.accountName')">
          <n-input v-model:value="form.name" :placeholder="t('cdnAccount.remarkPlaceholder')" />
        </n-form-item>
        <n-alert v-if="currentProvider?.note" type="info" style="margin-bottom:12px">{{ currentProvider.note }}</n-alert>
        <n-form-item v-for="(field, key) in currentProvider?.config || {}" :key="key" :label="field.name">
          <n-select v-if="field.type === 'select'" v-model:value="form.config[key]" :options="field.options || []" :placeholder="field.placeholder || field.name" clearable />
          <n-input v-else v-model:value="form.config[key]" :type="isSecretField(key) ? 'password' : 'text'" show-password-on="click" :placeholder="field.placeholder || field.name" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="save">{{ t('cdnAccount.saveVerify') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showSites" preset="card" :title="t('cdnSite.title', { name: siteAcct?.name || '' })" style="max-width:820px" :mask-closable="false">
      <n-space vertical :size="14">
        <n-card size="small" :title="t('cdnSite.create')">
          <n-grid cols="1 s:2" responsive="screen" :x-gap="12" :y-gap="4">
            <n-grid-item>
              <n-form-item :label="t('cdnSite.siteName')" :show-feedback="false">
                <n-input v-model:value="createForm.name" :placeholder="t('cdnSite.siteNamePlaceholder')" />
              </n-form-item>
            </n-grid-item>
            <template v-if="siteIsEsa">
              <n-grid-item>
                <n-form-item :label="t('cdnSite.coverage')" :show-feedback="false">
                  <n-select v-model:value="createForm.coverage" :options="coverageOptions" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('cdnSite.accessType')" :show-feedback="false">
                  <n-select v-model:value="createForm.accessType" :options="accessTypeOptions" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('cdnSite.instance')" :show-feedback="false">
                  <n-select v-model:value="createForm.instanceId" :options="instanceOptions" />
                </n-form-item>
              </n-grid-item>
            </template>
            <template v-else>
              <n-grid-item>
                <n-form-item :label="t('cdnSite.type')" :show-feedback="false">
                  <n-select v-model:value="createForm.type" :options="typeOptions" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('cdnSite.area')" :show-feedback="false">
                  <n-select v-model:value="createForm.area" :options="areaOptions" />
                </n-form-item>
              </n-grid-item>
            </template>
          </n-grid>
          <n-space justify="end" style="margin-top:8px">
            <n-button size="small" @click="checkSiteName">{{ t('cdnSite.checkName') }}</n-button>
            <n-button size="small" type="primary" :loading="siteSaving" @click="createSite">{{ t('cdnSite.create') }}</n-button>
          </n-space>
        </n-card>
        <n-data-table :columns="siteColumns" :data="siteList" :loading="siteLoading" :bordered="false" size="small" :row-key="(r:any) => String(r.zoneId)" />
      </n-space>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { NButton, NSpace, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { AddOutline, CloudOutline, PeopleOutline, GlobeOutline } from '@vicons/ionicons5';
import { api } from '../api';
import { isSecretField } from '../lib/safe';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const accounts = ref<any[]>([]);
const providerCount = computed(() => new Set(accounts.value.map((a: any) => a.type)).size);
const tunnelAccounts = computed(() => accounts.value.filter((a: any) => a.type === 'cloudflare').length);
const providers = ref<Record<string, any>>({});
const providerOptions = ref<any[]>([]);

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<any>({ type: '', name: '', config: {} });
const currentProvider = ref<any>(null);

// ===== 站点管理 =====
const showSites = ref(false);
const siteAcct = ref<any>(null);
const siteList = ref<any[]>([]);
const siteLoading = ref(false);
const siteSaving = ref(false);
const instanceList = ref<any[]>([]);
const createForm = reactive<any>({ name: '', coverage: 'domestic', accessType: 'CNAME', instanceId: '', type: 'partial', area: 'overseas' });
const siteIsEsa = computed(() => siteAcct.value?.type === 'aliyun_esa');

const coverageOptions = computed(() => [
  { label: t('cdnSite.coverageDomestic'), value: 'domestic' },
  { label: t('cdnSite.coverageGlobal'), value: 'global' },
  { label: t('cdnSite.coverageOverseas'), value: 'overseas' },
]);
const accessTypeOptions = computed(() => [
  { label: t('cdnSite.accessNS'), value: 'NS' },
  { label: t('cdnSite.accessCNAME'), value: 'CNAME' },
]);
const typeOptions = computed(() => [
  { label: t('cdnSite.typePartial'), value: 'partial' },
  { label: t('cdnSite.typeFull'), value: 'full' },
]);
const areaOptions = computed(() => [
  { label: t('cdnSite.areaGlobal'), value: 'global' },
  { label: t('cdnSite.areaMainland'), value: 'mainland' },
  { label: t('cdnSite.areaOverseas'), value: 'overseas' },
]);
const instanceOptions = computed(() =>
  instanceList.value.map((it: any) => ({
    label: it.InstanceName || it.Name || it.Remark || String(it.InstanceId || it.Id || ''),
    value: String(it.InstanceId || it.Id || ''),
  })),
);
const siteColumns = computed(() => [
  { title: t('cdnSite.colName'), key: 'zoneName', minWidth: 160 },
  { title: t('cdnSite.colStatus'), key: 'status', width: 110, render: (row: any) => (row.paused ? t('cdnSite.pausedOk') : row.status || '') },
  { title: t('cdnSite.colArea'), key: 'area', width: 130 },
  {
    title: t('cdnSite.colActions'),
    key: 'actions',
    width: 320,
    render: (row: any) => {
      const btns: any[] = [
        h(NButton, { size: 'tiny', onClick: () => toggleSitePause(row) }, { default: () => (row.paused ? t('cdnSite.resume') : t('cdnSite.pause')) }),
        h(NButton, { size: 'tiny', onClick: () => verifySite(row) }, { default: () => t('cdnSite.verify') }),
      ];
      if (siteIsEsa.value) btns.push(h(NButton, { size: 'tiny', onClick: () => showNs(row) }, { default: () => t('cdnSite.ns') }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => deleteSite(row) }, { default: () => t('cdnSite.delete') }));
      return h(NSpace, null, { default: () => btns });
    },
  },
]);

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 60 },
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
    width: 260,
    render(row: any) {
      const btns: any[] = [];
      if (providers.value[row.type]?.capabilities?.zoneManage) {
        btns.push(h(NButton, { size: 'tiny', onClick: () => openSites(row) }, { default: () => t('cdnSite.manage') }));
      }
      btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(row) }, { default: () => t('common.edit') }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h(NSpace, null, { default: () => btns });
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
  loading.value = true;
  const res = await api<any>('GET', '/cdn/accounts');
  accounts.value = res.code === 0 ? res.data : [];
  loading.value = false;
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
  form.config = {};
  currentProvider.value = null;
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.type = row.type;
  form.name = row.name;
  form.config = row.config && typeof row.config === 'object' ? { ...row.config } : safeJson(row.config) || {};
  currentProvider.value = providers.value[form.type] || null;
  showEdit.value = true;
}

async function save() {
  if (!form.type || !form.name) return message.warning(t('cdnAccount.fillWarning'));
  saving.value = true;
  const body = { type: form.type, name: form.name, config: form.config, remark: '' };
  const res = editingId.value
    ? await api('PUT', `/cdn/accounts/${editingId.value}`, body)
    : await api('POST', '/cdn/accounts', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadAccounts();
  } else message.error(res.msg);
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

async function openSites(row: any) {
  siteAcct.value = row;
  createForm.name = '';
  instanceList.value = [];
  showSites.value = true;
  await loadSites();
  if (row.type === 'aliyun_esa') await loadInstances();
}

async function loadSites() {
  if (!siteAcct.value) return;
  siteLoading.value = true;
  const res = await api<any>('GET', `/cdn/accounts/${siteAcct.value.id}/sites`);
  siteList.value = res.code === 0 ? res.data : [];
  siteLoading.value = false;
}

async function loadInstances() {
  const res = await api<any>('GET', `/cdn/accounts/${siteAcct.value.id}/plan-instances`);
  instanceList.value = res.code === 0 && Array.isArray(res.data) ? res.data : [];
}

async function checkSiteName() {
  if (!createForm.name) return message.warning(t('cdnSite.needName'));
  const res = await api<any>('POST', `/cdn/accounts/${siteAcct.value.id}/sites/check`, { siteName: createForm.name });
  if (res.code !== 0) return message.error(res.msg);
  if (res.data?.passed === false) message.warning(t('cdnSite.nameBad'));
  else message.success(t('cdnSite.nameOk'));
}

async function createSite() {
  if (!createForm.name) return message.warning(t('cdnSite.needName'));
  siteSaving.value = true;
  const body: any = { name: createForm.name };
  if (siteIsEsa.value) {
    body.area = createForm.coverage;
    body.accessType = createForm.accessType;
    body.instanceId = createForm.instanceId;
  } else {
    body.type = createForm.type;
    body.area = createForm.area;
  }
  const res = await api<any>('POST', `/cdn/accounts/${siteAcct.value.id}/sites`, body);
  siteSaving.value = false;
  if (res.code === 0) {
    message.success(res.msg || t('cdnSite.created'));
    if (res.data?.nameServers?.length) message.info(t('cdnSite.nsTitle') + ': ' + res.data.nameServers.join(', '), { duration: 8000 });
    createForm.name = '';
    loadSites();
  } else message.error(res.msg);
}

async function toggleSitePause(row: any) {
  const res = await api<any>('POST', `/cdn/accounts/${siteAcct.value.id}/sites/pause`, { zoneId: row.zoneId, paused: !row.paused });
  if (res.code === 0) {
    message.success(res.msg);
    loadSites();
  } else message.error(res.msg);
}

async function verifySite(row: any) {
  const res = await api<any>('POST', `/cdn/accounts/${siteAcct.value.id}/sites/verify`, { zoneId: row.zoneId, domain: row.zoneName });
  if (res.code === 0) message.success(t('cdnSite.verifiedOk'));
  else message.error(res.msg);
}

async function showNs(row: any) {
  const res = await api<any>('GET', `/cdn/accounts/${siteAcct.value.id}/sites/${encodeURIComponent(row.zoneId)}/ns`);
  if (res.code === 0) {
    dialog.info({ title: t('cdnSite.nsTitle'), content: () => h('div', { style: 'white-space:pre-wrap' }, (res.data || []).join('\n') || '-') });
  } else message.error(res.msg);
}

function deleteSite(row: any) {
  dialog.warning({
    title: t('common.delete'),
    content: t('cdnSite.confirmDelete', { name: row.zoneName || row.zoneId }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${siteAcct.value.id}/sites/${encodeURIComponent(row.zoneId)}`);
      if (res.code === 0) {
        message.success(res.msg);
        loadSites();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadProviders();
  loadAccounts();
});
</script>

