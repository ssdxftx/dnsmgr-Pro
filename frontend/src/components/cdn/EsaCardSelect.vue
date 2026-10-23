<template>
  <div
    ref="rootRef"
    class="esa-cards"
    :class="{ 'esa-cards--compact': compact, 'esa-cards--dense': dense, 'esa-cards--disabled': disabled }"
  >
    <button
      type="button"
      class="esa-cards__trigger"
      :class="{ 'esa-cards__trigger--open': open }"
      role="combobox"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :disabled="disabled"
      @click="toggle"
    >
      <template v-if="multiSummary">
        <span class="esa-cards__head">
          <span class="esa-cards__title">
            {{ t('common.selected') }} {{ selectedOptions.length }}
            <span v-if="dense" class="esa-cards__title-extra"> · {{ selectedLabels }}</span>
          </span>
          <span
            v-if="clearable && hasValue"
            class="esa-cards__clear"
            role="button"
            tabindex="0"
            @click.stop="clear"
            @keydown.enter.stop.prevent="clear"
          >
            <n-icon :component="CloseOutline" />
          </span>
          <n-icon class="esa-cards__arrow" :component="ChevronDownOutline" />
        </span>
        <span class="esa-cards__desc">{{ selectedLabels }}</span>
        <code class="esa-cards__code">{{ selectedValues }}</code>
      </template>
      <template v-else-if="displayOption">
        <span class="esa-cards__head">
          <span class="esa-cards__title">{{ displayOption.label }}</span>
          <span v-if="displayOption.tag" class="esa-cards__tag">{{ displayOption.tag }}</span>
          <span
            v-if="clearable && hasValue"
            class="esa-cards__clear"
            role="button"
            tabindex="0"
            @click.stop="clear"
            @keydown.enter.stop.prevent="clear"
          >
            <n-icon :component="CloseOutline" />
          </span>
          <n-icon class="esa-cards__arrow" :component="ChevronDownOutline" />
        </span>
        <span v-if="displayOption.desc" class="esa-cards__desc">{{ displayOption.desc }}</span>
        <code class="esa-cards__code">{{ displayOption.value }}</code>
      </template>
      <span v-else class="esa-cards__placeholder">{{ placeholder || t('common.pleaseSelect') }}</span>
    </button>

    <Teleport :to="teleportTarget">
      <div v-if="open" class="esa-cards__overlay" @click.self="open = false">
        <div
          ref="panelRef"
          class="esa-cards__panel"
          :class="{ 'esa-cards__panel--compact': compact }"
          :style="panelStyle"
          role="listbox"
          :aria-multiselectable="multiple"
        >
          <div v-if="showSearch" class="esa-cards__search">
            <n-input
              v-model:value="keyword"
              size="small"
              clearable
              :placeholder="t('common.search')"
            />
          </div>
          <template v-for="sec in sections" :key="sec.key">
            <div v-if="sec.label" class="esa-cards__section">
              <span class="esa-cards__section-name">{{ sec.label }}</span>
              <span class="esa-cards__section-count">{{ sec.options.length }}</span>
            </div>
            <div class="esa-cards__grid">
              <button
                v-for="opt in sec.options"
                :key="String(opt.value)"
                type="button"
                role="option"
                class="esa-cards__item"
                :class="{ 'esa-cards__item--active': isActive(opt.value) }"
                :aria-selected="isActive(opt.value)"
                @click="onPick(opt.value)"
              >
                <span class="esa-cards__head">
                  <span class="esa-cards__title">{{ opt.label }}</span>
                  <span v-if="opt.tag && !groups?.length" class="esa-cards__tag">{{ opt.tag }}</span>
                  <n-icon v-if="isActive(opt.value)" class="esa-cards__check" :component="CheckmarkOutline" />
                </span>
                <span v-if="opt.desc" class="esa-cards__desc">{{ opt.desc }}</span>
                <code class="esa-cards__code">{{ opt.value }}</code>
              </button>
            </div>
          </template>
          <button v-if="canCreate" type="button" class="esa-cards__create" @click="createValue">
            <n-icon :component="AddOutline" />
            <span>{{ t('common.add') }} “{{ keyword.trim() }}”</span>
          </button>
          <div v-if="!total" class="esa-cards__empty">{{ t('common.noData') }}</div>
          <div v-if="multiple" class="esa-cards__footer">
            <n-button size="small" type="primary" @click="open = false">{{ t('common.confirm') }}</n-button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NButton, NIcon, NInput } from 'naive-ui';
