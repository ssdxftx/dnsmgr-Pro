<template>
  <div class="app-stack">
    <PageHeader class="zone-header" :title="zoneTitle" :subtitle="t('cdnZoneSetting.subtitle')" back="/cdn-zones">
      <template #title-suffix>
        <n-tag v-if="vendorReady" class="zone-vendor-tag" size="small" :bordered="false">{{ isEsa ? t('cdnRules.vendEsa') : t('cdnRules.vendEo') }}</n-tag>
      </template>
    </PageHeader>

    <div v-if="vendorReady" class="zone-toolbar">
      <n-button size="small" :loading="loadBusy" @click="reloadAll">{{ t('cdnZoneSetting.refresh') }}</n-button>
      <template v-if="!isEsa">
        <n-button size="small" :loading="exportBusy" :disabled="exportBusy" @click="exportZoneConfig">{{ t('cdnZoneSetting.exportConfig') }}</n-button>
        <n-button size="small" @click="openImport">{{ t('cdnZoneSetting.importConfig') }}</n-button>
      </template>
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
      :key="esaReloadKey"
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

          <div v-if="!isEsa && !zoneInfo.planId" class="app-panel" style="margin-top: 12px">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.ovBindPlan') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" :loading="bindPlanBusy" :disabled="bindPlanBusy || !bindPlanForm.planId" @click="bindPlan">{{ t('cdnZoneSetting.ovBindPlan') }}</n-button>
              </div>
            </div>
            <div class="zone-form-strip">
              <EsaCardSelect
                v-model="bindPlanForm.planId"
                :options="zonePlanOptions"
                :placeholder="t('cdnZoneSetting.ovPlanPlaceholder')"
                searchable
                clearable
                dense
                class="zone-form-strip__wide"
              />
            </div>
            <span class="hint-text">{{ t('cdnZoneSetting.ovPlanMissingHint') }}</span>
          </div>

          <div class="app-panel" style="margin-top: 12px">
            <DetailGrid
              :items="[
                { key: 'id', label: t('cdnZoneSetting.ovZoneId'), value: zoneId, mono: true },
                { key: 'name', label: t('cdnZoneSetting.ovZoneName'), value: zoneInfo.zone_name || zoneInfo.name },
                { key: 'status', label: t('cdnZoneSetting.ovStatus'), value: statusLabel },
                { key: 'area', label: t('cdnZoneSetting.ovArea'), value: areaLabel },
                { key: 'access', label: t('cdnZoneSetting.ovAccess'), value: accessTypeLabel },
                ...(zoneInfo.planId ? [{ key: 'plan', label: t('cdnZoneSetting.ovPlan'), value: zoneInfo.planName ? `${zoneInfo.planName} · ${zoneInfo.planId}` : zoneInfo.planId }] : []),
                { key: 'domains', label: t('cdnZoneSetting.ovDomains'), value: zoneInfo.domain_count ?? 0, numeric: true },
              ]"
            />
          </div>

          <div v-if="!isEsa" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.ovProperties') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" :loading="eoPropsBusy" :disabled="eoPropsBusy" @click="saveEoProperties">
                  {{ t('cdnZoneSetting.ovSaveProps') }}
                </n-button>
              </div>
            </div>
            <n-form label-placement="left" label-width="130" size="small">
              <n-form-item :label="t('cdnZoneSetting.ovAccessType')">
                <EsaCardSelect v-model="eoPropsForm.type" :options="eoAccessTypeOptions" compact />
              </n-form-item>
              <n-form-item :label="t('cdnZoneSetting.ovCoverage')">
                <EsaCardSelect v-model="eoPropsForm.area" :options="eoAreaOptions" compact />
              </n-form-item>
              <n-form-item :label="t('cdnZoneSetting.ovAliasZoneName')">
                <n-input v-model:value="eoPropsForm.aliasZoneName" :placeholder="t('cdnZoneSetting.ovAliasZoneNameHint')" />
              </n-form-item>
              <n-form-item :label="t('cdnZoneSetting.ovVanityNs')">
                <n-input v-model:value="eoPropsForm.vanityNs" :placeholder="t('cdnZoneSetting.ovVanityNsHint')" />
              </n-form-item>
            </n-form>
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

          <div v-if="caps.sharedCname" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.sharedCname') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ sharedCnames.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="sharedForm.prefix" :placeholder="t('cdnZoneSetting.sharedCnamePrefix')" style="width: 200px" size="small" />
              <n-input v-model:value="sharedForm.description" :placeholder="t('cdnZoneSetting.sharedCnameDesc')" style="width: 220px" size="small" />
              <n-button size="small" type="primary" :loading="sharedSaving" @click="createSharedCname">{{ t('cdnZoneSetting.create') }}</n-button>
            </div>
            <ResponsiveDataTable
              :columns="sharedCnameColumns"
              :data="sharedCnames"
              size="small"
              :loading="domainsBusy"
              :empty-text="t('cdnZoneSetting.sharedCnameEmpty')"
            />
          </div>

          <div v-if="caps.aliasDomain" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.aliasDomains') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ aliasDomains.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="aliasForm.aliasName" :placeholder="t('cdnZoneSetting.aliasName')" style="width: 180px" size="small" />
              <n-input v-model:value="aliasForm.targetName" :placeholder="t('cdnZoneSetting.targetName')" style="width: 180px" size="small" />
              <n-select v-model:value="aliasForm.certType" :options="aliasCertOptions" size="small" style="width: 130px" />
              <n-button size="small" type="primary" :loading="aliasSaving" @click="createAliasDomain">{{ t('cdnZoneSetting.create') }}</n-button>
            </div>
            <ResponsiveDataTable
              :columns="aliasColumns"
              :data="aliasDomains"
              size="small"
              :loading="domainsBusy"
              :empty-text="t('cdnZoneSetting.aliasEmpty')"
            />
          </div>
        </template>

        <!-- ============ 源站与负载均衡 ============ -->
        <template v-else-if="tab === 'origin'">
          <CdnZoneOriginTab
            :aid="aid"
            :zone-id="zoneId"
            :is-esa="isEsa"
            :load-balancer-health="caps.loadBalancerHealth"
            :reload-key="originReloadKey"
          />
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
              :pagination="rulePagination"
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
              :pagination="rulePagination"
            />
          </div>

          <div v-if="!isEsa" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.customVariables') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" :loading="customVarsLoading" :disabled="customVarsLoading" @click="loadCustomVariables">{{ t('cdnSecurity.load') }}</n-button>
                <n-button size="small" type="primary" :loading="customVarsSaving" :disabled="customVarsSaving" @click="saveCustomVariables">{{ t('cdnZoneSetting.save') }}</n-button>
              </div>
            </div>
            <n-input
              v-model:value="customVarsText"
              type="textarea"
              :rows="10"
              :placeholder="t('cdnZoneSetting.customVariablesHint')"
              class="mono-input"
              spellcheck="false"
            />
          </div>

          <div v-if="caps.customErrorPage" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.errorPages') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openErrorPage()">{{ t('cdnZoneSetting.create') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable
              :columns="errorPageColumns"
              :data="errorPages"
              size="small"
              :loading="errorPageBusy"
              :empty-text="t('cdnZoneSetting.errorPageEmpty')"
            />
          </div>
        </template>

        <!-- ============ 版本管理 ============ -->
        <template v-else-if="tab === 'versions'">
          <CdnZoneVersionsTab :aid="aid" :zone-id="zoneId" :reload-key="versionsReloadKey" />
        </template>

        <template v-else-if="caps.multiPath && tab === 'multipath'">
          <CdnZonePlatform :aid="aid" :zone-id="zoneId" section="multipath" />
        </template>

        <!-- ============ 边缘推理 ============ -->
        <template v-else-if="caps.inference && tab === 'inference'">
          <CdnZonePlatform :aid="aid" :zone-id="zoneId" section="inference" />
        </template>

        <!-- ============ 媒体处理 ============ -->
        <template v-else-if="caps.mediaTranscode && tab === 'media'">
          <CdnZonePlatform :aid="aid" :zone-id="zoneId" section="media" />
        </template>

        <!-- ============ 套餐计费 ============ -->
        <template v-else-if="caps.billing && tab === 'billing'">
          <CdnZonePlatform :aid="aid" :zone-id="zoneId" section="billing" />
        </template>

        <!-- ============ 边缘函数与 KV ============ -->
        <template v-else-if="tab === 'edge'">
          <CdnZoneEdgeTab :aid="aid" :zone-id="zoneId" :caps="caps" :reload-key="edgeReloadKey" />
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
                <template v-if="cfg.key === 'originProtection'">
                  <n-button size="small" :loading="!!busy['originEnable']" :disabled="!!busy['originEnable']" @click="run('originEnable', () => setOriginProtectionEnabled(true))">{{ t('cdnSecurity.enableOrigin') }}</n-button>
                  <n-button size="small" :loading="!!busy['originDisable']" :disabled="!!busy['originDisable']" @click="run('originDisable', () => setOriginProtectionEnabled(false))">{{ t('cdnSecurity.disableOrigin') }}</n-button>
                  <n-button size="small" :loading="!!busy['originConfirm']" :disabled="!!busy['originConfirm']" @click="run('originConfirm', confirmOriginAcl)">{{ t('cdnSecurity.confirmOrigin') }}</n-button>
                </template>
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

          <div v-if="caps.waf && wafTemplates.length" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnSecurity.templates') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ wafTemplates.length }}</n-tag>
              </div>
            </div>
            <ResponsiveDataTable
              :columns="wafTemplateColumns"
              :data="wafTemplates"
              size="small"
              :loading="loadBusy"
              :empty-text="t('cdnSecurity.templateEmpty')"
            />
          </div>

          <div v-if="caps.jsInjection" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnSecurity.jsInjection') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openSecurityRule('jsInjection')">{{ t('cdnZoneSetting.create') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="jsRuleColumns" :data="jsRules" size="small" :loading="securityExtraBusy" :empty-text="t('cdnSecurity.jsEmpty')" />
          </div>

          <div v-if="caps.clientAttester" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnSecurity.clientAttester') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openSecurityRule('clientAttester')">{{ t('cdnZoneSetting.create') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="clientAttesterColumns" :data="clientAttesters" size="small" :loading="securityExtraBusy" :empty-text="t('cdnSecurity.attesterEmpty')" />
          </div>

          <div v-if="caps.apiSecurity" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnSecurity.apiServices') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openSecurityRule('apiService')">{{ t('cdnZoneSetting.create') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="apiServiceColumns" :data="apiServices" size="small" :loading="securityExtraBusy" :empty-text="t('cdnSecurity.apiServiceEmpty')" />
          </div>

          <div v-if="caps.apiSecurity" class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnSecurity.apiResources') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openSecurityRule('apiResource')">{{ t('cdnZoneSetting.create') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="apiResourceColumns" :data="apiResources" size="small" :loading="securityExtraBusy" :empty-text="t('cdnSecurity.apiResourceEmpty')" />
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
          <CdnZoneTasksTab :aid="aid" :zone-id="zoneId" :caps="caps" :is-esa="isEsa" :reload-key="tasksReloadKey" />
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

      <n-modal v-model:show="showSecurityRule" preset="card" :title="securityRuleTitle" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="securityRuleJson" type="textarea" :rows="14" class="mono-input" spellcheck="false" :placeholder="t('cdnSecurity.ruleJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showSecurityRule = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="securityRuleSaving" :disabled="securityRuleSaving" @click="saveSecurityRule">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-modal v-model:show="showSharedBind" preset="card" :title="t('cdnZoneSetting.bindSharedCname')" class="modal-md" :mask-closable="false">
        <n-form label-placement="left" label-width="120">
          <n-form-item :label="t('cdnZoneSetting.sharedCname')">
            <n-input :value="sharedBindForm.sharedCname" disabled />
          </n-form-item>
          <n-form-item :label="t('cdnZoneSetting.bindType')">
            <n-select v-model:value="sharedBindForm.bindType" :options="sharedBindTypeOptions" size="small" />
          </n-form-item>
          <n-form-item :label="t('cdnZoneSetting.bindDomains')">
            <EsaCardSelect v-model="sharedBindForm.domains" :options="siteDomainOptions" multiple searchable clearable dense :placeholder="t('cdnSecurity.bindDomainsHint')" />
          </n-form-item>
        </n-form>
        <template #footer>
          <n-space justify="end">
            <n-button @click="showSharedBind = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="sharedBindBusy" :disabled="sharedBindBusy || !sharedBindForm.domains.length" @click="submitSharedBind">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-modal v-model:show="showErrorPage" preset="card" :title="errorPageEditingId ? t('cdnZoneSetting.editErrorPage') : t('cdnZoneSetting.createErrorPage')" class="modal-lg" :mask-closable="false">
        <n-form label-placement="left" label-width="110">
          <n-form-item :label="t('cdnZoneSetting.errorPageName')">
            <n-input v-model:value="errorPageForm.name" />
          </n-form-item>
          <n-form-item :label="t('cdnZoneSetting.errorPageType')">
            <n-select v-model:value="errorPageForm.contentType" :options="errorPageTypeOptions" size="small" />
          </n-form-item>
          <n-form-item :label="t('cdnZoneSetting.errorPageDesc')">
            <n-input v-model:value="errorPageForm.description" />
          </n-form-item>
          <n-form-item :label="t('cdnZoneSetting.errorPageContent')">
            <n-input v-model:value="errorPageForm.content" type="textarea" :rows="10" class="mono-input" spellcheck="false" />
          </n-form-item>
        </n-form>
        <template #footer>
          <n-space justify="end">
            <n-button @click="showErrorPage = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="errorPageSaving" :disabled="errorPageSaving || !errorPageForm.name" @click="saveErrorPage">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-modal v-model:show="showImport" preset="card" :title="t('cdnZoneSetting.importConfig')" class="modal-lg" :mask-closable="false">
        <n-form label-placement="left" label-width="100">
          <n-form-item :label="t('cdnZoneSetting.importContent')">
            <n-input v-model:value="importContent" type="textarea" :rows="14" :placeholder="t('cdnZoneSetting.importContentHint')" class="mono-input" spellcheck="false" />
          </n-form-item>
        </n-form>
        <template #footer>
          <n-space justify="end">
            <n-button @click="showImport = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="importBusy" :disabled="importBusy || !importContent.trim()" @click="importZoneConfig">{{ t('cdnZoneSetting.importConfig') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-drawer v-model:show="showL4Rules" placement="right" width="min(980px, 94vw)">
        <n-drawer-content closable :native-scrollbar="false" :title="l4RuleTitle">
          <div class="app-stack">
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnAdvanced.l4Rules') }}</h3>
                <div class="app-panel__extra">
                  <n-tag size="tiny" :bordered="false" class="tnum">{{ l4Rules.length }}</n-tag>
                </div>
              </div>
              <ResponsiveDataTable
                :columns="l4RuleColumns"
                :data="l4Rules"
                size="small"
                :loading="l4RuleBusy"
                :empty-text="t('cdnAdvanced.l4RuleEmpty')"
              />
            </div>
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnAdvanced.l4RuleCreate') }}</h3>
              </div>
              <div class="zone-form-strip">
                <n-select v-model:value="l4RuleForm.protocol" :options="l4ProtocolOptions" size="small" style="width: 130px" />
                <n-input v-model:value="l4RuleForm.port" :placeholder="t('cdnAdvanced.l4RulePort')" size="small" style="width: 120px" />
                <n-input v-model:value="l4RuleForm.origin" :placeholder="t('cdnAdvanced.l4RuleOrigin')" size="small" style="width: 200px" />
                <n-input v-model:value="l4RuleForm.originPort" :placeholder="t('cdnAdvanced.l4RuleOriginPort')" size="small" style="width: 130px" />
                <n-input v-model:value="l4RuleForm.tag" :placeholder="t('cdnAdvanced.l4RuleTag')" size="small" style="width: 140px" />
                <n-button size="small" type="primary" :loading="l4RuleSaving" @click="createL4Rule">{{ t('cdnZoneSetting.create') }}</n-button>
              </div>
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <n-modal v-model:show="showWafBind" preset="card" :title="t('cdnSecurity.bindTemplate')" class="modal-md" :mask-closable="false">
        <n-form label-placement="left" label-width="120">
          <n-form-item :label="t('cdnSecurity.templateId')">
            <n-input :value="wafBindForm.templateId" disabled />
          </n-form-item>
          <n-form-item :label="t('cdnSecurity.operate')">
            <n-select v-model:value="wafBindForm.operate" :options="wafOperateOptions" size="small" />
          </n-form-item>
          <n-form-item :label="t('cdnSecurity.bindDomains')">
            <EsaCardSelect
              v-model="wafBindForm.entities"
              :options="siteDomainOptions"
              :placeholder="t('cdnSecurity.bindDomainsHint')"
              multiple
              searchable
              clearable
              dense
            />
          </n-form-item>
          <n-form-item v-if="wafBindForm.operate === 'bind'" :label="t('cdnSecurity.overwrite')">
            <n-switch v-model:value="wafBindForm.overWrite" size="small" />
          </n-form-item>
        </n-form>
        <template #footer>
          <n-space justify="end">
            <n-button @click="showWafBind = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="wafBindBusy" :disabled="wafBindBusy || !wafBindForm.entities.length" @click="submitWafBind">{{ t('cdnSecurity.bind') }}</n-button>
          </n-space>
        </template>
      </n-modal>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, h, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDialog, useMessage, NButton, NTag } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { ArrowForwardOutline, CheckmarkCircleOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import { zoneAreaKey } from '../lib/zoneLabels';
import DetailGrid from '../components/DetailGrid.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
const RuleEditor = defineAsyncComponent(() => import('../components/cdn/RuleEditor.vue'));
import RuleTemplatePicker from '../components/cdn/RuleTemplatePicker.vue';
import RuleCreatePicker, { type RuleCreateSource } from '../components/cdn/RuleCreatePicker.vue';
import EsaRuleKindPicker from '../components/cdn/EsaRuleKindPicker.vue';
import ZoneModuleMenu, { type ZoneModuleMenuItem } from '../components/cdn/ZoneModuleMenu.vue';
const EsaZoneConsole = defineAsyncComponent(() => import('../components/cdn/EsaZoneConsole.vue'));
const CdnZoneGlobalSetting = defineAsyncComponent(() => import('../components/cdn/CdnZoneGlobalSetting.vue'));
const CdnZoneVersionsTab = defineAsyncComponent(() => import('../components/cdn/CdnZoneVersionsTab.vue'));
const CdnZoneOriginTab = defineAsyncComponent(() => import('../components/cdn/CdnZoneOriginTab.vue'));
const CdnZoneEdgeTab = defineAsyncComponent(() => import('../components/cdn/CdnZoneEdgeTab.vue'));
const CdnZoneTasksTab = defineAsyncComponent(() => import('../components/cdn/CdnZoneTasksTab.vue'));
const CdnZonePlatform = defineAsyncComponent(() => import('../components/cdn/CdnZonePlatform.vue'));
import EsaCardSelect from '../components/cdn/EsaCardSelect.vue';
import { useAction } from '../composables/useAction';
import { formatDateTime } from '../lib/datetime';
import { ruleEnabled } from '../lib/cdnSwitch';
import { EO_RULE_TEMPLATES } from '../lib/eoRuleTemplates';
import { EO_PRESET_RULES } from '../lib/eoPresetRules';
import { ESA_RULE_CATEGORIES, esaKindsOfCategory, esaKindMeta, type EsaRuleCategory, type EsaRuleKindMeta } from '../lib/esaRuleMeta';
import { EO_ZONE_TABS, ESA_ZONE_TABS } from '../lib/zoneTabs';
import { parseExtraParams } from '../lib/cdn/zoneForms';

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
const esaReloadKey = ref(0);
const versionsReloadKey = ref(0);
const originReloadKey = ref(0);
const edgeReloadKey = ref(0);
const tasksReloadKey = ref(0);
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
  EO_ZONE_TABS.filter((item) => {
    if (item.key === 'l4') return !!caps.value.l4;
    if (item.key === 'tasks') return !!caps.value.tasks;
    if (item.key === 'multipath') return !!caps.value.multiPath;
    if (item.key === 'inference') return !!caps.value.inference;
    if (item.key === 'media') return !!caps.value.mediaTranscode;
    if (item.key === 'billing') return !!caps.value.billing;
    return true;
  }).map((item) => ({
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

const siteDomainOptions = computed(() => siteDomains.value.map((d) => ({ label: d, value: d })));

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
const eoPropsForm = reactive<any>({ type: 'partial', area: 'global', aliasZoneName: '', vanityNs: '' });
const eoPropsBusy = ref(false);
const exportBusy = ref(false);
const showImport = ref(false);
const importBusy = ref(false);
const importContent = ref('');
const zonePlanOptions = ref<any[]>([]);
const bindPlanForm = reactive<any>({ planId: '' });
const bindPlanBusy = ref(false);
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
const eoAccessTypeOptions = computed(() => [
  { label: t('cdnSite.typePartial'), value: 'partial' },
  { label: t('cdnSite.typeFull'), value: 'full' },
]);
const eoAreaOptions = computed(() => [
  { label: t('cdnSite.areaGlobal'), value: 'global' },
  { label: t('cdnSite.areaMainland'), value: 'mainland' },
  { label: t('cdnSite.areaOverseas'), value: 'overseas' },
]);
// 非 ESA 站点的 type 是 API 原值（partial / full），直接透出看不出接入方式
const accessTypeLabel = computed(() => {
  if (isEsa.value) {
    return siteProps.value.accessType || siteProps.value.AccessType || zoneInfo.value.accessType || '-';
  }
  const type = String(siteProps.value.type || zoneInfo.value.type || '').toLowerCase();
  if (type === 'partial') return t('cdnSite.typePartial');
  if (type === 'full') return t('cdnSite.typeFull');
  return siteProps.value.type || zoneInfo.value.type || '-';
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
  const res = await api<any>('GET', '/cdn/domains/options', { aid, zone_id: zoneId, limit: 10000 });
  if (res.code === 0) domains.value = res.data || [];
}
async function loadNs() {
  if (!zoneId) return;
  const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/ns`);
  nsFromApi.value = res.code === 0 && Array.isArray(res.data) ? res.data : [];
}

async function loadZonePlans(): Promise<boolean> {
  if (isEsa.value || !aid) return true;
  const res = await api<any>('GET', `/cdn/accounts/${aid}/plan-instances`);
  if (res.code !== 0) {
    zonePlanOptions.value = [];
    return false;
  }
  const list = Array.isArray(res.data) ? res.data : [];
  zonePlanOptions.value = list
    .filter((p: any) => p.PlanId || p.InstanceId)
    .map((p: any) => {
      const id = String(p.PlanId || p.InstanceId);
      const expire = p.ExpireTime || p.ExpiredTime;
      return {
        label: `${p.PlanName || p.PlanType || id} · ${id}${expire ? ' · ' + String(expire).slice(0, 10) : ''}`,
        value: id,
      };
    });
  return true;
}

async function bindPlan() {
  if (!bindPlanForm.planId) return message.warning(t('cdnZoneSetting.ovPlanPlaceholder'));
  bindPlanBusy.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/sites/bind-plan`, { zoneId, planId: bindPlanForm.planId });
    if (res.code === 0) {
      message.success(t('cdnZoneSetting.ovBindPlanOk'));
      bindPlanForm.planId = '';
      await Promise.all([loadZoneInfo(), loadZonePlans()]);
    } else message.error(res.msg);
  } finally {
    bindPlanBusy.value = false;
  }
}

async function loadSiteProperties(): Promise<boolean> {
  if (!zoneId) return true;
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
  if (isEsa.value) {
    propsForm.accessType = siteProps.value.accessType || siteProps.value.AccessType || 'NS';
    propsForm.coverage = siteProps.value.area || siteProps.value.Coverage || 'domestic';
    propsForm.nameExclusive = siteProps.value.nameExclusive === true;
    propsForm.vanityNs = Array.isArray(siteProps.value.vanityNs) ? siteProps.value.vanityNs.join(',') : '';
  } else {
    eoPropsForm.type = siteProps.value.type || zoneInfo.value.type || 'partial';
    eoPropsForm.area = siteProps.value.area || zoneInfo.value.area || 'global';
    eoPropsForm.aliasZoneName = siteProps.value.aliasZoneName || '';
    eoPropsForm.vanityNs = Array.isArray(siteProps.value.vanityNameServers)
      ? siteProps.value.vanityNameServers.join(',')
      : '';
  }
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

async function saveEoProperties() {
  eoPropsBusy.value = true;
  try {
    const payload: Record<string, any> = {};
    const originalType = String(siteProps.value.type || zoneInfo.value.type || '');
    const originalArea = String(siteProps.value.area || zoneInfo.value.area || '');
    const originalAlias = String(siteProps.value.aliasZoneName || '');
    const originalVanity = Array.isArray(siteProps.value.vanityNameServers) ? siteProps.value.vanityNameServers.join(',') : '';
    // 只在用户实际修改时下发，避免读取不到云端属性时误覆盖接入方式或清空配置
    if (originalType ? String(eoPropsForm.type || '') !== originalType : eoPropsForm.type !== 'partial') payload.type = eoPropsForm.type;
    if (originalArea ? String(eoPropsForm.area || '') !== originalArea : eoPropsForm.area !== 'global') payload.area = eoPropsForm.area;
    if (String(eoPropsForm.aliasZoneName || '') !== originalAlias) payload.aliasZoneName = eoPropsForm.aliasZoneName || '';
    if (String(eoPropsForm.vanityNs || '') !== originalVanity) payload.vanityNs = eoPropsForm.vanityNs || '';
    if (!Object.keys(payload).length) return message.info(t('cdnZoneSetting.globalNoChange'));
    const res = await api<any>('PUT', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}`, payload);
    if (res.code === 0) {
      message.success(t('cdnZoneSetting.ovPropsSaved'));
      await Promise.all([loadSiteProperties(), loadZoneInfo(), loadNs()]);
    } else message.error(res.msg);
  } finally {
    eoPropsBusy.value = false;
  }
}

function downloadText(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportZoneConfig() {
  exportBusy.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/config/export`);
    if (res.code === 0) {
      const content = String(res.data?.content || '');
      if (!content) return message.warning(t('cdnZoneSetting.empty'));
      downloadText(`edgeone-${zoneInfo.value.zone_name || zoneId}-config.json`, content);
      message.success(t('cdnZoneSetting.exportOk'));
    } else message.error(res.msg);
  } finally {
    exportBusy.value = false;
  }
}

function openImport() {
  importContent.value = '';
  showImport.value = true;
}

async function importZoneConfig() {
  if (!importContent.value.trim()) return message.warning(t('cdnZoneSetting.importContentHint'));
  importBusy.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/config/import`, {
      content: importContent.value,
    });
    if (res.code !== 0) return message.error(res.msg);
    const taskId = String(res.data?.taskId || '');
    showImport.value = false;
    message.success(`${res.msg}${taskId ? ' · ' + taskId : ''}`);
    if (taskId) await pollImportResult(taskId);
  } finally {
    importBusy.value = false;
  }
}

async function pollImportResult(taskId: string) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/config/import/${encodeURIComponent(taskId)}`);
    if (res.code !== 0) return message.error(res.msg);
    const status = String(res.data?.Status || '');
    if (status === 'doing') continue;
    dialog.info({
      title: t('cdnZoneSetting.importResult'),
      content: () => h('pre', { class: 'code-view', style: 'max-height:480px' }, JSON.stringify(res.data || {}, null, 2)),
    });
    return;
  }
  message.info(t('cdnZoneSetting.importPending'));
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

// ===================== 共享 CNAME / 别称域名 =====================
const domainsBusy = ref(false);
const sharedCnames = ref<any[]>([]);
const aliasDomains = ref<any[]>([]);
const sharedForm = reactive<any>({ prefix: '', description: '' });
const sharedSaving = ref(false);
const showSharedBind = ref(false);
const sharedBindBusy = ref(false);
const sharedBindForm = reactive<any>({ sharedCname: '', bindType: 'bind', domains: [] });
const sharedBindTypeOptions = [
  { label: t('cdnSecurity.bind'), value: 'bind' },
  { label: t('cdnSecurity.unbind'), value: 'unbind' },
];
const aliasForm = reactive<any>({ aliasName: '', targetName: '', certType: 'none' });
const aliasSaving = ref(false);
const aliasCertOptions = [
  { label: 'none', value: 'none' },
  { label: 'hosting', value: 'hosting' },
];
const sharedCnameColumns = computed(() => [
  { title: t('cdnZoneSetting.sharedCname'), key: 'SharedCNAME', minWidth: 260, render: (r: any) => r.SharedCNAME || '-' },
  { title: t('cdnZoneSetting.sharedCnameDesc'), key: 'Description', minWidth: 180, render: (r: any) => r.Description || '-' },
  { title: t('cdnZoneSetting.bindCount'), key: 'BindDomainCount', width: 100 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 170,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openSharedBind(r) }, { default: () => t('cdnSecurity.bind') }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delSharedCname(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
  },
]);
const aliasColumns = computed(() => [
  { title: t('cdnZoneSetting.aliasName'), key: 'AliasName', minWidth: 180 },
  { title: t('cdnZoneSetting.targetName'), key: 'TargetName', minWidth: 180 },
  { title: t('cdnRules.colStatus'), key: 'Status', width: 110 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 170,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => toggleAlias(r) }, { default: () => (r.Status === 'online' ? t('cdnAdvanced.disable') : t('cdnAdvanced.enable')) }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delAlias(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
  },
]);

async function loadDomainExtras(): Promise<boolean> {
  if (isEsa.value) return true;
  domainsBusy.value = true;
  try {
    const tasks: Promise<boolean>[] = [];
    if (caps.value.sharedCname) {
      tasks.push((async () => {
        const res = await api<any>('GET', `/cdn/accounts/${aid}/shared-cnames`, { zoneId, page: 1, size: 100 });
        sharedCnames.value = res.code === 0 ? res.data?.list || [] : [];
        return res.code === 0;
      })());
    }
    if (caps.value.aliasDomain) {
      tasks.push((async () => {
        const res = await api<any>('GET', `/cdn/accounts/${aid}/alias-domains`, { zoneId, page: 1, size: 100 });
        aliasDomains.value = res.code === 0 ? res.data?.list || [] : [];
        return res.code === 0;
      })());
    }
    const results = await Promise.all(tasks);
    return results.every(Boolean);
  } finally {
    domainsBusy.value = false;
  }
}

async function createSharedCname() {
  if (!sharedForm.prefix.trim()) return message.warning(t('cdnZoneSetting.sharedCnamePrefix'));
  sharedSaving.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/shared-cnames`, {
      zoneId,
      prefix: sharedForm.prefix.trim(),
      description: sharedForm.description.trim() || undefined,
    });
    if (res.code === 0) {
      message.success(res.msg);
      sharedForm.prefix = '';
      sharedForm.description = '';
      await loadDomainExtras();
    } else message.error(res.msg);
  } finally {
    sharedSaving.value = false;
  }
}

function openSharedBind(r: any) {
  sharedBindForm.sharedCname = String(r.SharedCNAME || '');
  sharedBindForm.bindType = 'bind';
  sharedBindForm.domains = [];
  showSharedBind.value = true;
}

async function submitSharedBind() {
  if (!sharedBindForm.domains.length) return message.warning(t('cdnSecurity.needTemplateAndDomain'));
  sharedBindBusy.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/shared-cnames/bind`, {
      zoneId,
      bindType: sharedBindForm.bindType,
      maps: [{ SharedCNAME: sharedBindForm.sharedCname, DomainNames: sharedBindForm.domains }],
    });
    if (res.code === 0) {
      message.success(res.msg);
      showSharedBind.value = false;
      await loadDomainExtras();
    } else message.error(res.msg);
  } finally {
    sharedBindBusy.value = false;
  }
}

