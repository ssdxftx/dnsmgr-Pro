<template>
  <div class="app-stack">
    <PageHeader :title="t('cdnAccount.title')" :subtitle="t('cdnAccount.subtitle')">
      <template #actions>
        <n-button type="primary" @click="openAdd">
          <template #icon><n-icon :component="AddOutline" /></template>
          {{ t('cdnAccount.add') }}
        </n-button>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item v-reveal class="reveal d1"><TelemetryCard :value="accounts.length" :label="t('common.cdnAccounts')" tone="primary" :icon="CloudOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d2"><TelemetryCard :value="providerCount" :label="t('common.providers')" tone="info" :icon="PeopleOutline" /></n-grid-item>
      <n-grid-item v-reveal class="reveal d3"><TelemetryCard :value="tunnelAccounts" :label="t('common.tunnelReady')" tone="success" :icon="GlobeOutline" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <ResponsiveDataTable :columns="columns" :data="accounts" :loading="loading" :empty-text="t('cdnAccount.empty')" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? t('cdnAccount.editTitle') : t('cdnAccount.addTitle')" style="max-width:520px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cdnAccount.provider')">
          <n-select v-model:value="form.type" :options="providerOptions" @update:value="onTypeChange" />
        </n-form-item>
        <n-form-item :label="t('cdnAccount.accountName')">
          <n-input v-model:value="form.name" :placeholder="t('cdnAccount.remarkPlaceholder')" />
        </n-form-item>
        <n-alert v-if="currentProvider?.note" type="info" style="margin-bottom:12px">{{ currentProvider.note }}</n-alert>
        <n-form-item v-for="(field, key) in currentProvider?.config || {}" :key="key" :label="field.name">
          <n-select v-if="field.type === 'select'" v-model:value="form.config[key]" :options="field.options || []" :placeholder="field.placeholder || field.name" clearable />
          <n-input v-else v-model:value="form.config[key]" :type="isSecretField(key) ? 'password' : 'text'" show-password-on="click" :placeholder="field.placeholder || field.name" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="saving" @click="save">{{ t('cdnAccount.saveVerify') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showSites" preset="card" :title="t('cdnSite.title', { name: siteAcct?.name || '' })" style="max-width:820px" :mask-closable="false">
      <n-space vertical :size="14">
        <n-card size="small" :title="t('cdnSite.create')">
          <n-grid cols="1 s:2" responsive="screen" :x-gap="12" :y-gap="4">
            <n-grid-item>
              <n-form-item :label="t('cdnSite.siteName')" :show-feedback="false">
                <n-input v-model:value="createForm.name" :placeholder="t('cdnSite.siteNamePlaceholder')" />
              </n-form-item>
            </n-grid-item>
            <template v-if="siteIsEsa">
              <n-grid-item>
                <n-form-item :label="t('cdnSite.coverage')" :show-feedback="false">
                  <n-select v-model:value="createForm.coverage" :options="coverageOptions" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('cdnSite.accessType')" :show-feedback="false">
                  <n-select v-model:value="createForm.accessType" :options="accessTypeOptions" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('cdnSite.instance')" :show-feedback="false">
                  <n-select v-model:value="createForm.instanceId" :options="instanceOptions" />
                </n-form-item>
              </n-grid-item>
            </template>
            <template v-else>
              <n-grid-item>
                <n-form-item :label="t('cdnSite.type')" :show-feedback="false">
                  <n-select v-model:value="createForm.type" :options="typeOptions" />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item :label="t('cdnSite.area')" :show-feedback="false">
                  <n-select v-model:value="createForm.area" :options="areaOptions" />
                </n-form-item>
              </n-grid-item>
            </template>
          </n-grid>
          <n-space justify="end" style="margin-top:8px">
            <n-button size="small" @click="checkSiteName">{{ t('cdnSite.checkName') }}</n-button>
            <n-button size="small" type="primary" :loading="siteSaving" @click="createSite">{{ t('cdnSite.create') }}</n-button>
          </n-space>
        </n-card>
        <n-data-table :columns="siteColumns" :data="siteList" :loading="siteLoading" :bordered="false" size="small" :row-key="(r:any) => String(r.zoneId)" />
      </n-space>
    </n-modal>

    <n-modal v-model:show="showOrigin" preset="card" :title="t('cdnOrigin.title', { name: originAcct?.name || '' })" style="max-width:880px" :mask-closable="false">
      <n-space vertical :size="14">
        <n-form-item :label="t('cdnOrigin.site')" :show-feedback="false">
          <n-select v-model:value="originZone" :options="originSiteOptions" :placeholder="t('cdnOrigin.selectSite')" @update:value="loadOriginData" />
        </n-form-item>
        <n-tabs type="line" animated>
          <n-tab-pane name="og" :tab="t('cdnOrigin.originGroups')">
            <n-space vertical :size="10">
              <n-space :size="8">
                <n-input v-model:value="ogForm.name" :placeholder="t('cdnOrigin.name')" style="width:180px" />
                <n-input v-model:value="ogForm.hostHeader" :placeholder="t('cdnOrigin.hostHeader')" style="width:180px" />
                <n-button type="primary" size="small" :loading="ogSaving" @click="createOriginGroup">{{ t('cdnOrigin.create') }}</n-button>
              </n-space>
              <n-input v-model:value="ogForm.records" type="textarea" :rows="3" :placeholder="t('cdnOrigin.recordsHint')" />
              <n-input v-if="originIsEsa" v-model:value="ogForm.params" type="textarea" :rows="3" :placeholder="t('cdnOrigin.extraParamsHint')" />
              <n-data-table :columns="ogColumns" :data="originGroups" :loading="originLoading" size="small" :bordered="false" />
            </n-space>
          </n-tab-pane>
          <n-tab-pane name="lb" :tab="t('cdnOrigin.loadBalancers')">
            <n-space vertical :size="10">
              <n-space :size="8">
                <n-input v-model:value="lbForm.name" :placeholder="t('cdnOrigin.name')" style="width:180px" />
                <n-select v-model:value="lbForm.type" :options="lbTypeOptions" style="width:160px" />
                <n-button type="primary" size="small" :loading="lbSaving" @click="createLoadBalancer">{{ t('cdnOrigin.create') }}</n-button>
              </n-space>
              <n-select v-model:value="lbForm.originGroups" multiple :options="ogOptions" :placeholder="t('cdnOrigin.originGroupsPick')" />
              <n-input v-if="originIsEsa" v-model:value="lbForm.params" type="textarea" :rows="3" :placeholder="t('cdnOrigin.extraParamsHint')" />
              <n-data-table :columns="lbColumns" :data="loadBalancers" :loading="originLoading" size="small" :bordered="false" />
            </n-space>
          </n-tab-pane>
        </n-tabs>
      </n-space>
    </n-modal>

    <n-modal v-model:show="showRules" preset="card" :title="t('cdnRules.title', { name: ruleAcct?.name || '' })" style="max-width:920px" :mask-closable="false">
      <n-space vertical :size="14">
        <n-form-item :label="t('cdnRules.site')" :show-feedback="false">
          <n-select v-model:value="ruleZone" :options="ruleSiteOptions" :placeholder="t('cdnRules.selectSite')" @update:value="loadRules" />
        </n-form-item>
        <n-form-item v-if="ruleIsEsa" :label="t('cdnRules.kind')" :show-feedback="false">
          <n-select v-model:value="ruleKind" :options="ruleKindOptions" @update:value="loadRules" />
        </n-form-item>
        <n-card size="small" :title="ruleEditingId ? t('common.edit') : t('cdnRules.create')">
          <n-space vertical :size="8">
            <n-space :size="8">
              <n-input v-model:value="ruleForm.ruleName" :placeholder="t('cdnRules.ruleName')" style="width:240px" />
              <n-select v-model:value="ruleForm.status" :options="ruleStatusOptions" style="width:140px" />
              <n-button size="small" type="primary" :loading="ruleSaving" @click="saveRule">{{ t('common.save') }}</n-button>
              <n-button v-if="ruleEditingId" size="small" @click="resetRuleForm">{{ t('common.cancel') }}</n-button>
            </n-space>
            <n-input v-model:value="ruleForm.json" type="textarea" :rows="8" :placeholder="t('cdnRules.rulesJson')" />
          </n-space>
        </n-card>
        <n-data-table :columns="ruleColumns" :data="ruleList" :loading="ruleLoading" size="small" :bordered="false" :row-key="(r:any) => String(r.ruleId || r.configId)" />
      </n-space>
    </n-modal>

    <n-modal v-model:show="showSecurity" preset="card" :title="t('cdnSecurity.title', { name: secAcct?.name || '' })" style="max-width:900px" :mask-closable="false">
      <n-space vertical :size="14">
        <n-form-item :label="t('cdnSecurity.site')" :show-feedback="false">
          <n-select v-model:value="secZone" :options="secSiteOptions" :placeholder="t('cdnSecurity.selectSite')" @update:value="loadSecurity" />
        </n-form-item>
        <n-tabs type="line" animated>
          <n-tab-pane v-if="secCaps.securityIpGroup" name="ipg" :tab="t('cdnSecurity.ipGroups')">
            <n-space vertical :size="10">
              <n-space :size="8">
                <n-input v-model:value="ipForm.name" :placeholder="t('cdnSecurity.name')" style="width:180px" />
                <n-button type="primary" size="small" :loading="ipSaving" @click="createIpGroup">{{ t('cdnSecurity.create') }}</n-button>
              </n-space>
              <n-input v-model:value="ipForm.content" type="textarea" :rows="3" :placeholder="t('cdnSecurity.contentHint')" />
              <n-data-table :columns="ipColumns" :data="ipGroups" :loading="secLoading" size="small" :bordered="false" />
            </n-space>
          </n-tab-pane>
          <n-tab-pane v-if="secCaps.ddos" name="ddos" :tab="t('cdnSecurity.ddos')">
            <n-space vertical :size="8">
              <n-button size="small" @click="loadSecurityConfig('ddos')">{{ t('cdnSecurity.load') }}</n-button>
              <n-input v-model:value="secJson.ddos" type="textarea" :rows="8" :placeholder="t('cdnSecurity.configJson')" />
              <n-button size="small" type="primary" @click="saveSecurityConfig('ddos')">{{ t('common.save') }}</n-button>
            </n-space>
          </n-tab-pane>
          <n-tab-pane v-if="secCaps.waf" name="waf" :tab="t('cdnSecurity.waf')">
            <n-space vertical :size="8">
              <n-button size="small" @click="loadSecurityConfig('waf')">{{ t('cdnSecurity.load') }}</n-button>
              <n-input v-model:value="secJson.waf" type="textarea" :rows="8" :placeholder="t('cdnSecurity.configJson')" />
              <n-button size="small" type="primary" @click="saveSecurityConfig('waf')">{{ t('common.save') }}</n-button>
            </n-space>
          </n-tab-pane>
          <n-tab-pane v-if="secCaps.originProtection" name="op" :tab="t('cdnSecurity.originProtection')">
            <n-space vertical :size="8">
              <n-button size="small" @click="loadSecurityConfig('originProtection')">{{ t('cdnSecurity.load') }}</n-button>
              <n-input v-model:value="secJson.originProtection" type="textarea" :rows="8" :placeholder="t('cdnSecurity.configJson')" />
              <n-button size="small" type="primary" @click="saveSecurityConfig('originProtection')">{{ t('common.save') }}</n-button>
            </n-space>
          </n-tab-pane>
        </n-tabs>
      </n-space>
    </n-modal>

    <n-modal v-model:show="showAdvanced" preset="card" :title="t('cdnAdvanced.title', { name: advAcct?.name || '' })" style="max-width:920px" :mask-closable="false">
      <n-space vertical :size="14">
        <n-form-item :label="t('cdnAdvanced.site')" :show-feedback="false">
          <n-select v-model:value="advZone" :options="advSiteOptions" :placeholder="t('cdnAdvanced.selectSite')" @update:value="loadAdvanced" />
        </n-form-item>
        <n-tabs type="line" animated>
          <n-tab-pane v-if="advCaps.l4" name="l4" :tab="t('cdnAdvanced.l4')">
            <n-space vertical :size="10">
              <n-space :size="8">
                <n-input v-model:value="l4Form.name" :placeholder="t('cdnAdvanced.name')" style="width:180px" />
                <n-input v-model:value="l4Form.area" :placeholder="t('cdnAdvanced.area')" style="width:140px" />
                <n-button type="primary" size="small" :loading="l4Saving" @click="createL4Proxy">{{ t('cdnAdvanced.create') }}</n-button>
              </n-space>
              <n-input v-if="advIsEsa" v-model:value="l4Form.params" type="textarea" :rows="3" :placeholder="t('cdnAdvanced.extraParamsHint')" />
              <n-data-table :columns="l4Columns" :data="l4Proxies" :loading="advLoading" size="small" :bordered="false" />
            </n-space>
          </n-tab-pane>
          <n-tab-pane v-if="advCaps.tasks" name="tasks" :tab="t('cdnAdvanced.tasks')">
            <n-space vertical :size="12">
              <n-button size="small" @click="loadAdvanced">{{ t('cdnAdvanced.refresh') }}</n-button>
              <n-card size="small" :title="t('cdnAdvanced.purge')">
                <n-data-table :columns="taskColumns" :data="purgeTasks" :loading="advLoading" size="small" :bordered="false" />
              </n-card>
              <n-card size="small" :title="t('cdnAdvanced.prefetch')">
                <n-data-table :columns="taskColumns" :data="prefetchTasks" :loading="advLoading" size="small" :bordered="false" />
              </n-card>
            </n-space>
          </n-tab-pane>
          <n-tab-pane v-if="advCaps.tasks" name="quota" :tab="t('cdnAdvanced.quota')">
            <n-space vertical :size="8">
              <n-button size="small" @click="loadQuota">{{ t('cdnAdvanced.load') }}</n-button>
              <n-input v-model:value="advJson.quota" type="textarea" :rows="8" readonly />
            </n-space>
          </n-tab-pane>
          <n-tab-pane v-if="advCaps.analysis" name="analysis" :tab="t('cdnAdvanced.analysis')">
            <n-space vertical :size="8">
              <n-button size="small" @click="loadTopAnalysis">{{ t('cdnAdvanced.load') }}</n-button>
              <n-input v-model:value="advJson.analysis" type="textarea" :rows="10" readonly />
            </n-space>
          </n-tab-pane>
        </n-tabs>
      </n-space>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { NButton, NSpace, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { AddOutline, CloudOutline, PeopleOutline, GlobeOutline } from '@vicons/ionicons5';
import { api } from '../api';
import { isSecretField } from '../lib/safe';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const accounts = ref<any[]>([]);
const providerCount = computed(() => new Set(accounts.value.map((a: any) => a.type)).size);
const tunnelAccounts = computed(() => accounts.value.filter((a: any) => a.type === 'cloudflare').length);
const providers = ref<Record<string, any>>({});
const providerOptions = ref<any[]>([]);

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<any>({ type: '', name: '', config: {} });
const currentProvider = ref<any>(null);

// ===== 站点管理 =====
const showSites = ref(false);
const siteAcct = ref<any>(null);
const siteList = ref<any[]>([]);
const siteLoading = ref(false);
const siteSaving = ref(false);
const instanceList = ref<any[]>([]);
const createForm = reactive<any>({ name: '', coverage: 'domestic', accessType: 'CNAME', instanceId: '', type: 'partial', area: 'overseas' });
const siteIsEsa = computed(() => siteAcct.value?.type === 'aliyun_esa');

const coverageOptions = computed(() => [
  { label: t('cdnSite.coverageDomestic'), value: 'domestic' },
  { label: t('cdnSite.coverageGlobal'), value: 'global' },
  { label: t('cdnSite.coverageOverseas'), value: 'overseas' },
]);
const accessTypeOptions = computed(() => [
  { label: t('cdnSite.accessNS'), value: 'NS' },
  { label: t('cdnSite.accessCNAME'), value: 'CNAME' },
]);
const typeOptions = computed(() => [
  { label: t('cdnSite.typePartial'), value: 'partial' },
  { label: t('cdnSite.typeFull'), value: 'full' },
]);
const areaOptions = computed(() => [
  { label: t('cdnSite.areaGlobal'), value: 'global' },
  { label: t('cdnSite.areaMainland'), value: 'mainland' },
  { label: t('cdnSite.areaOverseas'), value: 'overseas' },
]);
const instanceOptions = computed(() =>
  instanceList.value.map((it: any) => ({
    label: it.PlanName || it.InstanceName || String(it.InstanceId || it.Id || ''),
    value: String(it.InstanceId || it.Id || ''),
  })),
);
function siteStatusLabel(row: any) {
  if (row.paused) return t('cdnSite.statusPaused');
  const map: Record<string, string> = {
    active: t('cdnSite.statusActive'),
    pending: t('cdnSite.statusPending'),
    offline: t('cdnSite.statusOffline'),
    moved: t('cdnSite.statusMoved'),
    deactivated: t('cdnSite.statusDeactivated'),
    initializing: t('cdnSite.statusInitializing'),
  };
  return map[String(row.status || '').toLowerCase()] || (row.status || '');
}
const siteColumns = computed(() => [
  { title: t('cdnSite.colName'), key: 'zoneName', minWidth: 160 },
  { title: t('cdnSite.colStatus'), key: 'status', width: 110, render: (row: any) => siteStatusLabel(row) },
  { title: t('cdnSite.colArea'), key: 'area', width: 130 },
  {
    title: t('cdnSite.colActions'),
    key: 'actions',
    width: 320,
    render: (row: any) => {
      const btns: any[] = [
        h(NButton, { size: 'tiny', onClick: () => toggleSitePause(row) }, { default: () => (row.paused ? t('cdnSite.resume') : t('cdnSite.pause')) }),
        h(NButton, { size: 'tiny', onClick: () => verifySite(row) }, { default: () => t('cdnSite.verify') }),
      ];
      if (siteIsEsa.value) btns.push(h(NButton, { size: 'tiny', onClick: () => showNs(row) }, { default: () => t('cdnSite.ns') }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => deleteSite(row) }, { default: () => t('cdnSite.delete') }));
      return h(NSpace, null, { default: () => btns });
    },
  },
]);

// ===== 源站与负载均衡 =====
const showOrigin = ref(false);
const originAcct = ref<any>(null);
const originSites = ref<any[]>([]);
const originZone = ref<string>('');
const originGroups = ref<any[]>([]);
const loadBalancers = ref<any[]>([]);
const originLoading = ref(false);
const ogSaving = ref(false);
const lbSaving = ref(false);
const ogForm = reactive<any>({ name: '', hostHeader: '', records: '', params: '' });
const lbForm = reactive<any>({ name: '', type: 'HTTP', originGroups: [], params: '' });

const originSiteOptions = computed(() => originSites.value.map((z: any) => ({ label: z.zoneName || String(z.zoneId), value: String(z.zoneId) })));
const ogOptions = computed(() => originGroups.value.map((g: any) => ({ label: g.name || String(g.groupId), value: String(g.groupId) })));
const originIsEsa = computed(() => originAcct.value?.type === 'aliyun_esa');
const lbTypeOptions = computed(() => [
  { label: 'HTTP', value: 'HTTP' },
  { label: 'HTTP_V2', value: 'HTTP_V2' },
  { label: 'GENERAL', value: 'GENERAL' },
]);
const ogColumns = computed(() => [
  { title: t('cdnOrigin.colName'), key: 'name', minWidth: 140 },
  { title: t('cdnOrigin.colType'), key: 'type', width: 100 },
  {
    title: t('cdnOrigin.colRecords'),
    key: 'records',
    minWidth: 200,
    render: (r: any) => (Array.isArray(r.records) ? r.records.map((x: any) => (typeof x === 'string' ? x : x.Record || x.record || x.Address || '')).join(', ') : ''),
  },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 90, render: (r: any) => h(NButton, { size: 'tiny', type: 'error', onClick: () => delOriginGroup(r) }, { default: () => t('cdnOrigin.delete') }) },
]);
const lbColumns = computed(() => [
  { title: t('cdnOrigin.colName'), key: 'name', minWidth: 140 },
  { title: t('cdnOrigin.colType'), key: 'type', width: 120 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 90, render: (r: any) => h(NButton, { size: 'tiny', type: 'error', onClick: () => delLoadBalancer(r) }, { default: () => t('cdnOrigin.delete') }) },
]);

// ===== 规则引擎 =====
const showRules = ref(false);
const ruleAcct = ref<any>(null);
const ruleSites = ref<any[]>([]);
const ruleZone = ref<string>('');
const ruleKind = ref<string>('RedirectRule');
const ruleList = ref<any[]>([]);
const ruleLoading = ref(false);
const ruleSaving = ref(false);
const ruleEditingId = ref<string>('');
const ruleForm = reactive<any>({ ruleName: '', status: 'enable', json: '' });
const ruleIsEsa = computed(() => ruleAcct.value?.type === 'aliyun_esa');
const ruleSiteOptions = computed(() => ruleSites.value.map((z: any) => ({ label: z.zoneName || String(z.zoneId), value: String(z.zoneId) })));
// 与后端 routes/cdn.ts 的 ESA_RULE_KINDS 白名单保持一致
const ruleKindOptions = [
  'RedirectRule',
  'RewriteUrlRule',
  'HttpRequestHeaderModificationRule',
  'HttpResponseHeaderModificationRule',
  'HttpIncomingRequestHeaderModificationRule',
  'HttpIncomingResponseHeaderModificationRule',
  'CustomResponseCodeRule',
  'NetworkOptimization',
  'CompressionRule',
  'ImageTransform',
  'VideoProcessing',
  'OriginRule',
  'CacheRule',
  'HttpsBasicConfiguration',
  'HttpsApplicationConfiguration',
].map((k) => ({ label: k, value: k }));
const ruleStatusOptions = computed(() => [
  { label: t('cdnRules.enable'), value: 'enable' },
  { label: t('cdnRules.disable'), value: 'disable' },
]);
const ruleColumns = computed(() => [
  { title: t('cdnRules.colName'), key: 'ruleName', minWidth: 200 },
  { title: t('cdnRules.colStatus'), key: 'status', width: 110 },
  {
    title: t('cdnRules.colActions'),
    key: 'actions',
    width: 160,
    render: (r: any) =>
      h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', onClick: () => editRule(r) }, { default: () => t('common.edit') }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => delRule(r) }, { default: () => t('common.delete') }),
        ],
      }),
  },
]);

