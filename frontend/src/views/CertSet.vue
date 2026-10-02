<template>
  <div class="app-stack">
    <PageHeader :title="t('certSet.title')" :subtitle="t('certSet.subtitle')" back="/cert-orders" />
    <n-card :bordered="false" style="max-width: 640px">
      <n-form :label-placement="labelPlacement" :label-width="labelWidth">
        <n-divider title-placement="left" class="section">{{ t('certSet.sectionRenew') }}</n-divider>
        <n-form-item :label="t('certSet.renewDays')">
          <n-input-number v-model:value="form.cert_renewdays" :min="1" :max="90" style="width: 100%" />
          <template #feedback>
            <div class="hint">{{ t('certSet.renewDaysHint') }}</div>
          </template>
        </n-form-item>

        <n-divider title-placement="left" class="section">{{ t('certSet.sectionHours') }}</n-divider>
        <n-form-item :label="t('certSet.hours')">
          <div class="range-row">
            <n-select v-model:value="form.deploy_hour_start" :options="hourOptions" style="flex: 1" />
            <span class="range-sep">{{ t('certSet.hourSep') }}</span>
            <n-select v-model:value="form.deploy_hour_end" :options="hourOptions" style="flex: 1" />
          </div>
          <template #feedback>
            <div class="hint">{{ t('certSet.hoursHint') }}</div>
          </template>
        </n-form-item>

        <n-divider title-placement="left" class="section">{{ t('certSet.sectionCdn') }}</n-divider>
        <n-form-item :label="t('certSet.certApplyAccount')">
          <n-select
            v-model:value="form.cdn_cert_aid"
            :options="certAccountOptions"
            clearable
            :placeholder="t('certSet.certAccountPlaceholder')"
          />
          <template #feedback>
            <div class="hint">{{ t('certSet.certAccountHint') }}</div>
          </template>
        </n-form-item>

        <n-divider title-placement="left" class="section">{{ t('certSet.sectionNotice') }}</n-divider>
        <n-form-item :label="t('certSet.mailNotice')">
          <n-select v-model:value="form.cert_notice_mail" :options="noticeOptions" />
        </n-form-item>
        <n-form-item :label="t('certSet.wxNotice')">
          <n-select v-model:value="form.cert_notice_wxtpl" :options="noticeOptions" />
        </n-form-item>
        <n-form-item :label="t('certSet.tgNotice')">
          <n-select v-model:value="form.cert_notice_tgbot" :options="noticeOptions" />
        </n-form-item>
        <n-form-item :label="t('certSet.qqNotice')">
          <n-select v-model:value="form.cert_notice_qqbot" :options="noticeOptions" />
        </n-form-item>
        <n-form-item :label="t('certSet.groupWebhook')">
          <n-select v-model:value="form.cert_notice_webhook" :options="onOffOptions" />
        </n-form-item>
        <n-form-item :label="t('certSet.customWebhook')">
          <n-select v-model:value="form.cert_notice_custom_webhook" :options="noticeOptions" />
          <template #feedback>
            <div class="hint">{{ t('certSet.onFailOnlyHint') }}</div>
          </template>
        </n-form-item>
      </n-form>

      <template #footer>
        <n-space justify="end" class="footer-actions">
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

const goBack = useBack('/cert-orders');
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

// 后端未配置的项返回空字符串，这里统一回落到默认值，避免下拉框显示为空
const DEFAULTS: Record<string, string | number> = {
  cert_renewdays: 7,
  deploy_hour_start: '0',
  deploy_hour_end: '23',
  cdn_cert_aid: '',
  cert_notice_mail: '0',
  cert_notice_wxtpl: '0',
  cert_notice_tgbot: '0',
  cert_notice_qqbot: '0',
  cert_notice_webhook: '0',
  cert_notice_custom_webhook: '0',
};

const form = reactive<any>({ ...DEFAULTS });
const certAccountOptions = ref<any[]>([]);

async function loadCertAccounts() {
  const res = await api<any>('GET', '/cert/accounts?deploy=0&limit=200');
  if (res.code !== 0) return;
  certAccountOptions.value = (res.data || []).map((a: any) => ({ label: `${a.id} - ${a.typename}（${a.name}）`, value: String(a.id) }));
}

const hourOptions = Array.from({ length: 24 }, (_, i) => ({ label: String(i), value: String(i) }));
const onOffOptions = computed(() => [
  { label: t('certSet.off'), value: '0' },
  { label: t('certSet.on'), value: '1' },
]);
const noticeOptions = computed(() => [
  { label: t('certSet.off'), value: '0' },
  { label: t('certSet.on'), value: '1' },
  { label: t('certSet.onFailOnly'), value: '2' },
]);

async function load() {
  const res = await api<any>('GET', '/cert/settings');
  if (res.code !== 0) return message.error(res.msg);
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const v = res.data?.[key];
    if (v === '' || v === null || v === undefined) {
      form[key] = def;
    } else {
      form[key] = key === 'cert_renewdays' ? Number(v) || def : String(v);
    }
  }
}

async function save() {
  saving.value = true;
  const res = await api('POST', '/cert/settings', { ...form });
  saving.value = false;
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}

onMounted(() => {
  load();
  loadCertAccounts();
});
</script>

<style scoped>
.section {
  margin: 24px 0 12px;
}
.section:first-child {
  margin-top: 0;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.range-sep {
  flex: none;
  color: var(--app-text-3);
}
.hint {
  color: var(--app-text-3);
  font-size: 12px;
  line-height: 1.6;
}

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