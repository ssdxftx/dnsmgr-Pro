<template>
  <div class="app-stack">
    <template v-if="section === 'multipath'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.gateways') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" type="primary" @click="createGateway">{{ t('cdnPlatform.createGateway') }}</n-button>
            <n-button size="small" :loading="loading.gateways" :disabled="loading.gateways" @click="loadGateways">{{ t('cdnPlatform.refresh') }}</n-button>
          </div>
        </div>
        <ResponsiveDataTable :columns="gatewayColumns" :data="gateways" size="small" :loading="loading.gateways" :empty-text="t('cdnPlatform.gatewayEmpty')" />
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.gatewayRegions') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="loading.regions" :disabled="loading.regions" @click="loadRegions">{{ t('cdnPlatform.load') }}</n-button>
          </div>
        </div>
        <pre v-if="regionsText" class="code-view">{{ regionsText }}</pre>
        <span v-else class="hint-text">{{ t('cdnPlatform.empty') }}</span>
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.secretKey') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="loading.secret" :disabled="loading.secret" @click="loadSecretKey">{{ t('cdnPlatform.load') }}</n-button>
            <n-button size="small" :loading="loading.secretCreate" :disabled="loading.secretCreate" @click="createSecretKey">{{ t('cdnPlatform.create') }}</n-button>
            <n-button size="small" type="primary" :loading="loading.secretSave" :disabled="loading.secretSave || !secretKeyText.trim()" @click="saveSecretKey">{{ t('cdnPlatform.save') }}</n-button>
            <n-button size="small" type="warning" :loading="loading.secretRefresh" :disabled="loading.secretRefresh" @click="refreshSecretKey">{{ t('cdnPlatform.refresh') }}</n-button>
          </div>
        </div>
        <n-input v-model:value="secretKeyText" type="textarea" :rows="3" :placeholder="t('cdnPlatform.secretKeyHint')" class="mono-input" spellcheck="false" />
      </div>
    </template>

    <template v-else-if="section === 'inference'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.inferenceServices') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" type="primary" @click="createInferenceService">{{ t('cdnPlatform.createService') }}</n-button>
            <n-button size="small" :loading="loading.services" :disabled="loading.services" @click="loadInferenceServices">{{ t('cdnPlatform.refresh') }}</n-button>
          </div>
        </div>
        <ResponsiveDataTable :columns="serviceColumns" :data="services" size="small" :loading="loading.services" :empty-text="t('cdnPlatform.inferenceEmpty')" />
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.deploymentRecords') }}</h3>
          <div class="app-panel__extra">
            <n-input v-model:value="recordServiceId" :placeholder="t('cdnPlatform.serviceIdHint')" size="small" style="width: 220px" />
            <n-button size="small" :loading="loading.records" :disabled="loading.records || !recordServiceId.trim()" @click="loadRecords">{{ t('cdnPlatform.load') }}</n-button>
          </div>
        </div>
        <ResponsiveDataTable :columns="recordColumns" :data="records" size="small" :loading="loading.records" :empty-text="t('cdnPlatform.recordEmpty')" />
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.monitor') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="loading.monitor" :disabled="loading.monitor" @click="queryMonitor">{{ t('cdnPlatform.query') }}</n-button>
          </div>
        </div>
        <n-input v-model:value="monitorJson" type="textarea" :rows="6" :placeholder="t('cdnPlatform.monitorHint')" class="mono-input" spellcheck="false" />
        <pre v-if="monitorText" class="code-view" style="margin-top: 8px">{{ monitorText }}</pre>
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.inferenceTokens') }}</h3>
          <div class="app-panel__extra">
            <n-input v-model:value="tokenName" :placeholder="t('cdnPlatform.tokenName')" size="small" style="width: 200px" />
            <n-button size="small" type="primary" :loading="loading.tokenCreate" :disabled="loading.tokenCreate || !tokenName.trim()" @click="createToken">{{ t('cdnPlatform.create') }}</n-button>
            <n-button size="small" :loading="loading.tokens" :disabled="loading.tokens" @click="loadTokens">{{ t('cdnPlatform.refresh') }}</n-button>
          </div>
        </div>
        <pre v-if="tokenContent" class="code-view" style="margin-bottom: 8px">{{ tokenContent }}</pre>
        <ResponsiveDataTable :columns="tokenColumns" :data="tokens" size="small" :loading="loading.tokens" :empty-text="t('cdnPlatform.tokenEmpty')" />
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.inferenceDomains') }}</h3>
          <div class="app-panel__extra">
            <n-input v-model:value="domainServiceId" :placeholder="t('cdnPlatform.serviceIdHint')" size="small" style="width: 220px" />
            <n-button size="small" :loading="loading.domains" :disabled="loading.domains || !domainServiceId.trim()" @click="loadDomains">{{ t('cdnPlatform.load') }}</n-button>
            <n-button size="small" type="primary" :disabled="!domainServiceId.trim()" @click="createDomain">{{ t('cdnPlatform.create') }}</n-button>
          </div>
        </div>
        <ResponsiveDataTable :columns="domainColumns" :data="domains" size="small" :loading="loading.domains" :empty-text="t('cdnPlatform.domainEmpty')" />
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.hardware') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="loading.hardware" :disabled="loading.hardware" @click="loadHardware">{{ t('cdnPlatform.load') }}</n-button>
          </div>
        </div>
        <pre v-if="hardwareText" class="code-view">{{ hardwareText }}</pre>
        <span v-else class="hint-text">{{ t('cdnPlatform.empty') }}</span>
      </div>
    </template>

    <template v-else-if="section === 'media'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.transcodeTemplates') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" type="primary" @click="createTranscodeTemplate">{{ t('cdnPlatform.create') }}</n-button>
            <n-button size="small" :loading="loading.templates" :disabled="loading.templates" @click="loadTranscodeTemplates">{{ t('cdnPlatform.refresh') }}</n-button>
          </div>
        </div>
        <span class="hint-text">{{ t('cdnPlatform.transcodeUrlHint') }}</span>
        <ResponsiveDataTable :columns="transcodeColumns" :data="templates" size="small" :loading="loading.templates" :empty-text="t('cdnPlatform.transcodeEmpty')" />
      </div>
    </template>

    <template v-else-if="section === 'billing'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.plans') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="loading.plans" :disabled="loading.plans" @click="loadPlans">{{ t('cdnPlatform.refresh') }}</n-button>
            <n-button size="small" @click="createPlanForZone">{{ t('cdnPlatform.sitePlan') }}</n-button>
            <n-button size="small" type="primary" @click="createPlan">{{ t('cdnPlatform.buyPlan') }}</n-button>
          </div>
        </div>
        <ResponsiveDataTable :columns="planColumns" :data="plans" size="small" :loading="loading.plans" :empty-text="t('cdnPlatform.planEmpty')" />
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.availablePlans') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="loading.available" :disabled="loading.available" @click="loadAvailablePlans">{{ t('cdnPlatform.load') }}</n-button>
          </div>
        </div>
        <pre v-if="availableText" class="code-view">{{ availableText }}</pre>
        <span v-else class="hint-text">{{ t('cdnPlatform.empty') }}</span>
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnPlatform.billingData') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="loading.billing" :disabled="loading.billing" @click="queryBilling">{{ t('cdnPlatform.query') }}</n-button>
          </div>
        </div>
        <n-input v-model:value="billingJson" type="textarea" :rows="7" :placeholder="t('cdnPlatform.billingHint')" class="mono-input" spellcheck="false" />
        <pre v-if="billingText" class="code-view" style="margin-top: 8px">{{ billingText }}</pre>
      </div>
    </template>

    <n-modal v-model:show="jsonModal.show" preset="card" :title="jsonModal.title" style="width: min(720px, 94vw)">
      <span class="hint-text">{{ jsonModal.hint }}</span>
      <n-input v-model:value="jsonModal.text" type="textarea" :rows="14" class="mono-input" spellcheck="false" style="margin-top: 8px" />
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 8px">
          <n-button size="small" @click="jsonModal.show = false">{{ t('cdnPlatform.cancel') }}</n-button>
          <n-button size="small" type="primary" :loading="jsonModal.saving" :disabled="jsonModal.saving" @click="submitJson">{{ t('cdnPlatform.save') }}</n-button>
        </div>
      </template>
    </n-modal>

    <n-drawer v-model:show="detail.show" placement="right" width="min(760px, 94vw)">
      <n-drawer-content closable :native-scrollbar="false" :title="detail.title">
        <pre class="code-view">{{ detail.text }}</pre>
      </n-drawer-content>
    </n-drawer>

    <n-drawer v-model:show="gatewayDrawer.show" placement="right" width="min(960px, 96vw)">
      <n-drawer-content closable :native-scrollbar="false" :title="gatewayDrawer.title">
        <div class="app-panel">
          <div class="app-panel__head">
            <h3 class="app-panel__title">{{ t('cdnPlatform.gatewayLines') }}</h3>
            <div class="app-panel__extra">
              <n-button size="small" type="primary" @click="createLine">{{ t('cdnPlatform.create') }}</n-button>
              <n-button size="small" :loading="gatewayDrawer.loading" :disabled="gatewayDrawer.loading" @click="loadGatewayDetail(gatewayDrawer.id)">{{ t('cdnPlatform.refresh') }}</n-button>
            </div>
          </div>
          <ResponsiveDataTable :columns="lineColumns" :data="gatewayDrawer.lines" size="small" :loading="gatewayDrawer.loading" :empty-text="t('cdnPlatform.lineEmpty')" />
        </div>
        <div class="app-panel">
          <div class="app-panel__head">
            <h3 class="app-panel__title">{{ t('cdnPlatform.originAcl') }}</h3>
            <div class="app-panel__extra">
              <n-input-number v-model:value="gatewayDrawer.aclVersion" :min="1" :placeholder="t('cdnPlatform.aclVersion')" size="small" style="width: 160px" />
              <n-button size="small" type="primary" :loading="gatewayDrawer.aclSaving" :disabled="gatewayDrawer.aclSaving || !gatewayDrawer.aclVersion" @click="confirmOriginAcl">{{ t('cdnPlatform.confirm') }}</n-button>
              <n-button size="small" :loading="gatewayDrawer.aclLoading" :disabled="gatewayDrawer.aclLoading" @click="loadOriginAcl">{{ t('cdnPlatform.load') }}</n-button>
            </div>
          </div>
          <pre v-if="gatewayDrawer.aclText" class="code-view">{{ gatewayDrawer.aclText }}</pre>
          <span v-else class="hint-text">{{ t('cdnPlatform.empty') }}</span>
        </div>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useDialog, useMessage, NButton, NTag } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import { toIsoDateTime } from '../../lib/datetime';

