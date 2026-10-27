<template>
  <n-popover
    v-model:show="open"
    class="zone-module-menu"
    trigger="click"
    placement="bottom-end"
    :show-arrow="false"
    raw
    :style="{ boxShadow: 'none' }"
    :content-style="{ padding: '0', background: 'transparent' }"
  >
    <template #trigger>
      <n-button
        ref="triggerRef"
        size="small"
        secondary
        class="zone-module-menu__trigger"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-label="ariaLabel || currentLabel"
        :title="currentLabel"
      >
        <span class="zone-module-menu__label">{{ currentLabel }}</span>
        <n-icon :component="ChevronDownOutline" size="14" class="zone-module-menu__caret" />
      </n-button>
    </template>

    <div
      ref="panelRef"
      class="zone-module-menu__panel"
      role="menu"
      tabindex="-1"
      @keydown="onPanelKeydown"
    >
      <div v-for="item in items" :key="item.key" class="zone-module-menu__group">
        <button
          type="button"
          role="menuitem"
          class="zone-module-menu__item"
          :title="item.label"
          :class="{ 'zone-module-menu__item--active': item.key === value }"
          :aria-haspopup="hasChildren(item) ? 'menu' : undefined"
          :aria-expanded="hasChildren(item) ? expandedKey === item.key : undefined"
          @click="onItem(item)"
        >
          <span class="zone-module-menu__item-label">{{ item.label }}</span>
          <n-icon
            v-if="hasChildren(item)"
            :component="ChevronDownOutline"
            size="14"
            class="zone-module-menu__item-caret"
            :class="{ 'zone-module-menu__item-caret--open': expandedKey === item.key }"
          />
        </button>

        <div v-if="hasChildren(item) && expandedKey === item.key" class="zone-module-menu__sub" role="menu">
          <button
            v-for="child in item.children"
            :key="child.key"
            type="button"
            role="menuitem"
            class="zone-module-menu__subitem"
            :title="child.label"
            :class="{ 'zone-module-menu__subitem--active': item.key === value && child.key === currentSub }"
            @click="onChild(item, child)"
          >
            <span class="zone-module-menu__subitem-label">{{ child.label }}</span>
            <span v-if="child.gate" class="zone-module-menu__gate">{{ child.gate }}</span>
          </button>
        </div>
      </div>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { NButton, NIcon, NPopover } from 'naive-ui';
import { ChevronDownOutline } from '@vicons/ionicons5';

export interface ZoneModuleMenuSubItem {
  key: string;
  label: string;
  gate?: string;
}

export interface ZoneModuleMenuItem {
  key: string;
  label: string;
  children?: ZoneModuleMenuSubItem[];
  defaultChild?: string;
}

const props = defineProps<{
  items: ZoneModuleMenuItem[];
  value: string;
  subValue?: string;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (e: 'update:value', v: string): void;
  (e: 'update:subValue', v: string): void;
  (e: 'select', key: string, sub?: string): void;
}>();

const open = ref(false);
const expandedKey = ref<string | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const triggerRef = ref<{ $el?: HTMLElement; focus?: () => void } | null>(null);

const currentItem = computed(() => props.items.find((item) => item.key === props.value));
const currentLabel = computed(() => currentItem.value?.label || props.items[0]?.label || '');
const currentSub = computed(() => {
  const item = currentItem.value;
  if (!item?.children?.length) return '';
  return props.subValue || item.defaultChild || item.children[0].key;
});

function hasChildren(item: ZoneModuleMenuItem): boolean {
  return !!item.children?.length;
}

function scrollActiveIntoView() {
  nextTick(() => {
    requestAnimationFrame(() => {
      const active = panelRef.value?.querySelector<HTMLElement>('.zone-module-menu__subitem--active');
      active?.scrollIntoView({ block: 'nearest' });
    });
  });
}

function focusTrigger() {
  const el = triggerRef.value?.$el || (triggerRef.value as unknown as HTMLElement | null);
  el?.focus?.({ preventScroll: true } as FocusOptions);
}

function close() {
  open.value = false;
  nextTick(focusTrigger);
}

