<template>
  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">{{ title || t('esaZone.rulesTitle') }}</h3>
      <div class="app-panel__extra">
        <n-button size="small" :loading="ruleLoadBusy" :disabled="ruleLoadBusy" @click="loadRules">{{ t('esaZone.reload') }}</n-button>
        <n-button size="small" type="primary" @click="onlyKind ? openRuleEditor(null) : (showKindPicker = true)">{{ t('esaZone.createRule') }}</n-button>
      </div>
    </div>

    <div v-if="!onlyKind" class="esa-rules__cats">
      <button
        v-for="cat in ESA_RULE_CATEGORIES"
        :key="cat.key"
        type="button"
        class="esa-rules__cat"
        :class="{ 'esa-rules__cat--active': esaCategory === cat.key }"
        :title="esaCatDesc(cat)"
        @click="selectEsaCategory(cat.key)"
      >
        <span class="esa-rules__cat-title">{{ esaCatLabel(cat) }}</span>
        <span class="esa-rules__cat-desc">{{ esaCatDesc(cat) }}</span>
      </button>
    </div>

    <div v-if="!onlyKind" class="esa-rules__kinds">
      <button
        v-for="k in esaKindsOfCategory(esaCategory)"
        :key="k.kind"
        type="button"
        class="esa-rules__kind"
        :class="{ 'esa-rules__kind--active': ruleKind === k.kind }"
        @click="selectEsaKind(k.kind)"
      >
        <span class="esa-rules__kind-title">{{ esaKindLabel(k) }}</span>
        <span class="esa-rules__kind-desc">{{ esaKindDesc(k) }}</span>
        <code class="esa-rules__kind-code">{{ k.kind }}</code>
      </button>
    </div>

    <div class="esa-rules__current">
      <span>{{ t('esaZone.ruleKind') }}：</span>
      <n-tag size="small" :bordered="false" type="info">{{ kindLabel(ruleKind) }}</n-tag>
    </div>

    <n-alert v-if="ruleLoadError" type="error" :show-icon="false" class="mb-3">{{ ruleLoadError }}</n-alert>

    <ResponsiveDataTable
      :columns="ruleColumns"
      :data="ruleList"
      size="small"
      :loading="ruleLoadBusy"
      :empty-text="t('esaZone.empty')"
      :error="!!ruleLoadError"
      @retry="loadRules"
    />
  </div>

  <EsaRuleKindPicker v-if="!onlyKind" v-model:show="showKindPicker" :locale="isZhLocale ? 'zh' : 'en'" @select="onPickEsaKind" />

  <n-modal
    v-model:show="showRuleEditor"
    preset="card"
    :title="ruleEditingId ? t('esaZone.editRule') : t('esaZone.createRule')"
    class="modal-lg"
    :mask-closable="false"
  >
    <RuleEditor
      v-if="showRuleEditor"
      vendor="esa"
      :kind="ruleKind"
      :schema="ruleSchema"
      :initial="ruleInitial"
      :editing="!!ruleEditingId"
      :saving="ruleSaveBusy"
      :domains="domains"
      @save="saveRule"
      @cancel="showRuleEditor = false"
    />
  </n-modal>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialog, useMessage, NButton, NTag } from 'naive-ui';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import RuleEditor from './RuleEditor.vue';
import EsaRuleKindPicker from './EsaRuleKindPicker.vue';
import { useAction } from '../../composables/useAction';
import { ruleEnabled } from '../../lib/cdnSwitch';
import {
  ESA_RULE_CATEGORIES,
  esaKindsOfCategory,
  esaKindMeta,
  type EsaRuleCategory,
  type EsaRuleKindMeta,
} from '../../lib/esaRuleMeta';

const props = defineProps<{ aid: number; zoneId: string; domains: string[]; onlyKind?: string; title?: string }>();

const { t, locale } = useI18n();
const message = useMessage();
const dialog = useDialog();
const { busy, run } = useAction();

const ruleList = ref<any[]>([]);
const ruleLoadBusy = ref(false);
const ruleLoadError = ref('');
const ruleSaveBusy = ref(false);
const ruleKind = ref(props.onlyKind || 'RedirectRule');
const ruleSchema = ref<any>(null);
const showRuleEditor = ref(false);
const ruleEditingId = ref('');
const ruleInitial = ref<any>(null);
const esaCategory = ref(esaKindMeta(props.onlyKind || 'RedirectRule')?.category || 'https');
const showKindPicker = ref(false);

