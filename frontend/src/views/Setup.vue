<template>
  <AuthShell max-width="560px">
    <n-card class="auth-card" :bordered="false">
      <div class="auth-head">
        <h2>{{ t('setup.title') }}</h2>
        <p>{{ t('setup.subtitle') }}</p>
      </div>

      <n-alert v-if="detected" type="info" style="margin-bottom: 16px">
        {{ t('setup.dbDetected') }}
      </n-alert>
      <n-alert v-else-if="checked" type="success" style="margin-bottom: 16px">
        {{ t('setup.dbConnected') }}
      </n-alert>

      <n-form :model="form" label-placement="top">
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
        <n-form-item :label="t('setup.dbPrefix')">
          <n-input v-model:value="form.db_prefix" :placeholder="t('setup.dbPrefixPlaceholder')" />
        </n-form-item>

        <n-divider title-placement="left">{{ t('setup.adminSection') }}</n-divider>

        <n-form-item :label="t('setup.adminUsername')">
          <n-input v-model:value="form.admin_username" :placeholder="t('setup.freshOnly')" />
        </n-form-item>
        <n-form-item :label="t('setup.adminPassword')">
          <n-input v-model:value="form.admin_password" type="password" show-password-on="click" :placeholder="t('setup.freshOnly')" />
        </n-form-item>

        <n-space vertical>
          <n-button block :loading="checking" @click="onCheck">{{ t('setup.testConnection') }}</n-button>
          <n-button type="primary" block :loading="installing" @click="onInstall">{{ t('setup.installNow') }}</n-button>
        </n-space>
      </n-form>
    </n-card>
  </AuthShell>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import AuthShell from '../components/AuthShell.vue';

const { t } = useI18n();
const router = useRouter();
const message = useMessage();
const checking = ref(false);
const installing = ref(false);
const checked = ref(false);
const detected = ref(false);
const form = reactive({
  db_host: '127.0.0.1',
  db_port: 3306,
  db_user: '',
  db_password: '',
  db_name: 'dnsmgr',
  db_prefix: 'dnsmgr_',
  admin_username: 'admin',
  admin_password: '',
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function onCheck() {
  if (!form.db_host || !form.db_user || !form.db_name) {
    message.warning(t('setup.dbInfoRequired'));
    return;
  }
  checking.value = true;
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
    checking.value = false;
  }
}

async function onInstall() {
  if (!form.db_host || !form.db_user || !form.db_name) {
    message.warning(t('setup.dbConnRequired'));
    return;
  }
  if (!detected.value && (!form.admin_username || !form.admin_password)) {
    message.warning(t('setup.adminRequired'));
    return;
  }
  installing.value = true;
  try {
    const res = await api<any>('POST', '/setup/install', form);
    if (res.code === 0) {
      message.success(res.msg);
      await waitRestart();
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || t('setup.networkError'));
  } finally {
    installing.value = false;
  }
}

async function waitRestart() {
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
    }
  } catch {
    /* ignore */
  }
});
</script>