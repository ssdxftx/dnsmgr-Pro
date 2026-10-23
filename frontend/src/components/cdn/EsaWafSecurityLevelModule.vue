<template>
  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">{{ t('esaZone.wafSecurityTitle') }}</h3>
      <div class="app-panel__extra">
        <n-button size="small" :loading="loadBusy" :disabled="loadBusy" @click="load">{{ t('esaZone.reload') }}</n-button>
        <n-button size="small" type="primary" :loading="saveBusy" :disabled="saveBusy" @click="save">{{ t('esaZone.save') }}</n-button>
      </div>
    </div>
    <p class="esa-waf-level__desc">{{ t('esaZone.wafSecurityDesc') }}</p>

    <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>

    <div class="esa-waf-level__grid">
      <button
        v-for="level in levels"
        :key="level.value"
        type="button"
        class="esa-waf-level__card"
        :class="{ 'esa-waf-level__card--active': current === level.value }"
        @click="current = level.value"
      >
        <span class="esa-waf-level__head">
          <span class="esa-waf-level__title">{{ level.label }}</span>
          <n-tag v-if="level.gate" size="tiny" :bordered="false" type="warning">{{ level.gate }}</n-tag>
        </span>
        <span class="esa-waf-level__desc-text">{{ level.desc }}</span>
        <span class="esa-waf-level__code">{{ level.value }}</span>
      </button>
    </div>

    <div class="esa-waf-level__hint">{{ t('esaZone.wafSecurityHint') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NButton, NTag, useMessage } from 'naive-ui';
import { api } from '../../api';
import { ESA_WAF_SECURITY_LEVELS } from '../../lib/esaWafMeta';

const props = defineProps<{ aid: number; zoneId: string }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { t, locale } = useI18n();
const message = useMessage();
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

const current = ref('medium');
const ruleId = ref<number | null>(null);
const loadBusy = ref(false);
const saveBusy = ref(false);
const loadError = ref('');

const levels = computed(() =>
  ESA_WAF_SECURITY_LEVELS.map((l) => ({
    value: l.value,
    label: isZh.value ? l.label.zh : l.label.en,
    desc: isZh.value ? l.desc.zh : l.desc.en,
    gate: l.gate && l.gate !== 'free' ? l.gate.toUpperCase() : '',
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

async function load() {
  loadBusy.value = true;
  loadError.value = '';
  try {
    const data = await call('ListWafRules', { Phase: 'http_security_level_rule', PageNumber: 1, PageSize: 20 });
    const rules = Array.isArray(data?.Rules) ? data.Rules : [];
    const rule = rules[0];
    if (rule) {
      ruleId.value = Number(rule.Id);
      current.value = cfgOf(rule)?.SecurityLevel?.Value || 'medium';
    } else {
      ruleId.value = null;
      current.value = 'medium';
    }
  } catch (e: any) {
    loadError.value = e?.message || t('esaZone.loadFailed');
  } finally {
    loadBusy.value = false;
  }
}

async function ensureRuleset(): Promise<number> {
  const data = await call('ListWafRulesets', { Phase: 'http_security_level_rule', PageNumber: 1, PageSize: 20 });
  const existing = Array.isArray(data?.Rulesets) ? data.Rulesets[0] : null;
  if (existing?.Id) return Number(existing.Id);
  const created = await call('CreateWafRuleset', { Phase: 'http_security_level_rule', Name: 'security-level-ruleset' });
  return Number(created?.Id || created?.RulesetId || 0);
}

async function save() {
  saveBusy.value = true;
  try {
    const status = current.value === 'off' ? 'off' : 'on';
    const config = {
      Name: 'security-level',
      Status: status,
      Type: 'http_security_level_rule',
      SecurityLevel: { Value: current.value },
    };
    if (ruleId.value) {
      await call('UpdateWafRule', { Id: ruleId.value, Status: status, Config: config });
    } else {
      const rulesetId = await ensureRuleset();
      await call('CreateWafRule', {
        Phase: 'http_security_level_rule',
        ...(rulesetId ? { RulesetId: rulesetId } : {}),
        Config: config,
      });
    }
    message.success(t('esaZone.saved'));
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
.esa-waf-level__desc {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
  line-height: 1.6;
}
.esa-waf-level__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}
.esa-waf-level__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: flex-start;
  text-align: left;
  padding: 12px 14px 12px 16px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.18s var(--app-ease), border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.esa-waf-level__card::before {
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
.esa-waf-level__card:hover::before,
.esa-waf-level__card--active::before {
  opacity: 1;
}
.esa-waf-level__card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.esa-waf-level__card--active {
  border-color: color-mix(in srgb, var(--app-primary) 60%, var(--app-border));
  background: color-mix(in srgb, var(--app-primary) 7%, var(--app-surface));
}
.esa-waf-level__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.esa-waf-level__title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-waf-level__desc-text {
  font-size: 12px;
  line-height: 1.55;
  color: var(--app-text-2);
}
.esa-waf-level__code {
  font-family: var(--app-font-mono);
  font-size: 10.5px;
  color: var(--app-text-3);
}
.esa-waf-level__hint {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--app-text-3);
}
</style>
