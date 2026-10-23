<template>
  <div>
    <template v-if="sub === 'functions'">
      <EsaActionTable
        :aid="aid"
        zone-id=""
        :title="t('esaAccount.edgeFunctions')"
        :desc="t('esaAccount.edgeFunctionsDesc')"
        list-action="ListUserRoutines"
        items-path="Routines"
        id-key="Name"
        name-key="Name"
        :columns="functionColumns"
        :create-action="'CreateRoutine'"
        :create-label="t('esaAccount.fnCreate')"
        :create-fields="functionCreateFields"
        :update-action="'UpdateRoutineConfigDescription'"
        :update-fields="functionUpdateFields"
        :delete-action="'DeleteRoutine'"
        :paginate="false"
      />
    </template>

    <template v-else-if="sub === 'kv'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaAccount.kvTitle') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="kvBusy" :disabled="kvBusy" @click="loadKv">{{ t('esaZone.reload') }}</n-button>
            <n-button size="small" type="primary" @click="openNamespace">{{ t('esaAccount.kvCreate') }}</n-button>
          </div>
        </div>
        <p class="esa-table__desc">{{ t('esaAccount.kvDesc') }}</p>
        <ResponsiveDataTable :columns="namespaceColumns" :data="namespaces" size="small" :loading="kvBusy" :empty-text="t('esaZone.empty')" />
      </div>

      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaAccount.kvKeys') }}</h3>
          <div class="app-panel__extra">
            <EsaCardSelect
              v-model="namespace"
              :options="namespaceOptions"
              :placeholder="t('esaAccount.kvSelectNamespace')"
              compact
              searchable
              style="width: 260px"
              @update:model-value="loadKeys"
            />
            <n-button size="small" :loading="keysBusy" :disabled="keysBusy || !namespace" @click="loadKeys">{{ t('esaZone.reload') }}</n-button>
            <n-button size="small" type="primary" :disabled="!namespace" @click="openPut">{{ t('esaAccount.kvPut') }}</n-button>
          </div>
        </div>
        <ResponsiveDataTable :columns="keyColumns" :data="keys" size="small" :loading="keysBusy" :empty-text="namespace ? t('esaAccount.kvEmpty') : t('esaAccount.kvNoNamespace')" />
      </div>
    </template>

    <template v-else>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">
            {{ t('esaAccount.containersTitle') }}
            <n-tag size="tiny" :bordered="false" type="warning" style="margin-left: 6px">{{ t('esaAccount.containersGate') }}</n-tag>
          </h3>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.containersDesc') }}</p>
        <n-alert type="info" :show-icon="false">{{ t('esaAccount.containersNote') }}</n-alert>
      </div>
    </template>

    <n-modal v-model:show="showNamespace" preset="card" :title="t('esaAccount.kvCreate')" class="modal-sm" :mask-closable="false">
      <n-form label-placement="left" label-width="130" size="small">
        <n-form-item :label="t('esaAccount.kvNamespace')"><n-input v-model:value="namespaceForm.Namespace" /></n-form-item>
        <n-form-item :label="t('esaAccount.kvNamespaceDesc')"><n-input v-model:value="namespaceForm.Description" /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showNamespace = false">{{ t('esaZone.cancel') }}</n-button>
          <n-button type="primary" :loading="saveBusy" @click="createNamespace">{{ t('esaZone.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showPut" preset="card" :title="t('esaAccount.kvPut')" class="modal-md" :mask-closable="false">
      <n-form label-placement="left" label-width="130" size="small">
        <n-form-item :label="t('esaAccount.kvKey')"><n-input v-model:value="putForm.Key" /></n-form-item>
        <n-form-item :label="t('esaAccount.kvValue')"><n-input v-model:value="putForm.Value" type="textarea" :rows="4" /></n-form-item>
        <n-form-item :label="t('esaAccount.kvExpiration')"><n-input-number v-model:value="putForm.ExpirationTtl" :min="0" style="width: 220px" /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showPut = false">{{ t('esaZone.cancel') }}</n-button>
          <n-button type="primary" :loading="saveBusy" @click="putKey">{{ t('esaZone.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NForm, NFormItem, NInput, NInputNumber, NModal, NSpace, NTag, useDialog, useMessage } from 'naive-ui';
import { api } from '../../api';
import EsaCardSelect from './EsaCardSelect.vue';
import EsaActionTable from './EsaActionTable.vue';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import type { EsaFieldDef } from './EsaActionPanel.vue';

const props = defineProps<{ aid: number }>();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const sub = defineModel<string>('sub', { default: 'functions' });

const functionColumns = computed(() => [
  { key: 'Name', label: t('esaAccount.fnName'), minWidth: 160, mono: true },
  { key: 'Description', label: t('esaAccount.fnDesc'), minWidth: 200 },
  { key: 'ModifiedTime', label: 'ModifiedTime', minWidth: 160 },
]);

const functionCreateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaAccount.fnName'), required: true, placeholder: t('esaAccount.fnNamePlaceholder') },
  { name: 'Description', label: t('esaAccount.fnDesc'), type: 'textarea' },
  { name: 'HasAssets', label: t('esaAccount.fnHasAssets'), type: 'switch' },
]);
const functionUpdateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Description', label: t('esaAccount.fnDesc'), type: 'textarea' },
]);

const kvBusy = ref(false);
const keysBusy = ref(false);
const saveBusy = ref(false);
const namespaces = ref<any[]>([]);
const keys = ref<any[]>([]);
const namespace = ref('');
const showNamespace = ref(false);
const showPut = ref(false);
const namespaceForm = reactive({ Namespace: '', Description: '' });
const putForm = reactive<{ Key: string; Value: string; ExpirationTtl: number | null }>({ Key: '', Value: '', ExpirationTtl: null });

const namespaceOptions = computed(() => namespaces.value.map((n) => ({ label: n.Namespace, value: n.Namespace })));

const namespaceColumns = computed(() => [
  { title: t('esaAccount.kvNamespace'), key: 'Namespace', minWidth: 180, render: (row: any) => h('span', { class: 'app-mono' }, row.Namespace || '-') },
  { title: t('esaAccount.kvNamespaceDesc'), key: 'Description', minWidth: 220 },
  {
    title: t('esaZone.actions'),
    key: 'actions',
    width: 100,
    render: (row: any) =>
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => removeNamespace(row) }, { default: () => t('esaZone.delete') }),
  },
]);

