<template>
  <div>
    <div class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">
          {{ t('esaZone.loadBalancers') }}
          <n-tag size="tiny" :bordered="false" type="warning" style="margin-left: 6px">Enterprise</n-tag>
          <n-tag v-if="rows.length" size="tiny" :bordered="false" class="tnum" style="margin-left: 6px">{{ rows.length }}</n-tag>
        </h3>
        <div class="app-panel__extra">
          <n-button size="small" :loading="loadBusy" :disabled="loadBusy" @click="load">{{ t('esaZone.reload') }}</n-button>
          <n-button size="small" type="primary" @click="openCreate">{{ t('esaZone.createLoadBalancer') }}</n-button>
        </div>
      </div>
      <p class="esa-module__hint">{{ t('esaZone.loadBalancersDesc') }}</p>
      <n-alert v-if="!poolOptions.length" type="warning" :show-icon="false" class="mb-3">
        {{ t('esaZone.loadBalancerNeedPool') }}
      </n-alert>
      <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>
      <ResponsiveDataTable :columns="columns" :data="rows" size="small" :loading="loadBusy" :empty-text="t('esaZone.empty')" :error="!!loadError" @retry="load" />
    </div>

    <n-modal
      v-model:show="showForm"
      preset="card"
      :title="editing ? t('esaZone.editLoadBalancer') : t('esaZone.createLoadBalancer')"
      class="modal-lg"
      :mask-closable="false"
    >
      <n-form label-placement="left" label-width="170" size="small">
        <n-form-item :label="t('esaZone.name')">
          <n-input v-model:value="form.Name" :disabled="!!editing" placeholder="lb.example.com" />
        </n-form-item>
        <n-form-item :label="t('esaZone.enabled')">
          <n-switch v-model:value="form.Enabled" size="small" />
        </n-form-item>
        <n-form-item :label="t('esaZone.description')">
          <n-input v-model:value="form.Description" type="textarea" :rows="2" />
        </n-form-item>
        <n-form-item :label="t('esaZone.defaultPools')">
          <EsaCardSelect
            v-model="form.DefaultPools"
            :options="poolOptions"
            :placeholder="t('esaZone.choosePools')"
            multiple
            searchable
            clearable
            compact
            class="esa-lb__select"
          />
        </n-form-item>
        <n-form-item :label="t('esaZone.fallbackPool')">
          <EsaCardSelect
            v-model="form.FallbackPool"
            :options="poolOptions"
            :placeholder="t('esaZone.choosePool')"
            searchable
            clearable
            compact
            class="esa-lb__select"
          />
        </n-form-item>
        <n-form-item :label="t('esaZone.steeringPolicy')">
          <EsaCardSelect v-model="form.SteeringPolicy" :options="steeringOptions" class="esa-lb__select" />
        </n-form-item>
        <n-form-item :label="t('esaZone.sessionAffinity')">
          <EsaCardSelect v-model="form.SessionAffinity" :options="affinityOptions" class="esa-lb__select" />
        </n-form-item>
        <n-form-item :label="t('esaZone.ttl')">
          <n-input-number v-model:value="form.Ttl" :min="10" :max="600" style="width: 220px" />
        </n-form-item>
        <n-divider title-placement="left" style="margin: 6px 0 14px">{{ t('esaZone.adaptiveRouting') }}</n-divider>
        <n-form-item :label="t('esaZone.failoverAcrossPools')">
          <n-switch v-model:value="form.FailoverAcrossPools" size="small" />
        </n-form-item>
        <n-form-item :label="t('esaZone.originLevelRetry')">
          <n-switch v-model:value="form.OriginLevelRetry" size="small" />
        </n-form-item>
        <n-divider title-placement="left" style="margin: 6px 0 14px">{{ t('esaZone.monitor') }}</n-divider>
        <n-form-item :label="t('esaZone.monitorType')">
          <EsaCardSelect v-model="form.MonitorType" :options="monitorTypeOptions" compact class="esa-lb__select" />
        </n-form-item>
        <template v-if="form.MonitorType !== 'off'">
          <n-form-item :label="t('esaZone.monitorMethod')">
            <EsaCardSelect v-model="form.MonitorMethod" :options="methodOptions" compact class="esa-lb__select" />
          </n-form-item>
          <n-form-item :label="t('esaZone.monitorPath')">
            <n-input v-model:value="form.MonitorPath" placeholder="/health" />
          </n-form-item>
          <n-form-item :label="t('esaZone.monitorPort')">
            <n-input-number v-model:value="form.MonitorPort" :min="1" :max="65535" style="width: 220px" />
          </n-form-item>
          <n-form-item :label="t('esaZone.monitorInterval')">
            <n-input-number v-model:value="form.MonitorInterval" :min="10" :max="600" style="width: 220px" />
          </n-form-item>
          <n-form-item :label="t('esaZone.monitorTimeout')">
            <n-input-number v-model:value="form.MonitorTimeout" :min="1" :max="10" style="width: 220px" />
          </n-form-item>
          <n-form-item :label="t('esaZone.monitorCodes')">
            <n-input v-model:value="form.MonitorCodes" placeholder="200,202" />
          </n-form-item>
          <n-form-item :label="t('esaZone.monitorFollow')">
            <n-switch v-model:value="form.MonitorFollow" size="small" />
          </n-form-item>
          <n-form-item :label="t('esaZone.monitorConsecutive')">
            <n-space>
              <n-input-number v-model:value="form.MonitorUp" :min="1" :max="10" style="width: 110px" />
              <n-input-number v-model:value="form.MonitorDown" :min="1" :max="10" style="width: 110px" />
            </n-space>
          </n-form-item>
          <n-form-item :label="t('esaZone.monitorRegion')">
            <EsaCardSelect v-model="form.MonitorRegion" :options="regionOptions" compact class="esa-lb__select" />
          </n-form-item>
        </template>
        <n-form-item :label="t('esaZone.lbRules')">
          <n-input
            v-model:value="form.RulesText"
            type="textarea"
            :rows="4"
            class="mono-input"
            spellcheck="false"
            :placeholder="rulesPlaceholder"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showForm = false">{{ t('esaZone.cancel') }}</n-button>
          <n-button type="primary" :loading="saveBusy" :disabled="saveBusy" @click="save">{{ t('esaZone.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialog, useMessage, NAlert, NButton, NDivider, NForm, NFormItem, NInput, NInputNumber, NModal, NSpace, NSwitch, NTag } from 'naive-ui';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import EsaCardSelect from './EsaCardSelect.vue';

const props = defineProps<{ aid: number; zoneId: string }>();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const rows = ref<any[]>([]);
const pools = ref<any[]>([]);
const loadBusy = ref(false);
const loadError = ref('');
const showForm = ref(false);
const editing = ref<any>(null);
const saveBusy = ref(false);

const form = reactive<Record<string, any>>({
  Name: '',
  Enabled: true,
  Description: '',
  DefaultPools: [],
  FallbackPool: null,
  SteeringPolicy: 'order',
  SessionAffinity: 'off',
  Ttl: 30,
  FailoverAcrossPools: true,
  OriginLevelRetry: false,
  MonitorType: 'HTTP',
  MonitorMethod: 'GET',
  MonitorPath: '/',
  MonitorPort: 80,
  MonitorInterval: 60,
  MonitorTimeout: 5,
  MonitorCodes: '200',
  MonitorFollow: false,
  MonitorUp: 3,
  MonitorDown: 5,
  MonitorRegion: 'Global',
  RulesText: '',
});

const steeringOptions = computed(() => [
  { value: 'order', label: t('esaZone.steeringOrder'), desc: t('esaZone.steeringOrderDesc') },
  { value: 'random', label: t('esaZone.steeringRandom'), desc: t('esaZone.steeringRandomDesc') },
  { value: 'geo', label: t('esaZone.steeringGeo'), desc: t('esaZone.steeringGeoDesc') },
]);

const affinityOptions = computed(() => [
  { value: 'off', label: t('esaZone.affinityOff'), desc: t('esaZone.affinityOffDesc') },
  { value: 'ip', label: t('esaZone.affinityIp'), desc: t('esaZone.affinityIpDesc') },
  { value: 'cookie', label: t('esaZone.affinityCookie'), desc: t('esaZone.affinityCookieDesc') },
  { value: 'http_header', label: t('esaZone.affinityHeader'), desc: t('esaZone.affinityHeaderDesc') },
]);

const monitorTypeOptions = [
  { label: 'HTTP', value: 'HTTP' },
  { label: 'HTTPS', value: 'HTTPS' },
  { label: 'TCP', value: 'TCP' },
  { label: 'UDP', value: 'UDP' },
  { label: 'ICMP Ping', value: 'ICMP Ping' },
  { label: t('esaZone.monitorOff'), value: 'off' },
];

const methodOptions = ['GET', 'HEAD', 'POST'].map((m) => ({ label: m, value: m }));

const regionOptions = computed(() => [
  { label: t('esaZone.monitorRegionGlobal'), value: 'Global' },
  { label: t('esaZone.monitorRegionCn'), value: 'ChineseMainland' },
  { label: t('esaZone.monitorRegionIntl'), value: 'OutsideChineseMainland' },
]);

const poolOptions = computed(() => pools.value.map((p) => ({ label: `${p.Name} (${p.Id})`, value: p.Id })));

const rulesPlaceholder = '[{"RuleName":"rule_1","Rule":"true","RuleEnable":"on"}]';

const columns = computed<any[]>(() => [
  { title: t('esaZone.name'), key: 'Name', minWidth: 180 },
  {
    title: t('esaZone.status'),
    key: 'Enabled',
    width: 100,
    render: (row: any) =>
      h(NTag, { size: 'small', type: row.Enabled ? 'success' : 'default', bordered: false }, {
        default: () => (row.Enabled ? t('esaZone.enabled') : t('esaZone.disabled')),
      }),
  },
  { title: t('esaZone.steeringPolicy'), key: 'SteeringPolicy', width: 120 },
  { title: t('esaZone.sessionAffinity'), key: 'SessionAffinity', width: 130 },
  { title: t('esaZone.ttl'), key: 'Ttl', width: 80 },
  {
    title: t('esaZone.defaultPools'),
    key: 'DefaultPools',
    minWidth: 160,
    render: (row: any) => (Array.isArray(row.DefaultPools) ? row.DefaultPools.join(', ') : '-'),
  },
  { title: t('esaZone.fallbackPool'), key: 'FallbackPool', width: 110 },
  {
    title: t('esaZone.actions'),
    key: 'actions',
    width: 140,
    render: (row: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEdit(row) }, { default: () => t('esaZone.edit') }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => remove(row) }, { default: () => t('esaZone.delete') }),
      ]),
  },
]);