function delSharedCname(r: any) {
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnAdvanced.confirmDelete', { name: r.SharedCNAME }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/shared-cnames/${encodeURIComponent(String(r.SharedCNAME))}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        await loadDomainExtras();
      } else message.error(res.msg);
    },
  });
}

async function createAliasDomain() {
  if (!aliasForm.aliasName.trim() || !aliasForm.targetName.trim()) return message.warning(t('cdnZoneSetting.aliasNeedFields'));
  aliasSaving.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/alias-domains`, {
      zoneId,
      aliasName: aliasForm.aliasName.trim(),
      targetName: aliasForm.targetName.trim(),
      certType: aliasForm.certType,
    });
    if (res.code === 0) {
      message.success(res.msg);
      aliasForm.aliasName = '';
      aliasForm.targetName = '';
      await loadDomainExtras();
    } else message.error(res.msg);
  } finally {
    aliasSaving.value = false;
  }
}

async function toggleAlias(r: any) {
  const paused = r.Status === 'online';
  const res = await api<any>('POST', `/cdn/accounts/${aid}/alias-domains/${encodeURIComponent(String(r.AliasName))}/status`, { zoneId, paused });
  if (res.code === 0) {
    message.success(res.msg);
    await loadDomainExtras();
  } else message.error(res.msg);
}

function delAlias(r: any) {
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnAdvanced.confirmDelete', { name: r.AliasName }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/alias-domains/${encodeURIComponent(String(r.AliasName))}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        await loadDomainExtras();
      } else message.error(res.msg);
    },
  });
}

// ===================== 规则引擎（可视化） =====================
const ruleList = ref<any[]>([]);
const ruleLoadBusy = ref(false);
const ruleLoadError = ref('');
const rulePage = ref(1);
const rulePageSize = ref(20);
const ruleTotal = ref(0);
let rulesLoadSeq = 0;
let ruleSchemaSeq = 0;
const ruleSchemaCache = new Map<string, any>();
const rulePagination = computed(() => ({
  page: rulePage.value,
  pageSize: rulePageSize.value,
  itemCount: ruleTotal.value,
  showSizePicker: true,
  pageSizes: [20, 50, 100],
  onChange: (p: number) => {
    rulePage.value = p;
    void loadRules();
  },
  onUpdatePageSize: (size: number) => {
    rulePageSize.value = size;
    rulePage.value = 1;
    void loadRules();
  },
}));
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
  rulePage.value = 1;
  ruleList.value = [];
  ruleTotal.value = 0;
  loadRules();
}
/** 从「新建规则」卡片选择类型：先同步分类，再切换并打开编辑器 */
function onPickEsaKind(kind: string) {
  const meta = esaKindMeta(kind);
  if (meta) esaCategory.value = meta.category;
  ruleKind.value = kind;
  rulePage.value = 1;
  ruleList.value = [];
  ruleTotal.value = 0;
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
  const kind = ruleKind.value;
  const accountAid = String(aid);
  const key = `${accountAid}:${kind}`;
  const cached = ruleSchemaCache.get(key);
  if (cached) {
    ruleSchema.value = cached;
    return;
  }
  const seq = ++ruleSchemaSeq;
  const res = await api<any>('GET', `/cdn/accounts/${aid}/rule-schema`, { kind });
  if (seq !== ruleSchemaSeq || kind !== ruleKind.value || accountAid !== String(aid)) return;
  if (res.code === 0) {
    ruleSchemaCache.set(key, res.data);
    ruleSchema.value = res.data;
  }
}
async function loadRules(): Promise<boolean> {
  const seq = ++rulesLoadSeq;
  ruleLoadBusy.value = true;
  ruleLoadError.value = '';
  let ok = true;
  try {
    if (isEsa.value) {
      await loadRuleSchemaForKind();
      if (seq !== rulesLoadSeq) return false;
      // 服务端分页：只拉当前页，避免规则多时连续请求并一次渲染上千行
      const res = await api<any>('GET', `/cdn/accounts/${aid}/rule-configs`, {
        zoneId,
        kind: ruleKind.value,
        page: rulePage.value,
        size: rulePageSize.value,
      });
      if (seq !== rulesLoadSeq) return false;
      if (res.code !== 0) {
        ok = false;
        ruleLoadError.value = res.msg || '规则加载失败';
        message.error(ruleLoadError.value);
      } else {
        ruleList.value = res.data?.list || [];
        ruleTotal.value = Number(res.data?.total || 0);
      }
    } else {
      const res = await api<any>('GET', `/cdn/accounts/${aid}/rules`, {
        zoneId,
        page: rulePage.value,
        size: rulePageSize.value,
      });
      if (seq !== rulesLoadSeq) return false;
      ok = res.code === 0;
      if (ok) {
        if (Array.isArray(res.data)) {
          ruleList.value = res.data;
          ruleTotal.value = res.data.length;
        } else {
          ruleList.value = res.data?.list || [];
          ruleTotal.value = Number(res.data?.total || 0);
        }
      } else {
        ruleLoadError.value = res.msg || '规则加载失败';
        message.error(ruleLoadError.value);
      }
    }
  } finally {
    if (seq === rulesLoadSeq) ruleLoadBusy.value = false;
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

const customVarsText = ref('');
const customVarsLoading = ref(false);
const customVarsSaving = ref(false);

async function loadCustomVariables(): Promise<boolean> {
  if (isEsa.value) return true;
  customVarsLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/custom-variables`);
    if (res.code !== 0) {
      message.error(res.msg);
      return false;
    }
    customVarsText.value = JSON.stringify(res.data || {}, null, 2);
    return true;
  } finally {
    customVarsLoading.value = false;
  }
}

