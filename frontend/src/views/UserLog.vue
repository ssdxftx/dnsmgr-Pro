<template>
  <div class="app-stack">
    <PageHeader :title="t('audit.title')" :subtitle="t('audit.subtitle')" />

    <n-grid class="telemetry-row" cols="2 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1">
        <TelemetryCard
          :value="stats.today"
          :label="t('audit.today')"
          tone="primary"
          :icon="DocumentTextOutline"
          :caption="t('audit.todayShort')"
        />
      </n-grid-item>
      <n-grid-item v-reveal class="reveal d2">
        <TelemetryCard
          :value="stats.failed7d"
          :label="t('audit.failed7d')"
          tone="error"
          :icon="AlertCircleOutline"
          :caption="t('audit.range7dShort')"
        />
      </n-grid-item>
      <n-grid-item v-reveal class="reveal d3">
        <TelemetryCard
          :value="stats.users30d"
          :label="t('audit.activeUsers30d')"
          tone="success"
          :icon="PeopleOutline"
          :caption="t('audit.range30dShort')"
        />
      </n-grid-item>
    </n-grid>

    <div class="app-toolbar audit-toolbar">
      <RangeFilter
        :range="range"
        :custom-range="customRange"
        :is-admin="isAdmin"
        :allow-custom="true"
        :presets="['today', '7d', '30d', 'custom']"
        :hide-custom-inputs="isMobile"
        @update:range="range = $event"
        @update:custom-range="customRange = $event"
        @change="onRangeChange"
      />

      <template v-if="!isMobile">
        <n-select
          v-if="isAdmin"
          v-model:value="uid"
          :options="userOptions"
          clearable
          filterable
          :placeholder="t('audit.user')"
          size="small"
          class="audit-toolbar__select"
        />
        <n-select
          v-model:value="module"
          :options="moduleOptions"
          clearable
          :placeholder="t('audit.module')"
          size="small"
          class="audit-toolbar__select"
        />
        <n-select
          v-model:value="result"
          :options="resultOptions"
          clearable
          :placeholder="t('audit.result')"
          size="small"
          class="audit-toolbar__select audit-toolbar__select--sm"
        />
      </template>

      <n-input
        v-model:value="kw"
        :placeholder="t('audit.keywordPlaceholder')"
        clearable
        size="small"
        class="audit-toolbar__kw"
        @keyup.enter="search"
      />
      <n-button type="primary" size="small" :loading="loadBusy" @click="search">
        <template #icon><n-icon :component="SearchOutline" /></template>
        {{ t('common.search') }}
      </n-button>
      <n-button v-if="!isMobile" size="small" @click="reset">
        <template #icon><n-icon :component="RefreshOutline" /></template>
        {{ t('common.reset') }}
      </n-button>
      <n-button v-else size="small" class="audit-toolbar__filter" @click="showFilters = true">
        <template #icon><n-icon :component="OptionsOutline" /></template>
        {{ t('audit.filter') }}
        <i v-if="hasFilters" class="audit-toolbar__dot" />
      </n-button>
    </div>

    <n-card :bordered="false">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('audit.listTitle') }}</h3>
          <div class="app-panel__extra">
            <span class="audit-count">{{ t('audit.totalCount', { n: pagination.itemCount }) }}</span>
          </div>
        </div>
        <ResponsiveDataTable
          :columns="columns"
          :data="logs"
          :loading="loadBusy"
          :pagination="pagination"
          :row-key="(row: any) => row.id"
          :row-props="rowProps"
          :empty-text="t('audit.empty')"
          :empty-description="t('audit.emptyHint')"
          title-key="target_name"
        />
      </div>
    </n-card>

    <n-drawer v-model:show="showDetail" :width="isMobile ? '100%' : 520" placement="right">
      <n-drawer-content :title="t('audit.detailTitle')" closable>
        <div class="audit-summary">
          <div class="audit-summary__head">
            <span class="audit-summary__action">{{ actionLabel(cur.action) }}</span>
            <StatusBadge
              :tone="cur.result ? 'success' : 'error'"
              variant="text"
              size="sm"
              :label="cur.result ? t('audit.success') : t('audit.failure')"
            />
          </div>
          <div class="audit-summary__text">{{ cur.summary || '-' }}</div>
          <div v-if="cur.errmsg" class="audit-summary__err">{{ cur.errmsg }}</div>
        </div>

        <h4 class="audit-section__title">{{ t('audit.basicInfo') }}</h4>
        <n-descriptions :column="1" size="small" label-placement="left" :label-width="72">
          <n-descriptions-item :label="t('common.time')">{{ cur.addtime || '-' }}</n-descriptions-item>
          <n-descriptions-item :label="t('audit.user')">
            {{ cur.uid > 0 ? cur.username || `UID ${cur.uid}` : t('userLog.system') }}（UID {{ cur.uid ?? 0 }}）
          </n-descriptions-item>
          <n-descriptions-item :label="t('audit.module')">{{ moduleLabel(cur.module) }}</n-descriptions-item>
          <n-descriptions-item :label="t('audit.target')">{{ cur.target_name || '-' }}</n-descriptions-item>
        </n-descriptions>

        <h4 class="audit-section__title">{{ t('audit.requestInfo') }}</h4>
        <n-descriptions :column="1" size="small" label-placement="left" :label-width="72">
          <n-descriptions-item :label="t('audit.request')">
            {{ cur.method }} {{ cur.path }} · {{ cur.status }} · {{ cur.cost_ms }}ms
          </n-descriptions-item>
          <n-descriptions-item :label="t('audit.ip')">{{ cur.ip || '-' }}</n-descriptions-item>
          <n-descriptions-item :label="t('audit.ua')">{{ cur.ua || '-' }}</n-descriptions-item>
        </n-descriptions>

        <h4 class="audit-section__title">{{ t('audit.changes') }}</h4>
        <div v-if="cur.changes?.length" class="audit-diff">
          <div v-for="(c, i) in cur.changes" :key="i" class="audit-diff__row">
            <span class="audit-diff__field">{{ c.field }}</span>
            <span class="audit-diff__from">{{ c.from || '—' }}</span>
            <span class="audit-diff__arrow">→</span>
            <span class="audit-diff__to">{{ c.to || '—' }}</span>
          </div>
        </div>
        <p v-else class="audit-muted">{{ t('audit.noChanges') }}</p>

        <n-collapse ghost class="audit-raw">
          <n-collapse-item :title="t('audit.rawDetail')" name="raw">
            <template #header-extra>
              <n-button text size="tiny" @click.stop="copyDetail">{{ copied ? t('common.copied') : t('common.copy') }}</n-button>
            </template>
            <pre class="audit-json">{{ JSON.stringify(cur.detail, null, 2) }}</pre>
          </n-collapse-item>
        </n-collapse>
      </n-drawer-content>
    </n-drawer>

    <!-- 高度按内容自适应：常规 3 个筛选 340px 足够，展开自定义时间时才加高；原来固定 420px 会留出 300px 空白 -->
    <n-drawer v-model:show="showFilters" placement="bottom" :height="range === 'custom' ? 470 : 340" @update:show="onFilterShow">
      <n-drawer-content :title="t('audit.filter')" closable>
        <div class="audit-filter">
          <n-select
            v-if="isAdmin"
            v-model:value="uid"
            :options="userOptions"
            clearable
            filterable
            :placeholder="t('audit.user')"
            size="small"
          />
          <n-select v-model:value="module" :options="moduleOptions" clearable :placeholder="t('audit.module')" size="small" />
          <n-select v-model:value="result" :options="resultOptions" clearable :placeholder="t('audit.result')" size="small" />
          <template v-if="range === 'custom'">
            <div class="audit-filter__label">{{ t('audit.customTime') }}</div>
            <n-date-picker
              v-model:value="filterStart"
              type="datetime"
              format="yyyy-MM-dd HH:mm:ss"
              clearable
              :placeholder="t('statistics.startTime')"
            />
            <n-date-picker
              v-model:value="filterEnd"
              type="datetime"
              format="yyyy-MM-dd HH:mm:ss"
              clearable
              :placeholder="t('statistics.endTime')"
            />
          </template>
        </div>
        <template #footer>
          <div class="audit-filter__actions">
            <n-button size="small" @click="reset">
              <template #icon><n-icon :component="RefreshOutline" /></template>
              {{ t('common.reset') }}
            </n-button>
            <n-button size="small" type="primary" @click="applyFilters">{{ t('audit.apply') }}</n-button>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NDatePicker, NIcon, NTag, NEllipsis, useMessage } from 'naive-ui';
