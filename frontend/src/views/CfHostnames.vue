<template>
  <div class="app-stack">
    <PageHeader :title="t('cfHostnames.title', { domain: domainName || domainId })" :subtitle="t('cfHostnames.subtitle')" back="/cdn-domains">
      <template #title-suffix>
        <n-tag v-if="fallbackOrigin" size="small" type="info">Fallback: {{ fallbackOrigin }}</n-tag>
      </template>
      <template #actions>
        <n-space>
          <n-tag size="small" v-if="dcvUuid">DCV UUID: {{ dcvUuid }}</n-tag>
          <n-button @click="loadDcvUuid">{{ t('cfHostnames.getDcvUuid') }}</n-button>
          <n-button @click="openFallback">{{ t('cfHostnames.fallbackOriginBtn') }}</n-button>
        </n-space>
      </template>
    </PageHeader>

    <n-card :bordered="false">
      <n-space class="mb-12">
        <n-button type="primary" size="small" @click="openAdd">{{ t('common.add') }}</n-button>
        <n-button size="small" @click="openBatchAdd">{{ t('cfHostnames.batchAdd') }}</n-button>
        <n-button size="small" :disabled="!selection.length" @click="openBatchEdit">{{ t('cfHostnames.batchEdit') }}</n-button>
        <n-button size="small" :disabled="!selection.length" @click="batchRefresh">{{ t('cfHostnames.batchRefreshVerify') }}</n-button>
        <n-button size="small" :disabled="!selection.length" @click="confirmBatchDelete">{{ t('cfHostnames.batchDelete') }}</n-button>
        <n-divider vertical />
        <n-button size="small" :disabled="!selection.length" @click="openBatchDcv">{{ t('cfHostnames.batchDcvDelegate') }}</n-button>
        <n-button size="small" :disabled="!selection.length" @click="openBatchTxt('hostname')">{{ t('cfHostnames.batchHostnameVerify') }}</n-button>
        <n-button size="small" :disabled="!selection.length" @click="openBatchTxt('cert')">{{ t('cfHostnames.batchCertVerify') }}</n-button>
        <n-button size="small" :disabled="!selection.length" @click="openCfOptimized(false)">{{ t('cfHostnames.cfOptimized') }}</n-button>
        <n-button size="small" @click="load"><template #icon><n-icon :component="RefreshOutline" /></template>{{ t('common.refresh') }}</n-button>
      </n-space>

      <ResponsiveDataTable
        :columns="columns"
        :data="rows"
        :loading="loading"
        :row-key="(row: any) => row.id"
        size="small"
        v-model:checked-row-keys="selection"
        :empty-text="t('cfHostnames.empty')"
      />
    </n-card>

    <!-- 单个添加/编辑 -->
    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('cfHostnames.editTitle') : t('cfHostnames.addTitle')" style="max-width:560px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item v-if="!editingId" :label="t('cfHostnames.hostname')" required>
          <n-input v-model:value="form.hostname" :placeholder="t('cfHostnames.hostnamePlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('cfHostnames.customOrigin')">
          <n-input v-model:value="form.custom_origin_server" :placeholder="t('cfHostnames.customOriginPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('cfHostnames.sslMethod')">
          <n-radio-group v-model:value="form.ssl_method">
            <n-radio value="txt">TXT</n-radio>
            <n-radio value="http">HTTP</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item :label="t('cfHostnames.minTlsVersion')">
          <n-select v-model:value="form.min_tls_version" :options="tlsOptions" style="width:160px" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 批量添加 -->
    <n-modal v-model:show="showBatchAdd" preset="card" :title="t('cfHostnames.batchAddTitle')" style="max-width:560px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cfHostnames.hostnameList')" required>
          <n-input v-model:value="batchAddForm.hostnames" type="textarea" :rows="6" :placeholder="t('cfHostnames.eachLineHostname')" />
        </n-form-item>
        <n-form-item :label="t('cfHostnames.customOrigin')">
          <n-input v-model:value="batchAddForm.custom_origin_server" />
        </n-form-item>
        <n-form-item :label="t('cfHostnames.sslMethod')">
          <n-radio-group v-model:value="batchAddForm.ssl_method"><n-radio value="txt">TXT</n-radio><n-radio value="http">HTTP</n-radio></n-radio-group>
        </n-form-item>
        <n-form-item :label="t('cfHostnames.minTlsVersion')">
          <n-select v-model:value="batchAddForm.min_tls_version" :options="tlsOptions" style="width:160px" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showBatchAdd = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="saveBatchAdd">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 批量编辑 -->
    <n-modal v-model:show="showBatchEdit" preset="card" :title="t('cfHostnames.batchEditTitle')" style="max-width:560px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cfHostnames.customOrigin')">
          <n-input v-model:value="batchEditForm.custom_origin_server" :placeholder="t('cfHostnames.clearOriginPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('cfHostnames.sslMethod')">
          <n-select v-model:value="batchEditForm.ssl_method" :options="[{label:t('cfHostnames.keepUnchanged'),value:''},{label:'TXT',value:'txt'},{label:'HTTP',value:'http'}]" style="width:160px" />
        </n-form-item>
        <n-form-item :label="t('cfHostnames.minTlsVersion')">
          <n-select v-model:value="batchEditForm.min_tls_version" :options="[{label:t('cfHostnames.keepUnchanged'),value:''},...tlsOptions]" style="width:160px" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showBatchEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="saveBatchEdit">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Fallback Origin -->
    <n-modal v-model:show="showFallback" preset="card" title="Fallback Origin" style="max-width:480px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cfHostnames.currentOrigin')">
          <n-input :value="fallbackOrigin || t('cfHostnames.notSet')" disabled />
        </n-form-item>
        <n-form-item :label="t('cfHostnames.newOrigin')">
          <n-input v-model:value="fallbackForm.origin" :placeholder="t('cfHostnames.originPlaceholder')" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button type="error" quaternary @click="clearFallback">{{ t('cfHostnames.clear') }}</n-button>
          <n-button @click="showFallback = false">{{ t('common.close') }}</n-button>
          <n-button type="primary" :loading="saving" @click="saveFallback">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 批量添加 DNS 记录（DCV/TXT 通用） -->
    <n-modal v-model:show="showBatchRecord" preset="card" :title="batchRecord.title" style="max-width:640px" :mask-closable="false">
      <n-alert v-if="batchRecord.warning" type="warning" style="margin-bottom:12px">{{ batchRecord.warning }}</n-alert>
      <div v-for="(g, gi) in batchRecord.groups" :key="gi" class="bg">
        <div class="bg-title">{{ t('cfHostnames.dnsDomain', { domain: g.domainName }) }}</div>
        <div class="bg-items">
          <div v-for="(it, ii) in g.items" :key="ii" class="bg-item">
            <div class="mono">{{ it.label }}</div>
            <div class="dim mono">{{ it.name }}  →  {{ it.value }}</div>
          </div>
        </div>
        <n-select v-model:value="g.domainId" :options="g.options" :placeholder="t('cfHostnames.selectProvider')" size="small" style="max-width:360px" />
      </div>
      <n-empty v-if="!batchRecord.groups.length" :description="t('cfHostnames.noHostnames')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showBatchRecord = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="batchRecord.running" @click="runBatchRecord">{{ t('cfHostnames.startProcess') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- CF 优选 -->
    <n-modal v-model:show="showCfOptimized" preset="card" :title="cfOptimized.single ? t('cfHostnames.cfOptimized') : t('cfHostnames.batchCfOptimized')" style="max-width:680px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cfHostnames.bestTarget')">
          <n-radio-group v-model:value="cfOptimized.targetMode" @update:value="(v: string) => { if (v !== '_custom') cfOptimized.customValue = ''; }">
            <n-space vertical>
              <n-radio v-for="t in cfOptimized.targets" :key="t.value" :value="t.value">{{ t.value }} <span class="dim">{{ t.label }}</span></n-radio>
              <n-radio value="_custom">{{ t('cfHostnames.custom') }}</n-radio>
            </n-space>
          </n-radio-group>
          <n-space v-if="cfOptimized.targetMode === '_custom'" style="margin-top:8px">
            <n-select v-model:value="cfOptimized.customType" :options="[{label:'CNAME',value:'CNAME'},{label:'A',value:'A'},{label:'AAAA',value:'AAAA'}]" style="width:110px" />
            <n-input v-model:value="cfOptimized.customValue" :placeholder="t('cfHostnames.targetValuePlaceholder')" style="width:250px" />
          </n-space>
        </n-form-item>
      </n-form>
      <n-divider />
      <div v-for="(g, gi) in cfOptimized.groups" :key="gi" class="bg">
        <div class="bg-title">{{ t('cfHostnames.dnsDomain', { domain: g.domainName }) }}{{ t('cfHostnames.hostnameCount', { count: g.items.length }) }}</div>
        <n-space>
          <n-select v-model:value="g.domainId" :options="g.options" :placeholder="t('cfHostnames.selectProvider')" size="small" style="width:260px" @update:value="() => loadGroupLines(g)" />
          <n-select v-model:value="g.line" :options="g.lineOptions" size="small" style="width:180px" />
        </n-space>
      </div>
      <n-empty v-if="!cfOptimized.groups.length" :description="t('cfHostnames.noHostnames')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCfOptimized = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="cfOptimized.running" @click="runCfOptimized">{{ t('cfHostnames.startProcess') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 详情 -->
    <n-modal v-model:show="showDetail" preset="card" :title="t('cfHostnames.verifyDetail', { hostname: detailRow?.hostname })" style="max-width:720px">
      <n-descriptions v-if="detailRow" :column="1" label-placement="left" bordered size="small">
        <n-descriptions-item :label="t('cfHostnames.hostname')">{{ detailRow.hostname }}</n-descriptions-item>
        <n-descriptions-item :label="t('cfHostnames.customOrigin')">{{ detailRow.custom_origin_server || '-' }}</n-descriptions-item>
        <n-descriptions-item :label="t('common.status')">{{ detailRow.status || '-' }}</n-descriptions-item>
        <n-descriptions-item :label="t('cfHostnames.hostnameVerify')">{{ detailRow.verification_status }}</n-descriptions-item>
        <n-descriptions-item :label="t('cfHostnames.certStatus')">{{ detailRow.ssl_status }}</n-descriptions-item>
        <n-descriptions-item :label="t('cfHostnames.certVerify')">{{ detailRow.ssl_validation_status }}</n-descriptions-item>
        <n-descriptions-item :label="t('cfHostnames.errorInfo')">{{ detailRow.validation_errors || '-' }}</n-descriptions-item>
      </n-descriptions>
      <template v-if="detailRow">
        <n-divider v-if="detailRow.ssl_validation_records?.length">{{ t('cfHostnames.certVerifyRecords') }}</n-divider>
        <n-table v-if="detailRow.ssl_validation_records?.length" :bordered="true" size="small">
          <thead>
            <tr><th>{{ t('cfHostnames.colStatus') }}</th><th>{{ t('cfHostnames.colTxtName') }}</th><th>{{ t('cfHostnames.colTxtValue') }}</th><th>{{ t('cfHostnames.colCnameName') }}</th><th>{{ t('cfHostnames.colCnameTarget') }}</th><th>{{ t('cfHostnames.colHttpUrl') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in detailRow.ssl_validation_records" :key="i">
              <td>{{ r.status || '-' }}</td>
              <td class="mono">{{ r.txt_name || '-' }}</td>
              <td class="mono">{{ r.txt_value || '-' }}</td>
              <td class="mono">{{ r.cname_name || '-' }}</td>
              <td class="mono">{{ r.cname_target || '-' }}</td>
              <td class="mono">{{ r.http_url || '-' }}</td>
            </tr>
          </tbody>
        </n-table>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { RefreshOutline } from '@vicons/ionicons5';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const route = useRoute();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const domainId = Number(route.params.id);
const domainName = ref('');
const loading = ref(false);
const rows = ref<any[]>([]);
const selection = ref<string[]>([]);
const saving = ref(false);

const dcvUuid = ref('');
const fallbackOrigin = ref('');

const showEdit = ref(false);
const editingId = ref<string | null>(null);
const form = reactive<any>({ hostname: '', custom_origin_server: '', ssl_method: 'txt', min_tls_version: '1.0' });

const showBatchAdd = ref(false);
const batchAddForm = reactive<any>({ hostnames: '', custom_origin_server: '', ssl_method: 'txt', min_tls_version: '1.0' });

const showBatchEdit = ref(false);
const batchEditForm = reactive<any>({ custom_origin_server: '', ssl_method: '', min_tls_version: '' });

const showFallback = ref(false);
const fallbackForm = reactive<any>({ origin: '' });

const showDetail = ref(false);
const detailRow = ref<any>(null);

const tlsOptions = ['1.0', '1.1', '1.2', '1.3'].map((v) => ({ label: v, value: v }));

const columns = computed<any[]>(() => [
  { type: 'selection', width: 40 },
  { title: t('cfHostnames.hostname'), key: 'hostname', minWidth: 180, render: (row: any) => h(NEllipsis, { style: 'max-width:220px' }, { default: () => row.hostname }) },
  { title: t('cfHostnames.customOrigin'), key: 'custom_origin_server', minWidth: 140, render: (row: any) => h(NEllipsis, { style: 'max-width:160px' }, { default: () => row.custom_origin_server || '-' }) },
  { title: t('cfHostnames.verifyMethod'), key: 'ssl_method', width: 90, render: (row: any) => (row.ssl_method ? row.ssl_method.toUpperCase() : '-') },
  { title: 'TLS', key: 'ssl_min_tls_version', width: 60, render: (row: any) => row.ssl_min_tls_version || '-' },
  { title: t('cfHostnames.certStatus'), key: 'ssl_status', width: 100, render: (row: any) => statusTag(row.ssl_status) },
  { title: t('cfHostnames.certVerify'), key: 'ssl_validation_status', width: 120, render: (row: any) => statusTag(row.ssl_validation_status) },
  { title: t('cfHostnames.hostnameVerify'), key: 'verification_status', width: 110, render: (row: any) => statusTag(row.verification_status) },
  { title: t('common.createdAt'), key: 'created_on', width: 160, render: (row: any) => (row.created_on ? fmt(row.created_on) : '-') },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 240,
    render(row: any) {
      return h(NSpace, { size: 2 }, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
          h(NButton, { size: 'tiny', onClick: () => refreshOne(row) }, { default: () => t('cfHostnames.refreshVerify') }),
          h(NButton, { size: 'tiny', onClick: () => openCfOptimized(true, row.hostname) }, { default: () => t('cfHostnames.optimize') }),
          h(NButton, { size: 'tiny', onClick: () => showDetailOf(row) }, { default: () => t('common.detail') }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => delOne(row) }, { default: () => t('common.delete') }),
        ],
      });
    },
  },
]);