const props = defineProps<{ aid: number; zoneId: string; section: string }>();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const loading = reactive<Record<string, boolean>>({});
const jsonModal = reactive({
  show: false,
  title: '',
  hint: '',
  text: '',
  saving: false,
  handler: null as null | ((value: any) => Promise<boolean | void>),
});
const detail = reactive({ show: false, title: '', text: '' });

const base = computed(() => `/cdn/accounts/${props.aid}`);

async function call(method: string, path: string, payload?: Record<string, any>): Promise<any | null> {
  let res: any;
  try {
    res = await api<any>(method, `${base.value}${path}`, payload);
  } catch (e: any) {
    message.error(e?.message || t('cdnPlatform.requestFailed'));
    return null;
  }
  if (res.code !== 0) {
    message.error(res.msg);
    return null;
  }
  return res.data;
}

function clean(value: any): any {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === '' || item === null || item === undefined) continue;
      out[key] = clean(item);
    }
    return out;
  }
  return value;
}

function openJson(title: string, hint: string, value: any, handler: (v: any) => Promise<boolean | void>) {
  jsonModal.title = title;
  jsonModal.hint = hint;
  jsonModal.text = JSON.stringify(value, null, 2);
  jsonModal.handler = handler;
  jsonModal.show = true;
}

async function submitJson() {
  if (!jsonModal.handler) return;
  let parsed: any;
  try {
    parsed = JSON.parse(jsonModal.text);
  } catch {
    message.error(t('cdnPlatform.invalidJson'));
    return;
  }
  jsonModal.saving = true;
  try {
    const ok = await jsonModal.handler(parsed);
    if (ok !== false) jsonModal.show = false;
  } finally {
    jsonModal.saving = false;
  }
}

