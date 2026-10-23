<template>
  <div>
    <div class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">
          {{ t('esaZone.waitingRoom') }}
          <n-tag size="tiny" :bordered="false" type="warning" style="margin-left: 6px">Premium</n-tag>
          <n-tag v-if="rooms.length" size="tiny" :bordered="false" class="tnum" style="margin-left: 6px">{{ rooms.length }}</n-tag>
        </h3>
        <div class="app-panel__extra">
          <n-button size="small" :loading="loadBusy" :disabled="loadBusy" @click="load">{{ t('esaZone.reload') }}</n-button>
          <n-button size="small" type="primary" @click="openCreate">{{ t('esaZone.createWaitingRoom') }}</n-button>
        </div>
      </div>
      <p class="esa-module__hint">{{ t('esaZone.waitingRoomDesc') }}</p>
      <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>
      <ResponsiveDataTable :columns="roomColumns" :data="rooms" size="small" :loading="loadBusy" :empty-text="t('esaZone.empty')" :error="!!loadError" @retry="load" />
    </div>

    <div v-if="selected" class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">{{ t('esaZone.waitingRoomDetail', { name: selected.Name || '' }) }}</h3>
        <div class="app-panel__extra">
          <n-button size="small" quaternary @click="selected = null">{{ t('esaZone.close') }}</n-button>
        </div>
      </div>
    </div>

    <EsaActionTable
      v-if="selected"
      :key="`events:${selected.WaitingRoomId}`"
      :aid="aid"
      :zone-id="zoneId"
      :title="t('esaZone.waitingRoomEvents')"
      :desc="t('esaZone.waitingRoomEventsDesc')"
      list-action="ListWaitingRoomEvents"
      :list-params="{ WaitingRoomId: selected.WaitingRoomId }"
      items-path="WaitingRoomEvents"
      id-key="WaitingRoomEventId"
      name-key="Name"
      :columns="eventColumns"
      :paginate="false"
      create-action="CreateWaitingRoomEvent"
      :create-params="{ WaitingRoomId: selected.WaitingRoomId }"
      :create-fields="eventFields"
      delete-action="DeleteWaitingRoomEvent"
    />
    <EsaActionTable
      v-if="selected"
      :key="`rules:${selected.WaitingRoomId}`"
      :aid="aid"
      :zone-id="zoneId"
      :title="t('esaZone.waitingRoomRules')"
      :desc="t('esaZone.waitingRoomRulesDesc')"
      list-action="ListWaitingRoomRules"
      :list-params="{ WaitingRoomId: selected.WaitingRoomId }"
      items-path="WaitingRoomRules"
      id-key="WaitingRoomRuleId"
      name-key="RuleName"
      :columns="ruleColumns"
      :paginate="false"
      create-action="CreateWaitingRoomRule"
      :create-params="{ WaitingRoomId: selected.WaitingRoomId }"
      :create-fields="ruleFields"
      delete-action="DeleteWaitingRoomRule"
    />

    <n-modal
      v-model:show="showForm"
      preset="card"
      :title="editing ? t('esaZone.editWaitingRoom') : t('esaZone.createWaitingRoom')"
      class="modal-lg"
      :mask-closable="false"
    >
      <n-form label-placement="left" label-width="170" size="small">
        <n-form-item :label="t('esaZone.name')">
          <n-input v-model:value="form.Name" :placeholder="t('esaZone.waitingRoomNameHint')" />
        </n-form-item>
        <n-form-item :label="t('esaZone.enabled')">
          <n-switch v-model:value="form.Enable" size="small" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomQueueAll')">
          <n-switch v-model:value="form.QueueAllEnable" size="small" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomHostPath')">
          <EsaRowsEditor
            v-model="form.HostNameAndPath"
            :fields="hostPathFields"
            :default-row="{ Subdomain: '', Domain: '', Path: '/' }"
            :add-label="t('esaZone.addHostPath')"
          />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomCookie')">
          <n-input v-model:value="form.CookieName" placeholder="__esa_waiting_room" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomActiveUsers')">
          <n-input-number v-model:value="form.TotalActiveUsers" :min="1" style="width: 220px" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomNewUsers')">
          <n-input-number v-model:value="form.NewUsersPerMinute" :min="1" style="width: 220px" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomSession')">
          <n-input-number v-model:value="form.SessionDuration" :min="1" style="width: 220px" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomRenewal')">
          <n-switch v-model:value="form.DisableSessionRenewalEnable" size="small" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomMethod')">
          <EsaCardSelect v-model="form.QueuingMethod" :options="methodOptions" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomStatusCode')">
          <EsaCardSelect v-model="form.QueuingStatusCode" :options="statusOptions" compact style="max-width: 360px" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomJson')">
          <n-switch v-model:value="form.JsonResponseEnable" size="small" />
        </n-form-item>
        <n-form-item :label="t('esaZone.waitingRoomType')">
          <EsaCardSelect v-model="form.WaitingRoomType" :options="typeOptions" />
        </n-form-item>
        <n-form-item v-if="form.WaitingRoomType === 'default'" :label="t('esaZone.waitingRoomLanguage')">
          <EsaCardSelect v-model="form.Language" :options="languageOptions" compact style="max-width: 360px" />
        </n-form-item>
        <n-form-item v-else :label="t('esaZone.waitingRoomCustomHtml')">
          <n-input v-model:value="form.CustomPageHtml" type="textarea" :rows="5" class="mono-input" spellcheck="false" />
        </n-form-item>
        <n-form-item :label="t('esaZone.description')">
          <n-input v-model:value="form.Description" type="textarea" :rows="2" />
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
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialog, useMessage, NAlert, NButton, NForm, NFormItem, NInput, NInputNumber, NModal, NSpace, NSwitch, NTag } from 'naive-ui';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import EsaCardSelect from './EsaCardSelect.vue';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';
import EsaRowsEditor, { type EsaRowFieldDef } from './EsaRowsEditor.vue';
import type { EsaFieldDef } from './EsaActionPanel.vue';

