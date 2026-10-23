<template>
  <n-card :bordered="false" class="zone-card">
    <template v-if="tab === 'overview'">
        <div class="zone-status-strip">
          <n-tag size="medium" :type="zoneInfo.paused ? 'warning' : 'success'" :bordered="false">{{ statusLabel }}</n-tag>
          <div class="zone-status-strip__id">
            <span class="zone-status-strip__name">{{ zoneInfo.zone_name || zoneInfo.name || zoneId }}</span>
            <span class="zone-status-strip__sub">{{ zoneId }}</span>
          </div>
          <div class="zone-status-strip__actions">
            <n-tag v-if="zoneInfo.ownershipVerified" type="success" :bordered="false" size="medium" class="ov-verified">
              <n-icon :component="CheckmarkCircleOutline" size="14" />
              {{ t('esaZone.verified') }}
            </n-tag>
            <n-button v-else size="small" :loading="busy.verify" :disabled="busy.verify" @click="verifyOwnership">{{ t('esaZone.verify') }}</n-button>
            <n-button size="small" :type="zoneInfo.paused ? 'primary' : 'warning'" :loading="busy.pause" :disabled="busy.pause" @click="togglePause">
              {{ zoneInfo.paused ? t('esaZone.resume') : t('esaZone.pause') }}
            </n-button>
            <n-button size="small" type="error" quaternary @click="deleteZone">{{ t('esaZone.delete') }}</n-button>
          </div>
        </div>

        <div class="app-panel">
          <n-descriptions :column="2" label-placement="left" size="small">
            <n-descriptions-item :label="t('esaZone.zoneId')"><span class="app-mono">{{ zoneId }}</span></n-descriptions-item>
            <n-descriptions-item :label="t('esaZone.zoneName')">{{ zoneInfo.zone_name || zoneInfo.name || '-' }}</n-descriptions-item>
            <n-descriptions-item :label="t('esaZone.status')">{{ statusLabel }}</n-descriptions-item>
            <n-descriptions-item :label="t('esaZone.area')">{{ zoneInfo.area || '-' }}</n-descriptions-item>
            <n-descriptions-item :label="t('esaZone.access')">{{ accessTypeLabel }}</n-descriptions-item>
            <n-descriptions-item :label="t('esaZone.domains')"><span class="tnum">{{ domains.length }}</span></n-descriptions-item>
          </n-descriptions>
        </div>

        <div class="app-panel">
          <div class="app-panel__head">
            <h3 class="app-panel__title">{{ t('esaZone.properties') }}</h3>
            <div class="app-panel__extra">
              <n-button size="small" type="primary" :loading="propsBusy" :disabled="propsBusy" @click="saveProperties">{{ t('esaZone.save') }}</n-button>
            </div>
          </div>
          <n-form label-placement="left" label-width="130" size="small">
            <n-form-item :label="t('esaZone.accessType')">
              <EsaCardSelect v-model="propsForm.accessType" :options="accessTypeOptions" compact />
            </n-form-item>
            <n-form-item :label="t('esaZone.coverage')">
              <EsaCardSelect v-model="propsForm.coverage" :options="coverageOptions" compact />
            </n-form-item>
            <n-form-item :label="t('esaZone.nameExclusive')">
              <n-switch v-model:value="propsForm.nameExclusive" size="small" />
            </n-form-item>
            <n-form-item :label="t('esaZone.versionManagement')">
              <n-tag size="small" :type="versionManagement ? 'success' : 'default'" :bordered="false">
                {{ versionManagement ? t('esaZone.enabled') : t('esaZone.disabled') }}
              </n-tag>
            </n-form-item>
            <n-form-item :label="t('esaZone.vanityNs')">
              <n-input v-model:value="propsForm.vanityNs" :placeholder="t('esaZone.vanityNsHint')" />
            </n-form-item>
          </n-form>
          <div class="zone-props-meta">
            <span>{{ t('esaZone.plan') }}: {{ siteProps.PlanName || '-' }}</span>
            <span>{{ t('esaZone.instance') }}: {{ siteProps.InstanceId || '-' }}</span>
            <span v-if="siteProps.CnameZone">{{ t('esaZone.cnameZone') }}: {{ siteProps.CnameZone }}</span>
            <span v-if="siteProps.VerifyCode">{{ t('esaZone.verifyCode') }}: <span class="app-mono">{{ siteProps.VerifyCode }}</span></span>
            <span v-if="siteProps.CreateTime">{{ t('esaZone.createTime') }}: {{ formatDateTime(siteProps.CreateTime) }}</span>
            <span v-if="siteProps.UpdateTime">{{ t('esaZone.updateTime') }}: {{ formatDateTime(siteProps.UpdateTime) }}</span>
            <span v-if="siteProps.OfflineReason">{{ t('esaZone.offlineReason') }}: {{ siteProps.OfflineReason }}</span>
          </div>
        </div>

        <div class="app-panel">
          <div class="app-panel__head">
            <h3 class="app-panel__title">{{ t('esaZone.nsServers') }}</h3>
          </div>
          <n-space v-if="nsList.length" :size="6">
            <n-tag v-for="ns in nsList" :key="ns" size="small" :bordered="false" class="app-mono">{{ ns }}</n-tag>
          </n-space>
          <span v-else class="hint-text">{{ t('esaZone.nsEmpty') }}</span>
        </div>
    </template>

    <EsaSettingsList v-else-if="tab === 'settings-list'" :aid="aid" :zone-id="zoneId" @go="onGo" />

    <EsaVersionsModule v-else-if="tab === 'versions'" :aid="aid" :zone-id="zoneId" />

    <EsaDnsModule v-else-if="tab === 'dns'" v-model:sub="deepSub.dns" :aid="aid" :zone-id="zoneId" />

    <EsaSslModule v-else-if="tab === 'ssl'" v-model:sub="deepSub.ssl" :aid="aid" :zone-id="zoneId" />

    <EsaSecurityModule
      v-else-if="tab === 'security'"
      v-model:sub="deepSub.security"
      :aid="aid"
      :zone-id="zoneId"
      :domains="domains"
    />

    <EsaCachingModule
      v-else-if="tab === 'caching'"
      v-model:sub="deepSub.caching"
      :aid="aid"
      :zone-id="zoneId"
      :domains="siteDomains"
    />

    <EsaRulesModule v-else-if="tab === 'rules'" ref="rulesRef" :aid="aid" :zone-id="zoneId" :domains="siteDomains" />

    <EsaNetworkModule v-else-if="tab === 'network'" v-model:sub="deepSub.network" :aid="aid" :zone-id="zoneId" />

    <EsaTrafficModule
      v-else-if="tab === 'traffic'"
      v-model:sub="deepSub.traffic"
      :aid="aid"
      :zone-id="zoneId"
      @go="onGo"
    />

    <EsaL4Module v-else-if="tab === 'l4'" v-model:sub="deepSub.l4" :aid="aid" :zone-id="zoneId" />

    <EsaErModule v-else-if="tab === 'er'" :aid="aid" :zone-id="zoneId" />

    <EsaCappingModule v-else-if="tab === 'capping'" :aid="aid" :zone-id="zoneId" @go="onGo" />

    <CdnZoneGlobalSetting v-else-if="tab === 'global'" :aid="aid" :zone-id="zoneId" @go-rules="onGo('rules')" />

    <EsaApiConsole v-else-if="tab === 'api'" :aid="aid" :zone-id="zoneId" />
  </n-card>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialog, useMessage, NCard, NButton, NDescriptions, NDescriptionsItem, NForm, NFormItem, NIcon, NInput, NSpace, NSwitch, NTag } from 'naive-ui';
