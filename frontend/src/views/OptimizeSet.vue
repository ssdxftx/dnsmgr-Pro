<template>
  <div class="app-stack">
    <PageHeader :title="t('optimize.settingsTitle')" :subtitle="t('optimize.settingsSubtitle')" />
    <n-grid cols="1 s:2" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item>
        <n-card :bordered="false" :title="t('optimize.introCard')">
          <p class="desc">{{ t('optimize.introP1') }}</p>
          <p class="desc">{{ t('optimize.introP2') }}</p>
        </n-card>
        <n-card :bordered="false" :title="t('optimize.usageCard')" style="margin-top: 16px">
          <ul class="tips">
            <li>{{ t('optimize.tip1') }}</li>
            <li>{{ t('optimize.tip2') }}</li>
            <li>{{ t('optimize.tip3') }}</li>
            <li>{{ t('optimize.tip4') }}</li>
          </ul>
        </n-card>
      </n-grid-item>

      <n-grid-item>
        <n-card :bordered="false" :title="t('optimize.apiCard')">
          <n-form :label-placement="labelPlacement" label-width="110">
            <n-form-item :label="t('optimize.apiLabel')">
              <n-select v-model:value="form.optimize_ip_api" :options="apiOptions" @update:value="onApiChange" />
            </n-form-item>
            <n-form-item v-if="form.optimize_ip_api !== '2'" :label="t('optimize.apiKey')">
              <n-input v-model:value="form.optimize_ip_key" :placeholder="t('optimize.apiKeyPlaceholder')" />
            </n-form-item>
            <n-form-item v-if="form.optimize_ip_api === '2'" :label="t('optimize.proxyLabel')">
              <n-input v-model:value="form.optimize_ip_proxy" :placeholder="t('optimize.proxyPlaceholder')" />
            </n-form-item>
            <n-form-item :show-feedback="false">
              <n-space class="btn-row">
                <n-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</n-button>
                <n-button v-if="form.optimize_ip_api !== '2'" @click="queryApi">{{ t('optimize.queryScore') }}</n-button>
              </n-space>
            </n-form-item>
          </n-form>
        </n-card>

        <n-card :bordered="false" :title="t('optimize.autoCard')" style="margin-top: 16px">
          <n-form :label-placement="labelPlacement" label-width="110">
            <n-form-item :label="t('optimize.autoInterval')">
              <n-input-number v-model:value="form.optimize_ip_min" :min="10" class="interval-input">
                <template #suffix>{{ t('optimize.minutes') }}</template>
              </n-input-number>
            </n-form-item>
            <n-form-item :show-feedback="false">
              <n-space class="btn-row">
                <n-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</n-button>
              </n-space>
            </n-form-item>
          </n-form>
        </n-card>
      </n-grid-item>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessage } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';

const message = useMessage();
const { t } = useI18n();
const saving = ref(false);

const isMobile = ref(false);
const labelPlacement = computed(() => (isMobile.value ? 'top' : 'left'));

function checkMobile() {
  isMobile.value = window.innerWidth < 768;
}
onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
});
onBeforeUnmount(() => window.removeEventListener('resize', checkMobile));

const apiOptions = [
  { label: 'wetest.vip', value: '0' },
  { label: 'HostMonit', value: '1' },
  { label: 'xingpingcn.top', value: '2' },
];

const form = reactive({
  optimize_ip_api: '0',
  optimize_ip_key: '',
  optimize_ip_proxy: '',
  optimize_ip_min: '30',
});

function onApiChange() {
  // 切换接口时重置默认值
}

async function load() {
  const res = await api<any>('GET', '/optimize/settings');
  if (res.code === 0) {
    form.optimize_ip_api = res.data.optimize_ip_api;
    form.optimize_ip_key = res.data.optimize_ip_key;
    form.optimize_ip_proxy = res.data.optimize_ip_proxy;
    form.optimize_ip_min = res.data.optimize_ip_min;
  }
}

async function save() {
  saving.value = true;
  const res = await api('POST', '/optimize/settings', { ...form });
  saving.value = false;
  if (res.code === 0) message.success(t('optimize.savedMsg'));
  else message.error(res.msg);
}

async function queryApi() {
  message.loading(t('optimize.queryLoading'));
  const res = await api('POST', '/optimize/queryapi', { optimize_ip_api: Number(form.optimize_ip_api), optimize_ip_key: form.optimize_ip_key });
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}

onMounted(load);
</script>

<style scoped>
.desc {
  margin: 0 0 8px;
  line-height: 1.7;
  color: var(--app-text-2);
}
.desc:last-child {
  margin-bottom: 0;
}
.tips {
  margin: 0;
  padding-left: 20px;
  line-height: 1.7;
  color: var(--app-text-2);
}
.tips li {
  margin-bottom: 6px;
}
.tips li:last-child {
  margin-bottom: 0;
}
.interval-input {
  width: 220px;
}

@media (max-width: 768px) {
  .desc,
  .tips {
    font-size: 13px;
  }
  .tips {
    padding-left: 18px;
    word-break: break-all;
  }
  .interval-input {
    width: 100%;
  }
  .btn-row {
    width: 100%;
  }
  .btn-row :deep(.n-button) {
    flex: 1;
  }
}
</style>