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
          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.environments') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" :loading="versionEnvLoading" :disabled="versionEnvLoading" @click="loadVersionEnvironments">{{ t('cdnAdvanced.load') }}</n-button>
              </div>
            </div>
            <pre v-if="versionEnvText" class="code-view">{{ versionEnvText }}</pre>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
          </div>

          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.configVersions') }}</h3>
              <div class="app-panel__extra">
                <n-input v-model:value="versionGroupId" :placeholder="t('cdnZoneSetting.groupIdHint')" size="small" style="width: 220px" />
                <n-button size="small" :loading="versionLoading" :disabled="versionLoading || !versionGroupId.trim()" @click="loadVersions">{{ t('cdnAdvanced.load') }}</n-button>
                <n-button size="small" type="primary" @click="openVersionModal('create')">{{ t('cdnZoneSetting.createVersion') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="versionColumns" :data="versionList" size="small" :loading="versionLoading" :empty-text="t('cdnZoneSetting.versionEmpty')" />
          </div>

          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.versionDeploy') }}</h3>
              <div class="app-panel__extra">
                <n-input v-model:value="versionEnvId" :placeholder="t('cdnZoneSetting.envIdHint')" size="small" style="width: 220px" />
                <n-button size="small" type="primary" @click="openVersionModal('deploy')">{{ t('cdnZoneSetting.deployVersion') }}</n-button>
                <n-button size="small" :loading="versionHistoryLoading" :disabled="versionHistoryLoading || !versionEnvId.trim()" @click="loadVersionHistory">{{ t('cdnZoneSetting.versionHistory') }}</n-button>
              </div>
            </div>
            <pre v-if="versionActionText" class="code-view">{{ versionActionText }}</pre>
            <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
          </div>
        </template>

        <!-- ============ 多通道安全网关 ============ -->
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
          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.functions') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openFunction()">{{ t('cdnZoneSetting.create') }}</n-button>
                <n-button size="small" :loading="edgeLoading" :disabled="edgeLoading" @click="loadFunctions">{{ t('cdnAdvanced.refresh') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="functionColumns" :data="functions" size="small" :loading="edgeLoading" :empty-text="t('cdnZoneSetting.functionEmpty')" />
          </div>

          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.functionRules') }}</h3>
              <div class="app-panel__extra">
                <n-button size="small" type="primary" @click="openFunctionRule()">{{ t('cdnZoneSetting.create') }}</n-button>
                <n-button size="small" :loading="edgeLoading" :disabled="edgeLoading" @click="loadFunctionRules">{{ t('cdnAdvanced.refresh') }}</n-button>
              </div>
            </div>
            <ResponsiveDataTable :columns="functionRuleColumns" :data="functionRules" size="small" :loading="edgeLoading" :empty-text="t('cdnZoneSetting.functionRuleEmpty')" />
          </div>

          <div class="app-panel">
            <div class="app-panel__head">
              <h3 class="app-panel__title">{{ t('cdnZoneSetting.kvNamespaces') }}</h3>
              <div class="app-panel__extra">
                <n-tag size="tiny" :bordered="false" class="tnum">{{ kvNamespaces.length }}</n-tag>
              </div>
            </div>
            <div class="zone-form-strip">
              <n-input v-model:value="kvForm.namespace" :placeholder="t('cdnZoneSetting.kvNamespace')" style="width: 180px" size="small" />
              <n-input v-model:value="kvForm.remark" :placeholder="t('cdnZoneSetting.kvRemark')" style="width: 220px" size="small" />
              <n-button size="small" type="primary" :loading="kvSaving" @click="createKvNamespace">{{ t('cdnZoneSetting.create') }}</n-button>
            </div>
            <ResponsiveDataTable :columns="kvNamespaceColumns" :data="kvNamespaces" size="small" :loading="edgeLoading" :empty-text="t('cdnZoneSetting.kvEmpty')" />
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

      <n-modal v-model:show="showFunction" preset="card" :title="functionEditingId ? t('cdnZoneSetting.editFunction') : t('cdnZoneSetting.createFunction')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="functionJson" type="textarea" :rows="16" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.functionJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showFunction = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="functionSaving" :disabled="functionSaving" @click="saveFunction">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-modal v-model:show="showFunctionRule" preset="card" :title="functionRuleEditingId ? t('cdnZoneSetting.editFunctionRule') : t('cdnZoneSetting.createFunctionRule')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="functionRuleJson" type="textarea" :rows="16" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.functionRuleJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showFunctionRule = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="functionRuleSaving" :disabled="functionRuleSaving" @click="saveFunctionRule">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-drawer v-model:show="showKvKeys" placement="right" width="min(900px, 94vw)">
        <n-drawer-content closable :native-scrollbar="false" :title="kvKeyTitle">
          <div class="app-stack">
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.kvKeys') }}</h3>
                <div class="app-panel__extra">
                  <n-input v-model:value="kvPrefix" :placeholder="t('cdnZoneSetting.kvPrefix')" size="small" style="width: 180px" />
                  <n-button size="small" :loading="kvKeyLoading" :disabled="kvKeyLoading" @click="loadKvKeys">{{ t('cdnAdvanced.load') }}</n-button>
                </div>
              </div>
              <pre v-if="kvKeysText" class="code-view">{{ kvKeysText }}</pre>
              <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
            </div>
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.kvData') }}</h3>
              </div>
              <div class="zone-form-strip">
                <n-input v-model:value="kvKeyForm.key" :placeholder="t('cdnZoneSetting.kvKey')" style="width: 180px" size="small" />
                <n-button size="small" :loading="!!busy['kvGet']" :disabled="!!busy['kvGet'] || !kvKeyForm.key" @click="run('kvGet', kvGetKey)">{{ t('cdnZoneSetting.kvGet') }}</n-button>
                <n-button size="small" type="error" :loading="!!busy['kvDel']" :disabled="!!busy['kvDel'] || !kvKeyForm.key" @click="run('kvDel', kvDeleteKey)">{{ t('cdnZoneSetting.delete') }}</n-button>
              </div>
              <n-input v-model:value="kvKeyForm.value" type="textarea" :rows="6" :placeholder="t('cdnZoneSetting.kvValue')" class="mono-input" style="margin-top: 8px" />
              <div class="zone-form-strip" style="margin-top: 8px">
                <n-input v-model:value="kvKeyForm.ttl" :placeholder="t('cdnZoneSetting.kvTtl')" style="width: 160px" size="small" />
                <n-button size="small" type="primary" :loading="!!busy['kvPut']" :disabled="!!busy['kvPut'] || !kvKeyForm.key" @click="run('kvPut', kvPutKey)">{{ t('cdnZoneSetting.kvPut') }}</n-button>
              </div>
              <pre v-if="kvDataText" class="code-view">{{ kvDataText }}</pre>
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <n-drawer v-model:show="showReplicas" placement="right" width="min(900px, 94vw)">
        <n-drawer-content closable :native-scrollbar="false" :title="replicaTitle">
          <div class="app-stack">
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.replicas') }}</h3>
                <div class="app-panel__extra">
                  <n-button size="small" type="primary" @click="openReplicaModal()">{{ t('cdnZoneSetting.create') }}</n-button>
                  <n-button size="small" :loading="replicaLoading" :disabled="replicaLoading" @click="loadReplicas">{{ t('cdnAdvanced.refresh') }}</n-button>
                </div>
              </div>
              <ResponsiveDataTable :columns="replicaColumns" :data="replicas" size="small" :loading="replicaLoading" :empty-text="t('cdnZoneSetting.replicaEmpty')" />
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <n-drawer v-model:show="showBindings" placement="right" width="min(900px, 94vw)">
        <n-drawer-content closable :native-scrollbar="false" :title="bindingTitle">
          <div class="app-stack">
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.bindings') }}</h3>
                <div class="app-panel__extra">
                  <n-button size="small" type="primary" @click="openBindingModal">{{ t('cdnZoneSetting.edit') }}</n-button>
                  <n-button size="small" :loading="bindingLoading" :disabled="bindingLoading" @click="loadBindings">{{ t('cdnAdvanced.refresh') }}</n-button>
                </div>
              </div>
              <pre v-if="bindingText" class="code-view">{{ bindingText }}</pre>
              <span v-else class="hint-text">{{ t('cdnZoneSetting.empty') }}</span>
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <n-drawer v-model:show="showRuntime" placement="right" width="min(900px, 94vw)">
        <n-drawer-content closable :native-scrollbar="false" :title="runtimeTitle">
          <div class="app-stack">
            <div class="app-panel">
              <div class="app-panel__head">
                <h3 class="app-panel__title">{{ t('cdnZoneSetting.runtime') }}</h3>
                <div class="app-panel__extra">
                  <n-button size="small" :loading="runtimeLoading" :disabled="runtimeLoading" @click="loadRuntime">{{ t('cdnAdvanced.load') }}</n-button>
                  <n-button size="small" type="primary" :loading="runtimeSaving" :disabled="runtimeSaving" @click="saveRuntime">{{ t('cdnZoneSetting.save') }}</n-button>
                </div>
              </div>
              <n-input v-model:value="runtimeJson" type="textarea" :rows="14" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.runtimeJsonHint')" />
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>

      <n-modal v-model:show="showReplicaModal" preset="card" :title="replicaEditingName ? t('cdnZoneSetting.editReplica') : t('cdnZoneSetting.createReplica')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="replicaJson" type="textarea" :rows="14" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.replicaJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showReplicaModal = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="replicaSaving" :disabled="replicaSaving" @click="saveReplica">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-modal v-model:show="showBindingModal" preset="card" :title="t('cdnZoneSetting.bindings')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="bindingJson" type="textarea" :rows="12" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.bindingJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showBindingModal = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="bindingSaving" :disabled="bindingSaving" @click="saveBindings">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
      </n-modal>

      <n-modal v-model:show="showVersionModal" preset="card" :title="versionModalMode === 'create' ? t('cdnZoneSetting.createVersion') : t('cdnZoneSetting.deployVersion')" class="modal-lg" :mask-closable="false">
        <n-input v-model:value="versionJson" type="textarea" :rows="16" class="mono-input" spellcheck="false" :placeholder="t('cdnZoneSetting.versionJsonHint')" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="showVersionModal = false">{{ t('cdnZoneSetting.cancel') }}</n-button>
            <n-button type="primary" :loading="versionSaving" :disabled="versionSaving" @click="saveVersionModal">{{ t('cdnZoneSetting.save') }}</n-button>
          </n-space>
        </template>
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
import CdnZonePlatform from '../components/cdn/CdnZonePlatform.vue';
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
  // 由后端按账户 + 站点过滤，替代拉全量后在本地筛选
  const res = await api<any>('GET', '/cdn/domains', { aid, zone_id: zoneId });
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
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 160,
    render: (r: any) =>
      h('div', { class: 'row-actions' }, [
        ...(caps.value.loadBalancerHealth
          ? [h(NButton, { size: 'tiny', quaternary: true, onClick: () => showLbHealth(r) }, { default: () => t('cdnOrigin.health') })]
          : []),
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delLoadBalancer(r) }, { default: () => t('cdnZoneSetting.delete') }),
      ]),
  },
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
async function showLbHealth(r: any) {
  const res = await api<any>('GET', `/cdn/accounts/${aid}/load-balancers/${encodeURIComponent(String(r.instanceId))}/health`, { zoneId });
  if (res.code !== 0) return message.error(res.msg);
  dialog.info({
    title: t('cdnOrigin.healthTitle', { name: r.name || r.instanceId }),
    content: () => h('pre', { class: 'code-view', style: 'max-height:480px' }, JSON.stringify(res.data || [], null, 2)),
  });
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

const functions = ref<any[]>([]);
const functionRules = ref<any[]>([]);
const kvNamespaces = ref<any[]>([]);
const edgeLoading = ref(false);
const showFunction = ref(false);
const functionEditingId = ref('');
const functionJson = ref('');
const functionSaving = ref(false);
const showFunctionRule = ref(false);
const functionRuleEditingId = ref('');
const functionRuleJson = ref('');
const functionRuleSaving = ref(false);
const kvForm = reactive<any>({ namespace: '', remark: '' });
const kvSaving = ref(false);
const showKvKeys = ref(false);
const kvKeyNamespace = ref('');
const kvPrefix = ref('');
const kvKeysText = ref('');
const kvKeyLoading = ref(false);
const kvKeyForm = reactive<any>({ key: '', value: '', ttl: '' });
const kvDataText = ref('');
const functionColumns = computed(() => [
  { title: 'FunctionId', key: 'FunctionId', minWidth: 160 },
  { title: t('cdnSecurity.ruleName'), key: 'Name', minWidth: 160 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 320, render: (r: any) => h('div', { class: 'row-actions' }, [
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openFunction(r) }, { default: () => t('cdnZoneSetting.edit') }),
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openReplicas(r) }, { default: () => t('cdnZoneSetting.replicas') }),
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openBindings(r) }, { default: () => t('cdnZoneSetting.bindings') }),
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openRuntime(r) }, { default: () => t('cdnZoneSetting.runtime') }),
    h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delFunction(r) }, { default: () => t('cdnZoneSetting.delete') }),
  ]) },
]);
const functionRuleColumns = computed(() => [
  { title: 'RuleId', key: 'RuleId', minWidth: 160 },
  { title: 'TriggerType', key: 'TriggerType', width: 130 },
  { title: 'Priority', key: 'Priority', width: 90 },
  { title: 'Remark', key: 'Remark', minWidth: 180 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 150, render: (r: any) => h('div', { class: 'row-actions' }, [
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openFunctionRule(r) }, { default: () => t('cdnZoneSetting.edit') }),
    h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delFunctionRule(r) }, { default: () => t('cdnZoneSetting.delete') }),
  ]) },
]);
const kvNamespaceColumns = computed(() => [
  { title: t('cdnZoneSetting.kvNamespace'), key: 'Namespace', minWidth: 180 },
  { title: t('cdnZoneSetting.kvRemark'), key: 'Remark', minWidth: 200 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 180, render: (r: any) => h('div', { class: 'row-actions' }, [
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openKvKeys(r) }, { default: () => t('cdnZoneSetting.kvData') }),
    h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delKvNamespace(r) }, { default: () => t('cdnZoneSetting.delete') }),
  ]) },
]);
const kvKeyTitle = computed(() => `${t('cdnZoneSetting.kvData')} · ${kvKeyNamespace.value}`);

