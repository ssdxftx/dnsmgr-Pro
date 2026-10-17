<template>
  <div class="app-stack">
    <PageHeader :title="t('domain.title')" :subtitle="t('domain.subtitle')">
      <template #actions>
        <n-space v-if="isAdmin">
          <n-button v-if="checked.length" size="small" type="success" :loading="!!actionBusy['noticeOn']" :disabled="!!actionBusy['noticeOn'] || !!actionBusy['noticeOff']" @click="runAction('noticeOn', () => batchNotice(1))">{{ t('domain.batchNoticeOn') }}</n-button>
          <n-button v-if="checked.length" size="small" :loading="!!actionBusy['noticeOff']" :disabled="!!actionBusy['noticeOff'] || !!actionBusy['noticeOn']" @click="runAction('noticeOff', () => batchNotice(0))">{{ t('domain.batchNoticeOff') }}</n-button>
          <n-button v-if="checked.length" size="small" type="error" secondary @click="batchDelete">{{ t('domain.batchDelete') }}</n-button>
          <n-button @click="router.push('/expire-notice')">{{ t('domain.expireNotice') }}</n-button>
          <n-button type="primary" @click="showImport = true">
            <template #icon><n-icon :component="CloudDownloadOutline" /></template>
            {{ t('domain.importDomains') }}
          </n-button>
          <n-button @click="showCategory = true">{{ t('domain.addCategory') }}</n-button>
        </n-space>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="domains.length" :label="t('common.total')" tone="primary" :icon="GlobeOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="queryFailed" :label="t('common.queryFailed')" tone="warning" :icon="AlertCircleOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="noticeOn" :label="t('common.noticeOn')" tone="success" :icon="NotificationsOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>
    <div class="app-toolbar">
      <n-input
        v-model:value="kw"
        :placeholder="t('domain.searchPlaceholder')"
        size="small"
        style="width: 260px"
        clearable
        @keyup.enter="search"
      />
      <n-button type="primary" size="small" @click="search">
        <template #icon><n-icon :component="SearchOutline" /></template>
        {{ t('common.search') }}
      </n-button>
      <n-button size="small" @click="clearSearch">{{ t('common.refresh') }}</n-button>
    </div>
    <n-card :bordered="false">
      <div v-if="!showRecords" class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('domain.overview') }}</h3>
        </div>
        <n-descriptions :column="3" size="small" label-placement="top">
          <n-descriptions-item :label="t('domain.recordCountCol')">{{ recordTotal }}</n-descriptions-item>
          <n-descriptions-item :label="t('domain.categoryCol')">{{ categoryCount }}</n-descriptions-item>
          <n-descriptions-item :label="t('domain.noticeOff')">{{ domains.length - noticeOn }}</n-descriptions-item>
        </n-descriptions>
      </div>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('domain.listTitle') }}</h3>
        </div>
        <template v-if="showRecords">
          <n-alert type="info" :show-icon="false" :bordered="false" class="mb-3">{{ t('domain.recordResults') }}</n-alert>
          <RecordTable
            :records="recordResults"
            :loading="loadBusy"
            :show-full-name="true"
            :show-add="false"
            @refresh="loadDomains"
          />
        </template>
        <ResponsiveDataTable
          v-else
          v-model:checked-row-keys="checked"
          :columns="columns"
          :data="domains"
          :loading="loadBusy"
          :row-key="(row: any) => row._key || row.id"
          :empty-text="t('domain.empty')"
          :error="loadError"
          :virtual-scroll="domains.length > 200"
          :max-height="620"
          @retry="loadDomains"
        />
      </div>
    </n-card>

    <!-- 导入域名弹窗 -->
    <n-modal v-model:show="showImport" preset="card" :title="t('domain.importDomains')" class="modal-md" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('nav.dnsAccounts')">
          <n-select v-model:value="importAid" :options="accountOptions" :placeholder="t('domain.selectAccount')" @update:value="loadPullDomains" />
        </n-form-item>
        <n-form-item :label="t('domain.cloudDomains')">
          <n-checkbox-group v-model:value="checkedDomains">
            <n-space vertical v-if="pullDomains.length">
              <n-checkbox v-for="d in pullDomains" :key="d.DomainId" :value="d" :label="d.Domain" />
            </n-space>
            <EmptyState v-else compact :icon="FolderOpenOutline" :title="t('domain.pullHint')" />
          </n-checkbox-group>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showImport = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="importBusy" @click="doImport">{{ t('domain.importSelected') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 添加分类弹窗 -->
    <n-modal v-model:show="showCategory" preset="card" :title="t('domain.addCategory')" class="modal-sm" :mask-closable="false">
      <n-input v-model:value="categoryName" :placeholder="t('domain.categoryName')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCategory = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saveBusy" @click="doAddCategory">{{ t('common.confirm') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 编辑域名弹窗 -->
    <n-modal v-model:show="showEdit" preset="card" :title="t('domain.editDomain')" class="modal-sm" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('domain.nameCol')"><span>{{ editRow?.name }}</span></n-form-item>
        <n-form-item :label="t('common.remark')"><n-input v-model:value="editForm.remark" /></n-form-item>
        <n-form-item :label="t('domain.cidLabel')">
          <n-select v-model:value="editForm.cid" :options="categoryOptions" clearable :placeholder="t('domain.categoryNone')" />
        </n-form-item>
        <n-form-item :label="t('domain.expireTimeCol')"><n-input v-model:value="editForm.expiretime" placeholder="YYYY-MM-DD HH:mm:ss" /></n-form-item>
        <n-form-item :label="t('domain.isHideLabel')"><n-switch v-model:value="editForm.is_hide" /></n-form-item>
        <n-form-item :label="t('domain.isSsoLabel')"><n-switch v-model:value="editForm.is_sso" /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saveBusy" @click="doEdit">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, NModal, NForm, NFormItem, NInput, NSelect, NSwitch, useMessage, useDialog } from 'naive-ui';
import { CloudDownloadOutline, RefreshOutline, SearchOutline, GlobeOutline, AlertCircleOutline, NotificationsOutline, FolderOpenOutline } from '@vicons/ionicons5';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import RecordTable from '../components/RecordTable.vue';
import EmptyState from '../components/EmptyState.vue';
import { useAction } from '../composables/useAction';

const router = useRouter();
const { t } = useI18n();
// 到期时间解析结果按原始字符串缓存：表格重渲染时避免每格重复 new Date() 解析
const expireTsCache = new Map<string, number>();
function expireTs(val: string): number {
  const hit = expireTsCache.get(val);
  if (hit !== undefined) return hit;
  const ts = new Date(val).getTime();
  expireTsCache.set(val, ts);
  return ts;
}
const message = useMessage();
const dialog = useDialog();
const { busy: actionBusy, run: runAction } = useAction();
const isAdmin = computed(() => (getUser()?.level || 0) >= 2);
const loadBusy = ref(false);
const loadError = ref(false);
const saveBusy = ref(false);
const domains = ref<any[]>([]);
const queryFailed = computed(() => domains.value.filter((d: any) => d.checkstatus === 2).length);
const noticeOn = computed(() => domains.value.filter((d: any) => d.is_notice === 1).length);
const recordTotal = computed(() => domains.value.reduce((sum: number, d: any) => sum + (d._count_error ? 0 : Number(d.recordcount) || 0), 0));
const categoryCount = computed(() => new Set(domains.value.map((d: any) => d.category_name).filter(Boolean)).size);
const recordResults = ref<any[]>([]);
const showRecords = ref(false);
const checked = ref<string[]>([]);
const accountOptions = ref<any[]>([]);
const pullDomains = ref<any[]>([]);
const checkedDomains = ref<any[]>([]);
const importAid = ref<number | null>(null);
const showImport = ref(false);
const showCategory = ref(false);
const categoryName = ref('');
const importBusy = ref(false);
const kw = ref('');
const showEdit = ref(false);
const editRow = ref<any>(null);
const categories = ref<any[]>([]);
const editForm = ref<{ remark: string; cid: number | null; is_hide: boolean; is_sso: boolean; expiretime: string }>({
  remark: '', cid: null, is_hide: false, is_sso: false, expiretime: '',
});
const categoryOptions = computed(() => categories.value.map((c) => ({ label: c.name, value: c.id })));

const columns = computed(() => {
  const cols: any[] = [];
  if (isAdmin.value) cols.push({ type: 'selection', width: 40 });
  cols.push({ title: 'ID', key: 'id', width: 60 });
  cols.push({
    title: t('domain.nameCol'),
    key: 'name',
    width: 260,
    render: (row: any) =>
      h(NSpace, { size: 6, align: 'center', wrap: false }, {
        default: () =>
          [
            h(NEllipsis, { style: 'max-width:220px' }, { default: () => row.name }),
            !isAdmin.value && row._readonly === 1 ? h(NTag, { size: 'tiny', type: 'warning', bordered: false }, { default: () => t('domain.readonly') }) : null,
          ].filter(Boolean),
      }),
  });
  cols.push({ title: t('domain.categoryCol'), key: 'category_name', width: 120 });
  cols.push({
    title: t('common.remark'),
    key: 'remark',
    width: 160,
    render: (row: any) => h(NEllipsis, { style: 'max-width:160px' }, { default: () => row.remark || '' }),
  });
  cols.push({
    title: t('domain.recordCountCol'),
    key: 'recordcount',
    width: 90,
    render: (row: any) => (row._count_error ? '—' : row.recordcount),
  });
  cols.push({
    title: t('domain.expireTimeCol'),
    key: 'expiretime',
    width: 200,
    render(row: any) {
      const val = row.expiretime || '';
      const expired = val && expireTs(val) < Date.now();
      const text = val ? String(val).slice(0, 19) : (row.checkstatus === 2 ? t('domain.queryFailed') : t('domain.notQueried'));
      const color = expired ? 'var(--app-error)' : row.checkstatus === 2 ? 'var(--app-warning)' : undefined;
      const children: any[] = [h('span', { style: color ? { color } : undefined }, text || '-')];
      if (isAdmin.value) {
        children.push(h(NButton, { size: 'tiny', quaternary: true, title: t('domain.refreshExpire'), onClick: () => updateDate(row) }, { icon: () => h(RefreshOutline) }));
      }
      return h(NSpace, { size: 4, align: 'center' }, { default: () => children });
    },
  });
  cols.push({
    title: t('domain.noticeCol'),
    key: 'is_notice',
    width: 100,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.is_notice == 1 ? 'success' : 'default', bordered: false, onClick: isAdmin.value ? () => toggleNotice(row) : undefined, style: isAdmin.value ? 'cursor:pointer' : undefined }, { default: () => (row.is_notice == 1 ? t('domain.noticeOn') : t('domain.noticeOff')) });
    },
  });
  cols.push({ title: t('domain.addTimeCol'), key: 'addtime', width: 170 });
  cols.push({
    title: t('common.actions'),
    key: 'actions',
    width: isAdmin.value ? 200 : 120,
    render(row: any) {
      const btns: any[] = [h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => gotoRecords(row) }, { default: () => t('domain.records') })];
      if (isAdmin.value) {
        btns.push(h(NButton, { size: 'tiny', onClick: () => openEdit(row) }, { default: () => t('common.edit') }));
        btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delDomain(row) }, { default: () => t('common.delete') }));
      }
      return h('div', { class: 'row-actions' }, btns);
    },
  });
  return cols;
});

