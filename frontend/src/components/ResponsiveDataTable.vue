<template>
  <div ref="wrapRef" class="rdt" :class="{ 'rdt--scrollable': scrollable && !isMobile }">
    <!-- 首屏骨架：仅在「无数据 + 加载超过 240ms」时出现，避免快请求闪一下 -->
    <div v-if="showSkeleton" class="rdt-skeleton" :class="{ 'rdt-skeleton--mobile': isMobile }">
      <template v-if="isMobile">
        <div v-for="i in 3" :key="i" class="sk-card">
          <div class="sk-line sk-title" />
          <div class="sk-line" />
          <div class="sk-line sk-short" />
        </div>
      </template>
      <template v-else>
        <div v-for="i in 5" :key="i" class="sk-row">
          <span class="sk-cell" />
          <span class="sk-cell" />
          <span class="sk-cell sk-cell--wide" />
          <span class="sk-cell" />
        </div>
      </template>
    </div>
    <n-data-table
      v-else-if="!isMobile"
      ref="tableRef"
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
      <transition-group v-else name="card-list" tag="div" class="m-table-cards">
        <div
          v-for="(row, index) in mobileRows"
          :key="rowKeyOf(row, index)"
          v-bind="rowProps ? rowProps(row) : {}"
          class="m-card"
          :class="{ 'is-checked': hasSelection && isChecked(row), 'is-clickable': isClickableRow(row) }"
        >
          <div class="m-card__head">
            <n-checkbox v-if="hasSelection" :checked="isChecked(row)" @update:checked="() => toggle(row)" />
            <div v-if="titleColumn" class="m-card__title">
              <CellRender :col="titleColumn" :row="row" :index="index" />
              <div v-if="subtitleColumn" class="m-card__subtitle">
                <CellRender :col="subtitleColumn" :row="row" :index="index" />
              </div>
            </div>
            <div v-if="statusColumn && !isCellEmpty(statusColumn, row)" class="m-card__status">
              <CellRender :col="statusColumn" :row="row" :index="index" />
            </div>
          </div>
          <!-- 空值字段不占行：4 行里 2 行是空的情况此前会浪费近一半卡片高度 -->
          <div v-if="visibleCols(row).length" class="m-card__rows" :class="{ 'is-clamped': isClamped(row) }">
            <div v-for="col in visibleCols(row)" :key="String(col.key)" class="m-card__row">
              <div class="m-card__label">{{ col.title }}</div>
              <div class="m-card__value">
                <CellRender :col="col" :row="row" :index="index" />
              </div>
            </div>
          </div>
          <div v-else class="m-card__empty-row">{{ t('common.noExtraInfo') }}</div>
          <button v-if="isClamped(row)" type="button" class="m-card__more" @click.stop="toggleExpand(row)">
            {{ t('common.expandAll', { n: visibleCols(row).length }) }}
          </button>
          <button v-else-if="isExpanded(row) && visibleCols(row).length > collapseAfter" type="button" class="m-card__more" @click.stop="toggleExpand(row)">
            {{ t('common.collapseList') }}
          </button>
          <div v-if="actionColumn" class="m-card__actions">
            <CellRender :col="actionColumn" :row="row" :index="index" />
          </div>
        </div>
      </transition-group>
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
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
    /** 移动端卡片默认展示的字段行数，超出折叠 */
    collapseAfter?: number;
    /** 卡片标题下方的副标题字段（补充上下文，如记录类型 / 账户名） */
    subtitleKey?: string;
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
    collapseAfter: 5,
    subtitleKey: undefined,
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
  const cols = dataColumns.value.filter((c: any) => c.mobile !== 'hide' && c.mobile !== 'status');
  // 按 TITLE_KEYS 的优先级挑选，避免后置的 remark 等列抢占卡片标题
  for (const key of TITLE_KEYS) {
    const hit = cols.find((c) => String(c.key) === key);
    if (hit) return hit;
  }
  return cols.find((c) => String(c.key) !== 'id') || cols[0];
});

// 状态列提升到卡片标题行：状态埋在字段中部时，扫一屏看不出哪些是异常项。
// 列可声明 mobile: 'status' 显式指定；否则按常见 key 推断。
const STATUS_KEYS = ['status', 'state', 'result', 'enabled', 'open', 'is_open'];
const statusColumn = computed(() => {
  const explicit = dataColumns.value.find((c: any) => c.mobile === 'status');
  if (explicit) return explicit;
  const hit = dataColumns.value.find((c: any) => STATUS_KEYS.includes(String(c.key ?? '').toLowerCase()));
  return hit && hit !== titleColumn.value ? hit : undefined;
});