async function loadFunctions(): Promise<boolean> {
  if (!caps.value.functions) return true;
  edgeLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/functions`, { zoneId });
    functions.value = res.code === 0 ? res.data || [] : [];
    return res.code === 0;
  } finally {
    edgeLoading.value = false;
  }
}

function openFunction(row?: any) {
  functionEditingId.value = row ? String(row.FunctionId || '') : '';
  functionJson.value = JSON.stringify(row ? { Content: row.Content || '', Remark: row.Remark || '' } : { Name: '', Content: '', Remark: '' }, null, 2);
  showFunction.value = true;
}

async function saveFunction() {
  let parsed: any;
  try {
    parsed = JSON.parse(functionJson.value);
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  functionSaving.value = true;
  try {
    const res: any = functionEditingId.value
      ? await api('PUT', `/cdn/accounts/${aid}/functions/${encodeURIComponent(functionEditingId.value)}`, { zoneId, params: parsed })
      : await api('POST', `/cdn/accounts/${aid}/functions`, { zoneId, params: parsed });
    if (res.code === 0) {
      message.success(res.msg);
      showFunction.value = false;
      await loadFunctions();
    } else message.error(res.msg);
  } finally {
    functionSaving.value = false;
  }
}

function delFunction(r: any) {
  dialog.warning({ title: t('cdnZoneSetting.delete'), content: t('cdnAdvanced.confirmDelete', { name: r.Name || r.FunctionId }), positiveText: t('cdnZoneSetting.delete'), negativeText: t('cdnZoneSetting.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cdn/accounts/${aid}/functions/${encodeURIComponent(String(r.FunctionId))}`, { zoneId });
    if (res.code === 0) { message.success(res.msg); await loadFunctions(); } else message.error(res.msg);
  } });
}

