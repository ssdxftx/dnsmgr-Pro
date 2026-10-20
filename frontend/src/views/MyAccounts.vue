<template>
  <div class="app-stack">
    <PageHeader v-if="!embedded" :title="t('vault.title')" :subtitle="t('vault.subtitle')" />

    <n-card v-if="!status.initialized" :bordered="false">
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
            <n-button block @click="initConvenient">{{ t('vault.initNone') }}</n-button>
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
            <n-empty v-else :description="t('vault.locked')" />
          </n-tab-pane>
          <n-tab-pane name="cdn" :tab="t('vault.tabsCdn')">
            <CdnAccount v-if="ready" />
            <n-empty v-else :description="t('vault.locked')" />
          </n-tab-pane>
          <n-tab-pane name="cert" :tab="t('vault.tabsCert')">
            <CertAccount v-if="ready" />
            <n-empty v-else :description="t('vault.locked')" />
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
          <n-input v-model:value="initForm.passphrase" type="password" show-password-on="click" :placeholder="t('vault.passphraseHint')" />
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
      <n-input v-model:value="unlockPass" type="password" show-password-on="click" :placeholder="t('vault.oldPass')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="downgradeOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="warning" :loading="busy" @click="downgrade">{{ t('vault.downgrade') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="destroyOpen" preset="card" :title="t('vault.destroy')" class="modal-md" :mask-closable="false">
      <n-alert type="error" class="mb-3">{{ t('vault.destroyHint') }}</n-alert>
      <n-input v-model:value="destroyConfirm" :placeholder="t('vault.destroyConfirm')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="destroyOpen = false">{{ t('backup.cancel') }}</n-button>
          <n-button type="error" :loading="busy" :disabled="destroyConfirm !== 'DESTROY'" @click="destroy">{{ t('vault.destroy') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessage } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import DnsAccount from './DnsAccount.vue';
import CdnAccount from './CdnAccount.vue';
import CertAccount from './CertAccount.vue';

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });
const embedded = computed(() => props.embedded);

const { t } = useI18n();
const message = useMessage();

const status = ref<any>({});
const busy = ref(false);
const initOpen = ref(false);
const unlockOpen = ref(false);
const passOpen = ref(false);
const upgradeOpen = ref(false);
const downgradeOpen = ref(false);
const destroyOpen = ref(false);
const unlockPass = ref('');
const destroyConfirm = ref('');
const initForm = reactive({ passphrase: '', confirm: '' });
const passForm = reactive({ old: '', next: '' });

const ready = computed(() => status.value.unlocked || status.value.mode === 'none');

async function load() {
  const res = await api<any>('GET', '/vault/status');
  status.value = res?.data || {};
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

async function initConvenient() {
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/init', { mode: 'none', acknowledge: true });
    if (res.code !== 0) return message.error(res.msg);
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
    const res = await api<any>('POST', '/vault/upgrade', { passphrase: initForm.passphrase });
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
    const res = await api<any>('POST', '/vault/downgrade', { passphrase: unlockPass.value });
    if (res.code !== 0) return message.error(res.msg);
    downgradeOpen.value = false;
    message.success(t('vault.saved'));
    await load();
  } finally {
    busy.value = false;
  }
}

async function setRecovery() {
  const res = await api<any>('POST', '/vault/recovery', { recovery: 'random' });
  if (res.code !== 0) return message.error(res.msg);
  const code = res?.data?.recoveryCode;
  if (code) {
    await navigator.clipboard?.writeText(code).catch(() => undefined);
    message.success(`${t('vault.recoveryCode')}: ${code}`);
  } else {
    message.success(t('vault.saved'));
  }
}

async function toggleExclude(v: boolean) {
  await api<any>('POST', '/vault/backup-exclude', { exclude: v });
  await load();
}

async function destroy() {
  busy.value = true;
  try {
    const res = await api<any>('POST', '/vault/destroy', { confirm: destroyConfirm.value });
    if (res.code !== 0) return message.error(res.msg);
    destroyOpen.value = false;
    destroyConfirm.value = '';
    message.success(t('vault.saved'));
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
