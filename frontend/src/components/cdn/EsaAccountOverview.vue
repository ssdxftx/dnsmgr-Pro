<template>
  <div>
    <n-grid class="telemetry-row" cols="2 s:2 m:4" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="sites" :label="t('esaAccount.sites')" tone="primary" :icon="GlobeOutline" :caption="t('esaAccount.overviewDesc')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="routines" :label="t('esaAccount.routines')" tone="info" :icon="CodeSlashOutline" :caption="t('esaAccount.navEdgeDesc')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="lists" :label="t('esaAccount.lists')" tone="success" :icon="ListOutline" :caption="t('esaAccount.navGlobalDesc')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d4"><TelemetryCard :value="sliderPages" :label="t('esaAccount.sliderPages')" tone="warning" :icon="ShieldCheckmarkOutline" :caption="t('esaAccount.navCaptchaDesc')" /></n-grid-item>
    </n-grid>

    <div class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">{{ t('esaAccount.overviewTitle') }}</h3>
        <div class="app-panel__extra">
          <n-button size="small" :loading="busy" :disabled="busy" @click="emit('refresh')">{{ t('esaZone.reload') }}</n-button>
        </div>
      </div>
      <DetailGrid
        :items="[
          { key: 'account', label: t('esaAccount.account'), value: accountName },
          { key: 'plan', label: t('esaAccount.plan'), value: planName },
          { key: 'instance', label: t('esaAccount.instance'), value: instanceId, mono: true },
          { key: 'sites', label: t('esaAccount.sites'), value: sites, numeric: true },
        ]"
      />
    </div>

    <div class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">{{ t('esaAccount.quickLinks') }}</h3>
      </div>
      <div class="esa-account-links">
        <button v-for="link in links" :key="link.key" type="button" class="esa-account-link" @click="emit('go', link.key)">
          <span class="esa-account-link__title">{{ link.label }}</span>
          <span class="esa-account-link__desc">{{ link.desc }}</span>
          <span class="esa-account-link__open">{{ t('esaAccount.open') }} →</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NGrid, NGridItem } from 'naive-ui';
import { CodeSlashOutline, GlobeOutline, ListOutline, ShieldCheckmarkOutline } from '@vicons/ionicons5';
import TelemetryCard from '../TelemetryCard.vue';
import DetailGrid from '../DetailGrid.vue';

defineProps<{
  accountName: string;
  planName: string;
  instanceId: string;
  sites: number;
  routines: number;
  lists: number;
  sliderPages: number;
  busy?: boolean;
}>();

const emit = defineEmits<{ (e: 'go', key: string): void; (e: 'refresh'): void }>();
const { t } = useI18n();

const links = computed(() => [
  { key: 'edge', label: t('esaAccount.navEdge'), desc: t('esaAccount.navEdgeDesc') },
  { key: 'captcha', label: t('esaAccount.navCaptcha'), desc: t('esaAccount.navCaptchaDesc') },
  { key: 'global', label: t('esaAccount.navGlobal'), desc: t('esaAccount.navGlobalDesc') },
  { key: 'billing', label: t('esaAccount.navBilling'), desc: t('esaAccount.navBillingDesc') },
]);
</script>

<style scoped>
.esa-account-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}

.esa-account-link {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px 12px 16px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.18s var(--app-ease), background 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}

.esa-account-link::before {
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

.esa-account-link:hover {
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  background: color-mix(in srgb, var(--app-primary) 6%, var(--app-surface));
  box-shadow: var(--app-shadow-sm);
}

.esa-account-link:hover::before {
  opacity: 1;
}

.esa-account-link__title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--app-text);
}

.esa-account-link__desc {
  font-size: 11px;
  line-height: 1.45;
  color: var(--app-text-3);
}

.esa-account-link__open {
  margin-top: 4px;
  font-size: 11px;
  color: var(--app-primary);
}
</style>