const isZhLocale = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

function esaCatLabel(cat: EsaRuleCategory) {
  return isZhLocale.value ? cat.label.zh : cat.label.en;
}
function esaCatDesc(cat: EsaRuleCategory) {
  return isZhLocale.value ? cat.desc.zh : cat.desc.en;
}
function esaKindLabel(k: EsaRuleKindMeta) {
  return isZhLocale.value ? k.label.zh : k.label.en;
}
function esaKindDesc(k: EsaRuleKindMeta) {
  return isZhLocale.value ? k.desc.zh : k.desc.en;
}
function kindLabel(kind: string) {
  const meta = esaKindMeta(kind);
  if (meta) return isZhLocale.value ? meta.label.zh : meta.label.en;
  return kind;
}

function selectEsaCategory(key: string) {
  esaCategory.value = key;
  const first = esaKindsOfCategory(key)[0];
  if (first) selectEsaKind(first.kind);
}

function selectEsaKind(kind: string) {
  ruleKind.value = kind;
  loadRules();
}

function onPickEsaKind(kind: string) {
  const meta = esaKindMeta(kind);
  if (meta) esaCategory.value = meta.category;
  ruleKind.value = kind;
  showKindPicker.value = false;
  loadRuleSchemaForKind().then(() => {
    loadRules();
    openRuleEditor(null);
  });
}

async function loadRuleSchemaForKind() {
  const res = await api<any>('GET', `/cdn/accounts/${props.aid}/rule-schema`, { kind: ruleKind.value });
  if (res.code === 0) ruleSchema.value = res.data;
}

async function loadRules(): Promise<boolean> {
  ruleLoadBusy.value = true;
  ruleLoadError.value = '';
  let ok = true;
  try {
    await loadRuleSchemaForKind();
    const all: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await api<any>('GET', `/cdn/accounts/${props.aid}/rule-configs`, {
        zoneId: props.zoneId,
        kind: ruleKind.value,
        page,
        size: 100,
      });
      if (res.code !== 0) {
        ok = false;
        ruleLoadError.value = res.msg || t('esaZone.loadFailed');
        break;
      }
      const list = res.data?.list || [];
      all.push(...list);
      const total = Number(res.data?.total || 0);
      if (list.length < 100 || all.length >= total) break;
    }
    ruleList.value = all;
  } catch (e: any) {
    ok = false;
    ruleLoadError.value = e?.message || t('esaZone.loadFailed');
    ruleList.value = [];
  } finally {
    ruleLoadBusy.value = false;
  }
  return ok;
}

const ruleColumns = computed(() => [
  { title: t('esaZone.ruleName'), key: 'ruleName', minWidth: 200 },
  { title: t('esaZone.ruleKind'), key: 'kind', width: 160, render: () => kindLabel(ruleKind.value) },
  {
    title: t('esaZone.ruleStatus'),
    key: 'enabled',
    width: 110,
    render: (r: any) =>
      h(NTag, { size: 'small', type: ruleEnabled(r) ? 'success' : 'default', bordered: false }, {
        default: () => (ruleEnabled(r) ? t('esaZone.enabled') : t('esaZone.disabled')),
      }),
  },
  {
    title: t('esaZone.actions'),
    key: 'actions',
    width: 200,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openRuleEditor(r) }, { default: () => t('esaZone.edit') }),
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            loading: !!busy[`rule:${r.ruleId || r.ruleName}`],
            disabled: !!busy[`rule:${r.ruleId || r.ruleName}`],
            onClick: () => run(`rule:${r.ruleId || r.ruleName}`, () => toggleRuleEnabled(r)),
          },
          { default: () => (ruleEnabled(r) ? t('esaZone.disabled') : t('esaZone.enabled')) },
        ),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delRule(r) }, { default: () => t('esaZone.delete') }),
      ]),
  },
]);

