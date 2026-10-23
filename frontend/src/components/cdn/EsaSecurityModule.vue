<template>
  <div>
    <template v-if="sub === 'overview'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.secOverview') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="busy" :disabled="busy" @click="loadCounts">{{ t('esaZone.reload') }}</n-button>
          </div>
        </div>
        <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>
        <div class="esa-sec__grid">
          <button v-for="c in countCards" :key="c.key" type="button" class="esa-sec__card" @click="openCount(c.key)">
            <span class="esa-sec__card-title">{{ c.label }}</span>
            <span class="esa-sec__card-value">{{ c.value }}</span>
            <span class="esa-sec__card-desc">{{ c.desc }}</span>
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="sub === 'events'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.secEvents') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaZone.secEventsHint') }}</p>
        <n-button size="small" type="primary" @click="openStats('security')">{{ t('esaZone.openAnalytics') }}</n-button>
      </div>
    </template>

    <template v-else-if="sub === 'waf'">
      <EsaModuleNav v-model:value="wafSub" :items="wafNavItems" />
      <EsaWafManagedModule v-if="wafSub === 'managed'" :aid="aid" :zone-id="zoneId" />
      <EsaWafSecurityLevelModule v-else-if="wafSub === 'security'" :aid="aid" :zone-id="zoneId" />
      <EsaWafRulesModule v-else :key="wafSub" :aid="aid" :zone-id="zoneId" :phase="currentWaf.phase" :domains="domains" />
    </template>

    <template v-else-if="sub === 'bots'">
      <EsaActionTable
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.botInstances')"
        :desc="t('esaZone.botInstancesDesc')"
        :columns="instanceColumns"
        list-action="ListBotInstances"
        items-path="Instances"
        gate="Premium"
      />
      <EsaActionPanel
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.botAppKey')"
        :desc="t('esaZone.botAppKeyDesc')"
        gate="Premium"
        load-action="GetWafBotAppKey"
      />
    </template>

    <template v-else-if="sub === 'ddos'">
      <EsaActionTable
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.ddosInstances')"
        :desc="t('esaZone.ddosInstancesDesc')"
        :columns="instanceColumns"
        list-action="ListDDoSInstances"
        items-path="Instances"
      />
      <EsaActionPanel
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.ddosHttp')"
        :desc="t('esaZone.ddosHttpDesc')"
        gate="Enterprise"
        load-action="DescribeHttpDDoSAttackProtection"
      />
    </template>

    <template v-else-if="gatedItem">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">
            {{ gatedItem.label }}
            <n-tag size="tiny" :bordered="false" type="warning" style="margin-left: 6px">{{ gatedItem.gate }}</n-tag>
          </h3>
        </div>
        <p class="esa-module__hint">{{ gatedItem.desc }}</p>
        <n-alert type="info" :show-icon="false">{{ t('esaZone.gatedHint', { plan: gatedItem.gate }) }}</n-alert>
      </div>
    </template>

    <template v-else>
      <EsaActionPanel
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.secSettings')"
        :desc="t('esaZone.secSettingsDesc')"
        load-action="GetSiteWafSettings"
        save-action="EditSiteWafSettings"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NTag } from 'naive-ui';
import { api } from '../../api';
import EsaModuleNav from './EsaModuleNav.vue';
import EsaActionPanel from './EsaActionPanel.vue';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';
import EsaWafRulesModule from './EsaWafRulesModule.vue';
import EsaWafManagedModule from './EsaWafManagedModule.vue';
import EsaWafSecurityLevelModule from './EsaWafSecurityLevelModule.vue';
import type { EsaWafPhase } from '../../lib/esaWafMeta';

const props = withDefaults(defineProps<{ aid: number; zoneId: string; domains?: string[] }>(), {
  domains: () => [],
});
const { t } = useI18n();
const router = useRouter();

function openStats(target: string) {
  router.push({ path: '/statistics/aliyun_esa', query: { aid: String(props.aid), zone: props.zoneId, tab: 'analytics', sub: target } });
}

const sub = defineModel<string>('sub', { default: 'overview' });
const wafSub = ref('custom');
const busy = ref(false);
const loadError = ref('');
const counts = reactive({ custom: 0, ratelimit: 0, managed: 0, whitelist: 0, ipaccess: 0, ddos: 0 });

const instanceColumns = computed<EsaTableColumn[]>(() => [
  { key: 'InstanceId', label: t('esaZone.instanceId'), minWidth: 170, mono: true, fallbackKeys: ['Id'] },
  { key: 'Name', label: t('esaZone.name'), minWidth: 180, fallbackKeys: ['InstanceName'] },
  { key: 'Status', label: t('esaZone.status'), width: 110 },
]);

const navItems = computed(() => [
  { key: 'overview', label: t('esaZone.secOverview'), desc: t('esaZone.secOverviewDesc') },
  { key: 'events', label: t('esaZone.secEvents'), desc: t('esaZone.secEventsDesc') },
  { key: 'waf', label: t('esaZone.secWaf'), desc: t('esaZone.secWafDesc') },
  { key: 'bots', label: t('esaZone.secBots'), desc: t('esaZone.secBotsDesc'), gate: 'Premium' },
  { key: 'ddos', label: 'DDoS', desc: t('esaZone.secDdosDesc') },
  { key: 'aicrawler', label: t('esaZone.secAiCrawler'), desc: t('esaZone.secAiCrawlerDesc'), gate: 'Pro' },
  { key: 'apisec', label: t('esaZone.secApi'), desc: t('esaZone.secApiDesc'), gate: 'Pro' },
  { key: 'originprotect', label: t('esaZone.secOriginProtection'), desc: t('esaZone.secOriginProtectionDesc'), gate: 'Pro' },
  { key: 'accountsec', label: t('esaZone.secAccountSecurity'), desc: t('esaZone.secAccountSecurityDesc'), gate: 'Enterprise' },
  { key: 'settings', label: t('esaZone.secSettings'), desc: t('esaZone.secSettingsDesc') },
]);

