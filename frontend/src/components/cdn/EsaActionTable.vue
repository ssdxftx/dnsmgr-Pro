<template>
  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">
        {{ title }}
        <n-tag v-if="gate" size="tiny" :bordered="false" type="warning" style="margin-left: 6px">{{ gate }}</n-tag>
        <n-tag v-if="paginate ? pagination.itemCount : rows.length" size="tiny" :bordered="false" class="tnum" style="margin-left: 6px">
          {{ paginate ? pagination.itemCount : rows.length }}
        </n-tag>
      </h3>
      <div class="app-panel__extra">
        <slot name="actions" />
        <n-button size="small" :loading="loadBusy" :disabled="loadBusy" @click="load">{{ t('esaZone.reload') }}</n-button>
        <n-button v-if="createAction" size="small" type="primary" :disabled="!!gate && gateLocked" @click="openCreate">
          {{ createLabel || t('esaZone.create') }}
        </n-button>
      </div>
    </div>
    <p v-if="desc" class="hint-text mb-3">{{ desc }}</p>

    <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>

    <ResponsiveDataTable
      :columns="tableColumns"
      :data="rows"
      size="small"
      :loading="loadBusy"
      :pagination="paginate ? pagination : false"
      :empty-text="t('esaZone.empty')"
      :error="!!loadError"
      @retry="load"
    />

    <n-modal
      v-model:show="showForm"
      preset="card"
      :title="editingRow ? editLabel || t('esaZone.edit') : createLabel || t('esaZone.create')"
      class="modal-lg"
      :mask-closable="false"
    >
      <n-form v-if="activeFields.length" label-placement="left" label-width="150" size="small">
        <n-form-item v-for="f in activeFields" :key="f.name" :label="f.label" :required="f.required">
          <div class="esa-table__field">
            <EsaCardSelect
              v-if="f.type === 'cards'"
              v-model="form[f.name]"
              :options="f.options || []"
              :placeholder="f.placeholder"
              compact
            />
            <EsaCardSelect
              v-else-if="f.type === 'select'"
              v-model="form[f.name]"
              :options="f.options || []"
              :placeholder="f.placeholder"
              compact
              clearable
            />
            <n-switch v-else-if="f.type === 'switch' || f.type === 'onoff'" v-model:value="form[f.name]" size="small" />
            <n-input-number
              v-else-if="f.type === 'number' || f.type === 'stringnumber'"
              v-model:value="form[f.name]"
              :min="f.min"
              :max="f.max"
              :step="f.step"
              style="width: 220px"
            />
            <n-input
              v-else-if="f.type === 'textarea'"
              v-model:value="form[f.name]"
              type="textarea"
              :rows="4"
              :placeholder="f.placeholder"
            />
            <n-input
              v-else-if="f.type === 'json'"
              v-model:value="form[f.name]"
              type="textarea"
              :rows="7"
              class="mono-input"
              spellcheck="false"
              :placeholder="f.placeholder || 'JSON'"
            />
            <EsaRowsEditor
              v-else-if="f.type === 'rows'"
              v-model="form[f.name]"
              :fields="f.rowFields || []"
              :default-row="f.defaultRow"
              :add-label="f.addLabel"
            />
            <n-input v-else v-model:value="form[f.name]" :placeholder="f.placeholder" />
            <span v-if="f.help" class="esa-table__help">{{ f.help }}</span>
          </div>
        </n-form-item>
      </n-form>
      <n-input
        v-else
        v-model:value="rawForm"
        type="textarea"
        :rows="10"
        class="mono-input"
        spellcheck="false"
        :placeholder="t('esaZone.rawHint')"
      />

      <template #footer>
        <n-space justify="end">
          <n-button @click="showForm = false">{{ t('esaZone.cancel') }}</n-button>
          <n-button type="primary" :loading="submitBusy" :disabled="submitBusy" @click="submit">{{ t('esaZone.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialog, useMessage, NButton, NTag } from 'naive-ui';
import { api } from '../../api';
import { formatDateTime } from '../../lib/datetime';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import EsaRowsEditor from './EsaRowsEditor.vue';
import EsaCardSelect from './EsaCardSelect.vue';
import type { EsaFieldDef } from './EsaActionPanel.vue';

export interface EsaTableColumn {
  key: string;
  label: string;
  width?: number;
  minWidth?: number;
  mono?: boolean;
  format?: 'bool' | 'json' | 'csv' | 'text';
  /** 当前字段为空时依次尝试的备用字段 */
  fallbackKeys?: string[];
}

const props = withDefaults(
  defineProps<{
    aid: number;
    zoneId: string;
    title: string;
    desc?: string;
    gate?: string;
    gateLocked?: boolean;
    listAction: string;
    listParams?: Record<string, any>;
    itemsPath?: string;
    columns?: EsaTableColumn[];
    idKey?: string;
    nameKey?: string;
    createAction?: string;
    createLabel?: string;
    createFields?: EsaFieldDef[];
    createDefaults?: Record<string, any>;
    createParams?: Record<string, any>;
    extraParams?: Record<string, any>;
    updateAction?: string;
    editLabel?: string;
    updateFields?: EsaFieldDef[];
    deleteAction?: string;
    pageSize?: number;
    paginate?: boolean;
    stripKeys?: string[];
  }>(),
  {
    columns: () => [],
    createFields: () => [],
    updateFields: () => [],
    idKey: 'Id',
    nameKey: 'Name',
    pageSize: 20,
    paginate: true,
    stripKeys: () => ['RequestId'],
  },
);

const emit = defineEmits<{ (e: 'changed'): void }>();

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const rows = ref<any[]>([]);
const loadBusy = ref(false);
const loadError = ref('');
const showForm = ref(false);
const submitBusy = ref(false);
const editingRow = ref<any>(null);
const form = reactive<Record<string, any>>({});
const rawForm = ref('');
const pagination = reactive({
  page: 1,
  pageSize: props.pageSize,
  itemCount: 0,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  onChange: (page: number) => {
    pagination.page = page;
    load();
  },
  onUpdatePageSize: (size: number) => {
    pagination.pageSize = size;
    pagination.page = 1;
    load();
  },
});

const activeFields = computed(() => (editingRow.value ? props.updateFields.length ? props.updateFields : props.createFields : props.createFields));

const tableColumns = computed(() => {
  const cols: any[] = [];
  const defs = props.columns.length ? props.columns : autoColumns.value;
  for (const c of defs) {
    cols.push({
      title: c.label,
      key: c.key,
      width: c.width,
      minWidth: c.minWidth ?? 120,
      ellipsis: { tooltip: true },
      render: (row: any) => {
        let value = row?.[c.key];
        for (const key of c.fallbackKeys || []) {
          if (value !== undefined && value !== null && value !== '') break;
          value = row?.[key];
        }
        return renderCell(value, c);
      },
    });
  }
  if (props.deleteAction || props.updateAction) {
    cols.push({
      title: t('esaZone.actions'),
      key: 'actions',
      width: 130,
      render: (row: any) =>
        h('div', { class: 'row-actions' }, [
          props.updateAction
            ? h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEdit(row) }, { default: () => t('esaZone.edit') })
            : null,
          props.deleteAction
            ? h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => remove(row) }, { default: () => t('esaZone.delete') })
            : null,
        ]),
    });
  }
  return cols;
});