async function call(action: string, params: Record<string, any> = {}) {
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
    action,
    zoneId: props.zoneId,
    params,
  });
  if (res.code !== 0) throw new Error(res.msg || t('esaZone.loadFailed'));
  return res.data;
}

async function load() {
  loadBusy.value = true;
  loadError.value = '';
  try {
    const [lb, pool] = await Promise.all([call('ListLoadBalancers'), call('ListOriginPools')]);
    rows.value = Array.isArray(lb?.LoadBalancers) ? lb.LoadBalancers : [];
    pools.value = Array.isArray(pool?.OriginPools) ? pool.OriginPools : [];
  } catch (e: any) {
    loadError.value = e?.message || t('esaZone.loadFailed');
    rows.value = [];
  } finally {
    loadBusy.value = false;
  }
}

function resetForm() {
  Object.assign(form, {
    Name: '',
    Enabled: true,
    Description: '',
    DefaultPools: [],
    FallbackPool: null,
    SteeringPolicy: 'order',
    SessionAffinity: 'off',
    Ttl: 30,
    FailoverAcrossPools: true,
    OriginLevelRetry: false,
    MonitorType: 'HTTP',
    MonitorMethod: 'GET',
    MonitorPath: '/',
    MonitorPort: 80,
    MonitorInterval: 60,
    MonitorTimeout: 5,
    MonitorCodes: '200',
    MonitorFollow: false,
    MonitorUp: 3,
    MonitorDown: 5,
    MonitorRegion: 'Global',
    RulesText: '',
  });
}

