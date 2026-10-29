<template>
  <div class="app-stack">
    <PageHeader class="zone-header" :title="zoneTitle" :subtitle="t('cdnZoneSetting.subtitle')" back="/cdn-zones">
      <template #title-suffix>
        <n-tag v-if="vendorReady" class="zone-vendor-tag" size="small" :bordered="false">{{ isEsa ? t('cdnRules.vendEsa') : t('cdnRules.vendEo') }}</n-tag>
      </template>
    </PageHeader>

    <div v-if="vendorReady" class="zone-toolbar">
      <n-button size="small" :loading="loadBusy" @click="reloadAll">{{ t('cdnZoneSetting.refresh') }}</n-button>
      <ZoneModuleMenu
        :value="activeModule"
        :sub-value="activeSub"
        :items="activeModuleItems"
        :aria-label="t('esaZone.switchPage')"
        @select="onModuleSelect"
      />
    </div>

    <n-alert v-if="!aid || !zoneId" type="warning" :show-icon="false">{{ t('cdnZoneSetting.accountMissing') }}</n-alert>

    <!-- ESA：按官方控制台站点级菜单组织 -->
    <EsaZoneConsole
      v-else-if="isEsa"
      v-model:tab="esaTab"
      :subs="esaSub"
      :aid="aid"
      :zone-id="zoneId"
      :zone-info="zoneInfo"
      :domains="domains"
      :ns-list="nsList"
      @refresh="reloadAll"
    />

    <n-card v-else :bordered="false" class="zone-card">
      <!-- ============ 概览 ============ -->
        <template v-if="tab === 'overview'">
          <div class="zone-status-strip">
            <n-tag size="medium" :type="zoneInfo.paused ? 'warning' : 'success'" :bordered="false">{{ statusLabel }}</n-tag>
            <div class="zone-status-strip__id">
              <span class="zone-status-strip__name">{{ zoneInfo.zone_name || zoneInfo.name || zoneId }}</span>
              <span class="zone-status-strip__sub">{{ zoneId }}</span>
            </div>
            <div class="zone-status-strip__actions">
              <n-tag
                v-if="zoneInfo.ownershipVerified"
                type="success"
                :bordered="false"
                size="medium"
                class="ov-verified"
                :title="`identification=${zoneInfo.identificationStatus || '-'}, status=${zoneInfo.status || '-'}`"
              >
                <n-icon :component="CheckmarkCircleOutline" size="14" />
                {{ t('cdnZoneSetting.ovVerifiedBadge') }}
              </n-tag>
              <n-button v-else size="small" :loading="!!busy['verify']" :disabled="!!busy['verify']" @click="run('verify', verifyOwnership)">{{ t('cdnZoneSetting.ovVerify') }}</n-button>
              <n-button size="small" :type="zoneInfo.paused ? 'primary' : 'warning'" :loading="!!busy['pause']" :disabled="!!busy['pause']" @click="run('pause', togglePause)">
                {{ zoneInfo.paused ? t('cdnZoneSetting.ovResume') : t('cdnZoneSetting.ovPause') }}
              </n-button>
              <n-button size="small" type="error" quaternary @click="deleteZone">{{ t('cdnZoneSetting.ovDelete') }}</n-button>
            </div>
          </div>

          <div class="app-panel" style="margin-top: 12px">
            <DetailGrid
              :items="[
                { key: 'id', label: t('cdnZoneSetting.ovZoneId'), value: zoneId, mono: true },
                { key: 'name', label: t('cdnZoneSetting.ovZoneName'), value: zoneInfo.zone_name || zoneInfo.name },
                { key: 'status', label: t('cdnZoneSetting.ovStatus'), value: statusLabel },
                { key: 'area', label: t('cdnZoneSetting.ovArea'), value: areaLabel },
                { key: 'access', label: t('cdnZoneSetting.ovAccess'), value: accessTypeLabel },
                { key: 'domains', label: t('cdnZoneSetting.ovDomains'), value: zoneInfo.domain_count ?? 0, numeric: true },
              ]"
            />
          </div>

          <div v-if="isEsa" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.ovProperties') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" :loading="propsBusy" :disabled="propsBusy" @click="saveSiteProperties">
                  {{ t('cdnZoneSetting.ovSaveProps') }}
                </n-button>
              </div>
            </div>
            <n-form label-placement="left" label-width="130" size="small">
              <n-form-item :label="t('cdnZoneSetting.ovAccessType')">
                <EsaCardSelect v-model="propsForm.accessType" :options="accessTypeOptions" compact />
              </n-form-item>
              <n-form-item :label="t('cdnZoneSetting.ovCoverage')">
                <EsaCardSelect v-model="propsForm.coverage" :options="coverageOptions" compact />
              </n-form-item>
              <n-form-item :label="t('cdnZoneSetting.ovNameExclusive')">
                <n-switch v-model:value="propsForm.nameExclusive" size="small" />
              </n-form-item>
              <n-form-item :label="t('cdnZoneSetting.ovVersionManagement')">
                <n-tag size="small" :type="versionManagement ? 'success' : 'default'" :bordered="false">
                  {{ versionManagement ? t('cdnZoneSetting.ovEnabled') : t('cdnZoneSetting.ovDisabled') }}
                </n-tag>
              </n-form-item>
              <n-form-item v-if="!isCnameAccess" :label="t('cdnZoneSetting.ovVanityNs')">
                <n-input v-model:value="propsForm.vanityNs" :placeholder="t('cdnZoneSetting.ovVanityNsHint')" />
              </n-form-item>
            </n-form>
            <div class="zone-props-meta">
              <span>{{ t('cdnZoneSetting.ovPlan') }}: {{ siteProps.PlanName || '-' }}</span>
              <span>{{ t('cdnZoneSetting.ovInstance') }}: {{ siteProps.InstanceId || '-' }}</span>
              <span v-if="siteProps.CnameZone">{{ t('cdnZoneSetting.ovCnameZone') }}: {{ siteProps.CnameZone }}</span>
              <span v-if="siteProps.VerifyCode">{{ t('cdnZoneSetting.ovVerifyCode') }}: <span class="app-mono">{{ siteProps.VerifyCode }}</span></span>
              <span v-if="siteProps.CreateTime">{{ t('cdnZoneSetting.ovCreateTime') }}: {{ formatDateTime(siteProps.CreateTime) }}</span>
              <span v-if="siteProps.UpdateTime">{{ t('cdnZoneSetting.ovUpdateTime') }}: {{ formatDateTime(siteProps.UpdateTime) }}</span>
              <span v-if="siteProps.OfflineReason">{{ t('cdnZoneSetting.ovOfflineReason') }}: {{ siteProps.OfflineReason }}</span>
            </div>
          </div>

          <!-- CNAME 接入的站点没有 NS 可言，空面板会让人以为「没配好」 -->
          <div v-if="showNsPanel" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.ovNs') }}</h3>
            </div>
            <n-space v-if="nsList.length" :size="6">
              <n-tag v-for="ns in nsList" :key="ns" size="small" :bordered="false" class="app-mono">{{ ns }}</n-tag>
            </n-space>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.ovNsEmpty') }}</span>
          </div>

          <!-- EO 概览由站点列表接口直接给出，字段有限；给一排常去模块的直达入口填补留白 -->
          <div v-if="!isEsa" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.ovQuickNav') }}</h3>
            </div>
            <div class="zone-quick">
              <button
                v-for="m in quickModules"
                :key="m.key"
                type="button"
                class="zone-quick__item"
                @click="onModuleSelect(m.key)"
              >
                <span>{{ m.label }}</span>
                <n-icon :component="ArrowForwardOutline" size="14" />
              </button>
            </div>
          </div>
        </template>

        <!-- ============ 域名 ============ -->
        <template v-else-if="tab === 'domains'">
          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.domTitle') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ domains.length }}</n-tag>
              </div>
            </div>
            <ResponsiveDataTable
              :columns="domainColumns"
              :data="domains"
              size="small"
              :loading="loadBusy"
              :empty-text="t('cdnZoneSetting.domEmpty')"
            />
          </div>
        </template>

        <!-- ============ 源站与负载均衡 ============ -->
        <template v-else-if="tab === 'origin'">
          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnOrigin.originGroups') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ originGroups.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="ogForm.name" :placeholder="t('cdnOrigin.name')" style="width: 180px" size="small" />
              <n-input v-model:value="ogForm.hostHeader" :placeholder="t('cdnOrigin.hostHeader')" style="width: 180px" size="small" />
              <n-button size="small" type="primary" :loading="ogSaveBusy" @click="createOriginGroup">{{ t('cdnZoneSetting.create') }}</n-button>
              <n-input v-model:value="ogForm.records" type="textarea" :rows="3" :placeholder="t('cdnOrigin.recordsHint')" class="zone-form-strip__wide mono-input" />
              <n-input v-if="isEsa" v-model:value="ogForm.params" type="textarea" :rows="2" :placeholder="t('cdnOrigin.extraParamsHint')" class="zone-form-strip__wide mono-input" />
            </div>
            <ResponsiveDataTable :columns="ogColumns" :data="originGroups" size="small" :loading="loadBusy" :empty-text="t('cdnAdvanced.ogEmpty')" :empty-description="t('cdnAdvanced.ogEmptyHint')" />
          </div>

          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnOrigin.loadBalancers') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ loadBalancers.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="lbForm.name" :placeholder="t('cdnOrigin.name')" style="width: 180px" size="small" />
              <EsaCardSelect v-model="lbForm.type" :options="lbTypeOptions" dense style="width: 160px; flex: 0 0 160px" />
              <n-button size="small" type="primary" :loading="lbSaveBusy" @click="createLoadBalancer">{{ t('cdnZoneSetting.create') }}</n-button>
              <EsaCardSelect
                v-model="lbForm.originGroups"
                :options="ogOptions"
                :placeholder="t('cdnOrigin.originGroupsPick')"
                multiple
                searchable
                clearable
                dense
                class="zone-form-strip__wide"
              />
              <n-input v-if="isEsa" v-model:value="lbForm.params" type="textarea" :rows="2" :placeholder="t('cdnOrigin.extraParamsHint')" class="zone-form-strip__wide mono-input" />
            </div>
            <ResponsiveDataTable :columns="lbColumns" :data="loadBalancers" size="small" :loading="loadBusy" :empty-text="t('cdnAdvanced.lbEmpty')" :empty-description="t('cdnAdvanced.lbEmptyHint')" />
          </div>
        </template>

        <!-- ============ 规则引擎 ============ -->
        <template v-else-if="tab === 'rules'">
          <!-- ESA：按官方控制台分类组织规则类型，点击卡片切换当前规则集 -->
          <div v-if="isEsa" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnRules.manage') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" @click="loadRules">{{ t('cdnZoneSetting.refresh') }}</n-button>
                <n-button size="small" type="primary" @click="showKindPicker = true">
                  {{ t('cdnRules.createRule') }}
                </n-button>
              </div>
            </div>

            <div class="esa-rules__cats">
              <button
                v-for="cat in ESA_RULE_CATEGORIES"
                :key="cat.key"
                type="button"
                class="esa-rules__cat"
                :class="{ 'esa-rules__cat--active': esaCategory === cat.key }"
                :title="esaCatDesc(cat)"
                @click="selectEsaCategory(cat.key)"
              >
                <span class="esa-rules__cat-title">{{ esaCatLabel(cat) }}</span>
                <span class="esa-rules__cat-desc">{{ esaCatDesc(cat) }}</span>
              </button>
            </div>

            <div class="esa-rules__kinds">
              <button
                v-for="k in esaKindsOfCategory(esaCategory)"
                :key="k.kind"
                type="button"
                class="esa-rules__kind"
                :class="{ 'esa-rules__kind--active': ruleKind === k.kind }"
                @click="selectEsaKind(k.kind)"
              >
                <span class="esa-rules__kind-title">{{ esaKindLabel(k) }}</span>
                <span class="esa-rules__kind-desc">{{ esaKindDesc(k) }}</span>
                <code class="esa-rules__kind-code">{{ k.kind }}</code>
              </button>
            </div>

            <div class="esa-rules__current">
              <span>{{ t('cdnRules.colKind') }}：</span>
              <n-tag size="small" :bordered="false" type="info">{{ kindLabel(ruleKind) }}</n-tag>
            </div>

            <ResponsiveDataTable
              :columns="ruleColumns"
              :data="ruleList"
              size="small"
              :loading="ruleLoadBusy"
              :empty-text="t('cdnRules.empty')"
            />
          </div>

          <!-- EO：保持原有单列表 + 类型下拉 -->
          <div v-else class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnRules.manage') }}</h3>
              <div class="app-panel__extra">
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
              :loading="ruleLoadBusy"
              :empty-text="t('cdnRules.empty')"
            />
          </div>
        </template>

        <!-- ============ 安全 ============ -->
        <template v-else-if="tab === 'security'">
          <div v-if="caps.securityIpGroup" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnSecurity.ipGroups') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ ipGroups.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="ipForm.name" :placeholder="t('cdnSecurity.name')" style="width: 200px" size="small" />
              <n-button size="small" type="primary" :loading="ipSaveBusy" @click="createIpGroup">{{ t('cdnZoneSetting.create') }}</n-button>
              <n-input v-model:value="ipForm.content" type="textarea" :rows="3" :placeholder="t('cdnSecurity.contentHint')" class="zone-form-strip__wide mono-input" />
            </div>
            <ResponsiveDataTable :columns="ipColumns" :data="ipGroups" size="small" :loading="loadBusy" :empty-text="t('cdnAdvanced.ipEmpty')" :empty-description="t('cdnAdvanced.ipEmptyHint')" />
          </div>

          <div v-for="cfg in securityCfgs.filter((c) => caps[c.cap])" :key="cfg.key" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ cfg.title }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" :loading="!!busy['secload:' + cfg.key]" :disabled="!!busy['secload:' + cfg.key]" @click="run('secload:' + cfg.key, () => loadSecurityConfig(cfg.key))">{{ t('cdnSecurity.load') }}</n-button>
                <n-button size="small" type="primary" :loading="!!busy['secsave:' + cfg.key]" :disabled="!!busy['secsave:' + cfg.key]" @click="run('secsave:' + cfg.key, () => saveSecurityConfig(cfg.key))">{{ t('cdnZoneSetting.save') }}</n-button>
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
        </template>

        <!-- ============ 四层代理 ============ -->
        <template v-else-if="caps.l4 && tab === 'l4'">
          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.tabL4') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ l4Proxies.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="l4Form.name" :placeholder="t('cdnAdvanced.name')" style="width: 180px" size="small" />
              <n-input v-model:value="l4Form.area" :placeholder="t('cdnAdvanced.area')" style="width: 140px" size="small" />
              <n-button size="small" type="primary" :loading="l4Saving" @click="createL4Proxy">{{ t('cdnZoneSetting.create') }}</n-button>
              <n-input v-if="isEsa" v-model:value="l4Form.params" type="textarea" :rows="2" :placeholder="t('cdnAdvanced.extraParamsHint')" class="zone-form-strip__wide mono-input" />
            </div>
            <ResponsiveDataTable :columns="l4Columns" :data="l4Proxies" size="small" :loading="loadBusy" :empty-text="t('cdnAdvanced.l4Empty')" :empty-description="t('cdnAdvanced.l4EmptyHint')" />
          </div>
        </template>

        <!-- ============ 任务与统计 ============ -->
        <template v-else-if="caps.tasks && tab === 'tasks'">
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
        </template>

        <!-- ============ 全局配置 ============ -->
        <template v-else-if="tab === 'global'">
          <CdnZoneGlobalSetting :aid="aid" :zone-id="zoneId" @go-rules="tab = 'rules'" />
        </template>
    </n-card>

    <!-- EO 规则：新建方式（官方预制 / 本项目预制 / 空白）与编辑器；ESA 规则由 EsaZoneConsole 内部管理 -->
    <template v-if="!isEsa">
      <RuleCreatePicker v-model:show="showCreatePicker" @select="selectCreateSource" />
      <RuleTemplatePicker v-model:show="showTemplatePicker" :source="pickerSource" @select="selectTemplate" />
      <EsaRuleKindPicker
        v-model:show="showKindPicker"
        :locale="String(locale || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'"
        @select="onPickEsaKind"
      />

      <n-modal
        v-model:show="showRuleEditor"
        preset="card"
        :title="ruleEditingId ? t('cdnRules.editRule') : t('cdnRules.createRule')"
        class="modal-lg"
        :mask-closable="false"
      >
        <RuleEditor
          v-if="showRuleEditor"
          vendor="eo"
          :kind="ruleKind"
          :schema="ruleSchema"
          :initial="ruleInitial"
          :editing="!!ruleEditingId"
          :saving="ruleSaveBusy"
          :domains="siteDomains"
          @save="saveRule"
          @cancel="showRuleEditor = false"
        />
      </n-modal>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDialog, useMessage, NButton, NTag } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { ArrowForwardOutline, CheckmarkCircleOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import { zoneAreaKey } from '../lib/zoneLabels';
import DetailGrid from '../components/DetailGrid.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import RuleEditor from '../components/cdn/RuleEditor.vue';
import RuleTemplatePicker from '../components/cdn/RuleTemplatePicker.vue';
import RuleCreatePicker, { type RuleCreateSource } from '../components/cdn/RuleCreatePicker.vue';
import EsaRuleKindPicker from '../components/cdn/EsaRuleKindPicker.vue';
import ZoneModuleMenu, { type ZoneModuleMenuItem } from '../components/cdn/ZoneModuleMenu.vue';
import EsaZoneConsole from '../components/cdn/EsaZoneConsole.vue';
import CdnZoneGlobalSetting from '../components/cdn/CdnZoneGlobalSetting.vue';
import EsaCardSelect from '../components/cdn/EsaCardSelect.vue';
import { useAction } from '../composables/useAction';
import { formatDateTime } from '../lib/datetime';
import { ruleEnabled } from '../lib/cdnSwitch';
import { EO_RULE_TEMPLATES } from '../lib/eoRuleTemplates';
import { EO_PRESET_RULES } from '../lib/eoPresetRules';
import { ESA_RULE_CATEGORIES, esaKindsOfCategory, esaKindMeta, type EsaRuleCategory, type EsaRuleKindMeta } from '../lib/esaRuleMeta';
import { EO_ZONE_TABS, ESA_ZONE_TABS } from '../lib/zoneTabs';

const { t, locale } = useI18n();
const message = useMessage();
const dialog = useDialog();
const { busy, run } = useAction();
const route = useRoute();
const router = useRouter();

const aid = Number(route.params.aid || 0);
const zoneId = String(route.params.zoneId || '');
const tab = ref('overview');
const esaTab = ref('overview');
const esaSub = reactive<Record<string, string>>({});
for (const tabDef of ESA_ZONE_TABS) {
  if (tabDef.children?.length) esaSub[tabDef.key] = tabDef.defaultChild || tabDef.children[0].key;
}
const loadBusy = ref(false);

const providers = ref<Record<string, any>>({});
const accountType = ref('');
const zoneInfo = ref<Record<string, any>>({});
const domains = ref<any[]>([]);
/** /sites/{id}/ns 的返回值；为空时回退到站点列表里的 nameServers */
const nsFromApi = ref<string[]>([]);
const nsList = computed<string[]>(() => {
  if (nsFromApi.value.length) return nsFromApi.value;
  const raw = (zoneInfo.value as any)?.nameServers;
  return Array.isArray(raw) ? raw.filter((x: any) => typeof x === 'string' && x.trim()) : [];
});

const isEsa = computed(() => accountType.value === 'aliyun_esa' || String(zoneInfo.value.route || '') === 'aliyun_esa');
const providerMeta = computed(() => providers.value[String(zoneInfo.value.route || accountType.value || '')] || {});
const caps = computed<Record<string, boolean>>(() => providerMeta.value.capabilities || {});

// 供应商无关的功能页导航：ESA 与 EO 共用同一个下拉菜单组件，仅数据源不同
const vendorReady = computed(() => !!(accountType.value || zoneInfo.value.route));
const esaTabItems = computed<ZoneModuleMenuItem[]>(() =>
  ESA_ZONE_TABS.map((item) => ({
    key: item.key,
    label: t(item.labelKey),
    defaultChild: item.defaultChild,
    children: item.children?.map((child) => ({
      key: child.key,
      label: child.labelKey ? t(child.labelKey) : child.label || child.key,
      gate: child.gate,
    })),
  })),
);
const eoTabItems = computed<ZoneModuleMenuItem[]>(() =>
  EO_ZONE_TABS.filter((item) => (item.key !== 'l4' || caps.value.l4) && (item.key !== 'tasks' || caps.value.tasks)).map((item) => ({
    key: item.key,
    label: t(item.labelKey),
  })),
);
const quickModules = computed(() =>
  eoTabItems.value.filter((m) => m.key !== 'overview' && m.key !== 'global'),
);

const activeModule = computed(() => (isEsa.value ? esaTab.value : tab.value));
const activeSub = computed(() => (isEsa.value ? esaSub[esaTab.value] || '' : ''));
const activeModuleItems = computed<ZoneModuleMenuItem[]>(() => (isEsa.value ? esaTabItems.value : eoTabItems.value));

function onModuleSelect(key: string, sub?: string) {
  if (isEsa.value) {
    if (sub) esaSub[key] = sub;
    esaTab.value = key;
  } else {
    tab.value = key;
  }
}

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
const siteProps = ref<Record<string, any>>({});
const propsBusy = ref(false);
const propsForm = reactive<any>({ accessType: 'NS', coverage: 'domestic', nameExclusive: false, vanityNs: '' });
const versionManagement = computed(() => siteProps.value.versionManagement === true || siteProps.value.versionManagement === 'true' || siteProps.value.VersionManagement === true);
const accessTypeOptions = computed(() => [
  { label: t('cdnSite.accessNS'), value: 'NS' },
  { label: t('cdnSite.accessCNAME'), value: 'CNAME' },
]);
const coverageOptions = computed(() => [
  { label: t('cdnSite.coverageDomestic'), value: 'domestic' },
  { label: t('cdnSite.coverageGlobal'), value: 'global' },
  { label: t('cdnSite.coverageOverseas'), value: 'overseas' },
]);
// 非 ESA 站点的 type 是 API 原值（partial / full），直接透出看不出接入方式
const accessTypeLabel = computed(() => {
  if (isEsa.value) {
    return siteProps.value.accessType || siteProps.value.AccessType || zoneInfo.value.accessType || '-';
  }
  const type = String(zoneInfo.value.type || '').toLowerCase();
  if (type === 'partial') return t('cdnSite.typePartial');
  if (type === 'full') return t('cdnSite.typeFull');
  return zoneInfo.value.type || '-';
});

const areaLabel = computed(() => {
  const key = zoneAreaKey(zoneInfo.value.area);
  return key ? t(`common.${key}`) : zoneInfo.value.area || '-';
});

/**
 * 是否 CNAME 接入。
 * EO 的 `type` 为 partial/full；ESA 用 accessType（NS/CNAME）。
 * 未知取值一律按「非 CNAME」处理——宁可多显示，也不要把有用的面板藏掉。
 */
const isCnameAccess = computed(() => {
  if (!isEsa.value) {
    const type = String(zoneInfo.value.type || '').toLowerCase();
    return type === 'partial' || type === 'cname';
  }
  const access = String(
    siteProps.value.accessType || siteProps.value.AccessType || zoneInfo.value.accessType || '',
  ).toUpperCase();
  return access === 'CNAME';
});

const showNsPanel = computed(() => nsList.value.length > 0 || !isCnameAccess.value);

// ===================== 数据加载 =====================
async function loadProviders() {
  const [p, a] = await Promise.all([
    api<any>('GET', '/cdn/providers'),
    api<any>('GET', '/cdn/accounts'),
  ]);
  if (p.code === 0) providers.value = p.data || {};
  if (a.code === 0) accountType.value = String((a.data || []).find((x: any) => Number(x.id) === aid)?.type || '');
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
  // 由后端按账户 + 站点过滤，替代拉全量后在本地筛选
  const res = await api<any>('GET', '/cdn/domains', { aid, zone_id: zoneId });
  if (res.code === 0) domains.value = res.data || [];
}
async function loadNs() {
  if (!zoneId) return;
  const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/ns`);
  nsFromApi.value = res.code === 0 && Array.isArray(res.data) ? res.data : [];
}

async function loadSiteProperties(): Promise<boolean> {
  if (!isEsa.value || !zoneId) return true;
  const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/properties`);
  if (res.code !== 0) return false;
  const d = res.data || {};
  siteProps.value = {
    ...d,
    PlanName: d.PlanName ?? d.planName ?? '',
    InstanceId: d.InstanceId ?? d.instanceId ?? '',
    CnameZone: d.CnameZone ?? d.cnameZone ?? '',
    VerifyCode: d.VerifyCode ?? d.verifyCode ?? '',
    CreateTime: d.CreateTime ?? d.createTime ?? '',
    UpdateTime: d.UpdateTime ?? d.updateTime ?? '',
    OfflineReason: d.OfflineReason ?? d.offlineReason ?? '',
  };
  propsForm.accessType = siteProps.value.accessType || siteProps.value.AccessType || 'NS';
  propsForm.coverage = siteProps.value.area || siteProps.value.Coverage || 'domestic';
  propsForm.nameExclusive = siteProps.value.nameExclusive === true;
  propsForm.vanityNs = Array.isArray(siteProps.value.vanityNs) ? siteProps.value.vanityNs.join(',') : '';
  return true;
}

