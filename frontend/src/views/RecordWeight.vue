<template>
  <div class="app-stack">
    <PageHeader :title="t('record.weightTitle', { name: domainName || '#' + domainId })" :subtitle="t('record.weightSubtitle')" :back="`/domains/${domainId}/records`" />
    <n-grid class="telemetry-row" cols="2 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="rows.length" :label="t('common.total')" tone="primary" :icon="ListOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="typeCount" :label="t('common.type')" tone="info" :icon="LayersOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="statusCount" :label="t('common.status')" tone="success" :icon="BarChartOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('record.weightOverview') }}</h3>
        </div>
        <OverviewStats
          :items="[
            { label: t('record.weightOn'), value: onCount, tone: 'success' },
            { label: t('record.weightOff'), value: rows.length - onCount },
          ]"
        />
      </div>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('record.weightListTitle') }}</h3>
        </div>
        <ResponsiveDataTable :columns="columns" :data="rows" :loading="loadBusy" :empty-text="t('common.noData')" />
      </div>
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="t('record.weightConfigure')" class="modal-md" :mask-closable="false">
      <n-spin :show="editBusy">
      <n-space vertical :size="10">
        <n-text depth="3">{{ current?.SubDomain }}</n-text>
        <n-table v-if="!isMobile" :bordered="false" :single-line="false" size="small">
          <thead><tr><th>{{ t('record.hostRecord') }}</th><th>{{ t('record.recordValue') }}</th><th style="width:140px">{{ t('record.weightValue') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in records" :key="r.RecordId">
              <td>{{ r.Name }}</td>
              <td class="mono">{{ r.Value }}</td>
              <td><n-input-number v-model:value="weights[r.RecordId]" :min="1" :max="100" size="small" /></td>
            </tr>
          </tbody>
        </n-table>
        <!-- 移动端三列会把记录值和输入框一起压扁，改为每条记录一张卡 -->
        <div v-else class="weight-cards">
          <div v-for="r in records" :key="r.RecordId" class="weight-card">
            <div class="weight-card__head">
              <span class="weight-card__name">{{ r.Name }}</span>
              <span class="weight-card__value app-mono">{{ r.Value }}</span>
            </div>
            <div class="weight-card__row">
              <span class="weight-card__label">{{ t('record.weightValue') }}</span>
              <n-input-number v-model:value="weights[r.RecordId]" :min="1" :max="100" size="small" style="width: 120px" />
            </div>
          </div>
        </div>
      </n-space>
      </n-spin>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saveBusy" @click="saveWeights">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { NButton, NTag, NModal, NText, NTable, NInputNumber, useMessage } from 'naive-ui';
import { api } from '../api';
import { ListOutline, LayersOutline, BarChartOutline } from '@vicons/ionicons5';
import PageHeader from '../components/PageHeader.vue';
import OverviewStats from '../components/OverviewStats.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import { useResponsive } from '../composables/useResponsive';
import { useAction } from '../composables/useAction';

const route = useRoute();
const { t } = useI18n();
const { isMobile } = useResponsive();
const message = useMessage();
const { busy, run } = useAction();
const domainId = Number(route.params.id);
const domainName = ref('');
const rows = ref<any[]>([]);
const onCount = computed(() => rows.value.filter((r: any) => r.Open === true || r.Open === 'true').length);
const typeCount = computed(() => new Set(rows.value.filter((r: any) => r.type != null).map((r: any) => r.type)).size);
const statusCount = computed(() => new Set(rows.value.filter((r: any) => r.status != null).map((r: any) => r.status)).size);
const loadBusy = ref(false);
const showEdit = ref(false);
const editBusy = ref(false);
const saveBusy = ref(false);
const current = ref<any>(null);
// 请求序号：避免慢网下上一个记录的响应覆盖当前弹窗
let editSeq = 0;
const records = ref<any[]>([]);
const weights = reactive<Record<string, number>>({});

const columns = computed(() => [
  { title: t('record.weightSubdomain'), key: 'rr', width: 180 },
  { title: t('record.nameCol'), key: 'SubDomain', render: (r: any) => r.SubDomain },
  {
    title: t('record.weightStatusLabel'),
    key: 'Open',
    width: 120,
    render: (r: any) => h(NTag, { type: r.Open === true || r.Open === 'true' ? 'success' : 'default', size: 'small' }, { default: () => (r.Open === true || r.Open === 'true' ? t('record.weightOn') : t('record.weightOff')) }),
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 220,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            type: r.Open === true || r.Open === 'true' ? 'default' : 'success',
            loading: !!busy[`toggle:${r.rr}:${r.Type}:${r.Line}`],
            disabled: !!busy[`toggle:${r.rr}:${r.Type}:${r.Line}`],
            onClick: () => run(`toggle:${r.rr}:${r.Type}:${r.Line}`, () => toggle(r)),
          },
          { default: () => (r.Open === true || r.Open === 'true' ? t('record.weightDisable') : t('record.weightEnable')) },
        ),
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openEdit(r) }, { default: () => t('record.weightConfigure') }),
      ]),
  },
]);

