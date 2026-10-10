<template>
  <div class="app-stack">
    <PageHeader :title="t('cfRules.title')" :subtitle="t('cfRules.subtitle')" back="/cdn-domains">
      <template #actions>
        <n-space>
          <n-button :loading="loading" @click="loadRules">{{ t('common.refresh') }}</n-button>
          <n-button :disabled="!selectedDomain" @click="openCredential">{{ t('cfRules.credentialSettings') }}</n-button>
          <n-button type="primary" :disabled="!selectedDomain" @click="openAdd">{{ t('cfRules.addRule') }}</n-button>
        </n-space>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="rules.length" :label="t('common.total')" tone="primary" :icon="ListOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="typeCount" :label="t('common.type')" tone="info" :icon="LayersOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="statusCount" :label="t('common.status')" tone="success" :icon="FlashOutline" /></n-grid-item>
    </n-grid>

    <n-card :bordered="false">
      <n-space align="center" :wrap="true" class="mb-12">
        <n-select
          v-model:value="selectedDomain"
          :options="domainOptions"
          :placeholder="t('cfRules.selectDomain')"
          style="width: 260px"
          filterable
          @update:value="onDomainChange"
        />
        <n-select
          v-model:value="selectedPhase"
          :options="phaseOptions"
          style="width: 220px"
          @update:value="onPhaseChange"
        />
        <n-tag v-if="selectedDomain && credentialSource" size="small" :type="credentialSource === 'dedicated' ? 'success' : 'default'">
          {{ credentialSource === 'dedicated' ? t('cfRules.dedicatedCredential') : t('cfRules.dnsAccountKey') }}
        </n-tag>
      </n-space>

      <n-alert v-if="needCredential" type="warning" style="margin-bottom: 12px" :show-icon="true">
        {{ credentialMessage }}
        <template #action>
          <n-button size="small" type="primary" @click="openCredential">{{ t('cfRules.fillDedicatedCredential') }}</n-button>
        </template>
      </n-alert>

      <ResponsiveDataTable
        :columns="columns"
        :data="rules"
        :loading="loading"
        :row-key="(row: any) => row.id"
        :empty-text="t('cfRules.empty')"
      />
    </n-card>

    <!-- 规则编辑 -->
    <n-modal v-model:show="showRule" preset="card" :title="editingId ? t('cfRules.editTitle') : t('cfRules.addTitle')" style="max-width: 640px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cfRules.ruleType')">
          <n-tag size="small" type="info">{{ currentPhaseLabel }}</n-tag>
          <n-text depth="3" style="margin-left: 8px">{{ selectedPhase }}</n-text>
        </n-form-item>

        <n-form-item :label="t('cfRules.matchType')">
          <n-select v-model:value="ruleForm.matchType" :options="matchTypeOptions" style="width: 240px" />
        </n-form-item>
        <n-form-item v-if="showSubdomain" :label="t('cfRules.subdomain')">
          <n-input v-model:value="ruleForm.subdomain" :placeholder="t('cfRules.rootDomainPlaceholder')" />
        </n-form-item>
        <n-form-item v-if="showPath" :label="pathLabel">
          <n-input v-model:value="ruleForm.pathValue" :placeholder="pathPlaceholder" />
        </n-form-item>
        <n-form-item v-if="ruleForm.matchType === 'custom'" :label="t('cfRules.customExpression')">
          <n-input v-model:value="ruleForm.expression" :placeholder="t('cfRules.customExpressionPlaceholder')" />
        </n-form-item>

        <template v-if="selectedPhase === 'http_request_origin'">
          <n-form-item :label="t('cfRules.originPort')">
            <n-input-number v-model:value="ruleForm.port" :min="1" :max="65535" style="width: 200px" />
          </n-form-item>
        </template>

        <template v-else-if="selectedPhase === 'http_request_dynamic_redirect'">
          <n-form-item :label="t('cfRules.redirectUrl')">
            <n-input v-model:value="ruleForm.redirectUrl" placeholder="https://example.com/new" />
          </n-form-item>
          <n-form-item :label="t('cfRules.statusCode')">
            <n-select v-model:value="ruleForm.redirectStatus" :options="statusOptions" style="width: 160px" />
          </n-form-item>
        </template>

        <template v-else-if="selectedPhase === 'http_request_transform'">
          <n-form-item :label="t('cfRules.rewriteType')">
            <n-select v-model:value="ruleForm.rewriteType" :options="rewriteTypeOptions" style="width: 200px" />
          </n-form-item>
          <n-form-item :label="ruleForm.rewriteType === 'path' ? t('cfRules.newPathExpression') : t('cfRules.newQueryExpression')">
            <n-input
              v-model:value="ruleForm.rewriteValue"
              :placeholder="rewritePlaceholder"
            />
          </n-form-item>
        </template>

        <template v-else-if="isHeaderPhase">
          <n-form-item :label="t('cfRules.headerOperation')">
            <n-select v-model:value="ruleForm.headerOp" :options="headerOpOptions" style="width: 200px" />
          </n-form-item>
          <n-form-item :label="t('cfRules.headerName')">
            <n-input v-model:value="ruleForm.headerName" :placeholder="t('cfRules.headerNamePlaceholder')" />
          </n-form-item>
          <n-form-item v-if="ruleForm.headerOp !== 'remove'" :label="t('cfRules.headerValue')">
            <n-input v-model:value="ruleForm.headerValue" :placeholder="t('cfRules.headerValuePlaceholder')" />
          </n-form-item>
        </template>

        <template v-else-if="selectedPhase === 'http_request_cache_settings'">
          <n-form-item :label="t('cfRules.enableCache')">
            <n-switch v-model:value="ruleForm.cacheEnabled" />
          </n-form-item>
          <n-form-item :label="t('cfRules.edgeTtl')">
            <n-select v-model:value="ruleForm.cacheTtlMode" :options="ttlModeOptions" style="width: 240px" />
          </n-form-item>
          <n-form-item v-if="ruleForm.cacheTtlMode === 'override'" :label="t('cfRules.ttlSeconds')">
            <n-input-number v-model:value="ruleForm.cacheTtlValue" :min="0" style="width: 200px" />
          </n-form-item>
        </template>

        <template v-else-if="selectedPhase === 'http_ratelimit'">
          <n-form-item :label="t('cfRules.action')">
            <n-select v-model:value="ruleForm.ratelimitAction" :options="ratelimitActionOptions" style="width: 220px" />
          </n-form-item>
          <n-form-item :label="t('cfRules.dimension')">
            <n-select v-model:value="ruleForm.ratelimitChars" multiple :options="ratelimitDimensionOptions" style="width: 320px" />
          </n-form-item>
          <n-form-item :label="t('cfRules.periodSeconds')">
            <n-input-number v-model:value="ruleForm.ratelimitPeriod" :min="1" :max="86400" style="width: 200px" />
          </n-form-item>
          <n-form-item :label="t('cfRules.requestsThreshold')">
            <n-input-number v-model:value="ruleForm.ratelimitCount" :min="1" style="width: 200px" />
          </n-form-item>
          <n-form-item :label="t('cfRules.mitigationSeconds')">
            <n-input-number v-model:value="ruleForm.ratelimitMitigation" :min="0" style="width: 200px" />
          </n-form-item>
        </template>

        <n-form-item v-if="supportsAdvanced">
          <n-checkbox v-model:checked="ruleForm.showAdvancedJson">{{ t('cfRules.advancedJsonMode') }}</n-checkbox>
        </n-form-item>
        <n-form-item v-if="supportsAdvanced && ruleForm.showAdvancedJson" label="action JSON">
          <n-input v-model:value="ruleForm.actionJson" type="textarea" :rows="4" :placeholder="advancedPlaceholder" />
        </n-form-item>

        <n-form-item :label="t('common.remark')">
          <n-input v-model:value="ruleForm.description" :placeholder="t('cfRules.leaveBlank')" />
        </n-form-item>
        <n-form-item v-if="expressionPreview" :label="t('cfRules.generatedExpression')">
          <n-input :value="expressionPreview" type="textarea" :rows="2" readonly />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showRule = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="submitRule">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 专用凭证 -->
    <n-modal v-model:show="showCred" preset="card" :title="t('cfRules.credTitle')" style="max-width: 540px" :mask-closable="false">
      <n-alert type="info" style="margin-bottom: 12px">
        {{ t('cfRules.credHint') }}
      </n-alert>
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cfRules.authMethod')">
          <n-radio-group v-model:value="credForm.auth">
            <n-radio :value="1">{{ t('cfRules.apiToken') }}</n-radio>
            <n-radio :value="0">{{ t('cfRules.globalApiKey') }}</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="credForm.auth === 0" :label="t('cfRules.accountEmail')">
          <n-input v-model:value="credForm.email" :placeholder="t('cfRules.accountEmailPlaceholder')" />
        </n-form-item>
        <n-form-item :label="credForm.auth === 1 ? t('cfRules.apiToken') : t('cfRules.globalApiKey')">
          <n-input v-model:value="credForm.apikey" type="password" show-password-on="click" :placeholder="t('cfRules.apikeyPlaceholder')" />
        </n-form-item>
        <n-form-item label="Account ID">
          <n-input v-model:value="credForm.account_id" :placeholder="t('cfRules.accountIdPlaceholder')" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="space-between" style="width: 100%">
          <n-button v-if="hasDedicated" type="error" ghost @click="removeCredential">{{ t('cfRules.removeCredential') }}</n-button>
          <n-space justify="end" style="margin-left: auto">
            <n-button @click="showCred = false">{{ t('common.cancel') }}</n-button>
            <n-button type="primary" :loading="savingCred" @click="saveCredential">{{ t('cfRules.verifyAndSave') }}</n-button>
          </n-space>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, h } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { api } from '../api';
