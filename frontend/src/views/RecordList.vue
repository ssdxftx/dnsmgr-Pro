<template>
  <div class="app-stack">
    <PageHeader :title="t('record.title', { title: displayTitle })" :subtitle="t('record.subtitle')" back="/domains">
      <template #actions>
        <n-space>
          <n-button v-if="accountType === 'cloudflare' && isAdmin" type="info" @click="router.push(`/cloudflare/domains/${domainId}/hostnames`)">{{ t('record.customHostnames') }}</n-button>
          <n-button v-if="accountType === 'cloudflare' && isAdmin" type="primary" secondary @click="router.push(`/cf-rules?domain=${domainId}`)">{{ t('record.rulesEngine') }}</n-button>
          <n-button v-if="access.writable" type="primary" @click="openAdd">
            <template #icon><n-icon :component="AddOutline" /></template>
            {{ t('record.addRecord') }}
          </n-button>
        </n-space>
      </template>
    </PageHeader>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="records" :loading="loading" :pagination="pagination" :empty-text="t('record.empty')" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('record.editTitle') : t('record.addTitle')" style="max-width:640px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('record.hostRecord')">
          <n-input v-model:value="form.name" :placeholder="t('record.hostPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('record.recordType')">
          <n-select v-model:value="form.type" :options="typeOptions" />
        </n-form-item>
        <n-form-item :label="t('record.recordValue')">
          <n-input v-model:value="form.value" :placeholder="t('record.valuePlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('record.line')">
          <n-select v-model:value="form.line" :options="lineOptions" filterable :placeholder="t('record.defaultLinePlaceholder')" />
        </n-form-item>
        <n-form-item label="TTL">
          <n-input-number v-model:value="form.ttl" :min="1" style="width:100%" />
        </n-form-item>
        <n-form-item v-if="form.type === 'MX'" :label="t('record.priority')">
          <n-input-number v-model:value="form.mx" :min="0" style="width:100%" />
        </n-form-item>
        <n-form-item :label="t('common.remark')">
          <n-input v-model:value="form.remark" :placeholder="t('record.remarkPlaceholder')" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="saveRecord">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showValue" preset="card" :title="t('record.valueTitle')" style="max-width:560px">
      <n-input type="textarea" :value="valueDetail" :autosize="{ minRows: 2, maxRows: 10 }" readonly />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showValue = false">{{ t('common.close') }}</n-button>
          <n-button type="primary" @click="copyValue">{{ t('common.copy') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showRemark" preset="card" :title="t('record.editRemark')" style="max-width:480px">
      <n-input v-model:value="remarkForm.remark" type="textarea" :rows="3" :placeholder="t('record.remarkContentPlaceholder')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showRemark = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="savingRemark" @click="saveRemark">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showCheck" preset="card" :title="t('record.checkTitle')" style="max-width:460px">
      <n-space vertical :size="12">
        <n-descriptions :column="1" size="small" label-placement="left" bordered>
          <n-descriptions-item :label="t('record.hostRecord')">{{ checkResult.name }}.{{ displayTitle }}</n-descriptions-item>
          <n-descriptions-item :label="t('record.recordType')">{{ checkResult.type }}</n-descriptions-item>
          <n-descriptions-item :label="t('record.recordValue')">{{ checkResult.value }}</n-descriptions-item>
        </n-descriptions>
        <n-alert
          :type="checkResult.status === 'active' ? 'success' : checkResult.status === 'mismatch' ? 'error' : 'warning'"
          :show-icon="false"
          :title="statusText"
        />
        <div v-if="checkResult.actual && checkResult.actual.length">
          <n-text strong>{{ t('record.actualValue') }}</n-text>
          <n-ul>
            <n-li v-for="(a, i) in checkResult.actual" :key="i">{{ a }}</n-li>
          </n-ul>
        </div>
        <div v-if="checkResult.expected">
          <n-text strong>{{ t('record.expectedValue') }}</n-text>
          <span>{{ checkResult.expected }}</span>
        </div>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCheck = false">{{ t('common.close') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NSpace, NTag, useMessage, useDialog } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const domainId = Number(route.params.id);
const domainName = ref('');
const accountType = ref('');
const isAdmin = computed(() => (getUser()?.level || 0) >= 2);
const subFilter = computed(() => (route.query.sub as string) || '');
const displayTitle = computed(() => {
  if (!domainName.value) return t('record.domainFallback', { id: domainId });
  return subFilter.value ? `${subFilter.value}.${domainName.value}` : domainName.value;
});
const access = ref<{ admin: boolean; readonly: boolean; writable: boolean }>({ admin: true, readonly: false, writable: true });
const domainIndex = ref<Record<string, { id: number; sub: string }>>({});

const loading = ref(false);
const records = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const lines = ref<Record<string, string>>({});

const showEdit = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const form = reactive<any>({ name: '', type: 'A', value: '', line: 'default', ttl: 600, mx: 1, remark: '' });

const showValue = ref(false);
const valueDetail = ref('');
const showRemark = ref(false);
const remarkForm = reactive<any>({ recordId: '', remark: '' });
const savingRemark = ref(false);

const showCheck = ref(false);
const checking = ref(false);
const checkResult = ref<any>({ status: '', name: '', type: '', value: '', actual: [], expected: '' });

const statusText = computed(() => {
  const s = checkResult.value.status;
  if (s === 'active') return t('record.statusActive');
  if (s === 'mismatch') return t('record.statusMismatch');
  if (s === 'not_found') return t('record.statusNotFound');
  return '';
});

const pagination = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  onChange: (p: number) => {
    page.value = p;
    loadRecords();
  },
}));