import {
  SearchOutline,
  RefreshOutline,
  OptionsOutline,
  ChevronForwardOutline,
  DocumentTextOutline,
  AlertCircleOutline,
  PeopleOutline,
} from '@vicons/ionicons5';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import RangeFilter from '../components/statistics/RangeFilter.vue';
import { useResponsive } from '../composables/useResponsive';

const message = useMessage();
const { t, te } = useI18n();
const { isMobile } = useResponsive();

const loadBusy = ref(false);
const logs = ref<any[]>([]);
const stats = reactive({ total: 0, today: 0, failed7d: 0, users30d: 0 });
const page = ref(1);
const pageSize = ref(20);
const range = ref('7d');
const customRange = ref<[number, number] | null>(null);
const uid = ref<number | null>(null);
const module = ref<string | null>(null);
const result = ref<number | null>(null);
const kw = ref('');
const userOptions = ref<{ label: string; value: number }[]>([]);
const showDetail = ref(false);
const showFilters = ref(false);
const filterStart = ref<number | null>(null);
const filterEnd = ref<number | null>(null);
const copied = ref(false);
const cur = ref<any>({});

const isAdmin = computed(() => (getUser()?.level || 0) >= 2);
const hasFilters = computed(() => uid.value != null || !!module.value || result.value != null);

