<template>
  <div class="esa-waf-editor">
    <n-form label-placement="left" label-width="140" size="small">
      <n-form-item :label="t('esaZone.ruleName')">
        <n-input v-model:value="form.name" :placeholder="t('esaZone.wafNamePlaceholder')" />
      </n-form-item>

      <n-form-item :label="t('esaZone.status')">
        <n-switch v-model:value="form.enabled" size="small" />
        <span class="esa-waf-editor__inline-hint">{{ form.enabled ? t('esaZone.enabled') : t('esaZone.disabled') }}</span>
      </n-form-item>

      <n-form-item v-if="phase !== 'ip_access_rule'" :label="t('esaZone.wafCondition')" :show-feedback="false">
        <EsaConditionBuilder v-model="form.expression" :domains="domains" :locale="isZh ? 'zh' : 'en'" />
      </n-form-item>

      <template v-if="phase === 'ip_access_rule'">
        <n-form-item :label="t('esaZone.wafIpValue')">
          <n-input v-model:value="form.ipValue" placeholder="1.2.3.4 / 10.0.0.0/8" />
        </n-form-item>
        <div class="esa-waf-editor__hint">{{ t('esaZone.wafIpValueHint') }}</div>
      </template>

      <n-form-item v-if="phase !== 'http_whitelist'" :label="t('esaZone.wafAction')">
        <EsaCardSelect
          v-model="form.action"
          :options="actionOptions"
          :unlisted-label="t('esaZone.wafUnlisted')"
          class="esa-waf-editor__select"
          compact
        />
      </n-form-item>

      <template v-if="phase === 'http_ratelimit'">
        <n-form-item :label="t('esaZone.wafRateKeys')">
          <EsaCardSelect v-model="form.rateKeys" :options="rateKeyOptions" multiple searchable clearable />
        </n-form-item>
        <div class="esa-waf-editor__hint">{{ t('esaZone.wafRateKeysHint') }}</div>
        <n-form-item
          v-for="key in rateKeysWithName"
          :key="key"
          :label="rateKeyLabel(key)"
        >
          <n-input v-model:value="form.rateKeyNames[key]" :placeholder="rateKeyNamePlaceholder(key)" />
        </n-form-item>
        <n-form-item :label="t('esaZone.wafRateLogic')">
          <n-radio-group v-model:value="form.rateLogic" size="small">
            <n-radio-button value="or">{{ t('esaZone.wafLogicOr') }}</n-radio-button>
            <n-radio-button value="and">{{ t('esaZone.wafLogicAnd') }}</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item :label="t('esaZone.wafRateInterval')">
          <EsaCardSelect v-model="form.interval" :options="intervalOptions" compact />
        </n-form-item>
        <n-form-item :label="t('esaZone.wafRateThreshold')">
          <n-input-number v-model:value="form.threshold" :min="1" :max="1000000" style="width: 200px" />
          <span class="esa-waf-editor__inline-hint">{{ t('esaZone.wafRateThresholdUnit') }}</span>
        </n-form-item>
        <n-form-item :label="t('esaZone.wafRateTtl')">
          <EsaCardSelect v-model="form.ttl" :options="ttlOptions" compact />
        </n-form-item>
        <n-form-item :label="t('esaZone.wafRateOnHit')">
          <n-switch v-model:value="form.onHit" size="small" />
          <span class="esa-waf-editor__inline-hint">{{ t('esaZone.wafRateOnHitHint') }}</span>
        </n-form-item>
      </template>

      <template v-if="phase === 'http_whitelist'">
        <n-form-item :label="t('esaZone.wafSkip')">
          <n-radio-group v-model:value="form.skip" size="small">
            <n-radio-button value="all">{{ t('esaZone.wafSkipAll') }}</n-radio-button>
            <n-radio-button value="part">{{ t('esaZone.wafSkipPart') }}</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="form.skip === 'part'" :label="t('esaZone.wafSkipTags')">
          <EsaCardSelect v-model="form.tags" :options="tagOptions" multiple searchable clearable />
        </n-form-item>
      </template>

      <template v-if="phase === 'http_anti_scan'">
        <n-form-item :label="t('esaZone.wafScanType')">
          <EsaCardSelect
            v-model="form.scanType"
            :options="scanTypeOptions"
            :unlisted-label="t('esaZone.wafUnlisted')"
            class="esa-waf-editor__select"
            compact
          />
        </n-form-item>
        <n-form-item v-if="form.scanType === 'http_scan_tools'" :label="t('esaZone.wafManagedList')">
          <n-input v-model:value="form.managedList" placeholder="intelligence_scan_tools" />
        </n-form-item>
        <template v-else>
          <n-form-item :label="t('esaZone.wafRateInterval')">
            <EsaCardSelect v-model="form.interval" :options="intervalOptions" compact />
          </n-form-item>
          <n-form-item :label="t('esaZone.wafRateThreshold')">
            <n-input-number v-model:value="form.threshold" :min="1" :max="1000000" style="width: 200px" />
          </n-form-item>
          <n-form-item :label="t('esaZone.wafScanResponse')">
            <n-input-number v-model:value="form.responseCode" :min="100" :max="599" style="width: 120px" />
            <span class="esa-waf-editor__inline-hint">{{ t('esaZone.wafScanRatio') }}</span>
            <n-input-number v-model:value="form.responseRatio" :min="1" :max="100" style="width: 100px" />
            <span class="esa-waf-editor__inline-hint">% · {{ t('esaZone.wafScanCount') }}</span>
            <n-input-number v-model:value="form.responseCount" :min="1" :max="1000000" style="width: 120px" />
          </n-form-item>
          <n-form-item :label="t('esaZone.wafRateTtl')">
            <EsaCardSelect v-model="form.ttl" :options="ttlOptions" compact />
          </n-form-item>
        </template>
      </template>

      <n-form-item :label="t('esaZone.wafNotes')">
        <n-input v-model:value="form.notes" :placeholder="t('esaZone.wafNotesHint')" />
      </n-form-item>
    </n-form>

    <div class="esa-waf-editor__preview">
      <div class="esa-waf-editor__preview-head">
        <span>{{ t('esaZone.wafConfigPreview') }}</span>
        <n-button size="tiny" quaternary @click="rawMode = !rawMode">
          {{ rawMode ? t('esaZone.wafUseVisual') : t('esaZone.wafUseRaw') }}
        </n-button>
      </div>
      <n-input
        v-if="rawMode"
        v-model:value="rawText"
        type="textarea"
        :rows="12"
        class="mono-input"
        spellcheck="false"
      />
      <pre v-else class="esa-waf-editor__preview-code">{{ prettyConfig }}</pre>
    </div>

    <div class="esa-waf-editor__footer">
      <n-button @click="emit('cancel')">{{ t('esaZone.cancel') }}</n-button>
      <n-button type="primary" :loading="saving" :disabled="saving" @click="submit">{{ t('esaZone.save') }}</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NForm, NFormItem, NInput, NInputNumber, NRadioButton, NRadioGroup, NSwitch, useMessage } from 'naive-ui';
