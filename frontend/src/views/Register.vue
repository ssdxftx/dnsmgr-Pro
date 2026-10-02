<template>
  <AuthShell>
    <n-card class="auth-card" :bordered="false">
      <div class="auth-head">
        <h2>{{ t('register.title') }}</h2>
        <p>{{ t('register.subtitle') }}</p>
      </div>

      <n-alert v-if="!loading && !config.enable" type="warning" style="margin-bottom: 16px">
        {{ t('register.disabled') }}
      </n-alert>

      <template v-else-if="!loading">
        <n-form :model="form" label-placement="top">
          <n-form-item :label="t('register.username')">
            <n-input v-model:value="form.username" :placeholder="t('register.usernamePlaceholder')" size="large" />
          </n-form-item>
          <n-form-item :label="t('register.password')">
            <n-input v-model:value="form.password" type="password" show-password-on="click" :placeholder="t('register.passwordPlaceholder')" size="large" />
          </n-form-item>
          <n-form-item :label="t('register.confirmPassword')">
            <n-input v-model:value="form.password2" type="password" show-password-on="click" :placeholder="t('register.confirmPasswordPlaceholder')" size="large" />
          </n-form-item>

          <template v-if="config.mode === 'email'">
            <n-form-item :label="t('register.email')">
              <n-input v-model:value="form.email" :placeholder="t('register.emailPlaceholder')" size="large" />
            </n-form-item>
            <n-form-item :label="t('register.emailCode')">
              <n-input-group>
                <n-input v-model:value="form.code" :placeholder="t('register.emailCodePlaceholder')" size="large" maxlength="6" />
                <n-button size="large" :disabled="countdown > 0 || sending" @click="onSendCode">
                  {{ countdown > 0 ? countdown + 's' : sending ? t('register.sending') : t('register.sendCode') }}
                </n-button>
              </n-input-group>
            </n-form-item>
          </template>

          <template v-else>
            <n-form-item :label="t('register.regCode')">
              <n-input v-model:value="form.reg_code" :placeholder="t('register.regCodePlaceholder')" size="large" />
            </n-form-item>
            <n-form-item :label="t('register.emailOptional')">
              <n-input v-model:value="form.email" :placeholder="t('register.emailOptionalPlaceholder')" size="large" />
            </n-form-item>
          </template>

          <n-button type="primary" size="large" block :loading="registering" @click="onRegister">{{ t('register.submit') }}</n-button>
        </n-form>
        <n-button text style="margin-top: 12px; width: 100%" @click="router.push('/login')">{{ t('register.toLogin') }}</n-button>
      </template>
    </n-card>
  </AuthShell>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import AuthShell from '../components/AuthShell.vue';

const { t } = useI18n();
const router = useRouter();
const message = useMessage();
const loading = ref(true);
const registering = ref(false);
const sending = ref(false);
const countdown = ref(0);
const config = reactive<{ enable: boolean; mode: string }>({ enable: false, mode: 'email' });
const form = reactive({ username: '', password: '', password2: '', email: '', code: '', reg_code: '' });

let timer: any = null;

onMounted(async () => {
  try {
    const res = await api<any>('GET', '/register/config');
    if (res.code === 0) {
      config.enable = res.data.enable;
      config.mode = res.data.mode || 'email';
    }
  } catch {
    /* ignore */
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

async function onSendCode() {
  if (!form.email) {
    message.warning(t('register.emailRequired'));
    return;
  }
  sending.value = true;
  try {
    const res = await api<any>('POST', '/register/send-code', { email: form.email });
    if (res.code === 0) {
      message.success(res.msg);
      countdown.value = 60;
      timer = setInterval(() => {
        countdown.value--;
        if (countdown.value <= 0) clearInterval(timer);
      }, 1000);
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || t('register.networkError'));
  } finally {
    sending.value = false;
  }
}

async function onRegister() {
  if (form.username.length < 3) return message.warning(t('register.usernameMin'));
  if (form.password.length < 6) return message.warning(t('register.passwordMin'));
  if (form.password !== form.password2) return message.warning(t('register.passwordMismatch'));
  if (config.mode === 'email' && !form.code) return message.warning(t('register.emailCodeRequired'));
  if (config.mode === 'code' && !form.reg_code) return message.warning(t('register.regCodeRequired'));

  registering.value = true;
  try {
    const body: Record<string, string> = { username: form.username, password: form.password };
    if (config.mode === 'email') {
      body.email = form.email;
      body.code = form.code;
    } else {
      body.reg_code = form.reg_code;
      if (form.email) body.email = form.email;
    }
    const res = await api<any>('POST', '/register', body);
    if (res.code === 0) {
      message.success(res.msg);
      router.push('/login');
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || t('register.networkError'));
  } finally {
    registering.value = false;
  }
}
</script>