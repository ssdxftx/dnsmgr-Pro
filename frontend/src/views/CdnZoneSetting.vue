<template>
  <div class="app-stack">
    <PageHeader :title="zoneTitle" :subtitle="t('cdnZoneSetting.subtitle')" back="/cdn-zones">
      <template #actions>
        <n-space :size="8" align="center">
          <n-tag size="small" :bordered="false">{{ isEsa ? t('cdnRules.vendEsa') : t('cdnRules.vendEo') }}</n-tag>
          <n-button size="small" :loading="loading" @click="reloadAll">{{ t('cdnZoneSetting.refresh') }}</n-button>
        </n-space>
      </template>
    </PageHeader>

    <n-alert v-if="!aid || !zoneId" type="warning" :show-icon="false">{{ t('cdnZoneSetting.accountMissing') }}</n-alert>

    <n-card v-else :bordered="false" class="zone-card">
      <n-tabs v-model:value="tab" type="line" animated>
        <!-- ============ 概览 ============ -->
        <n-tab-pane name="overview" :tab="t('cdnZoneSetting.tabOverview')">
          <div class="zone-status-strip">
            <n-tag size="medium" :type="zoneInfo.paused ? 'warning' : 'success'" :bordered="false">{{ statusLabel }}</n-tag>
            <div class="zone-status-strip__id">
              <span class="zone-status-strip__name">{{ zoneInfo.zone_name || zoneInfo.name || zoneId }}</span>
              <span class="zone-status-strip__sub">{{ zoneId }}</span>
            </div>
            <div class="zone-status-strip__actions">
              <n-button size="small" @click="verifyOwnership">{{ t('cdnZoneSetting.ovVerify') }}</n-button>
              <n-button size="small" :type="zoneInfo.paused ? 'primary' : 'warning'" @click="togglePause">
                {{ zoneInfo.paused ? t('cdnZoneSetting.ovResume') : t('cdnZoneSetting.ovPause') }}
              </n-button>
              <n-button size="small" type="error" quaternary @click="deleteZone">{{ t('cdnZoneSetting.ovDelete') }}</n-button>
            </div>
          </div>

          <div class="zone-panel" style="margin-top: 12px">
            <n-descriptions :column="2" label-placement="left" size="small">
              <n-descriptions-item :label="t('cdnZoneSetting.ovZoneId')">
                <span class="app-mono">{{ zoneId }}</span>
              </n-descriptions-item>
              <n-descriptions-item :label="t('cdnZoneSetting.ovZoneName')">{{ zoneInfo.zone_name || zoneInfo.name || '-' }}</n-descriptions-item>
              <n-descriptions-item :label="t('cdnZoneSetting.ovStatus')">{{ statusLabel }}</n-descriptions-item>
              <n-descriptions-item :label="t('cdnZoneSetting.ovArea')">{{ zoneInfo.area || '-' }}</n-descriptions-item>
              <n-descriptions-item :label="t('cdnZoneSetting.ovAccess')">{{ accessTypeLabel }}</n-descriptions-item>
              <n-descriptions-item :label="t('cdnZoneSetting.ovDomains')">
                <span class="tnum">{{ zoneInfo.domain_count ?? 0 }}</span>
              </n-descriptions-item>
            </n-descriptions>
          </div>

          <div class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnZoneSetting.ovNs') }}</h3>
            </div>
            <n-space v-if="nsList.length" :size="6">
              <n-tag v-for="ns in nsList" :key="ns" size="small" :bordered="false" class="app-mono">{{ ns }}</n-tag>
            </n-space>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.ovNsEmpty') }}</span>
          </div>
        </n-tab-pane>

        <!-- ============ 域名 ============ -->
        <n-tab-pane name="domains" :tab="t('cdnZoneSetting.tabDomains')">
          <div class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnZoneSetting.domTitle') }}</h3>
              <div class="zone-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ domains.length }}</n-tag>
              </div>
            </div>
            <ResponsiveDataTable
              :columns="domainColumns"
              :data="domains"
              size="small"
              :loading="loading"
              :empty-text="t('cdnZoneSetting.domEmpty')"
            />
          </div>
        </n-tab-pane>

        <!-- ============ 源站与负载均衡 ============ -->
        <n-tab-pane name="origin" :tab="t('cdnZoneSetting.tabOrigin')">
          <div class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnOrigin.originGroups') }}</h3>
              <div class="zone-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ originGroups.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="ogForm.name" :placeholder="t('cdnOrigin.name')" style="width: 180px" size="small" />
              <n-input v-model:value="ogForm.hostHeader" :placeholder="t('cdnOrigin.hostHeader')" style="width: 180px" size="small" />
              <n-button size="small" type="primary" :loading="ogSaving" @click="createOriginGroup">{{ t('cdnZoneSetting.create') }}</n-button>
              <n-input v-model:value="ogForm.records" type="textarea" :rows="3" :placeholder="t('cdnOrigin.recordsHint')" class="zone-form-strip__wide mono-input" />
              <n-input v-if="isEsa" v-model:value="ogForm.params" type="textarea" :rows="2" :placeholder="t('cdnOrigin.extraParamsHint')" class="zone-form-strip__wide mono-input" />
            </div>
            <ResponsiveDataTable :columns="ogColumns" :data="originGroups" size="small" :loading="loading" />
          </div>

          <div class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnOrigin.loadBalancers') }}</h3>
              <div class="zone-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ loadBalancers.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="lbForm.name" :placeholder="t('cdnOrigin.name')" style="width: 180px" size="small" />
              <n-select v-model:value="lbForm.type" :options="lbTypeOptions" style="width: 160px" size="small" />
              <n-button size="small" type="primary" :loading="lbSaving" @click="createLoadBalancer">{{ t('cdnZoneSetting.create') }}</n-button>
              <n-select v-model:value="lbForm.originGroups" multiple :options="ogOptions" :placeholder="t('cdnOrigin.originGroupsPick')" size="small" class="zone-form-strip__wide" />
              <n-input v-if="isEsa" v-model:value="lbForm.params" type="textarea" :rows="2" :placeholder="t('cdnOrigin.extraParamsHint')" class="zone-form-strip__wide mono-input" />
            </div>
            <ResponsiveDataTable :columns="lbColumns" :data="loadBalancers" size="small" :loading="loading" />
          </div>
        </n-tab-pane>

        <!-- ============ 规则引擎 ============ -->
        <n-tab-pane name="rules" :tab="t('cdnZoneSetting.tabRules')">
          <div class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnRules.manage') }}</h3>
              <n-tag v-if="isEsa" size="tiny" :bordered="false">{{ kindLabel(ruleKind) }}</n-tag>
              <div class="zone-panel__extra">
                <n-select
                  v-if="isEsa"
                  v-model:value="ruleKind"
                  :options="ruleKindOptions"
                  size="small"
                  style="width: 240px"
                  @update:value="loadRules"
                />
                <n-button size="small" @click="loadRules">{{ t('cdnZoneSetting.refresh') }}</n-button>
                <n-button size="small" type="primary" @click="createRuleClick">
                  {{ t('cdnRules.createRule') }}
                </n-button>
              </div>
            </div>
            <ResponsiveDataTable
              :columns="ruleColumns"
              :data="ruleList"
              size="small"
              :loading="ruleLoading"
              :empty-text="t('cdnRules.empty')"
            />
          </div>
        </n-tab-pane>

        <!-- ============ 安全 ============ -->
        <n-tab-pane name="security" :tab="t('cdnZoneSetting.tabSecurity')">
          <div v-if="caps.securityIpGroup" class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnSecurity.ipGroups') }}</h3>
              <div class="zone-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ ipGroups.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="ipForm.name" :placeholder="t('cdnSecurity.name')" style="width: 200px" size="small" />
              <n-button size="small" type="primary" :loading="ipSaving" @click="createIpGroup">{{ t('cdnZoneSetting.create') }}</n-button>
              <n-input v-model:value="ipForm.content" type="textarea" :rows="3" :placeholder="t('cdnSecurity.contentHint')" class="zone-form-strip__wide mono-input" />
            </div>
            <ResponsiveDataTable :columns="ipColumns" :data="ipGroups" size="small" :loading="loading" />
          </div>

          <div v-for="cfg in securityCfgs.filter((c) => caps[c.cap])" :key="cfg.key" class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ cfg.title }}</h3>
              <div class="zone-panel__extra">
                <n-button size="small" @click="loadSecurityConfig(cfg.key)">{{ t('cdnSecurity.load') }}</n-button>
                <n-button size="small" type="primary" @click="saveSecurityConfig(cfg.key)">{{ t('cdnZoneSetting.save') }}</n-button>
              </div>
            </div>
            <n-input
              v-model:value="secJson[cfg.key]"
              type="textarea"
              :rows="8"
              :placeholder="t('cdnSecurity.configJson')"
              class="mono-input"
              spellcheck="false"
            />
          </div>
        </n-tab-pane>

        <!-- ============ 四层代理 ============ -->
        <n-tab-pane v-if="caps.l4" name="l4" :tab="t('cdnZoneSetting.tabL4')">
          <div class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnZoneSetting.tabL4') }}</h3>
              <div class="zone-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ l4Proxies.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="l4Form.name" :placeholder="t('cdnAdvanced.name')" style="width: 180px" size="small" />
              <n-input v-model:value="l4Form.area" :placeholder="t('cdnAdvanced.area')" style="width: 140px" size="small" />
              <n-button size="small" type="primary" :loading="l4Saving" @click="createL4Proxy">{{ t('cdnZoneSetting.create') }}</n-button>
              <n-input v-if="isEsa" v-model:value="l4Form.params" type="textarea" :rows="2" :placeholder="t('cdnAdvanced.extraParamsHint')" class="zone-form-strip__wide mono-input" />
            </div>
            <ResponsiveDataTable :columns="l4Columns" :data="l4Proxies" size="small" :loading="loading" />
          </div>
        </n-tab-pane>

        <!-- ============ 任务与统计 ============ -->
        <n-tab-pane v-if="caps.tasks" name="tasks" :tab="t('cdnZoneSetting.tabTasks')">
          <div class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnAdvanced.purge') }}</h3>
              <div class="zone-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ purgeTasks.length }}</n-tag>
              </div>
            </div>
            <ResponsiveDataTable :columns="taskColumns" :data="purgeTasks" size="small" :loading="loading" />
          </div>
          <div class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnAdvanced.prefetch') }}</h3>
              <div class="zone-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ prefetchTasks.length }}</n-tag>
              </div>
            </div>
            <ResponsiveDataTable :columns="taskColumns" :data="prefetchTasks" size="small" :loading="loading" />
          </div>
          <div class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnAdvanced.quota') }}</h3>
              <div class="zone-panel__extra">
                <n-button size="small" @click="loadQuota">{{ t('cdnAdvanced.load') }}</n-button>
              </div>
            </div>
            <pre v-if="quotaText" class="code-view">{{ quotaText }}</pre>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
          </div>
          <div v-if="caps.analysis" class="zone-panel">
            <div class="zone-panel__head">
              <h3 class="zone-panel__title">{{ t('cdnAdvanced.analysis') }}</h3>
              <div class="zone-panel__extra">
                <n-button size="small" @click="loadTopAnalysis">{{ t('cdnAdvanced.load') }}</n-button>
              </div>
            </div>
            <pre v-if="analysisText" class="code-view">{{ analysisText }}</pre>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
          </div>
        </n-tab-pane>

        <!-- ============ 全局配置 ============ -->
        <n-tab-pane name="global" :tab="t('cdnZoneSetting.tabGlobal')">
          <CdnZoneGlobalSetting :aid="aid" :zone-id="zoneId" @go-rules="tab = 'rules'" />
        </n-tab-pane>
      </n-tabs>
    </n-card>

    <!-- 新建规则：先选方式（官方预制 / 本项目预制 / 空白），再选具体预制规则 -->
    <RuleCreatePicker v-model:show="showCreatePicker" @select="selectCreateSource" />
    <RuleTemplatePicker v-model:show="showTemplatePicker" :source="pickerSource" @select="selectTemplate" />

    <!-- 规则编辑器 -->
    <n-modal
      v-model:show="showRuleEditor"
      preset="card"
      :title="ruleEditingId ? t('cdnRules.editRule') : t('cdnRules.createRule')"
      style="width: min(960px, calc(100vw - 24px))"
      :mask-closable="false"
    >
      <RuleEditor
        v-if="showRuleEditor"
        :vendor="isEsa ? 'esa' : 'eo'"
        :schema="ruleSchema"
        :initial="ruleInitial"
        :editing="!!ruleEditingId"
        :saving="ruleSaving"
        :domains="siteDomains"
        @save="saveRule"
        @cancel="showRuleEditor = false"
      />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDialog, useMessage, NButton, NSpace, NTag } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import RuleEditor from '../components/cdn/RuleEditor.vue';
