<template>
        <!-- ============ 边缘函数与 KV ============ -->

          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.functions') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openFunction()">{{ t('cdnZoneSetting.create') }}</n-button>
                <n-button size="small" :loading="edgeLoading" :disabled="edgeLoading" @click="loadFunctions">{{ t('cdnAdvanced.refresh') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="functionColumns" :data="functions" size="small" :loading="edgeLoading" :empty-text="t('cdnZoneSetting.functionEmpty')" />
          </div>

          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.functionRules') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openFunctionRule()">{{ t('cdnZoneSetting.create') }}</n-button>
                <n-button size="small" :loading="edgeLoading" :disabled="edgeLoading" @click="loadFunctionRules">{{ t('cdnAdvanced.refresh') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="functionRuleColumns" :data="functionRules" size="small" :loading="edgeLoading" :empty-text="t('cdnZoneSetting.functionRuleEmpty')" />
          </div>

          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.kvNamespaces') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ kvNamespaces.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="kvForm.namespace" :placeholder="t('cdnZoneSetting.kvNamespace')" style="width: 180px" size="small" />
              <n-input v-model:value="kvForm.remark" :placeholder="t('cdnZoneSetting.kvRemark')" style="width: 220px" size="small" />
              <n-button size="small" type="primary" :loading="kvSaving" @click="createKvNamespace">{{ t('cdnZoneSetting.create') }}</n-button>
            </div>
            <ResponsiveDataTable :columns="kvNamespaceColumns" :data="kvNamespaces" size="small" :loading="edgeLoading" :empty-text="t('cdnZoneSetting.kvEmpty')" />
          </div>

      <n-modal v-model:show="showFunction" preset="card" :title="functionEditingId ? t('cdnZoneSetting.editFunction') : t('cdnZoneSetting.createFunction')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="functionJson" type="textarea" :rows="16" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.functionJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showFunction = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="functionSaving" :disabled="functionSaving" @click="saveFunction">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-modal v-model:show="showFunctionRule" preset="card" :title="functionRuleEditingId ? t('cdnZoneSetting.editFunctionRule') : t('cdnZoneSetting.createFunctionRule')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="functionRuleJson" type="textarea" :rows="16" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.functionRuleJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showFunctionRule = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="functionRuleSaving" :disabled="functionRuleSaving" @click="saveFunctionRule">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-drawer v-model:show="showKvKeys" placement="right" width="min(900px, 94vw)">
        <n-drawer-content closable :native-scrollbar="false" :title="kvKeyTitle">
          <div class="app-stack">
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.kvKeys') }}</h3>
                <div class="app-panel__extra">
                  <n-input v-model:value="kvPrefix" :placeholder="t('cdnZoneSetting.kvPrefix')" size="small" style="width: 180px" />
                  <n-button size="small" :loading="kvKeyLoading" :disabled="kvKeyLoading" @click="loadKvKeys">{{ t('cdnAdvanced.load') }}</n-button>
                </div>
              </div>
              <pre v-if="kvKeysText" class="code-view">{{ kvKeysText }}</pre>
              <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
            </div>
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.kvData') }}</h3>
              </div>
              <div class="zone-form-strip">
                <n-input v-model:value="kvKeyForm.key" :placeholder="t('cdnZoneSetting.kvKey')" style="width: 180px" size="small" />
                <n-button size="small" :loading="!!busy['kvGet']" :disabled="!!busy['kvGet'] || !kvKeyForm.key" @click="run('kvGet', kvGetKey)">{{ t('cdnZoneSetting.kvGet') }}</n-button>
                <n-button size="small" type="error" :loading="!!busy['kvDel']" :disabled="!!busy['kvDel'] || !kvKeyForm.key" @click="run('kvDel', kvDeleteKey)">{{ t('cdnZoneSetting.delete') }}</n-button>
              </div>
              <n-input v-model:value="kvKeyForm.value" type="textarea" :rows="6" :placeholder="t('cdnZoneSetting.kvValue')" class="mono-input" style="margin-top: 8px" />
              <div class="zone-form-strip" style="margin-top: 8px">
                <n-input v-model:value="kvKeyForm.ttl" :placeholder="t('cdnZoneSetting.kvTtl')" style="width: 160px" size="small" />
                <n-button size="small" type="primary" :loading="!!busy['kvPut']" :disabled="!!busy['kvPut'] || !kvKeyForm.key" @click="run('kvPut', kvPutKey)">{{ t('cdnZoneSetting.kvPut') }}</n-button>
              </div>
              <pre v-if="kvDataText" class="code-view">{{ kvDataText }}</pre>
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <n-drawer v-model:show="showReplicas" placement="right" width="min(900px, 94vw)">
        <n-drawer-content closable :native-scrollbar="false" :title="replicaTitle">
          <div class="app-stack">
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.replicas') }}</h3>
                <div class="app-panel__extra">
                  <n-button size="small" type="primary" @click="openReplicaModal()">{{ t('cdnZoneSetting.create') }}</n-button>
                  <n-button size="small" :loading="replicaLoading" :disabled="replicaLoading" @click="loadReplicas">{{ t('cdnAdvanced.refresh') }}</n-button>
                </div>
              </div>
              <ResponsiveDataTable :columns="replicaColumns" :data="replicas" size="small" :loading="replicaLoading" :empty-text="t('cdnZoneSetting.replicaEmpty')" />
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <n-drawer v-model:show="showBindings" placement="right" width="min(900px, 94vw)">
        <n-drawer-content closable :native-scrollbar="false" :title="bindingTitle">
          <div class="app-stack">
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.bindings') }}</h3>
                <div class="app-panel__extra">
                  <n-button size="small" type="primary" @click="openBindingModal">{{ t('cdnZoneSetting.edit') }}</n-button>
                  <n-button size="small" :loading="bindingLoading" :disabled="bindingLoading" @click="loadBindings">{{ t('cdnAdvanced.refresh') }}</n-button>
                </div>
              </div>
              <pre v-if="bindingText" class="code-view">{{ bindingText }}</pre>
              <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <n-drawer v-model:show="showRuntime" placement="right" width="min(900px, 94vw)">
        <n-drawer-content closable :native-scrollbar="false" :title="runtimeTitle">
          <div class="app-stack">
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.runtime') }}</h3>
                <div class="app-panel__extra">
                  <n-button size="small" :loading="runtimeLoading" :disabled="runtimeLoading" @click="loadRuntime">{{ t('cdnAdvanced.load') }}</n-button>
                  <n-button size="small" type="primary" :loading="runtimeSaving" :disabled="runtimeSaving" @click="saveRuntime">{{ t('cdnZoneSetting.save') }}</n-button>
                </div>
              </div>
              <n-input v-model:value="runtimeJson" type="textarea" :rows="14" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.runtimeJsonHint')" />
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <n-modal v-model:show="showReplicaModal" preset="card" :title="replicaEditingName ? t('cdnZoneSetting.editReplica') : t('cdnZoneSetting.createReplica')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="replicaJson" type="textarea" :rows="14" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.replicaJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showReplicaModal = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="replicaSaving" :disabled="replicaSaving" @click="saveReplica">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-modal v-model:show="showBindingModal" preset="card" :title="t('cdnZoneSetting.bindings')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="bindingJson" type="textarea" :rows="12" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.bindingJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showBindingModal = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="bindingSaving" :disabled="bindingSaving" @click="saveBindings">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue';
import { NButton, useDialog, useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import { useAction } from '../../composables/useAction';

const props = defineProps<{
  aid: number;
  zoneId: string;
  caps: Record<string, any>;
  reloadKey: number;
}>();

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const { busy, run } = useAction();
const aid = props.aid;
const zoneId = props.zoneId;
const caps = computed(() => props.caps);

const functions = ref<any[]>([]);
const functionRules = ref<any[]>([]);
const kvNamespaces = ref<any[]>([]);
const edgeLoading = ref(false);
const showFunction = ref(false);
const functionEditingId = ref('');
const functionJson = ref('');
const functionSaving = ref(false);
const showFunctionRule = ref(false);
const functionRuleEditingId = ref('');
const functionRuleJson = ref('');
const functionRuleSaving = ref(false);
const kvForm = reactive<any>({ namespace: '', remark: '' });
const kvSaving = ref(false);
const showKvKeys = ref(false);
const kvKeyNamespace = ref('');
const kvPrefix = ref('');
const kvKeysText = ref('');
const kvKeyLoading = ref(false);
const kvKeyForm = reactive<any>({ key: '', value: '', ttl: '' });
const kvDataText = ref('');
const functionColumns = computed(() => [
  { title: 'FunctionId', key: 'FunctionId', minWidth: 160 },
  { title: t('cdnSecurity.ruleName'), key: 'Name', minWidth: 160 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 320, render: (r: any) => h('div', { class: 'row-actions' }, [
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openFunction(r) }, { default: () => t('cdnZoneSetting.edit') }),
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openReplicas(r) }, { default: () => t('cdnZoneSetting.replicas') }),
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openBindings(r) }, { default: () => t('cdnZoneSetting.bindings') }),
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openRuntime(r) }, { default: () => t('cdnZoneSetting.runtime') }),
    h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delFunction(r) }, { default: () => t('cdnZoneSetting.delete') }),
  ]) },
]);
const functionRuleColumns = computed(() => [
  { title: 'RuleId', key: 'RuleId', minWidth: 160 },
  { title: 'TriggerType', key: 'TriggerType', width: 130 },
  { title: 'Priority', key: 'Priority', width: 90 },
  { title: 'Remark', key: 'Remark', minWidth: 180 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 150, render: (r: any) => h('div', { class: 'row-actions' }, [
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openFunctionRule(r) }, { default: () => t('cdnZoneSetting.edit') }),
    h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delFunctionRule(r) }, { default: () => t('cdnZoneSetting.delete') }),
  ]) },
]);
const kvNamespaceColumns = computed(() => [
  { title: t('cdnZoneSetting.kvNamespace'), key: 'Namespace', minWidth: 180 },
  { title: t('cdnZoneSetting.kvRemark'), key: 'Remark', minWidth: 200 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 180, render: (r: any) => h('div', { class: 'row-actions' }, [
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openKvKeys(r) }, { default: () => t('cdnZoneSetting.kvData') }),
    h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delKvNamespace(r) }, { default: () => t('cdnZoneSetting.delete') }),
  ]) },
]);
const kvKeyTitle = computed(() => `${t('cdnZoneSetting.kvData')} · ${kvKeyNamespace.value}`);