// ===== 安全配置 =====
const showSecurity = ref(false);
const secAcct = ref<any>(null);
const secSites = ref<any[]>([]);
const secZone = ref<string>('');
const secLoading = ref(false);
const ipGroups = ref<any[]>([]);
const ipSaving = ref(false);
const ipForm = reactive<any>({ name: '', content: '' });
const secJson = reactive<any>({ ddos: '', waf: '', originProtection: '' });
const secCaps = computed(() => providers.value[secAcct.value?.type]?.capabilities || {});
const secSiteOptions = computed(() => secSites.value.map((z: any) => ({ label: z.zoneName || String(z.zoneId), value: String(z.zoneId) })));
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
          h(NButton, { size: 'tiny', type: 'error', onClick: () => delIpGroup(r) }, { default: () => t('common.delete') }),
        ],
      }),
  },
]);

// ===== 高级功能（L4 / 任务 / 配额 / 统计）=====
const showAdvanced = ref(false);
const advAcct = ref<any>(null);
const advSites = ref<any[]>([]);
const advZone = ref<string>('');
const advLoading = ref(false);
const l4Proxies = ref<any[]>([]);
const l4Form = reactive<any>({ name: '', area: '', params: '' });
const l4Saving = ref(false);
const purgeTasks = ref<any[]>([]);
const prefetchTasks = ref<any[]>([]);
const advJson = reactive<any>({ quota: '', analysis: '' });
const advCaps = computed(() => providers.value[advAcct.value?.type]?.capabilities || {});
const advIsEsa = computed(() => advAcct.value?.type === 'aliyun_esa');
const advSiteOptions = computed(() => advSites.value.map((z: any) => ({ label: z.zoneName || String(z.zoneId), value: String(z.zoneId) })));
const l4Columns = computed(() => [
  { title: t('cdnAdvanced.colName'), key: 'name', minWidth: 160 },
  { title: t('cdnAdvanced.colArea'), key: 'area', width: 120 },
  { title: t('cdnAdvanced.colActions'), key: 'actions', width: 100, render: (r: any) => h(NButton, { size: 'tiny', type: 'error', onClick: () => delL4Proxy(r) }, { default: () => t('cdnAdvanced.delete') }) },
]);
const taskColumns = computed(() => [
  { title: 'ID', key: 'TaskId', width: 140, render: (r: any) => String(r.TaskId ?? r.Id ?? r.JobId ?? '') },
  { title: t('cdnAdvanced.colName'), key: 'Target', minWidth: 240, render: (r: any) => String(r.Target ?? r.Url ?? r.Content ?? '') },
  { title: 'Status', key: 'Status', width: 140, render: (r: any) => String(r.Status ?? r.TaskStatus ?? '') },
]);