import { ListOutline, LayersOutline, FlashOutline } from '@vicons/ionicons5';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const route = useRoute();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

interface DomainItem {
  id: number;
  name: string;
  zone_id: string;
  aid: number;
  account_name: string;
}

const domains = ref<DomainItem[]>([]);
const selectedDomain = ref<number | null>(null);
const selectedPhase = ref('http_request_origin');
const rules = ref<any[]>([]);
const typeCount = computed(() => new Set(rules.value.filter((r: any) => r.type != null).map((r: any) => r.type)).size);
const statusCount = computed(() => new Set(rules.value.filter((r: any) => r.status != null).map((r: any) => r.status)).size);
const loading = ref(false);
const needCredential = ref(false);
const credentialMessage = ref('');
const credentialSource = ref<'dns' | 'dedicated' | ''>('');

const DEFAULT_PHASES = computed(() => [
  { value: 'http_request_origin', label: t('cfRules.phaseOrigin'), scope: 'zone', permission: 'Origin Rules Write' },
  { value: 'http_request_dynamic_redirect', label: t('cfRules.phaseRedirect'), scope: 'zone', permission: 'Dynamic URL Redirects Write' },
  { value: 'http_request_transform', label: t('cfRules.phaseUrlRewrite'), scope: 'zone', permission: 'Zone Transform Rules Write' },
  { value: 'http_request_late_transform', label: t('cfRules.phaseRequestHeaderTransform'), scope: 'zone', permission: 'Zone Transform Rules Write' },
  { value: 'http_response_headers_transform', label: t('cfRules.phaseResponseHeaderTransform'), scope: 'zone', permission: 'Zone Transform Rules Write' },
  { value: 'http_request_cache_settings', label: t('cfRules.phaseCacheSettings'), scope: 'zone', permission: 'Cache Settings Write' },
  { value: 'http_request_firewall_custom', label: t('cfRules.phaseFirewall'), scope: 'zone', permission: 'Zone WAF Write' },
  { value: 'http_ratelimit', label: t('cfRules.phaseRateLimit'), scope: 'zone', permission: 'Zone WAF Write' },
]);
const phasesMeta = ref<Array<{ value: string; label: string; scope: string; permission: string }>>(DEFAULT_PHASES.value);

