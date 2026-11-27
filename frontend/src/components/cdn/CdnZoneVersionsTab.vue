<template>
  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">{{ t('cdnZoneSetting.environments') }}</h3>
      <div class="app-panel__extra">
        <n-button size="small" :loading="envLoading" :disabled="envLoading" @click="loadEnvironments">{{ t('cdnAdvanced.load') }}</n-button>
      </div>
    </div>
    <pre v-if="envText" class="code-view">{{ envText }}</pre>
    <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
  </div>

  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">{{ t('cdnZoneSetting.configVersions') }}</h3>
      <div class="app-panel__extra">
        <n-input v-model:value="groupId" :placeholder="t('cdnZoneSetting.groupIdHint')" size="small" style="width: 220px" />
        <n-button size="small" :loading="versionLoading" :disabled="versionLoading || !groupId.trim()" @click="loadVersions">{{ t('cdnAdvanced.load') }}</n-button>
        <n-button size="small" type="primary" @click="openModal('create')">{{ t('cdnZoneSetting.createVersion') }}</n-button>
      </div>
    </div>
    <ResponsiveDataTable :columns="versionColumns" :data="versionList" size="small" :loading="versionLoading" :empty-text="t('cdnZoneSetting.versionEmpty')" />
  </div>

  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">{{ t('cdnZoneSetting.versionDeploy') }}</h3>
      <div class="app-panel__extra">
        <n-input v-model:value="envId" :placeholder="t('cdnZoneSetting.envIdHint')" size="small" style="width: 220px" />
        <n-button size="small" type="primary" @click="openModal('deploy')">{{ t('cdnZoneSetting.deployVersion') }}</n-button>
        <n-button size="small" :loading="historyLoading" :disabled="historyLoading || !envId.trim()" @click="loadHistory">{{ t('cdnZoneSetting.versionHistory') }}</n-button>
      </div>
    </div>
    <pre v-if="actionText" class="code-view">{{ actionText }}</pre>
    <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
  </div>

  <n-modal v-model:show="showModal" preset="card" :title="modalMode === 'create' ? t('cdnZoneSetting.createVersion') : t('cdnZoneSetting.deployVersion')" class="modal-lg" :mask-closable="false">
    <n-input v-model:value="jsonText" type="textarea" :rows="16" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.versionJsonHint')" />
    <template #footer>
      <n-space justify="end">
        <n-button @click="showModal = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
        <n-button type="primary" :loading="saving" :disabled="saving" @click="saveModal">{{ t('cdnZoneSetting.save') }}</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { NButton, useDialog, useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';

const props = defineProps<{ aid: number; zoneId: string; reloadKey: number }>();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const envText = ref('');
const envLoading = ref(false);
const groupId = ref('');
const envId = ref('');
const versionList = ref<any[]>([]);
const versionLoading = ref(false);
const historyLoading = ref(false);
const actionText = ref('');
const showModal = ref(false);
const modalMode = ref<'create' | 'deploy'>('create');
const jsonText = ref('');
const saving = ref(false);
const versionColumns = computed(() => [
  { title: 'VersionId', key: 'VersionId', minWidth: 170 },
  { title: 'VersionNumber', key: 'VersionNumber', width: 120 },
  { title: 'GroupType', key: 'GroupType', width: 140 },
  { title: t('cdnRules.colStatus'), key: 'Status', width: 110 },
  { title: 'Description', key: 'Description', minWidth: 180 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 100,
    render: (r: any) => h(NButton, { size: 'tiny', quaternary: true, onClick: () => showDetail(r) }, { default: () => t('cdnSecurity.detail') }),
  },
]);

async function loadEnvironments() {
  envLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${props.aid}/sites/${encodeURIComponent(props.zoneId)}/environments`);
    if (res.code === 0) envText.value = JSON.stringify(res.data || [], null, 2);
    else message.error(res.msg);
  } finally {
    envLoading.value = false;
  }
}

async function loadVersions() {
  if (!groupId.value.trim()) return message.warning(t('cdnZoneSetting.groupIdHint'));
  versionLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${props.aid}/sites/${encodeURIComponent(props.zoneId)}/versions`, { groupId: groupId.value.trim(), page: 1, size: 100 });
    versionList.value = res.code === 0 ? res.data?.list || [] : [];
    if (res.code !== 0) message.error(res.msg);
  } finally {
    versionLoading.value = false;
  }
}

function openModal(mode: 'create' | 'deploy') {
  modalMode.value = mode;
  jsonText.value = JSON.stringify(
    mode === 'create'
      ? { GroupId: groupId.value.trim(), Content: '', Description: '' }
      : { EnvId: envId.value.trim(), ConfigGroupVersionInfos: [{ VersionId: '' }], Description: '' },
    null,
    2,
  );
  showModal.value = true;
}

async function saveModal() {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText.value);
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  saving.value = true;
  try {
    const suffix = modalMode.value === 'create' ? '' : '/deploy';
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/sites/${encodeURIComponent(props.zoneId)}/versions${suffix}`, { params: parsed });
    if (res.code === 0) {
      message.success(res.msg);
      showModal.value = false;
      if (modalMode.value === 'create') await loadVersions();
      else actionText.value = JSON.stringify(res.data || {}, null, 2);
    } else message.error(res.msg);
  } finally {
    saving.value = false;
  }
}

async function showDetail(row: any) {
  const res = await api<any>('GET', `/cdn/accounts/${props.aid}/sites/${encodeURIComponent(props.zoneId)}/versions/${encodeURIComponent(String(row.VersionId))}`);
  if (res.code !== 0) return message.error(res.msg);
  dialog.info({ title: `Version · ${row.VersionId}`, content: () => h('pre', { class: 'code-view', style: 'max-height:480px' }, JSON.stringify(res.data || {}, null, 2)) });
}

async function loadHistory() {
  if (!envId.value.trim()) return message.warning(t('cdnZoneSetting.envIdHint'));
  historyLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${props.aid}/sites/${encodeURIComponent(props.zoneId)}/versions/history`, { envId: envId.value.trim() });
    if (res.code === 0) actionText.value = JSON.stringify(res.data?.list || [], null, 2);
    else message.error(res.msg);
  } finally {
    historyLoading.value = false;
  }
}

onMounted(() => {
  void loadEnvironments();
});
watch(
  () => props.reloadKey,
  () => {
    void loadEnvironments();
    if (groupId.value.trim()) void loadVersions();
  },
);
</script>
