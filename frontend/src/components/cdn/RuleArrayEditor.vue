<template>
  <div class="rule-array">
    <div v-if="!rows.length" class="rule-array__empty">{{ t('cdnRules.arrayEmpty') }}</div>
    <div v-for="(row, idx) in rows" :key="idx" class="rule-array__row">
      <n-space :size="6" align="center" style="width: 100%">
        <span class="rule-array__index">{{ idx + 1 }}</span>
        <template v-for="f in fields" :key="f.name">
          <EsaCardSelect
            v-if="f.type === 'enum'"
            :model-value="row[f.name] ?? null"
            :options="optionsOf(f)"
            :placeholder="f.label || f.name"
            dense
            class="rule-array__cell rule-array__cell--enum"
            @update:model-value="(v: any) => setCell(idx, f.name, v)"
          />
          <n-switch
            v-else-if="f.type === 'switch'"
            :value="toEnabled(row[f.name])"
            size="small"
            @update:value="(v: boolean) => setCell(idx, f.name, v ? (f.choices?.[0] ?? 'on') : (f.choices?.[1] ?? 'off'))"
          />
          <n-input
            v-else
            :value="row[f.name] === undefined || row[f.name] === null ? '' : String(row[f.name])"
            :placeholder="f.label || f.name"
            size="small"
            :class="['rule-array__cell', f.name.toLowerCase().includes('value') ? 'rule-array__cell--wide' : '']"
            @update:value="(v: string) => setCell(idx, f.name, v)"
          />
        </template>
        <n-button size="tiny" type="error" quaternary @click="removeRow(idx)">{{ t('cdnRules.actionRemove') }}</n-button>
      </n-space>
    </div>
    <n-button size="small" dashed block style="margin-top: 6px" @click="addRow">
      {{ t('cdnRules.arrayAdd') }}
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NInput, NSpace, NSwitch } from 'naive-ui';
import EsaCardSelect from './EsaCardSelect.vue';
import { toEnabled } from '../../lib/cdnSwitch';

const props = defineProps<{ fields: any[]; value?: any[] }>();
const emit = defineEmits<{ (e: 'update:value', v: any[]): void }>();
const { t } = useI18n();

const rows = computed(() => (Array.isArray(props.value) ? props.value : []));

function optionsOf(f: any) {
  return (Array.isArray(f.choices) ? f.choices : []).map((c: string) => ({
    label: f.name === 'Operation' ? opLabel(c) : c,
    value: c,
  }));
}
function opLabel(v: string) {
  if (v === 'add') return t('cdnRules.arrayOpAdd');
  if (v === 'modify') return t('cdnRules.arrayOpModify');
  if (v === 'del') return t('cdnRules.arrayOpDelete');
  return v;
}

function emitRows(next: any[]) {
  emit('update:value', next);
}
function setCell(idx: number, key: string, v: any) {
  const next = rows.value.map((r) => ({ ...r }));
  next[idx][key] = v;
  emitRows(next);
}
function addRow() {
  const row: Record<string, any> = {};
  for (const f of props.fields) {
    if (f.type === 'enum' && Array.isArray(f.choices) && f.choices.length) row[f.name] = f.choices[0];
    else if (f.type === 'switch') row[f.name] = f.choices?.[0] ?? 'on';
    else row[f.name] = '';
  }
  emitRows([...rows.value, row]);
}
function removeRow(idx: number) {
  emitRows(rows.value.filter((_, i) => i !== idx));
}
</script>

<style scoped>
/* 数组编辑：白底行卡片 + 等宽序号徽章，hover / focus-within 信号反馈 */
.rule-array__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  margin-bottom: 6px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  transition: border-color 0.15s var(--app-ease), box-shadow 0.15s var(--app-ease);
}
.rule-array__row:hover {
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
}
.rule-array__row:focus-within {
  border-color: color-mix(in srgb, var(--app-primary) 45%, var(--app-divider));
  box-shadow: 0 0 0 3px var(--app-primary-weak);
}
.rule-array__row :deep(.n-space) {
  flex-wrap: wrap;
}
.rule-array__index {
  flex-shrink: 0;
  min-width: 22px;
  text-align: center;
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--app-primary);
  background: var(--app-primary-weak);
  border-radius: 6px;
  padding: 1px 4px;
  font-variant-numeric: tabular-nums;
}
.rule-array__empty {
  color: var(--app-text-3);
  font-size: 12px;
  padding: 12px 0;
  text-align: center;
  border: 1px dashed var(--app-divider);
  border-radius: var(--app-radius);
  margin-bottom: 6px;
}
.rule-array__cell {
  width: 140px;
}
.rule-array__cell--enum {
  width: 130px;
}
.rule-array__cell--wide {
  width: 220px;
}

/* 移动端：单元格弹性换行，避免横向溢出 */
@media (max-width: 767px) {
  .rule-array__cell,
  .rule-array__cell--enum,
  .rule-array__cell--wide {
    width: auto;
    flex: 1 1 calc(50% - 6px);
    min-width: 0;
    max-width: 100%;
  }
}
</style>
