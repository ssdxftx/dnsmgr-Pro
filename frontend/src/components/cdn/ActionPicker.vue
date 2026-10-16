<template>
  <CardSelect
    :model-value="modelValue"
    :options="options"
    :groups="groups"
    :labels="labels"
    @select="(v: string) => emit('select', v)"
  />
</template>

<script setup lang="ts">
// 执行动作选择器：卡片数据由 eoRuleSchema 的官方字段表生成
// （官方中文名 / 作用说明 / 所属分组），展示层复用通用卡片选择器 CardSelect。
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import CardSelect, { type CardSelectOption } from './CardSelect.vue';
import { EO_ACTION_GROUPS, eoActionInfo, type EoLocale } from '../../lib/eoRuleMeta';
import { EO_ACTION_SCHEMAS } from '../../lib/eoRuleSchema';

const props = defineProps<{
  /** 当前动作名（官方 RuleEngineAction.Name），为空表示未选择 */
  modelValue: string;
  locale: EoLocale;
}>();
const emit = defineEmits<{ (e: 'select', name: string): void }>();

const { t } = useI18n();

const options = computed<CardSelectOption[]>(() =>
  EO_ACTION_SCHEMAS.map((s) => {
    const info = eoActionInfo(s.name, props.locale);
    return {
      value: s.name,
      label: info.label,
      desc: props.locale === 'zh' ? s.desc.zh : s.desc.en,
      tag: info.groupLabel,
      group: info.group,
    };
  }),
);

/** 官方分组（按官方控制台顺序） */
const groups = computed(() =>
  EO_ACTION_GROUPS.map((g) => ({ key: g.key, label: props.locale === 'zh' ? g.label.zh : g.label.en })),
);

const labels = computed(() => ({
  title: t('cdnRules.actionPickTitle'),
  hint: t('cdnRules.actionPickHint'),
  search: t('cdnRules.actionPickSearch'),
  empty: t('cdnRules.actionPickEmpty'),
  placeholder: t('cdnRules.actionPick'),
}));
</script>