function fmt(s: string) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('zh-CN', { hour12: false });
}

function statusTag(v: string) {
  const val = (v || '-').toUpperCase();
  let type: any = 'default';
  if (val === 'ACTIVE') type = 'success';
  else if (val === 'PENDING') type = 'warning';
  else if (val.indexOf('ERROR') >= 0 || val === 'FAILED') type = 'error';
  return h(NTag, { size: 'small', type, bordered: false }, { default: () => val });
}

async function load() {
  loading.value = true;
  const res = await api<any>('GET', `/cloudflare/domains/${domainId}/hostnames`);
  if (res.code === 0) rows.value = res.data;
  else message.error(res.msg);
  loading.value = false;
}

async function loadDomainInfo() {
  const res = await api<any>('GET', '/domains');
  if (res.code === 0) {
    const d = res.data.find((x: any) => x.id === domainId);
    if (d) domainName.value = d.name;
  }
}

async function loadDcvUuid() {
  const res = await api<any>('GET', `/cloudflare/domains/${domainId}/dcv-uuid`);
  if (res.code === 0 && res.data.uuid) {
    dcvUuid.value = res.data.uuid;
    message.success(t('cfHostnames.dcvUuidSuccess'));
  } else message.error(res.msg || t('cfHostnames.fetchFailed'));
}

