<template>
  <n-config-provider
    :theme="isDark ? darkTheme : null"
    :theme-overrides="isDark ? darkThemeOverrides : lightThemeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
    <n-global-style />
    <n-message-provider>
      <n-dialog-provider>
        <router-view />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { darkTheme, dateEnUS, dateZhCN, enUS, zhCN } from 'naive-ui';
import { useThemeMode } from './composables/useThemeMode';
import { useLocale } from './composables/useLocale';
import { darkThemeOverrides, lightThemeOverrides } from './styles/theme';

const { isDark } = useThemeMode();
const { locale } = useLocale();

const isZh = computed(() => locale.value === 'zh-CN');
const naiveLocale = computed(() => (isZh.value ? zhCN : enUS));
const naiveDateLocale = computed(() => (isZh.value ? dateZhCN : dateEnUS));
</script>