async function loadFunctionRules(): Promise<boolean> {
  if (!caps.value.functions) return true;
  edgeLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/function-rules`, { zoneId });
    functionRules.value = res.code === 0 ? res.data || [] : [];
    return res.code === 0;
  } finally {
    edgeLoading.value = false;
  }
}

function openFunctionRule(row?: any) {
  functionRuleEditingId.value = row ? String(row.RuleId || '') : '';
  functionRuleJson.value = JSON.stringify(row || { FunctionRuleConditions: [{ RuleConditions: [] }], TriggerType: 'direct', FunctionId: '', Remark: '' }, null, 2);
  showFunctionRule.value = true;
}

async function saveFunctionRule() {
  let parsed: any;
  try {
    parsed = JSON.parse(functionRuleJson.value);
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  functionRuleSaving.value = true;
  try {
    const res: any = functionRuleEditingId.value
      ? await api('PUT', `/cdn/accounts/${aid}/function-rules/${encodeURIComponent(functionRuleEditingId.value)}`, { zoneId, params: parsed })
      : await api('POST', `/cdn/accounts/${aid}/function-rules`, { zoneId, params: parsed });
    if (res.code === 0) {
      message.success(res.msg);
      showFunctionRule.value = false;
      await loadFunctionRules();
    } else message.error(res.msg);
  } finally {
    functionRuleSaving.value = false;
  }
}

function delFunctionRule(r: any) {
  dialog.warning({ title: t('cdnZoneSetting.delete'), content: t('cdnAdvanced.confirmDelete', { name: r.Remark || r.RuleId }), positiveText: t('cdnZoneSetting.delete'), negativeText: t('cdnZoneSetting.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cdn/accounts/${aid}/function-rules`, { zoneId, ruleIds: [String(r.RuleId)] });
    if (res.code === 0) { message.success(res.msg); await loadFunctionRules(); } else message.error(res.msg);
  } });
}