const keyColumns = computed(() => [
  { title: t('esaAccount.kvKey'), key: 'Key', minWidth: 200, render: (row: any) => h('span', { class: 'app-mono' }, row.Key ?? row.key ?? '-') },
  { title: t('esaAccount.kvValue'), key: 'Value', minWidth: 260, render: (row: any) => String(row.Value ?? row.value ?? '-') },
  {
    title: t('esaZone.actions'),
    key: 'actions',
    width: 120,
    render: (row: any) =>
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => removeKey(row) }, { default: () => t('esaAccount.kvDeleteKey') }),
  },
]);

async function call(action: string, params: Record<string, any> = {}) {
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, { action, params });
  if (res.code !== 0) throw new Error(res.msg || t('esaAccount.loadFailed'));
  return res.data;
}

function extractList(data: any, keys: string[]): any[] {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  for (const [key, value] of Object.entries(data || {})) {
    if (key !== 'RequestId' && Array.isArray(value)) return value as any[];
  }
  return [];
}

async function loadKv() {
  kvBusy.value = true;
  try {
    const data = await call('GetKvAccount');
    namespaces.value = extractList(data, ['Namespaces', 'KvNamespaces', 'NamespaceList']);
    if (!namespace.value && namespaces.value.length) namespace.value = namespaces.value[0].Namespace;
  } catch (e: any) {
    message.error(e?.message || t('esaAccount.loadFailed'));
  } finally {
    kvBusy.value = false;
  }
  if (namespace.value) await loadKeys();
}

async function loadKeys() {
  if (!namespace.value) return;
  keysBusy.value = true;
  try {
    const data = await call('ListKvs', { Namespace: namespace.value, PageNumber: 1, PageSize: 100 });
    keys.value = extractList(data, ['Kvs', 'Keys', 'Items']);
  } catch (e: any) {
    message.error(e?.message || t('esaAccount.loadFailed'));
  } finally {
    keysBusy.value = false;
  }
}

function openNamespace() {
  namespaceForm.Namespace = '';
  namespaceForm.Description = '';
  showNamespace.value = true;
}

async function createNamespace() {
  if (!namespaceForm.Namespace.trim()) return message.warning(t('esaAccount.kvNamespace'));
  saveBusy.value = true;
  try {
    await call('CreateKvNamespace', { Namespace: namespaceForm.Namespace.trim(), Description: namespaceForm.Description || undefined });
    message.success(t('esaZone.saved'));
    showNamespace.value = false;
    await loadKv();
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  } finally {
    saveBusy.value = false;
  }
}

function removeNamespace(row: any) {
  dialog.warning({
    title: t('esaZone.delete'),
    content: t('esaZone.deleteConfirm', { name: row.Namespace || '' }),
    positiveText: t('esaZone.delete'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      try {
        await call('DeleteKvNamespace', { Namespace: row.Namespace });
        message.success(t('esaZone.deleted'));
        if (namespace.value === row.Namespace) {
          namespace.value = '';
          keys.value = [];
        }
        await loadKv();
      } catch (e: any) {
        message.error(e?.message || t('esaZone.deleteFailed'));
      }
    },
  });
}

function openPut() {
  putForm.Key = '';
  putForm.Value = '';
  putForm.ExpirationTtl = null;
  showPut.value = true;
}

async function putKey() {
  if (!putForm.Key.trim()) return message.warning(t('esaAccount.kvKey'));
  saveBusy.value = true;
  try {
    await call('PutKv', {
      Namespace: namespace.value,
      Key: putForm.Key.trim(),
      Value: putForm.Value,
      ...(putForm.ExpirationTtl ? { ExpirationTtl: putForm.ExpirationTtl } : {}),
    });
    message.success(t('esaZone.saved'));
    showPut.value = false;
    await loadKeys();
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  } finally {
    saveBusy.value = false;
  }
}

function removeKey(row: any) {
  const key = row.Key ?? row.key;
  dialog.warning({
    title: t('esaAccount.kvDeleteKey'),
    content: t('esaZone.deleteConfirm', { name: String(key || '') }),
    positiveText: t('esaZone.delete'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      try {
        await call('DeleteKv', { Namespace: namespace.value, Key: key });
        message.success(t('esaZone.deleted'));
        await loadKeys();
      } catch (e: any) {
        message.error(e?.message || t('esaZone.deleteFailed'));
      }
    },
  });
}

onMounted(loadKv);
</script>
