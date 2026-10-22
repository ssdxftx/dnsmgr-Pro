<template>
  <AuthShell max-width="560px">
    <n-card class="auth-card" :bordered="false">
      <div class="auth-head">
        <h2>{{ t('setup.title') }}</h2>
        <p>{{ t('setup.subtitle') }}</p>
      </div>

      <n-alert v-if="detected" type="info" class="mb-4">
        {{ t('setup.dbDetected') }}
      </n-alert>
      <n-alert v-else-if="checked" type="success" class="mb-4">
        {{ t('setup.dbConnected') }}
      </n-alert>

      <n-form :model="form" label-placement="top">
        <n-form-item :label="t('setup.dbType')">
          <n-radio-group v-model:value="form.db_type" @update:value="onDbTypeChange">
            <n-radio-button value="sqlite" :disabled="!sqliteAvailable">{{ t('setup.dbTypeSqlite') }}</n-radio-button>
            <n-radio-button value="mysql">{{ t('setup.dbTypeMysql') }}</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <p class="text-dim db-type-hint">{{ dbTypeHint }}</p>

        <n-alert v-if="form.db_type === 'sqlite'" type="warning" class="mb-4">
          {{ t('setup.sqliteWarning') }}
        </n-alert>

        <n-form-item v-if="form.db_type === 'sqlite'" :label="t('setup.sqliteFile')">
          <n-input :value="sqlitePath" readonly />
        </n-form-item>

        <template v-if="form.db_type === 'mysql'">
          <n-form-item :label="t('setup.dbHost')">
            <n-input v-model:value="form.db_host" :placeholder="t('setup.dbHostPlaceholder')" />
          </n-form-item>
          <n-form-item :label="t('setup.dbPort')">
            <n-input-number v-model:value="form.db_port" :min="1" :max="65535" style="width: 100%" />
          </n-form-item>
          <n-form-item :label="t('setup.dbUser')">
            <n-input v-model:value="form.db_user" :placeholder="t('setup.dbUserPlaceholder')" />
          </n-form-item>
          <n-form-item :label="t('setup.dbPassword')">
            <n-input v-model:value="form.db_password" type="password" show-password-on="click" :placeholder="t('setup.dbPasswordPlaceholder')" />
          </n-form-item>
          <n-form-item :label="t('setup.dbName')">
            <n-input v-model:value="form.db_name" :placeholder="t('setup.dbNamePlaceholder')" />
          </n-form-item>
        </template>

        <n-form-item :label="t('setup.dbPrefix')">
          <n-input v-model:value="form.db_prefix" :placeholder="t('setup.dbPrefixPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('setup.setupToken')">
          <n-input v-model:value="form.setup_token" type="password" show-password-on="click" :placeholder="t('setup.setupTokenPlaceholder')" />
        </n-form-item>

        <n-divider title-placement="left">{{ t('setup.adminSection') }}</n-divider>

        <n-form-item :label="t('setup.adminUsername')">
          <n-input v-model:value="form.admin_username" :placeholder="t('setup.freshOnly')" />
        </n-form-item>
        <n-form-item :label="t('setup.adminPassword')">
          <n-input v-model:value="form.admin_password" type="password" show-password-on="click" :placeholder="t('setup.freshOnly')" />
        </n-form-item>

        <n-space vertical>
          <n-button block :loading="checkBusy" @click="onCheck">{{ t('setup.testConnection') }}</n-button>
          <n-button type="primary" block :loading="installBusy" @click="onInstall">{{ t('setup.installNow') }}</n-button>
        </n-space>
      </n-form>

      <n-card v-if="showImport" size="small" :bordered="true" class="mt-4">
        <h3 style="margin-top: 0">{{ t('setup.importTitle') }}</h3>
        <p class="text-dim">{{ t('setup.importHint') }}</p>
        <div class="app-toolbar">
          <input ref="fileEl" type="file" accept=".dnsmgrbk" @change="onFile" />
          <span class="text-dim">{{ importFile?.name || t('setup.importFile') }}</span>
        </div>
        <n-input v-model:value="importKey" type="password" show-password-on="click" :placeholder="t('setup.importKey')" class="mt-3" />
        <n-input v-model:value="importPass" type="password" show-password-on="click" :placeholder="t('setup.importPassphrase')" class="mt-3" />
        <n-space class="mt-3">
          <n-button type="primary" :loading="importBusy" :disabled="!importFile" @click="doImport">{{ t('setup.importNow') }}</n-button>
          <n-button quaternary :disabled="importBusy" @click="skipImport">{{ t('setup.skip') }}</n-button>
        </n-space>
      </n-card>
    </n-card>
  </AuthShell>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import AuthShell from '../components/AuthShell.vue';