import EsaCardSelect, { type EsaCardOption } from './EsaCardSelect.vue';
import EsaConditionBuilder from './EsaConditionBuilder.vue';
import {
  ESA_WAF_ACTIONS,
  ESA_WAF_BYPASS_TAGS,
  ESA_WAF_RATE_INTERVALS,
  ESA_WAF_RATE_KEYS,
  ESA_WAF_RATE_TTLS,
  ESA_WAF_SCAN_TYPES,
  esaWafActionsForPhase,
  type EsaWafPhase,
} from '../../lib/esaWafMeta';

const props = withDefaults(
  defineProps<{
    aid: number;
    zoneId: string;
    phase: EsaWafPhase;
    initial?: any;
    editing?: boolean;
    saving?: boolean;
    domains?: string[];
  }>(),
  { initial: null, editing: false, saving: false, domains: () => [] },
);

const emit = defineEmits<{
  (e: 'submit', payload: { config?: any; shared?: any; configs?: any[] }): void;
  (e: 'cancel'): void;
}>();

const { t, locale } = useI18n();
const message = useMessage();
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

const form = reactive({
  name: '',
  enabled: true,
  expression: 'true',
  action: 'deny',
  notes: '',
  rateKeys: ['ip.src'],
  rateKeyNames: {} as Record<string, string>,
  rateLogic: 'or',
  interval: 60,
  threshold: 100,
  ttl: 60,
  onHit: false,
  skip: 'all',
  tags: [] as string[],
  ipValue: '',
  scanType: 'http_scan_tools',
  managedList: 'intelligence_scan_tools',
  responseCode: 404,
  responseRatio: 70,
  responseCount: 80,
});

const rawMode = ref(false);
const rawText = ref('');

function normalizeConfig(initial: any): any {
  if (!initial) return null;
  let cfg = initial.Config ?? initial.config ?? initial;
  if (typeof cfg === 'string') {
    try {
      cfg = JSON.parse(cfg);
    } catch {
      return null;
    }
  }
  return cfg && typeof cfg === 'object' ? cfg : null;
}

