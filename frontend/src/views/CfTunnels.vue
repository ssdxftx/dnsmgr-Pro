<template>
  <div class="app-stack">
    <PageHeader :title="t('cfTunnels.title', { name: accountName || t('cfTunnels.accountFallback', { id: accountId }) })" :subtitle="t('cfTunnels.subtitle')" back="/cdn-accounts">
      <template #actions>
        <n-button type="primary" @click="openAdd"><template #icon><n-icon :component="AddOutline" /></template>{{ t('cfTunnels.createTunnel') }}</n-button>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="2 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="rows.length" :label="t('common.total')" tone="primary" :icon="ListOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="typeCount" :label="t('common.type')" tone="info" :icon="LayersOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="statusCount" :label="t('common.status')" tone="success" :icon="GlobeOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>

    <n-card :bordered="false">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cfTunnels.overview') }}</h3>
        </div>
        <OverviewStats
          :items="[
            { label: t('cfTunnels.connectionCount'), value: totalConnections },
            { label: t('cfTunnels.activeTunnels'), value: activeTunnels, tone: 'success' },
            { label: t('cfTunnels.idleTunnels'), value: rows.length - activeTunnels },
          ]"
        />
      </div>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cfTunnels.listTitle') }}</h3>
        </div>
        <ResponsiveDataTable :columns="columns" :data="rows" :loading="loadBusy" :row-key="(row: any) => row.id" size="small" :empty-text="t('cfTunnels.empty')" />
      </div>
    </n-card>

    <!-- 创建 -->
    <n-modal v-model:show="showAdd" preset="card" :title="t('cfTunnels.createTunnel')" class="modal-sm" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('common.name')" required><n-input v-model:value="addName" :placeholder="t('cfTunnels.namePlaceholder')" /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAdd = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saveBusy" @click="saveAdd">{{ t('common.create') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Token -->
    <n-modal v-model:show="showToken" preset="card" :title="t('cfTunnels.tokenTitle')" class="modal-md" :mask-closable="false">
      <n-spin :show="tokenBusy">
        <n-form label-placement="left" label-width="110">
          <n-form-item label="Tunnel"><n-input :value="tokenName" disabled /></n-form-item>
          <n-form-item label="Token"><n-input v-model:value="tokenValue" type="textarea" :rows="6" readonly /></n-form-item>
          <n-form-item :label="t('cfTunnels.runCommand')"><n-input v-model:value="tokenCommand" type="textarea" :rows="2" readonly /></n-form-item>
        </n-form>
      </n-spin>
      <template #footer>
        <n-space justify="end">
          <n-button @click="copy(tokenCommand)">{{ t('cfTunnels.copyCommand') }}</n-button>
          <n-button @click="showToken = false">{{ t('common.close') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 公网主机名 -->
    <n-modal v-model:show="showPublic" preset="card" :title="t('cfTunnels.publicHostnamesTitle', { name: currentTunnelName })" class="modal-lg" :mask-closable="false">
      <n-form label-placement="left" label-width="110" inline>
        <n-form-item :label="t('cfTunnels.hostname')"><n-input v-model:value="publicForm.hostname" placeholder="app.example.com" style="width:200px" /></n-form-item>
        <n-form-item :label="t('cfTunnels.service')"><n-input v-model:value="publicForm.service" placeholder="http://localhost:8080" style="width:200px" /></n-form-item>
        <n-form-item :label="t('cfTunnels.path')"><n-input v-model:value="publicForm.path" :placeholder="t('cfTunnels.leaveBlank')" style="width:120px" /></n-form-item>
        <n-button type="primary" size="small" :loading="publicLoadBusy" @click="savePublic">{{ t('common.save') }}</n-button>
      </n-form>
      <n-divider />
      <ResponsiveDataTable :columns="publicColumns" :data="publicRows" :loading="publicLoadBusy" :row-key="(row: any) => row.hostname + row.path" size="small" />
      <template #footer>
        <n-button @click="showPublic = false">{{ t('common.close') }}</n-button>
      </template>
    </n-modal>

    <!-- CIDR 路由 -->
    <n-modal v-model:show="showCidr" preset="card" :title="t('cfTunnels.cidrRoutesTitle', { name: currentTunnelName })" class="modal-lg" :mask-closable="false">
      <n-form label-placement="left" label-width="110" inline>
        <n-form-item label="CIDR"><n-input v-model:value="cidrForm.network" placeholder="10.0.0.0/24" style="width:180px" /></n-form-item>
        <n-form-item :label="t('common.remark')"><n-input v-model:value="cidrForm.comment" style="width:200px" /></n-form-item>
        <n-button type="primary" size="small" :loading="cidrLoadBusy" @click="saveCidr">{{ t('common.add') }}</n-button>
      </n-form>
      <n-divider />
      <ResponsiveDataTable :columns="cidrColumns" :data="cidrRows" :loading="cidrLoadBusy" :row-key="(row: any) => row.id" size="small" />
      <template #footer>
        <n-button @click="showCidr = false">{{ t('common.close') }}</n-button>
      </template>
    </n-modal>

    <!-- 主机名路由 -->
    <n-modal v-model:show="showRoute" preset="card" :title="t('cfTunnels.hostnameRoutesTitle', { name: currentTunnelName })" class="modal-lg" :mask-closable="false">
      <n-form label-placement="left" label-width="110" inline>
        <n-form-item :label="t('cfTunnels.hostname')"><n-input v-model:value="routeForm.hostname" placeholder="private.example.com" style="width:220px" /></n-form-item>
        <n-form-item :label="t('common.remark')"><n-input v-model:value="routeForm.comment" style="width:200px" /></n-form-item>
        <n-button type="primary" size="small" :loading="routeLoadBusy" @click="saveRoute">{{ t('common.add') }}</n-button>
      </n-form>
      <n-divider />
      <ResponsiveDataTable :columns="routeColumns" :data="routeRows" :loading="routeLoadBusy" :row-key="(row: any) => row.id" size="small" />
      <template #footer>
        <n-button @click="showRoute = false">{{ t('common.close') }}</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, ListOutline, LayersOutline, GlobeOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import OverviewStats from '../components/OverviewStats.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const route = useRoute();
const { t, locale } = useI18n();
const message = useMessage();
const dialog = useDialog();
const accountId = Number(route.params.id);
const accountName = ref('');
const loadBusy = ref(false);
const rows = ref<any[]>([]);
const totalConnections = computed(() => rows.value.reduce((sum: number, r: any) => sum + (Number(r.connection_count) || 0), 0));
const activeTunnels = computed(() => rows.value.filter((r: any) => Number(r.connection_count) > 0).length);
const typeCount = computed(() => new Set(rows.value.filter((r: any) => r.type != null).map((r: any) => r.type)).size);
const statusCount = computed(() => new Set(rows.value.filter((r: any) => r.status != null).map((r: any) => r.status)).size);
const saveBusy = ref(false);

const showAdd = ref(false);
const addName = ref('');

const showToken = ref(false);
const tokenName = ref('');
const tokenValue = ref('');
const tokenCommand = ref('');
const tokenBusy = ref(false);

const currentTunnelId = ref('');
const currentTunnelName = ref('');

const columns = computed<any[]>(() => [
  { title: t('common.name'), key: 'name', minWidth: 180 },
  { title: 'Tunnel ID', key: 'id', minWidth: 180, render: (row: any) => h(NEllipsis, { style: 'max-width:220px' }, { default: () => row.id || '-' }) },
  { title: t('common.status'), key: 'status', width: 120, render: (row: any) => statusTag(row.status) },
  { title: t('cfTunnels.connectionCount'), key: 'connection_count', width: 80 },
  { title: t('common.createdAt'), key: 'created_at', width: 170, render: (row: any) => fmt(row.created_at) },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 340,
    render(row: any) {
      return h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => showTokenOf(row) }, { default: () => 'Token' }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openPublic(row) }, { default: () => t('cfTunnels.publicHostnames') }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openCidr(row) }, { default: () => t('cfTunnels.cidrRoutes') }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openRoute(row) }, { default: () => t('cfTunnels.hostnameRoutes') }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delTunnel(row) }, { default: () => t('common.delete') }),
      ]);
    },
  },
]);

