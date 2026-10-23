<template>
  <div>
    <template v-if="sub === 'account' || sub === 'security'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ sub === 'account' ? t('esaAccount.analyticsAccount') : t('esaAccount.analyticsSecurity') }}</h3>
        </div>
        <p class="esa-module__hint">{{ sub === 'account' ? t('esaAccount.analyticsAccountDesc') : t('esaAccount.analyticsSecurityDesc') }}</p>
        <n-form label-placement="left" label-width="120" size="small">
          <n-form-item :label="t('esaAccount.site')">
            <EsaCardSelect v-model="query.SiteId" :options="siteOptions" compact clearable searchable style="width: 280px" />
          </n-form-item>
          <n-form-item :label="t('esaAccount.startTime')"><n-input v-model:value="query.StartTime" placeholder="2026-01-01 00:00:00" /></n-form-item>
          <n-form-item :label="t('esaAccount.endTime')"><n-input v-model:value="query.EndTime" placeholder="2026-01-02 00:00:00" /></n-form-item>
          <n-form-item :label="t('esaAccount.interval')">
            <EsaCardSelect v-model="query.Interval" :options="intervalOptions" compact style="width: 200px" />
          </n-form-item>
          <n-form-item :label="t('esaAccount.fields')"><n-input v-model:value="query.Fields" placeholder="requests,traffic" /></n-form-item>
          <n-form-item :show-label="false">
            <n-space>
              <n-button size="small" type="primary" :loading="busy" :disabled="busy" @click="runSeries">{{ t('esaAccount.series') }}</n-button>
              <n-button size="small" :loading="busy" :disabled="busy" @click="runTop">{{ t('esaAccount.top') }}</n-button>
            </n-space>
          </n-form-item>
        </n-form>
        <n-alert v-if="error" type="error" :show-icon="false" class="mb-3">{{ error }}</n-alert>
        <div v-if="summary.length" class="esa-account-stats">
          <div v-for="item in summary" :key="item.field" class="esa-account-stat">
            <span class="esa-account-stat__label">{{ item.field }}</span>
            <span class="esa-account-stat__value tnum">{{ item.value }}</span>
          </div>
        </div>
        <pre v-if="resultText" class="code-view">{{ resultText }}</pre>
        <span v-else class="hint-text">{{ t('esaZone.empty') }}</span>
      </div>
    </template>

    <template v-else-if="sub === 'logs'">
      <EsaActionTable
        :aid="aid"
        zone-id=""
        :title="t('esaAccount.logsTitle')"
        :desc="t('esaAccount.logsDesc')"
        list-action="ListUserDeliveryTasks"
        items-path="Tasks"
        id-key="TaskName"
        name-key="TaskName"
        :columns="logColumns"
        :create-action="'CreateUserDeliveryTask'"
        :create-label="t('esaZone.create')"
        :create-fields="logCreateFields"
        :update-action="'UpdateUserDeliveryTask'"
        :update-fields="logUpdateFields"
        :delete-action="'DeleteUserDeliveryTask'"
        :paginate="false"
      />
    </template>

    <template v-else>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaAccount.analyticsTrace') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.traceHint') }}</p>
        <n-form label-placement="left" label-width="120" size="small">
          <n-form-item :label="t('esaAccount.traceUrl')"><n-input v-model:value="trace.Url" placeholder="https://example.com/" /></n-form-item>
          <n-form-item :label="t('esaAccount.traceMethod')">
            <EsaCardSelect v-model="trace.Method" :options="methodOptions" compact style="width: 200px" />
          </n-form-item>
          <n-form-item :label="t('esaAccount.traceProtocol')"><n-input v-model:value="trace.Protocol" placeholder="HTTP/1.1" /></n-form-item>
          <n-form-item :label="t('esaAccount.traceHeaders')">
            <n-input v-model:value="trace.Headers" type="textarea" :rows="3" class="mono-input" spellcheck="false" placeholder='[{"Name":"User-Agent","Value":"..."}]' />
          </n-form-item>
          <n-form-item :label="t('esaAccount.traceCookies')">
            <n-input v-model:value="trace.Cookies" type="textarea" :rows="3" class="mono-input" spellcheck="false" placeholder='[{"Name":"a","Value":"b"}]' />
          </n-form-item>
          <n-form-item :label="t('esaAccount.traceBody')">
            <n-input v-model:value="trace.Body" type="textarea" :rows="3" class="mono-input" spellcheck="false" placeholder="{}" />
          </n-form-item>
          <n-form-item :show-label="false">
            <n-button size="small" type="primary" :loading="busy" :disabled="busy" @click="runTrace">{{ t('esaAccount.traceRun') }}</n-button>
          </n-form-item>
        </n-form>
        <n-alert v-if="error" type="error" :show-icon="false" class="mb-3">{{ error }}</n-alert>
        <pre v-if="resultText" class="code-view">{{ resultText }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NForm, NFormItem, NInput, NSpace, useMessage } from 'naive-ui';
