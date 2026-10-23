<template>
  <div>
    <template v-if="sub === 'account' || sub === 'security'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ sub === 'account' ? t('esaZone.analyticsAccount') : t('esaZone.analyticsSecurity') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaZone.analyticsHint') }}</p>
        <n-form label-placement="left" label-width="120" size="small">
          <n-form-item :label="t('esaZone.analyticsStartTime')">
            <n-input v-model:value="query.StartTime" placeholder="2026-01-01 00:00:00" />
          </n-form-item>
          <n-form-item :label="t('esaZone.analyticsEndTime')">
            <n-input v-model:value="query.EndTime" placeholder="2026-01-02 00:00:00" />
          </n-form-item>
          <n-form-item :label="t('esaZone.analyticsInterval')">
            <EsaCardSelect v-model="query.Interval" :options="intervalOptions" compact style="width: 200px" />
          </n-form-item>
          <n-form-item :label="t('esaZone.analyticsFields')">
            <n-input v-model:value="query.Fields" :placeholder="t('esaZone.analyticsFieldsHint')" />
          </n-form-item>
          <n-form-item :show-label="false">
            <n-space>
              <n-button size="small" type="primary" :loading="busy" :disabled="busy" @click="runSeries">{{ t('esaZone.querySeries') }}</n-button>
              <n-button size="small" :loading="busy" :disabled="busy" @click="runTop">{{ t('esaZone.queryTop') }}</n-button>
            </n-space>
          </n-form-item>
        </n-form>
        <n-alert v-if="error" type="error" :show-icon="false" class="mb-3">{{ error }}</n-alert>
        <pre v-if="resultText" class="code-view">{{ resultText }}</pre>
        <span v-else class="hint-text">{{ t('esaZone.empty') }}</span>
      </div>
    </template>

    <template v-else-if="sub === 'logs'">
      <EsaActionTable
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.realtimeLogs')"
        :desc="t('esaZone.realtimeLogsDesc')"
        :columns="logColumns"
        list-action="ListSiteDeliveryTasks"
      />
    </template>

    <template v-else>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.trace') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaZone.traceHint') }}</p>
        <n-form label-placement="left" label-width="120" size="small">
          <n-form-item :label="t('esaZone.traceUrl')">
            <n-input v-model:value="trace.Url" placeholder="https://example.com/" />
          </n-form-item>
          <n-form-item :label="t('esaZone.traceMethod')">
            <EsaCardSelect v-model="trace.Method" :options="methodOptions" compact style="width: 200px" />
          </n-form-item>
          <n-form-item :label="t('esaZone.traceProtocol')">
            <n-input v-model:value="trace.Protocol" placeholder="HTTP/1.1" />
          </n-form-item>
          <n-form-item :label="t('esaZone.traceHeaders')">
            <n-input v-model:value="trace.Headers" type="textarea" :rows="3" class="mono-input" spellcheck="false" placeholder='[{"Name":"User-Agent","Value":"..."}]' />
          </n-form-item>
          <n-form-item :label="t('esaZone.traceCookies')">
            <n-input v-model:value="trace.Cookies" type="textarea" :rows="3" class="mono-input" spellcheck="false" placeholder='[{"Name":"a","Value":"b"}]' />
          </n-form-item>
          <n-form-item :label="t('esaZone.traceBody')">
            <n-input v-model:value="trace.Body" type="textarea" :rows="3" class="mono-input" spellcheck="false" placeholder='{}' />
          </n-form-item>
          <n-form-item :show-label="false">
            <n-button size="small" type="primary" :loading="busy" :disabled="busy" @click="runTrace">{{ t('esaZone.runTrace') }}</n-button>
          </n-form-item>
        </n-form>
        <n-alert v-if="error" type="error" :show-icon="false" class="mb-3">{{ error }}</n-alert>
        <pre v-if="resultText" class="code-view">{{ resultText }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessage, NAlert, NButton, NForm, NFormItem, NInput, NSpace } from 'naive-ui';
import { api } from '../../api';
import { formatDateTime, toIsoDateTime } from '../../lib/datetime';
import EsaCardSelect from './EsaCardSelect.vue';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';

const props = defineProps<{ aid: number; zoneId: string }>();
const { t } = useI18n();
const message = useMessage();

const sub = defineModel<string>('sub', { default: 'account' });
const busy = ref(false);
const error = ref('');
const resultText = ref('');

const logColumns = computed<EsaTableColumn[]>(() => [
  { key: 'TaskName', label: t('esaAccount.taskName'), minWidth: 170 },
  { key: 'BusinessType', label: t('esaAccount.businessType'), minWidth: 170 },
  { key: 'DeliveryType', label: t('esaAccount.deliveryType'), width: 120 },
  { key: 'FieldName', label: t('esaAccount.fieldName'), minWidth: 170 },
  { key: 'Status', label: t('esaAccount.taskStatus'), width: 110 },
]);

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
  StartTime: formatDateTime(iso(-24 * 3600 * 1000)),
  EndTime: formatDateTime(iso(0)),
  Interval: '3600',
  Fields: 'requests',
});

const trace = reactive({
  Url: '',
  Method: 'GET',
  Protocol: 'HTTP/1.1',
  Headers: '',
  Cookies: '',
  Body: '',
});

function fieldsArray() {
  return query.Fields.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function call(action: string, params: Record<string, any>) {
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
    action,
    zoneId: props.zoneId,
    params,
  });
  if (res.code !== 0) throw new Error(res.msg || t('esaZone.loadFailed'));
  return res.data;
}

async function runSeries() {
  const fields = fieldsArray();
  if (!fields.length) return message.warning(t('esaZone.analyticsFieldsRequired'));
  busy.value = true;
  error.value = '';
  resultText.value = '';
  try {
    const action = sub.value === 'security' ? 'DescribeSiteWafTimeSeriesData' : 'DescribeSiteTimeSeriesData';
    const data = await call(action, {
      SiteId: props.zoneId,
      StartTime: toIsoDateTime(query.StartTime),
      EndTime: toIsoDateTime(query.EndTime),
      Interval: query.Interval,
      Fields: fields,
    });
    resultText.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
    error.value = e?.message || t('esaZone.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function runTop() {
  const fields = fieldsArray();
  if (!fields.length) return message.warning(t('esaZone.analyticsFieldsRequired'));
  busy.value = true;
  error.value = '';
  resultText.value = '';
  try {
    const action = sub.value === 'security' ? 'DescribeSiteWafTopData' : 'DescribeSiteTopData';
    const data = await call(action, {
      SiteId: props.zoneId,
      StartTime: toIsoDateTime(query.StartTime),
      EndTime: toIsoDateTime(query.EndTime),
      Interval: query.Interval,
      Fields: fields,
      Limit: '10',
    });
    resultText.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
    error.value = e?.message || t('esaZone.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function runTrace() {
  if (!trace.Url.trim()) return message.warning(t('esaZone.traceUrlRequired'));
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
    error.value = e?.message || t('esaZone.loadFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
</style>
