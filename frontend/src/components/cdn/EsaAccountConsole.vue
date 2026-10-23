<template>
  <n-card :bordered="false" class="zone-card">
    <n-alert v-if="error" type="error" :show-icon="false" class="mb-3">{{ error }}</n-alert>

    <EsaAccountOverview
      v-if="section === 'overview'"
      :account-name="accountName"
      :plan-name="planName"
      :instance-id="instanceId"
      :sites="counts.sites"
      :routines="counts.routines"
      :lists="counts.lists"
      :slider-pages="counts.sliderPages"
      :busy="loading"
      @go="section = $event"
      @refresh="load"
    />
    <EsaEdgeComputingModule v-else-if="section === 'edge'" v-model:sub="subs.edge" :aid="aid" />
    <EsaCaptchaModule v-else-if="section === 'captcha'" v-model:sub="subs.captcha" :aid="aid" />
    <EsaAccountAnalyticsModule v-else-if="section === 'analytics'" v-model:sub="subs.analytics" :aid="aid" :sites="sites" />
    <EsaGlobalSettingsModule v-else-if="section === 'global'" v-model:sub="subs.global" :aid="aid" :instance-id="instanceId" />
    <EsaToolsModule v-else-if="section === 'tools'" v-model:sub="subs.tools" :aid="aid" />
    <EsaBillingModule v-else-if="section === 'billing'" v-model:sub="subs.billing" :aid="aid" :instance-id="instanceId" />
  </n-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NCard } from 'naive-ui';
import { api } from '../../api';
import EsaAccountOverview from './EsaAccountOverview.vue';
import EsaEdgeComputingModule from './EsaEdgeComputingModule.vue';
import EsaCaptchaModule from './EsaCaptchaModule.vue';
import EsaAccountAnalyticsModule from './EsaAccountAnalyticsModule.vue';
import EsaGlobalSettingsModule from './EsaGlobalSettingsModule.vue';
import EsaToolsModule from './EsaToolsModule.vue';
import EsaBillingModule from './EsaBillingModule.vue';

const props = defineProps<{ aid: number; subs: Record<string, string> }>();
const { t } = useI18n();

const section = defineModel<string>('section', { default: 'overview' });
const loading = ref(false);
const error = ref('');
const accountName = ref('');
const planName = ref('');
const instanceId = ref('');
const sites = ref<any[]>([]);
const counts = reactive({ sites: 0, routines: 0, lists: 0, sliderPages: 0 });

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

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [accountsRes, zonesRes] = await Promise.all([
      api<any>('GET', '/cdn/accounts'),
      api<any>('GET', `/cdn/zones?aid=${props.aid}`),
    ]);
    if (accountsRes.code === 0) {
      accountName.value = String((accountsRes.data || []).find((a: any) => Number(a.id) === props.aid)?.name || '');
    }
    sites.value = zonesRes.code === 0 ? zonesRes.data || [] : [];
    counts.sites = sites.value.length;

    const [planData, routinesData, listsData, sliderData] = await Promise.all([
      call('ListUserRatePlanInstances', { PageNumber: 1, PageSize: 50 }).catch(() => null),
      call('ListUserRoutines', { PageNumber: 1, PageSize: 100 }).catch(() => null),
      call('ListLists', { PageNumber: 1, PageSize: 100 }).catch(() => null),
      call('ListSliderCaptchaPages', { PageNumber: 1, PageSize: 100 }).catch(() => null),
    ]);

    const plans = extractList(planData, ['Instances', 'RatePlanInstances', 'Data']);
    planName.value = String(plans[0]?.PlanName || '');
    instanceId.value = String(plans[0]?.InstanceId || sites.value[0]?.instanceId || '');
    counts.routines = extractList(routinesData, ['Routines']).length;
    counts.lists = extractList(listsData, ['Lists']).length;
    counts.sliderPages = extractList(sliderData, ['Pages', 'SliderCaptchaPages']).length;
  } catch (e: any) {
    error.value = e?.message || t('esaAccount.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

defineExpose({ reload: load });
</script>
