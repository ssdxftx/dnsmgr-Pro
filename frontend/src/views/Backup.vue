<template>
  <div class="app-stack">
    <PageHeader :title="t('backup.title')" :subtitle="t('backup.subtitle')" />

    <n-tabs v-model:value="tab" type="line" animated>
      <n-tab-pane v-if="admin" name="site" :tab="t('backup.tabSite')">
    <n-grid class="telemetry-row" cols="2 s:2 m:4" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item><TelemetryCard :value="successCount" :label="t('backup.lastBackup')" tone="primary" :icon="ArchiveOutline" :caption="lastBackupText" /></n-grid-item>
      <n-grid-item><TelemetryCard :value="schedules.length" :label="t('backup.nextRun')" tone="info" :icon="TimeOutline" :caption="nextRunText" /></n-grid-item>
      <n-grid-item><TelemetryCard :value="keyReady ? 1 : 0" :label="t('backup.keyTitle')" :tone="keyReady ? 'success' : 'warning'" :icon="KeyOutline" :caption="keyReady ? t('backup.keyReady') : t('backup.keyMissing')" /></n-grid-item>
      <n-grid-item><TelemetryCard :value="jobs.length" :label="t('backup.totalJobs')" tone="primary" :icon="CloudDownloadOutline" :caption="t('backup.jobsTitle')" /></n-grid-item>
    </n-grid>

    <n-card :bordered="false">
      <template #header>{{ t('backup.quickTitle') }}</template>
      <div class="app-toolbar">
        <n-checkbox v-model:checked="includeLogs" :disabled="busy">{{ t('backup.includeLogs') }}</n-checkbox>
        <n-select v-model:value="destId" :options="destOptions" style="max-width: 220px" :disabled="busy" />
        <n-button type="primary" :loading="busy" @click="startExport">{{ t('backup.exportNow') }}</n-button>
        <n-button quaternary @click="rotateKey">{{ t('backup.rotateKey') }}</n-button>
      </div>
    </n-card>

    <n-card :bordered="false">
      <template #header>{{ t('backup.jobsTitle') }}</template>
      <ResponsiveDataTable :columns="jobColumns" :data="jobs" :loading="loading" :empty-text="t('backup.jobsEmpty')" />
    </n-card>

    <n-card :bordered="false">
      <template #header>{{ t('backup.destTitle') }}</template>
      <template #header-extra><n-button size="small" @click="openDest()">{{ t('backup.destAdd') }}</n-button></template>
      <n-list v-if="destinations.length">
        <n-list-item v-for="d in destinations" :key="d.id">
          <n-space align="center" justify="space-between" style="width: 100%">
            <div>
              <strong>{{ d.name }}</strong>
              <n-tag size="small" style="margin-left: 8px">{{ d.type }}</n-tag>
              <div class="text-dim">{{ destSummary(d) }}</div>
            </div>
            <n-space>
              <n-button size="small" quaternary @click="testDest(d)">{{ t('backup.destTest') }}</n-button>
              <n-button size="small" quaternary @click="openRemote(d)">{{ t('backup.remoteBrowse') }}</n-button>
              <n-button size="small" quaternary @click="openDest(d)">{{ t('backup.save') }}</n-button>
              <n-button size="small" quaternary type="error" @click="removeDest(d)">{{ t('backup.delete') }}</n-button>
            </n-space>
          </n-space>
        </n-list-item>
      </n-list>
      <n-empty v-else :description="t('backup.destTitle')" />
    </n-card>

    <n-card :bordered="false">
      <template #header>{{ t('backup.schedTitle') }}</template>
      <template #header-extra><n-button size="small" @click="openSched()">{{ t('backup.schedAdd') }}</n-button></template>
      <n-list v-if="schedules.length">
        <n-list-item v-for="s in schedules" :key="s.id">
          <n-space align="center" justify="space-between" style="width: 100%">
            <div>
              <strong>{{ s.name }}</strong>
              <div class="text-dim">
                {{ s.freq === 'weekly' ? t('backup.weekly') : t('backup.daily') }} {{ pad(s.hour) }}:{{ pad(s.minute) }}
                · {{ t('backup.keepCount') }} {{ s.keep_count }} / {{ t('backup.keepDays') }} {{ s.keep_days }}
                · {{ t('backup.nextRun') }}: {{ s.next_run || '-' }}
              </div>
              <div class="text-dim" v-if="s.last_result">{{ t('backup.lastResult') }}: {{ s.last_result }}</div>
            </div>
            <n-space>
              <n-button size="small" quaternary @click="runSched(s)">{{ t('backup.runNow') }}</n-button>
              <n-button size="small" quaternary @click="openSched(s)">{{ t('backup.save') }}</n-button>
              <n-button size="small" quaternary type="error" @click="removeSched(s)">{{ t('backup.delete') }}</n-button>
            </n-space>
          </n-space>
        </n-list-item>
      </n-list>
      <n-empty v-else :description="t('backup.schedTitle')" />
    </n-card>
      </n-tab-pane>
      <n-tab-pane name="mine" :tab="t('backup.tabMine')">
        <MyBackup embedded />
      </n-tab-pane>
      <n-tab-pane name="vault" :tab="t('backup.tabVault')">
        <MyAccounts embedded />
      </n-tab-pane>
    </n-tabs>

    <n-modal v-model:show="showRemote" preset="card" :title="t('backup.remoteTitle')" class="modal-lg" :mask-closable="false">
      <n-space vertical :size="12">
        <n-space align="center" :size="8" style="flex-wrap: wrap">
          <n-select v-model:value="remoteDestId" :options="remoteDestOptions" style="min-width: 200px; max-width: 260px" @update:value="loadRemote" />
          <n-button :loading="remoteLoading" @click="loadRemote">{{ t('backup.remoteRefresh') }}</n-button>
        </n-space>
        <n-alert type="info">{{ t('backup.remoteHint') }}</n-alert>
        <n-spin :show="remoteLoading">
          <n-list v-if="remoteFiles.length" bordered>
            <n-list-item v-for="f in remoteFiles" :key="f.name">
              <div class="remote-row">
                <div class="remote-meta">
                  <div class="remote-name">{{ f.name }}</div>
                  <div class="text-dim">{{ fmtSize(f.size) }} · {{ f.createdAt || f.modified || '-' }} · {{ f.scope === 'user' ? t('backup.remoteScopeUser') : t('backup.remoteScopeSite') }}</div>
                </div>
                <n-button size="small" type="primary" :disabled="!f.restorable" @click="restoreRemote(f)">{{ t('backup.remoteRestore') }}</n-button>
              </div>
            </n-list-item>
          </n-list>
          <n-empty v-else :description="t('backup.remoteEmpty')" />
        </n-spin>
      </n-space>
    </n-modal>

    <n-modal v-model:show="showRestore" preset="card" :title="t('backup.restoreTitle')" class="modal-md" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-alert v-if="restoreTarget?.remote" type="info" class="mb-3">
          {{ t('backup.remoteSelected') }}: {{ restoreTarget.file_name }}
        </n-alert>
        <n-form-item :label="t('backup.restoreMode')">
          <n-radio-group v-model:value="restoreForm.mode">
            <n-radio value="replace">{{ t('backup.replace') }}</n-radio>
            <n-radio value="merge">{{ t('backup.merge') }}</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-alert :type="restoreForm.mode === 'replace' ? 'warning' : 'info'" class="mb-3">
          {{ restoreForm.mode === 'replace' ? t('backup.replaceHint') : t('backup.mergeHint') }}
        </n-alert>
        <n-form-item :label="t('backup.confirmLabel')">
          <n-input v-model:value="restoreForm.confirm" :placeholder="t('backup.confirmHint')" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showRestore = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="error" :loading="restoring" :disabled="restoreForm.confirm !== 'RESTORE'" @click="doRestore">{{ t('backup.restoreStart') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showDest" preset="card" :title="destForm.id ? t('backup.destEdit') : t('backup.destAdd')" class="modal-md" :mask-closable="false">
      <n-form label-placement="left" label-width="130">
        <n-form-item :label="t('backup.destName')"><n-input v-model:value="destForm.name" /></n-form-item>
        <n-form-item :label="t('backup.destType')">
          <n-select v-model:value="destForm.type" :options="[{ label: 'WebDAV', value: 'webdav' }, { label: 'S3', value: 's3' }]" />
        </n-form-item>
        <template v-if="destForm.type === 'webdav'">
          <n-form-item :label="t('backup.destUrl')" :feedback="t('backup.destUrlHint')"><n-input v-model:value="destForm.config.url" placeholder="https://dav.example.com/backup/" /></n-form-item>
          <n-form-item :label="t('backup.destUser')"><n-input v-model:value="destForm.config.username" /></n-form-item>
          <n-form-item :label="t('backup.destPass')"><n-input v-model:value="destForm.config.password" type="password" show-password-on="click" /></n-form-item>
        </template>
        <template v-else>
          <n-form-item :label="t('backup.destEndpoint')"><n-input v-model:value="destForm.config.endpoint" placeholder="https://s3.example.com" /></n-form-item>
          <n-form-item :label="t('backup.destRegion')"><n-input v-model:value="destForm.config.region" placeholder="us-east-1" /></n-form-item>
          <n-form-item :label="t('backup.destBucket')"><n-input v-model:value="destForm.config.bucket" /></n-form-item>
          <n-form-item :label="t('backup.destAccessKey')"><n-input v-model:value="destForm.config.accessKeyId" /></n-form-item>
          <n-form-item :label="t('backup.destSecretKey')"><n-input v-model:value="destForm.config.secretAccessKey" type="password" show-password-on="click" /></n-form-item>
          <n-form-item :label="t('backup.destPrefix')"><n-input v-model:value="destForm.config.prefix" placeholder="dnsmgr" /></n-form-item>
        </template>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showDest = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="saveDest">{{ t('backup.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showSched" preset="card" :title="t('backup.schedAdd')" class="modal-md" :mask-closable="false">
      <n-form label-placement="left" label-width="120">
        <n-form-item :label="t('backup.schedName')"><n-input v-model:value="schedForm.name" /></n-form-item>
        <n-form-item :label="t('backup.schedFreq')">
          <n-select v-model:value="schedForm.freq" :options="[{ label: t('backup.daily'), value: 'daily' }, { label: t('backup.weekly'), value: 'weekly' }]" />
        </n-form-item>
        <n-form-item v-if="schedForm.freq === 'weekly'" :label="t('backup.schedWeekday')">
          <n-input-number v-model:value="schedForm.weekday" :min="1" :max="7" style="width: 100%" />
        </n-form-item>
        <n-form-item :label="t('backup.schedHour')"><n-input-number v-model:value="schedForm.hour" :min="0" :max="23" style="width: 100%" /></n-form-item>
        <n-form-item :label="t('backup.schedMinute')"><n-input-number v-model:value="schedForm.minute" :min="0" :max="59" style="width: 100%" /></n-form-item>
        <n-form-item :label="t('backup.keepCount')"><n-input-number v-model:value="schedForm.keep_count" :min="1" style="width: 100%" /></n-form-item>
        <n-form-item :label="t('backup.keepDays')"><n-input-number v-model:value="schedForm.keep_days" :min="1" style="width: 100%" /></n-form-item>
        <n-form-item :label="t('backup.destination')">
          <n-select v-model:value="schedForm.dest_id" :options="destOptions" />
        </n-form-item>
        <n-form-item :label="t('backup.includeLogs')"><n-switch v-model:value="schedForm.include_logs" /></n-form-item>
        <n-form-item :label="t('backup.enabled')"><n-switch v-model:value="schedForm.enabled" /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showSched = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="saveSched">{{ t('backup.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NSpace, useDialog, useMessage } from 'naive-ui';
import { ArchiveOutline, CloudDownloadOutline, KeyOutline, TimeOutline } from '@vicons/ionicons5';
import { api, getUser } from '../api';
import { isAdminUser } from '../lib/admin';
import PageHeader from '../components/PageHeader.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import MyBackup from './MyBackup.vue';
import MyAccounts from './MyAccounts.vue';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const route = useRoute();
const router = useRouter();

const admin = isAdminUser(getUser());
const validTabs = admin ? ['site', 'mine', 'vault'] : ['mine', 'vault'];
const initialTab = String(route.query.tab || '');
const tab = ref(validTabs.includes(initialTab) ? initialTab : (admin ? 'site' : 'mine'));

watch(
  () => route.query.tab,
  (v) => {
    const next = String(v || '');
    if (validTabs.includes(next) && next !== tab.value) tab.value = next;
  },
);
watch(tab, (v) => {
  if (String(route.query.tab || '') !== v) router.replace({ path: '/backup', query: { ...route.query, tab: v } });
});

const loading = ref(false);
const busy = ref(false);
const saving = ref(false);
const restoring = ref(false);
const keyReady = ref(false);
const includeLogs = ref(true);
const destId = ref(0);
const jobs = ref<any[]>([]);
const destinations = ref<any[]>([]);
const schedules = ref<any[]>([]);

const showRestore = ref(false);
const showRemote = ref(false);
const showDest = ref(false);
const remoteDestId = ref(0);
const remoteFiles = ref<any[]>([]);
const remoteLoading = ref(false);
const showSched = ref(false);
const restoreTarget = ref<any>(null);
const restoreForm = reactive({ mode: 'replace', confirm: '' });
const destForm = reactive<any>({ id: 0, name: '', type: 'webdav', config: {} });
const schedForm = reactive<any>({
  id: 0, name: '自动备份', freq: 'daily', hour: 3, minute: 0, weekday: 1,
  keep_count: 7, keep_days: 30, dest_id: 0, include_logs: false, enabled: true,
});

const destOptions = computed(() => [
  { label: t('backup.localOnly'), value: 0 },
  ...destinations.value.map((d) => ({ label: d.name, value: Number(d.id) })),
]);

const remoteDestOptions = computed(() =>
  destinations.value.map((d) => ({ label: `${d.name} (${d.type})`, value: Number(d.id) })),
);

const successCount = computed(() => jobs.value.filter((j) => j.status === 'success').length);
const lastBackupText = computed(() => {
  const job = jobs.value.find((j) => j.status === 'success');
  return job ? String(job.created_at || '') : t('backup.never');
});
const nextRunText = computed(() => {
  const next = schedules.value.map((s) => s.next_run).filter(Boolean).sort()[0];
  return next || t('backup.never');
});

function pad(n: any) {
  return String(n ?? 0).padStart(2, '0');
}
function fmtSize(n: any) {
  const bytes = Number(n || 0);
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' ' + t('backup.unitMb');
}
function scopeText(s: string) {
  return s === 'user' ? t('backup.scopeUser') : t('backup.scopeSite');
}
function statusText(s: string) {
  return s === 'success' ? t('backup.statusSuccess') : s === 'failed' ? t('backup.statusFailed') : t('backup.statusRunning');
}
function destSummary(d: any) {
  return d.type === 'webdav' ? String(d.config?.url || '') : `${d.config?.endpoint || ''} / ${d.config?.bucket || ''}`;
}

const jobColumns = computed(() => [
  { title: t('backup.colTime'), key: 'created_at', width: 170 },
  { title: t('backup.colScope'), key: 'scope', width: 90, render: (r: any) => scopeText(String(r.scope)) },
  { title: t('backup.colSize'), key: 'file_size', width: 110, render: (r: any) => fmtSize(r.file_size) },
  { title: t('backup.colStatus'), key: 'status', width: 100, render: (r: any) => statusText(String(r.status)) },
  { title: t('backup.colDest'), key: 'dest', width: 90 },
  {
    title: t('backup.colActions'),
    key: 'actions',
    width: 210,
    fixed: 'right' as const,
    render: (row: any) =>
      h(NSpace, { size: 4 }, {
        default: () => [
          h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => download(row) }, { default: () => t('backup.download') }),
          h(NButton, { size: 'tiny', quaternary: true, disabled: row.scope !== 'site' || row.status !== 'success', onClick: () => openRestore(row) }, { default: () => t('backup.restore') }),
          h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => removeJob(row) }, { default: () => t('backup.delete') }),
        ],
      }),
  },
]);

async function loadAll() {
  loading.value = true;
  try {
    const [k, j, d, s] = await Promise.all([
      api<any>('GET', '/backup/key/status'),
      api<any>('GET', '/backup/jobs'),
      api<any>('GET', '/backup/destinations'),
      api<any>('GET', '/backup/schedules'),
    ]);
    keyReady.value = !!k?.data?.configured;
    jobs.value = j?.data || [];
    destinations.value = d?.data || [];
    schedules.value = s?.data || [];
  } catch (e: any) {
    message.error(e?.message || t('backup.loadFailed'));
  } finally {
    loading.value = false;
  }
}

async function startExport() {
  busy.value = true;
  try {
    const res = await api<any>('POST', '/backup/export', { scope: 'site', include_logs: includeLogs.value, dest_id: destId.value });
    if (res.code !== 0) return message.error(res.msg);
    message.success(t('backup.exportDone'));
    await loadAll();
  } catch (e: any) {
    message.error(e?.message || t('backup.loadFailed'));
  } finally {
    busy.value = false;
  }
}

function rotateKey() {
  dialog.warning({
    title: t('backup.keyTitle'),
    content: t('backup.rotateConfirm'),
    positiveText: t('backup.rotateKey'),
    negativeText: t('backup.cancel'),
    onPositiveClick: async () => {
      const res = await api<any>('POST', '/backup/key', {});
      if (res.code !== 0) return message.error(res.msg);
      message.success(res.msg);
      keyReady.value = true;
    },
  });
}

async function download(row: any) {
  const token = localStorage.getItem('dnsmgr_token') || '';
  const res = await fetch(`/api/backup/jobs/${row.id}/download`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return message.error(t('backup.loadFailed'));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = row.file_name || `backup-${row.id}.dnsmgrbk`;
  a.click();
  URL.revokeObjectURL(url);
}

async function openRemote(d: any) {
  remoteDestId.value = Number(d.id);
  remoteFiles.value = [];
  showRemote.value = true;
  await loadRemote();
}

async function loadRemote() {
  if (!remoteDestId.value) return;
  remoteLoading.value = true;
  try {
    const res = await api<any>('GET', `/backup/remote/${remoteDestId.value}`);
    if (res.code !== 0) return message.error(res.msg);
    remoteFiles.value = res.data || [];
  } catch (e: any) {
    message.error(e?.message || t('backup.remoteLoadFailed'));
  } finally {
    remoteLoading.value = false;
  }
}

function restoreRemote(f: any) {
  showRemote.value = false;
  restoreTarget.value = {
    id: 0,
    remote: true,
    destId: remoteDestId.value,
    file_name: f.name,
    scope: f.scope,
    file_size: f.size,
  };
  restoreForm.mode = 'replace';
  restoreForm.confirm = '';
  showRestore.value = true;
}

function openRestore(row: any) {
  restoreTarget.value = row;
  restoreForm.mode = 'replace';
  restoreForm.confirm = '';
  showRestore.value = true;
}

async function doRestore() {
  if (!restoreTarget.value) return;
  restoring.value = true;
  try {
    const body: any = { mode: restoreForm.mode, confirm: restoreForm.confirm };
    if (restoreTarget.value.remote) {
      body.destId = restoreTarget.value.destId;
      body.fileName = restoreTarget.value.file_name;
    } else {
      body.jobId = restoreTarget.value.id;
    }
    const res = await api<any>('POST', '/backup/restore', body);
    if (res.code !== 0) return message.error(res.msg);
    message.success(t('backup.restoreDone'));
    showRestore.value = false;
    await loadAll();
  } catch (e: any) {
    message.error(e?.message || t('backup.restoreFailed'));
  } finally {
    restoring.value = false;
  }
}

function removeJob(row: any) {
  dialog.warning({
    title: t('backup.delete'),
    content: t('backup.deleteConfirm'),
    positiveText: t('backup.delete'),
    negativeText: t('backup.cancel'),
    onPositiveClick: async () => {
      const res = await api<any>('DELETE', `/backup/jobs/${row.id}`);
      if (res.code !== 0) return message.error(res.msg);
      message.success(t('backup.deleted'));
      await loadAll();
    },
  });
}

function openDest(d?: any) {
  destForm.id = d ? Number(d.id) : 0;
  destForm.name = d?.name || '';
  destForm.type = d?.type || 'webdav';
  destForm.config = { ...(d?.config || {}) };
  showDest.value = true;
}

async function saveDest() {
  saving.value = true;
  try {
    const body = { name: destForm.name, type: destForm.type, config: destForm.config };
    const res = destForm.id
      ? await api<any>('PUT', `/backup/destinations/${destForm.id}`, body)
      : await api<any>('POST', '/backup/destinations', body);
    if (res.code !== 0) return message.error(res.msg);
    message.success(t('backup.saved'));
    showDest.value = false;
    await loadAll();
  } finally {
    saving.value = false;
  }
}

async function testDest(d: any) {
  const res = await api<any>('POST', `/backup/destinations/${d.id}/test`, {});
  res.code === 0 ? message.success(res.msg) : message.error(res.msg);
}

function removeDest(d: any) {
  dialog.warning({
    title: t('backup.delete'),
    content: t('backup.destDeleteConfirm'),
    positiveText: t('backup.delete'),
    negativeText: t('backup.cancel'),
    onPositiveClick: async () => {
      await api<any>('DELETE', `/backup/destinations/${d.id}`);
      await loadAll();
    },
  });
}

function openSched(s?: any) {
  Object.assign(schedForm, {
    id: s ? Number(s.id) : 0,
    name: s?.name || '自动备份',
    freq: s?.freq || 'daily',
    hour: Number(s?.hour ?? 3),
    minute: Number(s?.minute ?? 0),
    weekday: Number(s?.weekday ?? 1),
    keep_count: Number(s?.keep_count ?? 7),
    keep_days: Number(s?.keep_days ?? 30),
    dest_id: Number(s?.dest_id ?? 0),
    include_logs: Number(s?.include_logs ?? 0) === 1,
    enabled: s ? Number(s.enabled) === 1 : true,
  });
  showSched.value = true;
}

async function saveSched() {
  saving.value = true;
  try {
    const body = { ...schedForm, include_logs: schedForm.include_logs ? 1 : 0, enabled: schedForm.enabled };
    const res = schedForm.id
      ? await api<any>('PUT', `/backup/schedules/${schedForm.id}`, body)
      : await api<any>('POST', '/backup/schedules', body);
    if (res.code !== 0) return message.error(res.msg);
    message.success(t('backup.saved'));
    showSched.value = false;
    await loadAll();
  } finally {
    saving.value = false;
  }
}

async function runSched(s: any) {
  const res = await api<any>('POST', `/backup/schedules/${s.id}/run`, {});
  res.code === 0 ? message.success(t('backup.exportDone')) : message.error(res.msg);
  await loadAll();
}

function removeSched(s: any) {
  dialog.warning({
    title: t('backup.delete'),
    content: t('backup.deleteConfirm'),
    positiveText: t('backup.delete'),
    negativeText: t('backup.cancel'),
    onPositiveClick: async () => {
      await api<any>('DELETE', `/backup/schedules/${s.id}`);
      await loadAll();
    },
  });
}

onMounted(() => {
  if (String(route.query.tab || '') !== tab.value) {
    router.replace({ path: '/backup', query: { ...route.query, tab: tab.value } });
  }
  if (admin) loadAll();
});
</script>

<style scoped>
.text-dim {
  color: var(--app-text-3);
  font-size: 12px;
}

.remote-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.remote-meta {
  flex: 1;
  min-width: 0;
}

.remote-name {
  font-weight: 500;
  word-break: break-all;
}

@media (max-width: 767px) {
  .remote-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
