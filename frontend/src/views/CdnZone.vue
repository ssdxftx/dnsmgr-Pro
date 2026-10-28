<template>
  <div class="app-stack">
    <PageHeader :title="t('cdnZone.title')" :subtitle="t('cdnZone.subtitle')" back="/cdn-domains">
      <template #actions>
        <n-button v-if="createAccounts.length" size="small" type="primary" @click="openCreate">{{ t('cdnSite.create') }}</n-button>
        <n-button size="small" :loading="loadBusy" @click="loadAll">{{ t('cdnZoneSetting.refresh') }}</n-button>
      </template>
    </PageHeader>

    <n-spin :show="loadBusy && !zoneList.length">
      <div v-if="zoneList.length" class="zone-grid">
        <div
          v-for="row in zoneList"
          :key="row.key"
          class="zone-tile"
          role="button"
          tabindex="0"
          @click="openSetting(row)"
          @keydown.enter="openSetting(row)"
          @keydown.space.prevent="openSetting(row)"
        >
          <div class="zone-tile__head">
            <span class="zone-tile__name">{{ row.zone_name || row.name || '-' }}</span>
            <n-tag size="small" :type="statusTagType(row)">{{ statusLabel(row) }}</n-tag>
          </div>
          <div class="zone-tile__sub">
            <span class="zone-tile__id">{{ row.zone_id }}</span>
            <n-tag size="tiny" :type="row.cloud ? 'info' : 'default'">
              {{ row.cloud ? t('cdnZone.cloudBadge') : t('cdnZone.localBadge') }}
            </n-tag>
          </div>
          <div class="zone-tile__meta">
            <n-tag size="tiny" :bordered="false" class="zone-tile__vendor">{{ row.typename || row.type || '-' }}</n-tag>
            <span class="zone-tile__account">{{ row.accountName || '-' }}</span>
          </div>
          <div class="zone-tile__foot">
            <span class="zone-tile__domains">{{ t('cdnZone.colDomains') }} · {{ row.domain_count ?? 0 }}</span>
            <n-button size="tiny" type="primary" @click.stop="openSetting(row)">{{ t('cdnZone.goSetting') }}</n-button>
          </div>
        </div>
      </div>
      <n-card v-else-if="!loadBusy" :bordered="false">
        <EmptyState :icon="FolderOpenOutline" :title="t('cdnZone.empty')" />
      </n-card>
    </n-spin>

    <n-card v-if="isAdmin && cfAccounts.length" :bordered="false" class="cf-section">
      <template #header>
        <div class="cf-section__head">
          <span>{{ t('cdnZone.cfRulesTitle') }}</span>
          <span class="cf-section__hint">{{ t('cdnZone.cfRulesHint') }}</span>
        </div>
      </template>
      <div class="cf-grid">
        <div
          v-for="a in cfAccounts"
          :key="a.aid"
          class="cf-tile"
          role="button"
          tabindex="0"
          @click="openCfRules(a)"
          @keydown.enter="openCfRules(a)"
          @keydown.space.prevent="openCfRules(a)"
        >
          <div class="cf-tile__head">
            <span class="cf-tile__name">{{ a.name }}</span>
            <n-tag size="tiny" :type="a.credential === 'ready' ? 'success' : 'warning'" :bordered="false">
              {{ a.credential === 'ready' ? t('cdnZone.cfCredReady') : t('cdnZone.cfCredMissing') }}
            </n-tag>
          </div>
          <div class="cf-tile__meta">
            <span>{{ t('cdnZone.cfDomains', { n: a.domainCount }) }}</span>
            <span class="cf-tile__dot">·</span>
            <span>{{ t('cdnZone.cfZones', { n: a.zoneCount }) }}</span>
          </div>
          <div class="cf-tile__foot">
            <span class="cf-tile__label">{{ t('cdnZone.cfRulesEntry') }}</span>
            <n-button size="tiny" type="primary" @click.stop="openCfRules(a)">{{ t('cdnZone.cfEnter') }}</n-button>
          </div>
        </div>
      </div>
    </n-card>

    <n-modal v-model:show="showCreate" preset="card" :title="t('cdnSite.create')" class="modal-md" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cdnAccount.provider')">
          <EsaCardSelect
            :model-value="createForm.aid"
            :options="createAccountOptions"
            compact
            @update:model-value="(v: any) => { createForm.aid = v; onCreateAid(v); }"
          />
        </n-form-item>
        <n-form-item :label="t('cdnSite.siteName')">
          <div class="create-name-row">
            <n-input v-model:value="createForm.name" :placeholder="t('cdnSite.siteNamePlaceholder')" />
            <n-button size="small" :loading="checkBusy" :disabled="!createForm.aid || !createForm.name" @click="checkName">{{ t('cdnSite.checkName') }}</n-button>
          </div>
        </n-form-item>
        <n-alert v-if="checkResult" :type="checkResult.passed ? 'success' : 'warning'" :show-icon="false" class="mb-3">
          {{ checkResult.message }}
        </n-alert>

        <template v-if="createIsEsa">
          <n-form-item :label="t('cdnSite.coverage')">
            <EsaCardSelect v-model="createForm.coverage" :options="coverageOptions" compact />
          </n-form-item>
          <n-form-item :label="t('cdnSite.accessType')">
            <EsaCardSelect v-model="createForm.accessType" :options="accessTypeOptions" compact />
          </n-form-item>
          <n-form-item :label="t('cdnSite.instance')">
            <EsaCardSelect
              v-model="createForm.instanceId"
              :options="planOptions"
              compact
              searchable
              :placeholder="t('cdnSite.instance')"
            />
          </n-form-item>
        </template>
        <template v-else>
          <n-form-item :label="t('cdnSite.type')">
            <EsaCardSelect v-model="createForm.type" :options="eoTypeOptions" compact />
          </n-form-item>
          <n-form-item :label="t('cdnSite.area')">
            <EsaCardSelect v-model="createForm.area" :options="eoAreaOptions" compact />
          </n-form-item>
        </template>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCreate = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="createBusy" @click="createSite">{{ t('cdnSite.create') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-drawer v-model:show="showCfPanel" placement="right" width="min(1180px, 94vw)">
      <n-drawer-content closable :native-scrollbar="false" :title="cfPanelTitle">
        <CfRulesPanel v-if="showCfPanel && cfPanelAid" :key="cfPanelAid" :aid="cfPanelAid" />
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NCard, NSpin, NTag, useMessage } from 'naive-ui';
import { FolderOpenOutline } from '@vicons/ionicons5';
import CfRulesPanel from '../components/cf/CfRulesPanel.vue';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import EsaCardSelect from '../components/cdn/EsaCardSelect.vue';

const { t } = useI18n();
const message = useMessage();
const route = useRoute();
const router = useRouter();

const loadBusy = ref(false);
const zoneList = ref<any[]>([]);
const accounts = ref<any[]>([]);
const cfAccounts = ref<any[]>([]);
const providers = ref<Record<string, any>>({});
const isAdmin = computed(() => (getUser()?.level || 0) >= 2);

const showCfPanel = ref(false);
const cfPanelAid = ref(0);
const cfPanelName = ref('');
const cfPanelTitle = computed(() =>
  cfPanelName.value ? `${t('cfRules.title')} · ${cfPanelName.value}` : t('cfRules.title'),
);

const showCreate = ref(false);
const createBusy = ref(false);
const checkBusy = ref(false);
const planBusy = ref(false);
const planOptions = ref<any[]>([]);
const checkResult = ref<{ passed: boolean; message: string } | null>(null);
const createForm = reactive<any>({ aid: null, name: '', coverage: 'domestic', accessType: 'NS', instanceId: '', type: 'partial', area: 'global' });
const coverageOptions = computed(() => [
  { label: t('cdnSite.coverageDomestic'), value: 'domestic' },
  { label: t('cdnSite.coverageGlobal'), value: 'global' },
  { label: t('cdnSite.coverageOverseas'), value: 'overseas' },
]);
const accessTypeOptions = computed(() => [
  { label: t('cdnSite.accessNS'), value: 'NS' },
  { label: t('cdnSite.accessCNAME'), value: 'CNAME' },
]);
const eoTypeOptions = computed(() => [
  { label: t('cdnSite.typePartial'), value: 'partial' },
  { label: t('cdnSite.typeFull'), value: 'full' },
]);
const eoAreaOptions = computed(() => [
  { label: t('cdnSite.areaGlobal'), value: 'global' },
  { label: t('cdnSite.areaMainland'), value: 'mainland' },
  { label: t('cdnSite.areaOverseas'), value: 'overseas' },
]);
const createAccounts = computed(() => accounts.value.filter((a: any) => providers.value[a.type]?.capabilities?.zoneManage));
const createAccountOptions = computed(() => createAccounts.value.map((a: any) => ({ label: `${a.name} · ${providers.value[a.type]?.name || a.type}`, value: a.id })));
const createAccount = computed(() => createAccounts.value.find((a: any) => Number(a.id) === Number(createForm.aid)) || null);
const createIsEsa = computed(() => String(createAccount.value?.type || '') === 'aliyun_esa');

function statusLabel(row: any) {
  if (row.paused) return t('cdnSite.statusPaused');
  const map: Record<string, string> = {
    active: t('cdnSite.statusActive'),
    pending: t('cdnSite.statusPending'),
    offline: t('cdnSite.statusOffline'),
    moved: t('cdnSite.statusMoved'),
    deactivated: t('cdnSite.statusDeactivated'),
    initializing: t('cdnSite.statusInitializing'),
  };
  return map[String(row.status || '').toLowerCase()] || row.status || '-';
}

type TagType = 'success' | 'warning' | 'error' | 'info' | 'default';
function statusTagType(row: any): TagType {
  if (row.paused) return 'warning';
  const map: Record<string, TagType> = {
    active: 'success',
    pending: 'info',
    initializing: 'info',
    offline: 'default',
    moved: 'error',
    deactivated: 'error',
  };
  return map[String(row.status || '').toLowerCase()] || 'default';
}

function openSetting(row: any) {
  router.push(`/cdn-zones/${row.aid}/${encodeURIComponent(String(row.zone_id))}`);
}

async function loadProviders() {
  // 单个接口失败不能阻断首屏其余数据加载
  const res = await api<any>('GET', '/cdn/providers').catch(() => ({ code: -1 } as any));
  providers.value = res.code === 0 ? res.data || {} : {};
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cdn/accounts').catch(() => ({ code: -1 } as any));
  accounts.value = res.code === 0 ? res.data || [] : [];
}

function openCreate() {
  checkResult.value = null;
  planOptions.value = [];
  const first = createAccounts.value[0];
  createForm.aid = first?.id || null;
  createForm.name = '';
  createForm.coverage = 'domestic';
  createForm.accessType = 'NS';
  createForm.instanceId = '';
  createForm.type = 'partial';
  createForm.area = 'global';
  showCreate.value = true;
  if (createForm.aid) onCreateAid(createForm.aid);
}

function onCreateAid(aid: number) {
  checkResult.value = null;
  planOptions.value = [];
  createForm.instanceId = '';
  if (String(createAccount.value?.type || '') === 'aliyun_esa') loadPlans();
}

async function loadPlans() {
  if (!createForm.aid) return;
  planBusy.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${createForm.aid}/plan-instances`);
    if (res.code !== 0) {
      message.error(res.msg);
      return;
    }
    const list = Array.isArray(res.data) ? res.data : [];
    planOptions.value = list
      .filter((p: any) => p.InstanceId)
      .map((p: any) => ({
        label: `${p.PlanName || p.InstanceId} · ${p.InstanceId}${p.ExpireTime ? ' · ' + String(p.ExpireTime).slice(0, 10) : ''}`,
        value: String(p.InstanceId),
      }));
    if (!createForm.instanceId && planOptions.value.length) createForm.instanceId = planOptions.value[0].value;
  } finally {
    planBusy.value = false;
  }
}

async function checkName() {
  if (!createForm.aid || !createForm.name) return;
  checkBusy.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${createForm.aid}/sites/check`, { siteName: createForm.name.trim() });
    if (res.code !== 0) {
      checkResult.value = { passed: false, message: res.msg };
      return;
    }
    const passed = res.data?.passed !== false;
    checkResult.value = {
      passed,
      message: passed ? t('cdnSite.nameOk') : res.data?.reason || res.data?.message || t('cdnSite.nameBad'),
    };
  } finally {
    checkBusy.value = false;
  }
}

