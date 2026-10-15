<template>
  <div class="rule-array">
    <div v-if="!rows.length" class="rule-array__empty">{{ t('cdnRules.arrayEmpty') }}</div>
    <div v-for="(row, idx) in rows" :key="idx" class="rule-array__row">
      <n-space :size="6" align="center" style="width: 100%">
        <template v-for="f in fields" :key="f.name">
          <n-select
            v-if="f.type === 'enum'"
            :value="row[f.name] ?? null"
            :options="optionsOf(f)"
            :placeholder="f.label || f.name"
            size="small"
            style="width: 130px"
            @update:value="(v: any) => setCell(idx, f.name, v)"
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
            :style="{ width: f.name.toLowerCase().includes('value') ? '220px' : '140px' }"
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
import { NButton, NInput, NSelect, NSpace, NSwitch } from 'naive-ui';
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
.rule-array__row {
  margin-bottom: 6px;
}
.rule-array__empty {
  color: var(--app-muted, #999);
  font-size: 12px;
  padding: 4px 0;
}
</style>
