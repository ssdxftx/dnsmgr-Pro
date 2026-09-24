<template>
  <n-config-provider
    :theme="isDark ? darkTheme : null"
    :theme-overrides="isDark ? darkThemeOverrides : lightThemeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
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
import { darkTheme, dateZhCN, zhCN } from 'naive-ui';
import { useThemeMode } from './composables/useThemeMode';
import { darkThemeOverrides, lightThemeOverrides } from './styles/theme';

const { isDark } = useThemeMode();
</script>