// 参数快速切换时中止上一次请求，避免旧响应覆盖新结果
let loadAbort: AbortController | null = null;
async function loadDomains() {
  loadAbort?.abort();
  const ac = new AbortController();
  loadAbort = ac;
  loadBusy.value = true;
  try {
    const res = await api<any>('GET', '/domains', kw.value ? { kw: kw.value } : undefined, { signal: ac.signal });
    loadError.value = res.code !== 0;
    const list: any[] = res.code === 0 ? res.data : [];
    // 本地无命中时按解析记录（子域名）检索，原地展示记录卡片
    if (kw.value && list.length === 0) {
      const rres = await api<any>('GET', '/records/search', { kw: kw.value }, { signal: ac.signal });
      recordResults.value = rres.code === 0 ? rres.data : [];
      showRecords.value = recordResults.value.length > 0;
    } else {
      recordResults.value = [];
      showRecords.value = false;
    }
    domains.value = list;
  } catch (e: any) {
    if (e?.name !== 'AbortError') loadError.value = true;
  } finally {
    if (loadAbort === ac) loadBusy.value = false;
  }
}

function search() {
  loadDomains();
}

function clearSearch() {
  kw.value = '';
  loadDomains();
}

async function loadAccounts() {
  const res = await api<any>('GET', '/dns/accounts');
  if (res.code === 0) {
    accountOptions.value = res.data.map((a: any) => ({ label: t('domain.accountOption', { id: a.id, type: a.type, name: a.name }), value: a.id }));
  }
}

