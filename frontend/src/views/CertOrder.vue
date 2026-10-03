<template>
  <div class="app-stack">
    <PageHeader :title="t('certOrder.title')" :subtitle="t('certOrder.subtitle')">
      <template #actions>
        <n-space>
          <n-button @click="router.push('/cert-settings')">{{ t('certOrder.settings') }}</n-button>
          <n-button type="primary" @click="openAdd">
            <template #icon><n-icon :component="AddOutline" /></template>
            {{ t('certOrder.apply') }}
          </n-button>
        </n-space>
      </template>
    </PageHeader>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="orders" :loading="loading" :empty-text="t('certOrder.empty')" />
    </n-card>

    <!-- 添加/编辑弹窗 -->
    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('certOrder.editTitle') : t('certOrder.applyTitle')" style="max-width:640px" :mask-closable="false">
      <n-tabs v-model:value="tab" type="line">
        <n-tab-pane name="apply" :tab="t('certOrder.tabApply')">
          <n-form label-placement="left" label-width="110">
            <n-form-item :label="t('certOrder.account')">
              <n-select v-model:value="form.aid" :options="accountOptions" :placeholder="t('certOrder.selectAccountPlaceholder')" />
            </n-form-item>
            <n-form-item :label="t('certOrder.keyType')">
              <n-radio-group v-model:value="form.keytype">
                <n-radio value="RSA">RSA</n-radio>
                <n-radio value="ECC">ECC</n-radio>
              </n-radio-group>
            </n-form-item>
            <n-form-item :label="t('certOrder.keySize')">
              <n-select v-model:value="form.keysize" :options="keySizeOptions" />
            </n-form-item>
            <n-form-item :label="t('certOrder.domains')">
              <n-dynamic-input v-model:value="form.domains" :placeholder="t('certOrder.domainsPlaceholder')" :min="1" />
            </n-form-item>
          </n-form>
        </n-tab-pane>
        <n-tab-pane name="import" :tab="t('certOrder.tabImport')">
          <n-form label-placement="left" label-width="110">
            <n-form-item :label="t('certOrder.certContent')">
              <n-input v-model:value="form.fullchain" type="textarea" :rows="6" placeholder="-----BEGIN CERTIFICATE----- ..." />
            </n-form-item>
            <n-form-item :label="t('certOrder.privateKeyContent')">
              <n-input v-model:value="form.privatekey" type="textarea" :rows="6" placeholder="-----BEGIN PRIVATE KEY----- ..." />
            </n-form-item>
          </n-form>
        </n-tab-pane>
      </n-tabs>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 证书详情 -->
    <n-modal v-model:show="showInfo" preset="card" :title="t('certOrder.infoTitle')" style="max-width:720px" :mask-closable="false">
      <n-descriptions v-if="info" bordered :column="1" label-placement="left" style="margin-bottom:16px">
        <n-descriptions-item :label="t('certOrder.domains')">{{ (info.domains || []).join(', ') }}</n-descriptions-item>
        <n-descriptions-item :label="t('certOrder.issueTime')">{{ info.issuetime }}</n-descriptions-item>
        <n-descriptions-item :label="t('certOrder.expireTime')">{{ info.expiretime }}</n-descriptions-item>
      </n-descriptions>
      <n-form-item :label="t('certOrder.certLabel')">
        <n-input v-model:value="info.crt" type="textarea" :rows="8" readonly />
      </n-form-item>
      <n-form-item :label="t('certOrder.keyLabel')">
        <n-input v-model:value="info.key" type="textarea" :rows="8" readonly />
      </n-form-item>
      <template #footer>
        <n-space justify="end">
          <n-button @click="copyText('crt')">{{ t('certOrder.copyCert') }}</n-button>
          <n-button @click="copyText('key')">{{ t('certOrder.copyKey') }}</n-button>
          <n-button type="primary" @click="downloadPfx">{{ t('certOrder.downloadPfx') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 日志 -->
    <n-modal v-model:show="showLog" preset="card" :title="t('certOrder.logTitle')" style="max-width:720px" :mask-closable="false">
      <n-input v-model:value="logText" type="textarea" :rows="18" readonly />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const router = useRouter();
const { t } = useI18n();

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const orders = ref<any[]>([]);
const statusLabel = ref<Record<string, string>>({});
const accounts = ref<any[]>([]);
const accountOptions = ref<any[]>([]);

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const tab = ref('apply');
const form = reactive<any>({ aid: null, keytype: 'RSA', keysize: '2048', domains: [], fullchain: '', privatekey: '' });

const showInfo = ref(false);
const info = ref<any>(null);
const showLog = ref(false);
const logText = ref('');

const keySizeOptions = computed(() =>
  form.keytype === 'RSA'
    ? [{ label: '2048', value: '2048' }, { label: '3072', value: '3072' }, { label: '4096', value: '4096' }]
    : [{ label: '256 (prime256v1)', value: '256' }, { label: '384 (secp384r1)', value: '384' }, { label: '521 (secp521r1)', value: '521' }],
);

function statusType(s: number): any {
  if (s === 3) return 'success';
  if (s === 4) return 'default';
  if (s === 1) return 'warning';
  if (s === 2) return 'info';
  if (s < 0) return 'error';
  return 'default';
}

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: t('certOrder.typeCol'),
    key: 'typename',
    width: 100,
    render(row: any) {
      return h(NTag, { size: 'small', bordered: false }, { default: () => row.typename || t('certOrder.manualImport') });
    },
  },
  {
    title: t('certOrder.domainsCol'),
    key: 'domains',
    minWidth: 200,
    render(row: any) {
      const txt = (row.domains || []).join(', ');
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => txt });
    },
  },
  {
    title: t('common.status'),
    key: 'status',
    width: 100,
    render(row: any) {
      return h(NTag, { size: 'small', type: statusType(row.status) }, { default: () => statusLabel.value[String(row.status)] || row.status });
    },
  },
  {
    title: t('certOrder.expireCol'),
    key: 'expiretime',
    width: 130,
    render(row: any) {
      return row.expiretime ? `${row.expiretime}${row.end_day != null ? `（${t('certOrder.remainingDays', { days: row.end_day })}）` : ''}` : '-';
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 260,
    render(row: any) {
      const btns: any[] = [];
      if (row.status < 3) {
        btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => process(row) }, { default: () => (row.status === 1 ? t('certOrder.verify') : t('certOrder.process')) }));
        btns.push(h(NButton, { size: 'tiny', onClick: () => reset(row) }, { default: () => t('certOrder.reset') }));
      }
      if (row.status === 3) {
        btns.push(h(NButton, { size: 'tiny', type: 'info', onClick: () => viewInfo(row) }, { default: () => t('common.detail') }));
        btns.push(h(NButton, { size: 'tiny', type: 'warning', onClick: () => revoke(row) }, { default: () => t('certOrder.revoke') }));
        btns.push(h(NButton, { size: 'tiny', onClick: () => toggleAuto(row) }, { default: () => (row.isauto ? t('certOrder.autoOff') : t('certOrder.autoOn')) }));
      }
      btns.push(h(NButton, { size: 'tiny', onClick: () => viewLog(row) }, { default: () => t('certOrder.log') }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h(NSpace, null, { default: () => btns });
    },
  },
]);