async function saveCustomVariables() {
  let parsed: any;
  try {
    parsed = customVarsText.value.trim() ? JSON.parse(customVarsText.value) : {};
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  customVarsSaving.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/custom-variables`, {
      CustomVariables: Array.isArray(parsed.CustomVariables) ? parsed.CustomVariables : [],
      CustomVariableOperations: Array.isArray(parsed.CustomVariableOperations) ? parsed.CustomVariableOperations : [],
    });
    if (res.code === 0) {
      message.success(res.msg);
      await loadCustomVariables();
    } else message.error(res.msg);
  } finally {
    customVarsSaving.value = false;
  }
}

const errorPages = ref<any[]>([]);
const errorPageBusy = ref(false);
const errorPageSaving = ref(false);
const showErrorPage = ref(false);
const errorPageEditingId = ref('');
const errorPageForm = reactive<any>({ name: '', contentType: 'text/html', description: '', content: '' });
const errorPageTypeOptions = ['text/html', 'application/json', 'text/plain', 'text/xml', 'text/css', 'text/javascript'].map((v) => ({ label: v, value: v }));
const errorPageColumns = computed(() => [
  { title: t('cdnZoneSetting.errorPageName'), key: 'Name', minWidth: 180 },
  { title: t('cdnZoneSetting.errorPageType'), key: 'ContentType', width: 160 },
  { title: 'PageId', key: 'PageId', minWidth: 150 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 150,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openErrorPage(r) }, { default: () => t('cdnZoneSetting.edit') }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delErrorPage(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
  },
]);

async function loadErrorPages(): Promise<boolean> {
  if (isEsa.value || !caps.value.customErrorPage) return true;
  errorPageBusy.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/error-pages`, { zoneId, page: 1, size: 100 });
    errorPages.value = res.code === 0 ? res.data?.list || [] : [];
    return res.code === 0;
  } finally {
    errorPageBusy.value = false;
  }
}

