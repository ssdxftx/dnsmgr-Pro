<template>
  <div class="esa-analytics">
    <div class="esa-analytics__bar">
      <n-select
        v-model:value="siteKey"
        :options="siteOptions"
        :loading="busy"
        :placeholder="t('statistics.esaSite')"
        :no-data-text="t('statistics.esaNoSite')"
        filterable
        class="esa-analytics__site"
      />
      <n-radio-group v-model:value="sub" size="small">
        <n-radio-button v-for="item in subItems" :key="item.key" :value="item.key">{{ t(item.labelKey) }}</n-radio-button>
      </n-radio-group>
    </div>

    <n-alert v-if="error" type="error" :show-icon="false" class="mb-3">{{ error }}</n-alert>

    <EsaAnalyticsModule
      v-if="selected"
      :key="selected.key"
      v-model:sub="sub"
      :aid="selected.aid"
      :zone-id="selected.zoneId"
    />
    <n-empty v-else-if="!busy" class="esa-analytics__empty" :description="t('statistics.esaNoSite')" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { NAlert, NEmpty, NRadioButton, NRadioGroup, NSelect } from 'naive-ui';
import { api } from '../../api';
import EsaAnalyticsModule from '../cdn/EsaAnalyticsModule.vue';

interface SiteItem {
  key: string;
  aid: number;
  zoneId: string;
  name: string;
}

const props = defineProps<{ aid?: number | null; zoneId?: string }>();
const { t } = useI18n();
const route = useRoute();

const sites = ref<SiteItem[]>([]);
const siteKey = ref<string | null>(null);
const busy = ref(false);
const error = ref('');
const subKeys = ['account', 'security', 'logs', 'trace'];
const initialSub = String(route.query.sub || '');
const sub = ref(subKeys.includes(initialSub) ? initialSub : 'account');
const subItems = [
  { key: 'account', labelKey: 'esaZone.analyticsAccount' },
  { key: 'security', labelKey: 'esaZone.analyticsSecurity' },
  { key: 'logs', labelKey: 'esaZone.realtimeLogs' },
  { key: 'trace', labelKey: 'esaZone.trace' },
];

const siteOptions = computed(() => sites.value.map((site) => ({ label: site.name || site.zoneId, value: site.key })));
const selected = computed(() => sites.value.find((site) => site.key === siteKey.value) || null);

async function load() {
  busy.value = true;
  error.value = '';
  try {
    const res = await api<any>('GET', '/cdn/zones', props.aid ? { aid: props.aid } : undefined);
    if (res.code !== 0) throw new Error(res.msg || t('statistics.queryFailed'));
    const rows = (res.data || []) as any[];
    sites.value = rows
      .filter((zone) => props.aid || String(zone.route || '') === 'aliyun_esa')
      .map((zone) => {
        const zoneId = String(zone.zone_id || zone.zoneId || '');
        return {
          key: `${zone.aid}:${zoneId}`,
          aid: Number(zone.aid),
          zoneId,
          name: String(zone.zone_name || zone.name || ''),
        };
      })
      .filter((site) => site.aid > 0 && site.zoneId);
    const preferred = sites.value.find((site) => site.zoneId === props.zoneId);
    if (!sites.value.some((site) => site.key === siteKey.value)) siteKey.value = preferred?.key || sites.value[0]?.key || null;
  } catch (e: any) {
    error.value = e?.message || t('statistics.queryFailed');
    sites.value = [];
    siteKey.value = null;
  } finally {
    busy.value = false;
  }
}

watch(() => props.aid, load);
onMounted(load);
</script>

<style scoped>
.esa-analytics {
  min-width: 0;
}
.esa-analytics__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.esa-analytics__site {
  width: 260px;
}
.esa-analytics__empty {
  padding: 40px 0;
}
@media (max-width: 767px) {
  .esa-analytics__site {
    width: 100%;
  }
}
</style>