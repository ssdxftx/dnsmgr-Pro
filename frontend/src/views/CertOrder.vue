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
    <n-grid class="telemetry-row" cols="2 s:2 m:4" responsive="screen" :x-gap="14" :y-gap="14" item-responsive>
      <n-grid-item v-reveal class="d1"><TelemetryCard :label="t('common.total')" :value="orders.length" tone="primary" :icon="ShieldCheckmarkOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="d2"><TelemetryCard :label="t('common.issued')" :value="issuedCount" tone="success" :icon="CheckmarkCircleOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="d3"><TelemetryCard :label="t('common.inProgress')" :value="inProgressCount" tone="info" :icon="TimeOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="d4"><TelemetryCard :label="t('common.expiringSoon')" :value="expiringCount" tone="warning" :icon="WarningOutline" :caption="t('common.last30d')" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('certOrder.listTitle') }}</h3>
        </div>
        <ResponsiveDataTable :columns="columns" :data="orders" title-key="domains" :loading="loadBusy" :empty-text="t('certOrder.empty')" :empty-description="t('certOrder.emptyHint')" />
      </div>
    </n-card>

    <!-- 添加/编辑弹窗 -->
    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('certOrder.editTitle') : t('certOrder.applyTitle')" class="modal-md" :mask-closable="false">
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
          <n-button type="primary" :loading="saveBusy" @click="save">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 证书详情 -->
    <n-modal v-model:show="showInfo" preset="card" :title="t('certOrder.infoTitle')" class="modal-lg" :mask-closable="false">
      <n-spin :show="infoBusy">
        <template v-if="info">
          <n-descriptions bordered :column="1" label-placement="left" class="mb-4">
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
        </template>
      </n-spin>
      <template #footer>
        <n-space v-if="info" justify="end">
          <n-button @click="copyText('crt')">{{ t('certOrder.copyCert') }}</n-button>
          <n-button @click="copyText('key')">{{ t('certOrder.copyKey') }}</n-button>
          <n-button @click="downloadCert">{{ t('certOrder.downloadCert') }}</n-button>
          <n-button @click="downloadKey">{{ t('certOrder.downloadKey') }}</n-button>
          <n-button type="primary" @click="downloadPfx">{{ t('certOrder.downloadPfx') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 日志 -->
    <n-modal v-model:show="showLog" preset="card" :title="t('certOrder.logTitle')" class="modal-lg" :mask-closable="false">
      <n-spin :show="logBusy">
        <n-input v-model:value="logText" type="textarea" :rows="18" readonly />
      </n-spin>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NDropdown, NDynamicInput, NInput, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, ShieldCheckmarkOutline, CheckmarkCircleOutline, TimeOutline, WarningOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import { useAction } from '../composables/useAction';

const router = useRouter();
const { t } = useI18n();
const { busy, run } = useAction();

const message = useMessage();
const dialog = useDialog();
const loadBusy = ref(false);
const orders = ref<any[]>([]);
// 遥测统计（基于完整订单列表，单次遍历计算）
const orderStats = computed(() => {
  let issued = 0;
  let inProgress = 0;
  let expiring = 0;
  for (const o of orders.value) {
    const st = Number(o.status);
    if (st === 3) {
      issued++;
      if (o.end_day != null && Number(o.end_day) <= 30) expiring++;
    } else if (st === 1 || st === 2) {
      inProgress++;
    }
  }
  return { issued, inProgress, expiring };
});
const issuedCount = computed(() => orderStats.value.issued);
const inProgressCount = computed(() => orderStats.value.inProgress);
const expiringCount = computed(() => orderStats.value.expiring);
const statusLabel = ref<Record<string, string>>({});
const accounts = ref<any[]>([]);
const accountOptions = ref<any[]>([]);

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saveBusy = ref(false);
const tab = ref('apply');
const form = reactive<any>({ aid: null, keytype: 'RSA', keysize: '2048', domains: [], fullchain: '', privatekey: '' });

const showInfo = ref(false);
const info = ref<any>(null);
const infoBusy = ref(false);
const showLog = ref(false);
const logText = ref('');
const logBusy = ref(false);

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
  { title: 'ID', key: 'id', width: 60, mobile: 'hide' },
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
    width: 178,
    render(row: any) {
      if (!row.expiretime) return '-';
      const days = row.end_day != null ? `（${t('certOrder.remainingDays', { days: row.end_day })}）` : '';
      return h('span', { style: 'white-space: nowrap' }, `${row.expiretime}${days}`);
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 220,
    render(row: any) {
      const btns: any[] = [];
      // 主操作：按状态唯一（进行中→处理/验证；已签发→详情）
      if (row.status < 3) {
        const pKey = `process:${row.id}`;
        btns.push(
          h(
            NButton,
            {
              size: 'tiny',
              quaternary: true,
              type: 'primary',
              loading: !!busy[pKey],
              disabled: !!busy[pKey],
              onClick: () => run(pKey, () => process(row)),
            },
            { default: () => (row.status === 1 ? t('certOrder.verify') : t('certOrder.process')) },
          ),
        );
      } else if (row.status === 3) {
        btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => viewInfo(row) }, { default: () => t('common.detail') }));
      }
      // 行内弱操作
      btns.push(h(NButton, { size: 'tiny', quaternary: true, onClick: () => viewLog(row) }, { default: () => t('certOrder.log') }));
      // 其余状态相关操作收进「更多」，避免按钮墙换行
      const more: any[] = [];
      if (row.status < 3) more.push({ label: t('certOrder.reset'), key: 'reset' });
      if (row.status === 3) {
        more.push({ label: t('certOrder.revoke'), key: 'revoke' });
        more.push({ label: row.isauto ? t('certOrder.autoOff') : t('certOrder.autoOn'), key: 'auto' });
      }
      if (more.length) {
        btns.push(
          h(
            NDropdown,
            {
              options: more,
              onSelect: (key: string) => {
                if (key === 'reset') reset(row);
                else if (key === 'revoke') revoke(row);
                else if (key === 'auto') toggleAuto(row);
              },
            },
            { default: () => h(NButton, { size: 'tiny', quaternary: true }, { default: () => t('common.more') }) }
          )
        );
      }
      btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h('div', { class: 'row-actions' }, btns);
    },
  },
]);