async function loadFallback() {
  const res = await api<any>('GET', `/cloudflare/domains/${domainId}/fallback`);
  if (res.code === 0) fallbackOrigin.value = res.data.origin || '';
}

function openAdd() {
  editingId.value = null;
  Object.assign(form, { hostname: '', custom_origin_server: '', ssl_method: 'txt', min_tls_version: '1.0' });
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  Object.assign(form, { custom_origin_server: row.custom_origin_server || '', ssl_method: row.ssl_method || 'txt', min_tls_version: row.ssl_min_tls_version || '1.0' });
  showEdit.value = true;
}

async function save() {
  if (!editingId.value && !form.hostname) return message.warning(t('cfHostnames.hostnameRequired'));
  saving.value = true;
  const body = { custom_origin_server: form.custom_origin_server, ssl_method: form.ssl_method, min_tls_version: form.min_tls_version };
  const res = editingId.value
    ? await api('PUT', `/cloudflare/domains/${domainId}/hostnames/${editingId.value}`, body)
    : await api('POST', `/cloudflare/domains/${domainId}/hostnames`, { ...body, hostname: form.hostname });
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    load();
  } else message.error(res.msg);
}

function openBatchAdd() {
  Object.assign(batchAddForm, { hostnames: '', custom_origin_server: '', ssl_method: 'txt', min_tls_version: '1.0' });
  showBatchAdd.value = true;
}

