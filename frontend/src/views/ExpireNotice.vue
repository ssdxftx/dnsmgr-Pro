<template>
  <div class="app-stack">
    <PageHeader :title="t('expire.title')" :subtitle="t('expire.subtitle')" back="/domains" />
    <n-card :bordered="false" style="max-width: 640px">
      <n-form :label-placement="labelPlacement" :label-width="labelWidth">
        <n-form-item :label="t('expire.noticeDays')">
          <n-input v-model:value="form.expire_noticedays" :placeholder="t('expire.noticeDaysPlaceholder')" />
          <template #feedback>
            <div class="hint">{{ t('expire.noticeDaysHint') }}</div>
          </template>
        </n-form-item>
        <n-form-item :label="t('expire.mailNotice')">
          <n-select v-model:value="form.expire_notice_mail" :options="onOffOptions" />
        </n-form-item>
        <n-form-item :label="t('expire.wxNotice')">
          <n-select v-model:value="form.expire_notice_wxtpl" :options="onOffOptions" />
        </n-form-item>
        <n-form-item :label="t('expire.tgNotice')">
          <n-select v-model:value="form.expire_notice_tgbot" :options="onOffOptions" />
        </n-form-item>
        <n-form-item :label="t('expire.qqNotice')">
          <n-select v-model:value="form.expire_notice_qqbot" :options="onOffOptions" />
        </n-form-item>
        <n-form-item :label="t('expire.groupWebhook')">
          <n-select v-model:value="form.expire_notice_webhook" :options="onOffOptions" />
        </n-form-item>
        <n-form-item :label="t('expire.customWebhook')">
          <n-select v-model:value="form.expire_notice_custom_webhook" :options="onOffOptions" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="goBack">{{ t('common.back') }}</n-button>
          <n-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { useBack } from '../lib/back';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const goBack = useBack('/domains');
const { t } = useI18n();
import { useMessage } from 'naive-ui';
import { ArrowBackOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';

const message = useMessage();
const saving = ref(false);

const isMobile = ref(false);
const labelPlacement = computed(() => (isMobile.value ? 'top' : 'left'));
const labelWidth = computed<number | undefined>(() => (isMobile.value ? undefined : 150));

function checkMobile() {
  isMobile.value = window.innerWidth < 768;
}
onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
});
onBeforeUnmount(() => window.removeEventListener('resize', checkMobile));
const form = reactive<any>({
  expire_noticedays: '',
  expire_notice_mail: '0',
  expire_notice_wxtpl: '0',
  expire_notice_tgbot: '0',
  expire_notice_qqbot: '0',
  expire_notice_webhook: '0',
  expire_notice_custom_webhook: '0',
});

const onOffOptions = computed(() => [
  { label: t('expire.off'), value: '0' },
  { label: t('expire.on'), value: '1' },
]);

async function load() {
  const res = await api<any>('GET', '/expire/settings');
  if (res.code === 0) Object.assign(form, res.data);
  else message.error(res.msg);
}

async function save() {
  saving.value = true;
  const res = await api('POST', '/expire/settings', { ...form });
  saving.value = false;
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}

onMounted(load);
</script>

<style scoped>
.hint { color: var(--app-success); font-size: 12px; margin-top: 4px; line-height: 1.6; }

@media (max-width: 768px) {
  :deep(.n-card__footer .n-space) {
    width: 100%;
    justify-content: space-between;
  }
  :deep(.n-card__footer .n-space .n-button) {
    flex: 1;
  }
}
</style>