const props = defineProps<{ aid: number; zoneId: string }>();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const rooms = ref<any[]>([]);
const loadBusy = ref(false);
const loadError = ref('');
const selected = ref<any>(null);
const showForm = ref(false);
const editing = ref<any>(null);
const saveBusy = ref(false);

const form = reactive<Record<string, any>>({
  Name: '',
  Enable: true,
  QueueAllEnable: false,
  HostNameAndPath: [],
  CookieName: '__esa_waiting_room',
  TotalActiveUsers: 100,
  NewUsersPerMinute: 10,
  SessionDuration: 10,
  DisableSessionRenewalEnable: false,
  QueuingMethod: 'fifo',
  QueuingStatusCode: '429',
  JsonResponseEnable: false,
  WaitingRoomType: 'default',
  Language: 'zhcn',
  CustomPageHtml: '',
  Description: '',
});

const methodOptions = computed(() => [
  { value: 'fifo', label: t('esaZone.queueFifo'), desc: t('esaZone.queueFifoDesc') },
  { value: 'random', label: t('esaZone.queueRandom'), desc: t('esaZone.queueRandomDesc') },
  { value: 'passthrough', label: t('esaZone.queuePassthrough'), desc: t('esaZone.queuePassthroughDesc') },
  { value: 'reject-all', label: t('esaZone.queueRejectAll'), desc: t('esaZone.queueRejectAllDesc') },
]);

const statusOptions = [
  { label: '200', value: '200', desc: t('esaZone.waitingRoomStatus200Desc') },
  { label: '202', value: '202', desc: t('esaZone.waitingRoomStatus202Desc') },
  { label: '429', value: '429', desc: t('esaZone.waitingRoomStatus429Desc') },
];

const typeOptions = computed(() => [
  { label: t('esaZone.waitingRoomTypeDefault'), value: 'default', desc: t('esaZone.waitingRoomTypeDefaultDesc') },
  { label: t('esaZone.waitingRoomTypeCustom'), value: 'custom', desc: t('esaZone.waitingRoomTypeCustomDesc') },
]);

const languageOptions = computed(() => [
  { label: t('esaZone.waitingRoomLangZh'), value: 'zhcn', desc: t('esaZone.waitingRoomLangZhDesc') },
  { label: t('esaZone.waitingRoomLangZhTw'), value: 'zhhk', desc: t('esaZone.waitingRoomLangZhTwDesc') },
  { label: t('esaZone.waitingRoomLangEn'), value: 'enus', desc: t('esaZone.waitingRoomLangEnDesc') },
]);

const hostPathFields = computed<EsaRowFieldDef[]>(() => [
  { name: 'Subdomain', label: t('esaZone.subdomain'), width: 140, placeholder: 'www.' },
  { name: 'Domain', label: t('esaZone.domain'), width: 200, placeholder: 'example.com' },
  { name: 'Path', label: t('esaZone.path'), width: 160, placeholder: '/' },
]);