const moduleOptions = computed(() =>
  [
    'auth', 'domain', 'record', 'account', 'cdn', 'cert', 'user', 'system', 'cloudflare',
    'schedule', 'monitor', 'dnscheck', 'optimize', 'preheat', 'expire', 'legacy', 'other',
  ].map((m) => ({ label: t(`audit.modules.${m}`), value: m })),
);

const resultOptions = computed(() => [
  { label: t('audit.success'), value: 1 },
  { label: t('audit.failure'), value: 0 },
]);

const pagination = reactive({
  page: 1,
  pageSize: 20,
  itemCount: 0,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  onChange: (p: number) => {
    page.value = p;
    loadLogs();
  },
  onUpdatePageSize: (s: number) => {
    pageSize.value = s;
    page.value = 1;
    loadLogs();
  },
});

const MODULE_TONE: Record<string, string> = {
  record: 'var(--app-primary)',
  domain: '#3b82f6',
  cdn: '#a855f7',
  cert: 'var(--app-warning)',
  account: '#14b8a6',
  auth: '#ec4899',
  user: '#0ea5e9',
  system: 'var(--app-text-3)',
  cloudflare: '#f97316',
};

function moduleLabel(m: string): string {
  const key = `audit.modules.${m}`;
  return te(key) ? t(key) : m || '-';
}

function actionLabel(a: string): string {
  const key = `audit.actions.${a}`;
  return te(key) ? t(key) : a || '-';
}

function shortTime(s: string): string {
  if (!s) return '-';
  const y = String(new Date().getFullYear());
  return s.startsWith(y) ? s.slice(5) : s;
}

const rowProps = (row: any) => ({ onClick: () => openDetail(row) });

