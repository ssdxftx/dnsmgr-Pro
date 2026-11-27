<template>
        <!-- ============ 任务与统计 ============ -->

          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnAdvanced.purge') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ purgeTasks.length }}</n-tag>
              </div>
            </div>
            <ResponsiveDataTable :columns="taskColumns" :data="purgeTasks" size="small" :loading="loadBusy" />
          </div>
          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnAdvanced.prefetch') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ prefetchTasks.length }}</n-tag>
              </div>
            </div>
            <ResponsiveDataTable :columns="taskColumns" :data="prefetchTasks" size="small" :loading="loadBusy" />
          </div>
          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnAdvanced.quota') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" :loading="!!busy['quota']" :disabled="!!busy['quota']" @click="run('quota', loadQuota)">{{ t('cdnAdvanced.load') }}</n-button>
              </div>
            </div>
            <pre v-if="quotaText" class="code-view">{{ quotaText }}</pre>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
          </div>
          <div v-if="caps.realtimeLogs" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnAdvanced.realtimeLogs') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openLogTask()">{{ t('cdnZoneSetting.create') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="logTaskColumns" :data="logTasks" size="small" :loading="logTaskBusy" :empty-text="t('cdnAdvanced.logTaskEmpty')" />
          </div>

          <div v-if="caps.offlineLogs" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnAdvanced.offlineLogs') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" :loading="!!busy['offlineL7']" :disabled="!!busy['offlineL7']" @click="run('offlineL7', () => loadOfflineLogs('l7'))">{{ t('cdnAdvanced.offlineL7') }}</n-button>
                <n-button size="small" :loading="!!busy['offlineL4']" :disabled="!!busy['offlineL4']" @click="run('offlineL4', () => loadOfflineLogs('l4'))">{{ t('cdnAdvanced.offlineL4') }}</n-button>
              </div>
            </div>
            <pre v-if="offlineLogText" class="code-view">{{ offlineLogText }}</pre>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
          </div>

          <div v-if="caps.contentIdentifier" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnAdvanced.contentIdentifiers') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openContentId()">{{ t('cdnZoneSetting.create') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="contentIdColumns" :data="contentIds" size="small" :loading="contentIdBusy" :empty-text="t('cdnAdvanced.contentIdEmpty')" />
          </div>

          <div v-if="!isEsa" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnAdvanced.prefetchOriginLimit') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" :loading="prefetchLimitLoading" :disabled="prefetchLimitLoading" @click="loadPrefetchOriginLimit">{{ t('cdnAdvanced.load') }}</n-button>
                <n-button size="small" type="primary" :loading="prefetchLimitSaving" :disabled="prefetchLimitSaving" @click="savePrefetchOriginLimit">{{ t('cdnZoneSetting.save') }}</n-button>
              </div>
            </div>
            <n-input
              v-model:value="prefetchLimitText"
              type="textarea"
              :rows="7"
              :placeholder="t('cdnAdvanced.prefetchOriginLimitHint')"
              class="mono-input"
              spellcheck="false"
            />
          </div>

          <div v-if="!isEsa" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnAdvanced.diagnostics') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" :loading="!!busy['ddosEvents']" :disabled="!!busy['ddosEvents']" @click="run('ddosEvents', loadDdosEvents)">{{ t('cdnAdvanced.ddosEvents') }}</n-button>
                <n-button size="small" :loading="!!busy['ddosTop']" :disabled="!!busy['ddosTop']" @click="run('ddosTop', loadDdosTop)">{{ t('cdnAdvanced.ddosTop') }}</n-button>
                <n-button size="small" :loading="!!busy['l4Timing']" :disabled="!!busy['l4Timing']" @click="run('l4Timing', loadL4Timing)">{{ t('cdnAdvanced.l4Timing') }}</n-button>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="ipRegionInput" :placeholder="t('cdnAdvanced.ipRegionHint')" style="width: 320px" size="small" />
              <n-button size="small" :loading="!!busy['ipRegion']" :disabled="!!busy['ipRegion']" @click="run('ipRegion', loadIpRegion)">{{ t('cdnAdvanced.ipRegion') }}</n-button>
            </div>
            <pre v-if="diagnosticText" class="code-view">{{ diagnosticText }}</pre>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
          </div>

          <div v-if="caps.analysis" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnAdvanced.analysis') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" :loading="!!busy['analysis']" :disabled="!!busy['analysis']" @click="run('analysis', loadTopAnalysis)">{{ t('cdnAdvanced.load') }}</n-button>
              </div>
            </div>
            <pre v-if="analysisText" class="code-view">{{ analysisText }}</pre>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
          </div>

      <n-modal v-model:show="showLogTask" preset="card" :title="logTaskEditingId ? t('cdnAdvanced.editLogTask') : t('cdnAdvanced.createLogTask')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="logTaskJson" type="textarea" :rows="16" class="mono-input" spellcheck="false" :placeholder="t('cdnAdvanced.logTaskJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showLogTask = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="logTaskSaving" :disabled="logTaskSaving" @click="saveLogTask">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-modal v-model:show="showContentId" preset="card" :title="contentIdEditingId ? t('cdnAdvanced.editContentId') : t('cdnAdvanced.createContentId')" class="modal-md" :mask-closable="false">
        <n-input v-model:value="contentIdJson" type="textarea" :rows="8" class="mono-input" spellcheck="false" :placeholder="t('cdnAdvanced.contentIdJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showContentId = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="contentIdSaving" :disabled="contentIdSaving" @click="saveContentId">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

</template>

<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { NButton, useDialog, useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import { useAction } from '../../composables/useAction';
import { formatDateTime } from '../../lib/datetime';

const props = defineProps<{
  aid: number;
  zoneId: string;
  caps: Record<string, any>;
  isEsa: boolean;
  reloadKey: number;
}>();

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const { busy, run } = useAction();
const aid = props.aid;
const zoneId = props.zoneId;
const caps = computed(() => props.caps);
const isEsa = computed(() => props.isEsa);
const loadBusy = ref(false);

// ===================== 任务与统计 =====================
const purgeTasks = ref<any[]>([]);
const prefetchTasks = ref<any[]>([]);
const quotaText = ref('');
const analysisText = ref('');
const taskColumns = computed(() => [
  { title: 'ID', key: 'taskId', minWidth: 120 },
  { title: t('cdnRules.colStatus'), key: 'status', width: 120 },
  { title: t('cdnAccount.addTime'), key: 'createTime', minWidth: 160, render: (row: any) => formatDateTime(row.createTime) },
]);
async function loadTasks(): Promise<boolean> {
  if (!caps.value.tasks) return true;
  loadBusy.value = true;
  try {
    const [p, pf] = await Promise.all([
      api<any>('GET', `/cdn/accounts/${aid}/tasks/purge`, { zoneId, page: 1, size: 50 }),
      api<any>('GET', `/cdn/accounts/${aid}/tasks/prefetch`, { zoneId, page: 1, size: 50 }),
    ]);
    purgeTasks.value = p.code === 0 ? p.data?.list || [] : [];
    prefetchTasks.value = pf.code === 0 ? pf.data?.list || [] : [];
    return p.code === 0 && pf.code === 0;
  } finally {
    loadBusy.value = false;
  }
}
async function loadQuota() {
  const res = await api<any>('GET', isEsa.value ? `/cdn/accounts/${aid}/quota/purge` : `/cdn/accounts/${aid}/quota/content`, { zoneId, type: 'file' });
  if (res.code === 0) quotaText.value = JSON.stringify(res.data, null, 2);
  else message.error(res.msg);
}
const logTasks = ref<any[]>([]);
const logTaskBusy = ref(false);
const showLogTask = ref(false);
const logTaskEditingId = ref('');
const logTaskJson = ref('');
const logTaskSaving = ref(false);
const offlineLogText = ref('');
const contentIds = ref<any[]>([]);
const contentIdBusy = ref(false);
const showContentId = ref(false);
const contentIdEditingId = ref('');
const contentIdJson = ref('');
const contentIdSaving = ref(false);
const logTaskColumns = computed(() => [
  { title: 'TaskName', key: 'TaskName', minWidth: 180 },
  { title: 'LogType', key: 'LogType', width: 140 },
  { title: 'TaskType', key: 'TaskType', width: 140 },
  { title: t('cdnRules.colStatus'), key: 'DeliveryStatus', width: 110 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 150,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openLogTask(r) }, { default: () => t('cdnZoneSetting.edit') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delLogTask(r) }, { default: () => t('cdnZoneSetting.delete') }),
    ]),
  },
]);
const contentIdColumns = computed(() => [
  { title: 'ContentId', key: 'ContentId', minWidth: 180 },
  { title: t('cdnAdvanced.contentIdDesc'), key: 'Description', minWidth: 180 },
  { title: 'PlanId', key: 'PlanId', minWidth: 160 },
  { title: t('cdnRules.colStatus'), key: 'Status', width: 100 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 150,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openContentId(r) }, { default: () => t('cdnZoneSetting.edit') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delContentId(r) }, { default: () => t('cdnZoneSetting.delete') }),
    ]),
  },
]);