function openErrorPage(row?: any) {
  errorPageEditingId.value = row ? String(row.PageId || '') : '';
  errorPageForm.name = row?.Name || '';
  errorPageForm.contentType = row?.ContentType || 'text/html';
  errorPageForm.description = row?.Description || '';
  errorPageForm.content = row?.Content || '';
  showErrorPage.value = true;
}

async function saveErrorPage() {
  if (!errorPageForm.name.trim()) return message.warning(t('cdnZoneSetting.errorPageName'));
  errorPageSaving.value = true;
  try {
    const payload = {
      zoneId,
      name: errorPageForm.name.trim(),
      contentType: errorPageForm.contentType,
      description: errorPageForm.description,
      content: errorPageForm.content,
    };
    const res: any = errorPageEditingId.value
      ? await api('PUT', `/cdn/accounts/${aid}/error-pages/${encodeURIComponent(errorPageEditingId.value)}`, payload)
      : await api('POST', `/cdn/accounts/${aid}/error-pages`, payload);
    if (res.code === 0) {
      message.success(res.msg);
      showErrorPage.value = false;
      await loadErrorPages();
    } else message.error(res.msg);
  } finally {
    errorPageSaving.value = false;
  }
}

function delErrorPage(r: any) {
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnAdvanced.confirmDelete', { name: r.Name || r.PageId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/error-pages/${encodeURIComponent(String(r.PageId))}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        await loadErrorPages();
      } else message.error(res.msg);
    },
  });
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
  try {
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
    if (res.code === 0) {
      message.success(res.msg || t('cdnRules.savedOk'));
      showRuleEditor.value = false;
      loadRules();
    } else message.error(res.msg);
  } catch (e: any) {
    message.error(e?.message || t('cdnRules.saveFailed'));
  } finally {
    ruleSaveBusy.value = false;
  }
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
        if (ruleList.value.length === 1 && rulePage.value > 1) rulePage.value--;
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
const wafTemplates = ref<any[]>([]);
const showWafBind = ref(false);
const wafBindBusy = ref(false);
const wafBindForm = reactive<any>({ templateId: '', entities: [], operate: 'bind', overWrite: true });
const wafOperateOptions = computed(() => [
  { label: t('cdnSecurity.bind'), value: 'bind' },
  { label: t('cdnSecurity.unbindKeep'), value: 'unbind-keep-policy' },
  { label: t('cdnSecurity.unbindDefault'), value: 'unbind-use-default' },
]);
const wafTemplateColumns = computed(() => [
  { title: t('cdnSecurity.templateName'), key: 'TemplateName', minWidth: 160, render: (r: any) => r.TemplateName || r.TemplateId || '-' },
  { title: t('cdnSecurity.templateId'), key: 'TemplateId', minWidth: 160, render: (r: any) => r.TemplateId || '-' },
  {
    title: t('cdnSecurity.bindDomains'),
    key: 'BindDomains',
    minWidth: 220,
    render: (r: any) =>
      Array.isArray(r.BindDomains) && r.BindDomains.length
        ? r.BindDomains.map((x: any) => `${x.Domain || x.Entity || '-'}${x.Status ? `(${x.Status})` : ''}`).join(', ')
        : '-',
  },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 220,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openWafBind(r) }, { default: () => t('cdnSecurity.bind') }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => showWafTemplate(r) }, { default: () => t('cdnSecurity.detail') }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delWafTemplate(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
  },
]);
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
  if (caps.value.jsInjection || caps.value.clientAttester || caps.value.apiSecurity) tasks.push(loadSecurityExtras());
  const results = await Promise.all(tasks);
  return results.every(Boolean);
}