const typeOptions = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'REDIRECT_URL', 'FORWARD_URL'].map((t) => ({ label: t, value: t }));

const lineOptions = computed(() =>
  Object.entries(lines.value).map(([name, code]) => ({ label: name, value: code })),
);

const columns = computed(() => [
  {
    title: t('record.hostRecord'),
    key: 'Name',
    width: 160,
    render(row: any) {
      const name = String(row.Name ?? '');
      const target = resolveDomainTarget(name);
      if (!target) return name || '@';
      return h(
        NButton,
        { text: true, size: 'tiny', type: 'primary', title: t('record.jumpTo', { domain: fullRecordDomain(name) }), onClick: () => jumpToDomain(name) },
        { default: () => name },
      );
    },
  },
  { title: t('record.typeCol'), key: 'Type', width: 90 },
  {
    title: t('record.valueCol'),
    key: 'Value',
    width: 90,
    render(row: any) {
      return h(NButton, { text: true, size: 'tiny', type: 'primary', onClick: () => openValue(row.Value) }, { default: () => t('record.view') });
    },
  },
  {
    title: t('common.remark'),
    key: 'Remark',
    width: 110,
    render(row: any) {
      const text = row.Remark || '';
      if (!access.value.writable) return text || '—';
      return h(
        NButton,
        { text: true, size: 'tiny', type: text ? 'default' : 'primary', onClick: () => openRemark(row) },
        { default: () => text || t('record.addRemark') },
      );
    },
  },
  { title: t('record.lineCol'), key: 'Line', width: 90 },
  { title: 'TTL', key: 'TTL', width: 80 },
  {
    title: t('common.status'),
    key: 'Status',
    width: 80,
    render(row: any) {
      return h(NTag, { type: row.Status === '1' ? 'success' : 'default', size: 'small' }, { default: () => (row.Status === '1' ? t('common.enable') : t('record.paused')) });
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 260,
    render(row: any) {
      const checkBtn = h(NButton, { size: 'tiny', type: 'info', onClick: () => checkRecord(row) }, { default: () => t('record.check') });
      if (!access.value.writable) return h(NSpace, null, { default: () => [checkBtn] });
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', onClick: () => toggleStatus(row) }, { default: () => (row.Status === '1' ? t('record.paused') : t('common.enable')) }),
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => delRecord(row) }, { default: () => t('common.delete') }),
          checkBtn,
        ],
      });
    },
  },
]);

async function loadRecords() {
  loading.value = true;
  const res = await api<any>('GET', `/domains/${domainId}/records`, { page: page.value, pagesize: pageSize.value, subdomain: subFilter.value || undefined });
  if (res.code === 0) {
    records.value = res.data.list;
    total.value = res.data.total;
    domainName.value = res.data.list?.[0]?.Domain || domainName.value;
    access.value = res.data._access || { admin: true, readonly: false, writable: true };
  } else {
    message.error(res.msg);
  }
  loading.value = false;
}

async function loadLines() {
  const res = await api<any>('GET', `/domains/${domainId}/lines`);
  if (res.code === 0) lines.value = res.data;
}