async function loadRealtimeLogs(): Promise<boolean> {
  if (!caps.value.realtimeLogs) return true;
  logTaskBusy.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/logs/realtime`, { zoneId, page: 1, size: 100 });
    logTasks.value = res.code === 0 ? res.data?.list || [] : [];
    return res.code === 0;
  } finally {
    logTaskBusy.value = false;
  }
}

function openLogTask(row?: any) {
  logTaskEditingId.value = row ? String(row.TaskId || '') : '';
  logTaskJson.value = JSON.stringify(
    row || {
      Area: 'overseas',
      LogType: 'l7-access-logs',
      TaskName: '',
      TaskType: 'custom_endpoint',
      EntityList: [],
      Fields: [],
      CustomEndpoint: { URL: '', Method: 'POST' },
    },
    null,
    2,
  );
  showLogTask.value = true;
}

async function saveLogTask() {
  let parsed: any;
  try {
    parsed = JSON.parse(logTaskJson.value);
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  logTaskSaving.value = true;
  try {
    const res: any = logTaskEditingId.value
      ? await api('PUT', `/cdn/accounts/${aid}/logs/realtime/${encodeURIComponent(logTaskEditingId.value)}`, { zoneId, params: parsed })
      : await api('POST', `/cdn/accounts/${aid}/logs/realtime`, { zoneId, params: parsed });
    if (res.code === 0) {
      message.success(res.msg);
      showLogTask.value = false;
      await loadRealtimeLogs();
    } else message.error(res.msg);
  } finally {
    logTaskSaving.value = false;
  }
}

function delLogTask(r: any) {
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnAdvanced.confirmDelete', { name: r.TaskName || r.TaskId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/logs/realtime/${encodeURIComponent(String(r.TaskId))}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        await loadRealtimeLogs();
      } else message.error(res.msg);
    },
  });
}

async function loadOfflineLogs(kind: 'l7' | 'l4') {
  const { startTime, endTime } = timeRange24h();
  const res = await api<any>('GET', `/cdn/accounts/${aid}/logs/offline/${kind}`, { zoneIds: zoneId, startTime, endTime, limit: 100 });
  if (res.code === 0) offlineLogText.value = JSON.stringify(res.data?.list || [], null, 2);
  else message.error(res.msg);
}

async function loadContentIdentifiers(): Promise<boolean> {
  if (!caps.value.contentIdentifier) return true;
  contentIdBusy.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/content-identifiers`, { page: 1, size: 100 });
    contentIds.value = res.code === 0 ? res.data?.list || [] : [];
    return res.code === 0;
  } finally {
    contentIdBusy.value = false;
  }
}