const columns = computed(() => [
  { title: 'ID', key: 'id', width: 60 },
  { title: t('cdnAccount.providerCol'), key: 'typename', width: 140 },
  {
    title: t('cdnAccount.nameCol'),
    key: 'name',
    minWidth: 180,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.name });
    },
  },
  {
    title: t('common.remark'),
    key: 'remark',
    minWidth: 120,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.remark || '' });
    },
  },
  { title: t('cdnAccount.addTime'), key: 'addtime', width: 170 },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 620,
    render(row: any) {
      const caps = providers.value[row.type]?.capabilities || {};
      const btns: any[] = [];
      if (caps.zoneManage) {
        btns.push(h(NButton, { size: 'tiny', onClick: () => openSites(row) }, { default: () => t('cdnSite.manage') }));
      }
      if (caps.originGroup || caps.loadBalancer) {
        btns.push(h(NButton, { size: 'tiny', onClick: () => openOrigin(row) }, { default: () => t('cdnOrigin.manage') }));
      }
      if (caps.rules) {
        btns.push(h(NButton, { size: 'tiny', onClick: () => openRules(row) }, { default: () => t('cdnRules.manage') }));
      }
      if (caps.security) {
        btns.push(h(NButton, { size: 'tiny', onClick: () => openSecurity(row) }, { default: () => t('cdnSecurity.manage') }));
      }
      if (caps.l4 || caps.tasks) {
        btns.push(h(NButton, { size: 'tiny', onClick: () => openAdvanced(row) }, { default: () => t('cdnAdvanced.manage') }));
      }
      btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(row) }, { default: () => t('common.edit') }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h(NSpace, null, { default: () => btns });
    },
  },
]);

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function loadProviders() {
  const res = await api<any>('GET', '/cdn/providers');
  if (res.code === 0) {
    providers.value = res.data;
    providerOptions.value = Object.entries(res.data).map(([k, v]: any) => ({ label: v.name, value: k }));
  }
}

