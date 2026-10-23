<template>
  <EsaCardSelect
    :model-value="modelValue"
    :options="options"
    dense
    :placeholder="labels.placeholder"
    @update:model-value="(v: any) => emit('select', String(v))"
  />
</template>

<script setup lang="ts">
// 条件选择器：匹配类型与运算符统一复用卡片选择器，
// 选项与作用说明由父组件按官方元数据（EO_TARGETS / EO_OPERATORS）构造，
// 本组件只负责两类控件各自的标题、提示与搜索文案。
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import EsaCardSelect, { type EsaCardOption } from './EsaCardSelect.vue';

const props = defineProps<{
  /** target：匹配类型；operator：运算符 */
  kind: 'target' | 'operator';
  modelValue: string;
  options: EsaCardOption[];
}>();
const emit = defineEmits<{ (e: 'select', value: string): void }>();

const { t } = useI18n();

const labels = computed(() =>
  props.kind === 'target'
    ? {
        title: t('cdnRules.targetPickTitle'),
        hint: t('cdnRules.targetPickHint'),
        search: t('cdnRules.targetPickSearch'),
        empty: t('cdnRules.pickEmpty'),
        placeholder: t('cdnRules.targetPickPlaceholder'),
      }
    : {
        title: t('cdnRules.opPickTitle'),
        hint: t('cdnRules.opPickHint'),
        search: t('cdnRules.opPickSearch'),
        empty: t('cdnRules.pickEmpty'),
        placeholder: t('cdnRules.opPickPlaceholder'),
      },
);
</script>