const columns = computed<any[]>(() => [
  {
    title: t('common.time'),
    key: 'addtime',
    width: 152,
    render: (row: any) => h('span', { class: 'audit-time', title: row.addtime }, shortTime(row.addtime)),
  },
  {
    title: t('audit.user'),
    key: 'username',
    width: 108,
    render: (row: any) =>
      row.uid > 0
        ? h('span', { class: 'audit-user' }, row.username || `UID ${row.uid}`)
        : h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => t('userLog.system') }),
  },
  {
    title: t('audit.module'),
    key: 'module',
    width: 96,
    render: (row: any) =>
      h('span', { class: 'audit-module' }, [
        h('i', { class: 'audit-module__dot', style: `background:${MODULE_TONE[row.module] || 'var(--app-text-3)'}` }),
        moduleLabel(row.module),
      ]),
  },
  {
    title: t('audit.action'),
    key: 'action',
    width: 132,
    render: (row: any) => h(NEllipsis, { tooltip: true }, { default: () => actionLabel(row.action) }),
  },
  {
    title: t('audit.summary'),
    key: 'summary',
    minWidth: 220,
    render: (row: any) =>
      h(NEllipsis, { lineClamp: 2, tooltip: { contentStyle: 'max-width: 420px' } }, { default: () => row.summary || '-' }),
  },
  {
    title: t('audit.target'),
    key: 'target_name',
    width: 168,
    render: (row: any) =>
      h(NEllipsis, { tooltip: { contentStyle: 'max-width: 420px' } }, { default: () => row.target_name || '-' }),
  },
  {
    title: t('audit.result'),
    key: 'result',
    width: 78,
    render: (row: any) =>
      h(StatusBadge, {
        tone: row.result ? 'success' : 'error',
        variant: 'text',
        size: 'sm',
        label: row.result ? t('audit.success') : t('audit.failure'),
        title: row.errmsg || '',
      }),
  },
  {
    title: '',
    key: 'actions',
    width: 56,
    fixed: 'right',
    render: (row: any) =>
      h(
        NButton,
        {
          size: isMobile.value ? 'small' : 'tiny',
          quaternary: true,
          type: 'primary',
          circle: !isMobile.value,
          title: t('audit.detailBtn'),
          onClick: () => openDetail(row),
        },
        isMobile.value
          ? { default: () => t('audit.detailBtn') }
          : { icon: () => h(NIcon, { component: ChevronForwardOutline }) },
      ),
  },
]);

function fmtTime(v: number): string {
  const d = new Date(v);
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function computeRange(): { startTime: string; endTime: string } {
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range.value === 'today') return { startTime: fmtTime(t0), endTime: fmtTime(now.getTime()) };
  if (range.value === '30d') return { startTime: fmtTime(t0 - 29 * 86400_000), endTime: fmtTime(now.getTime()) };
  if (range.value === 'custom' && customRange.value?.length === 2) {
    return { startTime: fmtTime(customRange.value[0]), endTime: fmtTime(customRange.value[1]) };
  }
  return { startTime: fmtTime(t0 - 6 * 86400_000), endTime: fmtTime(now.getTime()) };
}

let loadAbort: AbortController | null = null;
async function loadLogs() {
  loadAbort?.abort();
  const ac = new AbortController();
  loadAbort = ac;
  loadBusy.value = true;
  try {
    const { startTime, endTime } = computeRange();
    const res = await api<any>(
      'GET',
      '/audit/logs',
      {
        startTime,
        endTime,
        uid: uid.value ?? undefined,
        module: module.value || undefined,
        result: result.value ?? undefined,
        kw: kw.value || undefined,
        offset: (page.value - 1) * pageSize.value,
        limit: pageSize.value,
      },
      { signal: ac.signal },
    );
    if (loadAbort !== ac) return;
    if (res.code === 0) {
      logs.value = res.data.list;
      pagination.itemCount = res.data.total;
      pagination.page = page.value;
      pagination.pageSize = pageSize.value;
      if (res.data.truncated) message.warning(t('audit.truncated'));
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') message.error(e?.message || t('common.loadFailed'));
  } finally {
    if (loadAbort === ac) loadBusy.value = false;
  }
}

async function loadStats() {
  try {
    const res = await api<any>('GET', '/audit/stats');
    if (res.code === 0) Object.assign(stats, res.data);
  } catch {
    /* 统计卡失败不影响列表 */
  }
}

async function loadUsers() {
  if (!isAdmin.value) return;
  try {
    const res = await api<any>('GET', '/users', { offset: 0, limit: 200 });
    if (res.code === 0) {
      userOptions.value = (res.data.list || []).map((u: any) => ({
        label: `${u.username}（#${u.id}）`,
        value: Number(u.id),
      }));
    }
  } catch {
    /* 用户筛选失败不阻断日志查询 */
  }
}

function search() {
  page.value = 1;
  loadLogs();
}

function onRangeChange() {
  if (isMobile.value && range.value === 'custom' && !customRange.value) {
    showFilters.value = true;
    return;
  }
  search();
}

function onFilterShow(visible: boolean) {
  if (visible) {
    filterStart.value = customRange.value?.[0] ?? null;
    filterEnd.value = customRange.value?.[1] ?? null;
    return;
  }
  if (range.value === 'custom' && !customRange.value) {
    range.value = '7d';
    search();
  }
}

function applyFilters() {
  if (range.value === 'custom') {
    if (filterStart.value == null || filterEnd.value == null) {
      message.warning(t('audit.customTimeRequired'));
      return;
    }
    customRange.value = [filterStart.value, filterEnd.value];
  }
  showFilters.value = false;
  search();
}

function reset() {
  range.value = '7d';
  customRange.value = null;
  uid.value = null;
  module.value = null;
  result.value = null;
  kw.value = '';
  filterStart.value = null;
  filterEnd.value = null;
  showFilters.value = false;
  search();
}

function openDetail(row: any) {
  cur.value = row;
  showDetail.value = true;
}

async function copyDetail() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(cur.value.detail ?? {}, null, 2));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    message.warning(t('systemSet.copyFailed'));
  }
}

