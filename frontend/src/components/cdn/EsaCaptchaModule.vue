<template>
  <div>
    <template v-if="sub === 'config'">
      <n-alert type="info" :show-icon="false" class="mb-3">{{ t('esaAccount.captchaNote') }}</n-alert>
      <EsaActionTable
        :aid="aid"
        zone-id=""
        :title="t('esaAccount.captchaConfig')"
        :desc="t('esaAccount.captchaConfigDesc')"
        list-action="ListSliderCaptchaPages"
        items-path="Pages"
        id-key="Id"
        name-key="Name"
        :columns="columns"
        :create-action="'CreateSliderCaptchaPage'"
        :create-label="t('esaZone.create')"
        :create-fields="createFields"
        :update-action="'UpdateSliderCaptchaPage'"
        :update-fields="createFields"
        :delete-action="'DeleteSliderCaptchaPage'"
        :paginate="false"
      />
    </template>

    <template v-else>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaAccount.captchaAnalytics') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.captchaAnalyticsDesc') }}</p>
        <n-grid cols="1 s:3" responsive="screen" :x-gap="12" :y-gap="12">
          <n-grid-item v-for="item in analyticsCards" :key="item.key">
            <div class="esa-captcha-stat">
              <span class="esa-captcha-stat__label">{{ item.label }}</span>
              <span class="esa-captcha-stat__value tnum">{{ item.value }}</span>
            </div>
          </n-grid-item>
        </n-grid>
        <n-alert type="info" :show-icon="false" class="mt-3">{{ t('esaAccount.captchaAnalyticsEmpty') }}</n-alert>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NGrid, NGridItem } from 'naive-ui';
import EsaActionTable from './EsaActionTable.vue';
import type { EsaFieldDef } from './EsaActionPanel.vue';
import type { EsaTableColumn } from './EsaActionTable.vue';

defineProps<{ aid: number }>();
const { t } = useI18n();

const sub = defineModel<string>('sub', { default: 'config' });

const columns = computed<EsaTableColumn[]>(() => [
  { key: 'Id', label: 'ID', width: 70 },
  { key: 'Name', label: t('esaAccount.captchaName'), minWidth: 160 },
  { key: 'ForceLanguage', label: t('esaAccount.captchaLanguage'), width: 120 },
  { key: 'SiteIds', label: t('esaAccount.captchaSites'), minWidth: 180, format: 'csv' },
]);

const createFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaAccount.captchaName'), required: true },
  {
    name: 'ForceLanguage',
    label: t('esaAccount.captchaLanguage'),
    type: 'select',
    options: [
      { label: t('esaAccount.captchaLangAuto'), value: 'auto' },
      { label: t('esaAccount.captchaLangZh'), value: 'zhcn' },
      { label: t('esaAccount.captchaLangEn'), value: 'enus' },
    ],
  },
  { name: 'SiteIds', label: t('esaAccount.captchaSites'), type: 'json', help: 'JSON array, e.g. ["1000000001"]' },
  { name: 'CustomContent', label: t('esaAccount.captchaContent'), type: 'textarea' },
  { name: 'Configs', label: t('esaAccount.captchaConfigs'), type: 'json', help: 'JSON object' },
]);

const analyticsCards = computed(() => [
  { key: 'verify', label: t('esaAccount.captchaVerify'), value: '—' },
  { key: 'pass', label: t('esaAccount.captchaPass'), value: '—' },
  { key: 'block', label: t('esaAccount.captchaBlock'), value: '—' },
]);
</script>

<style scoped>
.esa-captcha-stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  background: var(--app-surface);
}

.esa-captcha-stat__label {
  font-size: 12px;
  color: var(--app-text-3);
}

.esa-captcha-stat__value {
  font-size: 22px;
  font-weight: 700;
  color: var(--app-text-1);
}
</style>