const securityExtraBusy = ref(false);
const jsRules = ref<any[]>([]);
const clientAttesters = ref<any[]>([]);
const showSecurityRule = ref(false);
type SecurityRuleKind = 'jsInjection' | 'clientAttester' | 'apiService' | 'apiResource';
const securityRuleKind = ref<SecurityRuleKind>('jsInjection');
const securityRuleEditingId = ref('');
const securityRuleSaving = ref(false);
const securityRuleJson = ref('');
const securityRuleTitle = computed(() => {
  const keys: Record<SecurityRuleKind, string> = {
    jsInjection: 'cdnSecurity.jsInjection',
    clientAttester: 'cdnSecurity.clientAttester',
    apiService: 'cdnSecurity.apiServices',
    apiResource: 'cdnSecurity.apiResources',
  };
  const create = !securityRuleEditingId.value;
  return `${create ? t('cdnZoneSetting.create') : t('cdnZoneSetting.edit')} · ${t(keys[securityRuleKind.value])}`;
});
const apiServices = ref<any[]>([]);
const apiResources = ref<any[]>([]);
const apiServiceColumns = computed(() => [
  { title: 'Id', key: 'Id', minWidth: 160 },
  { title: t('cdnSecurity.ruleName'), key: 'Name', minWidth: 160 },
  { title: 'BasePath', key: 'BasePath', minWidth: 180 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 150,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openSecurityRule('apiService', r) }, { default: () => t('cdnZoneSetting.edit') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delSecurityRule('apiService', r) }, { default: () => t('cdnZoneSetting.delete') }),
    ]),
  },
]);
const apiResourceColumns = computed(() => [
  { title: 'Id', key: 'Id', minWidth: 160 },
  { title: t('cdnSecurity.ruleName'), key: 'Name', minWidth: 160 },
  { title: 'Path', key: 'Path', minWidth: 160 },
  { title: t('cdnSecurity.apiMethods'), key: 'Methods', minWidth: 140, render: (r: any) => Array.isArray(r.Methods) ? r.Methods.join(',') : '-' },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 150,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openSecurityRule('apiResource', r) }, { default: () => t('cdnZoneSetting.edit') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delSecurityRule('apiResource', r) }, { default: () => t('cdnZoneSetting.delete') }),
    ]),
  },
]);
const jsRuleColumns = computed(() => [
  { title: 'RuleId', key: 'RuleId', minWidth: 160 },
  { title: t('cdnSecurity.ruleName'), key: 'Name', minWidth: 160 },
  { title: 'InjectJS', key: 'InjectJS', width: 140 },
  { title: 'Priority', key: 'Priority', width: 90 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 150,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openSecurityRule('jsInjection', r) }, { default: () => t('cdnZoneSetting.edit') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delSecurityRule('jsInjection', r) }, { default: () => t('cdnZoneSetting.delete') }),
    ]),
  },
]);
const clientAttesterColumns = computed(() => [
  { title: 'Id', key: 'Id', minWidth: 160 },
  { title: t('cdnSecurity.ruleName'), key: 'Name', minWidth: 160 },
  { title: 'AttesterSource', key: 'AttesterSource', width: 140 },
  { title: 'AttesterDuration', key: 'AttesterDuration', width: 140 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 150,
    render: (r: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openSecurityRule('clientAttester', r) }, { default: () => t('cdnZoneSetting.edit') }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delSecurityRule('clientAttester', r) }, { default: () => t('cdnZoneSetting.delete') }),
    ]),
  },
]);