import RuleTemplatePicker from '../components/cdn/RuleTemplatePicker.vue';
import RuleCreatePicker, { type RuleCreateSource } from '../components/cdn/RuleCreatePicker.vue';
import CdnZoneGlobalSetting from '../components/cdn/CdnZoneGlobalSetting.vue';
import { ruleEnabled } from '../lib/cdnSwitch';
import { EO_RULE_TEMPLATES } from '../lib/eoRuleTemplates';
import { EO_PRESET_RULES } from '../lib/eoPresetRules';

const { t, locale } = useI18n();
const message = useMessage();
const dialog = useDialog();
const route = useRoute();
const router = useRouter();

const aid = Number(route.params.aid || 0);
const zoneId = String(route.params.zoneId || '');
const tab = ref('overview');
const loading = ref(false);

const providers = ref<Record<string, any>>({});
const zoneInfo = ref<Record<string, any>>({});
const domains = ref<any[]>([]);
const nsList = ref<string[]>([]);

const isEsa = computed(() => providers.value[zoneInfo.value.route]?.vendor === 'esa' || String(zoneInfo.value.route || '') === 'aliyun_esa');
const caps = computed<Record<string, boolean>>(() => providers.value[zoneInfo.value.route]?.capabilities || {});
/** 当前站点域名（用于规则 HOST 匹配直接选择） */
const siteDomains = computed<string[]>(() => {
  const set = new Set<string>();
  for (const d of domains.value) {
    const n = d?.name || d?.domain;
    if (n) set.add(String(n));
  }
  const zn = zoneInfo.value.zone_name || zoneInfo.value.name;
  if (zn) set.add(String(zn));
  return [...set];
});