async function saveSiteProperties() {
  propsBusy.value = true;
  try {
    const res = await api<any>('PUT', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}`, {
      accessType: propsForm.accessType,
      coverage: propsForm.coverage,
      nameExclusive: propsForm.nameExclusive,
      vanityNs: propsForm.vanityNs,
    });
    if (res.code === 0) {
      message.success(t('cdnZoneSetting.ovPropsSaved'));
      await Promise.all([loadSiteProperties(), loadZoneInfo(), loadNs()]);
    } else message.error(res.msg);
  } finally {
    propsBusy.value = false;
  }
}

// ===================== 概览操作 =====================
async function verifyOwnership() {
  const res = await api<any>('POST', `/cdn/accounts/${aid}/sites/verify`, { zoneId, domain: zoneInfo.value.zone_name || zoneInfo.value.name });
  if (res.code === 0) {
    message.success(t('cdnZoneSetting.ovVerified'));
    await loadZoneInfo();
  } else message.error(res.msg);
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
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => router.push(`/cdn-domains/${r.id}/setting`) }, { default: () => t('cdnZoneSetting.domOpen') }),
  },
]);

// ===================== 源站与负载均衡 =====================
const originGroups = ref<any[]>([]);
const loadBalancers = ref<any[]>([]);
const ogSaveBusy = ref(false);
const lbSaveBusy = ref(false);
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
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 90, render: (r: any) => h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delOriginGroup(r) }, { default: () => t('cdnZoneSetting.delete') }) },
]);
const lbColumns = computed(() => [
  { title: t('cdnOrigin.colName'), key: 'name', minWidth: 140 },
  { title: t('cdnOrigin.colType'), key: 'type', width: 120 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 90, render: (r: any) => h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delLoadBalancer(r) }, { default: () => t('cdnZoneSetting.delete') }) },
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
async function loadOriginData(): Promise<boolean> {
  const [og, lb] = await Promise.all([
    api<any>('GET', `/cdn/accounts/${aid}/origin-groups`, { zoneId, page: 1, size: 100 }),
    api<any>('GET', `/cdn/accounts/${aid}/load-balancers`, { zoneId, page: 1, size: 100 }),
  ]);
  originGroups.value = og.code === 0 ? og.data?.list || [] : [];
  loadBalancers.value = lb.code === 0 ? lb.data?.list || [] : [];
  return og.code === 0 && lb.code === 0;
}
async function createOriginGroup() {
  if (!ogForm.name) return message.warning(t('cdnOrigin.needName'));
  const records = parseRecords(ogForm.records);
  if (!records.length) return message.warning(t('cdnOrigin.needRecords'));
  ogSaveBusy.value = true;
  const res = await api<any>('POST', `/cdn/accounts/${aid}/origin-groups`, {
    zoneId,
    name: ogForm.name,
    records,
    hostHeader: ogForm.hostHeader || undefined,
    params: parseExtraParams(ogForm.params),
  });
  ogSaveBusy.value = false;
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
  lbSaveBusy.value = true;
  const originGroupsPayload = (lbForm.originGroups || []).map((gid: string, i: number) => ({ Priority: String(i + 1), OriginGroupId: String(gid) }));
  const res = await api<any>('POST', `/cdn/accounts/${aid}/load-balancers`, {
    zoneId,
    name: lbForm.name,
    type: lbForm.type,
    originGroups: originGroupsPayload,
    params: parseExtraParams(lbForm.params),
  });
  lbSaveBusy.value = false;
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
const ruleLoadBusy = ref(false);
const ruleSaveBusy = ref(false);
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
/** ESA：官方 Rules 分类与规则类型选择 */
const esaCategory = ref('https');
const showKindPicker = ref(false);
const isZhLocale = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

function esaCatLabel(cat: EsaRuleCategory) {
  return isZhLocale.value ? cat.label.zh : cat.label.en;
}
function esaCatDesc(cat: EsaRuleCategory) {
  return isZhLocale.value ? cat.desc.zh : cat.desc.en;
}
function esaKindLabel(k: EsaRuleKindMeta) {
  return isZhLocale.value ? k.label.zh : k.label.en;
}
function esaKindDesc(k: EsaRuleKindMeta) {
  return isZhLocale.value ? k.desc.zh : k.desc.en;
}
/** 切换官方分类时，默认选中该分类下第一个规则类型 */
function selectEsaCategory(key: string) {
  esaCategory.value = key;
  const first = esaKindsOfCategory(key)[0];
  if (first) selectEsaKind(first.kind);
}
function selectEsaKind(kind: string) {
  ruleKind.value = kind;
  loadRules();
}
/** 从「新建规则」卡片选择类型：先同步分类，再切换并打开编辑器 */
function onPickEsaKind(kind: string) {
  const meta = esaKindMeta(kind);
  if (meta) esaCategory.value = meta.category;
  ruleKind.value = kind;
  showKindPicker.value = false;
  loadRuleSchemaForKind().then(() => {
    loadRules();
    openRuleEditor(null);
  });
}

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
async function loadRules(): Promise<boolean> {
  ruleLoadBusy.value = true;
  let ok = true;
  try {
    if (isEsa.value) await loadRuleSchemaForKind();
    if (isEsa.value) {
      // ESA 规则按 kind 分页，单页 100；循环取全量，避免规则较多时列表被截断
      const all: any[] = [];
      for (let page = 1; page <= 20; page++) {
        const res = await api<any>('GET', `/cdn/accounts/${aid}/rule-configs`, { zoneId, kind: ruleKind.value, page, size: 100 });
        if (res.code !== 0) {
          ok = false;
          break;
        }
        const l = res.data?.list || [];
        all.push(...l);
        const total = Number(res.data?.total || 0);
        if (l.length < 100 || all.length >= total) break;
      }
      ruleList.value = all;
    } else {
      const res = await api<any>('GET', `/cdn/accounts/${aid}/rules`, { zoneId });
      ok = res.code === 0;
      ruleList.value = ok ? res.data || [] : [];
    }
  } finally {
    ruleLoadBusy.value = false;
  }
  return ok;
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
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openRuleEditor(r) }, { default: () => t('cdnZoneSetting.edit') }),
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            loading: !!busy[`rule:${r.ruleId || r.ruleName}`],
            disabled: !!busy[`rule:${r.ruleId || r.ruleName}`],
            onClick: () => run(`rule:${r.ruleId || r.ruleName}`, () => toggleRuleEnabled(r)),
          },
          { default: () => (ruleEnabled(r) ? t('cdnRules.disabledTag') : t('cdnRules.enabledTag')) },
        ),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delRule(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
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
  ruleSaveBusy.value = true;
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
  ruleSaveBusy.value = false;
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
const ipSaveBusy = ref(false);
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
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => loadIpContent(r) }, { default: () => t('cdnSecurity.load') }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delIpGroup(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
  },
]);
function secRoute(key: string) {
  return key === 'originProtection' ? 'origin-protection' : key;
}
async function loadSecurity(): Promise<boolean> {
  // 各安全配置相互独立：并行拉取，替代 3 次串行等待
  const tasks: Promise<boolean>[] = [];
  if (caps.value.securityIpGroup) {
    tasks.push(
      (async () => {
        const res = await api<any>('GET', `/cdn/accounts/${aid}/security/ip-groups`, { zoneId });
        ipGroups.value = res.code === 0 ? res.data : [];
        return res.code === 0;
      })(),
    );
  }
  for (const cfg of securityCfgs) if (caps.value[cfg.cap]) tasks.push(loadSecurityConfig(cfg.key, true));
  const results = await Promise.all(tasks);
  return results.every(Boolean);
}
async function loadSecurityConfig(key: string, silent = false): Promise<boolean> {
  const res = await api<any>('GET', `/cdn/accounts/${aid}/security/${secRoute(key)}`, { zoneId });
  if (res.code === 0) secJson[key] = JSON.stringify(res.data, null, 2);
  else if (!silent) message.error(res.msg);
  return res.code === 0;
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
  ipSaveBusy.value = true;
  const res = await api<any>('POST', `/cdn/accounts/${aid}/security/ip-groups`, { zoneId, name: ipForm.name, content });
  ipSaveBusy.value = false;
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
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delL4Proxy(r) }, { default: () => t('cdnZoneSetting.delete') }),
  },
]);
async function loadL4Proxies(): Promise<boolean> {
  if (!caps.value.l4) return true;
  const res = await api<any>('GET', `/cdn/accounts/${aid}/l4-proxies`, { zoneId, page: 1, size: 100 });
  l4Proxies.value = res.code === 0 ? res.data?.list || [] : [];
  return res.code === 0;
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
  { title: t('cdnAccount.addTime'), key: 'createTime', minWidth: 160, render: (row: any) => formatDateTime(row.createTime) },
]);
async function loadTasks(): Promise<boolean> {
  if (!caps.value.tasks) return true;
  const [p, pf] = await Promise.all([
    api<any>('GET', `/cdn/accounts/${aid}/tasks/purge`, { zoneId, page: 1, size: 50 }),
    api<any>('GET', `/cdn/accounts/${aid}/tasks/prefetch`, { zoneId, page: 1, size: 50 }),
  ]);
  purgeTasks.value = p.code === 0 ? p.data?.list || [] : [];
  prefetchTasks.value = pf.code === 0 ? pf.data?.list || [] : [];
  return p.code === 0 && pf.code === 0;
}
async function loadQuota() {
  const res = await api<any>('GET', isEsa.value ? `/cdn/accounts/${aid}/quota/purge` : `/cdn/accounts/${aid}/quota/content`, { zoneId, type: 'file' });
  if (res.code === 0) quotaText.value = JSON.stringify(res.data, null, 2);
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

// ===================== 汇总 =====================
// 记录已加载的 tab：来回切换时跳过重复请求（reloadAll 或主动刷新时强制重载）。
// 仅在加载成功时记录，避免首次失败后反复切 tab 永不重试。
const loadedTabs = new Set<string>();
async function loadByTab(name: string, force = false) {
  if (!force && loadedTabs.has(name)) return;
  let ok = true;
  if (name === 'origin') ok = await loadOriginData();
  else if (name === 'rules') ok = await loadRules();
  else if (name === 'security') ok = await loadSecurity();
  else if (name === 'l4') ok = await loadL4Proxies();
  else if (name === 'tasks') ok = await loadTasks();
  if (ok) loadedTabs.add(name);
}
async function reloadAll() {
  loadedTabs.clear();
  loadBusy.value = true;
  try {
    await Promise.all([loadZoneInfo(), loadDomains(), loadNs(), loadSiteProperties()]);
  } finally {
    loadBusy.value = false;
  }
  await loadByTab(tab.value, true);
}
watch(tab, (v) => loadByTab(v));

onMounted(async () => {
  if (!aid || !zoneId) return;
  loadBusy.value = true;
  try {
    // 先确定账户类型（ESA 属性接口只在 ESA 站点上调用），其余请求再并行
    await loadProviders();
    await Promise.all([loadZoneInfo(), loadDomains(), loadNs(), loadRuleSchema(), loadSiteProperties()]);
  } finally {
    loadBusy.value = false;
  }
});
</script>

<style scoped>
.zone-quick {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}
.zone-quick__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-panel-sunken);
  color: var(--app-text-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s var(--app-ease), background 0.2s var(--app-ease), color 0.2s var(--app-ease);
}
.zone-quick__item:hover {
  background: var(--app-surface);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  color: var(--app-text);
}
.zone-quick__item:hover :deep(.n-icon) {
  color: var(--app-primary);
  transform: translateX(2px);
}
.zone-quick__item :deep(.n-icon) {
  color: var(--app-text-3);
  transition: color 0.2s var(--app-ease), transform 0.2s var(--app-ease);
}

.zone-header :deep(.page-header__left) {
  flex: 1 1 auto;
  min-width: 0;
}

.zone-header :deep(.page-header__text) {
  flex: 1 1 auto;
  min-width: 0;
}

.zone-header :deep(.page-header__title) {
  width: 100%;
}

.zone-vendor-tag {
  margin-left: auto;
  flex-shrink: 0;
}

@media (max-width: 767px) {
  :deep(.page-header__actions) {
    flex-wrap: wrap;
    overflow-x: visible;
  }

  .zone-header :deep(.page-header__left) {
    width: 100%;
  }

  .zone-header :deep(.page-header__title) {
    font-size: 17px;
    gap: 8px;
  }

  .zone-vendor-tag {
    font-size: 11px;
    height: 20px;
    padding: 0 5px;
  }
}

.ov-verified {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.zone-props-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--app-divider);
  color: var(--app-text-3);
  font-size: 12px;
}

/* ESA 规则：官方分类 + 规则类型卡片墙 */
.esa-rules__cats {
  /* 同上：flex 横排在窄容器下会裁掉末张卡，改为自适应网格 */
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.esa-rules__cat {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.18s var(--app-ease), background 0.18s var(--app-ease);
}
.esa-rules__cat:hover {
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
}
.esa-rules__cat--active {
  border-color: color-mix(in srgb, var(--app-primary) 55%, var(--app-border));
  background: color-mix(in srgb, var(--app-primary) 8%, var(--app-surface));
}
.esa-rules__cat-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--app-text-1);
  white-space: nowrap;
}
.esa-rules__cat-desc {
  max-width: 100%;
  font-size: 11px;
  color: var(--app-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.esa-rules__kinds {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.esa-rules__kind {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: flex-start;
  text-align: left;
  padding: 12px 13px 10px 16px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.18s var(--app-ease), border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.esa-rules__kind::before {
  content: '';
  position: absolute;
  left: 0;
  top: 11px;
  bottom: 11px;
  width: 3px;
  border-radius: 3px;
  background: var(--app-primary);
  opacity: 0;
  transition: opacity 0.18s var(--app-ease);
}
.esa-rules__kind:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.esa-rules__kind:hover::before,
.esa-rules__kind--active::before {
  opacity: 1;
}
.esa-rules__kind--active {
  border-color: color-mix(in srgb, var(--app-primary) 55%, var(--app-border));
  background: color-mix(in srgb, var(--app-primary) 6%, var(--app-surface));
}
.esa-rules__kind-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-rules__kind-desc {
  font-size: 12px;
  line-height: 1.55;
  color: var(--app-text-2);
}
.esa-rules__kind-code {
  font-family: var(--app-font-mono);
  font-size: 10.5px;
  color: var(--app-text-3);
}
.esa-rules__current {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--app-text-3);
}
</style>