const phaseOptions = computed(() => phasesMeta.value.map((p) => ({ label: p.label, value: p.value })));
const currentPhaseLabel = computed(() => phasesMeta.value.find((p) => p.value === selectedPhase.value)?.label || selectedPhase.value);
const domainOptions = computed(() => domains.value.map((d) => ({ label: `${d.account_name} · ${d.name}`, value: d.id })));

const selectedAid = computed(() => domains.value.find((d) => d.id === selectedDomain.value)?.aid || 0);
const selectedDomainName = computed(() => domains.value.find((d) => d.id === selectedDomain.value)?.name || '');

const matchTypeOptions = computed(() => [
  { label: t('cfRules.matchHostname'), value: 'hostname' },
  { label: t('cfRules.matchPathPrefix'), value: 'pathPrefix' },
  { label: t('cfRules.matchPathRegex'), value: 'pathRegex' },
  { label: t('cfRules.matchHostAndPath'), value: 'hostAndPath' },
  { label: t('cfRules.matchCustomExpression'), value: 'custom' },
]);
const statusOptions = [301, 302, 307, 308].map((v) => ({ label: String(v), value: v }));
const rewriteTypeOptions = computed(() => [
  { label: t('cfRules.rewritePath'), value: 'path' },
  { label: t('cfRules.rewriteQuery'), value: 'query' },
]);
const headerOpOptions = computed(() => [
  { label: t('cfRules.headerOpSet'), value: 'set' },
  { label: t('cfRules.headerOpAdd'), value: 'add' },
  { label: t('cfRules.headerOpRemove'), value: 'remove' },
]);
const ttlModeOptions = computed(() => [
  { label: t('cfRules.ttlRespectOrigin'), value: 'respect_origin_ttl' },
  { label: t('cfRules.ttlCustom'), value: 'override' },
]);
const ratelimitActionOptions = computed(() => [
  { label: t('cfRules.rateBlock'), value: 'block' },
  { label: t('cfRules.rateChallenge'), value: 'challenge' },
  { label: t('cfRules.rateJsChallenge'), value: 'js_challenge' },
]);
const ratelimitDimensionOptions = computed(() => [
  { label: t('cfRules.dimIp'), value: 'ip' },
  { label: t('cfRules.dimPath'), value: 'uri.path' },
  { label: t('cfRules.dimHostname'), value: 'http.host' },
]);