const zoneTitle = computed(() => `${t('cdnZoneSetting.title')} · ${zoneInfo.value.zone_name || zoneInfo.value.name || zoneId}`);
const statusLabel = computed(() => {
  if (zoneInfo.value.paused) return t('cdnSite.statusPaused');
  const map: Record<string, string> = {
    active: t('cdnSite.statusActive'),
    pending: t('cdnSite.statusPending'),
    offline: t('cdnSite.statusOffline'),
    moved: t('cdnSite.statusMoved'),
    deactivated: t('cdnSite.statusDeactivated'),
    initializing: t('cdnSite.statusInitializing'),
  };
  return map[String(zoneInfo.value.status || '').toLowerCase()] || zoneInfo.value.status || '-';
});
const accessTypeLabel = computed(() => (isEsa.value ? '-' : zoneInfo.value.type || '-'));

// ===================== 数据加载 =====================
async function loadProviders() {
  const res = await api<any>('GET', '/cdn/providers');
  if (res.code === 0) providers.value = res.data || {};
}

async function loadZoneInfo() {
  const res = await api<any>('GET', '/cdn/zones', { aid });
  if (res.code !== 0) {
    message.error(res.msg);
    return;
  }
  const hit = (res.data || []).find((z: any) => String(z.zone_id) === zoneId);
  zoneInfo.value = hit || { zone_id: zoneId, name: '', zone_name: '' };
}
async function loadDomains() {
  const res = await api<any>('GET', '/cdn/domains');
  if (res.code === 0) domains.value = (res.data || []).filter((d: any) => Number(d.aid) === aid && String(d.zone_id) === zoneId);
}
async function loadNs() {
  if (!zoneId) return;
  const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/ns`);
  nsList.value = res.code === 0 && Array.isArray(res.data) ? res.data : [];
}

// ===================== 概览操作 =====================
async function verifyOwnership() {
  const res = await api<any>('POST', `/cdn/accounts/${aid}/sites/verify`, { zoneId, domain: zoneInfo.value.zone_name || zoneInfo.value.name });
  if (res.code === 0) message.success(t('cdnZoneSetting.ovVerified'));
  else message.error(res.msg);
}
async function togglePause() {
  const res = await api<any>('POST', `/cdn/accounts/${aid}/sites/pause`, { zoneId, paused: !zoneInfo.value.paused });
  if (res.code === 0) {
    message.success(res.msg);
    loadZoneInfo();
  } else message.error(res.msg);
}
function deleteZone() {
  dialog.warning({
    title: t('cdnZoneSetting.ovDelete'),
    content: t('cdnZoneSetting.ovDeleteConfirm', { name: zoneInfo.value.zone_name || zoneInfo.value.name || zoneId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api<any>('DELETE', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}`);
      if (res.code === 0) {
        message.success(t('cdnZoneSetting.ovDeleted'));
        router.push('/cdn-zones');
      } else message.error(res.msg);
    },
  });
}