function openDetail(title: string, data: any) {
  detail.title = title;
  detail.text = JSON.stringify(data, null, 2);
  detail.show = true;
}

const gateways = ref<any[]>([]);
const regionsText = ref('');
const secretKeyText = ref('');
const gatewayDrawer = reactive({
  show: false,
  id: '',
  title: '',
  lines: [] as any[],
  loading: false,
  aclText: '',
  aclLoading: false,
  aclVersion: null as number | null,
  aclSaving: false,
});

async function loadGateways() {
  loading.gateways = true;
  try {
    const data = await call('GET', `/multipath/gateways`, { zoneId: props.zoneId, page: 1, size: 100 });
    gateways.value = data?.list || [];
  } finally {
    loading.gateways = false;
  }
}

async function loadRegions() {
  loading.regions = true;
  try {
    const data = await call('GET', `/multipath/regions`, { zoneId: props.zoneId });
    if (data) regionsText.value = JSON.stringify(data, null, 2);
  } finally {
    loading.regions = false;
  }
}

async function loadSecretKey() {
  loading.secret = true;
  try {
    const data = await call('GET', `/multipath/secret-key`, { zoneId: props.zoneId });
    if (data) secretKeyText.value = String(data);
  } finally {
    loading.secret = false;
  }
}

function createGateway() {
  openJson(t('cdnPlatform.createGateway'), t('cdnPlatform.gatewayHint'), { GatewayType: 'cloud', GatewayName: '', GatewayPort: 443, RegionId: '' }, async (v) => {
    const data = await call('POST', `/multipath/gateways`, { zoneId: props.zoneId, params: clean(v) });
    if (!data) return false;
    message.success(t('cdnPlatform.created'));
    await loadGateways();
  });
}

function editGateway(row: any) {
  const value: Record<string, any> = { GatewayName: row.GatewayName || '' };
  if (String(row.GatewayType) === 'private') {
    value.GatewayIP = row.GatewayIP || '';
    value.GatewayPort = row.GatewayPort || 443;
  }
  openJson(t('cdnPlatform.editGateway'), t('cdnPlatform.gatewayEditHint'), value, async (v) => {
    const data = await call('PUT', `/multipath/gateways/${encodeURIComponent(String(row.GatewayId))}`, { zoneId: props.zoneId, params: clean(v) });
    if (data === null) return false;
    message.success(t('cdnPlatform.updated'));
    await loadGateways();
  });
}

async function toggleGateway(row: any) {
  const status = String(row.Status) === 'online' ? 'offline' : 'online';
  const data = await call('POST', `/multipath/gateways/${encodeURIComponent(String(row.GatewayId))}/status`, { zoneId: props.zoneId, GatewayStatus: status });
  if (data !== null) {
    message.success(t('cdnPlatform.updated'));
    await loadGateways();
  }
}

function deleteGateway(row: any) {
  dialog.warning({
    title: t('cdnPlatform.delete'),
    content: `${row.GatewayName || row.GatewayId}`,
    positiveText: t('cdnPlatform.delete'),
    negativeText: t('cdnPlatform.cancel'),
    onPositiveClick: async () => {
      const data = await call('DELETE', `/multipath/gateways/${encodeURIComponent(String(row.GatewayId))}?zoneId=${encodeURIComponent(props.zoneId)}`);
      if (data !== null) {
        message.success(t('cdnPlatform.deleted'));
        await loadGateways();
      }
    },
  });
}

async function openGateway(row: any) {
  gatewayDrawer.id = String(row.GatewayId || '');
  gatewayDrawer.title = `${t('cdnPlatform.gatewayDetail')} · ${row.GatewayName || gatewayDrawer.id}`;
  gatewayDrawer.lines = [];
  gatewayDrawer.aclText = '';
  gatewayDrawer.aclVersion = null;
  gatewayDrawer.show = true;
  await loadGatewayDetail(gatewayDrawer.id);
}