async function loadPullDomains(aid: number) {
  const res = await api<any>('GET', `/dns/accounts/${aid}/pull`);
  if (res.code === 0) pullDomains.value = res.data;
  else {
    pullDomains.value = [];
    message.error(res.msg);
  }
}

async function doImport() {
  if (!importAid.value || !checkedDomains.value.length) {
    message.warning(t('domain.selectAccountDomain'));
    return;
  }
  importBusy.value = true;
  const results = await Promise.all(
    checkedDomains.value.map((d: any) =>
      api('POST', '/domains', { aid: importAid.value, domain: d.Domain, thirdid: d.DomainId, recordcount: d.RecordCount || 0 }),
    ),
  );
  importBusy.value = false;
  const ok = results.filter((r: any) => r.code === 0).length;
  message.success(t('domain.importSuccess', { count: ok }));
  checkedDomains.value = [];
  pullDomains.value = [];
  showImport.value = false;
  loadDomains();
}

async function doAddCategory() {
  if (!categoryName.value) return message.warning(t('domain.categoryNameRequired'));
  saveBusy.value = true;
  const res = await api('POST', '/domains/categories', { name: categoryName.value });
  saveBusy.value = false;
  if (res.code === 0) {
    message.success(t('domain.addCategorySuccess'));
    showCategory.value = false;
    categoryName.value = '';
  } else message.error(res.msg);
}