async function loadAccounts() {
  loading.value = true;
  const res = await api<any>('GET', '/cdn/accounts');
  accounts.value = res.code === 0 ? res.data : [];
  loading.value = false;
}

function onTypeChange() {
  currentProvider.value = providers.value[form.type] || null;
  const cfg: Record<string, any> = {};
  for (const key of Object.keys(currentProvider.value?.config || {})) cfg[key] = '';
  form.config = cfg;
}

function openAdd() {
  editingId.value = null;
  form.type = '';
  form.name = '';
  form.config = {};
  currentProvider.value = null;
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.type = row.type;
  form.name = row.name;
  form.config = row.config && typeof row.config === 'object' ? { ...row.config } : safeJson(row.config) || {};
  currentProvider.value = providers.value[form.type] || null;
  showEdit.value = true;
}

async function save() {
  if (!form.type || !form.name) return message.warning(t('cdnAccount.fillWarning'));
  saving.value = true;
  const body = { type: form.type, name: form.name, config: form.config, remark: '' };
  const res = editingId.value
    ? await api('PUT', `/cdn/accounts/${editingId.value}`, body)
    : await api('POST', '/cdn/accounts', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadAccounts();
  } else message.error(res.msg);
}

function del(row: any) {
  dialog.warning({
    title: t('cdnAccount.deleteTitle'),
    content: t('cdnAccount.deleteConfirm', { name: row.name }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${row.id}`);
      if (res.code === 0) {
        message.success(t('cdnAccount.deleteSuccess'));
        loadAccounts();
      } else message.error(res.msg);
    },
  });
}

async function openSites(row: any) {
  siteAcct.value = row;
  createForm.name = '';
  instanceList.value = [];
  showSites.value = true;
  await loadSites();
  if (row.type === 'aliyun_esa') await loadInstances();
}

async function loadSites() {
  if (!siteAcct.value) return;
  siteLoading.value = true;
  const res = await api<any>('GET', `/cdn/accounts/${siteAcct.value.id}/sites`);
  siteList.value = res.code === 0 ? res.data : [];
  siteLoading.value = false;
}

async function loadInstances() {
  const res = await api<any>('GET', `/cdn/accounts/${siteAcct.value.id}/plan-instances`);
  instanceList.value = res.code === 0 && Array.isArray(res.data) ? res.data : [];
}

async function checkSiteName() {
  if (!createForm.name) return message.warning(t('cdnSite.needName'));
  const res = await api<any>('POST', `/cdn/accounts/${siteAcct.value.id}/sites/check`, { siteName: createForm.name });
  if (res.code !== 0) return message.error(res.msg);
  if (res.data?.passed === false) message.warning(t('cdnSite.nameBad'));
  else message.success(t('cdnSite.nameOk'));
}

async function createSite() {
  if (!createForm.name) return message.warning(t('cdnSite.needName'));
  siteSaving.value = true;
  const body: any = { name: createForm.name };
  if (siteIsEsa.value) {
    body.area = createForm.coverage;
    body.accessType = createForm.accessType;
    body.instanceId = createForm.instanceId;
  } else {
    body.type = createForm.type;
    body.area = createForm.area;
  }
  const res = await api<any>('POST', `/cdn/accounts/${siteAcct.value.id}/sites`, body);
  siteSaving.value = false;
  if (res.code === 0) {
    message.success(res.msg || t('cdnSite.created'));
    if (res.data?.nameServers?.length) message.info(t('cdnSite.nsTitle') + ': ' + res.data.nameServers.join(', '), { duration: 8000 });
    createForm.name = '';
    loadSites();
  } else message.error(res.msg);
}

async function toggleSitePause(row: any) {
  const res = await api<any>('POST', `/cdn/accounts/${siteAcct.value.id}/sites/pause`, { zoneId: row.zoneId, paused: !row.paused });
  if (res.code === 0) {
    message.success(res.msg);
    loadSites();
  } else message.error(res.msg);
}

async function verifySite(row: any) {
  const res = await api<any>('POST', `/cdn/accounts/${siteAcct.value.id}/sites/verify`, { zoneId: row.zoneId, domain: row.zoneName });
  if (res.code === 0) message.success(t('cdnSite.verifiedOk'));
  else message.error(res.msg);
}

async function showNs(row: any) {
  const res = await api<any>('GET', `/cdn/accounts/${siteAcct.value.id}/sites/${encodeURIComponent(row.zoneId)}/ns`);
  if (res.code === 0) {
    dialog.info({ title: t('cdnSite.nsTitle'), content: () => h('div', { style: 'white-space:pre-wrap' }, (res.data || []).join('\n') || '-') });
  } else message.error(res.msg);
}

function deleteSite(row: any) {
  dialog.warning({
    title: t('common.delete'),
    content: t('cdnSite.confirmDelete', { name: row.zoneName || row.zoneId }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${siteAcct.value.id}/sites/${encodeURIComponent(row.zoneId)}`);
      if (res.code === 0) {
        message.success(res.msg);
        loadSites();
      } else message.error(res.msg);
    },
  });
}