async function loadOrders() {
  loading.value = true;
  const res = await api<any>('GET', '/cert/orders', { limit: 200 });
  if (res.code === 0) {
    orders.value = res.data;
    statusLabel.value = res.status_label || {};
  } else orders.value = [];
  loading.value = false;
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cert/accounts', { limit: 200 });
  if (res.code === 0) {
    accounts.value = res.data;
    accountOptions.value = res.data.map((r: any) => ({ label: r.name + (r.remark ? '（' + r.remark + '）' : '') + ' [' + (r.typename || r.type) + ']', value: r.id }));
  }
}

function openAdd() {
  editingId.value = null;
  tab.value = 'apply';
  form.aid = null;
  form.keytype = 'RSA';
  form.keysize = '2048';
  form.domains = [];
  form.fullchain = '';
  form.privatekey = '';
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.aid = row.aid;
  form.keytype = row.keytype;
  form.keysize = row.keysize;
  form.domains = [...(row.domains || [])];
  form.fullchain = '';
  form.privatekey = '';
  tab.value = row.aid === 0 ? 'import' : 'apply';
  showEdit.value = true;
}

async function save() {
  saving.value = true;
  let body: any;
  if (tab.value === 'import') {
    if (!form.fullchain || !form.privatekey) return message.warning(t('certOrder.saveWarning'));
    body = { aid: -1, fullchain: form.fullchain, privatekey: form.privatekey };
  } else {
    if (!form.aid) return message.warning(t('certOrder.selectAccountWarning'));
    const domains = form.domains.map((d: string) => (typeof d === 'string' ? d.trim() : (d as any)?.value?.trim())).filter(Boolean);
    if (!domains.length) return message.warning(t('certOrder.domainsWarning'));
    body = { aid: form.aid, keytype: form.keytype, keysize: form.keysize, domains };
  }
  const res = editingId.value
    ? await api('PUT', `/cert/orders/${editingId.value}`, body)
    : await api('POST', '/cert/orders', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadOrders();
  } else message.error(res.msg);
}