async function load() {
  loadBusy.value = true;
  const res = await api<any>('GET', `/domains/${domainId}/weight`, { pagesize: 100 });
  rows.value = res.code === 0 ? res.data?.list || [] : [];
  if (res.code !== 0) message.error(res.msg);
  loadBusy.value = false;
}

async function toggle(r: any) {
  const open = r.Open === true || r.Open === 'true';
  const res = await api('POST', `/domains/${domainId}/weight`, { act: 'status', subdomain: r.rr, status: open ? '0' : '1', type: r.Type, line: r.Line });
  if (res.code === 0) {
    message.success(res.msg);
    load();
  } else message.error(res.msg);
}

async function openEdit(r: any) {
  current.value = r;
  const seq = ++editSeq;
  records.value = [];
  for (const k of Object.keys(weights)) delete weights[k];
  showEdit.value = true; // 先开弹窗，立即给出视觉响应
  editBusy.value = true;
  try {
    const res = await api<any>('GET', `/domains/${domainId}/records`, { subdomain: r.rr, pagesize: 100 });
    if (seq !== editSeq) return;
    records.value = res.code === 0 ? res.data?.list || [] : [];
    for (const rec of records.value) weights[rec.RecordId] = Number(rec.Weight || 1);
  } finally {
    editBusy.value = false;
  }
}

async function saveWeights() {
  if (!current.value) return;
  saveBusy.value = true;
  try {
    const res = await api('POST', `/domains/${domainId}/weight`, {
      act: 'update',
      subdomain: current.value.rr,
      status: '1',
      type: current.value.Type,
      line: current.value.Line,
      weight: { ...weights },
    });
    if (res.code === 0) {
      message.success(res.msg);
      showEdit.value = false;
      load();
    } else message.error(res.msg);
  } catch (e: any) {
    message.error(e?.message || t('common.networkError'));
  } finally {
    saveBusy.value = false;
  }
}

async function loadDomainName() {
  const dl = await api<any>('GET', '/domains', undefined, { cache: true });
  if (dl.code === 0) {
    const d = (dl.data || []).find((x: any) => x.id === domainId);
    if (d) domainName.value = d._base_name || d.name;
  }
}

onMounted(() => {
  // 名称和列表互不依赖，并行请求，避免页面首屏多等一个 RTT
  void loadDomainName();
  load();
});
</script>

<style scoped>
/* 移动端权重编辑卡片 */
.weight-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.weight-card {
  padding: 10px 12px;
  background: var(--app-surface);
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
}
.weight-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.weight-card__name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--app-text);
  word-break: break-all;
}
.weight-card__value {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--app-text-3);
  text-align: right;
  word-break: break-all;
}
.weight-card__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.weight-card__label {
  font-size: 12.5px;
  color: var(--app-text-3);
}
.mono {
  font-family: ui-monospace, Menlo, monospace;
  word-break: break-all;
}
</style>