const eventColumns = computed<EsaTableColumn[]>(() => [
  { key: 'Name', label: t('esaZone.name'), minWidth: 150 },
  { key: 'Enable', label: t('esaZone.status'), width: 90 },
  { key: 'StartTime', label: t('esaZone.startTime'), minWidth: 150 },
  { key: 'EndTime', label: t('esaZone.endTime'), minWidth: 150 },
  { key: 'TotalActiveUsers', label: t('esaZone.waitingRoomActiveUsers'), width: 110 },
  { key: 'QueuingMethod', label: t('esaZone.waitingRoomMethod'), width: 110 },
]);

const eventFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaZone.name'), type: 'text', required: true },
  { name: 'Enable', label: t('esaZone.enabled'), type: 'onoff', default: true },
  { name: 'TotalActiveUsers', label: t('esaZone.waitingRoomActiveUsers'), type: 'stringnumber', required: true, min: 1 },
  { name: 'NewUsersPerMinute', label: t('esaZone.waitingRoomNewUsers'), type: 'stringnumber', required: true, min: 1 },
  { name: 'SessionDuration', label: t('esaZone.waitingRoomSession'), type: 'stringnumber', required: true, min: 1 },
  { name: 'StartTime', label: t('esaZone.startTime'), type: 'text', required: true, placeholder: '2026-01-01T00:00:00Z' },
  { name: 'EndTime', label: t('esaZone.endTime'), type: 'text', required: true, placeholder: '2026-01-02T00:00:00Z' },
  {
    name: 'QueuingMethod',
    label: t('esaZone.waitingRoomMethod'),
    type: 'cards',
    default: 'fifo',
    options: methodOptions.value,
  },
  { name: 'QueuingStatusCode', label: t('esaZone.waitingRoomStatusCode'), type: 'select', default: '429', options: statusOptions },
  { name: 'WaitingRoomType', label: t('esaZone.waitingRoomType'), type: 'cards', default: 'default', options: typeOptions.value },
  { name: 'Description', label: t('esaZone.description'), type: 'textarea' },
]);

const ruleColumns = computed<EsaTableColumn[]>(() => [
  { key: 'RuleName', label: t('esaZone.ruleName'), minWidth: 160 },
  { key: 'RuleEnable', label: t('esaZone.status'), width: 90 },
  { key: 'Rule', label: 'Rule', minWidth: 300, mono: true },
]);

const ruleFields = computed<EsaFieldDef[]>(() => [
  { name: 'RuleName', label: t('esaZone.ruleName'), type: 'text', required: true },
  { name: 'RuleEnable', label: t('esaZone.enabled'), type: 'onoff', default: true },
  { name: 'Rule', label: 'Rule', type: 'text', required: true, placeholder: '(http.request.uri.path eq "/checkout")' },
]);

const roomColumns = computed<any[]>(() => [
  { title: t('esaZone.name'), key: 'Name', minWidth: 160 },
  {
    title: t('esaZone.status'),
    key: 'Enable',
    width: 100,
    render: (row: any) =>
      h(NTag, { size: 'small', type: row.Enable === 'on' || row.Enable === true ? 'success' : 'default', bordered: false }, {
        default: () => (row.Enable === 'on' || row.Enable === true ? t('esaZone.enabled') : t('esaZone.disabled')),
      }),
  },
  {
    title: t('esaZone.waitingRoomHostPath'),
    key: 'HostNameAndPath',
    minWidth: 220,
    render: (row: any) => {
      const list = Array.isArray(row.HostNameAndPath) ? row.HostNameAndPath : [];
      return list.map((h: any) => `${h.Subdomain || ''}${h.Domain || ''}${h.Path || ''}`).join(', ') || '-';
    },
  },
  { title: t('esaZone.waitingRoomActiveUsers'), key: 'TotalActiveUsers', width: 110 },
  { title: t('esaZone.waitingRoomNewUsers'), key: 'NewUsersPerMinute', width: 110 },
  { title: t('esaZone.waitingRoomSession'), key: 'SessionDuration', width: 100 },
  { title: t('esaZone.waitingRoomMethod'), key: 'QueuingMethod', width: 110 },
  {
    title: t('esaZone.actions'),
    key: 'actions',
    width: 210,
    render: (row: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEdit(row) }, { default: () => t('esaZone.edit') }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => (selected.value = row) }, { default: () => t('esaZone.waitingRoomDetailBtn') }),
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
    const data = await call('ListWaitingRooms');
    rooms.value = Array.isArray(data?.WaitingRooms) ? data.WaitingRooms : [];
  } catch (e: any) {
    loadError.value = e?.message || t('esaZone.loadFailed');
    rooms.value = [];
  } finally {
    loadBusy.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, {
    Name: '',
    Enable: true,
    QueueAllEnable: false,
    HostNameAndPath: [{ Subdomain: '', Domain: '', Path: '/' }],
    CookieName: '__esa_waiting_room',
    TotalActiveUsers: 100,
    NewUsersPerMinute: 10,
    SessionDuration: 10,
    DisableSessionRenewalEnable: false,
    QueuingMethod: 'fifo',
    QueuingStatusCode: '429',
    JsonResponseEnable: false,
    WaitingRoomType: 'default',
    Language: 'zhcn',
    CustomPageHtml: '',
    Description: '',
  });
  showForm.value = true;
}