async function loadFunctions(): Promise<boolean> {
  if (!caps.value.functions) return true;
  edgeLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/functions`, { zoneId });
    functions.value = res.code === 0 ? res.data || [] : [];
    return res.code === 0;
  } finally {
    edgeLoading.value = false;
  }
}

function openFunction(row?: any) {
  functionEditingId.value = row ? String(row.FunctionId || '') : '';
  functionJson.value = JSON.stringify(row ? { Content: row.Content || '', Remark: row.Remark || '' } : { Name: '', Content: '', Remark: '' }, null, 2);
  showFunction.value = true;
}

async function saveFunction() {
  let parsed: any;
  try {
    parsed = JSON.parse(functionJson.value);
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  functionSaving.value = true;
  try {
    const res: any = functionEditingId.value
      ? await api('PUT', `/cdn/accounts/${aid}/functions/${encodeURIComponent(functionEditingId.value)}`, { zoneId, params: parsed })
      : await api('POST', `/cdn/accounts/${aid}/functions`, { zoneId, params: parsed });
    if (res.code === 0) {
      message.success(res.msg);
      showFunction.value = false;
      await loadFunctions();
    } else message.error(res.msg);
  } finally {
    functionSaving.value = false;
  }
}

function delFunction(r: any) {
  dialog.warning({ title: t('cdnZoneSetting.delete'), content: t('cdnAdvanced.confirmDelete', { name: r.Name || r.FunctionId }), positiveText: t('cdnZoneSetting.delete'), negativeText: t('cdnZoneSetting.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cdn/accounts/${aid}/functions/${encodeURIComponent(String(r.FunctionId))}`, { zoneId });
    if (res.code === 0) { message.success(res.msg); await loadFunctions(); } else message.error(res.msg);
  } });
}

