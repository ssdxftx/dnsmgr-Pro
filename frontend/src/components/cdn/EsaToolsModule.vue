<template>
  <div>
    <template v-if="sub === 'ip'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaAccount.ipGeo') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.ipGeoDesc') }}</p>
        <n-form label-placement="left" label-width="120" size="small">
          <n-form-item :label="t('esaAccount.ipGeoInput')">
            <n-input v-model:value="vipInfo" type="textarea" :rows="4" placeholder="1.1.1.1,8.8.8.8" />
          </n-form-item>
          <n-form-item :show-label="false">
            <n-button size="small" type="primary" :loading="busy" :disabled="busy" @click="query">{{ t('esaAccount.ipGeoRun') }}</n-button>
          </n-form-item>
        </n-form>
        <n-alert v-if="error" type="error" :show-icon="false" class="mb-3">{{ error }}</n-alert>
        <pre v-if="resultText" class="code-view">{{ resultText }}</pre>
      </div>
    </template>

    <template v-else>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaAccount.actionTrail') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.actionTrailDesc') }}</p>
        <n-button tag="a" href="https://actiontrail.console.alibabacloud.com/" target="_blank" rel="noopener" type="primary" size="small">
          {{ t('esaAccount.actionTrailOpen') }}
        </n-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NForm, NFormItem, NInput, useMessage } from 'naive-ui';
import { api } from '../../api';

const props = defineProps<{ aid: number }>();
const { t } = useI18n();
const message = useMessage();

const sub = defineModel<string>('sub', { default: 'ip' });

const vipInfo = ref('');
const busy = ref(false);
const error = ref('');
const resultText = ref('');

async function query() {
  if (!vipInfo.value.trim()) return message.warning(t('esaAccount.ipGeoInput'));
  busy.value = true;
  error.value = '';
  resultText.value = '';
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action: 'ListESAIPInfo',
      params: { VipInfo: vipInfo.value.trim() },
    });
    if (res.code !== 0) throw new Error(res.msg || t('esaAccount.loadFailed'));
    resultText.value = JSON.stringify(res.data, null, 2);
  } catch (e: any) {
    error.value = e?.message || t('esaAccount.loadFailed');
  } finally {
    busy.value = false;
  }
}
</script>