// 移动端卡片只保留主字段：列可声明 mobile: 'hide' 排除在卡片行之外
const subtitleColumn = computed(() =>
  props.subtitleKey ? props.columns.find((c: any) => c.key === props.subtitleKey) : undefined,
);
const restColumns = computed(() =>
  dataColumns.value.filter(
    (c) =>
      c !== titleColumn.value &&
      c !== statusColumn.value &&
      c !== subtitleColumn.value &&
      (c as any).mobile !== 'hide',
  ),
);

/**
 * 空值判断：带 render 的列此前被一律当作非空，导致空字段仍占一整行。
 * 但也不能简单看原始字段——「备注」为空时 render 返回的是「添加备注」按钮，
 * 属于操作入口，不能隐藏。因此按渲染结果判断：
 *   纯文本 / span 且内容为空或 '-' → 视为空；
 *   组件（按钮、标签、组合布局）→ 一律保留。
 */
function isCellEmpty(col: any, row: any) {
  if (!col) return true;

  if (typeof col.render === 'function') {
    const out = col.render(row, 0);
    if (out === null || out === undefined || out === '') return true;
    if (typeof out === 'string') return out.trim() === '' || out.trim() === '-';
    if (typeof out === 'object') {
      const nodeType = (out as any).type;
      if (nodeType === 'span' || nodeType === 'div' || nodeType === 'p') {
        const children = (out as any).children;
        // 容器里含 VNode（如「值 + 查看按钮」组合）时不能按文本判空
        if (Array.isArray(children) && children.some((c: any) => typeof c !== 'string')) return false;
        const text =
          typeof children === 'string'
            ? children
            : Array.isArray(children)
              ? children.join('')
              : '';
        const t = String(text).trim();
        return t === '' || t === '-';
      }
      // 交互组件（按钮/开关/标签）不能因为值为空就隐藏——「添加备注」这类入口否则会消失
      const name = typeof nodeType === 'function' ? (nodeType as any).name || (nodeType as any).__name || '' : '';
      if (/Button|Tag|Switch|Checkbox|Input/i.test(name)) return false;
      // 其余包装组件（NEllipsis 等）回落到原始字段判断
      const raw = row?.[col.key];
      return raw === null || raw === undefined || raw === '' || raw === '-';
    }
    return false;
  }

  const raw = row?.[col.key];
  return raw === null || raw === undefined || raw === '' || raw === '-';
}

function visibleCols(row: any) {
  return restColumns.value.filter((c) => !isCellEmpty(c, row));
}

/* ---------------- 选中 / 折叠 ---------------- */

const expandedKeys = ref<Set<string>>(new Set());
const collapseAfter = computed(() => props.collapseAfter);

function rowKeyOf(row: any, index: number) {
  if (props.rowKey) return String(props.rowKey(row));
  return String(row?._key ?? row?.id ?? index);
}

function isExpanded(row: any) {
  return expandedKeys.value.has(rowKeyOf(row, 0));
}

function isClamped(row: any) {
  return visibleCols(row).length > collapseAfter.value && !isExpanded(row);
}