async function saveBatchAdd() {
  if (!batchAddForm.hostnames.trim()) return message.warning(t('cfHostnames.hostnamesRequired'));
  saving.value = true;
  const res = await api('POST', `/cloudflare/domains/${domainId}/hostnames/batch_add`, { ...batchAddForm });
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showBatchAdd.value = false;
    load();
  } else message.error(res.msg);
}

function openBatchEdit() {
  Object.assign(batchEditForm, { custom_origin_server: '', ssl_method: '', min_tls_version: '' });
  showBatchEdit.value = true;
}

async function saveBatchEdit() {
  saving.value = true;
  const res = await api('POST', `/cloudflare/domains/${domainId}/hostnames/batch_update`, {
    hostname_ids: selection.value.join(','),
    ...batchEditForm,
  });
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showBatchEdit.value = false;
    load();
  } else message.error(res.msg);
}

function refreshOne(row: any) {
  dialog.info({ title: t('cfHostnames.refreshVerify'), content: t('cfHostnames.refreshVerifyConfirm', { hostname: row.hostname }), positiveText: t('common.confirm'), negativeText: t('common.cancel'), onPositiveClick: async () => {
    const res = await api('POST', `/cloudflare/domains/${domainId}/hostnames/${row.id}/refresh`);
    if (res.code === 0) { message.success(res.msg); load(); } else message.error(res.msg);
  } });
}

