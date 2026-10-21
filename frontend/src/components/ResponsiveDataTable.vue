<template>
  <div ref="wrapRef" class="rdt" :class="{ 'rdt--scrollable': scrollable && !isMobile }">
    <n-data-table
      v-if="!isMobile"
      :columns="tableColumns"
      :data="data"
      :loading="loading"
      :row-key="rowKey"
      :bordered="bordered"
      :size="size"
      :striped="striped"
      :scroll-x="resolvedScrollX"
      :pagination="pagination"
      :remote="remote"
      :virtual-scroll="virtualScroll"
      :max-height="virtualScroll ? maxHeight : undefined"
      :checked-row-keys="hasSelection ? checkedRowKeys : undefined"
      :row-props="rowProps"
      @update:checked-row-keys="onUpdateChecked"
    >
      <template #empty>
        <slot name="empty">
          <EmptyState
            v-if="error"
            :icon="AlertCircleOutline"
            :title="t('common.loadFailed')"
            :description="t('common.loadFailedHint')"
            tone="error"
          >
            <template #actions>
              <n-button size="small" type="primary" @click="$emit('retry')">{{ t('common.retry') }}</n-button>
            </template>
          </EmptyState>
          <EmptyState
            v-else
            :icon="FolderOpenOutline"
            :title="emptyText || t('common.noData')"
            :description="emptyDescription"
            :tone="emptyTone"
          />
        </slot>
      </template>
    </n-data-table>
    <n-spin v-else :show="!!loading">
      <EmptyState
        v-if="!loading && !data.length && error"
        :icon="AlertCircleOutline"
        :title="t('common.loadFailed')"
        :description="t('common.loadFailedHint')"
        tone="error"
      >
        <template #actions>
          <n-button size="small" type="primary" @click="$emit('retry')">{{ t('common.retry') }}</n-button>
        </template>
      </EmptyState>
      <EmptyState v-else-if="!data.length && !loading" :icon="FolderOpenOutline" :title="emptyText || t('common.noData')" :description="emptyDescription" :tone="emptyTone" />
      <div v-else class="m-table-cards">
        <div
          v-for="(row, index) in mobileRows"
          :key="String(rowKey ? rowKey(row) : (row.id ?? index))"
          v-bind="rowProps ? rowProps(row) : {}"
          class="m-card"
        >
          <div class="m-card__head">
            <n-checkbox v-if="hasSelection" :checked="isChecked(row)" @update:checked="() => toggle(row)" />
            <div v-if="titleColumn" class="m-card__title">
              <CellRender :col="titleColumn" :row="row" :index="index" />
            </div>
          </div>
          <div v-if="restColumns.length" class="m-card__rows">
            <div v-for="col in restColumns" :key="String(col.key)" class="m-card__row">
              <div class="m-card__label">{{ col.title }}</div>
              <div class="m-card__value">
                <CellRender :col="col" :row="row" :index="index" />
              </div>
            </div>
          </div>
          <div v-if="actionColumn" class="m-card__actions">
            <CellRender :col="actionColumn" :row="row" :index="index" />
          </div>
        </div>
      </div>
      <div v-if="mobilePagination" class="rdt__pager">
        <n-pagination
          :page="mobilePagination.page"
          :page-size="mobilePagination.pageSize"
          :item-count="mobilePagination.itemCount"
          :simple="false"
          @update:page="onMobilePage"
        />
      </div>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NButton, NCheckbox, NDataTable, NPagination, NSpin } from 'naive-ui';
import { AlertCircleOutline, FolderOpenOutline } from '@vicons/ionicons5';
import { useResponsive } from '../composables/useResponsive';
import { useI18n } from 'vue-i18n';
import EmptyState from './EmptyState.vue';