const isHeaderPhase = computed(() => selectedPhase.value === 'http_request_late_transform' || selectedPhase.value === 'http_response_headers_transform');
const supportsAdvanced = computed(() =>
  ['http_request_transform', 'http_request_late_transform', 'http_response_headers_transform', 'http_request_cache_settings', 'http_ratelimit'].includes(selectedPhase.value),
);
const showSubdomain = computed(() => ['hostname', 'hostAndPath'].includes(ruleForm.matchType));
const showPath = computed(() => ['pathPrefix', 'pathRegex', 'hostAndPath'].includes(ruleForm.matchType));
const pathLabel = computed(() => (ruleForm.matchType === 'pathRegex' ? t('cfRules.pathRegex') : t('cfRules.pathPrefix')));
const pathPlaceholder = computed(() => (ruleForm.matchType === 'pathRegex' ? t('cfRules.pathRegexPlaceholder') : t('cfRules.pathPrefixPlaceholder')));
const rewritePlaceholder = computed(() => (ruleForm.rewriteType === 'path' ? t('cfRules.rewritePlaceholderPath') : t('cfRules.rewritePlaceholderQuery')));

const advancedPlaceholder = computed(() => {
  switch (selectedPhase.value) {
    case 'http_request_transform':
      return '{"action":"rewrite","action_parameters":{"uri":{"path":{"expression":"${http.request.uri.path}"}}}}';
    case 'http_request_late_transform':
      return '{"action":"rewrite","action_parameters":{"headers":{"request":{"set":{"X-Custom-Header":"value"}}}}}';
    case 'http_response_headers_transform':
      return '{"action":"rewrite","action_parameters":{"headers":{"response":{"set":{"X-Frame-Options":"DENY"}}}}}';
    case 'http_request_cache_settings':
      return '{"action":"set_cache_settings","action_parameters":{"cache":true,"edge_ttl":{"mode":"respect_origin_ttl"}}}';
    case 'http_ratelimit':
      return '{"action":"block","action_parameters":{"characteristics":["ip"],"period":60,"requests_per_period":100}}';
    default:
      return '{"action":"...","action_parameters":{...}}';
  }
});

