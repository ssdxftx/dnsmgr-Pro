<template>
  <div class="re-pick">
    <!-- 触发器：外观与表单控件一致，点击弹出卡片选择层 -->
    <button
      type="button"
      class="re-pick__trigger"
      :class="{ 're-pick__trigger--empty': !current, 're-pick__trigger--unlisted': isUnlisted }"
      aria-haspopup="dialog"
      :aria-expanded="show"
      @click="show = true"
    >
      <span class="re-pick__trigger-main">
        <span class="re-pick__trigger-label">{{ current ? current.label : labels.placeholder }}</span>
        <span v-if="current?.tag" class="re-pick__trigger-tag">{{ current.tag }}</span>
      </span>
      <n-icon class="re-pick__trigger-arrow" :component="ChevronDownOutline" />
    </button>

    <!-- 选择弹层：分组大卡片 + 上下滑动 + 关键词搜索 -->
    <n-modal
      v-model:show="show"
      preset="card"
      :title="labels.title"
      class="modal-lg"
      :mask-closable="true"
      :auto-focus="false"
    >
      <div class="re-pick__hint">{{ labels.hint }}</div>

      <n-input
        v-model:value="keyword"
        size="small"
        clearable
        :placeholder="labels.search"
        class="re-pick__search"
      />

      <div class="re-pick__scroll">
        <section v-for="sec in sections" :key="sec.key" class="re-pick__section">
          <div v-if="sec.label" class="re-pick__section-head">
            <span class="re-pick__section-name">{{ sec.label }}</span>
            <span class="re-pick__section-count">{{ sec.items.length }}</span>
          </div>
          <div class="re-pick__grid">
            <button
              v-for="it in sec.items"
              :key="it.value"
              type="button"
              class="re-pick__card"
              :class="{ 're-pick__card--active': it.value === modelValue }"
              @click="pick(it.value)"
            >
              <span class="re-pick__card-head">
                <span class="re-pick__card-title">{{ it.label }}</span>
                <n-icon v-if="it.value === modelValue" class="re-pick__card-check" :component="CheckmarkOutline" />
              </span>
              <span v-if="it.desc" class="re-pick__card-desc">{{ it.desc }}</span>
              <code class="re-pick__card-code">{{ it.value }}</code>
            </button>
          </div>
        </section>
        <div v-if="!total" class="re-pick__empty">{{ labels.empty }}</div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
// 通用卡片选择器：触发器 + 弹出式大卡片列表（可分组、可搜索、卡片可带作用说明）。
// 规则引擎内所有「从固定集合中选一项」的控件（执行动作 / 匹配类型 / 运算符）统一复用本组件，
// 保证交互与视觉一致，并把各选项的含义直接写在卡片上。
import { computed, ref } from 'vue';
import { NIcon, NInput, NModal } from 'naive-ui';
import { CheckmarkOutline, ChevronDownOutline } from '@vicons/ionicons5';

export interface CardSelectOption {
  /** 选中值（写回配置的原始值） */
  value: string;
  /** 卡片标题（本地化显示名） */
  label: string;
  /** 作用说明（本地化） */
  desc?: string;
  /** 触发器上的小标签（如所属分组），卡片中不重复展示 */
  tag?: string;
  /** 所属分组 key（配合 groups 使用） */
  group?: string;
}

const props = defineProps<{
  modelValue: string;
  options: CardSelectOption[];
  /** 分组定义（按给定顺序渲染并吸顶；未定义时输出为单一无标题分组） */
  groups?: { key: string; label: string }[];
  labels: { title: string; hint: string; search: string; empty: string; placeholder: string };
  /** 当前值不在选项中时的标签（如「未收录」）；给出后触发器回显原始取值而不是空白占位 */
  unlistedLabel?: string;
}>();
const emit = defineEmits<{ (e: 'select', value: string): void }>();

const show = ref(false);
const keyword = ref('');

const matched = computed(() => props.options.find((o) => o.value === props.modelValue));
/** 云端（控制台/API）创建的规则可能带有本项目尚未收录的取值，此时必须原样回显，避免看起来「没选中」 */
const isUnlisted = computed(() => !!props.modelValue && !matched.value);
const current = computed<CardSelectOption | undefined>(
  () =>
    matched.value ||
    (isUnlisted.value && props.unlistedLabel
      ? { value: props.modelValue, label: props.modelValue, tag: props.unlistedLabel }
      : undefined),
);

const sections = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const matched = kw
    ? props.options.filter((o) => [o.value, o.label, o.desc, o.tag].filter(Boolean).join(' ').toLowerCase().includes(kw))
    : props.options;
  if (!props.groups?.length) return [{ key: '_', label: '', items: matched }];
  const known = new Set(props.groups.map((g) => g.key));
  const sections = props.groups.map((g) => ({
    key: g.key,
    label: g.label,
    items: matched.filter((o) => o.group === g.key),
  }));
  // 兜底：未归入任何已声明分组的选项，单独成组展示，避免被静默丢失
  const orphans = matched.filter((o) => !o.group || !known.has(o.group));
  if (orphans.length) sections.push({ key: '__other', label: '', items: orphans });
  return sections;
});