function openEdit(row: any) {
  editing.value = row;
  Object.assign(form, {
    Name: row.Name || '',
    Enable: row.Enable === 'on' || row.Enable === true,
    QueueAllEnable: row.QueueAllEnable === 'on' || row.QueueAllEnable === true,
    HostNameAndPath: Array.isArray(row.HostNameAndPath) ? row.HostNameAndPath.map((h: any) => ({ ...h })) : [],
    CookieName: row.CookieName || '__esa_waiting_room',
    TotalActiveUsers: Number(row.TotalActiveUsers || 100),
    NewUsersPerMinute: Number(row.NewUsersPerMinute || 10),
    SessionDuration: Number(row.SessionDuration || 10),
    DisableSessionRenewalEnable: row.DisableSessionRenewalEnable === 'on' || row.DisableSessionRenewalEnable === true,
    QueuingMethod: row.QueuingMethod || 'fifo',
    QueuingStatusCode: String(row.QueuingStatusCode || '429'),
    JsonResponseEnable: row.JsonResponseEnable === 'on' || row.JsonResponseEnable === true,
    WaitingRoomType: row.WaitingRoomType || 'default',
    Language: row.Language || 'zhcn',
    CustomPageHtml: decodeBase64(row.CustomPageHtml || ''),
    Description: row.Description || '',
  });
  showForm.value = true;
}

function encodeBase64(v: string) {
  try {
    return btoa(unescape(encodeURIComponent(v || '')));
  } catch {
    return '';
  }
}

function decodeBase64(v: string) {
  if (!v) return '';
  try {
    return decodeURIComponent(escape(atob(v)));
  } catch {
    return v;
  }
}

function onoff(v: any) {
  return v ? 'on' : 'off';
}

async function save() {
  if (!form.Name.trim()) return message.warning(t('esaZone.waitingRoomNeedName'));
  if (!Array.isArray(form.HostNameAndPath) || !form.HostNameAndPath.length) return message.warning(t('esaZone.waitingRoomNeedHost'));
  const payload: Record<string, any> = {
    Name: form.Name.trim(),
    Enable: onoff(form.Enable),
    QueueAllEnable: onoff(form.QueueAllEnable),
    HostNameAndPath: form.HostNameAndPath,
    CookieName: form.CookieName,
    TotalActiveUsers: String(form.TotalActiveUsers),
    NewUsersPerMinute: String(form.NewUsersPerMinute),
    SessionDuration: String(form.SessionDuration),
    DisableSessionRenewalEnable: onoff(form.DisableSessionRenewalEnable),
    QueuingMethod: form.QueuingMethod,
    QueuingStatusCode: form.QueuingStatusCode,
    JsonResponseEnable: onoff(form.JsonResponseEnable),
    WaitingRoomType: form.WaitingRoomType,
    Description: form.Description,
  };
  if (form.WaitingRoomType === 'default') payload.Language = form.Language;
  else payload.CustomPageHtml = encodeBase64(form.CustomPageHtml);
  saveBusy.value = true;
  try {
    if (editing.value) {
      await call('UpdateWaitingRoom', { ...payload, WaitingRoomId: editing.value.WaitingRoomId });
    } else {
      await call('CreateWaitingRoom', payload);
    }
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
    content: t('esaZone.deleteConfirm', { name: row.Name || '' }),
    positiveText: t('esaZone.delete'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      try {
        await call('DeleteWaitingRoom', { WaitingRoomId: row.WaitingRoomId });
        message.success(t('esaZone.deleted'));
        if (selected.value?.WaitingRoomId === row.WaitingRoomId) selected.value = null;
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
.esa-waiting__select {
  max-width: 360px;
}
</style>