async function loadGatewayDetail(gatewayId: string) {
  if (!gatewayId) return;
  gatewayDrawer.loading = true;
  try {
    const data = await call('GET', `/multipath/gateways/${encodeURIComponent(gatewayId)}`, { zoneId: props.zoneId });
    gatewayDrawer.lines = data?.Lines || [];
  } finally {
    gatewayDrawer.loading = false;
  }
}

function createLine() {
  openJson(t('cdnPlatform.createLine'), t('cdnPlatform.lineHint'), { LineType: 'custom', LineAddress: '' }, async (v) => {
    const data = await call('POST', `/multipath/gateways/${encodeURIComponent(gatewayDrawer.id)}/lines`, { zoneId: props.zoneId, params: clean(v) });
    if (!data) return false;
    message.success(t('cdnPlatform.created'));
    await loadGatewayDetail(gatewayDrawer.id);
  });
}

function editLine(row: any) {
  openJson(t('cdnPlatform.editLine'), t('cdnPlatform.lineHint'), {
    LineType: row.LineType || 'custom',
    LineAddress: row.LineAddress || '',
    ProxyId: row.ProxyId || '',
    RuleId: row.RuleId || '',
  }, async (v) => {
    const data = await call('PUT', `/multipath/gateways/${encodeURIComponent(gatewayDrawer.id)}/lines/${encodeURIComponent(String(row.LineId))}`, { zoneId: props.zoneId, params: clean(v) });
    if (data === null) return false;
    message.success(t('cdnPlatform.updated'));
    await loadGatewayDetail(gatewayDrawer.id);
  });
}

function deleteLine(row: any) {
  dialog.warning({
    title: t('cdnPlatform.delete'),
    content: String(row.LineId || ''),
    positiveText: t('cdnPlatform.delete'),
    negativeText: t('cdnPlatform.cancel'),
    onPositiveClick: async () => {
      const data = await call('DELETE', `/multipath/gateways/${encodeURIComponent(gatewayDrawer.id)}/lines/${encodeURIComponent(String(row.LineId))}?zoneId=${encodeURIComponent(props.zoneId)}`);
      if (data !== null) {
        message.success(t('cdnPlatform.deleted'));
        await loadGatewayDetail(gatewayDrawer.id);
      }
    },
  });
}

async function loadOriginAcl() {
  gatewayDrawer.aclLoading = true;
  try {
    const data = await call('GET', `/multipath/gateways/${encodeURIComponent(gatewayDrawer.id)}/origin-acl`, { zoneId: props.zoneId });
    if (data) gatewayDrawer.aclText = JSON.stringify(data, null, 2);
  } finally {
    gatewayDrawer.aclLoading = false;
  }
}

async function confirmOriginAcl() {
  if (!gatewayDrawer.aclVersion) return;
  gatewayDrawer.aclSaving = true;
  try {
    const data = await call('POST', `/multipath/gateways/${encodeURIComponent(gatewayDrawer.id)}/origin-acl/confirm`, { zoneId: props.zoneId, OriginACLVersion: gatewayDrawer.aclVersion });
    if (data !== null) {
      message.success(t('cdnPlatform.confirmed'));
      await loadOriginAcl();
    }
  } finally {
    gatewayDrawer.aclSaving = false;
  }
}

async function createSecretKey() {
  loading.secretCreate = true;
  try {
    const data = await call('POST', `/multipath/secret-key`, { zoneId: props.zoneId });
    if (data !== null) {
      message.success(t('cdnPlatform.created'));
      await loadSecretKey();
    }
  } finally {
    loading.secretCreate = false;
  }
}

async function saveSecretKey() {
  loading.secretSave = true;
  try {
    const data = await call('PUT', `/multipath/secret-key`, { zoneId: props.zoneId, SecretKey: secretKeyText.value.trim() });
    if (data !== null) message.success(t('cdnPlatform.updated'));
  } finally {
    loading.secretSave = false;
  }
}

function refreshSecretKey() {
  dialog.warning({
    title: t('cdnPlatform.refreshSecretKey'),
    content: t('cdnPlatform.refreshSecretHint'),
    positiveText: t('cdnPlatform.confirm'),
    negativeText: t('cdnPlatform.cancel'),
    onPositiveClick: async () => {
      loading.secretRefresh = true;
      try {
        const data = await call('POST', `/multipath/secret-key/refresh`, { zoneId: props.zoneId });
        if (data !== null) {
          message.success(t('cdnPlatform.confirmed'));
          await loadSecretKey();
        }
      } finally {
        loading.secretRefresh = false;
      }
    },
  });
}

const gatewayColumns = computed(() => [
  { title: t('cdnPlatform.gatewayName'), key: 'GatewayName', minWidth: 150 },
  { title: t('cdnPlatform.gatewayType'), key: 'GatewayType', width: 110 },
  {
    title: t('cdnPlatform.status'),
    key: 'Status',
    width: 110,
    render: (r: any) => h(NTag, { size: 'small', type: r.Status === 'online' ? 'success' : 'default' }, { default: () => String(r.Status || '-') }),
  },
  { title: t('cdnPlatform.gatewayAddress'), key: 'GatewayIP', minWidth: 160, render: (r: any) => r.GatewayIP || r.RegionId || '-' },
  { title: t('cdnPlatform.gatewayPort'), key: 'GatewayPort', width: 100 },
  {
    title: t('cdnPlatform.actions'),
    key: 'actions',
    width: 360,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openGateway(r) }, { default: () => t('cdnPlatform.detail') }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => toggleGateway(r) }, { default: () => (r.Status === 'online' ? t('cdnPlatform.stop') : t('cdnPlatform.start')) }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => editGateway(r) }, { default: () => t('cdnPlatform.edit') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => deleteGateway(r) }, { default: () => t('cdnPlatform.delete') }),
    ]),
  },
]);

