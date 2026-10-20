<template>
  <div class="app-stack">
    <PageHeader v-if="!embedded" :title="t('myBackup.title')" :subtitle="t('myBackup.subtitle')" />

    <n-alert v-if="loadError" type="error" :show-icon="true">
      {{ t('common.loadFailedHint') }}
      <n-button size="tiny" type="primary" style="margin-left: 8px" @click="load">{{ t('common.retry') }}</n-button>
    </n-alert>

    <n-alert v-else-if="vault.initialized === false" type="warning">
      {{ t('myBackup.vaultNeeded') }}
      <router-link :to="{ path: '/backup', query: { tab: 'vault' } }">{{ t('myBackup.goVault') }}</router-link>
    </n-alert>
    <n-alert v-else-if="vault.mode === 'none'" type="warning">{{ t('myBackup.convenientWarning') }}</n-alert>

    <n-card :bordered="false">
      <template #header>{{ t('myBackup.exportTitle') }}</template>
      <p class="text-dim">{{ t('myBackup.exportHint') }}</p>
      <n-form v-if="vault.mode === 'passphrase'" label-placement="top">
        <n-form-item :label="t('myBackup.passphraseLabel')">
          <n-input v-model:value="exportPass" type="password" show-password-on="click" :placeholder="t('myBackup.passphraseHint')" />
        </n-form-item>
      </n-form>
      <n-button type="primary" :loading="exporting" :disabled="vault.initialized === false" @click="doExport">
        {{ t('myBackup.exportNow') }}
      </n-button>
    </n-card>

    <n-card :bordered="false">
      <template #header>{{ t('myBackup.importTitle') }}</template>
      <p class="text-dim">{{ t('myBackup.importHint') }}</p>
      <div class="app-toolbar">
        <label class="file-btn">
          <input ref="fileEl" type="file" accept=".dnsmgrbk" @change="onFile" />
          {{ t('myBackup.chooseFile') }}
        </label>
        <span class="text-dim">{{ file?.name || t('myBackup.noFile') }}</span>
      </div>
      <n-form label-placement="top">
        <n-form-item :label="t('myBackup.passphraseLabel')">
          <n-input v-model:value="importPass" type="password" show-password-on="click" :placeholder="t('myBackup.passphraseHint')" />
        </n-form-item>
      </n-form>
      <n-space>
        <n-button :loading="importing" :disabled="!file" @click="doImport(true)">{{ t('myBackup.dryRun') }}</n-button>
        <n-button type="primary" :loading="importing" :disabled="!file" @click="doImport(false)">{{ t('myBackup.importNow') }}</n-button>
      </n-space>
      <n-alert v-if="report" type="success" class="mt-3" :show-icon="true">
        {{ report.dryRun ? t('myBackup.dryRun') : t('myBackup.importNow') }}:
        {{ t('myBackup.importInserted') }} {{ reportTotals.inserted }} /
        {{ t('myBackup.importReused') }} {{ reportTotals.reused }} /
        {{ t('myBackup.importSkipped') }} {{ reportTotals.skipped }}
      </n-alert>
    </n-card>

    <n-card :bordered="false">
      <template #header>{{ t('myBackup.jobsTitle') }}</template>
      <ResponsiveDataTable :columns="columns" :data="jobs" :loading="loading" :empty-text="t('myBackup.jobsEmpty')" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, useDialog, useMessage } from 'naive-ui';
import { api, getToken } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });
const embedded = computed(() => props.embedded);

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const vault = ref<any>({});
const jobs = ref<any[]>([]);
const loading = ref(false);
const exporting = ref(false);
const importing = ref(false);
const exportPass = ref('');
const importPass = ref('');
const fileEl = ref<HTMLInputElement | null>(null);
const file = ref<File | null>(null);
const report = ref<any>(null);
const loadError = ref(false);
const reportTotals = computed(() => {
  const out = { inserted: 0, reused: 0, skipped: 0 };
  for (const r of Object.values(report.value?.tables || {}) as any[]) {
    out.inserted += Number(r.inserted || 0);
    out.reused += Number(r.reused || 0);
    out.skipped += Number(r.skipped || 0);
  }
  return out;
});

