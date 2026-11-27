<template>
  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">{{ t('cdnOrigin.originGroups') }}</h3>
      <div class="app-panel__extra">
        <n-tag size="tiny" :bordered="false" class="tnum">{{ originGroups.length }}</n-tag>
      </div>
    </div>
    <div class="zone-form-strip">
      <n-input v-model:value="ogForm.name" :placeholder="t('cdnOrigin.name')" style="width: 180px" size="small" />
      <n-input v-model:value="ogForm.hostHeader" :placeholder="t('cdnOrigin.hostHeader')" style="width: 180px" size="small" />
      <n-button size="small" type="primary" :loading="ogSaveBusy" @click="createOriginGroup">{{ t('cdnZoneSetting.create') }}</n-button>
      <n-input v-model:value="ogForm.records" type="textarea" :rows="3" :placeholder="t('cdnOrigin.recordsHint')" class="zone-form-strip__wide mono-input" />
      <n-input v-if="props.isEsa" v-model:value="ogForm.params" type="textarea" :rows="2" :placeholder="t('cdnOrigin.extraParamsHint')" class="zone-form-strip__wide mono-input" />
    </div>
    <ResponsiveDataTable :columns="ogColumns" :data="originGroups" size="small" :loading="busy" :empty-text="t('cdnAdvanced.ogEmpty')" :empty-description="t('cdnAdvanced.ogEmptyHint')" />
  </div>

  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">{{ t('cdnOrigin.loadBalancers') }}</h3>
      <div class="app-panel__extra">
        <n-tag size="tiny" :bordered="false" class="tnum">{{ loadBalancers.length }}</n-tag>
      </div>
    </div>
    <div class="zone-form-strip">
      <n-input v-model:value="lbForm.name" :placeholder="t('cdnOrigin.name')" style="width: 180px" size="small" />
      <EsaCardSelect v-model="lbForm.type" :options="lbTypeOptions" dense style="width: 160px; flex: 0 0 160px" />
      <n-button size="small" type="primary" :loading="lbSaveBusy" @click="createLoadBalancer">{{ t('cdnZoneSetting.create') }}</n-button>
      <EsaCardSelect
        v-model="lbForm.originGroups"
        :options="ogOptions"
        :placeholder="t('cdnOrigin.originGroupsPick')"
        multiple
        searchable
        clearable
        dense
        class="zone-form-strip__wide"
      />
      <n-input v-if="props.isEsa" v-model:value="lbForm.params" type="textarea" :rows="2" :placeholder="t('cdnOrigin.extraParamsHint')" class="zone-form-strip__wide mono-input" />
    </div>
    <ResponsiveDataTable :columns="lbColumns" :data="loadBalancers" size="small" :loading="busy" :empty-text="t('cdnAdvanced.lbEmpty')" :empty-description="t('cdnAdvanced.lbEmptyHint')" />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue';