async function loadFunctionRules(): Promise<boolean> {
  if (!caps.value.functions) return true;
  edgeLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/function-rules`, { zoneId });
    functionRules.value = res.code === 0 ? res.data || [] : [];
    return res.code === 0;
  } finally {
    edgeLoading.value = false;
  }
}

function openFunctionRule(row?: any) {
  functionRuleEditingId.value = row ? String(row.RuleId || '') : '';
  functionRuleJson.value = JSON.stringify(row || { FunctionRuleConditions: [{ RuleConditions: [] }], TriggerType: 'direct', FunctionId: '', Remark: '' }, null, 2);
  showFunctionRule.value = true;
}

async function saveFunctionRule() {
  let parsed: any;
  try {
    parsed = JSON.parse(functionRuleJson.value);
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  functionRuleSaving.value = true;
  try {
    const res: any = functionRuleEditingId.value
      ? await api('PUT', `/cdn/accounts/${aid}/function-rules/${encodeURIComponent(functionRuleEditingId.value)}`, { zoneId, params: parsed })
      : await api('POST', `/cdn/accounts/${aid}/function-rules`, { zoneId, params: parsed });
    if (res.code === 0) {
      message.success(res.msg);
      showFunctionRule.value = false;
      await loadFunctionRules();
    } else message.error(res.msg);
  } finally {
    functionRuleSaving.value = false;
  }
}

function delFunctionRule(r: any) {
  dialog.warning({ title: t('cdnZoneSetting.delete'), content: t('cdnAdvanced.confirmDelete', { name: r.Remark || r.RuleId }), positiveText: t('cdnZoneSetting.delete'), negativeText: t('cdnZoneSetting.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cdn/accounts/${aid}/function-rules`, { zoneId, ruleIds: [String(r.RuleId)] });
    if (res.code === 0) { message.success(res.msg); await loadFunctionRules(); } else message.error(res.msg);
  } });
}