function batchRefresh() {
  dialog.info({ title: t('cfHostnames.batchRefreshVerify'), content: t('cfHostnames.batchRefreshConfirm', { count: selection.value.length }), positiveText: t('common.confirm'), negativeText: t('common.cancel'), onPositiveClick: async () => {
    for (const id of selection.value) await api('POST', `/cloudflare/domains/${domainId}/hostnames/${id}/refresh`);
    message.success(t('cfHostnames.refreshReinitiated'));
    load();
  } });
}

function delOne(row: any) {
  dialog.warning({ title: t('cfHostnames.deleteTitle'), content: t('cfHostnames.deleteConfirm', { hostname: row.hostname }), positiveText: t('common.delete'), negativeText: t('common.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/domains/${domainId}/hostnames/${row.id}?hostname=${encodeURIComponent(row.hostname)}`);
    if (res.code === 0) { message.success(res.msg); load(); } else message.error(res.msg);
  } });
}

function confirmBatchDelete() {
  dialog.warning({ title: t('cfHostnames.batchDelete'), content: t('cfHostnames.batchDeleteConfirm', { count: selection.value.length }), positiveText: t('common.delete'), negativeText: t('common.cancel'), onPositiveClick: async () => {
    const res = await api('POST', `/cloudflare/domains/${domainId}/hostnames/batch_delete`, { hostname_ids: selection.value });
    if (res.code === 0) { message.success(res.msg); load(); } else message.error(res.msg);
  } });
}