const lineColumns = computed(() => [
  { title: 'LineId', key: 'LineId', minWidth: 120 },
  { title: 'LineType', key: 'LineType', width: 100 },
  { title: 'LineAddress', key: 'LineAddress', minWidth: 180 },
  { title: 'ProxyId', key: 'ProxyId', minWidth: 140 },
  { title: 'RuleId', key: 'RuleId', minWidth: 120 },
  {
    title: t('cdnPlatform.actions'),
    key: 'actions',
    width: 160,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      ...(String(r.LineType) === 'direct' ? [] : [h(NButton, { size: 'tiny', quaternary: true, onClick: () => editLine(r) }, { default: () => t('cdnPlatform.edit') })]),
      ...(String(r.LineType) === 'custom' ? [h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => deleteLine(r) }, { default: () => t('cdnPlatform.delete') })] : []),
    ]),
  },
]);

const services = ref<any[]>([]);
const records = ref<any[]>([]);
const recordServiceId = ref('');
function defaultMonitorParams() {
  const end = new Date();
  const start = new Date(end.getTime() - 3600 * 1000);
  return {
    ServiceIds: [],
    MetricNames: ['cpu_usage_average', 'gpu_usage_average'],
    StartTime: toIsoDateTime(start) || '',
    EndTime: toIsoDateTime(end) || '',
    Interval: '5min',
  };
}

const monitorJson = ref(JSON.stringify(defaultMonitorParams(), null, 2));
const monitorText = ref('');
const tokenName = ref('');
const tokenContent = ref('');
const tokens = ref<any[]>([]);
const domainServiceId = ref('');
const domains = ref<any[]>([]);
const hardwareText = ref('');

async function loadInferenceServices() {
  loading.services = true;
  try {
    const data = await call('GET', `/inference/services`, { zoneId: props.zoneId, page: 1, size: 100 });
    services.value = data?.list || [];
  } finally {
    loading.services = false;
  }
}

function createInferenceService() {
  openJson(t('cdnPlatform.createService'), t('cdnPlatform.serviceHint'), {
    Name: '',
    ListenPort: 8080,
    Containers: [{
      ImageType: 'TCR',
      TcrRepositoryConfig: { TCRType: 'Personal', Image: '', RegionName: '' },
      StartupCommand: '',
      EnvironmentVariables: [],
    }],
    ResourceConfig: {
      ScalingMode: 'Manual',
      HardwareSpecId: '',
      ManualInstanceConfig: { FixedInstanceCount: 1 },
      Concurrency: 1,
    },
    RequestPaths: ['/'],
    Description: '',
  }, async (v) => {
    const data = await call('POST', `/inference/services`, { zoneId: props.zoneId, params: clean(v) });
    if (!data) return false;
    message.success(t('cdnPlatform.created'));
    await loadInferenceServices();
  });
}

function editInferenceService(row: any) {
  const editable: Record<string, any> = {};
  for (const key of ['ListenPort', 'RequestPaths', 'Containers', 'AffinityConfig', 'Description']) {
    if (row[key] !== undefined) editable[key] = row[key];
  }
  if (row.ResourceConfig && typeof row.ResourceConfig === 'object') {
    const resource: Record<string, any> = {};
    for (const key of ['ScalingMode', 'AutoScalingConfig', 'ManualInstanceConfig', 'Concurrency']) {
      if (row.ResourceConfig[key] !== undefined) resource[key] = row.ResourceConfig[key];
    }
    if (row.ResourceConfig.HardwareConfig && typeof row.ResourceConfig.HardwareConfig === 'object') {
      const hardware: Record<string, any> = {};
      for (const key of ['CPUNum', 'MemSize', 'DiskSize']) {
        if (row.ResourceConfig.HardwareConfig[key] !== undefined) hardware[key] = row.ResourceConfig.HardwareConfig[key];
      }
      if (Object.keys(hardware).length) resource.HardwareConfig = hardware;
    }
    if (Object.keys(resource).length) editable.ResourceConfig = resource;
  }
  openJson(t('cdnPlatform.editService'), t('cdnPlatform.serviceEditHint'), editable, async (v) => {
    const data = await call('PUT', `/inference/services/${encodeURIComponent(String(row.ServiceId))}`, { zoneId: props.zoneId, params: clean(v) });
    if (data === null) return false;
    message.success(t('cdnPlatform.updated'));
    await loadInferenceServices();
  });
}

async function operateService(row: any, operation: string) {
  if (operation === 'Delete') {
    const ok = await new Promise<boolean>((resolve) => {
      dialog.warning({
        title: t('cdnPlatform.delete'),
        content: String(row.Name || row.ServiceId || ''),
        positiveText: t('cdnPlatform.delete'),
        negativeText: t('cdnPlatform.cancel'),
        onPositiveClick: () => resolve(true),
        onNegativeClick: () => resolve(false),
        onMaskClick: () => resolve(false),
      });
    });
    if (!ok) return;
  }
  const data = await call('POST', `/inference/services/${encodeURIComponent(String(row.ServiceId))}/operate`, { zoneId: props.zoneId, operation });
  if (data !== null) {
    message.success(t('cdnPlatform.updated'));
    await loadInferenceServices();
  }
}