function init() {
  const cfg = normalizeConfig(props.initial);
  const row = props.initial || {};
  form.name = cfg?.Name || row.Name || row.RuleName || '';
  form.enabled = String(cfg?.Status ?? row.Status ?? 'on') !== 'off';
  form.expression = cfg?.Expression || 'true';
  form.action = cfg?.Action || 'deny';
  form.notes = cfg?.Notes || '';

  form.rateKeys = (cfg?.RateLimit?.Characteristics?.Criteria || []).map((c: any) => c.MatchType).filter(Boolean);
  if (!form.rateKeys.length) form.rateKeys = ['ip.src'];
  form.rateKeyNames = {};
  for (const c of cfg?.RateLimit?.Characteristics?.Criteria || []) {
    if (c.MatchType && c.MatchValue) form.rateKeyNames[c.MatchType] = String(c.MatchValue);
  }
  form.rateLogic = cfg?.RateLimit?.Characteristics?.Logic || 'or';
  form.interval = Number(cfg?.RateLimit?.Interval || 60);
  form.threshold = Number(cfg?.RateLimit?.Threshold?.Request || 100);
  form.ttl = Number(cfg?.RateLimit?.TTL || 60);
  form.onHit = Boolean(cfg?.RateLimit?.OnHit);

  form.skip = cfg?.Actions?.Bypass?.Skip || 'all';
  form.tags = Array.isArray(cfg?.Actions?.Bypass?.Tags) ? [...cfg.Actions.Bypass.Tags] : [];

  form.ipValue = cfg?.Value || '';
  form.scanType = cfg?.Type === 'http_directory_traversal' ? 'http_directory_traversal' : 'http_scan_tools';
  form.managedList = cfg?.ManagedList || 'intelligence_scan_tools';
  form.responseCode = Number(cfg?.RateLimit?.Threshold?.ResponseStatus?.Code || 404);
  form.responseRatio = Number(cfg?.RateLimit?.Threshold?.ResponseStatus?.Ratio || 70);
  form.responseCount = Number(cfg?.RateLimit?.Threshold?.ResponseStatus?.Count || 80);

  rawMode.value = false;
  rawText.value = '';
}
init();
watch(() => props.initial, init);

const actionOptions = computed<EsaCardOption[]>(() =>
  esaWafActionsForPhase(props.phase).map((a) => ({
    value: a.value,
    label: isZh.value ? a.label.zh : a.label.en,
    desc: (a.gate !== 'free' ? `【${a.gate.toUpperCase()}】` : '') + (isZh.value ? a.desc.zh : a.desc.en),
  })),
);
const scanTypeOptions = computed<EsaCardOption[]>(() =>
  ESA_WAF_SCAN_TYPES.map((s) => ({
    value: s.value,
    label: isZh.value ? s.label.zh : s.label.en,
    desc: isZh.value ? s.desc.zh : s.desc.en,
  })),
);

const rateKeyOptions = computed(() =>
  ESA_WAF_RATE_KEYS.map((k) => ({
    label: isZh.value ? k.label.zh : k.label.en,
    value: k.value,
    desc: isZh.value ? k.desc.zh : k.desc.en,
  })),
);
const intervalOptions = computed(() =>
  ESA_WAF_RATE_INTERVALS.map((o) => ({
    label: isZh.value ? o.label.zh : o.label.en,
    value: o.value,
    desc: isZh.value ? o.desc.zh : o.desc.en,
  })),
);
const ttlOptions = computed(() =>
  ESA_WAF_RATE_TTLS.map((o) => ({
    label: isZh.value ? o.label.zh : o.label.en,
    value: o.value,
    desc: isZh.value ? o.desc.zh : o.desc.en,
  })),
);
const tagOptions = computed(() =>
  ESA_WAF_BYPASS_TAGS.map((o) => ({
    label: isZh.value ? o.label.zh : o.label.en,
    value: o.value,
    desc: isZh.value ? o.desc.zh : o.desc.en,
  })),
);

const rateKeysWithName = computed(() =>
  form.rateKeys.filter((k) => ['http.request.headers', 'http.request.uri.args', 'http.cookie'].includes(k)),
);

function rateKeyLabel(key: string) {
  const meta = ESA_WAF_RATE_KEYS.find((k) => k.value === key);
  const name = meta ? (isZh.value ? meta.label.zh : meta.label.en) : key;
  return `${name} · ${t('esaZone.wafRateKeyName')}`;
}
function rateKeyNamePlaceholder(key: string) {
  if (key === 'http.cookie') return t('esaZone.wafCookieName');
  if (key === 'http.request.uri.args') return t('esaZone.wafArgName');
  return t('esaZone.wafHeaderName');
}