import { NButton, useDialog, useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import EsaCardSelect from './EsaCardSelect.vue';
import { parseExtraParams, parseOriginRecords } from '../../lib/cdn/zoneForms';

const props = defineProps<{
  aid: number;
  zoneId: string;
  isEsa: boolean;
  loadBalancerHealth: boolean;
  reloadKey: number;
}>();

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const originGroups = ref<any[]>([]);
const loadBalancers = ref<any[]>([]);
const busy = ref(false);
const ogSaveBusy = ref(false);
const lbSaveBusy = ref(false);
const ogForm = reactive<any>({ name: '', hostHeader: '', records: '', params: '' });
const lbForm = reactive<any>({ name: '', type: 'HTTP', originGroups: [], params: '' });
const lbTypeOptions = [
  { label: 'HTTP', value: 'HTTP' },
  { label: 'HTTP_V2', value: 'HTTP_V2' },
  { label: 'GENERAL', value: 'GENERAL' },
];
const ogOptions = computed(() => originGroups.value.map((g: any) => ({ label: g.name || String(g.groupId), value: String(g.groupId) })));
const ogColumns = computed(() => [
  { title: t('cdnOrigin.colName'), key: 'name', minWidth: 140 },
  { title: t('cdnOrigin.colType'), key: 'type', width: 100 },
  {
    title: t('cdnOrigin.colRecords'),
    key: 'records',
    minWidth: 200,
    render: (r: any) => (Array.isArray(r.records) ? r.records.map((x: any) => (typeof x === 'string' ? x : x.Record || x.record || x.Address || '')).join(', ') : ''),
  },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 90, render: (r: any) => h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delOriginGroup(r) }, { default: () => t('cdnZoneSetting.delete') }) },
]);
const lbColumns = computed(() => [
  { title: t('cdnOrigin.colName'), key: 'name', minWidth: 140 },
  { title: t('cdnOrigin.colType'), key: 'type', width: 120 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 160,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        ...(props.loadBalancerHealth
          ? [h(NButton, { size: 'tiny', quaternary: true, onClick: () => showLbHealth(r) }, { default: () => t('cdnOrigin.health') })]
          : []),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delLoadBalancer(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
  },
]);

async function loadOriginData(): Promise<boolean> {
  busy.value = true;
  try {
    const [og, lb] = await Promise.all([
      api<any>('GET', `/cdn/accounts/${props.aid}/origin-groups`, { zoneId: props.zoneId, page: 1, size: 100 }),
      api<any>('GET', `/cdn/accounts/${props.aid}/load-balancers`, { zoneId: props.zoneId, page: 1, size: 100 }),
    ]);
    originGroups.value = og.code === 0 ? og.data?.list || [] : [];
    loadBalancers.value = lb.code === 0 ? lb.data?.list || [] : [];
    return og.code === 0 && lb.code === 0;
  } finally {
    busy.value = false;
  }
}

async function createOriginGroup() {
  if (!ogForm.name) return message.warning(t('cdnOrigin.needName'));
  const records = parseOriginRecords(ogForm.records);
  if (!records.length) return message.warning(t('cdnOrigin.needRecords'));
  ogSaveBusy.value = true;
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/origin-groups`, {
    zoneId: props.zoneId,
    name: ogForm.name,
    records,
    hostHeader: ogForm.hostHeader || undefined,
    params: parseExtraParams(ogForm.params),
  });
  ogSaveBusy.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    ogForm.name = '';
    ogForm.records = '';
    ogForm.hostHeader = '';
    ogForm.params = '';
    void loadOriginData();
  } else message.error(res.msg);
}

function delOriginGroup(r: any) {
  dialog.warning({
    title: t('cdnOrigin.delete'),
    content: t('cdnOrigin.confirmDelete', { name: r.name || r.groupId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${props.aid}/origin-groups/${encodeURIComponent(r.groupId)}`, { zoneId: props.zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        void loadOriginData();
      } else message.error(res.msg);
    },
  });
}

async function createLoadBalancer() {
  if (!lbForm.name) return message.warning(t('cdnOrigin.needName'));
  lbSaveBusy.value = true;
  const originGroupsPayload = (lbForm.originGroups || []).map((gid: string, i: number) => ({ Priority: String(i + 1), OriginGroupId: String(gid) }));
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/load-balancers`, {
    zoneId: props.zoneId,
    name: lbForm.name,
    type: lbForm.type,
    originGroups: originGroupsPayload,
    params: parseExtraParams(lbForm.params),
  });
  lbSaveBusy.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    lbForm.name = '';
    lbForm.originGroups = [];
    lbForm.params = '';
    void loadOriginData();
  } else message.error(res.msg);
}

async function showLbHealth(r: any) {
  const res = await api<any>('GET', `/cdn/accounts/${props.aid}/load-balancers/${encodeURIComponent(String(r.instanceId))}/health`, { zoneId: props.zoneId });
  if (res.code !== 0) return message.error(res.msg);
  dialog.info({
    title: t('cdnOrigin.healthTitle', { name: r.name || r.instanceId }),
    content: () => h('pre', { class: 'code-view', style: 'max-height:480px' }, JSON.stringify(res.data || [], null, 2)),
  });
}

function delLoadBalancer(r: any) {
  dialog.warning({
    title: t('cdnOrigin.delete'),
    content: t('cdnOrigin.confirmDelete', { name: r.name || r.instanceId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${props.aid}/load-balancers/${encodeURIComponent(r.instanceId)}`, { zoneId: props.zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        void loadOriginData();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  void loadOriginData();
});
watch(
  () => props.reloadKey,
  () => {
    void loadOriginData();
  },
);
</script>