async function loadOrders() {
  loadBusy.value = true;
  const res = await api<any>('GET', '/cert/orders', { limit: 200 });
  if (res.code === 0) {
    orders.value = res.data;
    statusLabel.value = res.status_label || {};
  } else orders.value = [];
  loadBusy.value = false;
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
  saveBusy.value = true;
  try {
    const res = editingId.value
      ? await api('PUT', `/cert/orders/${editingId.value}`, body)
      : await api('POST', '/cert/orders', body);
    if (res.code === 0) {
      message.success(res.msg);
      showEdit.value = false;
      loadOrders();
    } else message.error(res.msg);
  } finally {
    saveBusy.value = false;
  }
}

// 防重复提交由 useAction 的 busy 键保证（签发为耗时操作，重复触发会重复下单）
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
  const prev = row.isauto ? 1 : 0;
  const target = prev ? 0 : 1;
  row.isauto = target; // 乐观更新
  const res = await api('POST', `/cert/orders/${row.id}/setauto`, { isauto: target });
  if (res.code === 0) message.success(t('common.success'));
  else {
    row.isauto = prev; // 失败回滚
    message.error(res.msg);
  }
}

function askPassword(title: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    let value = '';
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    dialog.warning({
      title,
      content: () =>
        h(NInput, {
          type: 'password',
          showPasswordOn: 'click',
          placeholder,
          onUpdateValue: (v: string) => {
            value = v;
          },
        }),
      positiveText: t('common.confirm'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => finish(value),
      onNegativeClick: () => finish(null),
      onClose: () => finish(null),
      onMaskClick: () => finish(null),
    });
  });
}

async function viewInfo(row: any) {
  const password = await askPassword(t('certOrder.infoTitle'), t('vault.loginPass'));
  if (password === null) return;
  info.value = null;
  showInfo.value = true; // 先开弹窗，立即给出视觉响应
  infoBusy.value = true;
  try {
    const res = await api<any>('GET', `/cert/orders/${row.id}/info`, undefined, {
      headers: { 'X-Confirm-Password': password },
    });
    if (res.code === 0) info.value = res.data;
    else {
      showInfo.value = false;
      message.error(res.msg);
    }
  } finally {
    infoBusy.value = false;
  }
}

async function viewLog(row: any) {
  logText.value = '';
  showLog.value = true; // 先开弹窗，立即给出视觉响应
  logBusy.value = true;
  try {
    const res = await api<any>('GET', `/cert/orders/${row.id}/log`);
    if (res.code === 0) logText.value = res.data;
    else {
      showLog.value = false;
      message.info(res.msg || t('certOrder.noLog'));
    }
  } finally {
    logBusy.value = false;
  }
}

function copyText(key: 'crt' | 'key') {
  navigator.clipboard.writeText(info.value?.[key] || '').then(() => message.success(t('common.copied')));
}

function downloadBlob(filename: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadCert() {
  if (!info.value?.crt) return message.warning(t('certOrder.noCert'));
  downloadBlob('fullchain.crt', new Blob([info.value.crt], { type: 'application/x-pem-file' }));
}

function downloadKey() {
  if (!info.value?.key) return message.warning(t('certOrder.noKey'));
  downloadBlob('private.key', new Blob([info.value.key], { type: 'application/x-pem-file' }));
}

function downloadPfx() {
  if (!info.value?.pfx) return message.warning(t('certOrder.noPfx'));
  const bytes = Uint8Array.from(atob(info.value.pfx), (c) => c.charCodeAt(0));
  downloadBlob('cert.pfx', new Blob([bytes], { type: 'application/x-pkcs12' }));
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

