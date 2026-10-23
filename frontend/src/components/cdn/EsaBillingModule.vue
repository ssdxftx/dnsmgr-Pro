<template>
  <div>
    <template v-if="sub === 'plans'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaAccount.billingPlans') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="busy" :disabled="busy" @click="loadPlans">{{ t('esaZone.reload') }}</n-button>
          </div>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.billingPlansDesc') }}</p>
        <ResponsiveDataTable :columns="planColumns" :data="plans" size="small" :loading="busy" :empty-text="t('esaZone.empty')" />
      </div>
    </template>

    <template v-else-if="sub === 'usage'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaAccount.billingUsage') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.billingUsageDesc') }}</p>
        <n-form label-placement="left" label-width="120" size="small">
          <n-form-item :label="t('esaAccount.instance')">
            <EsaCardSelect
              v-model="usageInstance"
              :options="instanceOptions"
              compact
              clearable
              searchable
              style="width: 320px"
            />
          </n-form-item>
          <n-form-item :label="t('esaAccount.usageQuotaNames')">
            <n-input v-model:value="quotaNames" placeholder="customHttpCert,waiting_room,cache_rules|rule_quota" />
          </n-form-item>
          <n-form-item :show-label="false">
            <n-button size="small" type="primary" :loading="usageBusy" :disabled="usageBusy" @click="loadUsage">{{ t('esaAccount.usageQuery') }}</n-button>
          </n-form-item>
        </n-form>
        <n-alert v-if="usageError" type="error" :show-icon="false" class="mb-3">{{ usageError }}</n-alert>
        <div v-if="quotas.length" class="esa-quota-grid">
          <div v-for="q in quotas" :key="q.key" class="esa-quota-card">
            <div class="esa-quota-card__head">
              <span class="esa-quota-card__label">{{ q.label }}</span>
              <span class="esa-quota-card__value tnum">{{ q.used }} / {{ q.quota }}</span>
            </div>
            <n-progress
              type="line"
              :percentage="q.percent"
              :status="q.percent >= 90 ? 'error' : q.percent >= 70 ? 'warning' : 'success'"
              :height="6"
              :show-indicator="false"
            />
          </div>
        </div>
        <span v-else-if="!usageBusy" class="hint-text">{{ t('esaAccount.usageEmpty') }}</span>
      </div>
    </template>

    <template v-else>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaAccount.billingPackages') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="packageBusy" :disabled="packageBusy" @click="loadPackages">{{ t('esaZone.reload') }}</n-button>
          </div>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.billingPackagesDesc') }}</p>
        <pre v-if="packageText" class="code-view">{{ packageText }}</pre>
        <span v-else class="hint-text">{{ t('esaZone.empty') }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NForm, NFormItem, NInput, NProgress, useMessage } from 'naive-ui';
import { api } from '../../api';
import { formatDateTime } from '../../lib/datetime';
import EsaCardSelect from './EsaCardSelect.vue';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';

const props = defineProps<{ aid: number; instanceId: string }>();
const { t } = useI18n();
const message = useMessage();

const sub = defineModel<string>('sub', { default: 'plans' });

const busy = ref(false);
const usageBusy = ref(false);
const packageBusy = ref(false);
const plans = ref<any[]>([]);
const quotas = ref<any[]>([]);
const usageError = ref('');
const usageInstance = ref(props.instanceId || '');
const quotaNames = ref('customHttpCert,waiting_room,https|rule_quota,cache_rules|rule_quota,configuration_rules|rule_quota');
const packageText = ref('');

watch(
  () => props.instanceId,
  (v) => {
    if (!usageInstance.value && v) usageInstance.value = v;
  },
);

const instanceOptions = computed(() =>
  plans.value
    .map((p) => ({ label: `${p.PlanName || p.InstanceId || '-'} (${p.InstanceId || '-'})`, value: String(p.InstanceId || '') }))
    .filter((o) => o.value),
);

const planColumns = computed(() => [
  { title: t('esaAccount.instance'), key: 'InstanceId', minWidth: 160, render: (row: any) => h('span', { class: 'app-mono' }, row.InstanceId || '-') },
  { title: t('esaAccount.planName'), key: 'PlanName', minWidth: 150 },
  { title: t('esaAccount.planType'), key: 'PlanType', minWidth: 120 },
  { title: t('esaAccount.planStatus'), key: 'Status', width: 100 },
  { title: t('esaAccount.planExpire'), key: 'ExpireTime', minWidth: 170, render: (row: any) => formatDateTime(row.ExpireTime) },
  { title: t('esaAccount.planSiteQuota'), key: 'SiteQuota', width: 110 },
]);

const quotaMeta: Record<string, string> = {
  customHttpCert: 'quotaCustomHttpCert',
  waiting_room: 'quotaWaitingRoom',
  'https|rule_quota': 'quotaHttpsRules',
  'cache_rules|rule_quota': 'quotaCacheRules',
  'configuration_rules|rule_quota': 'quotaConfigRules',
  'redirect_rules|rule_quota': 'quotaRedirectRules',
  'compression_rules|rule_quota': 'quotaCompressionRules',
  'origin_rules|rule_quota': 'quotaOriginRules',
  transition_rule: 'quotaTransitionRule',
};

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

async function loadPlans() {
  busy.value = true;
  try {
    const data = await call('ListUserRatePlanInstances', { PageNumber: 1, PageSize: 100 });
    plans.value = extractList(data, ['Instances', 'RatePlanInstances', 'Data']);
    if (!usageInstance.value && plans.value.length) usageInstance.value = String(plans.value[0].InstanceId || '');
  } catch (e: any) {
    message.error(e?.message || t('esaAccount.loadFailed'));
  } finally {
    busy.value = false;
  }
}

async function loadUsage() {
  if (!usageInstance.value) return message.warning(t('esaAccount.instance'));
  usageBusy.value = true;
  usageError.value = '';
  quotas.value = [];
  try {
    const data = await call('ListInstanceQuotasWithUsage', {
      InstanceId: usageInstance.value,
      QuotaNames: quotaNames.value,
    });
    const rows = extractList(data, ['Quotas']);
    quotas.value = rows.map((q: any) => {
      const key = String(q.QuotaName || '');
      const used = Number(q.Usage || 0);
      const quotaNum = Number(q.QuotaValue);
      const labelKey = quotaMeta[key];
      return {
        key,
        label: labelKey ? t(`esaAccount.${labelKey}`) : key,
        used,
        quota: Number.isFinite(quotaNum) ? quotaNum : String(q.QuotaValue ?? '-'),
        percent: Number.isFinite(quotaNum) && quotaNum > 0 ? Math.min(100, Math.round((used / quotaNum) * 100)) : 0,
      };
    });
  } catch (e: any) {
    usageError.value = e?.message || t('esaAccount.loadFailed');
  } finally {
    usageBusy.value = false;
  }
}

async function loadPackages() {
  packageBusy.value = true;
  try {
    const data = await call('DescribeUserResourcePackage', { PageNumber: 1, PageSize: 50 });
    packageText.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
    message.error(e?.message || t('esaAccount.loadFailed'));
  } finally {
    packageBusy.value = false;
  }
}

onMounted(loadPlans);
</script>

<style scoped>
.esa-quota-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.esa-quota-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  background: var(--app-surface);
}

.esa-quota-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.esa-quota-card__label {
  font-size: 12px;
  color: var(--app-text-2);
}

.esa-quota-card__value {
  font-size: 12px;
  font-weight: 700;
  color: var(--app-text-1);
}
</style>