const publicRows = ref<any[]>([]);
const publicLoadBusy = ref(false);
const showPublic = ref(false);
const publicForm = reactive<any>({ hostname: '', service: '', path: '' });
const publicColumns = computed<any[]>(() => [
  { title: t('cfTunnels.hostname'), key: 'hostname', minWidth: 180 },
  { title: t('cfTunnels.path'), key: 'path', width: 100, render: (row: any) => row.path || '-' },
  { title: t('cfTunnels.service'), key: 'service', minWidth: 180, render: (row: any) => h(NEllipsis, { style: 'max-width:220px' }, { default: () => row.service }) },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 80,
    render(row: any) {
      return h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delPublic(row) }, { default: () => t('common.delete') });
    },
  },
]);

const showCidr = ref(false);
const cidrRows = ref<any[]>([]);
const cidrLoadBusy = ref(false);
const cidrForm = reactive<any>({ network: '', comment: '' });
const cidrColumns = computed<any[]>(() => [
  { title: 'CIDR', key: 'network', minWidth: 180 },
  { title: t('common.remark'), key: 'comment', minWidth: 160, render: (row: any) => row.comment || '-' },
  { title: t('common.createdAt'), key: 'created_at', width: 170, render: (row: any) => fmt(row.created_at) },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 80,
    render(row: any) {
      return h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delCidr(row) }, { default: () => t('common.delete') });
    },
  },
]);