const gatedItem = computed(() => {
  const item = navItems.value.find((x) => x.key === sub.value);
  return item?.gate ? item : null;
});

const wafNavItems = computed(() => [
  { key: 'custom', label: t('esaZone.wafCustom'), desc: t('esaZone.wafCustomDesc') },
  { key: 'ratelimit', label: t('esaZone.wafRateLimit'), desc: t('esaZone.wafRateLimitDesc') },
  { key: 'managed', label: t('esaZone.wafManaged'), desc: t('esaZone.wafManagedDesc') },
  { key: 'scan', label: t('esaZone.wafScan'), desc: t('esaZone.wafScanDesc'), gate: 'Pro' },
  { key: 'whitelist', label: t('esaZone.wafWhitelist'), desc: t('esaZone.wafWhitelistDesc') },
  { key: 'ipaccess', label: t('esaZone.wafIpAccess'), desc: t('esaZone.wafIpAccessDesc') },
  { key: 'security', label: t('esaZone.wafSecurityLevel'), desc: t('esaZone.wafSecurityLevelDesc') },
]);

const wafPhaseMap: Record<string, EsaWafPhase> = {
  custom: 'http_custom',
  ratelimit: 'http_ratelimit',
  managed: 'http_managed',
  scan: 'http_anti_scan',
  whitelist: 'http_whitelist',
  ipaccess: 'ip_access_rule',
  security: 'http_security_level_rule',
};

const currentWaf = computed(() => {
  const item = wafNavItems.value.find((x) => x.key === wafSub.value) || wafNavItems.value[0];
  return { ...item, phase: wafPhaseMap[item.key] };
});

const countCards = computed(() => [
  { key: 'custom', label: t('esaZone.wafCustom'), value: counts.custom, desc: t('esaZone.wafCustomDesc') },
  { key: 'ratelimit', label: t('esaZone.wafRateLimit'), value: counts.ratelimit, desc: t('esaZone.wafRateLimitDesc') },
  { key: 'managed', label: t('esaZone.wafManaged'), value: counts.managed, desc: t('esaZone.wafManagedDesc') },
  { key: 'whitelist', label: t('esaZone.wafWhitelist'), value: counts.whitelist, desc: t('esaZone.wafWhitelistDesc') },
  { key: 'ipaccess', label: t('esaZone.wafIpAccess'), value: counts.ipaccess, desc: t('esaZone.wafIpAccessDesc') },
  { key: 'ddos', label: 'DDoS', value: counts.ddos, desc: t('esaZone.secDdosDesc') },
]);

async function call(action: string, params: Record<string, any> = {}) {
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action,
      zoneId: props.zoneId,
      params,
    });
    return res.code === 0 ? res.data : null;
  } catch {
    return null;
  }
}

async function countPhase(phase: string): Promise<number | null> {
  const data = await call('ListWafRules', { Phase: phase, PageSize: 1 });
  if (!data) return null;
  return Number(data?.TotalCount ?? (data?.Rules || []).length ?? 0);
}

async function loadCounts() {
  busy.value = true;
  loadError.value = '';
  try {
    const [custom, ratelimit, managed, whitelist, ipaccess, ddos] = await Promise.all([
      countPhase('http_custom'),
      countPhase('http_ratelimit'),
      countPhase('http_managed'),
      countPhase('http_whitelist'),
      countPhase('ip_access_rule'),
      call('ListDDoSInstances', { PageSize: 1 }),
    ]);
    counts.custom = custom ?? 0;
    counts.ratelimit = ratelimit ?? 0;
    counts.managed = managed ?? 0;
    counts.whitelist = whitelist ?? 0;
    counts.ipaccess = ipaccess ?? 0;
    counts.ddos = Number(ddos?.TotalCount ?? (ddos?.Instances || []).length ?? 0);
    if ([custom, ratelimit, managed, whitelist, ipaccess].every((v) => v === null) && ddos === null) {
      loadError.value = t('esaZone.loadFailed');
    }
  } finally {
    busy.value = false;
  }
}

function openCount(key: string) {
  if (key === 'ddos') {
    sub.value = 'ddos';
    return;
  }
  sub.value = 'waf';
  wafSub.value = key;
}

onMounted(loadCounts);
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
.esa-sec__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}
.esa-sec__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px 12px 16px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.18s var(--app-ease), transform 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.esa-sec__card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 11px;
  bottom: 11px;
  width: 3px;
  border-radius: 3px;
  background: var(--app-primary);
  opacity: 0;
  transition: opacity 0.18s var(--app-ease);
}
.esa-sec__card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.esa-sec__card:hover::before {
  opacity: 1;
}
.esa-sec__card-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-sec__card-value {
  font-family: var(--app-font-mono);
  font-size: 20px;
  color: var(--app-primary);
}
.esa-sec__card-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--app-text-3);
}
</style>