const total = computed(() => sections.value.reduce((n, s) => n + s.items.length, 0));

function pick(value: string) {
  emit('select', value);
  show.value = false;
}
</script>

<style scoped>
/* ===========================================================================
   卡片选择器 · 信号卡片墙
   与全站信号语义一致：左侧信号条悬停点亮，选中态常亮 + 主色描边。
   =========================================================================== */
.re-pick {
  display: flex;
  width: 100%;
  min-width: 0;
}

/* 触发器 */
.re-pick__trigger {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-surface);
  font: inherit;
  font-size: 13px;
  color: var(--app-text);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease), background 0.18s var(--app-ease);
}
.re-pick__trigger:hover {
  border-color: color-mix(in srgb, var(--app-primary) 45%, var(--app-border));
  background: var(--app-surface-2);
}
.re-pick__trigger:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}
.re-pick__trigger--empty .re-pick__trigger-label {
  color: var(--app-text-3);
}
/* 未收录取值（云端规则）：原样回显 + 警示色标签，提示与本地选项集不一致 */
.re-pick__trigger--unlisted {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--app-warning) 45%, var(--app-border));
}
.re-pick__trigger--unlisted .re-pick__trigger-label {
  font-family: var(--app-font-mono);
  font-size: 12px;
}
.re-pick__trigger--unlisted .re-pick__trigger-tag {
  color: var(--app-warning);
  background: var(--app-warning-weak);
}
.re-pick__trigger-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.re-pick__trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.re-pick__trigger-tag {
  flex: 0 0 auto;
  font-family: var(--app-font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--app-primary);
  background: var(--app-primary-weak);
  border-radius: 5px;
  padding: 1px 6px;
}
.re-pick__trigger-arrow {
  flex: 0 0 auto;
  color: var(--app-text-3);
  transition: color 0.18s var(--app-ease);
}
.re-pick__trigger:hover .re-pick__trigger-arrow {
  color: var(--app-primary);
}

/* 弹层 */
.re-pick__hint {
  font-size: 13px;
  line-height: 1.65;
  color: var(--app-text-3);
  margin-bottom: 10px;
}
.re-pick__search {
  margin-bottom: 12px;
}
.re-pick__scroll {
  max-height: min(58vh, 520px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-bg-soft);
}

/* 分组标题：滚动区内吸顶 */
.re-pick__section-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
  background: color-mix(in srgb, var(--app-bg-soft) 94%, transparent);
}
.re-pick__section-name {
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--app-text-2);
}
.re-pick__section-count {
  font-family: var(--app-font-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--app-text-3);
  background: var(--app-surface);
  border: 1px solid var(--app-divider);
  border-radius: 999px;
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
}

.re-pick__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
  padding: 0 10px 12px;
}

/* 选项大卡片 */
.re-pick__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  text-align: left;
  padding: 12px 14px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.18s var(--app-ease), border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.re-pick__card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 3px;
  background: var(--app-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--app-primary) 40%, transparent);
  opacity: 0;
  transition: opacity 0.18s var(--app-ease);
}
.re-pick__card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.re-pick__card:hover::before {
  opacity: 1;
}
.re-pick__card:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}
.re-pick__card--active {
  border-color: color-mix(in srgb, var(--app-primary) 55%, var(--app-border));
  background: var(--app-primary-weak);
}
.re-pick__card--active::before {
  opacity: 1;
}
.re-pick__card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.re-pick__card-title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--app-text);
  line-height: 1.4;
}
.re-pick__card-check {
  flex: 0 0 auto;
  color: var(--app-primary);
  font-size: 16px;
}
.re-pick__card-desc {
  font-size: 12px;
  line-height: 1.65;
  color: var(--app-text-2);
}
/* 原始取值：等宽小芯片，便于与腾讯云控制台 / API 对照 */
.re-pick__card-code {
  font-family: var(--app-font-mono);
  font-size: 10.5px;
  color: var(--app-text-3);
  background: var(--app-bg-soft);
  border-radius: 5px;
  padding: 1px 6px;
  word-break: break-all;
}
.re-pick__card--active .re-pick__card-code {
  background: var(--app-surface);
}

.re-pick__empty {
  padding: 32px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--app-text-3);
}

@media (max-width: 767px) {
  .re-pick__grid {
    grid-template-columns: 1fr;
    padding: 0 8px 10px;
  }
  .re-pick__scroll {
    max-height: 62vh;
  }
}
</style>