async function loadKvNamespaces(): Promise<boolean> {
  if (!caps.value.kv) return true;
  edgeLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/kv/namespaces`, { zoneId, page: 1, size: 100 });
    kvNamespaces.value = res.code === 0 ? res.data?.list || [] : [];
    return res.code === 0;
  } finally {
    edgeLoading.value = false;
  }
}

async function createKvNamespace() {
  if (!kvForm.namespace.trim()) return message.warning(t('cdnZoneSetting.kvNamespace'));
  kvSaving.value = true;
  try {
    const res = await api('POST', `/cdn/accounts/${aid}/kv/namespaces`, { zoneId, namespace: kvForm.namespace.trim(), remark: kvForm.remark.trim() || undefined });
    if (res.code === 0) { message.success(res.msg); kvForm.namespace = ''; kvForm.remark = ''; await loadKvNamespaces(); } else message.error(res.msg);
  } finally {
    kvSaving.value = false;
  }
}

function delKvNamespace(r: any) {
  dialog.warning({ title: t('cdnZoneSetting.delete'), content: t('cdnAdvanced.confirmDelete', { name: r.Namespace }), positiveText: t('cdnZoneSetting.delete'), negativeText: t('cdnZoneSetting.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(String(r.Namespace))}`, { zoneId });
    if (res.code === 0) { message.success(res.msg); await loadKvNamespaces(); } else message.error(res.msg);
  } });
}

function openKvKeys(r: any) {
  kvKeyNamespace.value = String(r.Namespace || '');
  kvPrefix.value = '';
  kvKeysText.value = '';
  kvDataText.value = '';
  kvKeyForm.key = '';
  kvKeyForm.value = '';
  kvKeyForm.ttl = '';
  showKvKeys.value = true;
  loadKvKeys();
}

