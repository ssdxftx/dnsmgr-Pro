<template>
  <div class="app-stack">
    <PageHeader title="自动续签设置" subtitle="配置证书自动续签、运行时段与通知" back="/cert-orders" />
    <n-card :bordered="false" style="max-width: 640px">
      <n-form :label-placement="labelPlacement" :label-width="labelWidth">
        <n-divider title-placement="left" class="section">自动续签</n-divider>
        <n-form-item label="到期前续签天数">
          <n-input-number v-model:value="form.cert_renewdays" :min="1" :max="90" style="width: 100%" />
          <template #feedback>
            <div class="hint">证书到期前多少天发送续签提醒（仅对开启自动续签的证书生效）。</div>
          </template>
        </n-form-item>

        <n-divider title-placement="left" class="section">运行时段</n-divider>
        <n-form-item label="运行时段（小时）">
          <div class="range-row">
            <n-select v-model:value="form.deploy_hour_start" :options="hourOptions" style="flex: 1" />
            <span class="range-sep">至</span>
            <n-select v-model:value="form.deploy_hour_end" :options="hourOptions" style="flex: 1" />
          </div>
          <template #feedback>
            <div class="hint">自动续签与自动部署任务仅在该时段内进行，支持跨天（如 22 至 6）；起止相同表示不限时段。</div>
          </template>
        </n-form-item>

        <n-divider title-placement="left" class="section">CDN 证书联动</n-divider>
        <n-form-item label="证书申请账户">
          <n-select
            v-model:value="form.cdn_cert_aid"
            :options="certAccountOptions"
            clearable
            placeholder="选择用于申请通配符证书的账户"
          />
          <template #feedback>
            <div class="hint">阿里云 ESA 加速域名一键申请证书时，使用该账户为站点申请通配符证书（需支持泛域名，建议 Let's Encrypt 等 ACME 账户）。</div>
          </template>
        </n-form-item>

        <n-divider title-placement="left" class="section">通知设置</n-divider>
        <n-form-item label="邮件通知">
          <n-select v-model:value="form.cert_notice_mail" :options="noticeOptions" />
        </n-form-item>
        <n-form-item label="微信公众号通知">
          <n-select v-model:value="form.cert_notice_wxtpl" :options="noticeOptions" />
        </n-form-item>
        <n-form-item label="Telegram 通知">
          <n-select v-model:value="form.cert_notice_tgbot" :options="noticeOptions" />
        </n-form-item>
        <n-form-item label="群机器人 Webhook">
          <n-select v-model:value="form.cert_notice_webhook" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="自定义 Webhook">
          <n-select v-model:value="form.cert_notice_custom_webhook" :options="noticeOptions" />
          <template #feedback>
            <div class="hint">「仅失败时」表示仅在续签或部署失败时发送通知。</div>
          </template>
        </n-form-item>
      </n-form>

      <template #footer>
        <n-space justify="end" class="footer-actions">
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

const goBack = useBack('/cert-orders');
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
const onOffOptions = [
  { label: '关闭', value: '0' },
  { label: '开启', value: '1' },
];
const noticeOptions = [
  { label: '关闭', value: '0' },
  { label: '开启', value: '1' },
  { label: '开启（仅失败时）', value: '2' },
];

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