async function loadSecurityExtras(): Promise<boolean> {
  securityExtraBusy.value = true;
  try {
    const tasks: Promise<boolean>[] = [];
    if (caps.value.jsInjection) {
      tasks.push((async () => {
        const res = await api<any>('GET', `/cdn/accounts/${aid}/security/js-injection`, { zoneId, page: 1, size: 100 });
        jsRules.value = res.code === 0 ? res.data?.list || [] : [];
        return res.code === 0;
      })());
    }
    if (caps.value.clientAttester) {
      tasks.push((async () => {
        const res = await api<any>('GET', `/cdn/accounts/${aid}/security/client-attesters`, { zoneId, page: 1, size: 100 });
        clientAttesters.value = res.code === 0 ? res.data?.list || [] : [];
        return res.code === 0;
      })());
    }
    if (caps.value.apiSecurity) {
      tasks.push((async () => {
        const res = await api<any>('GET', `/cdn/accounts/${aid}/security/api-services`, { zoneId, page: 1, size: 100 });
        apiServices.value = res.code === 0 ? res.data?.list || [] : [];
        return res.code === 0;
      })());
      tasks.push((async () => {
        const res = await api<any>('GET', `/cdn/accounts/${aid}/security/api-resources`, { zoneId, page: 1, size: 100 });
        apiResources.value = res.code === 0 ? res.data?.list || [] : [];
        return res.code === 0;
      })());
    }
    const results = await Promise.all(tasks);
    return results.every(Boolean);
  } finally {
    securityExtraBusy.value = false;
  }
}