onMounted(() => {
  loadUsers();
  loadStats();
  loadLogs();
});
</script>

<style scoped>
.audit-toolbar__select {
  width: 130px;
}
.audit-toolbar__select--sm {
  width: 100px;
}
.audit-toolbar__kw {
  flex: 1 1 180px;
  min-width: 140px;
  max-width: 280px;
}
.audit-toolbar__filter {
  position: relative;
}
.audit-toolbar__dot {
  position: absolute;
  top: 5px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--app-primary);
}
.audit-count {
  font-size: 12px;
  color: var(--app-text-3);
}

.audit-time {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--app-text-2);
  white-space: nowrap;
}
.audit-user {
  font-size: 12px;
  color: var(--app-text-2);
}
.audit-module {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--app-text-3);
  white-space: nowrap;
}
.audit-module__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
}
:deep(.n-data-table-tbody .n-data-table-tr) {
  cursor: pointer;
}
:deep(.n-data-table-td--fixed-right),
:deep(.n-data-table-th--fixed-right) {
  box-shadow: -8px 0 12px -8px color-mix(in srgb, var(--app-text-3) 45%, transparent);
}

.audit-summary {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--app-surface-2);
  border-left: 3px solid var(--app-primary);
  margin-bottom: 16px;
}
.audit-summary__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.audit-summary__action {
  font-size: 12px;
  color: var(--app-text-2);
}
.audit-summary__text {
  font-size: 13px;
  line-height: 1.55;
  color: var(--app-text);
}
.audit-summary__err {
  margin-top: 6px;
  font-size: 12px;
  color: var(--app-error);
}
.audit-section__title {
  margin: 16px 0 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--app-text-2);
}
.audit-diff__row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) 16px minmax(0, 1fr);
  gap: 6px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--app-divider);
  font-size: 12px;
}
.audit-diff__row:last-child {
  border-bottom: 0;
}
.audit-diff__field {
  color: var(--app-text-2);
}
.audit-diff__from {
  color: var(--app-text-3);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--app-text-3) 50%, transparent);
  word-break: break-all;
}
.audit-diff__arrow {
  color: var(--app-text-3);
  text-align: center;
}
.audit-diff__to {
  color: var(--app-text);
  word-break: break-all;
}
.audit-muted {
  margin: 4px 0;
  font-size: 12px;
  color: var(--app-text-3);
}
.audit-raw {
  margin-top: 12px;
}
.audit-json {
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--app-divider);
  border-radius: 8px;
  background: var(--app-surface-2);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.audit-filter {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.audit-filter__label {
  font-size: 12px;
  color: var(--app-text-3);
}
.audit-filter__actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

@media (max-width: 767px) {
  .audit-toolbar {
    gap: 8px;
  }
  .audit-toolbar__kw {
    flex: 1 1 150px;
    min-width: 120px;
    max-width: none;
  }
}
</style>
