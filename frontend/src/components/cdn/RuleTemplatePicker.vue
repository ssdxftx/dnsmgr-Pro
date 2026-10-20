<template>
  <n-modal
    :show="show"
    preset="card"
    :title="title"
    style="width: min(900px, calc(100vw - 24px))"
    :mask-closable="true"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="tpl-hint">{{ hint }}</div>
    <div class="tpl-grid">
      <button v-for="tpl in items" :key="tpl.id" type="button" class="tpl-card" @click="emit('select', tpl.id)">
        <span class="tpl-card__tag">{{ tpl.id }}</span>
        <span class="tpl-card__title">{{ bi(tpl.label) }}</span>
        <span class="tpl-card__desc">{{ bi(tpl.desc) }}</span>
      </button>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
// 预制规则选择：数据源由 source 决定——官方（EdgeOne 控制台预设模板）/ 本项目（常用场景模板）。
// 选中后由调用方生成规则并进入编辑页（官方模板的 HOST 匹配值已置空，需填写站点域名）。
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NModal } from 'naive-ui';
import { EO_PRESET_RULES } from '../../lib/eoPresetRules';
import { EO_RULE_TEMPLATES } from '../../lib/eoRuleTemplates';

const props = defineProps<{
  show: boolean;
  /** 数据源：官方预制 / 本项目预制 */
  source: 'official' | 'project';
}>();
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void;
  (e: 'select', id: string): void;
}>();

const { t, locale } = useI18n();
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));
const isOfficial = computed(() => props.source === 'official');

/** 两个数据源结构一致（id / label / desc），仅用于卡片展示 */
const items = computed<{ id: string; label: { zh: string; en: string }; desc: { zh: string; en: string } }[]>(() =>
  isOfficial.value ? EO_PRESET_RULES : EO_RULE_TEMPLATES,
);
const title = computed(() => t(isOfficial.value ? 'cdnRules.tplTitleOfficial' : 'cdnRules.tplTitleProject'));
const hint = computed(() => t(isOfficial.value ? 'cdnRules.tplHintOfficial' : 'cdnRules.tplHintProject'));

function bi(b: { zh: string; en: string }): string {
  return isZh.value ? b.zh : b.en;
}
</script>

<style scoped>
/* ===========================================================================
   预制规则选择器 · 信号卡片网格
   设计意图：模板以卡片陈列，悬停时左侧信号条点亮 + 上浮，
   等宽 ID 芯片呼应全站遥测语义（官方模板 ID 前缀 official- 便于与本地模板区分）。
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
@media (max-width: 767px) {
  .tpl-grid {
    grid-template-columns: 1fr;
  }
}
</style>
