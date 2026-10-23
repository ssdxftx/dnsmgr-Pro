<template>
  <n-input
    v-if="field.type === 'string'"
    :value="textValue"
    :placeholder="field.label || field.name"
    clearable
    @update:value="(v: string) => emit('update:modelValue', v)"
  />
  <n-input-number
    v-else-if="field.type === 'number'"
    :value="numValue"
    :min="field.min"
    :max="field.max"
    clearable
    style="width: 100%"
    @update:value="(v: number | null) => emit('update:modelValue', v)"
  />
  <n-switch
    v-else-if="field.type === 'switch'"
    :value="onValue"
    size="small"
    @update:value="toggle"
  />
  <EsaCardSelect
    v-else-if="field.type === 'enum'"
    :model-value="textValue"
    :options="enumOptions"
    compact
    clearable
    @update:model-value="(v: any) => emit('update:modelValue', v)"
  />
  <n-input
    v-else-if="field.type === 'expression'"
    :value="textValue"
    type="textarea"
    :rows="2"
    :placeholder="field.desc || field.label || field.name"
    @update:value="(v: string) => emit('update:modelValue', v)"
  />
  <RuleArrayEditor
    v-else-if="field.type === 'array'"
    :fields="field.elementFields || []"
    :value="arrValue"
    @update:value="(v: any[]) => emit('update:modelValue', v)"
  />
  <n-input
    v-else
    :value="textValue"
    :placeholder="field.label || field.name"
    clearable
    @update:value="(v: string) => emit('update:modelValue', v)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NInput, NInputNumber, NSwitch } from 'naive-ui';
import EsaCardSelect from './EsaCardSelect.vue';
import RuleArrayEditor from './RuleArrayEditor.vue';
import { toEnabled } from '../../lib/cdnSwitch';

const props = defineProps<{ field: any; modelValue?: any }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: any): void }>();

const textValue = computed(() => (props.modelValue === undefined || props.modelValue === null ? '' : String(props.modelValue)));
const numValue = computed(() => {
  const n = Number(props.modelValue);
  return Number.isFinite(n) ? n : null;
});
const arrValue = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []));

const onValue = computed(() => toEnabled(props.modelValue));

/** switch 字段的 choices 为 [开启值, 关闭值]（ESA 为 on/off；EO 由动作元数据给出） */
function toggle(v: boolean) {
  const choices: string[] = Array.isArray(props.field.choices) && props.field.choices.length >= 2 ? props.field.choices : ['on', 'off'];
  emit('update:modelValue', v ? choices[0] : choices[1]);
}

const enumOptions = computed(() =>
  (Array.isArray(props.field.choices) ? props.field.choices : []).map((c: string) => ({ label: c, value: c })),
);
</script>