// ===================== 域名 =====================
const domainColumns = computed(() => [
  { title: t('cdnZoneSetting.domColName'), key: 'name', minWidth: 220 },
  { title: t('cdnZoneSetting.domColOrigin'), key: 'origin', minWidth: 180 },
  {
    title: t('cdnZoneSetting.domColActions'),
    key: 'actions',
    width: 140,
    render: (r: any) =>
      h(NButton, { size: 'tiny', onClick: () => router.push(`/cdn-domains/${r.id}/setting`) }, { default: () => t('cdnZoneSetting.domOpen') }),
  },
]);

// ===================== 源站与负载均衡 =====================
const originGroups = ref<any[]>([]);
const loadBalancers = ref<any[]>([]);
const ogSaving = ref(false);
const lbSaving = ref(false);
const ogForm = reactive<any>({ name: '', hostHeader: '', records: '', params: '' });
const lbForm = reactive<any>({ name: '', type: 'HTTP', originGroups: [], params: '' });
const lbTypeOptions = [
  { label: 'HTTP', value: 'HTTP' },
  { label: 'HTTP_V2', value: 'HTTP_V2' },
  { label: 'GENERAL', value: 'GENERAL' },
];
const ogOptions = computed(() => originGroups.value.map((g: any) => ({ label: g.name || String(g.groupId), value: String(g.groupId) })));
const ogColumns = computed(() => [
  { title: t('cdnOrigin.colName'), key: 'name', minWidth: 140 },
  { title: t('cdnOrigin.colType'), key: 'type', width: 100 },
  {
    title: t('cdnOrigin.colRecords'),
    key: 'records',
    minWidth: 200,
    render: (r: any) => (Array.isArray(r.records) ? r.records.map((x: any) => (typeof x === 'string' ? x : x.Record || x.record || x.Address || '')).join(', ') : ''),
  },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 90, render: (r: any) => h(NButton, { size: 'tiny', type: 'error', onClick: () => delOriginGroup(r) }, { default: () => t('cdnZoneSetting.delete') }) },
]);
const lbColumns = computed(() => [
  { title: t('cdnOrigin.colName'), key: 'name', minWidth: 140 },
  { title: t('cdnOrigin.colType'), key: 'type', width: 120 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 90, render: (r: any) => h(NButton, { size: 'tiny', type: 'error', onClick: () => delLoadBalancer(r) }, { default: () => t('cdnZoneSetting.delete') }) },
]);