import { CheckmarkCircleOutline } from '@vicons/ionicons5';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { formatDateTime } from '../../lib/datetime';
import EsaCardSelect from './EsaCardSelect.vue';
import EsaSettingsList from './EsaSettingsList.vue';
import EsaVersionsModule from './EsaVersionsModule.vue';
import EsaDnsModule from './EsaDnsModule.vue';
import EsaSslModule from './EsaSslModule.vue';
import EsaSecurityModule from './EsaSecurityModule.vue';
import EsaCachingModule from './EsaCachingModule.vue';
import EsaRulesModule from './EsaRulesModule.vue';
import EsaNetworkModule from './EsaNetworkModule.vue';
import EsaTrafficModule from './EsaTrafficModule.vue';
import EsaErModule from './EsaErModule.vue';
import EsaCappingModule from './EsaCappingModule.vue';
import EsaL4Module from './EsaL4Module.vue';
import CdnZoneGlobalSetting from './CdnZoneGlobalSetting.vue';
import EsaApiConsole from './EsaApiConsole.vue';

const props = defineProps<{
  aid: number;
  zoneId: string;
  zoneInfo: Record<string, any>;
  domains: any[];
  nsList: string[];
  subs: Record<string, string>;
}>();

const emit = defineEmits<{ (e: 'refresh'): void }>();

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const router = useRouter();

const tab = defineModel<string>('tab', { default: 'overview' });
const deepSub = props.subs;
const rulesRef = ref<any>(null);

const busy = reactive({ verify: false, pause: false });
const propsBusy = ref(false);
const siteProps = ref<Record<string, any>>({});
const propsForm = reactive({ accessType: 'NS', coverage: 'global', nameExclusive: false, vanityNs: '' });

const siteDomains = computed(() => {
  const set = new Set<string>();
  for (const d of props.domains || []) {
    const n = d?.name || d?.domain;
    if (n) set.add(String(n));
  }
  const zn = props.zoneInfo?.zone_name || props.zoneInfo?.name;
  if (zn) set.add(String(zn));
  return [...set];
});

