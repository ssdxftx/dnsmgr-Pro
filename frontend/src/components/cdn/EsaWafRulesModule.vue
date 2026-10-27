<template>
  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">
        {{ title }}
        <n-tag size="tiny" :bordered="false" class="tnum" style="margin-left: 6px">{{ rows.length }}</n-tag>
      </h3>
      <div class="app-panel__extra">
        <n-input
          v-model:value="keyword"
          size="small"
          clearable
          :placeholder="t('esaZone.wafSearchRules')"
          style="width: 200px"
        />
        <n-button size="small" :loading="loadBusy" :disabled="loadBusy" @click="load">{{ t('esaZone.reload') }}</n-button>
        <n-button size="small" type="primary" @click="openCreate">{{ t('esaZone.wafCreateRule') }}</n-button>
      </div>
    </div>
    <p class="hint-text mb-3">{{ desc }}</p>

    <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>

    <ResponsiveDataTable
      :columns="columns"
      :data="filteredRows"
      size="small"
      :loading="loadBusy"
      :empty-text="t('esaZone.wafNoRules')"
      :error="!!loadError"
      @retry="load"
    />
  </div>

  <n-modal
    v-model:show="showEditor"
    preset="card"
    :title="editingRow ? t('esaZone.wafEditRule') : t('esaZone.wafCreateRule')"
    class="modal-lg"
    :mask-closable="false"
  >
    <EsaWafRuleEditor
      v-if="showEditor"
      :aid="aid"
      :zone-id="zoneId"
      :phase="phase"
      :initial="editingRow"
      :editing="!!editingRow"
      :saving="saveBusy"
      :domains="domains"
      @submit="save"
      @cancel="showEditor = false"
    />
  </n-modal>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NInput, NTag, useDialog, useMessage } from 'naive-ui';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import EsaWafRuleEditor from './EsaWafRuleEditor.vue';
import {
  ESA_WAF_ACTIONS,
  ESA_WAF_SCAN_TYPES,
  esaWafPhaseLabel,
  type EsaWafPhase,
} from '../../lib/esaWafMeta';

const props = withDefaults(
  defineProps<{
    aid: number;
    zoneId: string;
    phase: EsaWafPhase;
    domains?: string[];
  }>(),
  { domains: () => [] },
);

const emit = defineEmits<{ (e: 'changed'): void }>();

const { t, locale } = useI18n();
const message = useMessage();
const dialog = useDialog();
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

const rows = ref<any[]>([]);
const loadBusy = ref(false);
const loadError = ref('');
const saveBusy = ref(false);
const showEditor = ref(false);
const editingRow = ref<any>(null);
const keyword = ref('');

const title = computed(() => esaWafPhaseLabel(props.phase, isZh.value));
const desc = computed(() => t(`esaZone.wafPhase_${props.phase}_desc`));

const filteredRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return rows.value;
  return rows.value.filter((r) => {
    const cfg = cfgOf(r);
    const name = r.Name || r.RuleName || cfg?.Name || '';
    return String(name).toLowerCase().includes(kw);
  });
});

function cfgOf(row: any): any {
  let cfg = row?.Config ?? row?.config;
  if (typeof cfg === 'string') {
    try {
      cfg = JSON.parse(cfg);
    } catch {
      cfg = null;
    }
  }
  return cfg && typeof cfg === 'object' ? cfg : {};
}

function actionLabel(value: string) {
  const meta = ESA_WAF_ACTIONS.find((a) => a.value === value);
  return meta ? (isZh.value ? meta.label.zh : meta.label.en) : value || '-';
}

function scanTypeLabel(value: string) {
  const meta = ESA_WAF_SCAN_TYPES.find((s) => s.value === value);
  return meta ? (isZh.value ? meta.label.zh : meta.label.en) : value || '-';
}