async function loadRecords() {
  if (!recordServiceId.value.trim()) return;
  loading.records = true;
  try {
    const data = await call('GET', `/inference/services/${encodeURIComponent(recordServiceId.value.trim())}/records`, { zoneId: props.zoneId, page: 1, size: 100 });
    records.value = data?.list || [];
  } finally {
    loading.records = false;
  }
}

async function openRecordLogs(row: any) {
  const data = await call('GET', `/inference/services/${encodeURIComponent(recordServiceId.value.trim())}/records/${encodeURIComponent(String(row.RecordId || row.Id || ''))}/logs`, { zoneId: props.zoneId, page: 1, size: 200 });
  if (data) openDetail(t('cdnPlatform.deploymentLogs'), data.list || []);
}

async function queryMonitor() {
  let parsed: any;
  try {
    parsed = JSON.parse(monitorJson.value);
  } catch {
    message.error(t('cdnPlatform.invalidJson'));
    return;
  }
  if (!Array.isArray(parsed.ServiceIds) || !parsed.ServiceIds.length) {
    message.warning(t('cdnPlatform.serviceIdsRequired'));
    return;
  }
  if (!Array.isArray(parsed.MetricNames) || !parsed.MetricNames.length) {
    message.warning(t('cdnPlatform.metricNamesRequired'));
    return;
  }
  loading.monitor = true;
  try {
    const data = await call('POST', `/inference/monitor`, { zoneId: props.zoneId, params: parsed });
    if (data) monitorText.value = JSON.stringify(data, null, 2);
  } finally {
    loading.monitor = false;
  }
}

async function loadTokens() {
  loading.tokens = true;
  try {
    const data = await call('GET', `/inference/tokens`, { zoneId: props.zoneId, page: 1, size: 100 });
    tokens.value = data?.list || [];
  } finally {
    loading.tokens = false;
  }
}

async function createToken() {
  loading.tokenCreate = true;
  try {
    const data = await call('POST', `/inference/tokens`, { zoneId: props.zoneId, Name: tokenName.value.trim() });
    if (data) {
      tokenContent.value = JSON.stringify(data, null, 2);
      tokenName.value = '';
      message.success(t('cdnPlatform.created'));
      await loadTokens();
    }
  } finally {
    loading.tokenCreate = false;
  }
}

function deleteToken(row: any) {
  dialog.warning({
    title: t('cdnPlatform.delete'),
    content: String(row.Name || row.TokenId || ''),
    positiveText: t('cdnPlatform.delete'),
    negativeText: t('cdnPlatform.cancel'),
    onPositiveClick: async () => {
      const data = await call('DELETE', `/inference/tokens/${encodeURIComponent(String(row.TokenId))}?zoneId=${encodeURIComponent(props.zoneId)}`);
      if (data !== null) {
        message.success(t('cdnPlatform.deleted'));
        await loadTokens();
      }
    },
  });
}

async function loadDomains() {
  if (!domainServiceId.value.trim()) return;
  loading.domains = true;
  try {
    const data = await call('GET', `/inference/domains`, { zoneId: props.zoneId, serviceId: domainServiceId.value.trim(), page: 1, size: 100 });
    domains.value = data?.list || [];
  } finally {
    loading.domains = false;
  }
}

function createDomain() {
  openJson(t('cdnPlatform.createDomain'), t('cdnPlatform.domainHint'), {
    ServiceId: domainServiceId.value.trim(),
    Domain: '',
    AuthSwitch: 'On',
  }, async (v) => {
    const data = await call('POST', `/inference/domains`, { zoneId: props.zoneId, params: clean(v) });
    if (data === null) return false;
    message.success(t('cdnPlatform.created'));
    await loadDomains();
  });
}

async function operateDomain(row: any, operation: string) {
  if (operation === 'Delete') {
    const ok = await new Promise<boolean>((resolve) => {
      dialog.warning({
        title: t('cdnPlatform.delete'),
        content: String(row.Domain || ''),
        positiveText: t('cdnPlatform.delete'),
        negativeText: t('cdnPlatform.cancel'),
        onPositiveClick: () => resolve(true),
        onNegativeClick: () => resolve(false),
        onMaskClick: () => resolve(false),
      });
    });
    if (!ok) return;
  }
  const data = await call('POST', `/inference/domains/operate`, { zoneId: props.zoneId, params: { ServiceId: domainServiceId.value.trim(), Domain: row.Domain, Operation: operation } });
  if (data !== null) {
    message.success(t('cdnPlatform.updated'));
    await loadDomains();
  }
}

async function loadHardware() {
  loading.hardware = true;
  try {
    const data = await call('GET', `/inference/hardware`, { zoneId: props.zoneId });
    if (data) hardwareText.value = JSON.stringify(data, null, 2);
  } finally {
    loading.hardware = false;
  }
}

