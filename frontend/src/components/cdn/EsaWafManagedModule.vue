<template>
  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">{{ t('esaZone.wafManagedTitle') }}</h3>
      <div class="app-panel__extra">
        <n-button size="small" :loading="loadBusy" :disabled="loadBusy" @click="load">{{ t('esaZone.reload') }}</n-button>
      </div>
    </div>
    <p class="hint-text mb-3">{{ t('esaZone.wafManagedDesc') }}</p>

    <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>

    <ResponsiveDataTable
      :columns="columns"
      :data="rows"
      size="small"
      :loading="loadBusy"
      :empty-text="t('esaZone.empty')"
      :error="!!loadError"
      @retry="load"
    />
  </div>

  <n-modal
    v-model:show="showEditor"
    preset="card"
    :title="t('esaZone.wafManagedConfigure')"
    class="modal-md"
    :mask-closable="false"
  >
    <div v-if="editingType" class="esa-waf-managed__editor">
      <div class="esa-waf-managed__target">
        <span>{{ t('esaZone.wafAttackType') }}</span>
        <strong>{{ editingType.label }}</strong>
        <n-tag size="tiny" :bordered="false" type="info">#{{ editingType.value }}</n-tag>
      </div>

      <n-form label-placement="left" label-width="140" size="small">
        <n-form-item :label="t('esaZone.wafProtectionLevel')">
          <EsaCardSelect
            :model-value="String(form.level)"
            :options="levelOptions"
            :unlisted-label="t('esaZone.wafUnlisted')"
            class="esa-waf-managed__select"
            compact
            @update:model-value="(v: string) => (form.level = Number(v))"
          />
        </n-form-item>
        <n-form-item v-if="form.level > 0" :label="t('esaZone.wafAction')">
          <EsaCardSelect
            v-model="form.action"
            :options="actionOptions"
            :unlisted-label="t('esaZone.wafUnlisted')"
            class="esa-waf-managed__select"
            compact
          />
        </n-form-item>
        <n-form-item :label="t('esaZone.wafRuleCount')">
          <span class="tnum">{{ editingCount }}</span>
        </n-form-item>
      </n-form>

      <div class="esa-waf-managed__hint">{{ t('esaZone.wafManagedHint') }}</div>
    </div>

    <template #footer>
      <n-space justify="end">
        <n-button @click="showEditor = false">{{ t('esaZone.cancel') }}</n-button>
        <n-button type="primary" :loading="saveBusy" :disabled="saveBusy" @click="save">{{ t('esaZone.save') }}</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NForm, NFormItem, NSpace, NTag, useMessage } from 'naive-ui';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import EsaCardSelect, { type EsaCardOption } from './EsaCardSelect.vue';
import {
  ESA_WAF_ACTIONS,
  ESA_WAF_ATTACK_TYPES,
  ESA_WAF_PROTECTION_LEVELS,
  type EsaWafOption,
} from '../../lib/esaWafMeta';

const props = defineProps<{ aid: number; zoneId: string }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { t, locale } = useI18n();
const message = useMessage();
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

const rows = ref<any[]>([]);
const loadBusy = ref(false);
const loadError = ref('');
const saveBusy = ref(false);
const showEditor = ref(false);
const editingType = ref<EsaWafOption<number> | null>(null);
const editingCount = ref(0);
const existingRule = ref<any>(null);
const form = reactive({ level: 2, action: 'deny' });

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

function managedList(cfg: any): any[] {
  const list = cfg?.ManagedRulesets;
  if (Array.isArray(list)) return list;
  if (list && typeof list === 'object') return [list];
  return [];
}

const columns = computed<any[]>(() => [
  {
    title: t('esaZone.wafAttackType'),
    key: 'attackType',
    minWidth: 200,
    render: (row: any) =>
      h('div', { class: 'esa-waf-managed__name' }, [
        h('span', null, isZh.value ? row.meta.label.zh : row.meta.label.en),
        h(NTag, { size: 'tiny', bordered: false, type: 'info' }, { default: () => `#${row.meta.value}` }),
      ]),
  },
  {
    title: t('esaZone.wafProtectionLevel'),
    key: 'level',
    width: 120,
    render: (row: any) => {
      const level = ESA_WAF_PROTECTION_LEVELS.find((l) => l.value === row.level);
      return h(
        NTag,
        { size: 'small', bordered: false, type: row.level > 0 ? (row.level >= 3 ? 'warning' : 'success') : 'default' },
        { default: () => (level ? (isZh.value ? level.label.zh : level.label.en) : t('esaZone.wafLevelOff')) },
      );
    },
  },
  {
    title: t('esaZone.wafAction'),
    key: 'action',
    width: 120,
    render: (row: any) => (row.level > 0 ? actionLabel(row.action) : '-'),
  },
  {
    title: t('esaZone.wafRuleCount'),
    key: 'count',
    width: 120,
    render: (row: any) => h('span', { class: 'tnum' }, row.count == null ? '-' : String(row.count)),
  },
  {
    title: t('esaZone.status'),
    key: 'configured',
    width: 110,
    render: (row: any) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: row.configured ? 'success' : 'default' },
        { default: () => (row.configured ? t('esaZone.wafConfigured') : t('esaZone.wafNotConfigured')) },
      ),
  },
  {
    title: t('esaZone.actions'),
    key: 'actions',
    width: 120,
    render: (row: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEditor(row) }, { default: () => t('esaZone.wafManagedConfigure') }),
      ]),
  },
]);

