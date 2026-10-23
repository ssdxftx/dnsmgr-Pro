<template>
  <div>
    <div class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">{{ t('esaZone.cappingQuotaTitle') }}</h3>
        <div class="app-panel__extra">
          <n-button size="small" :loading="busy" :disabled="busy" @click="load">{{ t('esaZone.reload') }}</n-button>
        </div>
      </div>
      <p class="esa-module__hint">{{ t('esaZone.cappingQuotaDesc') }}</p>
      <n-alert v-if="error" type="error" :show-icon="false" class="mb-3">{{ error }}</n-alert>
      <div v-if="quotas.length" class="esa-cap__grid">
        <div v-for="q in quotas" :key="q.key" class="esa-cap__card">
          <div class="esa-cap__head">
            <span class="esa-cap__name">{{ q.label }}</span>
            <span class="esa-cap__value tnum">{{ q.used }} / {{ q.quota }}</span>
          </div>
          <n-progress
            type="line"
            :percentage="q.percent"
            :status="q.percent >= 90 ? 'error' : q.percent >= 70 ? 'warning' : 'success'"
            :show-indicator="false"
            :height="6"
          />
          <span class="esa-cap__code">{{ q.key }}</span>
        </div>
      </div>
      <n-empty v-else-if="!busy && !error" size="small" :description="t('esaZone.empty')" />
    </div>

    <div class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">{{ t('esaZone.cappingTitle') }}</h3>
        <div class="app-panel__extra">
          <n-tag size="tiny" :bordered="false" type="info">{{ t('esaZone.cappingLimit') }}</n-tag>
        </div>
      </div>
      <p class="esa-module__hint">{{ t('esaZone.cappingHint') }}</p>
      <div class="esa-cap__rules">
        <div class="esa-cap__rule">
          <span class="esa-cap__rule-title">{{ t('esaZone.cappingRuleName') }}</span>
          <span class="esa-cap__rule-desc">{{ t('esaZone.cappingRuleNameDesc') }}</span>
        </div>
        <div class="esa-cap__rule">
          <span class="esa-cap__rule-title">{{ t('esaZone.cappingRuleCaps') }}</span>
          <span class="esa-cap__rule-desc">{{ t('esaZone.cappingRuleCapsDesc') }}</span>
        </div>
        <div class="esa-cap__rule">
          <span class="esa-cap__rule-title">{{ t('esaZone.cappingRuleAction') }}</span>
          <span class="esa-cap__rule-desc">{{ t('esaZone.cappingRuleActionDesc') }}</span>
        </div>
      </div>
      <n-alert type="info" :show-icon="false" class="mt-3 mb-3">{{ t('esaZone.cappingApiNote') }}</n-alert>
      <n-button size="small" @click="emit('go', 'api')">{{ t('esaZone.openApiConsole') }}</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NEmpty, NProgress, NTag } from 'naive-ui';
import { api } from '../../api';

const props = defineProps<{ aid: number; zoneId: string }>();
const emit = defineEmits<{ (e: 'go', target: string, sub?: string): void }>();
const { t } = useI18n();

const QUOTAS = [
  { key: 'customHttpCert', labelKey: 'cappingQuotaCert' },
  { key: 'waiting_room', labelKey: 'cappingQuotaWaitingRoom' },
  { key: 'https|rule_quota', labelKey: 'cappingQuotaHttpsRules' },
  { key: 'cache_rules|rule_quota', labelKey: 'cappingQuotaCacheRules' },
  { key: 'configuration_rules|rule_quota', labelKey: 'cappingQuotaConfigRules' },
  { key: 'redirect_rules|rule_quota', labelKey: 'cappingQuotaRedirectRules' },
  { key: 'compression_rules|rule_quota', labelKey: 'cappingQuotaCompressionRules' },
  { key: 'origin_rules|rule_quota', labelKey: 'cappingQuotaOriginRules' },
  { key: 'transition_rule', labelKey: 'cappingQuotaTransformRules' },
];

const rows = ref<any[]>([]);
const busy = ref(false);
const error = ref('');

const quotas = computed(() =>
  rows.value.map((q) => {
    const key = String(q.key);
    const meta = QUOTAS.find((x) => x.key === key);
    const used = Number(q.used || 0);
    const quotaNum = Number(q.quota);
    const quota = Number.isFinite(quotaNum) ? quotaNum : String(q.quota ?? '-');
    return {
      key,
      label: meta ? t(`esaZone.${meta.labelKey}`) : key,
      used,
      quota,
      percent: Number.isFinite(quotaNum) && quotaNum > 0 ? Math.min(100, Math.round((used / quotaNum) * 100)) : 0,
    };
  }),
);

function pick(row: any, keys: string[]) {
  for (const k of keys) {
    if (row?.[k] !== undefined && row?.[k] !== null && row?.[k] !== '') return row[k];
  }
  return undefined;
}

async function load() {
  busy.value = true;
  error.value = '';
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action: 'ListInstanceQuotasWithUsage',
      zoneId: props.zoneId,
      params: { QuotaNames: QUOTAS.map((q) => q.key).join(',') },
    });
    if (res.code !== 0) {
      error.value = res.msg || t('esaZone.loadFailed');
      rows.value = [];
      return;
    }
    const list = Array.isArray(res.data?.Quotas) ? res.data.Quotas : [];
    rows.value = list.map((row: any) => ({
      key: pick(row, ['QuotaName', 'Name', 'QuotaCode', 'Key']) || '',
      used: pick(row, ['Usage', 'Used', 'UsageValue', 'UsedValue']) ?? 0,
      quota: pick(row, ['QuotaValue', 'Quota', 'Total', 'Limit']) ?? 0,
    }));
  } catch (e: any) {
    error.value = e?.message || t('esaZone.loadFailed');
    rows.value = [];
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
.esa-cap__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}
.esa-cap__card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  background: var(--app-surface);
}
.esa-cap__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.esa-cap__name {
  font-size: 12px;
  color: var(--app-text-2);
}
.esa-cap__value {
  font-size: 12px;
  font-weight: 600;
}
.esa-cap__code {
  font-family: var(--app-font-mono);
  font-size: 10px;
  color: var(--app-text-3);
}
.esa-cap__rules {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.esa-cap__rule {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
}
.esa-cap__rule-title {
  font-size: 12px;
  font-weight: 600;
}
.esa-cap__rule-desc {
  font-size: 11px;
  color: var(--app-text-3);
  line-height: 1.5;
}
</style>
