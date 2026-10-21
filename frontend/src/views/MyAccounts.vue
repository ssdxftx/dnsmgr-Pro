<template>
  <div class="app-stack">
    <PageHeader v-if="!embedded" :title="t('vault.title')" :subtitle="t('vault.subtitle')" />

    <n-card v-if="statusState === 'loading'" :bordered="false">
      <n-spin size="small" :description="t('common.loading')" />
    </n-card>

    <n-card v-else-if="statusState === 'error'" :bordered="false">
      <n-alert type="error" :show-icon="true">
        {{ t('common.loadFailedHint') }}
        <n-button size="tiny" type="primary" style="margin-left: 8px" @click="load">{{ t('common.retry') }}</n-button>
      </n-alert>
    </n-card>

    <n-card v-else-if="!status.initialized" :bordered="false">
      <template #header>{{ t('vault.notInit') }}</template>
      <p class="text-dim">{{ t('vault.notInitHint') }}</p>
      <n-grid cols="2 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
        <n-grid-item>
          <n-card size="small" :bordered="true" class="vault-choice">
            <h3>{{ t('vault.modePassphrase') }}</h3>
            <p class="text-dim">{{ t('vault.modePassphraseHint') }}</p>
            <n-button type="primary" block @click="openInit">{{ t('vault.initPassphrase') }}</n-button>
          </n-card>
        </n-grid-item>
        <n-grid-item>
          <n-card size="small" :bordered="true" class="vault-choice">
            <h3>{{ t('vault.modeNone') }}</h3>
            <p class="text-dim">{{ t('vault.modeNoneHint') }}</p>
            <n-button block @click="openNone">{{ t('vault.initNone') }}</n-button>
          </n-card>
        </n-grid-item>
        <n-grid-item>
          <n-card size="small" :bordered="true" class="vault-choice">
            <h3>{{ t('vault.later') }}</h3>
            <p class="text-dim">{{ t('vault.notInitHint') }}</p>
          </n-card>
        </n-grid-item>
      </n-grid>
    </n-card>

    <template v-else>
      <n-alert v-if="status.mode === 'none'" type="warning">
        {{ t('vault.convenientBanner') }}
        <n-button size="tiny" type="primary" style="margin-left: 8px" @click="upgradeOpen = true">{{ t('vault.upgrade') }}</n-button>
      </n-alert>

      <n-card :bordered="false">
        <n-space align="center" justify="space-between" wrap>
          <n-space align="center">
            <n-tag :type="status.unlocked ? 'success' : 'warning'">
              {{ status.unlocked ? t('vault.unlocked') : t('vault.locked') }}
            </n-tag>
            <n-tag>{{ status.mode === 'none' ? t('vault.modeNone') : t('vault.modePassphrase') }}</n-tag>
            <span class="text-dim">{{ t('vault.excludeHint') }}</span>
          </n-space>
          <n-space>
            <span class="text-dim">{{ t('vault.excludeBackup') }}</span>
            <n-switch :value="status.excludeFromSiteBackup" @update:value="toggleExclude" />
            <n-button v-if="!status.unlocked" size="small" type="primary" @click="unlockOpen = true">{{ t('vault.unlock') }}</n-button>
            <n-button v-else size="small" @click="lock">{{ t('vault.lock') }}</n-button>
            <n-button v-if="status.mode === 'passphrase'" size="small" quaternary @click="passOpen = true">{{ t('vault.changePass') }}</n-button>
            <n-button v-if="status.mode === 'passphrase'" size="small" quaternary @click="downgradeOpen = true">{{ t('vault.downgrade') }}</n-button>
            <n-button size="small" quaternary @click="setRecovery">{{ t('vault.setRecovery') }}</n-button>
            <n-button size="small" quaternary type="error" @click="destroyOpen = true">{{ t('vault.destroy') }}</n-button>
          </n-space>
        </n-space>
      </n-card>

      <n-card :bordered="false">
        <n-tabs type="line" animated>
          <n-tab-pane name="dns" :tab="t('vault.tabsDns')">
            <DnsAccount v-if="ready" />
            <EmptyState v-else :icon="LockClosedOutline" :title="t('vault.locked')" compact />
          </n-tab-pane>
          <n-tab-pane name="cdn" :tab="t('vault.tabsCdn')">
            <CdnAccount v-if="ready" />
            <EmptyState v-else :icon="LockClosedOutline" :title="t('vault.locked')" compact />
          </n-tab-pane>
          <n-tab-pane v-if="admin" name="cert" :tab="t('vault.tabsCert')">
            <CertAccount v-if="ready" />
            <EmptyState v-else :icon="LockClosedOutline" :title="t('vault.locked')" compact />
          </n-tab-pane>
        </n-tabs>
      </n-card>
    </template>

    <n-modal v-model:show="initOpen" preset="card" :title="t('vault.initPassphrase')" class="modal-md" :mask-closable="false">
      <n-form label-placement="top">
        <n-form-item :label="t('vault.passphrase')">
          <n-input v-model:value="initForm.passphrase" type="password" show-password-on="click" :placeholder="t('vault.passphraseHint')" />
        </n-form-item>
        <n-form-item :label="t('vault.confirmPassphrase')">
          <n-input v-model:value="initForm.confirm" type="password" show-password-on="click" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="initOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="primary" :loading="busy" @click="initPassphrase">{{ t('vault.init') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="unlockOpen" preset="card" :title="t('vault.unlock')" class="modal-md" :mask-closable="false">
      <p class="text-dim">{{ t('vault.unlockHint') }}</p>
      <n-input v-model:value="unlockPass" type="password" show-password-on="click" :placeholder="t('vault.passphrase')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="unlockOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="primary" :loading="busy" @click="unlock">{{ t('vault.unlock') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="passOpen" preset="card" :title="t('vault.changePass')" class="modal-md" :mask-closable="false">
      <n-form label-placement="top">
        <n-form-item :label="t('vault.oldPass')"><n-input v-model:value="passForm.old" type="password" show-password-on="click" /></n-form-item>
        <n-form-item :label="t('vault.newPass')"><n-input v-model:value="passForm.next" type="password" show-password-on="click" /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="passOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="primary" :loading="busy" @click="changePass">{{ t('backup.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="upgradeOpen" preset="card" :title="t('vault.upgrade')" class="modal-md" :mask-closable="false">
      <n-form label-placement="top">
        <n-form-item :label="t('vault.passphrase')">
          <n-input v-model:value="upgradePass" type="password" show-password-on="click" :placeholder="t('vault.passphraseHint')" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="upgradeOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="primary" :loading="busy" @click="upgrade">{{ t('vault.upgrade') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="downgradeOpen" preset="card" :title="t('vault.downgrade')" class="modal-md" :mask-closable="false">
      <n-alert type="warning" class="mb-3">{{ t('vault.modeNoneHint') }}</n-alert>
      <n-input v-model:value="downgradePass" type="password" show-password-on="click" :placeholder="t('vault.oldPass')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="downgradeOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="warning" :loading="busy" @click="downgrade">{{ t('vault.downgrade') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="noneOpen" preset="card" :title="t('vault.modeNone')" class="modal-md" :mask-closable="false">
      <n-alert type="warning" class="mb-3">{{ t('vault.modeNoneWarn') }}</n-alert>
      <n-checkbox v-model:checked="noneAck">{{ t('vault.acknowledge') }}</n-checkbox>
      <template #footer>
        <n-space justify="end">
          <n-button @click="noneOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button :loading="busy" :disabled="!noneAck" @click="initConvenient">{{ t('vault.initNone') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="recoveryOpen" preset="card" :title="t('vault.setRecovery')" class="modal-md" :mask-closable="false" :closable="!recoveryCode">
      <n-alert v-if="!recoveryCode" type="warning" class="mb-3">{{ t('vault.recoveryWarn') }}</n-alert>
      <template v-if="recoveryCode">
        <n-alert type="success" class="mb-3">{{ t('vault.recoveryCode') }}</n-alert>
        <n-input :value="recoveryCode" readonly select-all />
        <n-checkbox v-model:checked="recoveryAck" class="mt-3">{{ t('vault.recoverySavedAck') }}</n-checkbox>
      </template>
      <template #footer>
        <n-space justify="end">
          <n-button v-if="!recoveryCode" @click="recoveryOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button v-if="!recoveryCode" type="warning" :loading="busy" @click="generateRecovery">{{ t('vault.setRecovery') }}</n-button>
          <n-button v-else type="primary" :disabled="!recoveryAck" @click="recoveryOpen = false">{{ t('vault.saved') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="destroyOpen" preset="card" :title="t('vault.destroy')" class="modal-md" :mask-closable="false">
      <n-alert type="error" class="mb-3">{{ t('vault.destroyHint') }}</n-alert>
      <n-input v-model:value="destroyConfirm" :placeholder="t('vault.destroyConfirm')" />
      <n-input
        v-if="status.mode === 'passphrase'"
        v-model:value="destroyPass"
        type="password"
        show-password-on="click"
        class="mt-3"
        :placeholder="t('vault.destroyPass')"
      />
      <template #footer>
        <n-space justify="end">
          <n-button @click="destroyOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button
            type="error"
            :loading="busy"
            :disabled="destroyConfirm !== 'DESTROY' || (status.mode === 'passphrase' && !destroyPass)"
            @click="destroy"
          >{{ t('vault.destroy') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessage } from 'naive-ui';
import { api, getUser } from '../api';
import { isAdminUser } from '../lib/admin';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import { LockClosedOutline } from '@vicons/ionicons5';
import DnsAccount from './DnsAccount.vue';
import CdnAccount from './CdnAccount.vue';
import CertAccount from './CertAccount.vue';

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });
const embedded = computed(() => props.embedded);
const admin = computed(() => isAdminUser(getUser()));

const { t } = useI18n();
const message = useMessage();

const status = ref<any>({});
const statusState = ref<'loading' | 'ok' | 'error'>('loading');
const busy = ref(false);
const initOpen = ref(false);
const unlockOpen = ref(false);
const passOpen = ref(false);
const upgradeOpen = ref(false);
const downgradeOpen = ref(false);
const destroyOpen = ref(false);
const noneOpen = ref(false);
const noneAck = ref(false);
const unlockPass = ref('');
const downgradePass = ref('');
const upgradePass = ref('');
const recoveryOpen = ref(false);
const recoveryCode = ref('');
const recoveryAck = ref(false);
const destroyConfirm = ref('');
const destroyPass = ref('');
const initForm = reactive({ passphrase: '', confirm: '' });
const passForm = reactive({ old: '', next: '' });

const ready = computed(() => status.value.unlocked || status.value.mode === 'none');

// 各弹窗关闭时清空口令，避免在解锁/降级/升级之间残留明文
watch(unlockOpen, (v) => { if (!v) unlockPass.value = ''; });
watch(downgradeOpen, (v) => { if (!v) downgradePass.value = ''; });
watch(upgradeOpen, (v) => { if (!v) upgradePass.value = ''; });
watch(passOpen, (v) => { if (!v) { passForm.old = ''; passForm.next = ''; } });
watch(initOpen, (v) => { if (!v) { initForm.passphrase = ''; initForm.confirm = ''; } });

async function load() {
  statusState.value = 'loading';
  try {
    const res = await api<any>('GET', '/vault/status');
    if (res.code !== 0) throw new Error(res.msg || 'load failed');
    status.value = res?.data || {};
    statusState.value = 'ok';
  } catch {
    status.value = {};
    statusState.value = 'error';
  }
}

function openInit() {
  initForm.passphrase = '';
  initForm.confirm = '';
  initOpen.value = true;
}

async function initPassphrase() {
  if (initForm.passphrase.length < 12) return message.warning(t('vault.passphraseHint'));
  if (initForm.passphrase !== initForm.confirm) return message.warning(t('vault.passphraseMismatch'));
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/init', { mode: 'passphrase', passphrase: initForm.passphrase });
    if (res.code !== 0) return message.error(res.msg);
    initOpen.value = false;
    message.success(t('vault.initDone'));
    await load();
  } finally {
    busy.value = false;
  }
}

function openNone() {
  noneAck.value = false;
  noneOpen.value = true;
}

async function initConvenient() {
  if (!noneAck.value) return message.warning(t('vault.ackRequired'));
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/init', { mode: 'none', acknowledge: true });
    if (res.code !== 0) return message.error(res.msg);
    noneOpen.value = false;
    noneAck.value = false;
    message.success(t('vault.initDone'));
    await load();
  } finally {
    busy.value = false;
  }
}

async function unlock() {
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/unlock', { passphrase: unlockPass.value });
    if (res.code !== 0) return message.error(res.msg);
    unlockOpen.value = false;
    unlockPass.value = '';
    message.success(t('vault.unlockedDone'));
    await load();
  } finally {
    busy.value = false;
  }
}

async function lock() {
  await api<any>('POST', '/vault/lock', {});
  message.success(t('vault.lockedDone'));
  await load();
}

async function changePass() {
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/passphrase', { old_passphrase: passForm.old, new_passphrase: passForm.next });
    if (res.code !== 0) return message.error(res.msg);
    passOpen.value = false;
    message.success(t('vault.passwordChanged'));
  } finally {
    busy.value = false;
  }
}

async function upgrade() {
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/upgrade', { passphrase: upgradePass.value });
    if (res.code !== 0) return message.error(res.msg);
    upgradeOpen.value = false;
    message.success(t('vault.saved'));
    await load();
  } finally {
    busy.value = false;
  }
}