function actionLabel(value: string) {
  const meta = ESA_WAF_ACTIONS.find((a) => a.value === value);
  return meta ? (isZh.value ? meta.label.zh : meta.label.en) : value || '-';
}

const levelOptions = computed<EsaCardOption[]>(() =>
  ESA_WAF_PROTECTION_LEVELS.map((l) => ({
    value: String(l.value),
    label: isZh.value ? l.label.zh : l.label.en,
    desc: isZh.value ? l.desc.zh : l.desc.en,
  })),
);
const actionOptions = computed<EsaCardOption[]>(() =>
  ESA_WAF_ACTIONS.filter((a) => a.value === 'deny' || a.value === 'monitor' || a.value === 'js' || a.value === 'captcha').map((a) => ({
    value: a.value,
    label: isZh.value ? a.label.zh : a.label.en,
    desc: isZh.value ? a.desc.zh : a.desc.en,
  })),
);
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
    const [rulesRes, ...countRes] = await Promise.all([
      call('ListWafRules', { Phase: 'http_managed', PageNumber: 1, PageSize: 100 }),
      ...ESA_WAF_ATTACK_TYPES.map((type) =>
        call('ListWafManagedRules', { AttackType: type.value, PageNumber: 1, PageSize: 1 }).catch(() => null),
      ),
    ]);
    const rules = Array.isArray(rulesRes?.Rules) ? rulesRes.Rules : [];
    const byType = new Map<number, any>();
    for (const rule of rules) {
      for (const set of managedList(cfgOf(rule))) {
        const type = Number(set.AttackType);
        if (type) byType.set(type, { rule, set });
      }
    }
    rows.value = ESA_WAF_ATTACK_TYPES.map((meta, i) => {
      const hit = byType.get(meta.value);
      const countData = countRes[i];
      return {
        meta,
        rule: hit?.rule || null,
        level: hit ? Number(hit.set.ProtectionLevel ?? 0) : 0,
        action: hit?.set?.Action || 'deny',
        configured: !!hit,
        count: countData ? Number(countData.TotalCount ?? (countData.Rules || []).length ?? 0) : null,
      };
    });
  } catch (e: any) {
    loadError.value = e?.message || t('esaZone.loadFailed');
    rows.value = [];
  } finally {
    loadBusy.value = false;
  }
}

function openEditor(row: any) {
  editingType.value = row.meta;
  editingCount.value = row.count ?? 0;
  existingRule.value = row.rule;
  form.level = row.level || 2;
  form.action = row.action || 'deny';
  showEditor.value = true;
}

async function ensureRuleset(): Promise<number> {
  const data = await call('ListWafRulesets', { Phase: 'http_managed', PageNumber: 1, PageSize: 20 });
  const existing = Array.isArray(data?.Rulesets) ? data.Rulesets[0] : null;
  if (existing?.Id) return Number(existing.Id);
  const created = await call('CreateWafRuleset', { Phase: 'http_managed', Name: 'http_managed-ruleset' });
  return Number(created?.Id || created?.RulesetId || 0);
}

async function save() {
  if (!editingType.value) return;
  saveBusy.value = true;
  try {
    const type = editingType.value.value;
    const nextSet = {
      AttackType: type,
      ProtectionLevel: form.level,
      ...(form.level > 0 ? { Action: form.action } : {}),
    };
    const oldCfg = cfgOf(existingRule.value);
    const otherSets = existingRule.value ? managedList(oldCfg).filter((s) => Number(s.AttackType) !== type) : [];
    const sets = [...otherSets, nextSet];
    const status = sets.some((s) => Number(s.ProtectionLevel) > 0) ? 'on' : 'off';
    const config = {
      Name: oldCfg.Name || `managed-${type}`,
      Status: status,
      Type: 'http_managed',
      Expression: oldCfg.Expression || 'true',
      ManagedRulesets: sets,
    };
    if (existingRule.value) {
      await call('UpdateWafRule', { Id: existingRule.value.Id, Status: status, Config: config });
    } else {
      const rulesetId = await ensureRuleset();
      await call('CreateWafRule', {
        Phase: 'http_managed',
        ...(rulesetId ? { RulesetId: rulesetId } : {}),
        Config: config,
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

onMounted(load);

defineExpose({ load });
</script>

<style scoped>
.esa-waf-managed__name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.esa-waf-managed__editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.esa-waf-managed__target {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-soft);
  font-size: 13px;
}
.esa-waf-managed__select {
  width: min(420px, 100%);
}
.esa-waf-managed__hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--app-text-3);
}
</style>
