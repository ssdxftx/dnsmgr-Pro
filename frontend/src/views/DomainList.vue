<template>
  <div class="app-stack">
    <PageHeader :title="t('domain.title')" :subtitle="t('domain.subtitle')">
      <template #actions>
        <n-space v-if="isAdmin">
          <n-button v-if="checked.length" size="small" type="success" @click="batchNotice(1)">{{ t('domain.batchNoticeOn') }}</n-button>
          <n-button v-if="checked.length" size="small" @click="batchNotice(0)">{{ t('domain.batchNoticeOff') }}</n-button>
          <n-button v-if="checked.length" size="small" type="error" @click="batchDelete">{{ t('domain.batchDelete') }}</n-button>
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
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="domains.length" :label="t('common.total')" tone="primary" :icon="GlobeOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="queryFailed" :label="t('common.queryFailed')" tone="warning" :icon="AlertCircleOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="noticeOn" :label="t('common.noticeOn')" tone="success" :icon="NotificationsOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <n-space style="margin-bottom: 16px">
        <n-input
          v-model:value="kw"
          :placeholder="t('domain.searchPlaceholder')"
          style="width: 260px"
          clearable
          @keyup.enter="search"
        />
        <n-button type="primary" @click="search">
          <template #icon><n-icon :component="SearchOutline" /></template>
          {{ t('common.search') }}
        </n-button>
        <n-button @click="clearSearch">{{ t('common.refresh') }}</n-button>
      </n-space>
      <template v-if="showRecords">
        <n-alert type="info" :show-icon="false" :bordered="false" style="margin-bottom: 12px">{{ t('domain.recordResults') }}</n-alert>
        <RecordTable
          :records="recordResults"
          :loading="loading"
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
        :loading="loading"
        :row-key="(row: any) => row._key || row.id"
        :empty-text="t('domain.empty')"
      />
    </n-card>

    <!-- 导入域名弹窗 -->
    <n-modal v-model:show="showImport" preset="card" :title="t('domain.importDomains')" style="max-width:640px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('nav.dnsAccounts')">
          <n-select v-model:value="importAid" :options="accountOptions" :placeholder="t('domain.selectAccount')" @update:value="loadPullDomains" />
        </n-form-item>
        <n-form-item :label="t('domain.cloudDomains')">
          <n-checkbox-group v-model:value="checkedDomains">
            <n-space vertical v-if="pullDomains.length">
              <n-checkbox v-for="d in pullDomains" :key="d.DomainId" :value="d" :label="d.Domain" />
            </n-space>
            <n-empty v-else :description="t('domain.pullHint')" size="small" style="width:100%" />
          </n-checkbox-group>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showImport = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="importing" @click="doImport">{{ t('domain.importSelected') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 添加分类弹窗 -->
    <n-modal v-model:show="showCategory" preset="card" :title="t('domain.addCategory')" style="max-width:400px" :mask-closable="false">
      <n-input v-model:value="categoryName" :placeholder="t('domain.categoryName')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCategory = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" @click="doAddCategory">{{ t('common.confirm') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 编辑域名弹窗 -->
    <n-modal v-model:show="showEdit" preset="card" :title="t('domain.editDomain')" style="max-width:480px" :mask-closable="false">
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
          <n-button type="primary" @click="doEdit">{{ t('common.save') }}</n-button>
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
import { CloudDownloadOutline, RefreshOutline, SearchOutline, GlobeOutline, AlertCircleOutline, NotificationsOutline } from '@vicons/ionicons5';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import RecordTable from '../components/RecordTable.vue';

const router = useRouter();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const isAdmin = computed(() => (getUser()?.level || 0) >= 2);
const loading = ref(false);
const domains = ref<any[]>([]);
const queryFailed = computed(() => domains.value.filter((d: any) => d.checkstatus === 2).length);
const noticeOn = computed(() => domains.value.filter((d: any) => d.is_notice === 1).length);
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
const importing = ref(false);
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
  cols.push({ title: t('domain.recordCountCol'), key: 'recordcount', width: 90 });
  cols.push({
    title: t('domain.expireTimeCol'),
    key: 'expiretime',
    width: 200,
    render(row: any) {
      const val = row.expiretime || '';
      const expired = val && new Date(val) < new Date();
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
      const btns: any[] = [h(NButton, { size: 'tiny', type: 'primary', onClick: () => gotoRecords(row) }, { default: () => t('domain.records') })];
      if (isAdmin.value) {
        btns.push(h(NButton, { size: 'tiny', onClick: () => openEdit(row) }, { default: () => t('common.edit') }));
        btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => delDomain(row) }, { default: () => t('common.delete') }));
      }
      return h(NSpace, null, { default: () => btns });
    },
  });
  return cols;
});