// ===== 源站与负载均衡 =====
async function openOrigin(row: any) {
  originAcct.value = row;
  originZone.value = '';
  originGroups.value = [];
  loadBalancers.value = [];
  ogForm.name = '';
  ogForm.hostHeader = '';
  ogForm.records = '';
  ogForm.params = '';
  lbForm.name = '';
  lbForm.type = 'HTTP';
  lbForm.originGroups = [];
  lbForm.params = '';
  showOrigin.value = true;
  const res = await api<any>('GET', `/cdn/accounts/${row.id}/sites`);
  originSites.value = res.code === 0 ? res.data : [];
}

async function loadOriginData() {
  if (!originZone.value || !originAcct.value) return;
  originLoading.value = true;
  const aid = originAcct.value.id;
  const [og, lb] = await Promise.all([
    api<any>('GET', `/cdn/accounts/${aid}/origin-groups`, { zoneId: originZone.value, page: 1, size: 100 }),
    api<any>('GET', `/cdn/accounts/${aid}/load-balancers`, { zoneId: originZone.value, page: 1, size: 100 }),
  ]);
  originGroups.value = og.code === 0 ? og.data?.list || [] : [];
  loadBalancers.value = lb.code === 0 ? lb.data?.list || [] : [];
  originLoading.value = false;
}

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