const serviceColumns = computed(() => [
  { title: 'Name', key: 'Name', minWidth: 150 },
  {
    title: t('cdnPlatform.status'),
    key: 'Status',
    width: 120,
    render: (r: any) => h(NTag, { size: 'small', type: r.Status === 'Running' ? 'success' : 'default' }, { default: () => String(r.Status || '-') }),
  },
  { title: 'ListenPort', key: 'ListenPort', width: 110 },
  { title: t('cdnPlatform.instances'), key: 'CurrentInstanceCount', width: 100 },
  { title: 'InferenceURL', key: 'InferenceURL', minWidth: 220 },
  {
    title: t('cdnPlatform.actions'),
    key: 'actions',
    width: 420,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => editInferenceService(r) }, { default: () => t('cdnPlatform.edit') }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => operateService(r, 'Resume') }, { default: () => t('cdnPlatform.start') }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => operateService(r, 'Stop') }, { default: () => t('cdnPlatform.stop') }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => { recordServiceId.value = String(r.ServiceId || ''); loadRecords(); } }, { default: () => t('cdnPlatform.records') }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => { domainServiceId.value = String(r.ServiceId || ''); loadDomains(); } }, { default: () => t('cdnPlatform.domains') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => operateService(r, 'Delete') }, { default: () => t('cdnPlatform.delete') }),
    ]),
  },
]);

const recordColumns = computed(() => [
  { title: 'RecordId', key: 'RecordId', minWidth: 160 },
  { title: 'Status', key: 'Status', width: 120 },
  { title: 'CreateTime', key: 'CreateTime', minWidth: 180 },
  {
    title: t('cdnPlatform.actions'),
    key: 'actions',
    width: 140,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openRecordLogs(r) }, { default: () => t('cdnPlatform.logs') }),
    ]),
  },
]);

const tokenColumns = computed(() => [
  { title: 'Name', key: 'Name', minWidth: 160 },
  { title: 'TokenId', key: 'TokenId', minWidth: 200 },
  { title: 'CreateTime', key: 'CreateTime', minWidth: 180 },
  {
    title: t('cdnPlatform.actions'),
    key: 'actions',
    width: 120,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => deleteToken(r) }, { default: () => t('cdnPlatform.delete') }),
    ]),
  },
]);

const domainColumns = computed(() => [
  { title: 'Domain', key: 'Domain', minWidth: 200 },
  { title: 'Status', key: 'Status', width: 120 },
  { title: 'AuthSwitch', key: 'AuthSwitch', width: 110 },
  { title: 'Cname', key: 'Cname', minWidth: 200 },
  {
    title: t('cdnPlatform.actions'),
    key: 'actions',
    width: 240,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => operateDomain(r, 'Resume') }, { default: () => t('cdnPlatform.start') }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => operateDomain(r, 'Stop') }, { default: () => t('cdnPlatform.stop') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => operateDomain(r, 'Delete') }, { default: () => t('cdnPlatform.delete') }),
    ]),
  },
]);

const templates = ref<any[]>([]);

async function loadTranscodeTemplates() {
  loading.templates = true;
  try {
    const data = await call('GET', `/media/transcode-templates`, { zoneId: props.zoneId, page: 1, size: 100 });
    templates.value = data?.list || [];
  } finally {
    loading.templates = false;
  }
}

function createTranscodeTemplate() {
  openJson(t('cdnPlatform.createTranscode'), t('cdnPlatform.transcodeHint'), {
    TemplateName: '',
    Comment: '',
    VideoStreamSwitch: 'on',
    AudioStreamSwitch: 'on',
    VideoTemplate: { Codec: 'H.264', Bitrate: 2000, Width: 1280, Height: 720, Fps: 25, ResolutionAdaptive: 'open', FillType: 'black' },
    AudioTemplate: { Codec: 'libfdk_aac', AudioChannel: 2 },
  }, async (v) => {
    const data = await call('POST', `/media/transcode-templates`, { zoneId: props.zoneId, params: clean(v) });
    if (!data) return false;
    message.success(t('cdnPlatform.created'));
    await loadTranscodeTemplates();
  });
}

function deleteTranscodeTemplate(row: any) {
  dialog.warning({
    title: t('cdnPlatform.delete'),
    content: String(row.TemplateName || row.TemplateId || ''),
    positiveText: t('cdnPlatform.delete'),
    negativeText: t('cdnPlatform.cancel'),
    onPositiveClick: async () => {
      const data = await call('DELETE', `/media/transcode-templates`, { zoneId: props.zoneId, TemplateIds: [String(row.TemplateId)] });
      if (data !== null) {
        message.success(t('cdnPlatform.deleted'));
        await loadTranscodeTemplates();
      }
    },
  });
}

const transcodeColumns = computed(() => [
  { title: 'TemplateName', key: 'TemplateName', minWidth: 200 },
  { title: 'Type', key: 'Type', width: 100 },
  { title: 'TemplateId', key: 'TemplateId', minWidth: 180 },
  { title: 'VideoStreamSwitch', key: 'VideoStreamSwitch', width: 140 },
  { title: 'AudioStreamSwitch', key: 'AudioStreamSwitch', width: 140 },
  {
    title: t('cdnPlatform.actions'),
    key: 'actions',
    width: 120,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => deleteTranscodeTemplate(r) }, { default: () => t('cdnPlatform.delete') }),
    ]),
  },
]);

const plans = ref<any[]>([]);
const availableText = ref('');
const billingText = ref('');
const billingJson = ref('');

function defaultBillingParams() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  return {
    StartTime: toIsoDateTime(start) || '',
    EndTime: toIsoDateTime(end) || '',
    MetricName: 'acc_flux',
    Interval: 'hour',
    ZoneIds: [props.zoneId],
  };
}

billingJson.value = JSON.stringify(defaultBillingParams(), null, 2);