async function loadKvKeys() {
  if (!kvKeyNamespace.value) return;
  kvKeyLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(kvKeyNamespace.value)}/keys`, { zoneId, prefix: kvPrefix.value.trim(), limit: 100 });
    if (res.code === 0) kvKeysText.value = JSON.stringify(res.data || {}, null, 2);
    else message.error(res.msg);
  } finally {
    kvKeyLoading.value = false;
  }
}

async function kvGetKey() {
  if (!kvKeyForm.key.trim()) return message.warning(t('cdnZoneSetting.kvKey'));
  const res = await api<any>('POST', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(kvKeyNamespace.value)}/get`, { zoneId, keys: [kvKeyForm.key.trim()] });
  if (res.code === 0) kvDataText.value = JSON.stringify(res.data || [], null, 2);
  else message.error(res.msg);
}

async function kvPutKey() {
  if (!kvKeyForm.key.trim()) return message.warning(t('cdnZoneSetting.kvKey'));
  const res = await api<any>('POST', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(kvKeyNamespace.value)}/put`, { zoneId, key: kvKeyForm.key.trim(), value: kvKeyForm.value, ttl: kvKeyForm.ttl ? Number(kvKeyForm.ttl) : undefined });
  if (res.code === 0) { message.success(res.msg); await loadKvKeys(); await kvGetKey(); } else message.error(res.msg);
}

async function kvDeleteKey() {
  if (!kvKeyForm.key.trim()) return message.warning(t('cdnZoneSetting.kvKey'));
  const res = await api<any>('POST', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(kvKeyNamespace.value)}/delete`, { zoneId, keys: [kvKeyForm.key.trim()] });
  if (res.code === 0) { message.success(res.msg); kvDataText.value = ''; await loadKvKeys(); } else message.error(res.msg);
}

const showReplicas = ref(false);
const replicaFunctionId = ref('');
const replicas = ref<any[]>([]);
const replicaLoading = ref(false);
const showReplicaModal = ref(false);
const replicaEditingName = ref('');
const replicaJson = ref('');
const replicaSaving = ref(false);
const replicaTitle = computed(() => `${t('cdnZoneSetting.replicas')} · ${replicaFunctionId.value}`);
const replicaColumns = computed(() => [
  { title: 'ReplicaName', key: 'ReplicaName', minWidth: 180 },
  { title: 'Remark', key: 'Remark', minWidth: 180 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 150, render: (r: any) => h('div', { class: 'row-actions' }, [
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openReplicaModal(r) }, { default: () => t('cdnZoneSetting.edit') }),
    h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delReplica(r) }, { default: () => t('cdnZoneSetting.delete') }),
  ]) },
]);
const showBindings = ref(false);
const bindingFunctionId = ref('');
const bindingText = ref('');
const bindingLoading = ref(false);
const showBindingModal = ref(false);
const bindingJson = ref('');
const bindingSaving = ref(false);
const bindingTitle = computed(() => `${t('cdnZoneSetting.bindings')} · ${bindingFunctionId.value}`);
const showRuntime = ref(false);
const runtimeFunctionId = ref('');
const runtimeJson = ref('');
const runtimeLoading = ref(false);
const runtimeSaving = ref(false);
const runtimeTitle = computed(() => `${t('cdnZoneSetting.runtime')} · ${runtimeFunctionId.value}`);

function openReplicas(r: any) {
  replicaFunctionId.value = String(r.FunctionId || '');
  showReplicas.value = true;
  loadReplicas();
}