function openFallback() {
  fallbackForm.origin = '';
  showFallback.value = true;
}

async function saveFallback() {
  if (!fallbackForm.origin.trim()) return message.warning(t('cfHostnames.originRequired'));
  saving.value = true;
  const res = await api('PUT', `/cloudflare/domains/${domainId}/fallback`, { origin: fallbackForm.origin });
  saving.value = false;
  if (res.code === 0) { message.success(res.msg); fallbackOrigin.value = res.data.origin; showFallback.value = false; } else message.error(res.msg);
}

function clearFallback() {
  dialog.warning({ title: t('cfHostnames.clearFallbackTitle'), content: t('cfHostnames.clearFallbackConfirm'), positiveText: t('cfHostnames.clear'), negativeText: t('common.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/domains/${domainId}/fallback`);
    if (res.code === 0) { message.success(res.msg); fallbackOrigin.value = ''; showFallback.value = false; } else message.error(res.msg);
  } });
}

function showDetailOf(row: any) {
  detailRow.value = row;
  showDetail.value = true;
}

// ==================== 批量添加 DNS 记录（DCV / TXT） ====================

interface Group { domainName: string; domainId: string | null; options: any[]; items: any[]; }
interface BatchRecordState { title: string; warning: string; groups: Group[]; running: boolean; }

const showBatchRecord = ref(false);
const batchRecord = reactive<BatchRecordState>({ title: '', warning: '', groups: [], running: false });

async function resolveTargets(name: string): Promise<any[]> {
  const res = await api<any>('POST', `/cloudflare/domains/${domainId}/hostnames/txt-targets`, { hostname: name });
  return res.code === 0 && res.data?.candidates ? res.data.candidates : [];
}

function groupByDomain(items: { label: string; name: string; value: string; candidates: any[] }[]) {
  const groups: Record<string, Group> = {};
  for (const it of items) {
    const domainName = it.candidates.length ? it.candidates[0].domain_name : t('cfHostnames.unknownDomain');
    if (!groups[domainName]) groups[domainName] = { domainName, domainId: null, options: [], items: [] };
    groups[domainName].items.push(it);
    for (const c of it.candidates) {
      if (!groups[domainName].options.find((o: any) => o.value === c.domain_id)) {
        groups[domainName].options.push({ label: `${c.domain_name} (${c.account_type_name})`, value: c.domain_id });
      }
    }
  }
  return Object.values(groups);
}

async function openBatchDcv() {
  if (!dcvUuid.value) { await loadDcvUuid(); if (!dcvUuid.value) return; }
  const items: any[] = [];
  for (const id of selection.value) {
    const row = rows.value.find((r) => r.id === id);
    if (!row) continue;
    const name = `_acme-challenge.${row.hostname}`;
    const candidates = await resolveTargets(name);
    items.push({ label: row.hostname, name, value: `${row.hostname}.${dcvUuid.value}.dcv.cloudflare.com`, candidates, type: 'CNAME' });
  }
  if (!items.length) return message.warning(t('cfHostnames.noHostnames'));
  batchRecord.title = t('cfHostnames.batchDcvTitle', { uuid: dcvUuid.value });
  batchRecord.warning = t('cfHostnames.batchDcvWarning');
  batchRecord.groups = groupByDomain(items);
  batchRecord.running = false;
  showBatchRecord.value = true;
}

