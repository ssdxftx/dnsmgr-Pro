<template>
  <n-modal
    :show="show"
    preset="card"
    :title="isScene ? t('cdnDomain.sceneTitle') : t('cdnRules.createTitle')"
    class="modal-lg"
    :mask-closable="true"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="rcp-hint">{{ isScene ? t('cdnDomain.scenePickHint') : t('cdnRules.createHint') }}</div>
    <div class="rcp-grid">
      <button
        v-for="opt in options"
        :key="opt.key"
        type="button"
        class="rcp-card"
        :class="{ 'rcp-card--blank': opt.key === 'blank' }"
        @click="emit('select', opt.key)"
      >
        <span class="rcp-card__icon">
          <n-icon :component="opt.icon" :size="22" />
        </span>
        <span class="rcp-card__title">{{ opt.label }}</span>
        <span class="rcp-card__desc">{{ opt.desc }}</span>
        <span v-if="opt.meta" class="rcp-card__meta">{{ opt.meta }}</span>
      </button>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
// 新建规则方式选择：官方预制规则 / 本项目预制规则 / 空白规则。
// 前两者进入预制规则选择弹窗，再进入规则编辑页（填写站点域名）；空白规则直接进入编辑页。
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NIcon, NModal } from 'naive-ui';
import { AddCircleOutline, LayersOutline, SparklesOutline } from '@vicons/ionicons5';
import { EO_PRESET_RULES } from '../../lib/eoPresetRules';
import { EO_RULE_TEMPLATES } from '../../lib/eoRuleTemplates';

export type RuleCreateSource = 'official' | 'project' | 'blank';

const props = withDefaults(defineProps<{ show: boolean; mode?: 'rule' | 'scene' }>(), { mode: 'rule' });
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void;
  (e: 'select', source: RuleCreateSource): void;
}>();

const { t } = useI18n();
const isScene = computed(() => props.mode === 'scene');

const options = computed<
  { key: RuleCreateSource; icon: any; label: string; desc: string; meta: string }[]
>(() => [
  {
    key: 'official',
    icon: SparklesOutline,
    label: t('cdnRules.createOfficial'),
    desc: t('cdnRules.createOfficialDesc'),
    meta: t('cdnRules.createCount', { n: EO_PRESET_RULES.length }),
  },
  {
    key: 'project',
    icon: LayersOutline,
    label: t('cdnRules.createProject'),
    desc: t('cdnRules.createProjectDesc'),
    meta: t('cdnRules.createCount', { n: EO_RULE_TEMPLATES.length }),
  },
  {
    key: 'blank',
    icon: AddCircleOutline,
    label: isScene.value ? t('cdnDomain.sceneSkip') : t('cdnRules.createBlank'),
    desc: isScene.value ? t('cdnDomain.sceneSkipDesc') : t('cdnRules.createBlankDesc'),
    meta: isScene.value ? '' : t('cdnRules.createFromScratch'),
  },
]);
</script>

<style scoped>
/* ===========================================================================
   新建规则 · 三选一卡片
   设计意图：把「从哪来」这一步单独呈现——官方预制 / 本项目预制 / 空白。
   沿用全站信号语义：悬停点亮左侧信号条并上浮；图标落在弱底色方块中形成入口感。
   =========================================================================== */
.rcp-hint {
  font-size: 13px;
  line-height: 1.65;
  color: var(--app-text-3);
  margin-bottom: 14px;
}
.rcp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
}
.rcp-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  text-align: left;
  padding: 18px 16px 16px 19px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.2s var(--app-ease), border-color 0.2s var(--app-ease), box-shadow 0.2s var(--app-ease);
}
/* 左侧信号条：默认隐藏，悬停点亮 */
.rcp-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 3px;
  background: var(--app-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--app-primary) 40%, transparent);
  opacity: 0;
  transition: opacity 0.2s var(--app-ease);
}
.rcp-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.rcp-card:hover::before {
  opacity: 1;
}
.rcp-card:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}
.rcp-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: 2px;
  border-radius: 10px;
  color: var(--app-primary);
  background: var(--app-primary-weak);
}
.rcp-card__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text-1);
  letter-spacing: 0.01em;
}
.rcp-card__desc {
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--app-text-2);
  flex: 1;
}
/* 数量芯片：等宽遥测标签 */
.rcp-card__meta {
  margin-top: 4px;
  font-family: var(--app-font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--app-text-3);
  background: var(--app-bg-soft);
  border: 1px solid var(--app-divider);
  border-radius: 999px;
  padding: 2px 9px;
}
/* 空白规则：虚线卡 + 中性色图标，与两个预制入口拉开层级 */
.rcp-card--blank {
  border-style: dashed;
  background: var(--app-surface-2);
}
.rcp-card--blank::before {
  opacity: 1;
  background: var(--app-text-3);
  box-shadow: none;
}
.rcp-card--blank .rcp-card__icon {
  color: var(--app-text-2);
  background: var(--app-bg-soft);
}
@media (max-width: 767px) {
  .rcp-grid {
    grid-template-columns: 1fr;
  }
  .rcp-card {
    padding: 16px 14px 14px 17px;
  }
}
</style>
