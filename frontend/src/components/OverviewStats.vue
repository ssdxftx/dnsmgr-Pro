<template>
  <div class="ov-stats" :style="{ '--ov-cols': effectiveCols }">
    <div v-for="(it, i) in items" :key="i" class="ov-stat" :class="`is-${it.tone || 'default'}`">
      <span class="ov-stat__label">{{ it.label }}</span>
      <span class="ov-stat__value" :class="{ 'is-text': isText(it.value) }">
        {{ it.value ?? '-' }}<span v-if="it.suffix" class="ov-stat__suffix">{{ it.suffix }}</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/**
 * 页面顶部「概览数字」条。
 *
 * 原来 11 个页面各写一份 `n-descriptions :column="3" label-placement="top"`，
 * 三个纯计数被当成描述项排开：没有数字层级、没有语义色，移动端三列各 ~110px 还会挤。
 * 统一成指标条：数值 18px 等宽、标签 11px、可带语义色，窄屏自动 2 列。
 */
export interface OverviewStatItem {
  label: string;
  value: string | number | null | undefined;
  suffix?: string;
  tone?: 'default' | 'success' | 'warning' | 'error' | 'info';
}

const props = withDefaults(defineProps<{ items: OverviewStatItem[]; cols?: number }>(), { cols: 3 });

// 只有 2 个指标时按 3 列排会右侧空一格，改为按实际数量平分
const effectiveCols = computed(() => Math.min(props.cols, Math.max(1, props.items.length)));

/** 时间串、凭证来源这类长文本改用正文字体与较小字号，避免等宽 18px 把卡片撑破 */
function isText(v: string | number | null | undefined) {
  return typeof v === 'string' && v.trim().length > 6;
}
</script>

<style scoped>
.ov-stats {
  display: grid;
  grid-template-columns: repeat(var(--ov-cols, 3), minmax(0, 1fr));
  gap: 10px;
}

.ov-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 8px 12px;
  border-radius: var(--app-radius-sm);
  /* 指标条落在白色面板内，用次级表面形成「面板里的一排槽位」，
     否则与面板同白，只剩 1px 极浅边线可辨 */
  background: var(--app-panel-sunken);
  border: 1px solid var(--app-divider);
}

.ov-stat__label {
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--app-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ov-stat__value {
  font-family: var(--app-font-mono);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
}

.ov-stat__value.is-text {
  font-family: var(--app-font-body);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ov-stat__suffix {
  margin-left: 2px;
  font-size: 11px;
  font-weight: 400;
  color: var(--app-text-3);
}

.is-success .ov-stat__value {
  color: var(--app-success);
}
.is-warning .ov-stat__value {
  color: var(--app-warning);
}
.is-error .ov-stat__value {
  color: var(--app-error);
}
.is-info .ov-stat__value {
  color: var(--app-info);
}

@media (max-width: 767.98px) {
  .ov-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  /* 奇数项末位跨列，避免 3 个指标排成 2+1 留半屏空白 */
  .ov-stat:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
}
</style>
