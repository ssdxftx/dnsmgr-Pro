<template>
  <div class="app-stack">
    <PageHeader :title="t('preferences.title')" :subtitle="t('preferences.subtitle')" />
    <n-card :bordered="false" :title="t('preferences.languageTitle')" size="small" class="narrow">
      <n-radio-group :value="locale" @update:value="onChange">
        <n-space>
          <n-radio-button value="zh-CN">{{ t('common.chinese') }}</n-radio-button>
          <n-radio-button value="en-US">{{ t('common.english') }}</n-radio-button>
        </n-space>
      </n-radio-group>
      <p class="pref-hint">{{ t('preferences.languageHint') }}</p>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { NCard, NRadioButton, NRadioGroup, NSpace, useMessage } from 'naive-ui';
import PageHeader from '../components/PageHeader.vue';
import { useLocale } from '../composables/useLocale';
import type { AppLocale } from '../i18n';

const { t } = useI18n();
const { locale, setLocale } = useLocale();
const message = useMessage();

async function onChange(value: string) {
  await setLocale(value as AppLocale);
  message.success(t('preferences.languageSaved'));
}
</script>

<style scoped>
.pref-hint {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--app-text-3);
}
</style>