async function process(row: any) {
  const res = await api('POST', `/cert/orders/${row.id}/process`, {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
  loadOrders();
}

function reset(row: any) {
  dialog.warning({
    title: t('certOrder.resetTitle'),
    content: t('certOrder.resetConfirm'),
    positiveText: t('certOrder.reset'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('POST', `/cert/orders/${row.id}/reset`, {});
      if (res.code === 0) message.success(t('certOrder.resetSuccess'));
      else message.error(res.msg);
      loadOrders();
    },
  });
}

function revoke(row: any) {
  dialog.warning({
    title: t('certOrder.revokeTitle'),
    content: t('certOrder.revokeConfirm'),
    positiveText: t('certOrder.revoke'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('POST', `/cert/orders/${row.id}/revoke`, {});
      if (res.code === 0) message.success(t('certOrder.revokeSuccess'));
      else message.error(res.msg);
      loadOrders();
    },
  });
}

async function toggleAuto(row: any) {
  const res = await api('POST', `/cert/orders/${row.id}/setauto`, { isauto: row.isauto ? 0 : 1 });
  if (res.code === 0) message.success(t('common.success'));
  else message.error(res.msg);
  loadOrders();
}

async function viewInfo(row: any) {
  const res = await api<any>('GET', `/cert/orders/${row.id}/info`);
  if (res.code === 0) {
    info.value = res.data;
    showInfo.value = true;
  } else message.error(res.msg);
}

async function viewLog(row: any) {
  const res = await api<any>('GET', `/cert/orders/${row.id}/log`);
  if (res.code === 0) {
    logText.value = res.data;
    showLog.value = true;
  } else message.info(res.msg || t('certOrder.noLog'));
}

function copyText(key: 'crt' | 'key') {
  navigator.clipboard.writeText(info.value?.[key] || '').then(() => message.success(t('common.copied')));
}

function downloadPfx() {
  if (!info.value?.pfx) return message.warning(t('certOrder.noPfx'));
  const bytes = Uint8Array.from(atob(info.value.pfx), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/x-pkcs12' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cert.pfx';
  a.click();
  URL.revokeObjectURL(a.href);
}

function del(row: any) {
  dialog.warning({
    title: t('certOrder.deleteTitle'),
    content: t('certOrder.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cert/orders/${row.id}`);
      if (res.code === 0) {
        message.success(t('certOrder.deleteSuccess'));
        loadOrders();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadOrders();
  loadAccounts();
});
</script>