function parseRecords(text: string) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [rec, w] = line.split(',').map((x) => x.trim());
      const o: any = { Record: rec };
      if (w) o.Weight = Number(w);
      return o;
    });
}
function parseExtraParams(text: string) {
  const s = String(text || '').trim();
  if (!s) return undefined;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : undefined;
  } catch {
    return undefined;
  }
}
async function loadOriginData() {
  const [og, lb] = await Promise.all([
    api<any>('GET', `/cdn/accounts/${aid}/origin-groups`, { zoneId, page: 1, size: 100 }),
    api<any>('GET', `/cdn/accounts/${aid}/load-balancers`, { zoneId, page: 1, size: 100 }),
  ]);
  originGroups.value = og.code === 0 ? og.data?.list || [] : [];
  loadBalancers.value = lb.code === 0 ? lb.data?.list || [] : [];
}
async function createOriginGroup() {
  if (!ogForm.name) return message.warning(t('cdnOrigin.needName'));
  const records = parseRecords(ogForm.records);
  if (!records.length) return message.warning(t('cdnOrigin.needRecords'));
  ogSaving.value = true;
  const res = await api<any>('POST', `/cdn/accounts/${aid}/origin-groups`, {
    zoneId,
    name: ogForm.name,
    records,
    hostHeader: ogForm.hostHeader || undefined,
    params: parseExtraParams(ogForm.params),
  });
  ogSaving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    ogForm.name = '';
    ogForm.records = '';
    ogForm.hostHeader = '';
    ogForm.params = '';
    loadOriginData();
  } else message.error(res.msg);
}
function delOriginGroup(r: any) {
  dialog.warning({
    title: t('cdnOrigin.delete'),
    content: t('cdnOrigin.confirmDelete', { name: r.name || r.groupId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/origin-groups/${encodeURIComponent(r.groupId)}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        loadOriginData();
      } else message.error(res.msg);
    },
  });
}
async function createLoadBalancer() {
  if (!lbForm.name) return message.warning(t('cdnOrigin.needName'));
  lbSaving.value = true;
  const originGroupsPayload = (lbForm.originGroups || []).map((gid: string, i: number) => ({ Priority: String(i + 1), OriginGroupId: String(gid) }));
  const res = await api<any>('POST', `/cdn/accounts/${aid}/load-balancers`, {
    zoneId,
    name: lbForm.name,
    type: lbForm.type,
    originGroups: originGroupsPayload,
    params: parseExtraParams(lbForm.params),
  });
  lbSaving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    lbForm.name = '';
    lbForm.originGroups = [];
    lbForm.params = '';
    loadOriginData();
  } else message.error(res.msg);
}
function delLoadBalancer(r: any) {
  dialog.warning({
    title: t('cdnOrigin.delete'),
    content: t('cdnOrigin.confirmDelete', { name: r.name || r.instanceId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/load-balancers/${encodeURIComponent(r.instanceId)}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        loadOriginData();
      } else message.error(res.msg);
    },
  });
}

// ===================== 规则引擎（可视化） =====================
const ruleList = ref<any[]>([]);
const ruleLoading = ref(false);
const ruleSaving = ref(false);
const ruleKind = ref('RedirectRule');
const ruleSchema = ref<any>(null);
const showRuleEditor = ref(false);
const showTemplatePicker = ref(false);
const showCreatePicker = ref(false);
/** 预制规则来源：official（EdgeOne 官方预设模板）/ project（本项目模板） */
const pickerSource = ref<'official' | 'project'>('official');
const ruleEditingId = ref('');
const ruleInitial = ref<any>(null);
const ruleKindOptions = ref<any[]>([]);

