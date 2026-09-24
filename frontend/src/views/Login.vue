<template>
  <AuthShell>
    <n-card class="auth-card" :bordered="false">
      <div class="auth-head">
        <h2>欢迎回来</h2>
        <p>登录以继续管理你的 DNS 与 CDN</p>
      </div>
      <n-form v-if="!needTotp" :model="form" @keyup.enter="onLogin">
        <n-form-item label="用户名">
          <n-input v-model:value="form.username" placeholder="请输入用户名" size="large" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input v-model:value="form.password" type="password" show-password-on="click" placeholder="请输入密码" size="large" />
        </n-form-item>
        <n-button type="primary" size="large" block :loading="loading" @click="onLogin">登 录</n-button>
        <n-button text style="margin-top: 12px; width: 100%" @click="router.push('/register')">没有账号？注册一个</n-button>
      </n-form>
      <div v-else>
        <n-alert type="info" style="margin-bottom: 16px">该账户已开启两步验证，请输入动态口令</n-alert>
        <n-form @keyup.enter="onTotp">
          <n-form-item label="动态口令">
            <n-input v-model:value="totpCode" placeholder="请输入 6 位动态口令" size="large" maxlength="6" />
          </n-form-item>
          <n-button type="primary" size="large" block :loading="loading" @click="onTotp">验 证</n-button>
        </n-form>
        <n-button style="margin-top: 12px" text @click="resetLogin">返回登录</n-button>
      </div>
    </n-card>
  </AuthShell>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { api, setToken, setUser } from '../api';
import { useAuthStore } from '../stores/auth';
import AuthShell from '../components/AuthShell.vue';

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
    message.warning('请输入用户名和密码');
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
    message.error(e.message || '网络错误');
  } finally {
    loading.value = false;
  }
}

async function onTotp() {
  if (!totpCode.value) {
    message.warning('请输入动态口令');
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
    message.error(e.message || '网络错误');
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