async function createSite() {
  if (!createForm.aid) return message.warning(t('cdnAccount.fillWarning'));
  if (!createForm.name.trim()) return message.warning(t('cdnSite.needName'));
  if (createIsEsa.value && !createForm.instanceId) return message.warning(t('cdnSite.needInstance'));
  createBusy.value = true;
  try {
    const body: Record<string, any> = { name: createForm.name.trim() };
    if (createIsEsa.value) {
      body.coverage = createForm.coverage;
      body.accessType = createForm.accessType;
      body.instanceId = createForm.instanceId;
    } else {
      body.type = createForm.type;
      body.area = createForm.area;
    }
    const res = await api<any>('POST', `/cdn/accounts/${createForm.aid}/sites`, body);
    if (res.code !== 0) return message.error(res.msg);
    message.success(res.msg || t('cdnSite.created'));
    showCreate.value = false;
    const zoneId = res.data?.zoneId || res.data?.SiteId;
    if (zoneId) router.push(`/cdn-zones/${createForm.aid}/${encodeURIComponent(String(zoneId))}`);
    else loadAll();
  } finally {
    createBusy.value = false;
  }
}

async function loadAll() {
  loadBusy.value = true;
  zoneList.value = [];
  try {
    if (!accounts.value.length) await loadAccounts();
    const qAid = Number(route.query.aid || 0);
    const targets = qAid
      ? accounts.value.filter((a: any) => a.id === qAid)
      : accounts.value;
    if (!targets.length) {
      // 无可用账户时回退到本地聚合接口
      const res = await api<any>('GET', '/cdn/zones');
      if (res.code === 0) {
        zoneList.value = (res.data || []).map((z: any) => ({ ...z, key: `${z.aid}:${z.zone_id}` }));
      } else {
        message.error(res.msg);
      }
      return;
    }
    // 全账户拉取云端站点（含尚未接入域名的站点）。账号多时限制 4 并发，
    // 避免浏览器同时排队几十个请求、抢占当前页面带宽。
    const results = new Array<any[]>(targets.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const i = cursor++;
        const a = targets[i];
        const res = await api<any>('GET', '/cdn/zones', { aid: a.id });
        results[i] = res.code === 0
          ? (res.data || []).map((z: any) => ({
              ...z,
              typename: z.typename || a.typename || a.type,
              accountName: a.name,
              key: `${z.aid ?? a.id}:${z.zone_id}`,
            }))
          : [];
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
    zoneList.value = results.flat();
  } finally {
    loadBusy.value = false;
  }
}

async function loadCfAccounts() {
  if (!isAdmin.value) return;
  const res = await api<any>('GET', '/cf-rules/accounts').catch(() => ({ code: -1, data: [] }));
  cfAccounts.value = res.code === 0 ? res.data || [] : [];
}

function openCfRules(a: any) {
  // 在 CDN 站点页内直接展开规则引擎，避免再跳转到独立页面
  cfPanelAid.value = Number(a.aid);
  cfPanelName.value = String(a.name || '');
  showCfPanel.value = true;
}

onMounted(async () => {
  await loadProviders();
  loadAll();
  loadCfAccounts();
});
</script>

<style scoped>
.create-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.create-name-row .n-input {
  flex: 1;
}

.zone-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.zone-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface-2);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
}
.zone-tile::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--app-primary), transparent 70%);
  opacity: 0;
  transition: opacity 0.18s ease;
}
.zone-tile:hover {
  border-color: color-mix(in srgb, var(--app-primary) 45%, var(--app-border));
  transform: translateY(-2px);
  box-shadow: var(--app-shadow, 0 8px 24px rgba(0, 0, 0, 0.08));
}
.zone-tile:hover::before {
  opacity: 1;
}
.zone-tile:active {
  transform: translateY(0) scale(0.995);
}
.zone-tile:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}