const showRoute = ref(false);
const routeRows = ref<any[]>([]);
const routeLoadBusy = ref(false);
const routeForm = reactive<any>({ hostname: '', comment: '' });
const routeColumns = computed<any[]>(() => [
  { title: t('cfTunnels.hostname'), key: 'hostname', minWidth: 200 },
  { title: t('common.remark'), key: 'comment', minWidth: 160, render: (row: any) => row.comment || '-' },
  { title: t('common.createdAt'), key: 'created_at', width: 170, render: (row: any) => fmt(row.created_at) },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 80,
    render(row: any) {
      return h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delRoute(row) }, { default: () => t('common.delete') });
    },
  },
]);

function fmt(s: string) {
  if (!s) return '-';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(locale.value, { hour12: false });
}

function statusTag(v: string) {
  const val = (v || 'unknown').toUpperCase();
  let type: any = 'default';
  if (val === 'HEALTHY' || val === 'ACTIVE') type = 'success';
  else if (val === 'INACTIVE') type = 'warning';
  return h(NTag, { size: 'small', type, bordered: false }, { default: () => val });
}

async function load() {
  loadBusy.value = true;
  const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels`);
  if (res.code === 0) {
    rows.value = res.data;
    accountName.value = res.account_name || '';
  } else message.error(res.msg);
  loadBusy.value = false;
}

function openAdd() {
  addName.value = '';
  showAdd.value = true;
}

async function saveAdd() {
  if (!addName.value.trim()) return message.warning(t('cfTunnels.nameRequired'));
  saveBusy.value = true;
  const res = await api('POST', `/cloudflare/accounts/${accountId}/tunnels`, { name: addName.value });
  saveBusy.value = false;
  if (res.code === 0) { message.success(res.msg); showAdd.value = false; load(); } else message.error(res.msg);
}

function delTunnel(row: any) {
  dialog.warning({ title: t('cfTunnels.deleteTunnelTitle'), content: t('cfTunnels.deleteTunnelConfirm', { item: row.name }), positiveText: t('common.delete'), negativeText: t('common.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/accounts/${accountId}/tunnels/${row.id}`);
    if (res.code === 0) { message.success(res.msg); load(); } else message.error(res.msg);
  } });
}

async function showTokenOf(row: any) {
  tokenName.value = `${row.name} [${row.id}]`;
  tokenValue.value = '';
  tokenCommand.value = '';
  showToken.value = true; // 先开弹窗，立即给出视觉响应
  tokenBusy.value = true;
  try {
    const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels/${row.id}/token`);
    if (res.code === 0) {
      tokenValue.value = res.data.token || '';
      tokenCommand.value = `cloudflared tunnel run --token ${res.data.token}`;
    } else message.error(res.msg);
  } finally {
    tokenBusy.value = false;
  }
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => message.success(t('common.copied'))).catch(() => message.warning(t('cfTunnels.copyFailed')));
}

function openPublic(row: any) {
  currentTunnelId.value = row.id;
  currentTunnelName.value = row.name;
  Object.assign(publicForm, { hostname: '', service: '', path: '' });
  showPublic.value = true;
  loadPublic();
}

async function loadPublic() {
  publicLoadBusy.value = true;
  const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/public-hostnames`);
  publicRows.value = res.code === 0 ? res.data : [];
  if (res.code !== 0) message.error(res.msg);
  publicLoadBusy.value = false;
}

