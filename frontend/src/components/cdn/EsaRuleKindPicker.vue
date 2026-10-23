<template>
  <n-modal
    :show="show"
    preset="card"
    :title="L('新建规则 · 选择规则类型', 'Create rule · choose a type')"
    class="modal-lg esa-kind-modal"
    :mask-closable="true"
    :auto-focus="false"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="esa-kind__hint">
      {{ L('规则类型按官方控制台分类组织，每张卡片写明该类型的作用。', 'Rule types follow the official console categories; each card explains what it does.') }}
    </div>
    <n-input v-model:value="keyword" size="small" clearable :placeholder="L('搜索规则类型', 'Search rule types')" class="esa-kind__search" />
    <div class="esa-kind__scroll">
      <section v-for="cat in filteredCategories" :key="cat.key" class="esa-kind__section">
        <div class="esa-kind__section-head">
          <span class="esa-kind__section-name">{{ L(cat.label.zh, cat.label.en) }}</span>
          <span class="esa-kind__section-desc">{{ L(cat.desc.zh, cat.desc.en) }}</span>
        </div>
        <div class="esa-kind__grid">
          <button
            v-for="k in kindsOf(cat.key)"
            :key="k.kind"
            type="button"
            class="esa-kind__card"
            @click="pick(k.kind)"
          >
            <span class="esa-kind__card-title">{{ L(k.label.zh, k.label.en) }}</span>
            <span class="esa-kind__card-desc">{{ L(k.desc.zh, k.desc.en) }}</span>
            <code class="esa-kind__card-code">{{ k.kind }}</code>
          </button>
        </div>
      </section>
      <div v-if="!filteredCategories.length" class="esa-kind__empty">{{ L('没有匹配的规则类型', 'No matching rule type') }}</div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { NInput, NModal } from 'naive-ui';
import { ESA_RULE_CATEGORIES, esaKindsOfCategory, type EsaLocale } from '../../lib/esaRuleMeta';

const props = withDefaults(
  defineProps<{ show: boolean; category?: string; locale?: EsaLocale }>(),
  { category: '', locale: 'zh' },
);
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void;
  (e: 'select', kind: string): void;
}>();

const locale = computed(() => props.locale);
const L = (zh: string, en: string) => (locale.value === 'zh' ? zh : en);
const keyword = ref('');

const filteredCategories = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const cats = props.category ? ESA_RULE_CATEGORIES.filter((c) => c.key === props.category) : ESA_RULE_CATEGORIES;
  return cats
    .map((c) => ({ ...c }))
    .filter((c) => {
      if (!kw) return true;
      return esaKindsOfCategory(c.key).some((k) =>
        [k.kind, k.label.zh, k.label.en, k.desc.zh, k.desc.en].join(' ').toLowerCase().includes(kw),
      );
    });
});

function kindsOf(category: string) {
  const kw = keyword.value.trim().toLowerCase();
  const list = esaKindsOfCategory(category);
  if (!kw) return list;
  return list.filter((k) => [k.kind, k.label.zh, k.label.en, k.desc.zh, k.desc.en].join(' ').toLowerCase().includes(kw));
}

function pick(kind: string) {
  emit('select', kind);
  emit('update:show', false);
}
</script>

<style scoped>
.esa-kind__hint {
  font-size: 13px;
  line-height: 1.65;
  color: var(--app-text-3);
  margin-bottom: 12px;
}
.esa-kind__search {
  margin-bottom: 12px;
}
.esa-kind__scroll {
  max-height: min(62vh, 620px);
  overflow: auto;
  padding-right: 4px;
}
.esa-kind__section + .esa-kind__section {
  margin-top: 16px;
}
.esa-kind__section-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}
.esa-kind__section-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-kind__section-desc {
  font-size: 12px;
  color: var(--app-text-3);
}
.esa-kind__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}
.esa-kind__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  text-align: left;
  padding: 14px 14px 12px 17px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.18s var(--app-ease), border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.esa-kind__card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 3px;
  background: var(--app-primary);
  opacity: 0;
  transition: opacity 0.18s var(--app-ease);
}
.esa-kind__card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.esa-kind__card:hover::before {
  opacity: 1;
}
.esa-kind__card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-kind__card-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--app-text-2);
}
.esa-kind__card-code {
  font-family: var(--app-font-mono);
  font-size: 10.5px;
  color: var(--app-text-3);
}
.esa-kind__empty {
  padding: 18px;
  text-align: center;
  color: var(--app-text-3);
  font-size: 13px;
}
</style>

<style>
/* 直接呈现，避免缩放/淡入在移动端出现闪烁 */
.n-modal.esa-kind-modal.fade-in-scale-up-transition-enter-active {
  transition: none;
}
.n-modal.esa-kind-modal.fade-in-scale-up-transition-enter-from {
  opacity: 1;
  transform: none;
}
</style>