async function loadKvNamespaces(): Promise<boolean> {
  if (!caps.value.kv) return true;
  edgeLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/kv/namespaces`, { zoneId, page: 1, size: 100 });
    kvNamespaces.value = res.code === 0 ? res.data?.list || [] : [];
    return res.code === 0;
  } finally {
    edgeLoading.value = false;
  }
}

async function createKvNamespace() {
  if (!kvForm.namespace.trim()) return message.warning(t('cdnZoneSetting.kvNamespace'));
  kvSaving.value = true;
  try {
    const res = await api('POST', `/cdn/accounts/${aid}/kv/namespaces`, { zoneId, namespace: kvForm.namespace.trim(), remark: kvForm.remark.trim() || undefined });
    if (res.code === 0) { message.success(res.msg); kvForm.namespace = ''; kvForm.remark = ''; await loadKvNamespaces(); } else message.error(res.msg);
  } finally {
    kvSaving.value = false;
  }
}

function delKvNamespace(r: any) {
  dialog.warning({ title: t('cdnZoneSetting.delete'), content: t('cdnAdvanced.confirmDelete', { name: r.Namespace }), positiveText: t('cdnZoneSetting.delete'), negativeText: t('cdnZoneSetting.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(String(r.Namespace))}`, { zoneId });
    if (res.code === 0) { message.success(res.msg); await loadKvNamespaces(); } else message.error(res.msg);
  } });
}