import { api } from '../../api';
import { formatDateTime, toIsoDateTime } from '../../lib/datetime';
import EsaCardSelect from './EsaCardSelect.vue';
import EsaActionTable from './EsaActionTable.vue';
import type { EsaFieldDef } from './EsaActionPanel.vue';
import type { EsaTableColumn } from './EsaActionTable.vue';

const props = defineProps<{ aid: number; sites: any[] }>();
const { t } = useI18n();
const message = useMessage();

const sub = defineModel<string>('sub', { default: 'account' });

const siteOptions = computed(() =>
  (props.sites || []).map((s) => ({ label: s.zone_name || s.name || s.zoneId, value: String(s.zone_id || s.zoneId || '') })).filter((o) => o.value),
);

const intervalOptions = [
  { label: '60s', value: '60' },
  { label: '300s', value: '300' },
  { label: '1h', value: '3600' },
  { label: '1d', value: '86400' },
];
const methodOptions = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((v) => ({ label: v, value: v }));

function iso(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const query = reactive({
  SiteId: '',
  StartTime: formatDateTime(iso(-24 * 3600 * 1000)),
  EndTime: formatDateTime(iso(0)),
  Interval: '3600',
  Fields: 'requests',
});

const trace = reactive({ Url: '', Method: 'GET', Protocol: 'HTTP/1.1', Headers: '', Cookies: '', Body: '' });
watch(
  () => props.sites,
  (list) => {
    if (!query.SiteId && list?.length) query.SiteId = String(list[0].zone_id || list[0].zoneId || '');
  },
  { immediate: true },
);


const busy = ref(false);
const error = ref('');
const resultText = ref('');
const summary = ref<{ field: string; value: any }[]>([]);

const logColumns = computed<EsaTableColumn[]>(() => [
  { key: 'TaskName', label: t('esaAccount.taskName'), minWidth: 160 },
  { key: 'BusinessType', label: t('esaAccount.businessType'), minWidth: 160 },
  { key: 'DeliveryType', label: t('esaAccount.deliveryType'), width: 120 },
  { key: 'FieldName', label: t('esaAccount.fieldName'), minWidth: 160 },
  { key: 'Status', label: t('esaAccount.taskStatus'), width: 110 },
]);

const logCreateFields = computed<EsaFieldDef[]>(() => [
  { name: 'TaskName', label: t('esaAccount.taskName'), required: true },
  {
    name: 'BusinessType',
    label: t('esaAccount.businessType'),
    type: 'select',
    required: true,
    options: [
      { label: 'Access Log', value: 'dcdn_log_access_l1' },
      { label: 'WAF Log', value: 'dcdn_log_waf' },
      { label: 'Edge Routine Log', value: 'dcdn_log_er' },
    ],
  },
  { name: 'FieldName', label: t('esaAccount.fieldName'), required: true, placeholder: 'requests,bytes' },
  {
    name: 'DeliveryType',
    label: t('esaAccount.deliveryType'),
    type: 'select',
    required: true,
    options: [
      { label: 'SLS', value: 'sls' },
      { label: 'OSS', value: 'oss' },
      { label: 'S3', value: 's3' },
      { label: 'HTTP', value: 'http' },
      { label: 'Kafka', value: 'kafka' },
    ],
  },
  { name: 'DiscardRate', label: t('esaAccount.discardRate'), type: 'number', min: 0, max: 100 },
  { name: 'Details', label: t('esaAccount.details'), type: 'json', help: 'JSON object' },
]);

const logUpdateFields = computed<EsaFieldDef[]>(() => [
  { name: 'FieldName', label: t('esaAccount.fieldName'), required: true },
  { name: 'DiscardRate', label: t('esaAccount.discardRate'), type: 'number', min: 0, max: 100 },
  { name: 'Details', label: t('esaAccount.details'), type: 'json', help: 'JSON object' },
]);

function fieldsArray() {
  return query.Fields.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function call(action: string, params: Record<string, any>) {
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, { action, params });
  if (res.code !== 0) throw new Error(res.msg || t('esaAccount.loadFailed'));
  return res.data;
}

function pickSummary(data: any) {
  const raw = data?.SummarizedData || data?.Summary || data?.Data;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row: any) => ({ field: String(row.Field || row.Name || row.field || ''), value: row.Value ?? row.value ?? '' }))
    .filter((x) => x.field)
    .slice(0, 6);
}