function openSecurityRule(kind: SecurityRuleKind, row?: any) {
  securityRuleKind.value = kind;
  securityRuleEditingId.value = row ? String(row.RuleId || row.Id || '') : '';
  if (row) securityRuleJson.value = JSON.stringify(row, null, 2);
  else if (kind === 'jsInjection') {
    securityRuleJson.value = JSON.stringify({ Name: '', Condition: '', InjectJS: 'inject-sdk-only', Priority: 1 }, null, 2);
  } else if (kind === 'clientAttester') {
    securityRuleJson.value = JSON.stringify({ Name: '', AttesterSource: 'TC-RCE', TCRCEOption: { Channel: '' }, AttesterDuration: '300s' }, null, 2);
  } else if (kind === 'apiService') {
    securityRuleJson.value = JSON.stringify({ Name: '', BasePath: '' }, null, 2);
  } else {
    securityRuleJson.value = JSON.stringify({ Name: '', Path: '', APIServiceIds: [], Methods: ['GET'], RequestConstraint: '' }, null, 2);
  }
  showSecurityRule.value = true;
}

async function saveSecurityRule() {
  let parsed: any;
  try {
    parsed = JSON.parse(securityRuleJson.value);
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  securityRuleSaving.value = true;
  try {
    const kind = securityRuleKind.value;
    const id = securityRuleEditingId.value;
    const bases: Record<SecurityRuleKind, string> = {
      jsInjection: 'js-injection',
      clientAttester: 'client-attesters',
      apiService: 'api-services',
      apiResource: 'api-resources',
    };
    const payloadKeys: Record<SecurityRuleKind, string> = {
      jsInjection: 'rule',
      clientAttester: 'attester',
      apiService: 'service',
      apiResource: 'resource',
    };
    const base = bases[kind];
    const path = id
      ? `/cdn/accounts/${aid}/security/${base}/${encodeURIComponent(id)}`
      : `/cdn/accounts/${aid}/security/${base}`;
    const body = { zoneId, [payloadKeys[kind]]: parsed };
    const res: any = id ? await api('PUT', path, body) : await api('POST', path, body);
    if (res.code === 0) {
      message.success(res.msg);
      showSecurityRule.value = false;
      await loadSecurityExtras();
    } else message.error(res.msg);
  } finally {
    securityRuleSaving.value = false;
  }
}

function delSecurityRule(kind: SecurityRuleKind, row: any) {
  const id = String(row.RuleId || row.Id || '');
  const bases: Record<SecurityRuleKind, string> = {
    jsInjection: 'js-injection',
    clientAttester: 'client-attesters',
    apiService: 'api-services',
    apiResource: 'api-resources',
  };
  const base = bases[kind];
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnAdvanced.confirmDelete', { name: row.Name || id }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/security/${base}/${encodeURIComponent(id)}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        await loadSecurityExtras();
      } else message.error(res.msg);
    },
  });
}
async function loadSecurityConfig(key: string, silent = false): Promise<boolean> {
  const res = await api<any>('GET', `/cdn/accounts/${aid}/security/${secRoute(key)}`, { zoneId });
  if (res.code === 0) {
    secJson[key] = JSON.stringify(res.data, null, 2);
    if (key === 'waf') wafTemplates.value = Array.isArray(res.data?.templates) ? res.data.templates : [];
  } else if (!silent) message.error(res.msg);
  return res.code === 0;
}

function openWafBind(r: any) {
  wafBindForm.templateId = String(r.TemplateId || '');
  wafBindForm.entities = [];
  wafBindForm.operate = 'bind';
  wafBindForm.overWrite = true;
  showWafBind.value = true;
}