async function createOriginGroup() {
  if (!originZone.value) return message.warning(t('cdnOrigin.needSite'));
  if (!ogForm.name) return message.warning(t('cdnOrigin.needName'));
  const records = parseRecords(ogForm.records);
  if (!records.length) return message.warning(t('cdnOrigin.needRecords'));
  ogSaving.value = true;
  const res = await api<any>('POST', `/cdn/accounts/${originAcct.value.id}/origin-groups`, {
    zoneId: originZone.value,
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
    positiveText: t('cdnOrigin.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${originAcct.value.id}/origin-groups/${encodeURIComponent(r.groupId)}`, { zoneId: originZone.value });
      if (res.code === 0) {
        message.success(res.msg);
        loadOriginData();
      } else message.error(res.msg);
    },
  });
}

async function createLoadBalancer() {
  if (!originZone.value) return message.warning(t('cdnOrigin.needSite'));
  if (!lbForm.name) return message.warning(t('cdnOrigin.needName'));
  lbSaving.value = true;
  const originGroupsPayload = (lbForm.originGroups || []).map((gid: string, i: number) => ({ Priority: String(i + 1), OriginGroupId: String(gid) }));
  const res = await api<any>('POST', `/cdn/accounts/${originAcct.value.id}/load-balancers`, {
    zoneId: originZone.value,
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
    positiveText: t('cdnOrigin.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${originAcct.value.id}/load-balancers/${encodeURIComponent(r.instanceId)}`, { zoneId: originZone.value });
      if (res.code === 0) {
        message.success(res.msg);
        loadOriginData();
      } else message.error(res.msg);
    },
  });
}