function gotoRecords(row: any) {
  const q = row._sub ? `?sub=${encodeURIComponent(row._sub)}` : '';
  window.open(`/domains/${row.id}/records${q}`, '_self');
}

const noticePending = new Set<number>();
async function toggleNotice(row: any) {
  const id = Number(row.id);
  if (noticePending.has(id)) return; // 防双击重复提交
  noticePending.add(id);
  const prev = Number(row.is_notice) === 1 ? 1 : 0;
  const target = prev === 1 ? 0 : 1;
  row.is_notice = target; // 乐观更新：立即反馈，避免等待整表重拉
  try {
    const res = await api('POST', '/domains/batch-notice', { ids: [row.id], is_notice: target });
    if (res.code === 0) message.success(res.msg);
    else {
      row.is_notice = prev; // 失败回滚
      message.error(res.msg);
    }
  } finally {
    noticePending.delete(id);
  }
}

async function batchNotice(isNotice: number) {
  if (!checked.value.length) return message.warning(t('domain.selectDomain'));
  const ids = checked.value.map(Number);
  const prev = new Map<number, number>();
  for (const d of domains.value) {
    if (ids.includes(Number(d.id))) {
      prev.set(Number(d.id), Number(d.is_notice) === 1 ? 1 : 0);
      d.is_notice = isNotice;
    }
  }
  const res = await api('POST', '/domains/batch-notice', { ids, is_notice: isNotice });
  if (res.code === 0) message.success(res.msg);
  else {
    for (const d of domains.value) {
      const p = prev.get(Number(d.id));
      if (p !== undefined) d.is_notice = p;
    }
    message.error(res.msg);
  }
}