function criteria() {
  return form.rateKeys.map((key) => {
    const name = form.rateKeyNames[key];
    return name ? { MatchType: key, MatchValue: name } : { MatchType: key };
  });
}

const builtConfig = computed<any>(() => {
  const status = form.enabled ? 'on' : 'off';
  const base: any = { Name: form.name.trim(), Status: status, Notes: form.notes || undefined };
  if (props.phase === 'http_custom') {
    return { ...base, Type: 'http_custom', Expression: form.expression || 'true', Action: form.action };
  }
  if (props.phase === 'http_ratelimit') {
    return {
      ...base,
      Type: 'http_ratelimit',
      Expression: form.expression || 'true',
      Action: form.action,
      RateLimit: {
        Characteristics: { Logic: form.rateLogic, Criteria: criteria() },
        Interval: form.interval,
        TTL: form.ttl,
        Threshold: { Request: form.threshold },
        OnHit: form.onHit,
      },
    };
  }
  if (props.phase === 'http_whitelist') {
    return {
      ...base,
      Type: 'http_whitelist',
      Expression: form.expression || 'true',
      Actions: { Bypass: { Skip: form.skip, ...(form.skip === 'part' ? { Tags: form.tags } : {}) } },
    };
  }
  if (props.phase === 'ip_access_rule') {
    const value = form.ipValue.trim();
    return {
      ...base,
      Type: 'ip',
      Value: value,
      Action: form.action,
      Expression: value ? `(ip.src in {${JSON.stringify(value)}})` : undefined,
    };
  }
  if (props.phase === 'http_anti_scan') {
    const scan: any = { Type: form.scanType, Status: status };
    if (form.scanType === 'http_scan_tools') scan.ManagedList = form.managedList;
    else {
      scan.RateLimit = {
        Characteristics: { Logic: 'and', Criteria: [{ MatchType: 'ip.src' }] },
        Interval: form.interval,
        TTL: form.ttl,
        Threshold: {
          Request: form.threshold,
          ResponseStatus: { Code: form.responseCode, Ratio: form.responseRatio, Count: form.responseCount },
        },
      };
    }
    return { shared: { Name: form.name.trim(), Action: form.action, Expression: form.expression || 'true' }, configs: [scan] };
  }
  return base;
});

const prettyConfig = computed(() => JSON.stringify(builtConfig.value, null, 2));

watch(
  prettyConfig,
  (v) => {
    if (!rawMode.value) rawText.value = v;
  },
  { immediate: true },
);
watch(rawMode, (v) => {
  if (v) rawText.value = prettyConfig.value;
});

function submit() {
  if (!form.name.trim()) {
    message.warning(t('esaZone.wafNeedName'));
    return;
  }
  if (props.phase === 'ip_access_rule' && !form.ipValue.trim()) {
    message.warning(t('esaZone.wafNeedIp'));
    return;
  }
  if (props.phase === 'http_whitelist' && form.skip === 'part' && !form.tags.length) {
    message.warning(t('esaZone.wafNeedTags'));
    return;
  }
  if (rawMode.value) {
    try {
      const parsed = JSON.parse(rawText.value || '{}');
      if (props.phase === 'http_anti_scan') emit('submit', { shared: parsed.shared, configs: parsed.configs || [] });
      else emit('submit', { config: parsed });
    } catch {
      message.warning(t('esaZone.invalidJson'));
    }
    return;
  }
  const built = builtConfig.value;
  if (props.phase === 'http_anti_scan') emit('submit', { shared: built.shared, configs: built.configs });
  else emit('submit', { config: built });
}

defineExpose({ submit });
</script>

<style scoped>
.esa-waf-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.esa-waf-editor__select {
  width: min(420px, 100%);
}
.esa-waf-editor__inline-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--app-text-3);
}
.esa-waf-editor__hint {
  margin: -8px 0 8px;
  font-size: 11.5px;
  color: var(--app-text-3);
}
.esa-waf-editor__preview {
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-soft);
  padding: 8px 10px;
}
.esa-waf-editor__preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-3);
  margin-bottom: 6px;
}
.esa-waf-editor__preview-code {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  font-family: var(--app-font-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--app-text-1);
  white-space: pre-wrap;
  word-break: break-word;
}
.esa-waf-editor__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
