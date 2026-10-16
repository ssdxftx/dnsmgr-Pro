<template>
  <div class="eo-time">
    <n-input-number
      class="eo-time__num"
      :value="displayValue"
      :min="displayMin"
      :max="displayMax"
      :precision="precision"
      size="small"
      clearable
      :placeholder="placeholder"
      @update:value="onInput"
    />
    <n-select
      class="eo-time__unit"
      :value="unit"
      :options="unitOptions"
      size="small"
      :title="t('cdnRules.timeUnitHint')"
      @update:value="onUnit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NInputNumber, NSelect } from 'naive-ui';
import type { EoLocale } from '../../lib/eoRuleMeta';
import { TIME_UNITS, timeFactor, toDisplayValue, type TimeUnit } from '../../lib/eoTime';

const props = defineProps<{
  value?: number | null;
  unit: TimeUnit;
  min?: number;
  max?: number;
  locale: EoLocale;
  placeholder?: string;
}>();
const emit = defineEmits<{
  (e: 'update:value', v: number | null): void;
  (e: 'update:unit', u: TimeUnit): void;
}>();

const { t } = useI18n();

const factor = computed(() => timeFactor(props.unit));
const unitOptions = computed(() => TIME_UNITS.map((u) => ({ label: props.locale === 'zh' ? u.label.zh : u.label.en, value: u.value })));

const displayValue = computed(() => {
  const v = props.value;
  if (v === null || v === undefined) return null;
  return toDisplayValue(v, props.unit);
});
const displayMin = computed(() => (props.min === undefined ? undefined : props.min / factor.value));
const displayMax = computed(() => (props.max === undefined ? undefined : props.max / factor.value));
const precision = computed(() => (props.unit === 's' ? 0 : undefined));

function onInput(v: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) emit('update:value', null);
  else emit('update:value', Math.round(v * factor.value));
}

function onUnit(u: TimeUnit) {
  emit('update:unit', u);
}
</script>

<style scoped>
.eo-time {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.eo-time__num {
  flex: 1 1 auto;
  min-width: 0;
}
.eo-time__unit {
  width: 116px;
  flex: 0 0 116px;
}
@media (max-width: 767px) {
  .eo-time__unit {
    width: 100px;
    flex-basis: 100px;
  }
}
</style>