const props = withDefaults(
  defineProps<{
    columns: any[];
    data: any[];
    loading?: boolean;
    rowKey?: (row: any) => any;
    checkedRowKeys?: any[];
    selectable?: boolean;
    pagination?: false | Record<string, any>;
    bordered?: boolean;
    striped?: boolean;
    size?: 'small' | 'medium' | 'large';
    scrollX?: number;
    titleKey?: string;
    emptyText?: string;
    emptyDescription?: string;
    emptyTone?: 'default' | 'error';
    /** 拉取失败：空态切换为错误态并提供重试入口 */
    error?: boolean;
    virtualScroll?: boolean;
    maxHeight?: number;
    /** 行属性（点击整行打开详情等），透传给 n-data-table */
    rowProps?: (row: any) => Record<string, any>;
  }>(),
  {
    loading: false,
    checkedRowKeys: () => [],
    selectable: undefined,
    pagination: false,
    bordered: false,
    striped: false,
    size: 'medium',
    scrollX: undefined,
    titleKey: undefined,
    emptyText: '',
    emptyDescription: '',
    emptyTone: 'default',
    error: false,
    virtualScroll: false,
    maxHeight: undefined,
    rowProps: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:checkedRowKeys', keys: any[]): void;
  (e: 'retry'): void;
}>();
const { isMobile } = useResponsive();
const { t } = useI18n();

function isSystemColumn(col: any) {
  return col?.type === 'selection' || col?.type === 'expand';
}

function isActionColumn(col: any) {
  return col?.key === 'actions' || col?.title === '操作' || col?.title === t('common.actions');
}

const hasSelection = computed(() => props.selectable ?? props.columns.some(isSystemColumn));

// 操作列优先认 key='actions'：页面可能同时存在标题为「操作」的数据列，
// 按标题匹配会把数据列误当成操作区，导致真正的操作按钮在移动端消失。
const actionColumn = computed(
  () => props.columns.find((c: any) => c?.key === 'actions') || props.columns.find(isActionColumn),
);
const dataColumns = computed(() => props.columns.filter((c) => !isSystemColumn(c) && c !== actionColumn.value));

const TITLE_KEYS = [
  'name', 'domain', 'domains', 'title', 'label', 'hostname',
  'routename', 'username', 'email', 'subject', 'rr', 'remark',
];
const titleColumn = computed(() => {
  if (props.titleKey) return props.columns.find((c) => c.key === props.titleKey);
  const cols = dataColumns.value.filter((c: any) => c.mobile !== 'hide');
  // 按 TITLE_KEYS 的优先级挑选，避免后置的 remark 等列抢占卡片标题
  for (const key of TITLE_KEYS) {
    const hit = cols.find((c) => String(c.key) === key);
    if (hit) return hit;
  }
  return cols.find((c) => String(c.key) !== 'id') || cols[0];
});
// 移动端卡片只保留主字段：列可声明 mobile: 'hide' 排除在卡片行之外
const restColumns = computed(() =>
  dataColumns.value.filter((c) => c !== titleColumn.value && (c as any).mobile !== 'hide'),
);

const wrapRef = ref<HTMLElement | null>(null);
const wrapW = ref(0);
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (!wrapRef.value) return;
  ro = new ResizeObserver(([entry]) => {
    wrapW.value = entry.contentRect.width;
  });
  ro.observe(wrapRef.value);
});
onBeforeUnmount(() => ro?.disconnect());

// 未显式传 scroll-x 时按列宽合计兜底：仅在确实放不下时生成滚动容器，
// 留 5% 压缩余量并忽略 20px 以内的差异，避免「差 6px」也长出滚动条。
const resolvedScrollX = computed(() => {
  if (props.scrollX != null) return props.scrollX;
  // 24px 为表格自身边框与单元格内边距的固定开销，纯列宽合计会低估实际宽度
  const total = props.columns.reduce((sum: number, col: any) => {
    if (isSystemColumn(col)) return sum + 40;
    return sum + (Number(col?.width) || 140);
  }, 24);
  if (!wrapW.value) return total > 1300 ? total : undefined;
  return total > wrapW.value * 1.05 && total - wrapW.value > 20 ? total : undefined;
});
const scrollable = computed(() => resolvedScrollX.value != null);

// 横向滚动时把操作列钉在右侧，避免平板/小屏必须滚动才能点到行内主操作。
// naive-ui 的固定列依赖 scroll-x，且该列需要有 width（现有操作列均满足）。
const tableColumns = computed(() => {
  if (!actionColumn.value || resolvedScrollX.value == null) return props.columns;
  return props.columns.map((c: any) =>
    c === actionColumn.value ? { ...c, fixed: 'right' as const } : c,
  );
});

const checkedSet = computed(() => new Set(props.checkedRowKeys || []));

// 服务端分页由调用方传入 itemCount（当前页数据仅一页的条数）并自行翻页；
// 不告知 naive-ui「remote」时，它会用 data.length 推导页数，导致分页器只有 1 页、桌面端无法翻页。
// 客户端分页（如 `{ pageSize: 20 }`）不传 itemCount，仍交由 naive-ui 本地切片。
const remote = computed(() => !!props.pagination && (props.pagination as any).itemCount !== undefined);