function openCreate() {
  editing.value = null;
  resetForm();
  showForm.value = true;
}

function openEdit(row: any) {
  editing.value = row;
  const monitor = row.Monitor || {};
  Object.assign(form, {
    Name: row.Name || '',
    Enabled: row.Enabled !== false,
    Description: row.Description || '',
    DefaultPools: Array.isArray(row.DefaultPools) ? [...row.DefaultPools] : [],
    FallbackPool: row.FallbackPool ?? null,
    SteeringPolicy: row.SteeringPolicy || 'order',
    SessionAffinity: row.SessionAffinity || 'off',
    Ttl: Number(row.Ttl || 30),
    FailoverAcrossPools: row.AdaptiveRouting?.FailoverAcrossPools !== false,
    OriginLevelRetry: row.AdaptiveRouting?.OriginLevelRetry === true,
    MonitorType: monitor.Type || 'HTTP',
    MonitorMethod: monitor.Method || 'GET',
    MonitorPath: monitor.Path || '/',
    MonitorPort: Number(monitor.Port || 80),
    MonitorInterval: Number(monitor.Interval || 60),
    MonitorTimeout: Number(monitor.Timeout || 5),
    MonitorCodes: monitor.ExpectedCodes || '200',
    MonitorFollow: monitor.FollowRedirects === true,
    MonitorUp: Number(monitor.ConsecutiveUp || 3),
    MonitorDown: Number(monitor.ConsecutiveDown || 5),
    MonitorRegion: monitor.MonitoringRegion || 'Global',
    RulesText: Array.isArray(row.Rules) && row.Rules.length ? JSON.stringify(row.Rules, null, 2) : '',
  });
  showForm.value = true;
}