// ===== 规则引擎 =====
async function openRules(row: any) {
  ruleAcct.value = row;
  ruleZone.value = '';
  ruleList.value = [];
  resetRuleForm();
  showRules.value = true;
  const res = await api<any>('GET', `/cdn/accounts/${row.id}/sites`);
  ruleSites.value = res.code === 0 ? res.data : [];
}

function resetRuleForm() {
  ruleEditingId.value = '';
  ruleForm.ruleName = '';
  ruleForm.status = 'enable';
  ruleForm.json = '';
}

async function loadRules() {
  if (!ruleZone.value || !ruleAcct.value) return;
  ruleLoading.value = true;
  const aid = ruleAcct.value.id;
  if (ruleIsEsa.value) {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/rule-configs`, { zoneId: ruleZone.value, kind: ruleKind.value, page: 1, size: 100 });
    ruleList.value = res.code === 0 ? res.data?.list || [] : [];
  } else {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/rules`, { zoneId: ruleZone.value });
    ruleList.value = res.code === 0 ? res.data || [] : [];
  }
  ruleLoading.value = false;
}

function editRule(r: any) {
  ruleEditingId.value = String(r.ruleId || r.configId || '');
  ruleForm.ruleName = r.ruleName || '';
  ruleForm.status = r.status || 'enable';
  const body = ruleIsEsa.value ? (Array.isArray(r.rules) && r.rules.length ? r.rules[0] : r) : r.rules || [];
  ruleForm.json = JSON.stringify(body, null, 2);
}

async function saveRule() {
  if (!ruleZone.value) return message.warning(t('cdnRules.needSite'));
  if (!ruleForm.ruleName) return message.warning(t('cdnRules.needName'));
  let parsed: any;
  try {
    parsed = ruleForm.json ? JSON.parse(ruleForm.json) : ruleIsEsa.value ? {} : [];
  } catch {
    return message.error(t('cdnRules.invalidJson'));
  }
  ruleSaving.value = true;
  const aid = ruleAcct.value.id;
  let res: any;
  if (ruleIsEsa.value) {
    res = await api('POST', `/cdn/accounts/${aid}/rule-configs`, {
      zoneId: ruleZone.value,
      kind: ruleKind.value,
      params: { ...parsed, RuleName: ruleForm.ruleName, RuleEnable: ruleForm.status === 'enable' ? 'on' : 'off' },
    });
  } else if (ruleEditingId.value) {
    res = await api('PUT', `/cdn/accounts/${aid}/rules/${encodeURIComponent(ruleEditingId.value)}`, { zoneId: ruleZone.value, ruleName: ruleForm.ruleName, status: ruleForm.status, rules: parsed });
  } else {
    res = await api('POST', `/cdn/accounts/${aid}/rules`, { zoneId: ruleZone.value, ruleName: ruleForm.ruleName, status: ruleForm.status, rules: parsed });
  }
  ruleSaving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    resetRuleForm();
    loadRules();
  } else message.error(res.msg);
}

function delRule(r: any) {
  dialog.warning({
    title: t('common.delete'),
    content: t('cdnRules.confirmDelete', { name: r.ruleName || '' }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const aid = ruleAcct.value.id;
      let res: any;
      if (ruleIsEsa.value) {
        res = await api('DELETE', `/cdn/accounts/${aid}/rule-configs/${encodeURIComponent(r.configId)}`, { zoneId: ruleZone.value, kind: ruleKind.value });
      } else {
        res = await api('DELETE', `/cdn/accounts/${aid}/rules`, { zoneId: ruleZone.value, ruleIds: [String(r.ruleId)] });
      }
      if (res.code === 0) {
        message.success(res.msg);
        loadRules();
      } else message.error(res.msg);
    },
  });
}

// ===== 安全配置 =====
async function openSecurity(row: any) {
  secAcct.value = row;
  secZone.value = '';
  ipGroups.value = [];
  secJson.ddos = '';
  secJson.waf = '';
  secJson.originProtection = '';
  showSecurity.value = true;
  const res = await api<any>('GET', `/cdn/accounts/${row.id}/sites`);
  secSites.value = res.code === 0 ? res.data : [];
}

function secRoute(key: string) {
  return key === 'originProtection' ? 'origin-protection' : key;
}

async function loadSecurityConfig(key: string, silent = false) {
  if (!secZone.value || !secAcct.value) return;
  const res = await api<any>('GET', `/cdn/accounts/${secAcct.value.id}/security/${secRoute(key)}`, { zoneId: secZone.value });
  if (res.code === 0) secJson[key] = JSON.stringify(res.data, null, 2);
  else if (!silent) message.error(res.msg);
}