const columns = computed(() => [
  { title: t('backup.colTime'), key: 'created_at', width: 170 },
  { title: t('backup.colSize'), key: 'file_size', width: 110, render: (r: any) => fmtSize(r.file_size) },
  { title: t('backup.colStatus'), key: 'status', width: 100, render: (r: any) => statusText(r.status) },
  {
    title: t('backup.colActions'),
    key: 'actions',
    width: 160,
    fixed: 'right' as const,
    render: (row: any) =>
      h(NSpace, { size: 4 }, {
        default: () => [
          h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => download(row) }, { default: () => t('myBackup.download') }),
          h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => remove(row) }, { default: () => t('myBackup.delete') }),
        ],
      }),
  },
]);

function fmtSize(n: any) {
  const bytes = Number(n || 0);
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' ' + t('backup.unitMb');
}

function statusText(s: string) {
  return s === 'success' ? t('backup.statusSuccess') : s === 'failed' ? t('backup.statusFailed') : t('backup.statusRunning');
}

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const [v, j] = await Promise.all([api<any>('GET', '/vault/status'), api<any>('GET', '/backup/jobs')]);
    if (v.code !== 0 || j.code !== 0) throw new Error(v.msg || j.msg || 'load failed');
    vault.value = v?.data || {};
    jobs.value = (j?.data || []).filter((x: any) => x.scope === 'user');
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function doExport() {
  exporting.value = true;
  try {
    const res = await api<any>('POST', '/backup/export', {
      scope: 'user',
      include_logs: true,
      passphrase: exportPass.value || undefined,
    });
    if (res.code !== 0) return message.error(res.msg);
    message.success(t('backup.exportDone'));
    await load();
  } catch (e: any) {
    message.error(e?.message || t('backup.loadFailed'));
  } finally {
    exporting.value = false;
  }
}

function onFile(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] || null;
}

async function doImport(dryRun: boolean, confirmed = false) {
  if (!file.value) return;
  if (!dryRun && !confirmed) {
    dialog.warning({
      title: t('myBackup.importNow'),
      content: t('myBackup.importConfirm'),
      positiveText: t('myBackup.importNow'),
      negativeText: t('backup.cancel'),
      onPositiveClick: () => doImport(false, true),
    });
    return;
  }
  importing.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file.value);
    fd.append('mode', 'merge');
    fd.append('dry_run', dryRun ? 'true' : 'false');
    if (importPass.value) fd.append('passphrase', importPass.value);
    const res = await fetch('/api/backup/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken() },
      body: fd,
    });
    const json = await res.json();
    if (json.code !== 0) return message.error(json.msg);
    report.value = json.data;
    message.success(json.msg);
    if (!dryRun) await load();
  } catch (e: any) {
    message.error(e?.message || t('backup.loadFailed'));
  } finally {
    importing.value = false;
  }
}

async function download(row: any) {
  const res = await fetch(`/api/backup/jobs/${row.id}/download`, { headers: { Authorization: 'Bearer ' + getToken() } });
  if (!res.ok) return message.error(t('backup.loadFailed'));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = row.file_name || `backup-${row.id}.dnsmgrbk`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function remove(row: any) {
  dialog.warning({
    title: t('myBackup.delete'),
    content: t('myBackup.deleteConfirm'),
    positiveText: t('myBackup.delete'),
    negativeText: t('backup.cancel'),
    onPositiveClick: async () => {
      const res = await api<any>('DELETE', `/backup/jobs/${row.id}`);
      if (res.code !== 0) return message.error(res.msg);
      await load();
    },
  });
}

onMounted(load);
</script>

<style scoped>
.file-btn {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid var(--app-border, #3a3f4b);
  cursor: pointer;
  font-size: 14px;
}
.file-btn input {
  display: none;
}
.text-dim {
  color: var(--app-text-3);
  font-size: 12px;
}
</style>
