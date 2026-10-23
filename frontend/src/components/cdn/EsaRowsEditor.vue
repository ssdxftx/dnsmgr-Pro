<template>
  <div class="esa-rows">
    <div v-if="rows.length" class="esa-rows__table">
      <div class="esa-rows__head">
        <span v-for="f in fields" :key="f.name" class="esa-rows__cell" :style="cellStyle(f)">{{ f.label }}</span>
        <span class="esa-rows__cell esa-rows__cell--op">{{ t('esaZone.actions') }}</span>
      </div>
      <div v-for="(row, i) in rows" :key="i" class="esa-rows__row">
        <span v-for="f in fields" :key="f.name" class="esa-rows__cell" :style="cellStyle(f)">
          <EsaCardSelect
            v-if="f.type === 'select'"
            :model-value="row[f.name]"
            :options="f.options || []"
            :placeholder="f.placeholder"
            dense
            @update:model-value="(v: any) => update(i, f.name, v)"
          />
          <n-input-number
            v-else-if="f.type === 'number'"
            :value="row[f.name]"
            :min="f.min"
            :max="f.max"
            size="small"
            :placeholder="f.placeholder"
            @update:value="(v: any) => update(i, f.name, v)"
          />
          <n-switch
            v-else-if="f.type === 'switch'"
            :value="!!row[f.name]"
            size="small"
            @update:value="(v: boolean) => update(i, f.name, v)"
          />
          <n-input
            v-else
            :value="row[f.name]"
            size="small"
            :placeholder="f.placeholder"
            @update:value="(v: string) => update(i, f.name, v)"
          />
        </span>
        <span class="esa-rows__cell esa-rows__cell--op">
          <n-button size="tiny" quaternary type="error" @click="remove(i)">{{ t('esaZone.delete') }}</n-button>
        </span>
      </div>
    </div>
    <n-empty v-else size="small" :description="t('esaZone.empty')" style="margin: 8px 0" />
    <n-button size="small" dashed block @click="add">{{ addLabel || t('esaZone.addRow') }}</n-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NEmpty, NInput, NInputNumber, NSwitch } from 'naive-ui';
import EsaCardSelect from './EsaCardSelect.vue';

export interface EsaRowFieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'switch' | 'select';
  options?: { label: string; value: any }[];
  width?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: any[];
    fields: EsaRowFieldDef[];
    defaultRow?: Record<string, any>;
    addLabel?: string;
  }>(),
  { defaultRow: () => ({}), fields: () => [] },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: any[]): void }>();
const { t } = useI18n();

const rows = computed<any[]>(() => (Array.isArray(props.modelValue) ? props.modelValue : []));

function cellStyle(f: EsaRowFieldDef) {
  return f.width ? { flex: `0 0 ${f.width}px`, width: `${f.width}px` } : { flex: '1 1 0', minWidth: '90px' };
}

function update(index: number, key: string, value: any) {
  const next = rows.value.map((row, i) => (i === index ? { ...row, [key]: value } : row));
  emit('update:modelValue', next);
}

function add() {
  emit('update:modelValue', [...rows.value, { ...props.defaultRow }]);
}

function remove(index: number) {
  emit(
    'update:modelValue',
    rows.value.filter((_, i) => i !== index),
  );
}
</script>

<style scoped>
.esa-rows {
  width: 100%;
}
.esa-rows__table {
  width: 100%;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-sm);
  overflow-x: auto;
  overflow-y: hidden;
  margin-bottom: 8px;
}
.esa-rows__head,
.esa-rows__row {
  min-width: max-content;
}
.esa-rows__head,
.esa-rows__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
}
.esa-rows__head {
  background: var(--app-surface-2);
  font-size: 11px;
  color: var(--app-text-3);
}
.esa-rows__row + .esa-rows__row {
  border-top: 1px solid var(--app-divider);
}
.esa-rows__cell {
  min-width: 0;
}
.esa-rows__cell--op {
  flex: 0 0 56px;
  text-align: right;
}
</style>