function openKvKeys(r: any) {
  kvKeyNamespace.value = String(r.Namespace || '');
  kvPrefix.value = '';
  kvKeysText.value = '';
  kvDataText.value = '';
  kvKeyForm.key = '';
  kvKeyForm.value = '';
  kvKeyForm.ttl = '';
  showKvKeys.value = true;
  loadKvKeys();
}

async function loadKvKeys() {
  if (!kvKeyNamespace.value) return;
  kvKeyLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(kvKeyNamespace.value)}/keys`, { zoneId, prefix: kvPrefix.value.trim(), limit: 100 });
    if (res.code === 0) kvKeysText.value = JSON.stringify(res.data || {}, null, 2);
    else message.error(res.msg);
  } finally {
    kvKeyLoading.value = false;
  }
}

async function kvGetKey() {
  if (!kvKeyForm.key.trim()) return message.warning(t('cdnZoneSetting.kvKey'));
  const res = await api<any>('POST', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(kvKeyNamespace.value)}/get`, { zoneId, keys: [kvKeyForm.key.trim()] });
  if (res.code === 0) kvDataText.value = JSON.stringify(res.data || [], null, 2);
  else message.error(res.msg);
}

async function kvPutKey() {
  if (!kvKeyForm.key.trim()) return message.warning(t('cdnZoneSetting.kvKey'));
  const res = await api<any>('POST', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(kvKeyNamespace.value)}/put`, { zoneId, key: kvKeyForm.key.trim(), value: kvKeyForm.value, ttl: kvKeyForm.ttl ? Number(kvKeyForm.ttl) : undefined });
  if (res.code === 0) { message.success(res.msg); await loadKvKeys(); await kvGetKey(); } else message.error(res.msg);
}

async function kvDeleteKey() {
  if (!kvKeyForm.key.trim()) return message.warning(t('cdnZoneSetting.kvKey'));
  const res = await api<any>('POST', `/cdn/accounts/${aid}/kv/namespaces/${encodeURIComponent(kvKeyNamespace.value)}/delete`, { zoneId, keys: [kvKeyForm.key.trim()] });
  if (res.code === 0) { message.success(res.msg); kvDataText.value = ''; await loadKvKeys(); } else message.error(res.msg);
}

const showReplicas = ref(false);
const replicaFunctionId = ref('');
const replicas = ref<any[]>([]);
const replicaLoading = ref(false);
const showReplicaModal = ref(false);
const replicaEditingName = ref('');
const replicaJson = ref('');
const replicaSaving = ref(false);
const replicaTitle = computed(() => `${t('cdnZoneSetting.replicas')} · ${replicaFunctionId.value}`);
const replicaColumns = computed(() => [
  { title: 'ReplicaName', key: 'ReplicaName', minWidth: 180 },
  { title: 'Remark', key: 'Remark', minWidth: 180 },
  { title: t('cdnOrigin.colActions'), key: 'actions', width: 150, render: (r: any) => h('div', { class: 'row-actions' }, [
    h(NButton, { size: 'tiny', quaternary: true, onClick: () => openReplicaModal(r) }, { default: () => t('cdnZoneSetting.edit') }),
    h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => delReplica(r) }, { default: () => t('cdnZoneSetting.delete') }),
  ]) },
]);
const showBindings = ref(false);
const bindingFunctionId = ref('');
const bindingText = ref('');
const bindingLoading = ref(false);
const showBindingModal = ref(false);
const bindingJson = ref('');
const bindingSaving = ref(false);
const bindingTitle = computed(() => `${t('cdnZoneSetting.bindings')} · ${bindingFunctionId.value}`);
const showRuntime = ref(false);
const runtimeFunctionId = ref('');
const runtimeJson = ref('');
const runtimeLoading = ref(false);
const runtimeSaving = ref(false);
const runtimeTitle = computed(() => `${t('cdnZoneSetting.runtime')} · ${runtimeFunctionId.value}`);

function openReplicas(r: any) {
  replicaFunctionId.value = String(r.FunctionId || '');
  showReplicas.value = true;
  loadReplicas();
}

async function loadReplicas() {
  if (!replicaFunctionId.value) return;
  replicaLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/functions/${encodeURIComponent(replicaFunctionId.value)}/replicas`, { zoneId, page: 1, size: 100 });
    replicas.value = res.code === 0 ? res.data?.list || [] : [];
    if (res.code !== 0) message.error(res.msg);
  } finally {
    replicaLoading.value = false;
  }
}

