<template>
  <AuthShell>
    <n-card class="auth-card" :bordered="false">
      <div class="auth-head">
        <h2>{{ t('login.welcome') }}</h2>
        <p>{{ t('login.subtitle') }}</p>
      </div>
      <n-form v-if="!needTotp" :model="form" @keyup.enter="onLogin">
        <n-form-item :label="t('login.username')">
          <n-input v-model:value="form.username" :placeholder="t('login.usernamePlaceholder')" size="large" />
        </n-form-item>
        <n-form-item :label="t('login.password')">
          <n-input v-model:value="form.password" type="password" show-password-on="click" :placeholder="t('login.passwordPlaceholder')" size="large" />
        </n-form-item>
        <n-button type="primary" size="large" block :loading="loading" @click="onLogin">{{ t('login.submit') }}</n-button>
        <n-button text style="margin-top: 12px; width: 100%" @click="router.push('/register')">{{ t('login.toRegister') }}</n-button>
      </n-form>
      <div v-else>
        <n-alert type="info" style="margin-bottom: 16px">{{ t('login.totpAlert') }}</n-alert>
        <n-form @keyup.enter="onTotp">
          <n-form-item :label="t('login.totp')">
            <n-input v-model:value="totpCode" :placeholder="t('login.totpPlaceholder')" size="large" maxlength="6" />
          </n-form-item>
          <n-button type="primary" size="large" block :loading="loading" @click="onTotp">{{ t('login.verify') }}</n-button>
        </n-form>
        <n-button style="margin-top: 12px" text @click="resetLogin">{{ t('login.backToLogin') }}</n-button>
      </div>
    </n-card>
  </AuthShell>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, setToken, setUser } from '../api';
import { useAuthStore } from '../stores/auth';
import AuthShell from '../components/AuthShell.vue';

const { t } = useI18n();
const router = useRouter();
const message = useMessage();
const auth = useAuthStore();
const loading = ref(false);
const form = reactive({ username: '', password: '' });
const needTotp = ref(false);
const preToken = ref('');
const totpCode = ref('');

async function doSuccess(res: any) {
  setToken(res.data.token);
  setUser(res.data.user);
  auth.setAuth(res.data.token, res.data.user);
  message.success(res.msg);
  router.push('/dashboard');
}

async function onLogin() {
  if (!form.username || !form.password) {
    message.warning(t('login.requiredInput'));
    return;
  }
  loading.value = true;
  try {
    const res = await api<any>('POST', '/auth/login', form);
    if (res.code === 0) {
      await doSuccess(res);
    } else if (res.vcode === 2) {
      needTotp.value = true;
      preToken.value = res.data?.pre_token || '';
      totpCode.value = '';
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || t('login.networkError'));
  } finally {
    loading.value = false;
  }
}

async function onTotp() {
  if (!totpCode.value) {
    message.warning(t('login.totpRequired'));
    return;
  }
  loading.value = true;
  try {
    const res = await api<any>('POST', '/auth/totp', { pre_token: preToken.value, code: totpCode.value });
    if (res.code === 0) {
      await doSuccess(res);
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || t('login.networkError'));
  } finally {
    loading.value = false;
  }
}

function resetLogin() {
  needTotp.value = false;
  preToken.value = '';
  totpCode.value = '';
  form.password = '';
}
</script>