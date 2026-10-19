<template>
  <div class="app-stack">
    <PageHeader :title="t('audit.title')" :subtitle="t('audit.subtitle')" />

    <n-grid class="telemetry-row" cols="1 s:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1">
        <TelemetryCard :value="stats.today" :label="t('audit.today')" tone="primary" :icon="DocumentTextOutline" :caption="t('audit.subtitle')" />
      </n-grid-item>
      <n-grid-item v-reveal class="reveal d2">
        <TelemetryCard :value="stats.failed7d" :label="t('audit.failed7d')" tone="error" :icon="AlertCircleOutline" :caption="t('audit.result')" />
      </n-grid-item>
      <n-grid-item v-reveal class="reveal d3">
        <TelemetryCard :value="stats.users30d" :label="t('audit.activeUsers30d')" tone="success" :icon="PeopleOutline" :caption="t('audit.user')" />
      </n-grid-item>
    </n-grid>

    <div class="app-toolbar">
      <n-date-picker
        v-model:value="range"
        type="datetimerange"
        clearable
        size="small"
        style="width: 360px; max-width: 100%"
        @update:value="search"
      />
      <n-select
        v-if="isAdmin"
        v-model:value="uid"
        :options="userOptions"
        clearable
        filterable
        :placeholder="t('audit.user')"
        size="small"
        style="width: 160px"
      />
      <n-select
        v-model:value="module"
        :options="moduleOptions"
        clearable
        :placeholder="t('audit.module')"
        size="small"
        style="width: 150px"
      />
      <n-select
        v-model:value="result"
        :options="resultOptions"
        clearable
        :placeholder="t('audit.result')"
        size="small"
        style="width: 120px"
      />
      <n-input
        v-model:value="kw"
        :placeholder="t('audit.keywordPlaceholder')"
        clearable
        size="small"
        style="width: 220px"
        @keyup.enter="search"
      />
      <n-button type="primary" size="small" :loading="loadBusy" @click="search">
        <template #icon><n-icon :component="SearchOutline" /></template>
        {{ t('common.search') }}
      </n-button>
      <n-button size="small" @click="reset">
        <template #icon><n-icon :component="RefreshOutline" /></template>
        {{ t('common.reset') }}
      </n-button>
    </div>

    <n-card :bordered="false">
      <ResponsiveDataTable
        :columns="columns"
        :data="logs"
        :loading="loadBusy"
        :pagination="pagination"
        :row-key="(row: any) => row.id"
        :empty-text="t('audit.empty')"
        title-key="target_name"
      />
    </n-card>

    <n-drawer v-model:show="showDetail" :width="isMobile ? '100%' : 560" placement="right">
      <n-drawer-content :title="t('audit.detailTitle')" closable>
        <n-descriptions :column="1" label-placement="left" bordered size="small">
          <n-descriptions-item :label="t('common.time')">{{ cur.addtime }}</n-descriptions-item>
          <n-descriptions-item :label="t('audit.user')">
            {{ cur.uid > 0 ? cur.username || `UID ${cur.uid}` : t('userLog.system') }}（UID {{ cur.uid ?? 0 }}）
          </n-descriptions-item>
          <n-descriptions-item :label="t('audit.module')">{{ moduleLabel(cur.module) }}</n-descriptions-item>
          <n-descriptions-item :label="t('audit.action')">{{ actionLabel(cur.action) }}</n-descriptions-item>
          <n-descriptions-item :label="t('audit.target')">{{ cur.target_name || '-' }}</n-descriptions-item>
          <n-descriptions-item :label="t('audit.result')">
            <n-tag :type="cur.result ? 'success' : 'error'" size="small" :bordered="false">
              {{ cur.result ? t('audit.success') : t('audit.failure') }}
            </n-tag>
            <span v-if="cur.errmsg" style="margin-left: 8px; color: var(--app-text-3)">{{ cur.errmsg }}</span>
          </n-descriptions-item>
          <n-descriptions-item :label="t('audit.request')">
            {{ cur.method }} {{ cur.path }} · {{ cur.status }} · {{ cur.cost_ms }}ms
          </n-descriptions-item>
          <n-descriptions-item :label="t('audit.ip')">{{ cur.ip || '-' }}</n-descriptions-item>
          <n-descriptions-item :label="t('audit.ua')">{{ cur.ua || '-' }}</n-descriptions-item>
        </n-descriptions>

        <n-divider>{{ t('audit.changes') }}</n-divider>
        <n-table v-if="cur.changes?.length" size="small" :bordered="false">
          <thead>
            <tr>
              <th>{{ t('audit.field') }}</th>
              <th>{{ t('audit.from') }}</th>
              <th>{{ t('audit.to') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in cur.changes" :key="i">
              <td>{{ c.field }}</td>
              <td style="color: var(--app-text-3)">{{ c.from || '—' }}</td>
              <td>{{ c.to || '—' }}</td>
            </tr>
          </tbody>
        </n-table>
        <EmptyState v-else compact :icon="DocumentTextOutline" :title="t('audit.noChanges')" />

        <n-divider>{{ t('audit.rawDetail') }}</n-divider>
        <pre class="audit-json">{{ JSON.stringify(cur.detail, null, 2) }}</pre>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NTag, NEllipsis, useMessage } from 'naive-ui';
import {
  SearchOutline,
  RefreshOutline,
  DocumentTextOutline,
  AlertCircleOutline,
  PeopleOutline,
} from '@vicons/ionicons5';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import EmptyState from '../components/EmptyState.vue';
import { useResponsive } from '../composables/useResponsive';

const message = useMessage();
const { t, te } = useI18n();
const { isMobile } = useResponsive();

const loadBusy = ref(false);
const logs = ref<any[]>([]);
const stats = reactive({ total: 0, today: 0, failed7d: 0, users30d: 0 });
const page = ref(1);
const pageSize = ref(20);
const range = ref<[number, number] | null>([Date.now() - 7 * 86400_000, Date.now()]);
const uid = ref<number | null>(null);
const module = ref<string | null>(null);
const result = ref<number | null>(null);
const kw = ref('');
const userOptions = ref<{ label: string; value: number }[]>([]);
const showDetail = ref(false);
const cur = ref<any>({});

const isAdmin = computed(() => (getUser()?.level || 0) >= 2);

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

function moduleLabel(m: string): string {
  const key = `audit.modules.${m}`;
  return te(key) ? t(key) : m || '-';
}

function actionLabel(a: string): string {
  const key = `audit.actions.${a}`;
  return te(key) ? t(key) : a || '-';
}

const columns = computed<any[]>(() => [
  { title: t('common.time'), key: 'addtime', width: 170 },
  {
    title: t('audit.user'),
    key: 'username',
    width: 140,
    render: (row: any) =>
      row.uid > 0
        ? row.username || `UID ${row.uid}`
        : h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => t('userLog.system') }),
  },
  {
    title: t('audit.module'),
    key: 'module',
    width: 110,
    render: (row: any) =>
      h(NTag, { size: 'small', bordered: false }, { default: () => moduleLabel(row.module) }),
  },
  {
    title: t('audit.action'),
    key: 'action',
    width: 150,
    render: (row: any) => h(NEllipsis, { expandTrigger: 'click' }, { default: () => actionLabel(row.action) }),
  },
  {
    title: t('audit.target'),
    key: 'target_name',
    minWidth: 200,
    render: (row: any) =>
      h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.target_name || '-' }),
  },
  {
    title: t('audit.result'),
    key: 'result',
    width: 90,
    render: (row: any) =>
      h(
        NTag,
        { size: 'small', type: row.result ? 'success' : 'error', bordered: false, title: row.errmsg || undefined },
        { default: () => (row.result ? t('audit.success') : t('audit.failure')) },
      ),
  },
  { title: 'ms', key: 'cost_ms', width: 90, mobile: 'hide', render: (row: any) => `${row.cost_ms} ms` },
  { title: 'IP', key: 'ip', width: 130, mobile: 'hide' },
  {
    title: '',
    key: '_detail',
    width: 80,
    render: (row: any) =>
      h(
        NButton,
        {
          size: 'tiny',
          quaternary: true,
          type: 'primary',
          onClick: () => openDetail(row),
        },
        { default: () => t('audit.detailBtn') },
      ),
  },
]);

function fmtTime(v: number): string {
  const d = new Date(v);
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

let loadAbort: AbortController | null = null;
async function loadLogs() {
  loadAbort?.abort();
  const ac = new AbortController();
  loadAbort = ac;
  loadBusy.value = true;
  try {
    const [start, end] = range.value || [Date.now() - 7 * 86400_000, Date.now()];
    const res = await api<any>(
      'GET',
      '/audit/logs',
      {
        startTime: fmtTime(start),
        endTime: fmtTime(end),
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

function reset() {
  range.value = [Date.now() - 7 * 86400_000, Date.now()];
  uid.value = null;
  module.value = null;
  result.value = null;
  kw.value = '';
  search();
}

function openDetail(row: any) {
  cur.value = row;
  showDetail.value = true;
}

onMounted(() => {
  loadUsers();
  loadStats();
  loadLogs();
});
</script>

<style scoped>
.audit-json {
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  border-radius: 8px;
  background: var(--app-surface-2);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
