<template>
  <div class="rdt">
    <n-data-table
      v-if="!isMobile"
      :columns="columns"
      :data="data"
      :loading="loading"
      :row-key="rowKey"
      :bordered="bordered"
      :size="size"
      :striped="striped"
      :scroll-x="scrollX"
      :pagination="pagination"
      :remote="remote"
      :virtual-scroll="virtualScroll"
      :max-height="virtualScroll ? maxHeight : undefined"
      :checked-row-keys="hasSelection ? checkedRowKeys : undefined"
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
          v-for="(row, index) in data"
          :key="String(rowKey ? rowKey(row) : (row.id ?? index))"
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
          :page-count="mobilePagination.pageCount"
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
import { computed, h } from 'vue';
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

const dataColumns = computed(() => props.columns.filter((c) => !isSystemColumn(c) && !isActionColumn(c)));
const actionColumn = computed(() => props.columns.find(isActionColumn));

const TITLE_KEYS = ['name', 'domain', 'title', 'label', 'hostname', 'routename', 'username', 'email', 'subject', 'remark'];
const titleColumn = computed(() => {
  if (props.titleKey) return props.columns.find((c) => c.key === props.titleKey);
  const cols = dataColumns.value;
  const preferred = cols.find((c) => TITLE_KEYS.includes(String(c.key)));
  if (preferred) return preferred;
  return cols.find((c) => String(c.key) !== 'id') || cols[0];
});
const restColumns = computed(() => dataColumns.value.filter((c) => c !== titleColumn.value));

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

const mobilePagination = computed(() => {
  const p = props.pagination;
  if (!isMobile.value || !p || typeof p !== 'object') return null;
  // 调用方通常只传 itemCount/pageSize（naive-ui 风格），此处按需推导总页数
  const pageSize = Number(p.pageSize || 10);
  const pageCount = Number(p.pageCount ?? 0) || Math.ceil(Number(p.itemCount ?? 0) / (pageSize > 0 ? pageSize : 10));
  if (!pageCount || pageCount <= 1) return null;
  return {
    page: Number(p.page ?? 1),
    pageCount,
    pageSize: p.pageSize,
    itemCount: p.itemCount,
  };
});

function onMobilePage(page: number) {
  const p = props.pagination;
  if (p && typeof p === 'object') {
    p.onChange?.(page);
    p.onUpdatePage?.(page);
  }
}
</script>

<style scoped>
.rdt__pager {
  display: flex;
  justify-content: center;
  padding: 14px 0 4px;
}
</style>