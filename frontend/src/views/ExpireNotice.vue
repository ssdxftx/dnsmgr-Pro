<template>
  <div class="app-stack">
    <PageHeader title="域名到期提醒设置" subtitle="配置域名到期的邮件与机器人提醒" back="/domains" />
    <n-card :bordered="false" style="max-width: 640px">
      <n-form :label-placement="labelPlacement" :label-width="labelWidth">
        <n-form-item label="到期提醒天数">
          <n-input v-model:value="form.expire_noticedays" placeholder="留空则不开启到期提醒" />
          <template #feedback>
            <div class="hint">域名到期前多少天发送通知，可填写多个天数，用英文逗号隔开。例如填写 7,14 则在到期前 7 天与 14 天分别发送通知。</div>
          </template>
        </n-form-item>
        <n-form-item label="邮件通知">
          <n-select v-model:value="form.expire_notice_mail" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="微信公众号通知">
          <n-select v-model:value="form.expire_notice_wxtpl" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="Telegram 机器人通知">
          <n-select v-model:value="form.expire_notice_tgbot" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="群机器人 Webhook">
          <n-select v-model:value="form.expire_notice_webhook" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="自定义 Webhook">
          <n-select v-model:value="form.expire_notice_custom_webhook" :options="onOffOptions" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="goBack">返回</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </template>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { useBack } from '../lib/back';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

const goBack = useBack('/domains');
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
  expire_notice_webhook: '0',
  expire_notice_custom_webhook: '0',
});

const onOffOptions = [
  { label: '关闭', value: '0' },
  { label: '开启', value: '1' },
];

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
.hint { color: #18a058; font-size: 12px; margin-top: 4px; line-height: 1.6; }

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