import { AddOutline, CheckmarkOutline, ChevronDownOutline, CloseOutline } from '@vicons/ionicons5';
import { useI18n } from 'vue-i18n';

export interface EsaCardOption {
  label: string;
  value: any;
  desc?: string;
  /** 触发器上的小标签（如动作所属分组） */
  tag?: string;
  /** 所属分组 key（配合 groups 使用） */
  group?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: any;
    options: EsaCardOption[];
    placeholder?: string;
    compact?: boolean;
    multiple?: boolean;
    clearable?: boolean;
    searchable?: boolean;
    disabled?: boolean;
    dense?: boolean;
    unlistedLabel?: string;
    /** 分组定义：按给定顺序渲染分组标题，未归组的选项兜底展示 */
    groups?: { key: string; label: string }[];
    /** 多选时允许在搜索框输入新值并添加（如自定义域名） */
    creatable?: boolean;
  }>(),
  {
    placeholder: '',
    compact: false,
    multiple: false,
    clearable: false,
    searchable: false,
    disabled: false,
    dense: false,
    unlistedLabel: '',
    groups: () => [],
    creatable: false,
  },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: any): void }>();

const { t, locale } = useI18n();
const open = ref(false);
const keyword = ref('');
const rootRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const teleportTarget = ref<string | HTMLElement>('body');
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth);

const values = computed<any[]>(() => {
  if (!props.multiple) return [props.modelValue];
  return Array.isArray(props.modelValue) ? props.modelValue : [];
});
const allOptions = computed<EsaCardOption[]>(() => {
  if (!props.unlistedLabel) return props.options;
  const known = new Set(props.options.map((opt) => String(opt.value)));
  const extra = values.value
    .filter((v) => v !== null && v !== undefined && v !== '' && !known.has(String(v)))
    .map((v) => ({ label: String(v), value: v, desc: props.unlistedLabel }));
  return extra.length ? [...props.options, ...extra] : props.options;
});
const selectedOptions = computed(() => allOptions.value.filter((opt) => values.value.includes(opt.value)));
const selected = computed(() => {
  const matched = allOptions.value.find((opt) => opt.value === props.modelValue);
  if (matched) return matched;
  const hasRaw = props.modelValue !== null && props.modelValue !== undefined && props.modelValue !== '';
  return hasRaw && props.unlistedLabel
    ? { label: String(props.modelValue), value: props.modelValue, desc: props.unlistedLabel }
    : undefined;
});
const displayOption = computed(() => (props.multiple ? (selectedOptions.value.length === 1 ? selectedOptions.value[0] : undefined) : selected.value));
const multiSummary = computed(() => props.multiple && selectedOptions.value.length > 1);
const selectedLabels = computed(() => selectedOptions.value.map((opt) => opt.label).join(String(locale.value).startsWith('zh') ? '、' : ', '));
const selectedValues = computed(() => selectedOptions.value.map((opt) => String(opt.value)).join(', '));
const hasValue = computed(() => (props.multiple ? selectedOptions.value.length > 0 : props.modelValue !== null && props.modelValue !== undefined && props.modelValue !== ''));
const showSearch = computed(() => props.searchable || props.options.length > 8);
const filteredOptions = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return allOptions.value;
  return allOptions.value.filter((opt) =>
    [opt.label, opt.desc, opt.tag, String(opt.value)].filter(Boolean).join(' ').toLowerCase().includes(kw),
  );
});
const sections = computed(() => {
  const matched = filteredOptions.value;
  if (!props.groups?.length) return [{ key: '_', label: '', options: matched }];
  const known = new Set(props.groups.map((g) => g.key));
  const sections = props.groups.map((g) => ({
    key: g.key,
    label: g.label,
    options: matched.filter((opt) => opt.group === g.key),
  }));
  const orphans = matched.filter((opt) => !opt.group || !known.has(opt.group));
  if (orphans.length) sections.push({ key: '__other', label: '', options: orphans });
  return sections.filter((sec) => sec.options.length);
});
const total = computed(() => sections.value.reduce((n, sec) => n + sec.options.length, 0));
const canCreate = computed(() => {
  if (!props.creatable || !props.multiple) return false;
  const kw = keyword.value.trim();
  if (!kw) return false;
  return !props.options.some((opt) => String(opt.value) === kw) && !values.value.some((v) => String(v) === kw);
});

