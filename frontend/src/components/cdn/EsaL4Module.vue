<template>
  <div>
    <template v-if="sub === 'apps'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">
            {{ t('esaZone.l4Apps') }}
            <n-tag size="tiny" :bordered="false" type="warning" style="margin-left: 6px">Enterprise</n-tag>
            <n-tag v-if="rows.length" size="tiny" :bordered="false" class="tnum" style="margin-left: 6px">{{ rows.length }}</n-tag>
          </h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="loadBusy" :disabled="loadBusy" @click="load">{{ t('esaZone.reload') }}</n-button>
            <n-button size="small" type="primary" @click="openCreate">{{ t('esaZone.l4Create') }}</n-button>
          </div>
        </div>
        <p class="esa-module__hint">{{ t('esaZone.l4AppsDesc') }}</p>
        <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>
        <ResponsiveDataTable :columns="columns" :data="rows" size="small" :loading="loadBusy" :empty-text="t('esaZone.empty')" :error="!!loadError" @retry="load" />
      </div>
    </template>

    <template v-else>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.l4Analytics') }}</h3>
          <div class="app-panel__extra"><n-tag size="tiny" :bordered="false" type="warning">Enterprise</n-tag></div>
        </div>
        <p class="esa-module__hint">{{ t('esaZone.l4AnalyticsDesc') }}</p>
        <n-button size="small" type="primary" @click="openStats('account')">{{ t('esaZone.openAnalytics') }}</n-button>
      </div>
    </template>

    <n-modal
      v-model:show="showForm"
      preset="card"
      :title="editing ? t('esaZone.l4Edit') : t('esaZone.l4Create')"
      class="modal-xl"
      :mask-closable="false"
    >
      <n-form label-placement="left" label-width="170" size="small">
        <n-form-item :label="t('esaZone.l4RecordName')">
          <n-input v-model:value="form.RecordName" :disabled="!!editing" placeholder="l4.example.com" />
        </n-form-item>
        <n-form-item :label="t('esaZone.l4Rules')">
          <EsaRowsEditor v-model="form.Rules" :fields="ruleRowFields" :default-row="defaultRule" :add-label="t('esaZone.l4AddRule')" />
        </n-form-item>
        <n-form-item :label="t('esaZone.l4IpAccess')">
          <n-switch v-model:value="form.IpAccessRule" size="small" />
          <span class="esa-l4__help">{{ t('esaZone.l4IpAccessHelp') }}</span>
        </n-form-item>
        <n-form-item :label="t('esaZone.l4Ipv6')">
          <n-switch v-model:value="form.Ipv6" size="small" />
        </n-form-item>
        <n-form-item :label="t('esaZone.l4CrossBorder')">
          <n-switch v-model:value="form.CrossBorderOptimization" size="small" />
        </n-form-item>
        <n-form-item :label="t('esaZone.l4StaticIp')">
          <n-switch v-model:value="form.StaticIp" size="small" />
        </n-form-item>
        <n-form-item :label="t('esaZone.l4KeepAlive')">
          <n-switch v-model:value="form.KeepAliveProtection" size="small" />
        </n-form-item>
        <n-form-item v-if="editing?.Cname" :label="t('esaZone.l4Cname')">
          <span class="app-mono">{{ editing.Cname }}</span>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showForm = false">{{ t('esaZone.cancel') }}</n-button>
          <n-button type="primary" :loading="saveBusy" :disabled="saveBusy" @click="save">{{ t('esaZone.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialog, useMessage, NAlert, NButton, NForm, NFormItem, NInput, NModal, NSpace, NSwitch, NTag } from 'naive-ui';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import EsaRowsEditor, { type EsaRowFieldDef } from './EsaRowsEditor.vue';

const props = defineProps<{ aid: number; zoneId: string }>();
const { t } = useI18n();
const router = useRouter();

function openStats(target: string) {
  router.push({ path: '/statistics/aliyun_esa', query: { aid: String(props.aid), zone: props.zoneId, tab: 'analytics', sub: target } });
}
const message = useMessage();
const dialog = useDialog();

const sub = defineModel<string>('sub', { default: 'apps' });
const rows = ref<any[]>([]);
const loadBusy = ref(false);
const loadError = ref('');
const showForm = ref(false);
const editing = ref<any>(null);
const saveBusy = ref(false);

const form = reactive<Record<string, any>>({
  RecordName: '',
  Rules: [],
  IpAccessRule: false,
  Ipv6: false,
  CrossBorderOptimization: false,
  StaticIp: false,
  KeepAliveProtection: false,
});

const defaultRule = {
  Protocol: 'TCP',
  EdgePort: '',
  SourceType: 'ip',
  Source: '',
  SourcePort: '',
  ClientIPPassThroughMode: 'off',
  Comment: '',
};

const ruleRowFields = computed<EsaRowFieldDef[]>(() => [
  {
    name: 'Protocol',
    label: t('esaZone.l4Protocol'),
    type: 'select',
    width: 76,
    options: [
      { label: 'TCP', value: 'TCP' },
      { label: 'UDP', value: 'UDP' },
    ],
  },
  { name: 'EdgePort', label: t('esaZone.l4EdgePort'), width: 84, placeholder: '80' },
  {
    name: 'SourceType',
    label: t('esaZone.l4SourceType'),
    type: 'select',
    width: 92,
    options: [
      { label: 'IP', value: 'ip' },
      { label: t('esaZone.domain'), value: 'domain' },
      { label: t('esaZone.originPools'), value: 'OP' },
      { label: t('esaZone.loadBalancers'), value: 'LB' },
    ],
  },
  { name: 'Source', label: t('esaZone.l4Source'), width: 112, placeholder: '1.1.1.1' },
  { name: 'SourcePort', label: t('esaZone.l4SourcePort'), width: 84, placeholder: '80' },
  {
    name: 'ClientIPPassThroughMode',
    label: t('esaZone.l4ClientIpMode'),
    type: 'select',
    width: 108,
    options: [
      { label: 'off', value: 'off' },
      { label: 'PROXY v1', value: 'PPv1' },
      { label: 'PROXY v2', value: 'PPv2' },
      { label: 'Simple Proxy', value: 'SPP' },
    ],
  },
  { name: 'Comment', label: t('esaZone.description'), width: 88 },
]);

const columns = computed<any[]>(() => [
  { title: t('esaZone.l4RecordName'), key: 'RecordName', minWidth: 200, render: (row: any) => h('span', { class: 'app-mono' }, row.RecordName || '-') },
  { title: t('esaZone.l4Rules'), key: 'RulesCount', width: 100 },
  {
    title: t('esaZone.status'),
    key: 'Status',
    width: 100,
    render: (row: any) =>
      h(NTag, { size: 'small', type: row.Status === 'online' || row.Status === 'active' ? 'success' : 'default', bordered: false }, {
        default: () => row.Status || '-',
      }),
  },
  { title: t('esaZone.l4Cname'), key: 'Cname', minWidth: 240, render: (row: any) => h('span', { class: 'app-mono' }, row.Cname || '-') },
  {
    title: t('esaZone.actions'),
    key: 'actions',
    width: 140,
    render: (row: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEdit(row) }, { default: () => t('esaZone.edit') }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => remove(row) }, { default: () => t('esaZone.delete') }),
      ]),
  },
]);