function openContentId(row?: any) {
  contentIdEditingId.value = row ? String(row.ContentId || '') : '';
  contentIdJson.value = JSON.stringify(row ? { ContentId: row.ContentId, Description: row.Description } : { PlanId: '', Description: '', Tags: [] }, null, 2);
  showContentId.value = true;
}

async function saveContentId() {
  let parsed: any;
  try {
    parsed = JSON.parse(contentIdJson.value);
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  contentIdSaving.value = true;
  try {
    const res: any = contentIdEditingId.value
      ? await api('PUT', `/cdn/accounts/${aid}/content-identifiers/${encodeURIComponent(contentIdEditingId.value)}`, { description: parsed.Description || '' })
      : await api('POST', `/cdn/accounts/${aid}/content-identifiers`, { params: parsed });
    if (res.code === 0) {
      message.success(res.msg);
      showContentId.value = false;
      await loadContentIdentifiers();
    } else message.error(res.msg);
  } finally {
    contentIdSaving.value = false;
  }
}

function delContentId(r: any) {
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnAdvanced.confirmDelete', { name: r.Description || r.ContentId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/content-identifiers/${encodeURIComponent(String(r.ContentId))}`);
      if (res.code === 0) {
        message.success(res.msg);
        await loadContentIdentifiers();
      } else message.error(res.msg);
    },
  });
}

const prefetchLimitText = ref('');
const prefetchLimitLoading = ref(false);
const prefetchLimitSaving = ref(false);
const ipRegionInput = ref('');
const diagnosticText = ref('');

