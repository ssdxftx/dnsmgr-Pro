<template>
  <div class="app-stack">
    <PageHeader :title="t('totp.title')" :subtitle="t('totp.subtitle')" back="/dashboard" />
    <n-card :bordered="false" style="max-width: 560px">
      <n-result v-if="!enabled" status="info" :title="t('totp.notEnabled')" :description="t('totp.notEnabledDesc')">
        <template #footer>
          <n-button type="primary" :loading="loading" @click="generate">{{ t('totp.enable') }}</n-button>
        </template>
      </n-result>

      <div v-if="step === 'bind'">
        <n-alert type="info" style="margin-bottom: 16px">{{ t('totp.scanHint') }}</n-alert>
        <n-space vertical align="center" style="width:100%">
          <div class="qr-box">
            <img v-if="qrcode" :src="qrDataUrl" :alt="t('totp.qrAlt')" />
            <n-spin v-else />
          </div>
          <n-input-group style="max-width: 380px">
            <n-input :value="secret" readonly />
            <n-button @click="copySecret">{{ t('common.copy') }}</n-button>
          </n-input-group>
          <n-input v-model:value="code" :placeholder="t('totp.codePlaceholder')" maxlength="6" style="max-width: 380px" @keyup.enter="bind" />
          <n-input v-model:value="password" type="password" show-password-on="click" :placeholder="t('totp.passwordPlaceholder')" style="max-width: 380px" />
          <n-space>
            <n-button @click="step = ''">{{ t('common.cancel') }}</n-button>
            <n-button type="primary" :loading="loading" @click="bind">{{ t('totp.confirmBind') }}</n-button>
          </n-space>
        </n-space>
      </div>

      <n-result v-if="enabled && step !== 'bind'" status="success" :title="t('totp.enabled')" :description="t('totp.enabledDesc')">
        <template #footer>
          <n-space vertical align="center">
            <n-input v-model:value="password" type="password" show-password-on="click" :placeholder="t('totp.closePasswordPlaceholder')" style="max-width: 320px" />
            <n-button type="error" :loading="loading" @click="close">{{ t('totp.close') }}</n-button>
          </n-space>
        </template>
      </n-result>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useMessage, useDialog } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import QRCode from 'qrcode';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const step = ref('');
const enabled = ref(false);
const secret = ref('');
const qrcode = ref('');
const code = ref('');
const password = ref('');

const qrDataUrl = ref('');

async function refreshQr() {
  qrDataUrl.value = await QRCode.toDataURL(qrcode.value, { width: 200, margin: 1 });
}

async function generate() {
  loading.value = true;
  const res = await api<any>('POST', '/auth/totp-config', { action: 'generate' });
  loading.value = false;
  if (res.code === 0) {
    secret.value = res.data.secret;
    qrcode.value = res.data.qrcode;
    code.value = '';
    step.value = 'bind';
    await refreshQr();
  } else message.error(res.msg);
}

async function bind() {
  if (!code.value) return message.warning(t('totp.codeRequired'));
  if (!password.value) return message.warning(t('totp.passwordRequired'));
  loading.value = true;
  const res = await api('POST', '/auth/totp-config', { action: 'bind', secret: secret.value, code: code.value, password: password.value });
  loading.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    enabled.value = true;
    step.value = '';
    password.value = '';
  } else message.error(res.msg);
}

function close() {
  if (!password.value) return message.warning(t('totp.passwordRequired'));
  const pwd = password.value;
  dialog.warning({
    title: t('totp.close'),
    content: t('totp.closeConfirm'),
    positiveText: t('common.close'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      loading.value = true;
      const res = await api('POST', '/auth/totp-config', { action: 'close', password: pwd });
      loading.value = false;
      if (res.code === 0) {
        message.success(res.msg);
        enabled.value = false;
        password.value = '';
      } else message.error(res.msg);
    },
  });
}

function copySecret() {
  navigator.clipboard?.writeText(secret.value).then(() => message.success(t('common.copied'))).catch(() => message.warning(t('totp.copyFailed')));
}

onMounted(async () => {
  const res = await api<any>('GET', '/auth/me');
  if (res.code === 0) enabled.value = res.data.totp_open == 1;
});
</script>

<style scoped>
.qr-box {
  width: 220px;
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--app-border);
  border-radius: 14px;
  background: var(--app-surface-2);
  box-shadow: var(--app-shadow-sm);
  padding: 10px;
  position: relative;
  overflow: hidden;
}
.qr-box::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--app-primary) 60%, transparent), transparent);
}
.qr-box img { width: 100%; height: 100%; border-radius: 8px; }
</style>