async function openBatchTxt(kind: 'hostname' | 'cert') {
  const items: any[] = [];
  const skipped: string[] = [];
  for (const id of selection.value) {
    const row = rows.value.find((r) => r.id === id);
    if (!row) continue;
    let name = '';
    let value = '';
    if (kind === 'hostname') {
      name = row.ownership_verification?.name || '';
      value = row.ownership_verification?.value || '';
    } else {
      const rec = row.ssl_validation_records?.find((r: any) => r.txt_name || r.txt_value);
      name = rec?.txt_name || row.ssl?.txt_name || '';
      value = rec?.txt_value || row.ssl?.txt_value || '';
    }
    if (!name || !value) { skipped.push(row.hostname); continue; }
    const candidates = await resolveTargets(name);
    items.push({ label: row.hostname, name, value, candidates, type: 'TXT' });
  }
  if (!items.length) return message.warning(t('cfHostnames.noVerifyInfo'));
  batchRecord.title = kind === 'hostname' ? t('cfHostnames.batchHostnameTxtTitle') : t('cfHostnames.batchCertTxtTitle');
  batchRecord.warning = skipped.length ? t('cfHostnames.skippedWarning', { count: skipped.length, list: skipped.join(', ') }) : '';
  batchRecord.groups = groupByDomain(items);
  batchRecord.running = false;
  showBatchRecord.value = true;
}

async function runBatchRecord() {
  for (const g of batchRecord.groups) {
    if (!g.domainId) return message.warning(t('cfHostnames.selectProviderRequired'));
  }
  batchRecord.running = true;
  let ok = 0;
  let fail = 0;
  const errors: string[] = [];
  for (const g of batchRecord.groups) {
    for (const it of g.items) {
      const cand = it.candidates.find((c: any) => String(c.domain_id) === String(g.domainId));
      if (!cand) { fail++; errors.push(`${it.label}: ${t('cfHostnames.domainNotFound')}`); continue; }
      const line = await getDefaultLine(g.domainId!);
      const res = await api('POST', `/domains/${g.domainId}/records`, { name: cand.record_name, type: it.type, value: it.value, line, ttl: 600, mx: 1, weight: 0, remark: t('cfHostnames.cfVerifyRemark') });
      if (res.code === 0) ok++;
      else { fail++; errors.push(`${it.label}: ${res.msg}`); }
    }
  }
  batchRecord.running = false;
  showBatchRecord.value = false;
  dialog.info({ title: t('cfHostnames.processDone'), content: t('cfHostnames.doneCount', { ok, fail }) + (errors.length ? '\n\n' + t('cfHostnames.failDetails') + errors.join('\n') : ''), positiveText: t('common.confirm') });
}

async function getDefaultLine(targetDomainId: number | string): Promise<string> {
  const res = await api<any>('GET', `/domains/${targetDomainId}/lines`);
  if (res.code === 0 && res.data) {
    const keys = Object.keys(res.data);
    if (keys.length) return res.data[keys[0]];
  }
  return '0';
}

// ==================== CF 优选 ====================

interface CfGroup { domainName: string; domainId: string | null; line: string; options: any[]; lineOptions: any[]; items: any[]; }
const showCfOptimized = ref(false);
const cfOptimized = reactive<any>({ single: false, singleHostname: '', targets: [], targetMode: '', customType: 'CNAME', customValue: '', groups: [] as CfGroup[], running: false });

async function loadCfOptimizedTargets() {
  const list: any[] = [];
  const res = await api<any>('GET', '/optimize/tasks', { offset: 0, limit: 100 });
  if (res.code === 0 && res.data?.list) {
    for (const row of res.data.list) {
      if (row.cdn_type == 1 && row.active == 1 && row.rr && row.domain) {
        list.push({ value: `${row.rr}.${row.domain}`, label: row.remark || `${row.rr}.${row.domain}` });
      }
    }
  }
  return list;
}