async function loadPlans() {
  loading.plans = true;
  try {
    const data = await call('GET', `/plan-instances`);
    plans.value = Array.isArray(data) ? data : [];
  } finally {
    loading.plans = false;
  }
}

async function loadAvailablePlans() {
  loading.available = true;
  try {
    const data = await call('GET', `/billing/available-plans`);
    if (data) availableText.value = JSON.stringify(data, null, 2);
  } finally {
    loading.available = false;
  }
}

function createPlanForZone() {
  openJson(t('cdnPlatform.sitePlan'), t('cdnPlatform.sitePlanHint'), { PlanType: 'sta_global' }, async (v) => {
    const data = await call('POST', `/sites/${encodeURIComponent(props.zoneId)}/billing/plan`, clean(v));
    if (!data) return false;
    message.success(t('cdnPlatform.created'));
    await loadPlans();
  });
}

function createPlan() {
  openJson(t('cdnPlatform.buyPlan'), t('cdnPlatform.planHint'), { PlanType: 'personal', PrepaidPlanParam: { Period: 1, RenewFlag: 'off' } }, async (v) => {
    const data = await call('POST', `/billing/plans`, { params: clean(v) });
    if (!data) return false;
    message.success(t('cdnPlatform.created'));
    await loadPlans();
  });
}

function renewPlan(row: any) {
  openJson(t('cdnPlatform.renewPlan'), t('cdnPlatform.renewHint'), { Period: 1, AutoUseVoucher: 'false' }, async (v) => {
    const data = await call('POST', `/billing/plans/${encodeURIComponent(String(row.PlanId))}/renew`, v);
    if (data === null) return false;
    message.success(t('cdnPlatform.updated'));
    await loadPlans();
  });
}

function upgradePlan(row: any) {
  openJson(t('cdnPlatform.upgradePlan'), t('cdnPlatform.upgradeHint'), { PlanType: 'standard', AutoUseVoucher: 'false' }, async (v) => {
    const data = await call('POST', `/billing/plans/${encodeURIComponent(String(row.PlanId))}/upgrade`, v);
    if (data === null) return false;
    message.success(t('cdnPlatform.updated'));
    await loadPlans();
  });
}

function planQuota(row: any) {
  openJson(t('cdnPlatform.planQuota'), t('cdnPlatform.quotaHint'), { QuotaType: 'site', QuotaNumber: 1 }, async (v) => {
    const data = await call('POST', `/billing/plans/${encodeURIComponent(String(row.PlanId))}/quota`, v);
    if (data === null) return false;
    message.success(t('cdnPlatform.updated'));
  });
}

function updatePlan(row: any) {
  openJson(t('cdnPlatform.planConfig'), t('cdnPlatform.planConfigHint'), { Switch: 'on' }, async (v) => {
    const data = await call('PUT', `/billing/plans/${encodeURIComponent(String(row.PlanId))}`, { RenewFlag: v });
    if (data === null) return false;
    message.success(t('cdnPlatform.updated'));
    await loadPlans();
  });
}

function destroyPlan(row: any) {
  dialog.warning({
    title: t('cdnPlatform.destroyPlan'),
    content: String(row.PlanId || ''),
    positiveText: t('cdnPlatform.destroyPlan'),
    negativeText: t('cdnPlatform.cancel'),
    onPositiveClick: async () => {
      const data = await call('DELETE', `/billing/plans/${encodeURIComponent(String(row.PlanId))}`);
      if (data !== null) {
        message.success(t('cdnPlatform.deleted'));
        await loadPlans();
      }
    },
  });
}

async function queryBilling() {
  let parsed: any;
  try {
    parsed = JSON.parse(billingJson.value);
  } catch {
    message.error(t('cdnPlatform.invalidJson'));
    return;
  }
  for (const key of ['StartTime', 'EndTime', 'MetricName', 'Interval']) {
    if (!parsed[key]) {
      message.warning(t('cdnPlatform.billingFieldsRequired'));
      return;
    }
  }
  loading.billing = true;
  try {
    const data = await call('POST', `/billing/data`, { zoneId: props.zoneId, params: parsed });
    if (data) billingText.value = JSON.stringify(data, null, 2);
  } finally {
    loading.billing = false;
  }
}

const planColumns = computed(() => [
  { title: 'PlanType', key: 'PlanType', minWidth: 180 },
  { title: 'PlanId', key: 'PlanId', minWidth: 200 },
  { title: 'Status', key: 'Status', width: 120 },
  { title: 'ExpiredTime', key: 'ExpiredTime', minWidth: 180, render: (r: any) => r.ExpiredTime || r.ExpireTime || '-' },
  {
    title: t('cdnPlatform.actions'),
    key: 'actions',
    width: 460,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => renewPlan(r) }, { default: () => t('cdnPlatform.renew') }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => upgradePlan(r) }, { default: () => t('cdnPlatform.upgrade') }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => planQuota(r) }, { default: () => t('cdnPlatform.quota') }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => updatePlan(r) }, { default: () => t('cdnPlatform.config') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => destroyPlan(r) }, { default: () => t('cdnPlatform.destroyPlan') }),
    ]),
  },
]);

onMounted(() => {
  if (props.section === 'multipath') loadGateways();
  else if (props.section === 'inference') loadInferenceServices();
  else if (props.section === 'media') loadTranscodeTemplates();
  else if (props.section === 'billing') loadPlans();
});
</script>