function openReplicaModal(row?: any) {
  replicaEditingName.value = row ? String(row.ReplicaName || '') : '';
  replicaJson.value = JSON.stringify(row ? { ReplicaName: row.ReplicaName, Content: row.Content || '', Remark: row.Remark || '' } : { ReplicaName: '', Content: '', Remark: '' }, null, 2);
  showReplicaModal.value = true;
}

async function saveReplica() {
  let parsed: any;
  try { parsed = JSON.parse(replicaJson.value); } catch { return message.error(t('cdnSecurity.invalidJson')); }
  replicaSaving.value = true;
  try {
    const res: any = replicaEditingName.value
      ? await api('PUT', `/cdn/accounts/${aid}/functions/${encodeURIComponent(replicaFunctionId.value)}/replicas/${encodeURIComponent(replicaEditingName.value)}`, { zoneId, params: parsed })
      : await api('POST', `/cdn/accounts/${aid}/functions/${encodeURIComponent(replicaFunctionId.value)}/replicas`, { zoneId, params: parsed });
    if (res.code === 0) { message.success(res.msg); showReplicaModal.value = false; await loadReplicas(); } else message.error(res.msg);
  } finally {
    replicaSaving.value = false;
  }
}

function delReplica(r: any) {
  dialog.warning({ title: t('cdnZoneSetting.delete'), content: t('cdnAdvanced.confirmDelete', { name: r.ReplicaName }), positiveText: t('cdnZoneSetting.delete'), negativeText: t('cdnZoneSetting.cancel'), onPositiveClick: async () => {
    const res = await api('DELETE', `/cdn/accounts/${aid}/functions/${encodeURIComponent(replicaFunctionId.value)}/replicas`, { zoneId, replicaNames: [String(r.ReplicaName)] });
    if (res.code === 0) { message.success(res.msg); await loadReplicas(); } else message.error(res.msg);
  } });
}