async function loadPrefetchOriginLimit() {
  prefetchLimitLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/cache/prefetch-origin-limit`, { zoneId, page: 1, size: 100 });
    if (res.code === 0) prefetchLimitText.value = JSON.stringify(res.data?.list || [], null, 2);
    else message.error(res.msg);
  } finally {
    prefetchLimitLoading.value = false;
  }
}

async function savePrefetchOriginLimit() {
  let parsed: any;
  try {
    parsed = prefetchLimitText.value.trim() ? JSON.parse(prefetchLimitText.value) : [];
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (!items.length) return message.warning(t('cdnAdvanced.prefetchOriginLimitHint'));
  prefetchLimitSaving.value = true;
  try {
    for (const item of items) {
      const res = await api<any>('POST', `/cdn/accounts/${aid}/cache/prefetch-origin-limit`, {
        zoneId,
        domainName: item.DomainName || item.domainName || '',
        area: item.Area || item.area || 'Overseas',
        bandwidth: Number(item.Bandwidth ?? item.bandwidth ?? 0),
        enabled: item.Enabled ?? item.enabled ?? 'on',
      });
      if (res.code !== 0) return message.error(res.msg);
    }
    message.success(t('cdnZoneSetting.saved'));
    await loadPrefetchOriginLimit();
  } finally {
    prefetchLimitSaving.value = false;
  }
}

function timeRange24h() {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => {
    const offsetMin = -d.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  };
  return { startTime: fmt(start), endTime: fmt(now) };
}

async function loadDdosEvents() {
  const { startTime, endTime } = timeRange24h();
  const res = await api<any>('GET', `/cdn/accounts/${aid}/analysis/ddos/events`, { zoneIds: zoneId, startTime, endTime, limit: 20 });
  if (res.code === 0) diagnosticText.value = JSON.stringify(res.data || [], null, 2);
  else message.error(res.msg);
}

async function loadDdosTop() {
  const { startTime, endTime } = timeRange24h();
  const res = await api<any>('GET', `/cdn/accounts/${aid}/analysis/ddos/top`, {
    zoneIds: zoneId,
    startTime,
    endTime,
    metricName: 'ddos_attackFlux_protocol',
    limit: 10,
  });
  if (res.code === 0) diagnosticText.value = JSON.stringify(res.data || [], null, 2);
  else message.error(res.msg);
}

async function loadL4Timing() {
  const { startTime, endTime } = timeRange24h();
  const res = await api<any>('GET', `/cdn/accounts/${aid}/analysis/l4-timing`, {
    zoneIds: zoneId,
    startTime,
    endTime,
    metricNames: 'l4Flow_flux,l4Flow_outFlux,l4Flow_inBandwidth,l4Flow_connections',
    interval: 'hour',
  });
  if (res.code === 0) diagnosticText.value = JSON.stringify(res.data || [], null, 2);
  else message.error(res.msg);
}

async function loadIpRegion() {
  const ips = String(ipRegionInput.value || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ips.length) return message.warning(t('cdnAdvanced.ipRegionHint'));
  const res = await api<any>('GET', `/cdn/accounts/${aid}/diagnostics/ip-region`, { zoneId, ips: ips.join(',') });
  if (res.code === 0) diagnosticText.value = JSON.stringify(res.data || [], null, 2);
  else message.error(res.msg);
}

async function loadTopAnalysis() {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600 * 1000);
  // 与项目其余时间语义保持一致：使用本地时间而非 UTC
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const res = await api<any>('GET', `/cdn/accounts/${aid}/analysis/top`, {
    zoneIds: zoneId,
    startTime: fmt(start),
    endTime: fmt(now),
    metricName: 'l7Flow_outFlux',
    limit: 10,
  });
  if (res.code === 0) analysisText.value = JSON.stringify(res.data, null, 2);
  else message.error(res.msg);
}



onMounted(() => {
  void loadTasks();
  void loadRealtimeLogs();
  if (!props.isEsa) void loadContentIdentifiers();
});
watch(
  () => !!props.caps.tasks,
  (ready, prev) => {
    if (ready && !prev) void loadTasks();
  },
);
watch(
  () => !!props.caps.realtimeLogs,
  (ready, prev) => {
    if (ready && !prev) void loadRealtimeLogs();
  },
);
watch(
  () => !!props.caps.contentIdentifier,
  (ready, prev) => {
    if (ready && !prev && !props.isEsa) void loadContentIdentifiers();
  },
);
watch(
  () => props.reloadKey,
  () => {
    void loadTasks();
    void loadRealtimeLogs();
    if (!props.isEsa) void loadContentIdentifiers();
  },
);
</script>