function isActive(value: any) {
  return props.multiple ? values.value.includes(value) : value === props.modelValue;
}

const layout = computed(() => {
  const count = total.value;
  const vw = viewportWidth.value;
  const maxCols = vw >= 1180 ? 4 : vw >= 860 ? 3 : vw >= 560 ? 2 : 1;
  let cols = 1;
  if (count === 2) cols = 2;
  else if (count === 3) cols = 3;
  else if (count >= 4) cols = Math.min(4, Math.ceil(Math.sqrt(count)));
  cols = Math.max(1, Math.min(cols, maxCols));
  let width = 380;
  if (count === 2) width = 760;
  else if (count === 3) width = 1080;
  else if (count >= 4 && cols === 2) width = 760;
  else if (count >= 4 && cols === 3) width = 1080;
  else if (count >= 4) width = 1180;
  width = Math.min(width, vw - 64);
  const gap = 12;
  return {
    cols,
    width,
    cardWidth: `calc((100% - ${(cols - 1) * gap}px) / ${cols})`,
  };
});
const panelStyle = computed<Record<string, string>>(() => ({
  width: `${layout.value.width}px`,
  '--esa-card-w': layout.value.cardWidth,
}));

function toggle() {
  if (props.disabled) return;
  if (!open.value) {
    // 模态框内需要把面板挂到模态框内部，否则焦点会被模态框的焦点陷阱抢走，搜索框无法输入
    teleportTarget.value = (rootRef.value?.closest('.n-modal') as HTMLElement | null) || 'body';
  }
  open.value = !open.value;
}

watch(open, (v) => {
  if (!v) keyword.value = '';
});

function onPick(value: any) {
  if (props.multiple) {
    const next = [...values.value];
    const index = next.indexOf(value);
    if (index >= 0) next.splice(index, 1);
    else next.push(value);
    emit('update:modelValue', next);
    return;
  }
  emit('update:modelValue', value);
  open.value = false;
}

function clear() {
  emit('update:modelValue', props.multiple ? [] : null);
  open.value = false;
}

function createValue() {
  const kw = keyword.value.trim();
  if (!kw) return;
  emit('update:modelValue', [...values.value, kw]);
  keyword.value = '';
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return;
  const target = event.target as Node;
  if (rootRef.value?.contains(target) || panelRef.value?.contains(target)) return;
  open.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return;
  event.stopImmediatePropagation();
  open.value = false;
}

function onResize() {
  viewportWidth.value = window.innerWidth;
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onResize);
});
</script>

<style scoped>
.esa-cards {
  position: relative;
  width: 100%;
}

/* 触发框：尺寸与卡片一致，选中后卡片内容完整嵌入框内 */
.esa-cards__trigger {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  width: 100%;
  min-height: 96px;
  padding: 14px 16px 14px 20px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease), background 0.18s var(--app-ease);
}

.esa-cards__trigger:hover,
.esa-cards__trigger--open {
  border-color: color-mix(in srgb, var(--app-primary) 45%, var(--app-border));
  box-shadow: var(--app-shadow);
}

.esa-cards__trigger:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}

.esa-cards__placeholder {
  color: var(--app-text-3);
  font-size: 13px;
}

/* 弹窗式卡片面板：固定在屏幕正中，按卡片数量自适应列数与宽度；直接呈现避免淡入结束时的重绘闪烁 */
.esa-cards__overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: clamp(16px, 5vh, 48px) clamp(16px, 4vw, 64px);
  background: color-mix(in srgb, #0f172a 36%, transparent);
}

.esa-cards__panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
  max-width: 100%;
  max-height: 100%;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--app-border);
  border-radius: 16px;
  background: var(--app-surface);
  box-shadow: 0 24px 64px color-mix(in srgb, #0f172a 24%, transparent);
}

.esa-cards__grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  width: 100%;
}