const { t } = useI18n();
const router = useRouter();
const message = useMessage();
const checkBusy = ref(false);
const installBusy = ref(false);
const importBusy = ref(false);
const showImport = ref(false);
const installToken = ref('');
const importFile = ref<File | null>(null);
const importPass = ref('');
const importKey = ref('');
const fileEl = ref<HTMLInputElement | null>(null);
const checked = ref(false);
const detected = ref(false);
const sqliteAvailable = ref(false);
const sqlitePath = ref('');
const dataDir = ref('');
const sqliteReason = ref('');
const form = reactive({
  db_type: 'mysql' as 'mysql' | 'sqlite',
  db_host: '127.0.0.1',
  db_port: 3306,
  db_user: '',
  db_password: '',
  db_name: 'dnsmgr',
  db_prefix: 'dnsmgr_',
  db_file: '',
  setup_token: '',
  admin_username: 'admin',
  admin_password: '',
});

const dbTypeHint = computed(() => {
  if (sqliteAvailable.value) return t('setup.sqliteAvailableHint', { dir: dataDir.value });
  return t('setup.sqliteUnavailableHint', { reason: sqliteReason.value || t('setup.sqliteChecking') });
});

function onDbTypeChange(): void {
  checked.value = false;
  detected.value = false;
}

function validateConnection(): boolean {
  if (form.db_type === 'sqlite') return true;
  if (!form.db_host || !form.db_user || !form.db_name) {
    message.warning(t('setup.dbInfoRequired'));
    return false;
  }
  return true;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function onCheck() {
  if (!validateConnection()) return;
  checkBusy.value = true;
  try {
    const res = await api<any>('POST', '/setup/check', form);
    if (res.code === 0) {
      checked.value = true;
      detected.value = !!res.data.initialized;
      message.success(res.msg);
    } else {
      checked.value = false;
      detected.value = false;
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || t('setup.networkError'));
  } finally {
    checkBusy.value = false;
  }
}

async function onInstall() {
  if (!validateConnection()) {
    message.warning(t('setup.dbConnRequired'));
    return;
  }
  if (!detected.value && (!form.admin_username || !form.admin_password)) {
    message.warning(t('setup.adminRequired'));
    return;
  }
  installBusy.value = true;
  try {
    const res = await api<any>('POST', '/setup/install', form);
    if (res.code === 0) {
      const token = res?.data?.install_token;
      if (token) {
        installToken.value = token;
        showImport.value = true;
        message.success(res.msg);
      } else {
        message.success(res.msg);
        await waitRestart();
      }
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || t('setup.networkError'));
  } finally {
    installBusy.value = false;
  }
}

function onFile(e: Event) {
  importFile.value = (e.target as HTMLInputElement).files?.[0] || null;
}

async function doImport() {
  if (!importFile.value) return;
  importBusy.value = true;
  try {
    const fd = new FormData();
    fd.append('file', importFile.value);
    fd.append('install_token', installToken.value);
    if (importKey.value) fd.append('backup_key', importKey.value);
    if (importPass.value) fd.append('passphrase', importPass.value);
    const res = await fetch('/api/setup/import', { method: 'POST', body: fd });
    const json = await res.json();
    if (json.code !== 0) return message.error(json.msg || t('setup.importFailed'));
    message.success(t('setup.importDone'));
    await waitRestart();
  } catch (e: any) {
    message.error(e?.message || t('setup.importFailed'));
  } finally {
    importBusy.value = false;
  }
}

async function skipImport() {
  importBusy.value = true;
  try {
    await fetch('/api/setup/skip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_token: installToken.value }),
    });
    await waitRestart();
  } finally {
    importBusy.value = false;
  }
}

async function waitRestart() {
  // 服务端会先退出再被编排拉起，先等待退出，避免读到重启前的状态
  await sleep(2500);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    try {
      const res = await fetch('/api/setup/status');
      const json = await res.json();
      if (json?.data?.installed) {
        message.success(t('setup.installDone'));
        router.push('/login');
        return;
      }
    } catch {
      // 进程重启中，继续等待
    }
  }
  message.warning(t('setup.stillStarting'));
}

onMounted(async () => {
  try {
    const res = await api<any>('GET', '/setup/status');
    if (res.code === 0 && res.data?.installed) {
      router.replace('/login');
      return;
    }
    const data = res.data || {};
    sqliteAvailable.value = !!data.sqlite_available;
    sqlitePath.value = String(data.sqlite_path || '');
    dataDir.value = String(data.data_dir || '');
    sqliteReason.value = String(data.sqlite_reason || '');
    form.db_type = data.default_db_type === 'sqlite' && sqliteAvailable.value ? 'sqlite' : 'mysql';
  } catch {
    sqliteReason.value = t('setup.networkError');
  }
});
</script>
<style scoped>
.text-dim {
  color: var(--app-text-3);
  font-size: 12px;
}

.db-type-hint {
  margin: -8px 0 16px;
  line-height: 1.5;
}
</style>