async function loadDomains() {
  loading.value = true;
  const res = await api<any>('GET', '/domains', kw.value ? { kw: kw.value } : undefined);
  let list: any[] = res.code === 0 ? res.data : [];
  // 本地无命中时按解析记录（子域名）检索，原地展示记录卡片
  if (kw.value && list.length === 0) {
    const rres = await api<any>('GET', '/records/search', { kw: kw.value });
    recordResults.value = rres.code === 0 ? rres.data : [];
    showRecords.value = recordResults.value.length > 0;
  } else {
    recordResults.value = [];
    showRecords.value = false;
  }
  domains.value = list;
  loading.value = false;
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
  importing.value = true;
  const results = await Promise.all(
    checkedDomains.value.map((d: any) =>
      api('POST', '/domains', { aid: importAid.value, domain: d.Domain, thirdid: d.DomainId, recordcount: d.RecordCount || 0 }),
    ),
  );
  importing.value = false;
  const ok = results.filter((r: any) => r.code === 0).length;
  message.success(t('domain.importSuccess', { count: ok }));
  checkedDomains.value = [];
  pullDomains.value = [];
  showImport.value = false;
  loadDomains();
}

async function doAddCategory() {
  if (!categoryName.value) return message.warning(t('domain.categoryNameRequired'));
  const res = await api('POST', '/domains/categories', { name: categoryName.value });
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

async function toggleNotice(row: any) {
  const target = row.is_notice == 1 ? 0 : 1;
  const res = await api('POST', '/domains/batch-notice', { ids: [row.id], is_notice: target });
  if (res.code === 0) {
    message.success(res.msg);
    loadDomains();
  } else message.error(res.msg);
}

async function batchNotice(isNotice: number) {
  if (!checked.value.length) return message.warning(t('domain.selectDomain'));
  const res = await api('POST', '/domains/batch-notice', { ids: checked.value.map(Number), is_notice: isNotice });
  if (res.code === 0) {
    message.success(res.msg);
    loadDomains();
  } else message.error(res.msg);
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
  const res = await api('PUT', `/domains/${editRow.value.id}`, {
    remark: editForm.value.remark,
    cid: editForm.value.cid || 0,
    is_hide: editForm.value.is_hide ? 1 : 0,
    is_sso: editForm.value.is_sso ? 1 : 0,
    expiretime: editForm.value.expiretime || null,
  });
  if (res.code === 0) {
    message.success(t('domain.editSuccess'));
    showEdit.value = false;
    loadDomains();
  } else message.error(res.msg);
}

function batchDelete() {
  if (!checked.value.length) return message.warning(t('domain.selectDomain'));
  dialog.warning({
    title: t('domain.batchDelete'),
    content: t('domain.batchDeleteConfirm', { count: checked.value.length }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('POST', '/domains/batch-del', { ids: checked.value.map(Number) });
      if (res.code === 0) {
        message.success(res.msg);
        checked.value = [];
        loadDomains();
      } else message.error(res.msg);
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
      const res = await api('DELETE', `/domains/${row.id}`);
      if (res.code === 0) {
        message.success(t('domain.deleteSuccess'));
        loadDomains();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadDomains();
  loadAccounts();
  loadCategories();
});
</script>