const autoColumns = computed<EsaTableColumn[]>(() => {
  const first = rows.value[0];
  if (!first || typeof first !== 'object') return [];
  return Object.keys(first)
    .filter((k) => k !== 'RequestId')
    .slice(0, 8)
    .map((k) => ({ key: k, label: k }));
});

function renderCell(value: any, c: EsaTableColumn) {
  if (value === undefined || value === null) return '-';
  if (c.format === 'bool') return h(NTag, { size: 'small', type: value ? 'success' : 'default', bordered: false }, { default: () => (value ? t('esaZone.yes') : t('esaZone.no')) });
  if (c.format === 'csv' && Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  if (typeof value === 'object') {
    const text = Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ') : JSON.stringify(value);
    return h('span', { class: c.mono ? 'app-mono' : '' }, text);
  }
  return h('span', { class: c.mono ? 'app-mono' : '' }, typeof value === 'string' ? formatDateTime(value, '') : String(value));
}

function getPath(obj: any, path?: string): any {
  if (!path) return obj;
  return String(path)
    .split('.')
    .filter(Boolean)
    .reduce((acc: any, key) => (acc == null ? acc : acc[key]), obj);
}

function extractItems(data: any): any[] {
  if (!data) return [];
  if (props.itemsPath) {
    const hit = getPath(data, props.itemsPath);
    if (Array.isArray(hit)) return hit;
  }
  if (Array.isArray(data)) return data;
  for (const [k, v] of Object.entries(data)) {
    if (k === 'RequestId') continue;
    if (Array.isArray(v)) return v;
  }
  return [];
}

async function load() {
  loadBusy.value = true;
  loadError.value = '';
  const page = props.paginate ? pagination.page : 1;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action: props.listAction,
      zoneId: props.zoneId,
      params: {
        ...(props.paginate ? { PageNumber: page, PageSize: pagination.pageSize } : {}),
        ...(props.listParams || {}),
      },
    });
    if (res.code !== 0) {
      loadError.value = res.msg || t('esaZone.loadFailed');
      rows.value = [];
      return;
    }
    rows.value = extractItems(res.data);
    if (props.paginate) {
      const total = Number(res.data?.TotalCount ?? res.data?.Total ?? NaN);
      pagination.itemCount = Number.isFinite(total)
        ? total
        : (page - 1) * pagination.pageSize +
          rows.value.length +
          (rows.value.length >= pagination.pageSize ? 1 : 0);
    }
  } catch (e: any) {
    loadError.value = e?.message || t('esaZone.loadFailed');
    rows.value = [];
  } finally {
    loadBusy.value = false;
  }
}

