<template>
  <div class="esa-modnav" role="tablist">
    <button
      v-for="it in items"
      :key="it.key"
      type="button"
      role="tab"
      class="esa-modnav__item"
      :class="{ 'esa-modnav__item--active': it.key === value }"
      :aria-selected="it.key === value"
      @click="emit('update:value', it.key)"
    >
      <span class="esa-modnav__head">
        <span class="esa-modnav__title">{{ it.label }}</span>
        <n-tag v-if="it.gate" size="tiny" :bordered="false" type="warning">{{ it.gate }}</n-tag>
      </span>
      <span v-if="it.desc" class="esa-modnav__desc">{{ it.desc }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { NTag } from 'naive-ui';

export interface EsaModuleNavItem {
  key: string;
  label: string;
  desc?: string;
  gate?: string;
}

defineProps<{ items: EsaModuleNavItem[]; value: string }>();
const emit = defineEmits<{ (e: 'update:value', v: string): void }>();
</script>

<style scoped>
.esa-modnav {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  margin-bottom: 14px;
}

.esa-modnav__item {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  min-width: 132px;
  max-width: 260px;
  padding: 9px 13px 9px 16px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.18s var(--app-ease), background 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}

.esa-modnav__item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 3px;
  background: var(--app-primary);
  opacity: 0;
  transition: opacity 0.18s var(--app-ease);
}

.esa-modnav__item:hover {
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow-sm);
}

.esa-modnav__item:hover::before,
.esa-modnav__item--active::before {
  opacity: 1;
}

.esa-modnav__item--active {
  border-color: color-mix(in srgb, var(--app-primary) 55%, var(--app-border));
  background: color-mix(in srgb, var(--app-primary) 8%, var(--app-surface));
}

.esa-modnav__head {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}

.esa-modnav__title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.esa-modnav__desc {
  font-size: 11px;
  line-height: 1.45;
  color: var(--app-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 230px;
}
</style>
