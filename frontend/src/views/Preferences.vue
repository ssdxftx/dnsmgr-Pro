<template>
  <div class="app-stack">
    <PageHeader :title="t('preferences.title')" :subtitle="t('preferences.subtitle')" />
    <n-card :bordered="false" :title="t('preferences.languageTitle')" size="small" style="max-width:720px">
      <n-radio-group :value="locale" @update:value="onChange">
        <n-space>
          <n-radio-button value="zh-CN">{{ t('common.chinese') }}</n-radio-button>
          <n-radio-button value="en-US">{{ t('common.english') }}</n-radio-button>
        </n-space>
      </n-radio-group>
      <p class="pref-hint">{{ t('preferences.languageHint') }}</p>
    </n-card>

    <n-card :bordered="false" :title="t('preferences.apiKeysTitle')" size="small" style="max-width:920px">
      <template #header-extra>
        <n-space :size="6">
          <n-button size="small" type="primary" @click="openCreate">{{ t('preferences.createKey') }}</n-button>
          <n-button v-if="keys.length" size="small" quaternary type="error" @click="askReauth('revokeAll')">{{ t('preferences.revokeAll') }}</n-button>
        </n-space>
      </template>
      <p class="pref-hint">{{ t('preferences.apiKeysHint') }}</p>

      <n-alert v-if="legacy.enabled" type="warning" :bordered="false" class="legacy-alert">
        {{ t('preferences.legacyHint', { prefix: legacy.prefix }) }}
        <n-button text type="error" size="small" @click="askReauth('legacy')">{{ t('preferences.disableLegacy') }}</n-button>
      </n-alert>

      <n-table v-if="keys.length" :single-line="false" size="small">
        <thead>
          <tr>
            <th>{{ t('preferences.keyName') }}</th>
            <th>{{ t('preferences.keyPrefix') }}</th>
            <th>{{ t('preferences.scopes') }}</th>
            <th>{{ t('preferences.expires') }}</th>
            <th>{{ t('preferences.lastUsed') }}</th>
            <th>{{ t('preferences.status') }}</th>
            <th>{{ t('preferences.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="key in keys" :key="key.id">
            <td>{{ key.name || ('#' + key.id) }}</td>
            <td class="mono">{{ key.key_prefix }}…</td>
            <td class="scope-cell">{{ (key.scopes || []).join(', ') }}</td>
            <td>{{ key.expires_at || t('preferences.never') }}</td>
            <td>{{ key.last_used_at || t('preferences.never') }}<span v-if="key.last_used_ip" class="muted"> / {{ key.last_used_ip }}</span></td>
            <td>
              <n-tag size="small" :type="key.active && !key.expired ? 'success' : 'default'" :bordered="false">
                {{ key.active && !key.expired ? t('preferences.active') : (key.expired ? t('preferences.expired') : t('preferences.revoked')) }}
              </n-tag>
            </td>
            <td>
              <n-space :size="6">
                <n-button size="tiny" quaternary type="primary" @click="askReauth('rotate', key.id)">{{ t('preferences.rotate') }}</n-button>
                <n-button size="tiny" quaternary type="error" @click="askReauth('revoke', key.id)">{{ t('preferences.revoke') }}</n-button>
              </n-space>
            </td>
          </tr>
        </tbody>
      </n-table>
      <n-empty v-else :description="t('preferences.noKeys')" />
    </n-card>

    <n-modal v-model:show="createShow" preset="card" :title="t('preferences.createKey')" style="max-width:640px">
      <n-form label-placement="top">
        <n-form-item :label="t('preferences.keyName')">
          <n-input v-model:value="createForm.name" :placeholder="t('preferences.keyNamePlaceholder')" maxlength="64" />
        </n-form-item>
        <n-form-item :label="t('preferences.scopes')">
          <n-select v-model:value="createForm.scopes" multiple filterable :options="scopeOptions" :placeholder="t('preferences.scopesPlaceholder')" />
          <p class="pref-hint">{{ t('preferences.scopesHint') }}</p>
        </n-form-item>
        <n-form-item :label="t('preferences.expires')">
          <n-date-picker v-model:value="createForm.expiresAt" type="datetime" clearable style="width:100%" />
        </n-form-item>
        <n-form-item :label="t('preferences.ipAllowlist')">
          <n-input v-model:value="createForm.ipAllowlist" type="textarea" :rows="2" :placeholder="t('preferences.ipPlaceholder')" />
          <p class="pref-hint">{{ t('preferences.ipHint') }}</p>
        </n-form-item>
        <n-form-item :label="t('preferences.password')">
          <n-input v-model:value="createForm.password" type="password" show-password-on="click" :placeholder="t('preferences.passwordHint')" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="createShow = false">{{ t('preferences.cancel') }}</n-button>
          <n-button type="primary" :loading="submitting" @click="submitCreate">{{ t('preferences.confirm') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="secretShow" preset="card" :title="t('preferences.createdTitle')" style="max-width:680px">
      <n-alert type="success" :bordered="false">{{ t('preferences.createdHint') }}</n-alert>
      <n-input :value="createdKey" type="textarea" :rows="3" readonly class="secret-box" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="copyCreated">{{ t('preferences.copy') }}</n-button>
          <n-button type="primary" @click="secretShow = false">{{ t('preferences.close') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="reauthShow" preset="card" :title="t('preferences.reauthTitle')" style="max-width:520px">
      <p class="pref-hint">{{ reauthHint }}</p>
      <n-input v-model:value="reauthPassword" type="password" show-password-on="click" :placeholder="t('preferences.passwordHint')" @keyup.enter="submitReauth" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="reauthShow = false">{{ t('preferences.cancel') }}</n-button>
          <n-button type="primary" :loading="submitting" @click="submitReauth">{{ t('preferences.confirm') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NAlert, NButton, NCard, NDatePicker, NEmpty, NForm, NFormItem, NInput, NModal,
  NRadioButton, NRadioGroup, NSelect, NSpace, NTable, NTag, useMessage,
} from 'naive-ui';
import PageHeader from '../components/PageHeader.vue';
import { useLocale } from '../composables/useLocale';
import type { AppLocale } from '../i18n';
import { api } from '../api';

interface ApiKeyRow {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string[];
  ip_allowlist: string[];
  active: number;
  expired: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
}

const { t } = useI18n();
const { locale, setLocale } = useLocale();
const message = useMessage();

const keys = ref<ApiKeyRow[]>([]);
const legacy = reactive({ enabled: false, prefix: '' });
const modules = ref<string[]>([]);
const createShow = ref(false);
const secretShow = ref(false);
const reauthShow = ref(false);
const submitting = ref(false);
const createdKey = ref('');
const reauthPassword = ref('');
const pending = reactive<{ action: 'rotate' | 'revoke' | 'legacy' | 'revokeAll'; id: number }>({ action: 'revoke', id: 0 });
const createForm = reactive({
  name: '',
  scopes: ['*'] as string[],
  expiresAt: null as number | null,
  ipAllowlist: '',
  password: '',
});

const scopeOptions = computed(() => {
  const list = modules.value.length ? modules.value : ['*'];
  return [
    { label: t('preferences.allScopes'), value: '*' },
    ...list.map((m) => ({ label: m, value: `${m}:*` })),
  ];
});

const reauthHint = computed(() => {
  if (pending.action === 'legacy') return t('preferences.reauthLegacy');
  if (pending.action === 'rotate') return t('preferences.reauthRotate');
  if (pending.action === 'revokeAll') return t('preferences.reauthRevokeAll');
  return t('preferences.reauthRevoke');
});

async function onChange(value: string) {
  await setLocale(value as AppLocale);
  message.success(t('preferences.languageSaved'));
}

async function load() {
  const [listRes, scopeRes] = await Promise.all([
    api<any>('GET', '/api-keys', undefined, { force: true }),
    api<any>('GET', '/api-keys/scopes'),
  ]);
  if (listRes?.code === 0) {
    keys.value = listRes.data?.list || [];
    legacy.enabled = !!listRes.data?.legacy?.enabled;
    legacy.prefix = String(listRes.data?.legacy?.prefix || '');
  }
  if (scopeRes?.code === 0) modules.value = scopeRes.data?.modules || [];
}

function openCreate() {
  createForm.name = '';
  createForm.scopes = ['*'];
  createForm.expiresAt = null;
  createForm.ipAllowlist = '';
  createForm.password = '';
  createShow.value = true;
}

function fmtDate(ts: number | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function getReauthToken(password: string): Promise<string> {
  const res = await api<any>('POST', '/auth/reauth', { password });
  if (res?.code !== 0 || !res.data?.token) throw new Error(res?.msg || t('preferences.reauthFailed'));
  return String(res.data.token);
}

async function submitCreate() {
  if (!createForm.password) {
    message.warning(t('preferences.passwordHint'));
    return;
  }
  submitting.value = true;
  try {
    const token = await getReauthToken(createForm.password);
    const res = await api<any>('POST', '/api-keys', {
      name: createForm.name || 'API Key',
      scopes: createForm.scopes,
      expires_at: fmtDate(createForm.expiresAt),
      ip_allowlist: createForm.ipAllowlist.split(/[\s,]+/).filter(Boolean),
    }, { headers: { 'X-Reauth-Token': token } });
    if (res?.code !== 0) throw new Error(res?.msg || t('preferences.submitFailed'));
    createdKey.value = String(res.data?.key || '');
    createShow.value = false;
    secretShow.value = true;
    message.success(t('preferences.createSuccess'));
    await load();
  } catch (e: any) {
    message.error(e?.message || t('preferences.submitFailed'));
  } finally {
    submitting.value = false;
  }
}

function askReauth(action: 'rotate' | 'revoke' | 'legacy' | 'revokeAll', id = 0) {
  pending.action = action;
  pending.id = id;
  reauthPassword.value = '';
  reauthShow.value = true;
}

async function submitReauth() {
  if (!reauthPassword.value) {
    message.warning(t('preferences.passwordHint'));
    return;
  }
  submitting.value = true;
  try {
    const token = await getReauthToken(reauthPassword.value);
    if (pending.action === 'rotate') {
      const res = await api<any>('POST', `/api-keys/${pending.id}/rotate`, undefined, { headers: { 'X-Reauth-Token': token } });
      if (res?.code !== 0) throw new Error(res?.msg || t('preferences.submitFailed'));
      createdKey.value = String(res.data?.key || '');
      secretShow.value = true;
      message.success(t('preferences.rotateSuccess'));
    } else if (pending.action === 'revokeAll') {
      const res = await api<any>('POST', '/api-keys/revoke-all', undefined, { headers: { 'X-Reauth-Token': token } });
      if (res?.code !== 0) throw new Error(res?.msg || t('preferences.submitFailed'));
      message.success(t('preferences.revokeAllSuccess'));
    } else if (pending.action === 'legacy') {
      const res = await api<any>('DELETE', '/api-keys/legacy', undefined, { headers: { 'X-Reauth-Token': token } });
      if (res?.code !== 0) throw new Error(res?.msg || t('preferences.submitFailed'));
      message.success(t('preferences.legacyDisabled'));
    } else {
      const res = await api<any>('DELETE', `/api-keys/${pending.id}`, undefined, { headers: { 'X-Reauth-Token': token } });
      if (res?.code !== 0) throw new Error(res?.msg || t('preferences.submitFailed'));
      message.success(t('preferences.revokeSuccess'));
    }
    reauthShow.value = false;
    await load();
  } catch (e: any) {
    message.error(e?.message || t('preferences.submitFailed'));
  } finally {
    submitting.value = false;
  }
}

async function copyCreated() {
  try {
    await navigator.clipboard.writeText(createdKey.value);
    message.success(t('preferences.copied'));
  } catch {
    message.warning(t('preferences.copyManual'));
  }
}

onMounted(load);
</script>

<style scoped>
.pref-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--app-text-3);
}
.legacy-alert {
  margin: 8px 0 14px;
}
.scope-cell {
  max-width: 260px;
  word-break: break-word;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.muted {
  color: var(--app-text-3);
}
.secret-box {
  margin-top: 12px;
}
</style>