function initForm(row?: any) {
  for (const key of Object.keys(form)) delete form[key];
  const fields = row ? (props.updateFields.length ? props.updateFields : props.createFields) : props.createFields;
  for (const f of fields) {
    const initial = row ? row[f.name] : props.createDefaults?.[f.name] ?? f.default;
    if (f.type === 'onoff') form[f.name] = initial === 'on' || initial === true;
    else if (f.type === 'switch') form[f.name] = initial === true || initial === 'on';
    else if (f.type === 'json') form[f.name] = initial === undefined || initial === null ? '' : typeof initial === 'string' ? initial : JSON.stringify(initial, null, 2);
    else if (f.type === 'stringnumber') form[f.name] = initial === undefined || initial === null || initial === '' ? null : Number(initial);
    else if (f.type === 'rows') {
      let rows = initial;
      if (typeof rows === 'string') {
        try {
          rows = JSON.parse(rows);
        } catch {
          rows = [];
        }
      }
      form[f.name] = Array.isArray(rows) ? rows.map((row: any) => ({ ...row })) : [];
    } else form[f.name] = initial ?? null;
  }
  if (!fields.length) rawForm.value = row ? JSON.stringify(row, null, 2) : '{}';
}

function openCreate() {
  editingRow.value = null;
  initForm();
  showForm.value = true;
}

function openEdit(row: any) {
  editingRow.value = row;
  initForm(row);
  showForm.value = true;
}

function buildPayload(): Record<string, any> | null {
  const fields = activeFields.value;
  if (!fields.length) {
    try {
      const parsed = JSON.parse(rawForm.value || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      for (const key of props.stripKeys) delete parsed[key];
      return parsed;
    } catch {
      message.warning(t('esaZone.invalidJson'));
      return null;
    }
  }
  const out: Record<string, any> = {};
  for (const f of fields) {
    let v = form[f.name];
    if (f.type === 'onoff') v = v ? 'on' : 'off';
    else if (f.type === 'switch') v = Boolean(v);
    else if (f.type === 'number') v = v === null || v === '' ? undefined : Number(v);
    else if (f.type === 'stringnumber') v = v === null || v === '' ? undefined : String(v);
    else if (f.type === 'rows') {
      v = Array.isArray(v) ? v : undefined;
      if (v) v = v.filter((row: any) => row && Object.values(row).some((x) => x !== '' && x !== null && x !== undefined));
    } else if (f.type === 'json') {
      if (v === null || v === undefined || v === '') v = undefined;
      else {
        try {
          v = JSON.parse(String(v));
        } catch {
          message.warning(t('esaZone.invalidJsonField', { field: f.label }));
          return null;
        }
      }
    }
    if (v !== undefined && v !== null && v !== '') out[f.name] = v;
  }
  return out;
}

async function submit() {
  const payload = buildPayload();
  if (payload === null) return;
  const editing = editingRow.value;
  const action = editing ? props.updateAction : props.createAction;
  if (!action) return;
  submitBusy.value = true;
  try {
    const params = editing
      ? { ...(props.extraParams || {}), ...payload, [props.idKey]: editing[props.idKey] }
      : { ...(props.extraParams || {}), ...(props.createParams || {}), ...payload };
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action,
      zoneId: props.zoneId,
      params,
    });
    if (res.code === 0) {
      message.success(t('esaZone.saved'));
      showForm.value = false;
      await load();
      emit('changed');
    } else {
      message.error(res.msg || t('esaZone.saveFailed'));
    }
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  } finally {
    submitBusy.value = false;
  }
}

function remove(row: any) {
  if (!props.deleteAction) return;
  const name = row?.[props.nameKey] ?? row?.[props.idKey] ?? '';
  dialog.warning({
    title: t('esaZone.delete'),
    content: t('esaZone.deleteConfirm', { name: String(name) }),
    positiveText: t('esaZone.delete'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
        action: props.deleteAction,
        zoneId: props.zoneId,
        params: { ...(props.extraParams || {}), [props.idKey]: row[props.idKey] },
      });
      if (res.code === 0) {
        message.success(t('esaZone.deleted'));
        await load();
        emit('changed');
      } else {
        message.error(res.msg || t('esaZone.deleteFailed'));
      }
    },
  });
}

onMounted(load);

defineExpose({ load });
</script>

<style scoped>
.esa-table__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.esa-table__help {
  font-size: 11px;
  color: var(--app-text-3);
}
</style>