function openRuleEditor(row: any) {
  ruleEditingId.value = row ? String(row.ruleId || row.configId || '') : '';
  ruleInitial.value = row
    ? Array.isArray(row.rules) && row.rules.length
      ? row.rules[0]
      : row
    : { RuleEnable: 'on' };
  showRuleEditor.value = true;
}

async function saveRule(payload: any) {
  if (!payload.RuleName) return message.warning(t('esaZone.needRuleName'));
  if (Array.isArray(ruleSchema.value?.fields)) {
    const missing = ruleSchema.value.fields
      .filter((f: any) => f.required && f.group !== 'common')
      .filter((f: any) => payload[f.name] === undefined || payload[f.name] === null || payload[f.name] === '')
      .map((f: any) => f.label || f.name);
    if (missing.length) return message.warning(t('esaZone.requiredMissing', { fields: missing.join(', ') }));
  }
  ruleSaveBusy.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/rule-configs`, {
      zoneId: props.zoneId,
      kind: ruleKind.value,
      params: payload,
    });
    if (res.code === 0) {
      message.success(res.msg || t('esaZone.saved'));
      showRuleEditor.value = false;
      loadRules();
    } else message.error(res.msg);
  } finally {
    ruleSaveBusy.value = false;
  }
}

async function toggleRuleEnabled(row: any) {
  const next = !ruleEnabled(row);
  const base = Array.isArray(row.rules) && row.rules.length ? { ...row.rules[0] } : {};
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/rule-configs`, {
    zoneId: props.zoneId,
    kind: ruleKind.value,
    params: { ...base, RuleName: row.ruleName, RuleEnable: next ? 'on' : 'off' },
  });
  if (res.code === 0) loadRules();
  else message.error(res.msg || t('esaZone.saveFailed'));
}

function delRule(row: any) {
  dialog.warning({
    title: t('esaZone.delete'),
    content: t('esaZone.deleteConfirm', { name: row.ruleName || '' }),
    positiveText: t('esaZone.delete'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      const res = await api<any>('DELETE', `/cdn/accounts/${props.aid}/rule-configs/${encodeURIComponent(String(row.configId))}`, {
        zoneId: props.zoneId,
        kind: ruleKind.value,
      });
      if (res.code === 0) {
        message.success(res.msg);
        loadRules();
      } else message.error(res.msg);
    },
  });
}

onMounted(loadRules);

function selectCategory(key: string) {
  if (ESA_RULE_CATEGORIES.some((c) => c.key === key)) selectEsaCategory(key);
}

defineExpose({ load: loadRules, selectCategory });
</script>

<style scoped>
.esa-rules__cats {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  margin-bottom: 12px;
}
.esa-rules__cat {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.18s var(--app-ease), background 0.18s var(--app-ease);
}
.esa-rules__cat:hover {
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
}
.esa-rules__cat--active {
  border-color: color-mix(in srgb, var(--app-primary) 55%, var(--app-border));
  background: color-mix(in srgb, var(--app-primary) 8%, var(--app-surface));
}
.esa-rules__cat-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--app-text-1);
  white-space: nowrap;
}
.esa-rules__cat-desc {
  max-width: 220px;
  font-size: 11px;
  color: var(--app-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.esa-rules__kinds {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.esa-rules__kind {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: flex-start;
  text-align: left;
  padding: 12px 13px 10px 16px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.18s var(--app-ease), border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.esa-rules__kind::before {
  content: '';
  position: absolute;
  left: 0;
  top: 11px;
  bottom: 11px;
  width: 3px;
  border-radius: 3px;
  background: var(--app-primary);
  opacity: 0;
  transition: opacity 0.18s var(--app-ease);
}
.esa-rules__kind:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.esa-rules__kind:hover::before,
.esa-rules__kind--active::before {
  opacity: 1;
}
.esa-rules__kind--active {
  border-color: color-mix(in srgb, var(--app-primary) 55%, var(--app-border));
  background: color-mix(in srgb, var(--app-primary) 6%, var(--app-surface));
}
.esa-rules__kind-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-rules__kind-desc {
  font-size: 12px;
  line-height: 1.55;
  color: var(--app-text-2);
}
.esa-rules__kind-code {
  font-family: var(--app-font-mono);
  font-size: 10.5px;
  color: var(--app-text-3);
}
.esa-rules__current {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--app-text-3);
}
</style>