async function loadReplicas() {
  if (!replicaFunctionId.value) return;
  replicaLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/functions/${encodeURIComponent(replicaFunctionId.value)}/replicas`, { zoneId, page: 1, size: 100 });
    replicas.value = res.code === 0 ? res.data?.list || [] : [];
    if (res.code !== 0) message.error(res.msg);
  } finally {
    replicaLoading.value = false;
  }
}

function openReplicaModal(row?: any) {
  replicaEditingName.value = row ? String(row.ReplicaName || '') : '';
  replicaJson.value = JSON.stringify(row ? { ReplicaName: row.ReplicaName, Content: row.Content || '', Remark: row.Remark || '' } : { ReplicaName: '', Content: '', Remark: '' }, null, 2);
  showReplicaModal.value = true;
}

async function saveReplica() {
  let parsed: any;
  try { parsed = JSON.parse(replicaJson.value); } catch { return message.error(t('cdnSecurity.invalidJson')); }
  replicaSaving.value = true;
  try {
    const res: any = replicaEditingName.value
      ? await api('PUT', `/cdn/accounts/${aid}/functions/${encodeURIComponent(replicaFunctionId.value)}/replicas/${encodeURIComponent(replicaEditingName.value)}`, { zoneId, params: parsed })
      : await api('POST', `/cdn/accounts/${aid}/functions/${encodeURIComponent(replicaFunctionId.value)}/replicas`, { zoneId, params: parsed });
    if (res.code === 0) { message.success(res.msg); showReplicaModal.value = false; await loadReplicas(); } else message.error(res.msg);
  } finally {
    replicaSaving.value = false;
  }
}

function delReplica(r: any) {
  dialog.warning({ title: t('cdnZoneSetting.delete'), content: t('cdnAdvanced.confirmDelete', { name: r.ReplicaName }), positiveText: t('cdnZoneSetting.delete'), negativeText: t('cdnZoneSetting.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cdn/accounts/${aid}/functions/${encodeURIComponent(replicaFunctionId.value)}/replicas`, { zoneId, replicaNames: [String(r.ReplicaName)] });
    if (res.code === 0) { message.success(res.msg); await loadReplicas(); } else message.error(res.msg);
  } });
}

function openBindings(r: any) {
  bindingFunctionId.value = String(r.FunctionId || '');
  bindingText.value = '';
  showBindings.value = true;
  loadBindings();
}

async function loadBindings() {
  if (!bindingFunctionId.value) return;
  bindingLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/functions/${encodeURIComponent(bindingFunctionId.value)}/bindings`, { zoneId });
    if (res.code === 0) bindingText.value = JSON.stringify(res.data || [], null, 2);
    else message.error(res.msg);
  } finally {
    bindingLoading.value = false;
  }
}

function openBindingModal() {
  bindingJson.value = JSON.stringify({ Operation: 'bind', FunctionComponentBindings: [] }, null, 2);
  showBindingModal.value = true;
}

async function saveBindings() {
  let parsed: any;
  try { parsed = JSON.parse(bindingJson.value); } catch { return message.error(t('cdnSecurity.invalidJson')); }
  bindingSaving.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/functions/${encodeURIComponent(bindingFunctionId.value)}/bindings`, { zoneId, params: parsed });
    if (res.code === 0) { message.success(res.msg); showBindingModal.value = false; await loadBindings(); } else message.error(res.msg);
  } finally {
    bindingSaving.value = false;
  }
}

function openRuntime(r: any) {
  runtimeFunctionId.value = String(r.FunctionId || '');
  runtimeJson.value = '';
  showRuntime.value = true;
  loadRuntime();
}

async function loadRuntime() {
  if (!runtimeFunctionId.value) return;
  runtimeLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/functions/${encodeURIComponent(runtimeFunctionId.value)}/runtime`, { zoneId });
    if (res.code === 0) runtimeJson.value = JSON.stringify(res.data || {}, null, 2);
    else message.error(res.msg);
  } finally {
    runtimeLoading.value = false;
  }
}

async function saveRuntime() {
  let parsed: any;
  try { parsed = JSON.parse(runtimeJson.value); } catch { return message.error(t('cdnSecurity.invalidJson')); }
  runtimeSaving.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/functions/${encodeURIComponent(runtimeFunctionId.value)}/runtime`, { zoneId, params: parsed });
    if (res.code === 0) { message.success(res.msg); await loadRuntime(); } else message.error(res.msg);
  } finally {
    runtimeSaving.value = false;
  }
}



onMounted(() => {
  void loadFunctions();
  void loadFunctionRules();
  void loadKvNamespaces();
});
watch(
  () => !!props.caps.functions,
  (ready, prev) => {
    if (ready && !prev) {
      void loadFunctions();
      void loadFunctionRules();
    }
  },
);
watch(
  () => !!props.caps.kv,
  (ready, prev) => {
    if (ready && !prev) void loadKvNamespaces();
  },
);
watch(
  () => props.reloadKey,
  () => {
    void loadFunctions();
    void loadFunctionRules();
    void loadKvNamespaces();
  },
);
</script>