watch(open, (shown) => {
  if (!shown) {
    document.removeEventListener('keydown', onDocumentKeydown);
    return;
  }
  document.addEventListener('keydown', onDocumentKeydown);
  const item = currentItem.value;
  expandedKey.value = item && hasChildren(item) ? item.key : null;
  nextTick(() => {
    panelRef.value?.focus({ preventScroll: true });
    if (expandedKey.value) scrollActiveIntoView();
  });
});

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  open.value = false;
  nextTick(focusTrigger);
}

function onPanelKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const buttons = Array.from(
    panelRef.value?.querySelectorAll<HTMLButtonElement>('button.zone-module-menu__item, button.zone-module-menu__subitem') || [],
  );
  if (!buttons.length) return;
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown' ? Math.min(buttons.length - 1, index + 1) : Math.max(0, index - 1);
  buttons[next]?.focus();
}

function onItem(item: ZoneModuleMenuItem) {
  if (hasChildren(item)) {
    expandedKey.value = expandedKey.value === item.key ? null : item.key;
    if (expandedKey.value) scrollActiveIntoView();
    return;
  }
  emit('update:value', item.key);
  emit('select', item.key);
  close();
}

function onChild(item: ZoneModuleMenuItem, child: ZoneModuleMenuSubItem) {
  emit('update:value', item.key);
  emit('update:subValue', child.key);
  emit('select', item.key, child.key);
  close();
}

onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown));
</script>

<style scoped>
.zone-module-menu__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
}

.zone-module-menu__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-module-menu__caret {
  flex: 0 0 auto;
  opacity: 0.7;
}

.zone-module-menu__panel {
  box-sizing: border-box;
  min-width: 200px;
  max-width: 320px;
  /* 14 个一级模块 + 子项，40px 行高需要更高面板才能一屏放下 */
  max-height: min(70vh, 640px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  background: var(--app-surface);
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  box-shadow: var(--app-shadow);
  outline: none;
}

.zone-module-menu__group + .zone-module-menu__group {
  margin-top: 1px;
}

.zone-module-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  /* 32px 低于项目统一要求的 36px 触控下限，移动端容易点偏 */
  min-height: 40px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: var(--app-text);
  text-align: left;
  cursor: pointer;
  transition: background 0.16s var(--app-ease), color 0.16s var(--app-ease);
}

.zone-module-menu__item:active,
.zone-module-menu__item:focus-visible {
  background: var(--app-surface-2);
  outline: none;
}

.zone-module-menu__item--active {
  color: var(--app-primary);
  font-weight: 600;
}

.zone-module-menu__item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-module-menu__item-caret {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--app-text-3);
  opacity: 0.6;
  transition: transform 0.16s var(--app-ease);
}

.zone-module-menu__item-caret--open {
  transform: rotate(180deg);
}

.zone-module-menu__sub {
  display: flex;
  flex-direction: column;
  padding: 2px 0 4px;
}

.zone-module-menu__subitem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px 0 28px;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  color: var(--app-text-2);
  text-align: left;
  cursor: pointer;
  transition: background 0.16s var(--app-ease), color 0.16s var(--app-ease);
}

.zone-module-menu__subitem:active,
.zone-module-menu__subitem:focus-visible {
  background: var(--app-surface-2);
  outline: none;
}

.zone-module-menu__subitem--active {
  color: var(--app-primary);
  font-weight: 600;
}

.zone-module-menu__subitem-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-module-menu__gate {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 400;
  color: var(--app-text-3);
}

@media (hover: hover) and (pointer: fine) {
  .zone-module-menu__item:hover,
  .zone-module-menu__subitem:hover {
    background: var(--app-surface-2);
  }
}

@media (max-width: 767px) {
  .zone-module-menu__trigger {
    max-width: 100%;
  }

  .zone-module-menu__panel {
    max-width: calc(100vw - 24px);
    max-height: min(70vh, 520px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .zone-module-menu__item,
  .zone-module-menu__subitem,
  .zone-module-menu__item-caret {
    transition: none;
  }
}
</style>