.zone-tile__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.zone-tile__name {
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-tile__sub {
  display: flex;
  align-items: center;
  gap: 6px;
}
.zone-tile__id {
  font-family: var(--app-font-mono);
  font-size: 12px;
  color: var(--app-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-tile__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zone-tile__account {
  font-size: 12px;
  color: var(--app-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-tile__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid var(--app-divider);
}
.zone-tile__domains {
  font-family: var(--app-font-mono);
  font-size: 12px;
  color: var(--app-text-3);
}

.cf-section {
  margin-top: 16px;
}
.cf-section__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.cf-section__hint {
  font-size: 12px;
  color: var(--app-text-3);
}
.cf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.cf-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface-2);
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
}
.cf-tile:hover {
  border-color: color-mix(in srgb, #f6821f 40%, var(--app-border));
  transform: translateY(-2px);
  box-shadow: var(--app-shadow);
}
.cf-tile:active {
  transform: translateY(0) scale(0.995);
}
.cf-tile:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}
.cf-tile__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cf-tile__name {
  font-weight: 600;
  font-size: 14px;
}
.cf-tile__meta {
  font-size: 12px;
  color: var(--app-text-3);
  display: flex;
  gap: 6px;
}
.cf-tile__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed var(--app-divider);
}
.cf-tile__label {
  font-size: 12px;
  color: var(--app-text-3);
}
@media (max-width: 767px) {
  .cf-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .cf-tile__foot :deep(.n-button) {
    min-height: 36px;
  }
}
</style>