function keyOf(row: any) {
  if (props.rowKey) return props.rowKey(row);
  return row?._key ?? row?.id;
}
function isChecked(row: any) {
  return checkedSet.value.has(keyOf(row));
}
function toggle(row: any) {
  const next = new Set(checkedSet.value);
  const key = keyOf(row);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  emit('update:checkedRowKeys', Array.from(next));
}
function onUpdateChecked(keys: any[]) {
  emit('update:checkedRowKeys', keys);
}

function renderCell(col: any, row: any, index: number) {
  if (!col) return null;
  const out = typeof col.render === 'function' ? col.render(row, index) : row?.[col.key];
  if (out === null || out === undefined || out === '') return h('span', { class: 'app-muted' }, '-');
  if (typeof out === 'string' || typeof out === 'number' || typeof out === 'boolean') return h('span', null, String(out));
  return out;
}

const CellRender = (p: any) => renderCell(p.col, p.row, p.index);
(CellRender as any).props = { col: {}, row: {}, index: {} };

// 客户端分页（页面只传 `{ pageSize: 20 }`）在移动端卡片模式下需要本地切片与页码，
// 否则会渲染全量数据且没有分页器，与桌面端「每页 20 条」的语义不一致。
const localPage = ref(1);
const MOBILE_AUTO_PAGE_SIZE = 20;
const isClientPaged = computed(() => {
  const p = props.pagination;
  return isMobile.value && !!p && typeof p === 'object' && (p as any).itemCount === undefined;
});
// 未传分页的大列表在移动端自动本地分页：卡片 DOM 从全量降为每页 20 条，
// 数据仍完整保留，翻页即可访问，避免上千条数据一次创建数千个卡片与按钮。
const autoMobilePaged = computed(
  () => isMobile.value && !props.pagination && props.data.length > 100,
);
const mobileRows = computed(() => {
  if (!isMobile.value) return props.data;
  const p = props.pagination;
  if (isClientPaged.value && p && typeof p === 'object') {
    const size = Number(p.pageSize || 10);
    const start = (localPage.value - 1) * size;
    return props.data.slice(start, start + size);
  }
  if (autoMobilePaged.value) {
    const start = (localPage.value - 1) * MOBILE_AUTO_PAGE_SIZE;
    return props.data.slice(start, start + MOBILE_AUTO_PAGE_SIZE);
  }
  return props.data;
});

const mobilePagination = computed(() => {
  if (!isMobile.value) return null;
  const p = props.pagination;
  if (!p || typeof p !== 'object') {
    if (!autoMobilePaged.value) return null;
    return {
      page: localPage.value,
      pageSize: MOBILE_AUTO_PAGE_SIZE,
      itemCount: props.data.length,
    };
  }
  // 只传 itemCount/pageSize，naive-ui 会自行推导总页数，避免 page-count 与 item-count 同时出现触发告警
  const pageSize = Number(p.pageSize || 10);
  const itemCount = Number((p as any).itemCount ?? props.data.length);
  if (itemCount <= pageSize) return null;
  return {
    page: Number((p as any).page ?? localPage.value),
    pageSize,
    itemCount,
  };
});

function onMobilePage(page: number) {
  const p = props.pagination;
  if (!p || typeof p !== 'object') {
    if (autoMobilePaged.value) localPage.value = page;
    return;
  }
  if ((p as any).itemCount === undefined) localPage.value = page;
  p.onChange?.(page);
  p.onUpdatePage?.(page);
}

watch(
  () => props.data.length,
  () => {
    localPage.value = 1;
  },
);
</script>

<style scoped>
.rdt {
  position: relative;
}

/* 横向可滚动时在右缘留一条渐隐，提示还有内容；不拦截指针事件 */
.rdt--scrollable::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 12px;
  pointer-events: none;
  background: linear-gradient(to right, transparent, var(--app-surface-2));
}

.rdt__pager {
  display: flex;
  justify-content: center;
  padding: 14px 0 4px;
}

/* 固定操作列默认没有左分隔，钉住后会与相邻列看起来贴在一起 */
:deep(.n-data-table-th--fixed-right),
:deep(.n-data-table-td--fixed-right) {
  box-shadow: inset 1px 0 0 var(--app-divider), -8px 0 12px -8px rgba(0, 0, 0, 0.35);
}
</style>