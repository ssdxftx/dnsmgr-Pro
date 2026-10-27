<template>
  <div class="detail-grid" :class="{ 'detail-grid--wide': cols === 1 }">
    <div v-for="(it, i) in items" :key="it.key ?? i" class="detail-grid__item">
      <span class="detail-grid__label">{{ it.label }}</span>
      <span
        class="detail-grid__value"
        :class="{ 'is-mono': it.mono, 'is-numeric': it.numeric, [`is-${it.tone}`]: it.tone && it.tone !== 'default' }"
      >
        <slot v-if="it.slot" :name="it.slot" />
        <template v-else>{{ display(it.value) }}</template>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 详情字段网格。
 *
 * 原来站点概览这类页面用 `n-descriptions :column="2" label-placement="left"`：
 * 390px 下每格只剩 ~170px，中文标签「实例 ID」「源站区域」把值挤到换行，
 * 而 naive 的 label 列宽按最长标签算，四行标签宽度还不一致。
 *
 * 这里桌面保持两列、标签左值右；窄屏收敛成单列，label 与 value 两端对齐，
 * 值右对齐并允许换行——与移动端卡片行的读法一致。
 */
export interface DetailItem {
  key?: string | number;
  label: string;
  value?: string | number | null;
  /** 等宽字体（实例 ID、Zone ID 这类标识） */
  mono?: boolean;
  /** 数字等宽对齐（计数类） */
  numeric?: boolean;
  /** 值语义色 */
  tone?: 'default' | 'success' | 'warning' | 'error';
  /** 具名插槽：值为标签、按钮等自定义内容时使用 */
  slot?: string;
}

withDefaults(defineProps<{ items: DetailItem[]; cols?: 1 | 2 }>(), { cols: 2 });

function display(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === '') return '-';
  return v;
}
</script>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 8px;
  border-top: 1px solid var(--app-divider);
}
.detail-grid--wide {
  grid-template-columns: minmax(0, 1fr);
}
.detail-grid__item {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 9px 6px;
  border-bottom: 1px solid var(--app-divider);
  min-width: 0;
}
.detail-grid__label {
  flex: 0 0 auto;
  min-width: 76px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--app-text-3);
  white-space: nowrap;
}
.detail-grid__value {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--app-text);
  word-break: break-word;
}
.detail-grid__value.is-mono {
  font-family: var(--app-font-mono);
  font-size: 12.5px;
  word-break: break-all;
}
.detail-grid__value.is-numeric {
  font-variant-numeric: tabular-nums;
}
.detail-grid__value.is-success {
  color: var(--app-success);
}
.detail-grid__value.is-warning {
  color: var(--app-warning);
}
.detail-grid__value.is-error {
  color: var(--app-error);
}

/* 窄屏：单列 + 两端对齐，标签不再和值抢同一行前 76px */
@media (max-width: 767.98px) {
  .detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail-grid__item {
    justify-content: space-between;
    gap: 16px;
    padding: 10px 2px;
  }
  .detail-grid__value {
    flex: 0 1 auto;
    text-align: right;
  }
}
</style>