const statusLabel = computed(() => {
  if (props.zoneInfo?.paused) return t('cdnSite.statusPaused');
  const map: Record<string, string> = {
    active: t('cdnSite.statusActive'),
    pending: t('cdnSite.statusPending'),
    offline: t('cdnSite.statusOffline'),
    moved: t('cdnSite.statusMoved'),
    deactivated: t('cdnSite.statusDeactivated'),
    initializing: t('cdnSite.statusInitializing'),
  };
  return map[String(props.zoneInfo?.status || '').toLowerCase()] || props.zoneInfo?.status || '-';
});

const accessTypeLabel = computed(
  () => siteProps.value.accessType || siteProps.value.AccessType || props.zoneInfo?.accessType || '-',
);
const versionManagement = computed(
  () =>
    siteProps.value.versionManagement === true ||
    siteProps.value.versionManagement === 'true' ||
    siteProps.value.VersionManagement === true,
);

const accessTypeOptions = computed(() => [
  { label: t('esaZone.accessNS'), value: 'NS', desc: t('esaZone.accessNSDesc') },
  { label: t('esaZone.accessCNAME'), value: 'CNAME', desc: t('esaZone.accessCNAMEDesc') },
]);
const coverageOptions = computed(() => [
  { label: t('esaZone.coverageDomestic'), value: 'domestic', desc: t('esaZone.coverageDomesticDesc') },
  { label: t('esaZone.coverageGlobal'), value: 'global', desc: t('esaZone.coverageGlobalDesc') },
  { label: t('esaZone.coverageOverseas'), value: 'overseas', desc: t('esaZone.coverageOverseasDesc') },
]);

function onGo(target: string, sub?: string) {
  if (target === 'rules' && sub) {
    tab.value = 'rules';
    nextTick(() => rulesRef.value?.selectCategory?.(sub));
    return;
  }
  if (sub) deepSub[target] = sub;
  else delete deepSub[target];
  tab.value = target;
}

async function loadProperties() {
  const res = await api<any>('GET', `/cdn/accounts/${props.aid}/sites/${encodeURIComponent(props.zoneId)}/properties`);
  if (res.code !== 0) return;
  const d = res.data || {};
  siteProps.value = {
    ...d,
    PlanName: d.PlanName ?? d.planName ?? '',
    InstanceId: d.InstanceId ?? d.instanceId ?? '',
    CnameZone: d.CnameZone ?? d.cnameZone ?? '',
    VerifyCode: d.VerifyCode ?? d.verifyCode ?? '',
    CreateTime: d.CreateTime ?? d.createTime ?? '',
    UpdateTime: d.UpdateTime ?? d.updateTime ?? '',
    OfflineReason: d.OfflineReason ?? d.offlineReason ?? '',
  };
  propsForm.accessType = siteProps.value.accessType || siteProps.value.AccessType || 'NS';
  propsForm.coverage = siteProps.value.area || siteProps.value.Coverage || 'global';
  propsForm.nameExclusive = siteProps.value.nameExclusive === true;
  propsForm.vanityNs = Array.isArray(siteProps.value.vanityNs) ? siteProps.value.vanityNs.join(',') : '';
}

async function saveProperties() {
  propsBusy.value = true;
  try {
    const res = await api<any>('PUT', `/cdn/accounts/${props.aid}/sites/${encodeURIComponent(props.zoneId)}`, {
      accessType: propsForm.accessType,
      coverage: propsForm.coverage,
      nameExclusive: propsForm.nameExclusive,
      vanityNs: propsForm.vanityNs,
    });
    if (res.code === 0) {
      message.success(t('esaZone.saved'));
      await loadProperties();
      emit('refresh');
    } else message.error(res.msg);
  } finally {
    propsBusy.value = false;
  }
}

async function verifyOwnership() {
  busy.verify = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/sites/verify`, {
      zoneId: props.zoneId,
      domain: props.zoneInfo?.zone_name || props.zoneInfo?.name,
    });
    if (res.code === 0) {
      message.success(t('esaZone.verifySubmitted'));
      emit('refresh');
    } else message.error(res.msg);
  } finally {
    busy.verify = false;
  }
}

async function togglePause() {
  busy.pause = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/sites/pause`, {
      zoneId: props.zoneId,
      paused: !props.zoneInfo?.paused,
    });
    if (res.code === 0) {
      message.success(res.msg);
      emit('refresh');
    } else message.error(res.msg);
  } finally {
    busy.pause = false;
  }
}

function deleteZone() {
  dialog.warning({
    title: t('esaZone.delete'),
    content: t('esaZone.deleteConfirm', { name: props.zoneInfo?.zone_name || props.zoneInfo?.name || props.zoneId }),
    positiveText: t('esaZone.delete'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      const res = await api<any>('DELETE', `/cdn/accounts/${props.aid}/sites/${encodeURIComponent(props.zoneId)}`);
      if (res.code === 0) {
        message.success(t('esaZone.deleted'));
        router.push('/cdn-zones');
      } else message.error(res.msg);
    },
  });
}

onMounted(loadProperties);
</script>

<style scoped>
.ov-verified {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.zone-props-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--app-divider);
  color: var(--app-text-3);
  font-size: 12px;
}

.esa-zone__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
</style>