async function save() {
  if (!form.Name.trim()) return message.warning(t('esaZone.needName'));
  if (!form.DefaultPools.length) return message.warning(t('esaZone.needDefaultPool'));
  if (form.FallbackPool === null || form.FallbackPool === undefined) return message.warning(t('esaZone.needFallbackPool'));
  let rules: any[] | undefined;
  if (String(form.RulesText || '').trim()) {
    try {
      const parsed = JSON.parse(form.RulesText);
      if (!Array.isArray(parsed)) throw new Error('not array');
      rules = parsed;
    } catch {
      return message.warning(t('esaZone.invalidJson'));
    }
  }
  const monitor: Record<string, any> = { Type: form.MonitorType };
  if (form.MonitorType !== 'off') {
    Object.assign(monitor, {
      Method: form.MonitorMethod,
      Path: form.MonitorPath,
      Port: Number(form.MonitorPort),
      Interval: Number(form.MonitorInterval),
      Timeout: Number(form.MonitorTimeout),
      ExpectedCodes: form.MonitorCodes,
      FollowRedirects: form.MonitorFollow,
      ConsecutiveUp: Number(form.MonitorUp),
      ConsecutiveDown: Number(form.MonitorDown),
      MonitoringRegion: form.MonitorRegion,
    });
  }
  const payload: Record<string, any> = {
    ...(editing.value ? { Id: editing.value.Id } : { Name: form.Name.trim() }),
    Enabled: form.Enabled,
    Description: form.Description,
    DefaultPools: form.DefaultPools,
    FallbackPool: Number(form.FallbackPool),
    SteeringPolicy: form.SteeringPolicy,
    SessionAffinity: form.SessionAffinity,
    Ttl: Number(form.Ttl),
    AdaptiveRouting: {
      FailoverAcrossPools: form.FailoverAcrossPools,
      OriginLevelRetry: form.OriginLevelRetry,
    },
    Monitor: monitor,
    ...(rules ? { Rules: rules } : {}),
  };
  saveBusy.value = true;
  try {
    await call(editing.value ? 'UpdateLoadBalancer' : 'CreateLoadBalancer', payload);
    message.success(t('esaZone.saved'));
    showForm.value = false;
    await load();
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  } finally {
    saveBusy.value = false;
  }
}

function remove(row: any) {
  dialog.warning({
    title: t('esaZone.delete'),
    content: t('esaZone.deleteConfirm', { name: row.Name || '' }),
    positiveText: t('esaZone.delete'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      try {
        await call('DeleteLoadBalancer', { Id: row.Id });
        message.success(t('esaZone.deleted'));
        await load();
      } catch (e: any) {
        message.error(e?.message || t('esaZone.deleteFailed'));
      }
    },
  });
}

onMounted(load);
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
.esa-lb__select {
  max-width: 460px;
}
</style>