.esa-cards__grid .esa-cards__item {
  flex: 0 0 var(--esa-card-w, 100%);
  width: var(--esa-card-w, 100%);
  max-width: var(--esa-card-w, 100%);
}

.esa-cards__item {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  width: 100%;
  min-height: 96px;
  padding: 14px 16px 14px 20px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.18s var(--app-ease), background 0.18s var(--app-ease);
}

.esa-cards__item::before {
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
  transition: opacity 0.18s var(--app-ease);
}

/* 触摸设备不应用 hover，避免面板打开时指针下的卡片闪一下 */
@media (hover: hover) and (pointer: fine) {
  .esa-cards__item:hover {
    border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
    background: var(--app-surface-2);
  }

  .esa-cards__item:hover::before {
    opacity: 1;
  }
}

.esa-cards__item:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}

.esa-cards__item--active {
  border-color: color-mix(in srgb, var(--app-primary) 55%, var(--app-border));
  background: var(--app-primary-weak);
}

.esa-cards__item--active::before {
  opacity: 1;
}

.esa-cards__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.esa-cards__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--app-text-1);
}

.esa-cards__arrow {
  flex: 0 0 auto;
  font-size: 16px;
  color: var(--app-text-3);
  transition: transform 0.18s var(--app-ease), color 0.18s var(--app-ease);
}

.esa-cards__trigger--open .esa-cards__arrow {
  transform: rotate(180deg);
  color: var(--app-primary);
}

.esa-cards__check {
  flex: 0 0 auto;
  font-size: 16px;
  color: var(--app-primary);
}

.esa-cards__clear {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--app-text-3);
  cursor: pointer;
  transition: color 0.18s var(--app-ease), background 0.18s var(--app-ease);
}

.esa-cards__clear:hover {
  color: var(--app-text-1);
  background: var(--app-bg-soft);
}

.esa-cards__search {
  position: sticky;
  top: -16px;
  z-index: 2;
  margin-top: -4px;
  padding: 12px 0 10px;
  background: var(--app-surface);
}

.esa-cards__empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--app-text-3);
}

.esa-cards__footer {
  position: sticky;
  bottom: -16px;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  margin-bottom: -4px;
  padding: 10px 0 16px;
  border-top: 1px solid var(--app-divider);
  background: var(--app-surface);
}

.esa-cards--disabled .esa-cards__trigger {
  opacity: 0.6;
  cursor: not-allowed;
}

.esa-cards__title-extra {
  font-weight: 400;
  color: var(--app-text-3);
}

.esa-cards__tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--app-primary-weak);
  font-family: var(--app-font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--app-primary);
}

.esa-cards__section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  padding: 6px 4px 0;
  background: var(--app-surface);
}

.esa-cards__section-name {
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--app-text-2);
}

.esa-cards__section-count {
  padding: 0 6px;
  border: 1px solid var(--app-divider);
  border-radius: 999px;
  background: var(--app-bg-soft);
  font-family: var(--app-font-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--app-text-3);
}

.esa-cards__create {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  border: 1px dashed color-mix(in srgb, var(--app-primary) 45%, var(--app-border));
  border-radius: var(--app-radius);
  background: var(--app-primary-weak);
  font: inherit;
  font-size: 13px;
  color: var(--app-primary);
  cursor: pointer;
}

.esa-cards__create:hover {
  border-color: var(--app-primary);
}

.esa-cards__desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--app-text-3);
}

.esa-cards__code {
  margin-top: auto;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--app-bg-soft);
  font-family: var(--app-font-mono);
  font-size: 10.5px;
  color: var(--app-text-3);
  word-break: break-all;
}

.esa-cards__item--active .esa-cards__code {
  background: var(--app-surface);
}

.esa-cards--compact .esa-cards__trigger,
.esa-cards__panel--compact .esa-cards__item {
  min-height: 64px;
  gap: 4px;
  padding: 10px 12px 10px 16px;
}

.esa-cards--dense .esa-cards__trigger {
  min-height: 32px;
  gap: 2px;
  padding: 5px 8px;
  border-radius: var(--app-radius-sm);
}

.esa-cards--dense .esa-cards__desc,
.esa-cards--dense .esa-cards__code {
  display: none;
}

.esa-cards--dense .esa-cards__title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.esa-cards--dense .esa-cards__arrow {
  font-size: 14px;
}

</style>
