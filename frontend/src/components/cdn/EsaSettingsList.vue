<template>
  <div>
    <div class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">{{ t('esaZone.settingsListTitle') }}</h3>
        <div class="app-panel__extra">
          <n-button size="small" :loading="busy" :disabled="busy" @click="load">{{ t('esaZone.reload') }}</n-button>
        </div>
      </div>
      <p class="hint-text mb-3">{{ t('esaZone.settingsListDesc') }}</p>
      <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>

      <n-spin :show="busy">
        <div v-for="group in groups" :key="group.key" class="esa-summary__group">
          <div class="esa-summary__group-head">
            <span class="esa-summary__group-title">{{ group.title }}</span>
            <span class="hint-text">{{ group.desc }}</span>
          </div>
          <div class="esa-summary__grid">
            <button
              v-for="item in group.items"
              :key="item.key"
              type="button"
              class="esa-summary__card"
              @click="emit('go', item.target, item.sub)"
            >
              <span class="esa-summary__card-head">
                <span class="esa-summary__card-title">{{ item.label }}</span>
                <n-tag size="tiny" :bordered="false" :type="item.state === 'on' ? 'success' : item.state === 'off' ? 'default' : 'info'">
                  {{ item.state === 'on' ? t('esaZone.stateOn') : item.state === 'off' ? t('esaZone.stateOff') : t('esaZone.stateDefault') }}
                </n-tag>
              </span>
              <span class="esa-summary__card-value">{{ item.value }}</span>
              <span class="esa-summary__card-desc">{{ item.desc }}</span>
            </button>
          </div>
        </div>
      </n-spin>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NSpin, NTag } from 'naive-ui';
import { api } from '../../api';

interface SummaryItem {
  key: string;
  label: string;
  desc: string;
  value: string;
  state: 'on' | 'off' | 'default';
  target: string;
  sub?: string;
}
interface SummaryGroup {
  key: string;
  title: string;
  desc: string;
  items: SummaryItem[];
}

const props = defineProps<{ aid: number; zoneId: string }>();
const emit = defineEmits<{ (e: 'go', target: string, sub?: string): void }>();
const { t } = useI18n();

const busy = ref(false);
const loadError = ref('');
const groups = ref<SummaryGroup[]>([]);

