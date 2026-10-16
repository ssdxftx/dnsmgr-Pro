<template>
  <n-modal
    :show="show"
    preset="card"
    :title="t('cdnRules.tplTitle')"
    style="width: min(900px, calc(100vw - 24px))"
    :mask-closable="true"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="tpl-hint">{{ t('cdnRules.tplHint') }}</div>
    <div class="tpl-grid">
      <button v-for="tpl in templates" :key="tpl.id" type="button" class="tpl-card" @click="emit('select', tpl.id)">
        <span class="tpl-card__tag">{{ tpl.id }}</span>
        <span class="tpl-card__title">{{ bi(tpl.label) }}</span>
        <span class="tpl-card__desc">{{ bi(tpl.desc) }}</span>
      </button>
      <button type="button" class="tpl-card tpl-card--blank" @click="emit('select', '')">
        <span class="tpl-card__title">{{ t('cdnRules.tplBlank') }}</span>
        <span class="tpl-card__desc">{{ t('cdnRules.tplBlankDesc') }}</span>
      </button>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NModal } from 'naive-ui';
import { EO_RULE_TEMPLATES, type EoRuleTemplate } from '../../lib/eoRuleTemplates';

defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void;
  (e: 'select', id: string): void;
}>();

const { t, locale } = useI18n();
const templates = computed<EoRuleTemplate[]>(() => EO_RULE_TEMPLATES);
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

function bi(b: { zh: string; en: string }): string {
  return isZh.value ? b.zh : b.en;
}
</script>

<style scoped>
/* ===========================================================================
   模板选择器 · 信号卡片网格
   设计意图：模板以卡片陈列，悬停时左侧信号条点亮 + 上浮，
   等宽 ID 芯片呼应全站遥测语义；空白模板用虚线卡区分「从零开始」。
   =========================================================================== */
.tpl-hint {
  font-size: 13px;
  color: var(--app-text-3);
  margin-bottom: 12px;
  line-height: 1.65;
}
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.tpl-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  text-align: left;
  padding: 14px 14px 16px 18px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.2s var(--app-ease), border-color 0.2s var(--app-ease), box-shadow 0.2s var(--app-ease);
  font: inherit;
  color: inherit;
}
/* 左侧信号条：默认隐藏，悬停点亮 */
.tpl-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 3px;
  background: var(--app-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--app-primary) 40%, transparent);
  opacity: 0;
  transition: opacity 0.2s var(--app-ease);
}
.tpl-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.tpl-card:hover::before {
  opacity: 1;
}
.tpl-card:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}
/* 模板 ID 芯片：等宽遥测标签 */
.tpl-card__tag {
  font-family: var(--app-font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--app-primary);
  background: var(--app-primary-weak);
  border-radius: 5px;
  padding: 1px 7px;
}
.tpl-card__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--app-text-1);
}
.tpl-card__desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--app-text-3);
}
/* 空白模板：虚线卡，信号条常显弱化 */
.tpl-card--blank {
  border-style: dashed;
  background: var(--app-surface-2);
}
.tpl-card--blank::before {
  opacity: 1;
  background: var(--app-text-3);
  box-shadow: none;
}
@media (max-width: 767px) {
  .tpl-grid {
    grid-template-columns: 1fr;
  }
}
</style>