function openBindings(r: any) {
  bindingFunctionId.value = String(r.FunctionId || '');
  bindingText.value = '';
  showBindings.value = true;
  loadBindings();
}

async function loadBindings() {
  if (!bindingFunctionId.value) return;
  bindingLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/functions/${encodeURIComponent(bindingFunctionId.value)}/bindings`, { zoneId });
    if (res.code === 0) bindingText.value = JSON.stringify(res.data || [], null, 2);
    else message.error(res.msg);
  } finally {
    bindingLoading.value = false;
  }
}

function openBindingModal() {
  bindingJson.value = JSON.stringify({ Operation: 'bind', FunctionComponentBindings: [] }, null, 2);
  showBindingModal.value = true;
}

async function saveBindings() {
  let parsed: any;
  try { parsed = JSON.parse(bindingJson.value); } catch { return message.error(t('cdnSecurity.invalidJson')); }
  bindingSaving.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/functions/${encodeURIComponent(bindingFunctionId.value)}/bindings`, { zoneId, params: parsed });
    if (res.code === 0) { message.success(res.msg); showBindingModal.value = false; await loadBindings(); } else message.error(res.msg);
  } finally {
    bindingSaving.value = false;
  }
}

function openRuntime(r: any) {
  runtimeFunctionId.value = String(r.FunctionId || '');
  runtimeJson.value = '';
  showRuntime.value = true;
  loadRuntime();
}

async function loadRuntime() {
  if (!runtimeFunctionId.value) return;
  runtimeLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/functions/${encodeURIComponent(runtimeFunctionId.value)}/runtime`, { zoneId });
    if (res.code === 0) runtimeJson.value = JSON.stringify(res.data || {}, null, 2);
    else message.error(res.msg);
  } finally {
    runtimeLoading.value = false;
  }
}

async function saveRuntime() {
  let parsed: any;
  try { parsed = JSON.parse(runtimeJson.value); } catch { return message.error(t('cdnSecurity.invalidJson')); }
  runtimeSaving.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${aid}/functions/${encodeURIComponent(runtimeFunctionId.value)}/runtime`, { zoneId, params: parsed });
    if (res.code === 0) { message.success(res.msg); await loadRuntime(); } else message.error(res.msg);
  } finally {
    runtimeSaving.value = false;
  }
}

const versionEnvText = ref('');
const versionEnvLoading = ref(false);
const versionGroupId = ref('');
const versionEnvId = ref('');
const versionList = ref<any[]>([]);
const versionLoading = ref(false);
const versionHistoryLoading = ref(false);
const versionActionText = ref('');
const showVersionModal = ref(false);
const versionModalMode = ref<'create' | 'deploy'>('create');
const versionJson = ref('');
const versionSaving = ref(false);
const versionColumns = computed(() => [
  { title: 'VersionId', key: 'VersionId', minWidth: 170 },
  { title: 'VersionNumber', key: 'VersionNumber', width: 120 },
  { title: 'GroupType', key: 'GroupType', width: 140 },
  { title: t('cdnRules.colStatus'), key: 'Status', width: 110 },
  { title: 'Description', key: 'Description', minWidth: 180 },
  {
    title: t('cdnOrigin.colActions'),
    key: 'actions',
    width: 100,
    render: (r: any) => h(NButton, { size: 'tiny', quaternary: true, onClick: () => showVersionDetail(r) }, { default: () => t('cdnSecurity.detail') }),
  },
]);