async function updateDate(row: any) {
  message.loading(t('domain.queryingWhois'));
  const res = await api('POST', `/domains/${row.id}/update-date`);
  message.destroyAll();
  if (res.code === 0) {
    message.success(t('domain.refreshSuccess'));
    loadDomains();
  } else message.error(res.msg);
}

async function loadCategories() {
  const res = await api<any>('GET', '/domains/categories');
  if (res.code === 0) categories.value = res.data;
}

function openEdit(row: any) {
  editRow.value = row;
  editForm.value = {
    remark: row.remark || '',
    cid: row.cid || null,
    is_hide: row.is_hide == 1,
    is_sso: row.is_sso == 1,
    expiretime: row.expiretime ? String(row.expiretime).slice(0, 19) : '',
  };
  showEdit.value = true;
}

async function doEdit() {
  if (!editRow.value) return;
  const row = editRow.value;
  const payload = {
    remark: editForm.value.remark,
    cid: editForm.value.cid || 0,
    is_hide: editForm.value.is_hide ? 1 : 0,
    is_sso: editForm.value.is_sso ? 1 : 0,
    expiretime: editForm.value.expiretime || null,
  };
  const prev = { remark: row.remark, cid: row.cid, is_hide: row.is_hide, is_sso: row.is_sso, expiretime: row.expiretime, category_name: row.category_name };
  Object.assign(row, {
    ...payload,
    category_name: categories.value.find((c: any) => Number(c.id) === Number(payload.cid))?.name || '',
  });
  saveBusy.value = true;
  const res = await api('PUT', `/domains/${row.id}`, payload);
  saveBusy.value = false;
  if (res.code === 0) {
    message.success(t('domain.editSuccess'));
    showEdit.value = false;
  } else {
    Object.assign(row, prev);
    message.error(res.msg);
  }
}

function batchDelete() {
  if (!checked.value.length) return message.warning(t('domain.selectDomain'));
  dialog.warning({
    title: t('domain.batchDelete'),
    content: t('domain.batchDeleteConfirm', { count: checked.value.length }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const ids = checked.value.map(Number);
      const snapshot = [...domains.value];
      domains.value = domains.value.filter((d) => !ids.includes(Number(d.id)));
      const res = await api('POST', '/domains/batch-del', { ids });
      if (res.code === 0) {
        message.success(res.msg);
        checked.value = [];
      } else {
        domains.value = snapshot; // 失败回滚：整体还原，保持原有顺序
        message.error(res.msg);
      }
    },
  });
}

function delDomain(row: any) {
  dialog.warning({
    title: t('domain.deleteTitle'),
    content: t('domain.deleteConfirm', { name: row.name }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const idx = domains.value.findIndex((d) => Number(d.id) === Number(row.id));
      const removed = idx >= 0 ? domains.value[idx] : null;
      if (idx >= 0) domains.value.splice(idx, 1);
      const res = await api('DELETE', `/domains/${row.id}`);
      if (res.code === 0) {
        // 同步移除选中集合中的该行，避免「选中 N」偏高、批量提交携带已删 id
        checked.value = checked.value.filter((k) => Number(k) !== Number(row.id));
        message.success(t('domain.deleteSuccess'));
      } else {
        if (removed) domains.value.splice(idx, 0, removed); // 失败回滚
        message.error(res.msg);
      }
    },
  });
}

onMounted(() => {
  loadDomains();
  loadAccounts();
  loadCategories();
});
</script>