function toggleExpand(row: any) {
  const key = rowKeyOf(row, 0);
  const next = new Set(expandedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedKeys.value = next;
}

function isClickableRow(row: any) {
  return typeof props.rowProps?.(row)?.onClick === 'function';
}

/* ---------------- 横向滚动：以实测宽度为准 ---------------- */

const wrapRef = ref<HTMLElement | null>(null);
const tableRef = ref<any>(null);
const wrapW = ref(0);
const measuredScrollX = ref<number | undefined>(undefined);
let ro: ResizeObserver | null = null;

/**
 * 原实现用「列宽累加」估算 scroll-x，但 minWidth 列会被长文本撑开
 * （实测备注列 120 → 402px），估算值 994 < 容器 1114 判定「放得下」，
 * 实际表格 1278px，最后一列被推出视口且没有滚动提示。
 *
 * 注意不能读 .n-data-table-base-table-body 的 scrollWidth：naive 用 n-scrollbar
 * 包裹，overflow-x: hidden 时该值恒等于 clientWidth，测不出溢出。
 * 直接量 <table> 渲染宽度，与宿主容器比较。
 */
function measureNaturalWidth() {
  if (props.scrollX != null) return;
  const root = tableRef.value?.$el as HTMLElement | undefined;
  const table = root?.querySelector('table') as HTMLElement | null;
  const host = wrapRef.value;
  if (!table || !host) return;
  const natural = Math.ceil(table.getBoundingClientRect().width);
  const avail = host.clientWidth;
  if (natural > avail + 4) measuredScrollX.value = natural;
}

async function remeasure() {
  if (props.scrollX != null) return;
  measuredScrollX.value = undefined;
  await nextTick();
  requestAnimationFrame(() => measureNaturalWidth());
}

onMounted(() => {
  if (!wrapRef.value) return;
  ro = new ResizeObserver(([entry]) => {
    wrapW.value = entry.contentRect.width;
  });
  ro.observe(wrapRef.value);
  void remeasure();
});
onBeforeUnmount(() => {
  ro?.disconnect();
});

/**
 * 首屏骨架：只在「无数据 + 加载中」时挂载，显现时机交给 CSS 的 240ms 延迟，
 * 避免 mock / 本地缓存这类瞬时返回也闪一下。
 */
const showSkeleton = computed(() => props.loading && !props.data.length);

watch([() => props.columns, () => props.data], () => {
  expandedKeys.value = new Set();
  void remeasure();
});

const resolvedScrollX = computed(() => {
  if (props.scrollX != null) return props.scrollX;
  if (measuredScrollX.value != null) return measuredScrollX.value;
  // 首帧兜底：仍未测出时按列宽累加给一个保守值，避免长文本表格先闪一帧裁切
  const total = props.columns.reduce((sum: number, col: any) => {
    if (isSystemColumn(col)) return sum + 40;
    const w = Number(col?.width) || Number(col?.minWidth) || 140;
    return sum + w;
  }, 24);
  return total > (wrapW.value || 1200) ? total : undefined;
});
const scrollable = computed(() => resolvedScrollX.value != null);

// 横向滚动时把操作列钉在右侧，避免平板/小屏必须滚动才能点到行内主操作。
const tableColumns = computed(() => {
  if (!actionColumn.value || resolvedScrollX.value == null) return props.columns;
  return props.columns.map((c: any) =>
    c === actionColumn.value ? { ...c, fixed: 'right' as const } : c,
  );
});

const checkedSet = computed(() => new Set(props.checkedRowKeys || []));

// 服务端分页由调用方传入 itemCount（当前页数据仅一页的条数）并自行翻页；
// 不告知 naive-ui「remote」时，它会用 data.length 推导页数，导致分页器只有 1 页、桌面端无法翻页。
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

/* 卡片增删：只做入场（翻页时整列替换，leave 动画会让人眼花） */
.card-list-enter-active {
  transition: opacity 0.2s var(--app-ease), transform 0.2s var(--app-ease);
}
.card-list-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

/* ---- 首屏骨架 ---- */
.rdt-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0;
  /* 立即挂载、延迟显现：240ms 内返回的请求不会看到骨架闪一下 */
  opacity: 0;
  animation: sk-appear 0.01s linear 0.24s forwards;
}
@keyframes sk-appear {
  to {
    opacity: 1;
  }
}
.sk-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1.6fr 0.8fr;
  gap: 16px;
  height: 18px;
}
.sk-cell,
.sk-line {
  border-radius: 6px;
  background: var(--app-surface-2);
  animation: sk-pulse 1.4s var(--app-ease) infinite;
}
.rdt-skeleton--mobile {
  gap: 12px;
}
.sk-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--app-surface);
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
}
.sk-line {
  height: 12px;
}
.sk-title {
  height: 16px;
  width: 55%;
}
.sk-short {
  width: 70%;
}
@keyframes sk-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 0.95;
  }
}

/* 固定操作列默认没有左分隔，钉住后会与相邻列看起来贴在一起 */
:deep(.n-data-table-th--fixed-right),
:deep(.n-data-table-td--fixed-right) {
  box-shadow: inset 1px 0 0 var(--app-divider), -8px 0 12px -8px rgba(0, 0, 0, 0.35);
}
</style>