async function openCfOptimized(single: boolean, hostname?: string) {
  cfOptimized.single = single;
  cfOptimized.singleHostname = hostname || '';
  cfOptimized.targets = await loadCfOptimizedTargets();
  cfOptimized.targetMode = '';
  cfOptimized.customType = 'CNAME';
  cfOptimized.customValue = '';
  cfOptimized.groups = [];
  cfOptimized.running = false;

  const hostnames = single ? [hostname!] : selection.value.map((id) => rows.value.find((r) => r.id === id)?.hostname).filter(Boolean);
  const items: any[] = [];
  for (const h of hostnames) {
    const candidates = await resolveTargets(h);
    items.push({ hostname: h, candidates });
  }
  const groups: Record<string, CfGroup> = {};
  for (const it of items) {
    const domainName = it.candidates.length ? it.candidates[0].domain_name : t('cfHostnames.unknownDomain');
    if (!groups[domainName]) groups[domainName] = { domainName, domainId: null, line: '', options: [], lineOptions: [], items: [] };
    groups[domainName].items.push(it);
    for (const c of it.candidates) {
      if (!groups[domainName].options.find((o: any) => o.value === c.domain_id)) {
        groups[domainName].options.push({ label: `${c.domain_name} (${c.account_type_name})`, value: c.domain_id });
      }
    }
  }
  cfOptimized.groups = Object.values(groups);
  if (!cfOptimized.groups.length) return message.warning(t('cfHostnames.noHostnames'));
  showCfOptimized.value = true;
}

async function loadGroupLines(g: CfGroup) {
  g.lineOptions = [];
  if (!g.domainId) return;
  const res = await api<any>('GET', `/domains/${g.domainId}/lines`);
  if (res.code === 0 && res.data) {
    g.lineOptions = Object.entries(res.data).map(([label, code]) => ({ label, value: code as string }));
    if (g.lineOptions.length) g.line = g.lineOptions[0].value;
  }
}

function cfOptimizedTargetValue(): { value: string; type: string } | null {
  if (cfOptimized.targetMode === '_custom') {
    if (!cfOptimized.customValue.trim()) { message.warning(t('cfHostnames.customTargetRequired')); return null; }
    return { value: cfOptimized.customValue.trim(), type: cfOptimized.customType };
  }
  if (!cfOptimized.targetMode) { message.warning(t('cfHostnames.selectCnameTarget')); return null; }
  return { value: cfOptimized.targetMode, type: 'CNAME' };
}

async function runCfOptimized() {
  const target = cfOptimizedTargetValue();
  if (!target) return;
  for (const g of cfOptimized.groups) {
    if (!g.domainId) return message.warning(t('cfHostnames.selectProviderRequired'));
  }
  cfOptimized.running = true;
  let ok = 0;
  let fail = 0;
  const errors: string[] = [];
  for (const g of cfOptimized.groups) {
    const line = g.line || (await getDefaultLine(g.domainId!));
    for (const it of g.items) {
      const cand = it.candidates.find((c: any) => String(c.domain_id) === String(g.domainId));
      if (!cand) { fail++; errors.push(`${it.hostname}: ${t('cfHostnames.domainNotFound')}`); continue; }
      const res = await api('POST', `/domains/${g.domainId}/records`, { name: cand.record_name, type: target.type, value: target.value, line, ttl: 600, mx: 1, weight: 0, remark: t('cfHostnames.cfOptimizedRemark') });
      if (res.code === 0) ok++;
      else { fail++; errors.push(`${it.hostname}: ${res.msg}`); }
    }
  }
  cfOptimized.running = false;
  showCfOptimized.value = false;
  dialog.info({ title: t('cfHostnames.optimizeDone'), content: t('cfHostnames.doneCount', { ok, fail }) + (errors.length ? '\n\n' + t('cfHostnames.failDetails') + errors.join('\n') : ''), positiveText: t('common.confirm') });
}

onMounted(() => {
  load();
  loadDomainInfo();
  loadFallback();
});
</script>

<style scoped>
.mb-12 { margin-bottom: 12px; }
.bg { border: 1px solid var(--app-border); border-radius: 4px; padding: 12px; margin-bottom: 12px; }
.bg-title { font-weight: 600; margin-bottom: 8px; }
.bg-items { margin-bottom: 10px; }
.bg-item { background: var(--app-surface-2); border-radius: 4px; padding: 8px; margin-bottom: 6px; }
.mono { font-family: monospace; word-break: break-all; font-size: 12px; }
.dim { color: var(--app-text-3); font-size: 12px; }
</style>