const columns = computed<any[]>(() => [
  {
    title: t('esaZone.ruleName'),
    key: 'Name',
    minWidth: 180,
    ellipsis: { tooltip: true },
    render: (row: any) => {
      const cfg = cfgOf(row);
      return h('div', { class: 'esa-waf__name' }, [
        h('span', { class: 'esa-waf__name-text' }, row.Name || row.RuleName || cfg?.Name || row.Id || '-'),
        h(NTag, { size: 'tiny', bordered: false, type: 'info' }, { default: () => `#${row.Id}` }),
      ]);
    },
  },
  {
    title: t('esaZone.status'),
    key: 'Status',
    width: 96,
    render: (row: any) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: row.Status === 'off' ? 'default' : 'success' },
        { default: () => (row.Status === 'off' ? t('esaZone.enableAction') : t('esaZone.disableAction')) },
      ),
  },
  {
    title: t('esaZone.wafRuleDetail'),
    key: 'detail',
    minWidth: 180,
    ellipsis: { tooltip: true },
    render: (row: any) => {
      const cfg = cfgOf(row);
      if (props.phase === 'http_ratelimit') {
        const rl = cfg.RateLimit || {};
        return `${actionLabel(cfg.Action)} · ${rl.Threshold?.Request ?? '-'} / ${rl.Interval ?? '-'}s · TTL ${rl.TTL ?? '-'}s`;
      }
      if (props.phase === 'http_whitelist') {
        const b = cfg.Actions?.Bypass || {};
        return b.Skip === 'part' ? `${t('esaZone.wafSkipPart')} · ${(b.Tags || []).join(', ')}` : t('esaZone.wafSkipAll');
      }
      if (props.phase === 'http_anti_scan') {
        return `${scanTypeLabel(cfg.Type)}${cfg.ManagedList ? ` · ${cfg.ManagedList}` : ''}`;
      }
      if (props.phase === 'ip_access_rule') {
        return `${cfg.Value || '-'} · ${actionLabel(cfg.Action)}`;
      }
      return actionLabel(cfg.Action);
    },
  },
  {
    title: t('esaZone.wafExpression'),
    key: 'Expression',
    minWidth: 220,
    ellipsis: { tooltip: true },
    render: (row: any) => {
      const cfg = cfgOf(row);
      const expr = cfg.Expression || row.Expression || 'true';
      return h('code', { class: 'app-mono esa-waf__expr' }, expr);
    },
  },
  {
    title: t('esaZone.actions'),
    key: 'actions',
    width: 190,
    render: (row: any) =>
      h('div', { class: 'row-actions' }, [
        props.phase === 'http_anti_scan'
          ? null
          : h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEdit(row) }, { default: () => t('esaZone.edit') }),
        props.phase === 'http_anti_scan'
          ? null
          : h(
              NButton,
              { size: 'tiny', quaternary: true, onClick: () => toggle(row) },
              { default: () => (row.Status === 'off' ? t('esaZone.wafEnable') : t('esaZone.wafDisable')) },
            ),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => remove(row) }, { default: () => t('esaZone.delete') }),
      ]),
  },
]);

async function call(action: string, params: Record<string, any> = {}) {
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
    action,
    zoneId: props.zoneId,
    params,
  });
  if (res.code !== 0) throw new Error(res.msg || t('esaZone.loadFailed'));
  return res.data;
}

async function load() {
  loadBusy.value = true;
  loadError.value = '';
  try {
    const data = await call('ListWafRules', { Phase: props.phase, PageNumber: 1, PageSize: 100 });
    rows.value = Array.isArray(data?.Rules) ? data.Rules : [];
  } catch (e: any) {
    loadError.value = e?.message || t('esaZone.loadFailed');
    rows.value = [];
  } finally {
    loadBusy.value = false;
  }
}

const rulesetCache = new Map<string, number>();

async function ensureRuleset(phase: string): Promise<number> {
  if (rulesetCache.has(phase)) return rulesetCache.get(phase)!;
  const data = await call('ListWafRulesets', { Phase: phase, PageNumber: 1, PageSize: 20 });
  const existing = Array.isArray(data?.Rulesets) ? data.Rulesets[0] : null;
  if (existing?.Id) {
    rulesetCache.set(phase, Number(existing.Id));
    return Number(existing.Id);
  }
  const created = await call('CreateWafRuleset', { Phase: phase, Name: `${phase}-ruleset` });
  const id = Number(created?.Id || created?.RulesetId || 0);
  if (id) rulesetCache.set(phase, id);
  return id;
}

function openCreate() {
  editingRow.value = null;
  showEditor.value = true;
}

function openEdit(row: any) {
  editingRow.value = row;
  showEditor.value = true;
}

async function save(payload: { config?: any; shared?: any; configs?: any[] }) {
  saveBusy.value = true;
  try {
    if (props.phase === 'http_anti_scan') {
      const rulesetId = await ensureRuleset(props.phase);
      await call('BatchCreateWafRules', {
        Phase: props.phase,
        ...(rulesetId ? { RulesetId: rulesetId } : {}),
        Shared: payload.shared,
        Configs: payload.configs || [],
      });
    } else if (editingRow.value) {
      await call('UpdateWafRule', {
        Id: editingRow.value.Id,
        Status: payload.config?.Status || 'on',
        Config: payload.config,
      });
    } else {
      const rulesetId = await ensureRuleset(props.phase);
      await call('CreateWafRule', {
        Phase: props.phase,
        ...(rulesetId ? { RulesetId: rulesetId } : {}),
        Config: payload.config,
      });
    }
    message.success(t('esaZone.saved'));
    showEditor.value = false;
    await load();
    emit('changed');
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  } finally {
    saveBusy.value = false;
  }
}

async function toggle(row: any) {
  const next = row.Status === 'off' ? 'on' : 'off';
  const cfg = { ...cfgOf(row), Status: next };
  try {
    await call('UpdateWafRule', { Id: row.Id, Status: next, Config: cfg });
    await load();
    emit('changed');
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  }
}

function remove(row: any) {
  const cfg = cfgOf(row);
  dialog.warning({
    title: t('esaZone.delete'),
    content: t('esaZone.deleteConfirm', { name: row.Name || cfg.Name || row.Id }),
    positiveText: t('esaZone.delete'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      try {
        await call('DeleteWafRule', { Id: row.Id });
        message.success(t('esaZone.deleted'));
        await load();
        emit('changed');
      } catch (e: any) {
        message.error(e?.message || t('esaZone.deleteFailed'));
      }
    },
  });
}

onMounted(load);

defineExpose({ load });
</script>

<style scoped>
.esa-waf__name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.esa-waf__name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.esa-waf__expr {
  font-size: 11.5px;
  color: var(--app-text-2);
}
</style>