async function loadRuleSchema() {
  const res = await api<any>('GET', `/cdn/accounts/${aid}/rule-schema`);
  if (res.code !== 0) return;
  ruleSchema.value = res.data;
  if (res.data?.vendor === 'esa') {
    ruleKindOptions.value = (res.data.kinds || []).map((k: any) => ({ label: kindLabel(k.kind), value: k.kind }));
  }
}
function kindLabel(kind: string) {
  const key = `cdnRules.kind${kind}`;
  const v = t(key);
  return v === key ? kind : v;
}
async function loadRuleSchemaForKind() {
  if (!isEsa.value) return; // EO 的 schema 与 kind 无关，一次拉取即可
  const res = await api<any>('GET', `/cdn/accounts/${aid}/rule-schema`, { kind: ruleKind.value });
  if (res.code === 0) ruleSchema.value = res.data;
}
async function loadRules() {
  ruleLoading.value = true;
  if (isEsa.value) await loadRuleSchemaForKind();
  if (isEsa.value) {
    // ESA 规则按 kind 分页，单页 100；循环取全量，避免规则较多时列表被截断
    const all: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await api<any>('GET', `/cdn/accounts/${aid}/rule-configs`, { zoneId, kind: ruleKind.value, page, size: 100 });
      if (res.code !== 0) break;
      const l = res.data?.list || [];
      all.push(...l);
      const total = Number(res.data?.total || 0);
      if (l.length < 100 || all.length >= total) break;
    }
    ruleList.value = all;
  } else {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/rules`, { zoneId });
    ruleList.value = res.code === 0 ? res.data || [] : [];
  }
  ruleLoading.value = false;
}
const ruleColumns = computed(() => {
  const cols: any[] = [{ title: t('cdnRules.colName'), key: 'ruleName', minWidth: 200 }];
  if (isEsa.value) cols.push({ title: t('cdnRules.colKind'), key: 'kind', width: 160, render: () => kindLabel(ruleKind.value) });
  cols.push({
    title: t('cdnRules.colEnable'),
    key: 'enabled',
    width: 110,
    render: (r: any) =>
      h(NTag, { size: 'small', type: ruleEnabled(r) ? 'success' : 'default' }, { default: () => (ruleEnabled(r) ? t('cdnRules.enabledTag') : t('cdnRules.disabledTag')) }),
  });
  cols.push({
    title: t('cdnRules.colActions'),
    key: 'actions',
    width: 200,
    render: (r: any) =>
      h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', onClick: () => openRuleEditor(r) }, { default: () => t('cdnZoneSetting.edit') }),
          h(NButton, { size: 'tiny', onClick: () => toggleRuleEnabled(r) }, { default: () => (ruleEnabled(r) ? t('cdnRules.disabledTag') : t('cdnRules.enabledTag')) }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => delRule(r) }, { default: () => t('cdnZoneSetting.delete') }),
        ],
      }),
  });
  return cols;
});

async function openRuleEditor(row: any) {
  ruleEditingId.value = row ? String(row.ruleId || row.configId || '') : '';
  if (row) {
    if (isEsa.value) ruleInitial.value = Array.isArray(row.rules) && row.rules.length ? row.rules[0] : row;
    else ruleInitial.value = { RuleName: row.ruleName, Status: row.status, Branches: row.branches || [], Description: row.description || [] };
  } else {
    ruleInitial.value = isEsa.value ? { RuleEnable: 'on' } : { Status: 'enable', Branches: [] };
  }
  showRuleEditor.value = true;
}

/** 新建规则：EO 先选方式（官方预制 / 本项目预制 / 空白）；ESA 无预制，直接进入空白编辑 */
function createRuleClick() {
  if (isEsa.value) openRuleEditor(null);
  else showCreatePicker.value = true;
}

/** 新建方式：空白直接进入编辑页；两类预制先选具体规则 */
function selectCreateSource(source: RuleCreateSource) {
  showCreatePicker.value = false;
  if (source === 'blank') {
    openRuleEditor(null);
    return;
  }
  pickerSource.value = source;
  showTemplatePicker.value = true;
}

/** 选择预制规则：官方预制 / 本项目预制按当前来源取用（官方模板的 HOST 匹配值已置空，待用户填写域名） */
function selectTemplate(id: string) {
  showTemplatePicker.value = false;
  const zh = String(locale.value || '').toLowerCase().startsWith('zh');
  const preset = (pickerSource.value === 'official' ? EO_PRESET_RULES : EO_RULE_TEMPLATES).find((x) => x.id === id);
  ruleEditingId.value = '';
  ruleInitial.value = preset ? preset.build(zh ? 'zh' : 'en') : { Status: 'enable', Branches: [] };
  showRuleEditor.value = true;
}

async function saveRule(payload: any) {
  if (!payload.RuleName) return message.warning(t('cdnRules.needName'));
  // 必填校验（ESA 字段表驱动）
  if (isEsa.value && Array.isArray(ruleSchema.value?.fields)) {
    const missing = ruleSchema.value.fields
      .filter((f: any) => f.required && f.group !== 'common')
      .filter((f: any) => payload[f.name] === undefined || payload[f.name] === null || payload[f.name] === '')
      .map((f: any) => f.label || f.name);
    if (missing.length) return message.warning(t('cdnRules.requiredMissing', { fields: missing.join('、') }));
  }
  ruleSaving.value = true;
  let res: any;
  if (isEsa.value) {
    res = await api('POST', `/cdn/accounts/${aid}/rule-configs`, { zoneId, kind: ruleKind.value, params: payload });
  } else if (ruleEditingId.value) {
    res = await api('PUT', `/cdn/accounts/${aid}/rules/${encodeURIComponent(ruleEditingId.value)}`, {
      zoneId,
      ruleName: payload.RuleName,
      status: payload.Status,
      branches: payload.Branches,
      description: payload.Description,
    });
  } else {
    res = await api('POST', `/cdn/accounts/${aid}/rules`, {
      zoneId,
      ruleName: payload.RuleName,
      status: payload.Status,
      branches: payload.Branches,
      description: payload.Description,
    });
  }
  ruleSaving.value = false;
  if (res.code === 0) {
    message.success(res.msg || t('cdnRules.savedOk'));
    showRuleEditor.value = false;
    loadRules();
  } else message.error(res.msg);
}

async function toggleRuleEnabled(row: any) {
  const next = !ruleEnabled(row);
  let res: any;
  if (isEsa.value) {
    const base = Array.isArray(row.rules) && row.rules.length ? { ...row.rules[0] } : {};
    res = await api('POST', `/cdn/accounts/${aid}/rule-configs`, {
      zoneId,
      kind: ruleKind.value,
      params: { ...base, RuleName: row.ruleName, RuleEnable: next ? 'on' : 'off' },
    });
  } else {
    res = await api('PUT', `/cdn/accounts/${aid}/rules/${encodeURIComponent(String(row.ruleId))}`, {
      zoneId,
      ruleName: row.ruleName,
      status: next ? 'enable' : 'disable',
      branches: row.branches || [],
      description: row.description || [],
    });
  }
  if (res.code === 0) loadRules();
  else message.error(res.msg || t('cdnRules.toggleFailed'));
}

function delRule(r: any) {
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnRules.confirmDelete', { name: r.ruleName || '' }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res: any = isEsa.value
        ? await api('DELETE', `/cdn/accounts/${aid}/rule-configs/${encodeURIComponent(String(r.configId))}`, { zoneId, kind: ruleKind.value })
        : await api('DELETE', `/cdn/accounts/${aid}/rules`, { zoneId, ruleIds: [String(r.ruleId)] });
      if (res.code === 0) {
        message.success(res.msg);
        loadRules();
      } else message.error(res.msg);
    },
  });
}

// ===================== 安全 =====================
const ipGroups = ref<any[]>([]);
const ipSaving = ref(false);
const ipForm = reactive<any>({ name: '', content: '' });
const secJson = reactive<any>({ ddos: '', waf: '', originProtection: '' });
const securityCfgs = [
  { key: 'ddos', cap: 'ddos', title: 'DDoS' },
  { key: 'waf', cap: 'waf', title: 'WAF' },
  { key: 'originProtection', cap: 'originProtection', title: 'Origin protection' },
];
const ipColumns = computed(() => [
  { title: t('cdnSecurity.colName'), key: 'name', minWidth: 160 },
  { title: t('cdnSecurity.content'), key: 'content', minWidth: 200, render: (r: any) => (Array.isArray(r.content) ? r.content.join(', ') : '') },
  {
    title: t('cdnSecurity.colActions'),
    key: 'actions',
    width: 160,
    render: (r: any) =>
      h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', onClick: () => loadIpContent(r) }, { default: () => t('cdnSecurity.load') }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => delIpGroup(r) }, { default: () => t('cdnZoneSetting.delete') }),
        ],
      }),
  },
]);
function secRoute(key: string) {
  return key === 'originProtection' ? 'origin-protection' : key;
}
async function loadSecurity() {
  if (caps.value.securityIpGroup) {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/security/ip-groups`, { zoneId });
    ipGroups.value = res.code === 0 ? res.data : [];
  }
  for (const cfg of securityCfgs) if (caps.value[cfg.cap]) await loadSecurityConfig(cfg.key, true);
}
async function loadSecurityConfig(key: string, silent = false) {
  const res = await api<any>('GET', `/cdn/accounts/${aid}/security/${secRoute(key)}`, { zoneId });
  if (res.code === 0) secJson[key] = JSON.stringify(res.data, null, 2);
  else if (!silent) message.error(res.msg);
}
async function saveSecurityConfig(key: string) {
  let config: any;
  try {
    config = secJson[key] ? JSON.parse(secJson[key]) : {};
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  const res = await api('POST', `/cdn/accounts/${aid}/security/${secRoute(key)}`, { zoneId, config });
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
async function createIpGroup() {
  if (!ipForm.name) return message.warning(t('cdnSecurity.needName'));
  const content = String(ipForm.content || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  ipSaving.value = true;
  const res = await api<any>('POST', `/cdn/accounts/${aid}/security/ip-groups`, { zoneId, name: ipForm.name, content });
  ipSaving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    ipForm.name = '';
    ipForm.content = '';
    loadSecurity();
  } else message.error(res.msg);
}
async function loadIpContent(r: any) {
  const res = await api<any>('GET', `/cdn/accounts/${aid}/security/ip-groups/${r.groupId}/content`, { zoneId });
  if (res.code === 0) {
    dialog.info({ title: t('cdnSecurity.content'), content: () => h('pre', { class: 'code-view', style: 'max-height:400px' }, (res.data || []).join('\n') || '-') });
  } else message.error(res.msg);
}
function delIpGroup(r: any) {
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnSecurity.confirmDelete', { name: r.name }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/security/ip-groups/${r.groupId}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        loadSecurity();
      } else message.error(res.msg);
    },
  });
}

