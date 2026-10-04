<template>
  <div>
    <ResponsiveDataTable :columns="columns" :data="records" :loading="loading" :pagination="pagination" :empty-text="t('record.empty')" />

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

    <n-modal v-model:show="showValue" preset="card" :title="t('record.valueTitle')" style="max-width:560px" :mask-closable="false">
      <n-input type="textarea" :value="valueDetail" :autosize="{ minRows: 2, maxRows: 10 }" readonly />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showValue = false">{{ t('common.close') }}</n-button>
          <n-button type="primary" @click="copyValue">{{ t('common.copy') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showRemark" preset="card" :title="t('record.editRemark')" style="max-width:480px" :mask-closable="false">
      <n-input v-model:value="remarkForm.remark" type="textarea" :rows="3" :placeholder="t('record.remarkContentPlaceholder')" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showRemark = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="savingRemark" @click="saveRemark">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showCheck" preset="card" :title="t('record.checkTitle')" style="max-width:460px" :mask-closable="false">
      <n-space vertical :size="12">
        <n-descriptions :column="1" size="small" label-placement="left" bordered>
          <n-descriptions-item :label="t('record.hostRecord')">{{ checkFullHost }}</n-descriptions-item>
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
import { computed, h, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, useMessage, useDialog } from 'naive-ui';
import { api } from '../api';
import ResponsiveDataTable from './ResponsiveDataTable.vue';

interface DomainTarget {
  id: number;
  sub: string;
}

const props = withDefaults(
  defineProps<{
    records: any[];
    loading?: boolean;
    pagination?: false | Record<string, any>;
    domainId?: number;
    domainName?: string;
    access?: { admin?: boolean; readonly?: boolean; writable?: boolean };
    showFullName?: boolean;
    showAdd?: boolean;
    domainIndex?: Record<string, DomainTarget>;
    subFilter?: string;
  }>(),
  {
    loading: false,
    pagination: false,
    domainId: undefined,
    domainName: '',
    access: undefined,
    showFullName: false,
    showAdd: true,
    domainIndex: undefined,
    subFilter: '',
  },
);

const emit = defineEmits<{ (e: 'refresh'): void }>();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const linesByDid = ref<Record<number, Record<string, string>>>({});
const currentDid = ref<number | null>(null);

const saving = ref(false);
const showEdit = ref(false);
const editingId = ref<string | null>(null);
const editingDid = ref<number | null>(null);
const form = reactive<any>({ name: '', type: 'A', value: '', line: 'default', ttl: 600, mx: 1, remark: '' });

const showValue = ref(false);
const valueDetail = ref('');
const showRemark = ref(false);
const remarkForm = reactive<any>({ did: null, recordId: '', remark: '' });
const savingRemark = ref(false);

const showCheck = ref(false);
const checkResult = ref<any>({ status: '', name: '', domainName: '', type: '', value: '', actual: [], expected: '' });

const typeOptions = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'REDIRECT_URL', 'FORWARD_URL'].map((v) => ({ label: v, value: v }));

const lineOptions = computed(() =>
  Object.entries(linesByDid.value[currentDid.value ?? -1] || {}).map(([name, code]) => ({ label: name, value: code })),
);

const statusText = computed(() => {
  const s = checkResult.value.status;
  if (s === 'active') return t('record.statusActive');
  if (s === 'mismatch') return t('record.statusMismatch');
  if (s === 'not_found') return t('record.statusNotFound');
  return '';
});

const checkFullHost = computed(() => {
  const name = String(checkResult.value.name ?? '');
  const domain = String(checkResult.value.domainName ?? '');
  if (!name || name === '@') return domain;
  return `${name}.${domain}`;
});

function rowDid(row: any): number | null {
  const did = row?.did ?? props.domainId ?? null;
  return did === null || did === undefined ? null : Number(did);
}

function rowDomainName(row: any): string {
  return String(row?.Domain ?? props.domainName ?? '');
}

function rowWritable(row: any): boolean {
  if (row && row._writable !== undefined) return !!row._writable;
  return !!props.access?.writable;
}

function fullRecordDomain(row: any, name: string): string {
  const n = String(name || '').trim().replace(/\.$/, '');
  const base = rowDomainName(row);
  if (!n || n === '@') return base;
  return `${n}.${base}`;
}

function resolveDomainTarget(row: any, name: string): DomainTarget | null {
  if (!props.domainIndex) return null;
  const n = String(name || '').trim();
  if (!n || n === '@') return null;
  const hit = props.domainIndex[fullRecordDomain(row, n).toLowerCase()];
  if (!hit) return null;
  if (hit.id === rowDid(row) && (hit.sub || '') === props.subFilter) return null;
  return hit;
}

function jumpToDomain(row: any, name: string) {
  const target = resolveDomainTarget(row, name);
  if (!target) return;
  const sub = target.sub ? `?sub=${encodeURIComponent(target.sub)}` : '';
  window.open(`/domains/${target.id}/records${sub}`, '_self');
}

async function ensureLines(did: number | null) {
  if (!did || linesByDid.value[did]) return;
  const res = await api<any>('GET', `/domains/${did}/lines`);
  if (res.code === 0) linesByDid.value[did] = res.data;
}

const columns = computed<any[]>(() => {
  const cols: any[] = [
    {
      title: t('record.hostRecord'),
      key: 'Name',
      width: 160,
      render(row: any) {
        const name = String(row.Name ?? '');
        if (props.showFullName) {
          return h('span', null, fullRecordDomain(row, name));
        }
        const target = resolveDomainTarget(row, name);
        if (!target) return name || '@';
        return h(
          NButton,
          { text: true, size: 'tiny', type: 'primary', title: t('record.jumpTo', { domain: fullRecordDomain(row, name) }), onClick: () => jumpToDomain(row, name) },
          { default: () => name },
        );
      },
    },
  ];
  cols.push(
    { title: t('record.typeCol'), key: 'Type', width: 90 },
    {
      title: t('record.valueCol'),
      key: 'Value',
      width: 90,
      render: (row: any) => h(NButton, { text: true, size: 'tiny', type: 'primary', onClick: () => openValue(row.Value) }, { default: () => t('record.view') }),
    },
    {
      title: t('common.remark'),
      key: 'Remark',
      width: 110,
      render(row: any) {
        const text = row.Remark || '';
        if (!rowWritable(row)) return text || '—';
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
        if (!rowWritable(row)) return h(NSpace, null, { default: () => [checkBtn] });
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
  );
  return cols;
});

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
  remarkForm.did = rowDid(row);
  remarkForm.recordId = row.RecordId;
  remarkForm.remark = row.Remark || '';
  showRemark.value = true;
}

async function saveRemark() {
  if (!remarkForm.did) return;
  savingRemark.value = true;
  const res = await api('POST', `/domains/${remarkForm.did}/records/${remarkForm.recordId}/remark`, { remark: remarkForm.remark || null });
  savingRemark.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showRemark.value = false;
    emit('refresh');
  } else message.error(res.msg);
}

function openAdd() {
  if (!props.showAdd || !props.domainId) return;
  editingId.value = null;
  editingDid.value = props.domainId;
  currentDid.value = props.domainId;
  ensureLines(props.domainId);
  Object.assign(form, { name: '', type: 'A', value: '', line: 'default', ttl: 600, mx: 1, remark: '' });
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.RecordId;
  editingDid.value = rowDid(row);
  currentDid.value = rowDid(row);
  ensureLines(rowDid(row));
  Object.assign(form, { name: row.Name, type: row.Type, value: row.Value, line: row.Line, ttl: row.TTL, mx: row.MX ?? 1, remark: row.Remark || '' });
  showEdit.value = true;
}

async function saveRecord() {
  if (!form.name || !form.value) return message.warning(t('record.fillRequired'));
  const did = editingId.value ? editingDid.value : props.domainId;
  if (!did) return;
  saving.value = true;
  const body = { ...form };
  const res = editingId.value
    ? await api('PUT', `/domains/${did}/records/${editingId.value}`, body)
    : await api('POST', `/domains/${did}/records`, body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    emit('refresh');
  } else message.error(res.msg);
}

async function checkRecord(row: any) {
  const did = rowDid(row);
  if (!did) return;
  const value = Array.isArray(row.Value) ? row.Value[0] : row.Value;
  const res = await api<any>('POST', `/domains/${did}/records/check`, { name: row.Name, type: row.Type, value });
  if (res.code === 0) {
    checkResult.value = { ...res.data, name: row.Name, domainName: rowDomainName(row), type: row.Type, value: String(value) };
    showCheck.value = true;
  } else message.error(res.msg);
}

async function toggleStatus(row: any) {
  const did = rowDid(row);
  if (!did) return;
  const target = row.Status === '1' ? '0' : '1';
  const res = await api('POST', `/domains/${did}/records/${row.RecordId}/status`, { status: target });
  if (res.code === 0) {
    message.success(res.msg);
    emit('refresh');
  } else message.error(res.msg);
}

function delRecord(row: any) {
  const did = rowDid(row);
  if (!did) return;
  dialog.warning({
    title: t('record.deleteTitle'),
    content: t('record.deleteConfirm', { name: fullRecordDomain(row, row.Name) }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/domains/${did}/records/${row.RecordId}`);
      if (res.code === 0) {
        message.success(t('record.deleteSuccess'));
        emit('refresh');
      } else message.error(res.msg);
    },
  });
}

defineExpose({ openAdd });
</script>