const showRule = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const ruleForm = reactive<any>({
  matchType: 'hostname',
  subdomain: '',
  pathValue: '',
  expression: '',
  port: 80,
  description: '',
  redirectUrl: '',
  redirectStatus: 301,
  actionJson: '',
  showAdvancedJson: false,
  rewriteType: 'path',
  rewriteValue: '',
  headerOp: 'set',
  headerName: '',
  headerValue: '',
  cacheEnabled: true,
  cacheTtlMode: 'respect_origin_ttl',
  cacheTtlValue: 3600,
  ratelimitAction: 'block',
  ratelimitChars: ['ip'] as string[],
  ratelimitPeriod: 60,
  ratelimitCount: 100,
  ratelimitMitigation: 60,
});

// 专用凭证
const showCred = ref(false);
const savingCred = ref(false);
const hasDedicated = ref(false);
const credForm = reactive<any>({ auth: 1, email: '', apikey: '', account_id: '' });

const ruleHostname = computed(() => {
  if (!selectedDomainName.value) return '';
  return ruleForm.subdomain ? `${ruleForm.subdomain}.${selectedDomainName.value}` : selectedDomainName.value;
});

const expressionPreview = computed(() => {
  switch (ruleForm.matchType) {
    case 'hostname':
      return ruleHostname.value ? `(http.host eq "${ruleHostname.value}")` : '';
    case 'pathPrefix':
      return ruleForm.pathValue ? `(http.request.uri.path matches "^${ruleForm.pathValue}.*")` : '';
    case 'pathRegex':
      return ruleForm.pathValue ? `(http.request.uri.path matches "${ruleForm.pathValue}")` : '';
    case 'hostAndPath':
      return ruleHostname.value && ruleForm.pathValue
        ? `(http.host eq "${ruleHostname.value}" and http.request.uri.path matches "^${ruleForm.pathValue}.*")`
        : '';
    case 'custom':
      return ruleForm.expression;
    default:
      return '';
  }
});

const columns = computed<any[]>(() => [
  { title: t('common.remark'), key: 'description', minWidth: 120, render: (row: any) => h(NEllipsis, { style: 'max-width:160px' }, { default: () => row.description || '-' }) },
  { title: t('cfRules.expressionCol'), key: 'expression', minWidth: 220, render: (row: any) => h(NEllipsis, { style: 'max-width:280px' }, { default: () => row.expression || '-' }) },
  { title: t('cfRules.action'), key: 'action', width: 120, render: (row: any) => h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => row.action || '-' }) },
  { title: t('cfRules.params'), key: 'params', minWidth: 160, render: (row: any) => h(NEllipsis, { style: 'max-width:200px' }, { default: () => JSON.stringify(row.action_parameters || {}) }) },
  {
    title: t('common.status'),
    key: 'enabled',
    width: 80,
    render: (row: any) => h(NTag, { size: 'small', type: row.enabled ? 'success' : 'default', bordered: false }, { default: () => (row.enabled ? t('cfRules.statusOn') : t('cfRules.statusOff')) }),
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 130,
    render: (row: any) =>
      h(NSpace, { size: 2 }, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEditRule(row) }, { default: () => t('common.edit') }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => confirmDelete(row) }, { default: () => t('common.delete') }),
        ],
      }),
  },
]);

async function loadPhases() {
  const res = await api<any>('GET', '/cf-rules/phases');
  if (res.code === 0 && Array.isArray(res.data) && res.data.length) phasesMeta.value = res.data;
}