async function downgrade() {
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/downgrade', { passphrase: downgradePass.value });
    if (res.code !== 0) return message.error(res.msg);
    downgradeOpen.value = false;
    message.success(t('vault.saved'));
    await load();
  } finally {
    busy.value = false;
  }
}

function setRecovery() {
  recoveryCode.value = '';
  recoveryAck.value = false;
  recoveryOpen.value = true;
}

async function generateRecovery() {
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/recovery', { recovery: 'random' });
    if (res.code !== 0) return message.error(res.msg);
    const code = String(res?.data?.recoveryCode || '');
    if (!code) return message.error(t('vault.saved'));
    recoveryCode.value = code;
    recoveryAck.value = false;
    try {
      await navigator.clipboard.writeText(code);
      message.success(t('vault.copied'));
    } catch {
      message.warning(t('vault.recoveryCode'));
    }
  } finally {
    busy.value = false;
  }
}

async function toggleExclude(v: boolean) {
  const prev = status.value.excludeFromSiteBackup;
  status.value.excludeFromSiteBackup = v;
  const res = await api<any>('POST', '/vault/backup-exclude', { exclude: v });
  if (res.code !== 0) {
    status.value.excludeFromSiteBackup = prev;
    message.error(res.msg || t('common.loadFailed'));
    return;
  }
  await load();
}

async function destroy() {
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/destroy', {
      confirm: destroyConfirm.value,
      passphrase: destroyPass.value,
    });
    if (res.code !== 0) return message.error(res.msg);
    destroyOpen.value = false;
    destroyConfirm.value = '';
    destroyPass.value = '';
    message.success(t('vault.destroyed'));
    await load();
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.text-dim {
  color: var(--app-text-3);
  font-size: 12px;
}
.vault-choice h3 {
  margin: 0 0 8px;
}
</style>