// ===================== 四层代理 =====================
const l4Proxies = ref<any[]>([]);
const l4Saving = ref(false);
const l4Form = reactive<any>({ name: '', area: '', params: '' });
const l4Columns = computed(() => [
  { title: t('cdnAdvanced.colName'), key: 'name', minWidth: 160 },
  { title: t('cdnAdvanced.colArea'), key: 'area', width: 120 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 100,
    render: (r: any) =>
      h(NButton, { size: 'tiny', type: 'error', onClick: () => delL4Proxy(r) }, { default: () => t('cdnZoneSetting.delete') }),
  },
]);
async function loadL4Proxies() {
  if (!caps.value.l4) return;
  const res = await api<any>('GET', `/cdn/accounts/${aid}/l4-proxies`, { zoneId, page: 1, size: 100 });
  l4Proxies.value = res.code === 0 ? res.data?.list || [] : [];
}
async function createL4Proxy() {
  if (!l4Form.name) return message.warning(t('cdnAdvanced.needName'));
  l4Saving.value = true;
  const res = await api<any>('POST', `/cdn/accounts/${aid}/l4-proxies`, {
    zoneId,
    name: l4Form.name,
    area: l4Form.area || undefined,
    params: parseExtraParams(l4Form.params),
  });
  l4Saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    l4Form.name = '';
    l4Form.area = '';
    l4Form.params = '';
    loadL4Proxies();
  } else message.error(res.msg);
}
function delL4Proxy(r: any) {
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnAdvanced.confirmDelete', { name: r.name || r.proxyId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/l4-proxies/${encodeURIComponent(String(r.proxyId))}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        loadL4Proxies();
      } else message.error(res.msg);
    },
  });
}