async function call(action: string, params: Record<string, any> = {}): Promise<any | null> {
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

async function load() {
  busy.value = true;
  loadError.value = '';
  try {
    const [site, certs, flatten, tiered, reserve, waf, pools, lbs, purge] = await Promise.all([
      call('GetSite'),
      call('ListCertificates', { PageSize: 1 }),
      call('GetCnameFlattening'),
      call('GetTieredCache'),
      call('GetCacheReserve'),
      call('GetSiteWafSettings'),
      call('ListOriginPools', { PageSize: 1 }),
      call('ListLoadBalancers', { PageSize: 1 }),
      call('GetPurgeQuota', { Type: 'file' }),
    ]);
    if ([site, certs, flatten, tiered, reserve, waf, pools, lbs, purge].every((v) => v === null)) {
      loadError.value = t('esaZone.loadFailed');
      groups.value = [];
      return;
    }

    const model = site?.SiteModel || site || {};
    const plan = model.PlanName || model.Plan || model.InstancePlan || '-';
    const certCount = Number(certs?.TotalCount ?? (certs?.Result || []).length ?? 0);
    const poolCount = Number(pools?.TotalCount ?? (pools?.OriginPools || []).length ?? 0);
    const lbCount = Number(lbs?.TotalCount ?? (lbs?.LoadBalancers || []).length ?? 0);
    const wafOn = Boolean(waf?.Settings && (typeof waf.Settings !== 'object' || Object.keys(waf.Settings).length));

    groups.value = [
      {
        key: 'dns',
        title: t('esaZone.grpDns'),
        desc: t('esaZone.grpDnsDesc'),
        items: [
          {
            key: 'flatten',
            label: t('esaZone.dnsFlatten'),
            desc: t('esaZone.dnsFlattenDesc'),
            value: flatten?.FlattenMode || '-',
            state: flatten?.FlattenMode === 'flatten_all' ? 'on' : 'default',
            target: 'dns',
            sub: 'settings',
          },
        ],
      },
      {
        key: 'ssl',
        title: t('esaZone.grpSsl'),
        desc: t('esaZone.grpSslDesc'),
        items: [
          {
            key: 'certs',
            label: t('esaZone.sslCerts'),
            desc: t('esaZone.sslCertsDesc'),
            value: t('esaZone.countItems', { n: certCount }),
            state: certCount ? 'on' : 'off',
            target: 'ssl',
            sub: 'edge',
          },
        ],
      },
      {
        key: 'security',
        title: t('esaZone.grpSecurity'),
        desc: t('esaZone.grpSecurityDesc'),
        items: [
          {
            key: 'waf',
            label: t('esaZone.secWaf'),
            desc: t('esaZone.secWafDesc'),
            value: wafOn ? t('esaZone.configured') : t('esaZone.notConfigured'),
            state: wafOn ? 'on' : 'off',
            target: 'security',
            sub: 'waf',
          },
        ],
      },
      {
        key: 'cache',
        title: t('esaZone.grpCache'),
        desc: t('esaZone.grpCacheDesc'),
        items: [
          {
            key: 'tiered',
            label: t('esaZone.cacheTiered'),
            desc: t('esaZone.cacheTieredDesc'),
            value: tiered?.CacheArchitectureMode || '-',
            state: tiered?.CacheArchitectureMode ? 'on' : 'off',
            target: 'caching',
            sub: 'tiered',
          },
          {
            key: 'reserve',
            label: t('esaZone.cacheReserve'),
            desc: t('esaZone.cacheReserveDesc'),
            value: reserve?.Enable === 'on' ? t('esaZone.enabled') : t('esaZone.disabled'),
            state: reserve?.Enable === 'on' ? 'on' : 'off',
            target: 'caching',
            sub: 'reserve',
          },
          {
            key: 'purge',
            label: t('esaZone.cachePurgeQuota'),
            desc: t('esaZone.cachePurgeQuotaDesc'),
            value: purge ? `${purge.Usage ?? 0} / ${purge.Quota ?? 0}` : '-',
            state: 'default',
            target: 'caching',
            sub: 'purge',
          },
        ],
      },
      {
        key: 'traffic',
        title: t('esaZone.grpTraffic'),
        desc: t('esaZone.grpTrafficDesc'),
        items: [
          {
            key: 'pools',
            label: t('esaZone.originPools'),
            desc: t('esaZone.originPoolsDesc'),
            value: t('esaZone.countItems', { n: poolCount }),
            state: poolCount ? 'on' : 'off',
            target: 'traffic',
            sub: 'pools',
          },
          {
            key: 'lbs',
            label: t('esaZone.loadBalancers'),
            desc: t('esaZone.loadBalancersDesc'),
            value: t('esaZone.countItems', { n: lbCount }),
            state: lbCount ? 'on' : 'off',
            target: 'traffic',
            sub: 'lb',
          },
          {
            key: 'plan',
            label: t('esaZone.plan'),
            desc: t('esaZone.planDesc'),
            value: plan,
            state: 'default',
            target: 'overview',
          },
        ],
      },
    ];
  } finally {
    busy.value = false;
  }
}

onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.esa-summary__group {
  margin-bottom: 16px;
}
.esa-summary__group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.esa-summary__group-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-summary__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.esa-summary__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 13px 11px 16px;
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
.esa-summary__card::before {
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
.esa-summary__card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.esa-summary__card:hover::before {
  opacity: 1;
}
.esa-summary__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.esa-summary__card-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-summary__card-value {
  font-family: var(--app-font-mono);
  font-size: 12px;
  color: var(--app-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.esa-summary__card-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--app-text-3);
}
</style>