async function loadDomains() {
  const res = await api<any>('GET', '/cf-rules/domains');
  if (res.code === 0) {
    domains.value = res.data || [];
    const preset = Number(route.query.domain || 0);
    if (preset && domains.value.some((d) => d.id === preset)) selectedDomain.value = preset;
    else if (domains.value.length) selectedDomain.value = domains.value[0].id;
  } else {
    message.error(res.msg);
  }
}

async function onDomainChange() {
  await loadRules();
}

async function onPhaseChange() {
  await loadRules();
}

async function loadRules() {
  if (!selectedDomain.value || !selectedPhase.value) {
    rules.value = [];
    return;
  }
  loading.value = true;
  needCredential.value = false;
  const res = await api<any>('GET', `/cf-rules/rules?domainId=${selectedDomain.value}&phase=${selectedPhase.value}`);
  loading.value = false;
  if (res.code === 0) {
    rules.value = res.data?.rules || [];
    credentialSource.value = res.data?.credential_source || '';
  } else {
    rules.value = [];
    if (res.data?.needCredential) {
      needCredential.value = true;
      credentialMessage.value = res.msg;
    } else {
      message.error(res.msg);
    }
  }
}

function resetRuleForm() {
  Object.assign(ruleForm, {
    matchType: 'hostname',
    subdomain: '',
    pathValue: '',
    expression: '',
    port: 80,
    description: '',
    redirectUrl: '',
    redirectStatus: 301,
    actionJson: '',
    showAdvancedJson: false,
    rewriteType: 'path',
    rewriteValue: '',
    headerOp: 'set',
    headerName: '',
    headerValue: '',
    cacheEnabled: true,
    cacheTtlMode: 'respect_origin_ttl',
    cacheTtlValue: 3600,
    ratelimitAction: 'block',
    ratelimitChars: ['ip'],
    ratelimitPeriod: 60,
    ratelimitCount: 100,
    ratelimitMitigation: 60,
  });
}

function openAdd() {
  editingId.value = null;
  resetRuleForm();
  showRule.value = true;
}