async function runSeries() {
  const fields = fieldsArray();
  if (!fields.length) return message.warning(t('esaAccount.fields'));
  busy.value = true;
  error.value = '';
  resultText.value = '';
  summary.value = [];
  try {
    const action = sub.value === 'security' ? 'DescribeSiteWafTimeSeriesData' : 'DescribeSiteTimeSeriesData';
    const data = await call(action, {
      ...(query.SiteId ? { SiteId: query.SiteId } : {}),
      StartTime: toIsoDateTime(query.StartTime),
      EndTime: toIsoDateTime(query.EndTime),
      Interval: query.Interval,
      Fields: fields,
    });
    summary.value = pickSummary(data);
    resultText.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
    error.value = e?.message || t('esaAccount.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function runTop() {
  const fields = fieldsArray();
  if (!fields.length) return message.warning(t('esaAccount.fields'));
  busy.value = true;
  error.value = '';
  resultText.value = '';
  summary.value = [];
  try {
    const action = sub.value === 'security' ? 'DescribeSiteWafTopData' : 'DescribeSiteTopData';
    const data = await call(action, {
      ...(query.SiteId ? { SiteId: query.SiteId } : {}),
      StartTime: toIsoDateTime(query.StartTime),
      EndTime: toIsoDateTime(query.EndTime),
      Interval: query.Interval,
      Fields: fields,
      Limit: '10',
    });
    resultText.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
    error.value = e?.message || t('esaAccount.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function runTrace() {
  if (!trace.Url.trim()) return message.warning(t('esaAccount.traceUrl'));
  busy.value = true;
  error.value = '';
  resultText.value = '';
  try {
    const params: Record<string, any> = { Url: trace.Url.trim(), Method: trace.Method, Protocol: trace.Protocol };
    for (const key of ['Headers', 'Cookies', 'Body'] as const) {
      const text = trace[key].trim();
      if (!text) continue;
      try {
        params[key] = JSON.parse(text);
      } catch {
        error.value = t('esaZone.invalidJson');
        return;
      }
    }
    const data = await call('TraceSite', params);
    resultText.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
    error.value = e?.message || t('esaAccount.loadFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.esa-account-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.esa-account-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  background: var(--app-surface);
}

.esa-account-stat__label {
  font-size: 11px;
  color: var(--app-text-3);
}

.esa-account-stat__value {
  font-size: 18px;
  font-weight: 700;
}
</style>