async function call(action: string, params: Record<string, any> = {}) {
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
    action,
    zoneId: props.zoneId,
    params,
  });
  if (res.code !== 0) throw new Error(res.msg || t('esaZone.loadFailed'));
  return res.data;
}

async function load() {
  loadBusy.value = true;
  loadError.value = '';
  try {
    const data = await call('ListTransportLayerApplications');
    rows.value = Array.isArray(data?.Applications) ? data.Applications : [];
  } catch (e: any) {
    loadError.value = e?.message || t('esaZone.loadFailed');
    rows.value = [];
  } finally {
    loadBusy.value = false;
  }
}

function resetForm() {
  Object.assign(form, {
    RecordName: '',
    Rules: [{ ...defaultRule }],
    IpAccessRule: false,
    Ipv6: false,
    CrossBorderOptimization: false,
    StaticIp: false,
    KeepAliveProtection: false,
  });
}

function openCreate() {
  editing.value = null;
  resetForm();
  showForm.value = true;
}

async function openEdit(row: any) {
  editing.value = row;
  resetForm();
  form.RecordName = row.RecordName || '';
  showForm.value = true;
  try {
    const detail = await call('GetTransportLayerApplication', { ApplicationId: row.ApplicationId });
    const data = detail?.Application || detail || {};
    form.RecordName = data.RecordName || row.RecordName || '';
    form.Rules = Array.isArray(data.Rules) ? data.Rules.map((r: any) => ({ ...defaultRule, ...r })) : [];
    form.IpAccessRule = data.IpAccessRule === 'on';
    form.Ipv6 = data.Ipv6 === 'on';
    form.CrossBorderOptimization = data.CrossBorderOptimization === 'on';
    form.StaticIp = data.StaticIp === 'on';
    form.KeepAliveProtection = data.KeepAliveProtection === 'on';
    editing.value = { ...row, ...data, ApplicationId: row.ApplicationId };
  } catch (e: any) {
    message.error(e?.message || t('esaZone.loadFailed'));
  }
}

function onoff(v: any) {
  return v ? 'on' : 'off';
}

async function save() {
  if (!form.RecordName.trim()) return message.warning(t('esaZone.l4NeedRecord'));
  const rules = Array.isArray(form.Rules) ? form.Rules : [];
  if (!rules.length) return message.warning(t('esaZone.l4NeedRule'));
  for (const [i, r] of rules.entries()) {
    if (!r.Protocol || !r.EdgePort || !r.SourceType || !r.Source || !r.SourcePort || !r.ClientIPPassThroughMode) {
      return message.warning(t('esaZone.l4RuleIncomplete', { n: i + 1 }));
    }
  }
  const payload: Record<string, any> = {
    Rules: rules,
    IpAccessRule: onoff(form.IpAccessRule),
    Ipv6: onoff(form.Ipv6),
    CrossBorderOptimization: onoff(form.CrossBorderOptimization),
    StaticIp: onoff(form.StaticIp),
    KeepAliveProtection: onoff(form.KeepAliveProtection),
  };
  saveBusy.value = true;
  try {
    if (editing.value) await call('UpdateTransportLayerApplication', { ...payload, ApplicationId: editing.value.ApplicationId });
    else await call('CreateTransportLayerApplication', { ...payload, RecordName: form.RecordName.trim() });
    message.success(t('esaZone.saved'));
    showForm.value = false;
    await load();
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  } finally {
    saveBusy.value = false;
  }
}

function remove(row: any) {
  dialog.warning({
    title: t('esaZone.delete'),
    content: t('esaZone.deleteConfirm', { name: row.RecordName || '' }),
    positiveText: t('esaZone.delete'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      try {
        await call('DeleteTransportLayerApplication', { ApplicationId: row.ApplicationId });
        message.success(t('esaZone.deleted'));
        await load();
      } catch (e: any) {
        message.error(e?.message || t('esaZone.deleteFailed'));
      }
    },
  });
}

onMounted(load);
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
.esa-l4__help {
  margin-left: 10px;
  color: var(--app-text-3);
  font-size: 11px;
}
</style>