// ===================== 任务与统计 =====================
const purgeTasks = ref<any[]>([]);
const prefetchTasks = ref<any[]>([]);
const quotaText = ref('');
const analysisText = ref('');
const taskColumns = computed(() => [
  { title: 'ID', key: 'taskId', minWidth: 120 },
  { title: t('cdnRules.colStatus'), key: 'status', width: 120 },
  { title: t('cdnAccount.addTime'), key: 'createTime', minWidth: 160 },
]);
async function loadTasks() {
  if (!caps.value.tasks) return;
  const [p, pf] = await Promise.all([
    api<any>('GET', `/cdn/accounts/${aid}/tasks/purge`, { zoneId, page: 1, size: 50 }),
    api<any>('GET', `/cdn/accounts/${aid}/tasks/prefetch`, { zoneId, page: 1, size: 50 }),
  ]);
  purgeTasks.value = p.code === 0 ? p.data?.list || [] : [];
  prefetchTasks.value = pf.code === 0 ? pf.data?.list || [] : [];
}
async function loadQuota() {
  const res = await api<any>('GET', isEsa.value ? `/cdn/accounts/${aid}/quota/purge` : `/cdn/accounts/${aid}/quota/content`, { zoneId, type: 'file' });
  if (res.code === 0) quotaText.value = JSON.stringify(res.data, null, 2);
  else message.error(res.msg);
}
async function loadTopAnalysis() {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
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

// ===================== 汇总 =====================
async function loadByTab(name: string) {
  if (name === 'origin') await loadOriginData();
  else if (name === 'rules') await loadRules();
  else if (name === 'security') await loadSecurity();
  else if (name === 'l4') await loadL4Proxies();
  else if (name === 'tasks') await loadTasks();
}
async function reloadAll() {
  loading.value = true;
  await Promise.all([loadZoneInfo(), loadDomains(), loadNs()]);
  loading.value = false;
  await loadByTab(tab.value);
}
watch(tab, (v) => loadByTab(v));

onMounted(async () => {
  if (!aid || !zoneId) return;
  loading.value = true;
  await loadProviders();
  await Promise.all([loadZoneInfo(), loadDomains(), loadNs(), loadRuleSchema()]);
  loading.value = false;
});
</script>