async function savePublic() {
  if (!publicForm.hostname || !publicForm.service) return message.warning(t('cfTunnels.fillHostnameService'));
  publicLoadBusy.value = true;
  const res = await api('PUT', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/public-hostnames`, { ...publicForm });
  publicLoadBusy.value = false;
  if (res.code === 0) { message.success(res.msg); Object.assign(publicForm, { hostname: '', service: '', path: '' }); loadPublic(); } else message.error(res.msg);
}

function delPublic(row: any) {
  dialog.warning({ title: t('cfTunnels.deletePublicTitle'), content: t('cfTunnels.deleteConfirm', { item: row.hostname + (row.path ? ' [' + row.path + ']' : '') }), positiveText: t('common.delete'), negativeText: t('common.cancel'), onPositiveClick: async () => {
    const q = `hostname=${encodeURIComponent(row.hostname)}&path=${encodeURIComponent(row.path || '')}`;
    const res = await api('DELETE', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/public-hostnames?${q}`);
    if (res.code === 0) { message.success(res.msg); loadPublic(); } else message.error(res.msg);
  } });
}

function openCidr(row: any) {
  currentTunnelId.value = row.id;
  currentTunnelName.value = row.name;
  Object.assign(cidrForm, { network: '', comment: '' });
  showCidr.value = true;
  loadCidr();
}

async function loadCidr() {
  cidrLoadBusy.value = true;
  const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/cidr-routes`);
  cidrRows.value = res.code === 0 ? res.data : [];
  if (res.code !== 0) message.error(res.msg);
  cidrLoadBusy.value = false;
}

async function saveCidr() {
  if (!cidrForm.network.trim()) return message.warning(t('cfTunnels.cidrRequired'));
  cidrLoadBusy.value = true;
  const res = await api('POST', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/cidr-routes`, { ...cidrForm });
  cidrLoadBusy.value = false;
  if (res.code === 0) { message.success(res.msg); Object.assign(cidrForm, { network: '', comment: '' }); loadCidr(); } else message.error(res.msg);
}

function delCidr(row: any) {
  dialog.warning({ title: t('cfTunnels.deleteCidrTitle'), content: t('cfTunnels.deleteConfirm', { item: row.network }), positiveText: t('common.delete'), negativeText: t('common.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/cidr-routes/${row.id}`);
    if (res.code === 0) { message.success(res.msg); loadCidr(); } else message.error(res.msg);
  } });
}

function openRoute(row: any) {
  currentTunnelId.value = row.id;
  currentTunnelName.value = row.name;
  Object.assign(routeForm, { hostname: '', comment: '' });
  showRoute.value = true;
  loadRoute();
}

async function loadRoute() {
  routeLoadBusy.value = true;
  const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/hostname-routes`);
  routeRows.value = res.code === 0 ? res.data : [];
  if (res.code !== 0) message.error(res.msg);
  routeLoadBusy.value = false;
}

async function saveRoute() {
  if (!routeForm.hostname.trim()) return message.warning(t('cfTunnels.hostnameRequired'));
  routeLoadBusy.value = true;
  const res = await api('POST', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/hostname-routes`, { ...routeForm });
  routeLoadBusy.value = false;
  if (res.code === 0) { message.success(res.msg); Object.assign(routeForm, { hostname: '', comment: '' }); loadRoute(); } else message.error(res.msg);
}

function delRoute(row: any) {
  dialog.warning({ title: t('cfTunnels.deleteRouteTitle'), content: t('cfTunnels.deleteConfirm', { item: row.hostname }), positiveText: t('common.delete'), negativeText: t('common.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/hostname-routes/${row.id}`);
    if (res.code === 0) { message.success(res.msg); loadRoute(); } else message.error(res.msg);
  } });
}

onMounted(load);
</script>