async function loadVersionEnvironments() {
  versionEnvLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/environments`);
    if (res.code === 0) versionEnvText.value = JSON.stringify(res.data || [], null, 2);
    else message.error(res.msg);
  } finally {
    versionEnvLoading.value = false;
  }
}

async function loadVersions() {
  if (!versionGroupId.value.trim()) return message.warning(t('cdnZoneSetting.groupIdHint'));
  versionLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/versions`, { groupId: versionGroupId.value.trim(), page: 1, size: 100 });
    versionList.value = res.code === 0 ? res.data?.list || [] : [];
    if (res.code !== 0) message.error(res.msg);
  } finally {
    versionLoading.value = false;
  }
}

function openVersionModal(mode: 'create' | 'deploy') {
  versionModalMode.value = mode;
  versionJson.value = JSON.stringify(
    mode === 'create'
      ? { GroupId: versionGroupId.value.trim(), Content: '', Description: '' }
      : { EnvId: versionEnvId.value.trim(), ConfigGroupVersionInfos: [{ VersionId: '' }], Description: '' },
    null,
    2,
  );
  showVersionModal.value = true;
}

async function saveVersionModal() {
  let parsed: any;
  try {
    parsed = JSON.parse(versionJson.value);
  } catch {
    return message.error(t('cdnSecurity.invalidJson'));
  }
  versionSaving.value = true;
  try {
    const suffix = versionModalMode.value === 'create' ? '' : '/deploy';
    const res = await api<any>('POST', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/versions${suffix}`, { params: parsed });
    if (res.code === 0) {
      message.success(res.msg);
      showVersionModal.value = false;
      if (versionModalMode.value === 'create') await loadVersions();
      else versionActionText.value = JSON.stringify(res.data || {}, null, 2);
    } else message.error(res.msg);
  } finally {
    versionSaving.value = false;
  }
}

async function showVersionDetail(row: any) {
  const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/versions/${encodeURIComponent(String(row.VersionId))}`);
  if (res.code !== 0) return message.error(res.msg);
  dialog.info({ title: `Version · ${row.VersionId}`, content: () => h('pre', { class: 'code-view', style: 'max-height:480px' }, JSON.stringify(res.data || {}, null, 2)) });
}

async function loadVersionHistory() {
  if (!versionEnvId.value.trim()) return message.warning(t('cdnZoneSetting.envIdHint'));
  versionHistoryLoading.value = true;
  try {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/sites/${encodeURIComponent(zoneId)}/versions/history`, { envId: versionEnvId.value.trim() });
    if (res.code === 0) versionActionText.value = JSON.stringify(res.data?.list || [], null, 2);
    else message.error(res.msg);
  } finally {
    versionHistoryLoading.value = false;
  }
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
  } else if (name === 'origin') ok = await loadOriginData();
  else if (name === 'rules') {
    ok = await loadRules();
    if (!isEsa.value) {
      const varsOk = await loadCustomVariables();
      const pagesOk = await loadErrorPages();
      ok = ok && varsOk && pagesOk;
    }
  }
  else if (name === 'security') ok = await loadSecurity();
  else if (name === 'edge') {
    const fOk = await loadFunctions();
    const rOk = await loadFunctionRules();
    const kvOk = await loadKvNamespaces();
    ok = fOk && rOk && kvOk;
  } else if (name === 'versions') {
    if (!versionEnvText.value) await loadVersionEnvironments();
    if (versionGroupId.value.trim()) ok = await (loadVersions().then(() => true).catch(() => false));
  }
  else if (name === 'l4') ok = await loadL4Proxies();
  else if (name === 'tasks') {
    ok = await loadTasks();
    if (!isEsa.value) {
      const logsOk = await loadRealtimeLogs();
      const cidOk = await loadContentIdentifiers();
      ok = ok && logsOk && cidOk;
    }
  }
  if (ok) loadedTabs.add(name);
}
async function reloadAll() {
  loadedTabs.clear();
  loadBusy.value = true;
  try {
    await Promise.all([loadZoneInfo(), loadDomains(), loadNs(), loadSiteProperties(), loadZonePlans()]);
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
