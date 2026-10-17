<template>
  <div class="app-stack">
    <PageHeader :title="t('dm.title')" :subtitle="t('dm.subtitle')" />
    <n-grid cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="d1">
        <TelemetryCard :label="t('dm.runCount')" :value="Number(info.run_count) || 0" tone="primary" :icon="SyncOutline" :caption="t('common.live')" />
      </n-grid-item>
      <n-grid-item v-reveal class="d2">
        <TelemetryCard :label="t('dm.switchCount24')" :value="Number(info.switch_count) || 0" tone="warning" :icon="SwapHorizontalOutline" :caption="t('common.last24h')" />
      </n-grid-item>
      <n-grid-item v-reveal class="d3">
        <TelemetryCard :label="t('dm.failCount24')" :value="Number(info.fail_count) || 0" tone="error" :icon="CloseCircleOutline" :caption="t('common.last24h')" />
      </n-grid-item>
    </n-grid>

    <n-card :bordered="false">
      <template #header>
        <div class="log-head">
          <span>{{ t('dm.runLog') }}</span>
          <n-tag :type="info.run_state === 1 ? 'success' : 'error'" size="small" round :bordered="false">
            {{ info.run_state === 1 ? t('dm.running') : t('dm.stopped') }}
          </n-tag>
        </div>
      </template>
      <n-text depth="3" class="log-meta">{{ t('dm.lastRunTime') }} · {{ info.run_time || t('common.none') }}</n-text>
      <n-alert v-if="info.run_error" type="error" class="mb-3">{{ t('dm.runError') }}{{ info.run_error }}</n-alert>
      <div class="clean-row">
        <n-input-number v-model:value="days" :min="0" class="days-input" />
        <n-button type="warning" class="clean-btn" @click="clean">{{ t('dm.cleanLog') }}</n-button>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px">{{ t('dm.cleanHint') }}</n-text>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessage, useDialog } from 'naive-ui';
import { SyncOutline, SwapHorizontalOutline, CloseCircleOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();
const info = ref<any>({ run_count: 0, run_time: '', run_state: 0, run_error: null, switch_count: 0, fail_count: 0 });
const days = ref(30);

async function load() {
  const res = await api<any>('GET', '/dmonitor/overview');
  if (res.code === 0) info.value = res.data;
}

function clean() {
  dialog.warning({
    title: t('dm.cleanLog'),
    content: t('dm.cleanConfirm', { days: days.value }),
    positiveText: t('dm.cleanLog'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('POST', '/dmonitor/clean', { days: days.value });
      if (res.code === 0) message.success(res.msg);
      else message.error(res.msg);
    },
  });
}

onMounted(load);
</script>

<style scoped>
.log-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.log-meta {
  display: block;
  margin-bottom: 12px;
}
.clean-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.days-input {
  width: 200px;
}

@media (max-width: 768px) {
  .clean-row {
    flex-direction: column;
    align-items: stretch;
  }
  .days-input {
    width: 100%;
  }
}
</style>