async function submitWafBind() {
  if (!wafBindForm.templateId || !wafBindForm.entities.length) return message.warning(t('cdnSecurity.needTemplateAndDomain'));
  wafBindBusy.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/security/template-bind`, {
      zoneId,
      templateId: wafBindForm.templateId,
      entities: wafBindForm.entities,
      operate: wafBindForm.operate,
      overWrite: wafBindForm.overWrite,
    });
    if (res.code === 0) {
      message.success(res.msg);
      showWafBind.value = false;
      await loadSecurityConfig('waf', true);
    } else message.error(res.msg);
  } finally {
    wafBindBusy.value = false;
  }
}

async function showWafTemplate(r: any) {
  const res = await api<any>('GET', `/cdn/accounts/${aid}/security/templates/${encodeURIComponent(String(r.TemplateId))}`, { zoneId });
  if (res.code !== 0) return message.error(res.msg);
  dialog.info({
    title: t('cdnSecurity.templateDetail', { name: r.TemplateName || r.TemplateId }),
    content: () => h('pre', { class: 'code-view', style: 'max-height:480px' }, JSON.stringify(res.data || {}, null, 2)),
  });
}

function delWafTemplate(r: any) {
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnSecurity.confirmDelete', { name: r.TemplateName || r.TemplateId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api<any>('DELETE', `/cdn/accounts/${aid}/security/templates/${encodeURIComponent(String(r.TemplateId))}`, { zoneId });
      if (res.code === 0) {
        message.success(res.msg);
        await loadSecurityConfig('waf', true);
      } else message.error(res.msg);
    },
  });
}
async function setOriginProtectionEnabled(enabled: boolean) {
  const res = await api<any>('POST', `/cdn/accounts/${aid}/security/origin-protection`, { zoneId, config: { enabled } });
  if (res.code === 0) {
    message.success(res.msg);
    await loadSecurityConfig('originProtection', true);
  } else message.error(res.msg);
}

async function confirmOriginAcl() {
  const res = await api<any>('POST', `/cdn/accounts/${aid}/security/origin-protection/confirm`, { zoneId });
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
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
const showL4Rules = ref(false);
const l4RuleProxy = ref<any>(null);
const l4Rules = ref<any[]>([]);
const l4RuleBusy = ref(false);
const l4RuleSaving = ref(false);
const l4RuleForm = reactive<any>({ protocol: 'TCP', port: '', origin: '', originPort: '', tag: '' });
const l4ProtocolOptions = [
  { label: 'TCP', value: 'TCP' },
  { label: 'UDP', value: 'UDP' },
];
const l4RuleTitle = computed(() => l4RuleProxy.value ? `${t('cdnAdvanced.l4Rules')} · ${l4RuleProxy.value.name || l4RuleProxy.value.proxyId}` : t('cdnAdvanced.l4Rules'));
const l4Columns = computed(() => [
  { title: t('cdnAdvanced.colName'), key: 'name', minWidth: 160 },
  { title: t('cdnAdvanced.colArea'), key: 'area', width: 120 },
  {
    title: t('cdnRules.colStatus'),
    key: 'status',
    width: 100,
    render: (r: any) => h(NTag, { size: 'small', type: r.Status === 'offline' ? 'default' : 'success' }, { default: () => (r.Status === 'offline' ? t('cdnAdvanced.offline') : t('cdnAdvanced.online')) }),
  },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 220,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, loading: !!busy[`l4status:${r.proxyId}`], onClick: () => run(`l4status:${r.proxyId}`, () => toggleL4Proxy(r)) }, { default: () => (r.Status === 'offline' ? t('cdnAdvanced.enable') : t('cdnAdvanced.disable')) }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openL4Rules(r) }, { default: () => t('cdnAdvanced.l4Rules') }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delL4Proxy(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
  },
]);
const l4RuleColumns = computed(() => [
  { title: 'RuleId', key: 'RuleId', minWidth: 150 },
  { title: t('cdnAdvanced.l4RuleProtocol'), key: 'Protocol', width: 100 },
  { title: t('cdnAdvanced.l4RulePort'), key: 'PortRange', width: 120, render: (r: any) => Array.isArray(r.PortRange) ? r.PortRange.join(',') : r.PortRange || '-' },
  { title: t('cdnAdvanced.l4RuleOrigin'), key: 'OriginValue', minWidth: 180, render: (r: any) => Array.isArray(r.OriginValue) ? r.OriginValue.join(',') : r.OriginValue || '-' },
  { title: t('cdnAdvanced.l4RuleOriginPort'), key: 'OriginPortRange', width: 120 },
  {
    title: t('cdnRules.colStatus'),
    key: 'Status',
    width: 90,
    render: (r: any) => h(NTag, { size: 'small', type: r.Status === 'offline' ? 'default' : 'success' }, { default: () => (r.Status === 'offline' ? t('cdnAdvanced.offline') : t('cdnAdvanced.online')) }),
  },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 150,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => toggleL4Rule(r) }, { default: () => (r.Status === 'offline' ? t('cdnAdvanced.enable') : t('cdnAdvanced.disable')) }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delL4Rule(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
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
async function toggleL4Proxy(r: any) {
  const next = r.Status === 'offline' ? 'online' : 'offline';
  const res = await api<any>('POST', `/cdn/accounts/${aid}/l4-proxies/${encodeURIComponent(String(r.proxyId))}/status`, { zoneId, status: next });
  if (res.code === 0) {
    message.success(res.msg);
    loadL4Proxies();
  } else message.error(res.msg);
}

async function openL4Rules(r: any) {
  l4RuleProxy.value = r;
  l4RuleForm.protocol = 'TCP';
  l4RuleForm.port = '';
  l4RuleForm.origin = '';
  l4RuleForm.originPort = '';
  l4RuleForm.tag = '';
  showL4Rules.value = true;
  await loadL4Rules();
}

async function loadL4Rules() {
  const proxy = l4RuleProxy.value;
  if (!proxy) return;
  l4RuleBusy.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/l4-proxies/${encodeURIComponent(String(proxy.proxyId))}/rules`, { zoneId, page: 1, size: 200 });
    l4Rules.value = res.code === 0 ? res.data?.list || [] : [];
    if (res.code !== 0) message.error(res.msg);
  } finally {
    l4RuleBusy.value = false;
  }
}

async function createL4Rule() {
  const proxy = l4RuleProxy.value;
  if (!proxy || !l4RuleForm.port || !l4RuleForm.origin) return message.warning(t('cdnAdvanced.l4RuleNeedFields'));
  l4RuleSaving.value = true;
  try {
    const rule = {
      Protocol: l4RuleForm.protocol,
      PortRange: String(l4RuleForm.port).split(',').map((x) => x.trim()).filter(Boolean),
      OriginType: 'IP_DOMAIN',
      OriginValue: String(l4RuleForm.origin).split(',').map((x) => x.trim()).filter(Boolean),
      OriginPortRange: String(l4RuleForm.originPort || '').trim() || undefined,
      RuleTag: String(l4RuleForm.tag || '').trim() || undefined,
    };
    const res = await api<any>('POST', `/cdn/accounts/${aid}/l4-proxies/${encodeURIComponent(String(proxy.proxyId))}/rules`, { zoneId, rules: [rule] });
    if (res.code === 0) {
      message.success(res.msg);
      l4RuleForm.port = '';
      l4RuleForm.origin = '';
      l4RuleForm.originPort = '';
      l4RuleForm.tag = '';
      await loadL4Rules();
    } else message.error(res.msg);
  } finally {
    l4RuleSaving.value = false;
  }
}

async function toggleL4Rule(r: any) {
  const proxy = l4RuleProxy.value;
  if (!proxy) return;
  const next = r.Status === 'offline' ? 'online' : 'offline';
  const res = await api<any>('POST', `/cdn/accounts/${aid}/l4-proxies/${encodeURIComponent(String(proxy.proxyId))}/rules/status`, {
    zoneId,
    ruleIds: [String(r.RuleId)],
    status: next,
  });
  if (res.code === 0) {
    message.success(res.msg);
    loadL4Rules();
  } else message.error(res.msg);
}

function delL4Rule(r: any) {
  const proxy = l4RuleProxy.value;
  if (!proxy) return;
  dialog.warning({
    title: t('cdnZoneSetting.delete'),
    content: t('cdnAdvanced.confirmDelete', { name: r.RuleTag || r.RuleId }),
    positiveText: t('cdnZoneSetting.delete'),
    negativeText: t('cdnZoneSetting.cancel'),
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${aid}/l4-proxies/${encodeURIComponent(String(proxy.proxyId))}/rules`, { zoneId, ruleIds: [String(r.RuleId)] });
      if (res.code === 0) {
        message.success(res.msg);
        loadL4Rules();
      } else message.error(res.msg);
    },
  });
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

// ===================== 汇总 =====================
// 记录已加载的 tab：来回切换时跳过重复请求（reloadAll 或主动刷新时强制重载）。
// 仅在加载成功时记录，避免首次失败后反复切 tab 永不重试。
const loadedTabs = new Set<string>();
async function loadByTab(name: string, force = false) {
  if (!force && loadedTabs.has(name)) return;
  let ok = true;
  if (name === 'domains') {
    await loadDomains();
    ok = await loadDomainExtras();
  } else if (name === 'rules') {
    ok = await loadRules();
    if (!isEsa.value) {
      const varsOk = await loadCustomVariables();
      const pagesOk = await loadErrorPages();
      ok = ok && varsOk && pagesOk;
    }
  }
  else if (name === 'security') ok = await loadSecurity();
  else if (name === 'l4') ok = await loadL4Proxies();
  if (ok) loadedTabs.add(name);
}
async function reloadAll() {
  loadedTabs.clear();
  versionsReloadKey.value++;
  originReloadKey.value++;
  edgeReloadKey.value++;
  tasksReloadKey.value++;
  loadBusy.value = true;
  try {
    const preloads: Promise<unknown>[] = [loadZoneInfo(), loadNs(), loadSiteProperties(), loadZonePlans()];
    if (tab.value !== 'domains') preloads.push(loadDomains());
    await Promise.all(preloads);
  } finally {
    loadBusy.value = false;
  }
  if (isEsa.value) {
    esaReloadKey.value++;
    return;
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
    await Promise.all([loadZoneInfo(), loadDomains(), loadNs(), loadRuleSchema(), loadSiteProperties(), loadZonePlans()]);
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
