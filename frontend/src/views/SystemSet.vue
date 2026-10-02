<template>
  <div class="app-stack">
    <PageHeader :title="t('systemSet.title')" :subtitle="t('systemSet.subtitle')" />
    <n-card :bordered="false">
      <n-tabs type="line" animated>
        <!-- 通知设置 -->
        <n-tab-pane name="notice" :tab="t('systemSet.tabNotice')">
          <n-card :title="t('systemSet.mailCardTitle')" :bordered="false" size="small" class="mb-16">
            <n-form label-placement="left" label-width="110">
              <n-form-item :label="t('systemSet.mailMode')">
                <n-select v-model:value="cfg.mail_type" :options="mailTypeOptions" style="width: 260px" />
              </n-form-item>
              <template v-if="(cfg.mail_type || '0') === '0'">
                <n-form-item :label="t('systemSet.mailSmtpServer')"><n-input v-model:value="cfg.mail_smtp" /></n-form-item>
                <n-form-item :label="t('systemSet.mailSmtpPort')"><n-input v-model:value="cfg.mail_port" /></n-form-item>
                <n-form-item :label="t('systemSet.mailAccount')"><n-input v-model:value="cfg.mail_name" /></n-form-item>
                <n-form-item :label="t('systemSet.mailPassword')"><n-input v-model:value="cfg.mail_pwd" type="password" show-password-on="click" /></n-form-item>
              </template>
              <template v-else>
                <n-form-item label="API_USER"><n-input v-model:value="cfg.mail_apiuser" /></n-form-item>
                <n-form-item label="API_KEY"><n-input v-model:value="cfg.mail_apikey" /></n-form-item>
                <n-form-item :label="t('systemSet.mailSender')"><n-input v-model:value="cfg.mail_name" /></n-form-item>
              </template>
              <n-form-item :label="t('systemSet.mailRecv')">
                <n-input v-model:value="cfg.mail_recv" :placeholder="t('systemSet.mailRecvPlaceholder')" />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveMail">{{ t('common.save') }}</n-button>
                  <n-button @click="testMail">{{ t('systemSet.testMail') }}</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card :title="t('systemSet.wxCardTitle')" :bordered="false" size="small" class="mb-16">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="appToken"><n-input v-model:value="cfg.wechat_apptoken" /></n-form-item>
              <n-form-item :label="t('systemSet.wxUserUid')"><n-input v-model:value="cfg.wechat_appuid" /></n-form-item>
              <n-form-item>
                <n-button type="primary" :loading="saving" @click="saveFields(['wechat_apptoken', 'wechat_appuid'])">{{ t('common.save') }}</n-button>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card :title="t('systemSet.tgCardTitle')" :bordered="false" size="small" class="mb-16">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="Token"><n-input v-model:value="cfg.tgbot_token" /></n-form-item>
              <n-form-item label="Chat Id"><n-input v-model:value="cfg.tgbot_chatid" /></n-form-item>
              <n-form-item label="Topic Id"><n-input v-model:value="cfg.tgbot_topicid" :placeholder="t('systemSet.tgTopicOptional')" /></n-form-item>
              <n-form-item :label="t('systemSet.tgUseProxy')">
                <n-select v-model:value="cfg.tgbot_proxy" :options="tgbotProxyOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item v-if="(cfg.tgbot_proxy || '0') === '2'" :label="t('systemSet.tgProxyUrl')">
                <n-input v-model:value="cfg.tgbot_url" :placeholder="t('systemSet.tgProxyUrlPlaceholder')" />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveFields(['tgbot_token', 'tgbot_chatid', 'tgbot_topicid', 'tgbot_proxy', 'tgbot_url'])">{{ t('common.save') }}</n-button>
                  <n-button @click="testTgbot">{{ t('systemSet.testMessage') }}</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card :title="t('systemSet.qqCardTitle')" :bordered="false" size="small" class="mb-16">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="AppID">
                <n-input v-model:value="cfg.qqbot_appid" :placeholder="t('systemSet.qqAppIdPlaceholder')" />
              </n-form-item>
              <n-form-item label="AppSecret">
                <n-input v-model:value="cfg.qqbot_appsecret" type="password" show-password-on="click" :placeholder="t('systemSet.qqAppSecretPlaceholder')" />
              </n-form-item>
              <n-form-item :label="t('systemSet.qqWebhookUrl')">
                <n-input :value="qqbotWebhook" readonly>
                  <template #suffix>
                    <n-button text size="small" @click="copyQqbotWebhook">{{ t('common.copy') }}</n-button>
                  </template>
                </n-input>
              </n-form-item>
              <n-form-item :label="t('systemSet.qqBindStatus')">
                <n-tag :type="cfg.qqbot_openid ? 'success' : 'error'" :bordered="false">
                  {{ cfg.qqbot_openid ? t('systemSet.qqBound') : t('systemSet.qqNotBound') }}
                </n-tag>
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveFields(['qqbot_appid', 'qqbot_appsecret'])">{{ t('common.save') }}</n-button>
                  <n-button @click="testQqbot">{{ t('systemSet.testMessage') }}</n-button>
                  <n-button @click="showQqbotHelp = true">{{ t('systemSet.qqHelp') }}</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card :title="t('systemSet.groupCardTitle')" :bordered="false" size="small" class="mb-16">
            <n-form label-placement="left" label-width="110">
              <n-form-item :label="t('systemSet.webhookUrl')"><n-input v-model:value="cfg.webhook_url" /></n-form-item>
              <n-form-item :label="t('systemSet.webhookUser')"><n-input v-model:value="cfg.webhook_user" :placeholder="t('systemSet.webhookUserPlaceholder')" /></n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveFields(['webhook_url', 'webhook_user'])">{{ t('common.save') }}</n-button>
                  <n-button @click="testWebhook">{{ t('systemSet.testMessage') }}</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card :title="t('systemSet.customTitle')" :bordered="false" size="small">
            <n-form label-placement="left" label-width="110">
              <n-form-item :label="t('systemSet.webhookUrl')">
                <n-input v-model:value="cfg.custom_webhook_url" placeholder="https://example.com/webhook" />
              </n-form-item>
              <n-form-item :label="t('systemSet.customMethod')">
                <n-select v-model:value="cfg.custom_webhook_method" :options="methodOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item label="Content-Type">
                <n-select v-model:value="cfg.custom_webhook_content_type" :options="contentTypeOptions" style="width: 220px" />
              </n-form-item>
              <n-form-item :label="t('systemSet.customHeaders')">
                <n-input v-model:value="cfg.custom_webhook_headers" type="textarea" :rows="3" :placeholder="t('systemSet.customHeadersPlaceholder')" />
              </n-form-item>
              <n-form-item :label="t('systemSet.customBody')">
                <n-input v-model:value="cfg.custom_webhook_body" type="textarea" :rows="4" placeholder='{"title":"{title}","content":"{content}"}' />
              </n-form-item>
              <n-form-item :label="t('systemSet.contentFormat')">
                <n-select v-model:value="cfg.custom_webhook_content_format" :options="contentFormatOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveFields(customWebhookFields)">{{ t('common.save') }}</n-button>
                  <n-button @click="testCustomWebhook">{{ t('systemSet.testMessage') }}</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>
        </n-tab-pane>

        <!-- 登录设置 -->
        <n-tab-pane name="login" :tab="t('systemSet.tabLogin')">
          <n-card :title="t('systemSet.loginCardTitle')" :bordered="false" size="small" class="narrow">
            <n-form label-placement="left" label-width="110">
              <n-form-item :label="t('systemSet.loginVcode')">
                <n-switch :value="cfg.vcode !== '2'" @update:value="setVcode" />
              </n-form-item>
            </n-form>
          </n-card>
        </n-tab-pane>

        <!-- 注册设置 -->
        <n-tab-pane name="register" :tab="t('systemSet.tabRegister')">
          <n-card :title="t('systemSet.regConfigTitle')" :bordered="false" size="small" class="narrow mb-16">
            <n-form label-placement="left" label-width="110">
              <n-form-item :label="t('systemSet.regEnable')">
                <n-switch :value="(cfg.register_enable || '0') === '1'" @update:value="setRegisterEnable" />
              </n-form-item>
              <n-form-item :label="t('systemSet.regMode')">
                <n-select v-model:value="cfg.register_mode" :options="registerModeOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item>
                <n-button type="primary" :loading="saving" @click="saveRegister">{{ t('common.save') }}</n-button>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card :title="t('systemSet.regCodeManage')" :bordered="false" size="small">
            <template #header-extra>
              <n-button type="primary" size="small" @click="showGen = true">{{ t('systemSet.genCode') }}</n-button>
            </template>
            <ResponsiveDataTable
              :columns="regCodeColumns"
              :data="regCodes"
              :loading="regCodesLoading"
              :row-key="(row: any) => row.id"
            />
          </n-card>
        </n-tab-pane>

        <!-- 代理设置 -->
        <n-tab-pane name="proxy" :tab="t('systemSet.tabProxy')">
          <n-card :title="t('systemSet.proxyCardTitle')" :bordered="false" size="small" class="narrow">
            <n-form label-placement="left" label-width="110">
              <n-form-item :label="t('systemSet.proxyIp')"><n-input v-model:value="cfg.proxy_server" /></n-form-item>
              <n-form-item :label="t('systemSet.proxyPort')"><n-input v-model:value="cfg.proxy_port" /></n-form-item>
              <n-form-item :label="t('systemSet.proxyUser')"><n-input v-model:value="cfg.proxy_user" :placeholder="t('systemSet.proxyBlank')" /></n-form-item>
              <n-form-item :label="t('systemSet.proxyPassword')"><n-input v-model:value="cfg.proxy_pwd" type="password" show-password-on="click" :placeholder="t('systemSet.proxyBlank')" /></n-form-item>
              <n-form-item :label="t('systemSet.proxyProtocol')">
                <n-select v-model:value="cfg.proxy_type" :options="proxyTypeOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveFields(['proxy_server', 'proxy_port', 'proxy_user', 'proxy_pwd', 'proxy_type'])">{{ t('common.save') }}</n-button>
                  <n-button @click="testProxy">{{ t('systemSet.testConnectivity') }}</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>
        </n-tab-pane>

        <!-- 计划任务 -->
        <n-tab-pane name="cron" :tab="t('systemSet.tabCron')">
          <n-card :title="t('systemSet.cronCardTitle')" :bordered="false" size="small" class="narrow">
            <n-alert type="info" class="mb-16">
              {{ t('systemSet.cronAlert') }}
            </n-alert>
            <n-form label-placement="left" label-width="110">
              <n-form-item :label="t('systemSet.cronExternal')">
                <n-switch :value="(cfg.cron_type || '0') === '1'" @update:value="setCronType" />
              </n-form-item>
              <n-form-item :label="t('systemSet.cronAccessKey')">
                <n-input :value="cronKey" readonly />
              </n-form-item>
              <n-form-item :label="t('systemSet.cronTriggerUrl')">
                <n-input :value="cronUrl" readonly />
              </n-form-item>
            </n-form>
          </n-card>
        </n-tab-pane>

        <!-- 统计缓存 -->
        <n-tab-pane name="statcache" :tab="t('systemSet.tabStatCache')">
          <n-card :title="t('systemSet.statCacheCardTitle')" :bordered="false" size="small" class="narrow-wide">
            <n-alert type="info" :show-icon="false" class="mb-16">
              {{ t('systemSet.statCacheAlert') }}
            </n-alert>
            <n-form label-placement="left" label-width="110">
              <n-form-item :label="t('systemSet.statCacheEnable')">
                <n-switch :value="(cfg.cdn_stats_cache || '0') === '1'" @update:value="setStatCache" />
              </n-form-item>
              <n-form-item :label="t('systemSet.statCacheInterval')">
                <n-input-number v-model:value="statCacheInterval" :min="5" :max="1440" style="width: 180px" />
              </n-form-item>
              <n-form-item :label="t('systemSet.statCacheLast')">
                <n-input :value="cfg.cdn_stats_cache_last || '-'" readonly />
              </n-form-item>
              <n-form-item v-if="cfg.cdn_stats_cache_error" :label="t('systemSet.statCacheError')">
                <n-input type="textarea" :rows="2" :value="cfg.cdn_stats_cache_error" readonly />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveStatCache">{{ t('common.save') }}</n-button>
                  <n-button :loading="refreshingCache" @click="refreshStatCache">{{ t('systemSet.refreshNow') }}</n-button>
                  <n-button :loading="clearingCache" @click="clearStatCache">{{ t('systemSet.clearCache') }}</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>
        </n-tab-pane>
      </n-tabs>
    </n-card>

    <!-- 生成注册码弹窗 -->
    <n-modal v-model:show="showGen" preset="card" :title="t('systemSet.genTitle')" class="narrow-sm" :mask-closable="false">
      <n-form label-placement="top">
        <n-form-item :label="t('systemSet.genCount')">
          <n-input-number v-model:value="genForm.count" :min="1" :max="100" style="width: 100%" />
        </n-form-item>
        <n-form-item :label="t('systemSet.genDays')">
          <n-input-number v-model:value="genForm.days" :min="0" style="width: 100%" :placeholder="t('systemSet.genDaysPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('systemSet.genMaxUse')">
          <n-input-number v-model:value="genForm.maxUse" :min="0" style="width: 100%" :placeholder="t('systemSet.genMaxUsePlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('common.remark')">
          <n-input v-model:value="genForm.remark" :placeholder="t('systemSet.genRemarkPlaceholder')" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showGen = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="genning" @click="doGen">{{ t('systemSet.genBtn') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 生成结果弹窗 -->
    <n-modal v-model:show="showResult" preset="card" :title="t('systemSet.resultTitle')" class="narrow">
      <n-alert type="success" class="mb-12">{{ t('systemSet.resultAlert') }}</n-alert>
      <n-input v-model:value="resultText" type="textarea" :rows="8" readonly />
      <template #footer>
        <n-space justify="end">
          <n-button @click="copyResult">{{ t('systemSet.copyAll') }}</n-button>
          <n-button type="primary" @click="showResult = false">{{ t('common.close') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- QQ机器人使用说明 -->
    <n-modal v-model:show="showQqbotHelp" preset="card" :title="t('systemSet.qqHelpTitle')" class="narrow-wide">
      <div class="help-body">
        <p><b>{{ t('systemSet.helpStep1') }}</b></p>
        <p>{{ t('systemSet.helpStep1p1') }}</p>
        <p>{{ t('systemSet.helpStep1p2') }}</p>
        <p>{{ t('systemSet.helpStep1p3') }}</p>
        <p>{{ t('systemSet.helpStep1p4') }}</p>
        <p><b>{{ t('systemSet.helpStep2') }}</b></p>
        <p>{{ t('systemSet.helpStep2p1') }}</p>
        <p>{{ t('systemSet.helpStep2p2') }}</p>
        <p>{{ t('systemSet.helpStep2p3') }}</p>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessage, useDialog, NButton, NSpace, NTag } from 'naive-ui';
import { api } from '../api';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import PageHeader from '../components/PageHeader.vue';

const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();
const saving = ref(false);
const cfg = reactive<Record<string, string>>({});
const cronKey = ref('');

const showGen = ref(false);
const genning = ref(false);
const showResult = ref(false);
const resultText = ref('');
const genForm = reactive({ count: 1, days: 0, maxUse: 0, remark: '' });
const regCodes = ref<any[]>([]);
const regCodesLoading = ref(false);

const registerModeOptions = computed(() => [
  { label: t('systemSet.regModeEmail'), value: 'email' },
  { label: t('systemSet.regModeCode'), value: 'code' },
]);

const mailTypeOptions = computed(() => [
  { label: t('systemSet.mailTypeSmtp'), value: '0' },
  { label: t('systemSet.mailTypeSendcloud'), value: '1' },
  { label: t('systemSet.mailTypeAliyun'), value: '2' },
]);
const tgbotProxyOptions = computed(() => [
  { label: t('common.no'), value: '0' },
  { label: t('common.yes'), value: '1' },
  { label: t('systemSet.tgReverseProxy'), value: '2' },
]);
const methodOptions = [
  { label: 'POST', value: 'POST' },
  { label: 'GET', value: 'GET' },
  { label: 'PUT', value: 'PUT' },
];
const contentTypeOptions = [
  { label: 'application/json', value: 'application/json' },
  { label: 'application/x-www-form-urlencoded', value: 'application/x-www-form-urlencoded' },
];
const contentFormatOptions = computed(() => [
  { label: 'HTML', value: 'html' },
  { label: 'Markdown', value: 'markdown' },
  { label: t('systemSet.formatText'), value: 'text' },
]);
const proxyTypeOptions = [
  { label: 'HTTP', value: 'http' },
  { label: 'HTTPS', value: 'https' },
  { label: 'SOCK4', value: 'sock4' },
  { label: 'SOCK5', value: 'sock5' },
  { label: 'SOCK5H', value: 'sock5h' },
];

const customWebhookFields = ['custom_webhook_url', 'custom_webhook_method', 'custom_webhook_content_type', 'custom_webhook_headers', 'custom_webhook_body', 'custom_webhook_content_format'];

const cronUrl = computed(() => {
  if (!cronKey.value) return '';
  return `${location.origin}/api/system/cron?key=${cronKey.value}`;
});

async function loadSettings() {
  const res = await api<any>('GET', '/system/settings');
  if (res.code === 0) Object.assign(cfg, res.data);
}

async function saveFields(fields: string[]) {
  const body: Record<string, string> = {};
  for (const f of fields) body[f] = cfg[f] ?? '';
  saving.value = true;
  const res = await api('POST', '/system/settings', body);
  saving.value = false;
  if (res.code === 0) message.success(t('systemSet.saveSuccess'));
  else message.error(res.msg);
}

async function saveMail() {
  const fields = ['mail_type', 'mail_recv'];
  if ((cfg.mail_type || '0') === '0') fields.push('mail_smtp', 'mail_port', 'mail_name', 'mail_pwd');
  else fields.push('mail_apiuser', 'mail_apikey', 'mail_name');
  await saveFields(fields);
}

async function testMail() {
  const res = await api('POST', '/system/mailtest', {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
async function testTgbot() {
  const res = await api('POST', '/system/tgbottest', {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
const showQqbotHelp = ref(false);
const qqbotWebhook = computed(() => `${location.origin}/api/qqbot/webhook`);
async function testQqbot() {
  const res = await api('POST', '/system/qqbottest', {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
async function copyQqbotWebhook() {
  try {
    await navigator.clipboard.writeText(qqbotWebhook.value);
    message.success(t('common.copied'));
  } catch {
    message.error(t('systemSet.copyFailed'));
  }
}
async function testWebhook() {
  const res = await api('POST', '/system/webhooktest', {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
async function testCustomWebhook() {
  const res = await api('POST', '/system/customwebhooktest', {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
async function testProxy() {
  const res = await api('POST', '/system/proxytest', {
    proxy_server: cfg.proxy_server,
    proxy_port: cfg.proxy_port,
    proxy_user: cfg.proxy_user,
    proxy_pwd: cfg.proxy_pwd,
    proxy_type: cfg.proxy_type,
  });
  if (res.code === 0) message.success(res.msg);
  else message.error(t('systemSet.proxyTestFailed', { msg: res.msg }));
}

async function setVcode(v: boolean) {
  cfg.vcode = v ? '1' : '2';
  await saveFields(['vcode']);
}
async function setCronType(v: boolean) {
  cfg.cron_type = v ? '1' : '0';
  await saveFields(['cron_type']);
}

const statCacheInterval = computed<number>({
  get: () => Number(cfg.cdn_stats_cache_interval || 30),
  set: (v: number) => {
    cfg.cdn_stats_cache_interval = String(v ?? 30);
  },
});
async function setStatCache(v: boolean) {
  cfg.cdn_stats_cache = v ? '1' : '0';
  await saveFields(['cdn_stats_cache']);
}
async function saveStatCache() {
  await saveFields(['cdn_stats_cache', 'cdn_stats_cache_interval']);
}
const refreshingCache = ref(false);
async function refreshStatCache() {
  refreshingCache.value = true;
  const res = await api('POST', '/system/stat-cache-refresh', {});
  refreshingCache.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    await loadSettings();
  } else message.error(res.msg);
}
const clearingCache = ref(false);
function clearStatCache() {
  dialog.warning({
    title: t('systemSet.clearCacheTitle'),
    content: t('systemSet.clearCacheContent'),
    positiveText: t('systemSet.clearNow'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      clearingCache.value = true;
      const res = await api('POST', '/system/stat-cache-clear', {});
      clearingCache.value = false;
      if (res.code === 0) {
        message.success(res.msg);
        await loadSettings();
      } else message.error(res.msg);
    },
  });
}

async function loadCronKey() {
  const res = await api<any>('GET', '/system/cronkey');
  if (res.code === 0) cronKey.value = res.data.cron_key;
}

const regCodeColumns = computed<any[]>(() => [
  { title: t('systemSet.regCodeCol'), key: 'code', width: 180 },
  { title: t('common.status'), key: 'status', width: 80, render: (row: any) => (row.status === 1 ? h(NTag, { type: 'success', size: 'small' }, { default: () => t('systemSet.regCodeStatusActive') }) : h(NTag, { type: 'default', size: 'small' }, { default: () => t('systemSet.regCodeStatusDisabled') })) },
  { title: t('systemSet.regCodeExpire'), key: 'expiretime', width: 160, render: (row: any) => (row.expiretime ? String(row.expiretime).slice(0, 16) : t('systemSet.permanent')) },
  { title: t('systemSet.regCodeUsed'), key: 'used', width: 90, render: (row: any) => `${row.used}${row.max_use > 0 ? '/' + row.max_use : '/∞'}` },
  { title: t('common.remark'), key: 'remark', ellipsis: { tooltip: true } },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 160,
    render: (row: any) =>
      h(NSpace, { size: 'small' }, () => [
        h(
          NButton,
          { size: 'small', quaternary: true, type: row.status === 1 ? 'warning' : 'success', onClick: () => toggleCodeStatus(row) },
          { default: () => (row.status === 1 ? t('systemSet.regCodeStatusDisabled') : t('systemSet.regCodeStatusActive')) }
        ),
        h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => deleteCode(row) }, { default: () => t('common.delete') }),
      ]),
  },
]);

async function loadRegCodes() {
  regCodesLoading.value = true;
  const res = await api<any>('GET', '/register/codes', { limit: 500, offset: 0 });
  regCodesLoading.value = false;
  if (res.code === 0) regCodes.value = res.data.list;
  else message.error(res.msg);
}

async function setRegisterEnable(v: boolean) {
  cfg.register_enable = v ? '1' : '0';
  await saveFields(['register_enable']);
}

async function saveRegister() {
  await saveFields(['register_enable', 'register_mode']);
}

async function doGen() {
  genning.value = true;
  const res = await api<any>('POST', '/register/codes', genForm);
  genning.value = false;
  if (res.code === 0) {
    showGen.value = false;
    resultText.value = (res.data.codes || []).join('\n');
    showResult.value = true;
    loadRegCodes();
  } else {
    message.error(res.msg);
  }
}

async function copyResult() {
  try {
    await navigator.clipboard.writeText(resultText.value);
    message.success(t('systemSet.copiedClipboard'));
  } catch {
    message.warning(t('systemSet.copyFailedManual'));
  }
}

async function toggleCodeStatus(row: any) {
  const res = await api<any>('POST', '/register/codes/' + row.id + '/status', { status: row.status === 1 ? 0 : 1 });
  if (res.code === 0) {
    message.success(res.msg);
    loadRegCodes();
  } else message.error(res.msg);
}

async function deleteCode(row: any) {
  const res = await api<any>('DELETE', '/register/codes/' + row.id);
  if (res.code === 0) {
    message.success(res.msg);
    loadRegCodes();
  } else message.error(res.msg);
}

onMounted(() => {
  loadSettings();
  loadCronKey();
  loadRegCodes();
});
</script>

<style scoped>
.mb-12 { margin-bottom: 12px; }
.mb-16 { margin-bottom: 16px; }
.narrow { max-width: 520px; }
.narrow-wide { max-width: 560px; }
.narrow-sm { max-width: 420px; }
.help-body p {
  margin: 0 0 8px;
  line-height: 1.7;
  font-size: 13px;
  color: var(--app-text-2);
}
</style>