async function loadDomainInfo() {
  const res = await api<any>('GET', '/domains');
  if (res.code === 0) {
    const list: any[] = res.data || [];
    // 管理员可跳转到独立纳管的子域名；普通用户可跳转到被授权的子域名范围（name 形如 user1.example.com）
    const index: Record<string, { id: number; sub: string }> = {};
    for (const d of list) {
      const key = String(d.name || '').toLowerCase();
      if (key && !index[key]) index[key] = { id: d.id, sub: d._sub || '' };
    }
    domainIndex.value = index;
    const d = list.find((x: any) => x.id === domainId);
    if (d) {
      domainName.value = d._base_name || d.name;
      accountType.value = d.account_type || '';
    }
  }
}

function fullRecordDomain(name: string): string {
  const n = String(name || '').trim().replace(/\.$/, '');
  if (!n || n === '@') return domainName.value;
  return `${n}.${domainName.value}`;
}

// 主机记录对应的域名若在本系统内可访问，则返回跳转目标
function resolveDomainTarget(name: string): { id: number; sub: string } | null {
  const n = String(name || '').trim();
  if (!n || n === '@') return null;
  const hit = domainIndex.value[fullRecordDomain(n).toLowerCase()];
  if (!hit) return null;
  if (hit.id === domainId && (hit.sub || '') === subFilter.value) return null;
  return hit;
}

function jumpToDomain(name: string) {
  const target = resolveDomainTarget(name);
  if (!target) return;
  router.push({ path: `/domains/${target.id}/records`, query: target.sub ? { sub: target.sub } : {} });
}

function openValue(value: any) {
  valueDetail.value = String(value ?? '');
  showValue.value = true;
}

async function copyValue() {
  try {
    await navigator.clipboard.writeText(valueDetail.value);
    message.success(t('common.copied'));
  } catch {
    message.error(t('record.copyFailed'));
  }
}

function openRemark(row: any) {
  remarkForm.recordId = row.RecordId;
  remarkForm.remark = row.Remark || '';
  showRemark.value = true;
}

async function saveRemark() {
  savingRemark.value = true;
  const res = await api('POST', `/domains/${domainId}/records/${remarkForm.recordId}/remark`, { remark: remarkForm.remark || null });
  savingRemark.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showRemark.value = false;
    loadRecords();
  } else message.error(res.msg);
}

function openAdd() {
  editingId.value = null;
  Object.assign(form, { name: '', type: 'A', value: '', line: 'default', ttl: 600, mx: 1, remark: '' });
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.RecordId;
  Object.assign(form, { name: row.Name, type: row.Type, value: row.Value, line: row.Line, ttl: row.TTL, mx: row.MX ?? 1, remark: row.Remark || '' });
  showEdit.value = true;
}

async function saveRecord() {
  if (!form.name || !form.value) return message.warning(t('record.fillRequired'));
  saving.value = true;
  const body = { ...form };
  const res = editingId.value
    ? await api('PUT', `/domains/${domainId}/records/${editingId.value}`, body)
    : await api('POST', `/domains/${domainId}/records`, body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadRecords();
  } else message.error(res.msg);
}

async function checkRecord(row: any) {
  const value = Array.isArray(row.Value) ? row.Value[0] : row.Value;
  checking.value = true;
  try {
    const res = await api<any>('POST', `/domains/${domainId}/records/check`, { name: row.Name, type: row.Type, value });
    if (res.code === 0) {
      checkResult.value = { ...res.data, name: row.Name, type: row.Type, value: String(value) };
      showCheck.value = true;
    } else message.error(res.msg);
  } finally {
    checking.value = false;
  }
}

async function toggleStatus(row: any) {
  const target = row.Status === '1' ? '0' : '1';
  const res = await api('POST', `/domains/${domainId}/records/${row.RecordId}/status`, { status: target });
  if (res.code === 0) {
    message.success(res.msg);
    loadRecords();
  } else message.error(res.msg);
}

function delRecord(row: any) {
  dialog.warning({
    title: t('record.deleteTitle'),
    content: t('record.deleteConfirm', { name: `${row.Name}.${domainName.value || ''}` }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/domains/${domainId}/records/${row.RecordId}`);
      if (res.code === 0) {
        message.success(t('record.deleteSuccess'));
        loadRecords();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadRecords();
  loadLines();
  loadDomainInfo();
});
</script>