function openEditRule(row: any) {
  editingId.value = row.id;
  resetRuleForm();
  ruleForm.description = row.description || '';
  const ap = row.action_parameters || {};

  if (selectedPhase.value === 'http_request_origin' && ap.origin?.port) {
    ruleForm.port = ap.origin.port;
  }
  if (selectedPhase.value === 'http_request_dynamic_redirect' && ap.from_value) {
    const tu = ap.from_value.target_url;
    ruleForm.redirectUrl = typeof tu === 'string' ? tu : (tu?.expression || '');
    ruleForm.redirectStatus = ap.from_value.status_code || 301;
  }
  if (selectedPhase.value === 'http_request_transform') {
    if (ap.uri?.path?.expression) {
      ruleForm.rewriteType = 'path';
      ruleForm.rewriteValue = ap.uri.path.expression;
    } else if (ap.uri?.query?.expression) {
      ruleForm.rewriteType = 'query';
      ruleForm.rewriteValue = ap.uri.query.expression;
    }
  }
  if (isHeaderPhase.value) {
    const scope = ap.headers?.request || ap.headers?.response;
    if (scope?.set) {
      ruleForm.headerOp = 'set';
      const [k, v] = Object.entries(scope.set)[0] || ['', ''];
      ruleForm.headerName = String(k);
      ruleForm.headerValue = String(v ?? '');
    } else if (scope?.add) {
      ruleForm.headerOp = 'add';
      const [k, v] = Object.entries(scope.add)[0] || ['', ''];
      ruleForm.headerName = String(k);
      ruleForm.headerValue = String(v ?? '');
    } else if (scope?.remove) {
      ruleForm.headerOp = 'remove';
      ruleForm.headerName = String(scope.remove[0] || '');
    }
  }
  if (selectedPhase.value === 'http_request_cache_settings' && typeof ap.cache === 'boolean') {
    ruleForm.cacheEnabled = ap.cache;
    if (ap.edge_ttl?.mode === 'override' && ap.edge_ttl?.value != null) {
      ruleForm.cacheTtlMode = 'override';
      ruleForm.cacheTtlValue = ap.edge_ttl.value;
    }
  }
  if (selectedPhase.value === 'http_ratelimit' && (ap.characteristics || ap.period || ap.requests_per_period)) {
    ruleForm.ratelimitAction = row.action || 'block';
    ruleForm.ratelimitChars = ap.characteristics || ['ip'];
    ruleForm.ratelimitPeriod = ap.period || 60;
    ruleForm.ratelimitCount = ap.requests_per_period || 100;
    ruleForm.ratelimitMitigation = ap.mitigation_timeout ?? 60;
  }

  // 表达式反解析
  const expr = String(row.expression || '');
  const hostMatch = expr.match(/http\.host eq "([^"]+)"/);
  const pathMatch = expr.match(/http\.request\.uri\.path matches "([^"]+)"/);
  if (hostMatch && pathMatch) {
    ruleForm.matchType = 'hostAndPath';
    ruleForm.pathValue = pathMatch[1].replace(/^\^/, '').replace(/\.\*$/, '');
  } else if (hostMatch) {
    ruleForm.matchType = 'hostname';
  } else if (pathMatch) {
    ruleForm.pathValue = pathMatch[1];
    if (pathMatch[1].startsWith('^')) {
      ruleForm.matchType = 'pathPrefix';
      ruleForm.pathValue = pathMatch[1].replace(/^\^/, '').replace(/\.\*$/, '');
    } else {
      ruleForm.matchType = 'pathRegex';
    }
  } else {
    ruleForm.matchType = 'custom';
    ruleForm.expression = expr;
  }
  if (hostMatch && selectedDomainName.value) {
    const fullHost = hostMatch[1];
    if (fullHost === selectedDomainName.value) ruleForm.subdomain = '';
    else if (fullHost.endsWith('.' + selectedDomainName.value)) ruleForm.subdomain = fullHost.slice(0, -(selectedDomainName.value.length + 1));
    else {
      ruleForm.matchType = 'custom';
      ruleForm.expression = expr;
    }
  }

  // 结构化字段无法覆盖的规则，启用高级 JSON
  const hasStructured =
    ruleForm.rewriteValue ||
    ruleForm.headerName ||
    typeof ap.cache === 'boolean' ||
    ap.characteristics ||
    ['route', 'redirect', 'block'].includes(row.action);
  if (supportsAdvanced.value && !hasStructured && row.action) {
    ruleForm.showAdvancedJson = true;
    ruleForm.actionJson = JSON.stringify({ action: row.action, action_parameters: ap });
  }

  showRule.value = true;
}

function buildAction(): { action: string; action_parameters: Record<string, any> } {
  const phase = selectedPhase.value;
  let action = 'route';
  let action_parameters: Record<string, any> = {};
  if (ruleForm.showAdvancedJson && ruleForm.actionJson) {
    const parsed = JSON.parse(ruleForm.actionJson);
    return { action: parsed.action || 'block', action_parameters: parsed.action_parameters || {} };
  }
  if (phase === 'http_request_origin') {
    action = 'route';
    action_parameters = { origin: { port: ruleForm.port } };
  } else if (phase === 'http_request_dynamic_redirect') {
    action = 'redirect';
    action_parameters = { from_value: { target_url: ruleForm.redirectUrl || '', status_code: ruleForm.redirectStatus || 301 } };
  } else if (phase === 'http_request_transform') {
    action = 'rewrite';
    const key = ruleForm.rewriteType === 'path' ? 'path' : 'query';
    action_parameters = { uri: { [key]: { expression: ruleForm.rewriteValue } } };
  } else if (phase === 'http_request_late_transform' || phase === 'http_response_headers_transform') {
    action = 'rewrite';
    const scope = phase === 'http_request_late_transform' ? 'request' : 'response';
    if (ruleForm.headerOp === 'remove') {
      action_parameters = { headers: { [scope]: { remove: [ruleForm.headerName] } } };
    } else {
      action_parameters = { headers: { [scope]: { [ruleForm.headerOp]: { [ruleForm.headerName]: ruleForm.headerValue || '' } } } };
    }
  } else if (phase === 'http_request_cache_settings') {
    action = 'set_cache_settings';
    action_parameters = { cache: ruleForm.cacheEnabled };
    action_parameters.edge_ttl = ruleForm.cacheTtlMode === 'override' ? { mode: 'override', value: ruleForm.cacheTtlValue } : { mode: 'respect_origin_ttl' };
  } else if (phase === 'http_request_firewall_custom') {
    action = 'block';
    action_parameters = {};
  } else if (phase === 'http_ratelimit') {
    action = ruleForm.ratelimitAction;
    action_parameters = {
      characteristics: ruleForm.ratelimitChars,
      period: ruleForm.ratelimitPeriod,
      requests_per_period: ruleForm.ratelimitCount,
      mitigation_timeout: ruleForm.ratelimitMitigation,
    };
  }
  return { action, action_parameters };
}