async function loadSecurity() {
  if (!secZone.value || !secAcct.value) return;
  secLoading.value = true;
  const aid = secAcct.value.id;
  if (secCaps.value.securityIpGroup) {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/security/ip-groups`, { zoneId: secZone.value });
    ipGroups.value = res.code === 0 ? res.data : [];
  }
  if (secCaps.value.ddos) await loadSecurityConfig('ddos', true);
  if (secCaps.value.waf) await loadSecurityConfig('waf', true);
  if (secCaps.value.originProtection) await loadSecurityConfig('originProtection', true);
  secLoading.value = false;
}

async function saveSecurityConfig(key: string) {
  if (!secZone.value) return message.warning(t('cdnSecurity.needSite'));
  let config: any;
  try {
    config = secJson[key] ? JSON.parse(secJson[key]) : {};
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  const res = await api('POST', `/cdn/accounts/${secAcct.value.id}/security/${secRoute(key)}`, { zoneId: secZone.value, config });
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}

async function createIpGroup() {
  if (!secZone.value) return message.warning(t('cdnSecurity.needSite'));
  if (!ipForm.name) return message.warning(t('cdnSecurity.needName'));
  const content = String(ipForm.content || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  ipSaving.value = true;
  const res = await api<any>('POST', `/cdn/accounts/${secAcct.value.id}/security/ip-groups`, { zoneId: secZone.value, name: ipForm.name, content });
  ipSaving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    ipForm.name = '';
    ipForm.content = '';
    loadSecurity();
  } else message.error(res.msg);
}

async function loadIpContent(r: any) {
  const res = await api<any>('GET', `/cdn/accounts/${secAcct.value.id}/security/ip-groups/${r.groupId}/content`, { zoneId: secZone.value });
  if (res.code === 0) {
    dialog.info({ title: t('cdnSecurity.content'), content: () => h('div', { style: 'white-space:pre-wrap' }, (res.data || []).join('\n') || '-') });
  } else message.error(res.msg);
}

function delIpGroup(r: any) {
  dialog.warning({
    title: t('common.delete'),
    content: t('cdnSecurity.confirmDelete', { name: r.name }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${secAcct.value.id}/security/ip-groups/${r.groupId}`, { zoneId: secZone.value });
      if (res.code === 0) {
        message.success(res.msg);
        loadSecurity();
      } else message.error(res.msg);
    },
  });
}

// ===== 高级功能 =====
async function openAdvanced(row: any) {
  advAcct.value = row;
  advZone.value = '';
  l4Proxies.value = [];
  purgeTasks.value = [];
  prefetchTasks.value = [];
  advJson.quota = '';
  advJson.analysis = '';
  l4Form.name = '';
  l4Form.area = '';
  l4Form.params = '';
  showAdvanced.value = true;
  const res = await api<any>('GET', `/cdn/accounts/${row.id}/sites`);
  advSites.value = res.code === 0 ? res.data : [];
}

async function loadAdvanced() {
  if (!advZone.value || !advAcct.value) return;
  advLoading.value = true;
  const aid = advAcct.value.id;
  if (advCaps.value.l4) {
    const r = await api<any>('GET', `/cdn/accounts/${aid}/l4-proxies`, { zoneId: advZone.value, page: 1, size: 100 });
    l4Proxies.value = r.code === 0 ? r.data?.list || [] : [];
  }
  if (advCaps.value.tasks) {
    const [p, pf] = await Promise.all([
      api<any>('GET', `/cdn/accounts/${aid}/tasks/purge`, { zoneId: advZone.value, page: 1, size: 50 }),
      api<any>('GET', `/cdn/accounts/${aid}/tasks/prefetch`, { zoneId: advZone.value, page: 1, size: 50 }),
    ]);
    purgeTasks.value = p.code === 0 ? p.data?.list || [] : [];
    prefetchTasks.value = pf.code === 0 ? pf.data?.list || [] : [];
  }
  advLoading.value = false;
}

async function createL4Proxy() {
  if (!advZone.value) return message.warning(t('cdnAdvanced.needSite'));
  if (!l4Form.name) return message.warning(t('cdnAdvanced.needName'));
  l4Saving.value = true;
  const res = await api<any>('POST', `/cdn/accounts/${advAcct.value.id}/l4-proxies`, { zoneId: advZone.value, name: l4Form.name, area: l4Form.area || undefined, params: parseExtraParams(l4Form.params) });
  l4Saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    l4Form.name = '';
    l4Form.area = '';
    l4Form.params = '';
    loadAdvanced();
  } else message.error(res.msg);
}

function delL4Proxy(r: any) {
  dialog.warning({
    title: t('common.delete'),
    content: t('cdnAdvanced.confirmDelete', { name: r.name || r.proxyId }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${advAcct.value.id}/l4-proxies/${encodeURIComponent(r.proxyId)}`, { zoneId: advZone.value });
      if (res.code === 0) {
        message.success(res.msg);
        loadAdvanced();
      } else message.error(res.msg);
    },
  });
}

async function loadQuota() {
  if (!advZone.value) return message.warning(t('cdnAdvanced.needSite'));
  const aid = advAcct.value.id;
  const isEsa = advAcct.value.type === 'aliyun_esa';
  const res = await api<any>('GET', isEsa ? `/cdn/accounts/${aid}/quota/purge` : `/cdn/accounts/${aid}/quota/content`, { zoneId: advZone.value, type: 'file' });
  if (res.code === 0) advJson.quota = JSON.stringify(res.data, null, 2);
  else message.error(res.msg);
}

async function loadTopAnalysis() {
  if (!advZone.value) return message.warning(t('cdnAdvanced.needSite'));
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const res = await api<any>('GET', `/cdn/accounts/${advAcct.value.id}/analysis/top`, { zoneIds: advZone.value, startTime: fmt(start), endTime: fmt(now), metricName: 'l7Flow_outFlux', limit: 10 });
  if (res.code === 0) advJson.analysis = JSON.stringify(res.data, null, 2);
  else message.error(res.msg);
}

onMounted(() => {
  loadProviders();
  loadAccounts();
});
</script>