async function submitRule() {
  if (!selectedDomain.value || !selectedPhase.value) return;
  const expression = expressionPreview.value;
  if (!expression) return message.warning(t('cfRules.fillCondition'));
  let built: { action: string; action_parameters: Record<string, any> };
  try {
    built = buildAction();
  } catch {
    return message.error(t('cfRules.actionJsonParseFailed'));
  }
  const payload = {
    domain_id: selectedDomain.value,
    phase: selectedPhase.value,
    expression,
    action: built.action,
    action_parameters: built.action_parameters,
    description: ruleForm.description || undefined,
  };
  saving.value = true;
  const res = editingId.value
    ? await api<any>('PUT', `/cf-rules/rules/${editingId.value}`, payload)
    : await api<any>('POST', '/cf-rules/rules', payload);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg || t('common.saved'));
    showRule.value = false;
    await loadRules();
  } else if (res.data?.needCredential) {
    needCredential.value = true;
    credentialMessage.value = res.msg;
    showRule.value = false;
    openCredential();
  } else {
    message.error(res.msg);
  }
}

function confirmDelete(row: any) {
  dialog.warning({
    title: t('cfRules.deleteTitle'),
    content: t('cfRules.deleteConfirm', { expression: row.expression || '' }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api<any>('DELETE', `/cf-rules/rules/${row.id}?domainId=${selectedDomain.value}&phase=${selectedPhase.value}`);
      if (res.code === 0) {
        message.success(t('cfRules.deleteSuccess'));
        await loadRules();
      } else {
        message.error(res.msg);
      }
    },
  });
}

async function openCredential() {
  if (!selectedAid.value) return message.warning(t('cfRules.selectDomainFirst'));
  const res = await api<any>('GET', `/cf-rules/credential?aid=${selectedAid.value}`);
  hasDedicated.value = !!res.data?.has_dedicated;
  credForm.auth = res.data?.config?.auth ?? 1;
  credForm.email = res.data?.config?.email || '';
  credForm.apikey = '';
  credForm.account_id = res.data?.config?.account_id || '';
  showCred.value = true;
}

async function saveCredential() {
  if (!selectedAid.value) return;
  savingCred.value = true;
  const res = await api<any>('POST', '/cf-rules/credential', {
    aid: selectedAid.value,
    domain_id: selectedDomain.value,
    auth: credForm.auth,
    email: credForm.email,
    apikey: credForm.apikey,
    account_id: credForm.account_id,
  });
  savingCred.value = false;
  if (res.code === 0) {
    message.success(res.msg || t('cfRules.credSaved'));
    hasDedicated.value = true;
    showCred.value = false;
    await loadRules();
  } else {
    message.error(res.msg);
  }
}

async function removeCredential() {
  if (!selectedAid.value) return;
  const res = await api<any>('DELETE', `/cf-rules/credential?aid=${selectedAid.value}`);
  if (res.code === 0) {
    message.success(res.msg || t('cfRules.removed'));
    hasDedicated.value = false;
    credForm.apikey = '';
    showCred.value = false;
    await loadRules();
  } else {
    message.error(res.msg);
  }
}

onMounted(async () => {
  await loadPhases();
  await loadDomains();
  await loadRules();
});
</script>

<style scoped>
.mb-12 { margin-bottom: 12px; }
</style>