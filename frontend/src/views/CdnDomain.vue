<template>
  <div class="app-stack">
    <PageHeader :title="t('cdnDomain.title')" :subtitle="t('cdnDomain.subtitle')">
      <template #actions>
        <n-space>
          <n-button v-if="canFreeCert" type="primary" secondary :disabled="!checkedIds.length" @click="openFreeCert(checkedIds)">
            {{ t('cdnDomain.freeCert') }}<template v-if="checkedIds.length">（{{ checkedIds.length }}）</template>
          </n-button>
          <n-button v-if="canCertApply" type="primary" secondary :disabled="!checkedIds.length" @click="openCertLink(checkedIds)">
            {{ t('cdnDomain.certLink') }}<template v-if="checkedIds.length">（{{ checkedIds.length }}）</template>
          </n-button>
          <n-button @click="goZones">{{ t('cdnDomain.zoneSetting') }}</n-button>
          <n-button type="primary" @click="openAdd">
            <template #icon><n-icon :component="AddOutline" /></template>
            {{ t('cdnDomain.addDomain') }}
          </n-button>
          <n-button @click="showSync = true">
            <template #icon><n-icon :component="CloudDownloadOutline" /></template>
            {{ t('cdnDomain.syncCloud') }}
          </n-button>
        </n-space>
      </template>
    </PageHeader>
    <n-grid class="telemetry-row" cols="2 s:3 m:3" responsive="screen" :x-gap="14" :y-gap="14" item-responsive>
      <n-grid-item v-reveal class="d1"><TelemetryCard :label="t('dashboard.statCdnDomains')" :value="domains.length" tone="primary" :icon="GlobeOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="d2"><TelemetryCard :label="t('nav.cdnAccounts')" :value="accountOptions.length" tone="success" :icon="CloudOutline" :caption="t('common.cumulative')" /></n-grid-item>
      <n-grid-item v-reveal class="d3"><TelemetryCard :label="t('common.selected')" :value="checkedIds.length" tone="info" :icon="CheckmarkCircleOutline" :caption="t('common.cumulative')" /></n-grid-item>
    </n-grid>
    <n-card :bordered="false">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnDomain.overview') }}</h3>
        </div>
        <n-descriptions :column="3" size="small" label-placement="top">
          <n-descriptions-item :label="t('cdnDomain.statusEnabled')">{{ enabledCount }}</n-descriptions-item>
          <n-descriptions-item :label="t('cdnDomain.statusStopped')">{{ stoppedCount }}</n-descriptions-item>
          <n-descriptions-item :label="t('cdnDomain.certPending')">{{ certPendingCount }}</n-descriptions-item>
        </n-descriptions>
      </div>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('cdnDomain.listTitle') }}</h3>
        </div>
        <ResponsiveDataTable
          :columns="columns"
          :data="domains"
          :loading="loadBusy"
          :row-key="(row: any) => row.id"
          v-model:checked-row-keys="checkedIds"
          :empty-text="t('cdnDomain.empty')"
          :virtual-scroll="domains.length > 200"
          :max-height="620"
        />
      </div>
    </n-card>

    <!-- 接入域名：每步独立弹窗，下一步/上一步切换弹窗 -->
    <n-modal :show="showAdd && stepKey === 'account'" preset="card" :title="t('cdnDomain.addTitle1')" class="modal-md" :mask-closable="false" @update:show="(v: boolean) => (showAdd = v)">
      <n-form label-placement="left" label-width="110" class="add-form">
        <n-form-item :label="t('cdnDomain.account')">
          <n-select v-model:value="form.aid" :options="accountOptions" @update:value="onAccountChange" />
        </n-form-item>
        <n-form-item v-if="addFlow.zone.needed" :label="addFlow.zone.label">
          <n-select v-model:value="form.zone_id" :options="zoneOptions" :placeholder="t('cdnDomain.selectZone', { label: addFlow.zone.label })" @update:value="onZoneChange" />
        </n-form-item>
        <n-form-item v-if="addFlow.serviceArea.needed" :label="t('cdnDomain.serviceArea')">
          <n-select v-model:value="form.service_area" :options="serviceAreaOptions" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAdd = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" @click="nextAddStep">{{ t('cdnDomain.next') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal :show="showAdd && stepKey === 'domain'" preset="card" :title="t('cdnDomain.addTitle2')" class="modal-md" :mask-closable="false" @update:show="(v: boolean) => (showAdd = v)">
      <n-form label-placement="left" label-width="110" class="add-form">
        <n-form-item :label="t('cdnDomain.accelDomain')">
          <n-input-group v-if="form.zone_name">
            <n-input v-model:value="form.sub" :placeholder="t('cdnDomain.subPlaceholder')" />
            <n-input-group-label>.{{ form.zone_name }}</n-input-group-label>
          </n-input-group>
          <n-input v-else v-model:value="form.name" :placeholder="t('cdnDomain.namePlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('cdnDomain.linkedDomain')">
          <n-tag v-if="matchedDomain" type="success" :bordered="false">{{ matchedDomain }}</n-tag>
          <span v-else-if="form.name" class="link-warn">{{ t('cdnDomain.linkWarn') }}</span>
          <span v-else class="link-hint">{{ form.zone_name ? t('cdnDomain.matchSub') : t('cdnDomain.matchName') }}</span>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="space-between" class="cert-actions" style="width:100%">
          <n-button @click="addStep--">{{ t('cdnDomain.prev') }}</n-button>
          <n-button type="primary" @click="nextAddStep">{{ t('cdnDomain.next') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal :show="showAdd && stepKey === 'origin'" preset="card" :title="t('cdnDomain.addTitle3')" class="modal-md" :mask-closable="false" @update:show="(v: boolean) => (showAdd = v)">
      <n-form label-placement="left" label-width="110" class="add-form">
        <n-form-item :label="t('cdnDomain.origin')">
          <n-input v-model:value="form.origin" :placeholder="t('cdnDomain.originPlaceholder')" />
        </n-form-item>
        <n-form-item :label="t('cdnDomain.originType')">
          <n-radio-group v-model:value="form.origin_type">
            <n-radio value="ipaddr">{{ t('cdnDomain.originTypeIp') }}</n-radio>
            <n-radio value="domain">{{ t('cdnDomain.originTypeDomain') }}</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="addFlow.origin.protocol" :label="t('cdnDomain.originProtocol')">
          <n-radio-group v-model:value="form.origin_protocol">
            <n-radio value="follow">{{ t('cdnDomain.protoFollow') }}</n-radio>
            <n-radio value="http">HTTP</n-radio>
            <n-radio value="https">HTTPS</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="addFlow.origin.ports" :label="t('cdnDomain.originPort')">
          <n-space align="center">
            <span class="port-label">HTTP</span>
            <n-input-number v-model:value="form.http_port" :min="1" :max="65535" style="width:110px" placeholder="80" />
            <span class="port-label">HTTPS</span>
            <n-input-number v-model:value="form.https_port" :min="1" :max="65535" style="width:110px" placeholder="443" />
          </n-space>
        </n-form-item>
        <n-form-item v-if="addFlow.origin.host" :label="t('cdnDomain.originHost')">
          <n-space vertical style="width:100%">
            <n-radio-group v-model:value="form.origin_host_mode">
              <n-space :wrap="true">
                <n-radio value="accelerate">{{ t('cdnDomain.hostAccelerate') }}</n-radio>
                <n-radio value="origin">{{ t('cdnDomain.hostOrigin') }}</n-radio>
                <n-radio value="custom">{{ t('cdnDomain.custom') }}</n-radio>
              </n-space>
            </n-radio-group>
            <n-input v-if="form.origin_host_mode === 'custom'" v-model:value="form.origin_host_custom" :placeholder="t('cdnDomain.hostCustomPlaceholder')" />
          </n-space>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="space-between" class="cert-actions" style="width:100%">
          <n-button @click="addStep--">{{ t('cdnDomain.prev') }}</n-button>
          <n-button type="primary" @click="nextAddStep">{{ t('cdnDomain.next') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      :show="showAdd && stepKey === 'scene'"
      preset="card"
      :title="t('cdnDomain.addTitleScene')"
      class="modal-md"
      :mask-closable="false"
      @update:show="(v: boolean) => (showAdd = v)"
    >
      <n-alert type="info" :show-icon="true" class="cert-tip">{{ t('cdnDomain.sceneSkipHint') }}</n-alert>
      <n-form label-placement="left" label-width="110" class="add-form">
        <n-form-item :label="t('cdnDomain.sceneLabel')">
          <n-space vertical style="width: 100%">
            <n-space align="center" :wrap="true">
              <n-button secondary type="primary" @click="showScenePicker = true">
                {{ form.scene_id ? t('cdnDomain.sceneChange') : t('cdnDomain.scenePick') }}
              </n-button>
              <n-tag v-if="form.scene_id" type="success" :bordered="false">
                {{ form.scene_label }}（{{ t(form.scene_source === 'official' ? 'cdnDomain.sceneOfficial' : 'cdnDomain.sceneProject') }}）
              </n-tag>
              <n-button v-if="form.scene_id" text type="error" @click="clearScene">{{ t('cdnDomain.sceneClear') }}</n-button>
            </n-space>
            <span v-if="form.scene_id" class="link-hint">{{ t('cdnDomain.sceneHostNote', { domain: form.name }) }}</span>
          </n-space>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="space-between" class="cert-actions" style="width: 100%">
          <n-button @click="addStep--">{{ t('cdnDomain.prev') }}</n-button>
          <n-button type="primary" @click="addStep++">{{ t('cdnDomain.next') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal :show="showAdd && stepKey === 'cert'" preset="card" :title="t('cdnDomain.addTitle4')" class="modal-md" :mask-closable="false" @update:show="(v: boolean) => (showAdd = v)">
      <div class="add-form">
        <n-form-item v-if="certModeOptions.length > 1" :label="t('cdnDomain.certSetting')" label-placement="left" label-width="110">
          <n-radio-group v-model:value="form.cert_mode">
            <n-space vertical>
              <n-radio v-for="o in certModeOptions" :key="o.value" :value="o.value">{{ o.label }}</n-radio>
            </n-space>
          </n-radio-group>
        </n-form-item>
        <n-alert v-else type="info" :show-icon="true" class="cert-tip">{{ t('cdnDomain.certNotNeeded') }}</n-alert>

        <template v-if="form.cert_mode === 'certlink'">
          <n-alert type="info" :show-icon="true" class="cert-tip">{{ t('cdnDomain.certLinkHint') }}</n-alert>
          <n-space align="center" class="cert-tip">
            <n-button size="small" @click="pickCertSource">{{ t('cdnDomain.pickCertSource') }}</n-button>
            <span class="link-meta">{{ form.cert_choice_label || t('cdnDomain.notSelected') }}</span>
          </n-space>
        </template>
        <n-alert v-else-if="form.cert_mode === 'freecert'" type="info" :show-icon="true" class="cert-tip">{{ t('cdnDomain.freeCertHint') }}</n-alert>
        <n-alert v-else-if="form.cert_mode === 'certapply'" type="info" :show-icon="true" class="cert-tip">{{ t('cdnDomain.certApplyHint') }}</n-alert>
      </div>
      <template #footer>
        <n-space justify="space-between" class="cert-actions" style="width:100%">
          <n-button @click="addStep--">{{ t('cdnDomain.prev') }}</n-button>
          <n-button type="primary" :loading="saveBusy" @click="submitAdd">{{ t('cdnDomain.submitAdd') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 加速场景两级选择 -->
    <RuleCreatePicker v-model:show="showScenePicker" mode="scene" @select="onSceneSource" />
    <RuleTemplatePicker v-model:show="showSceneTemplate" :source="sceneSource" @select="onSceneTemplate" />

    <!-- 同步云端弹窗 -->
    <n-modal v-model:show="showSync" preset="card" :title="t('cdnDomain.syncTitle')" class="modal-sm" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('cdnDomain.account')">
          <n-select v-model:value="syncAid" :options="accountOptions" />
        </n-form-item>
        <n-form-item :label="t('cdnDomain.linkedDomain')">
          <n-select v-model:value="syncDid" :options="[{ label: t('common.all'), value: 0 }, ...dnsDomainOptions]" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showSync = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="syncBusy" @click="doSync">{{ t('cdnDomain.startSync') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 证书弹窗（平台免费证书 / 证书申请联动） -->
    <n-modal v-model:show="showCert" preset="card" :title="certMode === 'link' ? t('cdnDomain.certLink') : t('cdnDomain.freeCert')" class="modal-md" :mask-closable="false">
      <n-spin :show="certRunBusy">
        <n-alert v-if="certMode === 'link'" type="info" :show-icon="true" class="cert-tip">
          {{ t('cdnDomain.certLinkDesc') }}
        </n-alert>
        <n-alert v-else type="info" :show-icon="true" class="cert-tip">
          {{ t('cdnDomain.freeCertDesc') }}
        </n-alert>
        <n-alert v-if="certSummary" :type="summaryType" :show-icon="true" class="cert-tip">{{ certSummary }}</n-alert>

        <n-list v-if="certResults.length" bordered class="cert-list">
          <n-list-item v-for="r in certResults" :key="r.id">
            <div class="cert-head">
              <span class="cert-name">{{ r.name || '#' + r.id }}</span>
              <n-tag :type="statusType(r.status)" size="small" :bordered="false">{{ statusText(r.status) }}</n-tag>
            </div>
            <div v-if="r.domains && r.domains.length" class="cert-scope">{{ t('cdnDomain.certScope', { domains: r.domains.join('、') }) }}</div>
            <div v-if="r.message" class="cert-msg">{{ r.message }}</div>
            <div v-if="r.records && r.records.length" class="cert-records">
              <div v-for="(rec, i) in r.records" :key="i" class="cert-record">{{ rec.name }} {{ rec.type }} → {{ rec.value }}</div>
            </div>
          </n-list-item>
        </n-list>
      </n-spin>
      <template #footer>
        <n-space justify="end" class="cert-actions">
          <n-button v-if="hasPending" :loading="certRunBusy" @click="checkPending">{{ t('cdnDomain.checkDeploy') }}</n-button>
          <n-button @click="showCert = false">{{ t('common.close') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 由本项目管理：证书选择弹窗（选择器） -->
    <n-modal v-model:show="showLink" preset="card" :title="t('cdnDomain.linkTitle')" class="modal-md" :mask-closable="false" @after-leave="onLinkAfterLeave">
      <n-spin :show="linkLoadBusy">
        <div v-if="linkTarget" class="link-target">{{ t('cdnDomain.targetDomain') }}<b>{{ linkTarget.name }}</b></div>

        <template v-if="linkCandidates">
          <template v-if="linkCandidates.exact && linkCandidates.exact.length">
            <n-alert type="success" :show-icon="true" class="cert-tip">
              {{ t('cdnDomain.exactFound') }}
            </n-alert>
            <n-radio-group v-model:value="linkChoice" class="link-group">
              <n-space vertical>
                <n-radio v-for="c in linkCandidates.exact" :key="'o' + c.oid" :value="'order:' + c.oid">
                  <div class="link-cert">
                    <div class="link-name">{{ c.name }}{{ t('cdnDomain.certIdWrap', { oid: c.oid }) }}</div>
                    <div class="link-meta">{{ t('cdnDomain.issuer', { issuer: c.issuer || t('common.unknown') }) }} · {{ t('cdnDomain.expireTime', { time: (c.expiretime || '').slice(0, 10) }) }}</div>
                    <div class="link-meta">{{ t('cdnDomain.boundDomains', { domains: (c.domains || []).join('、') }) }}</div>
                  </div>
                </n-radio>
              </n-space>
            </n-radio-group>
          </template>

          <template v-else>
            <template v-if="linkCandidates.providers && linkCandidates.providers.length">
              <n-alert type="info" :show-icon="true" class="cert-tip">
                {{ t('cdnDomain.noExactProvider', { name: linkTarget?.name }) }}
              </n-alert>
              <n-radio-group v-model:value="linkChoice" class="link-group">
                <n-space vertical>
                  <n-radio v-for="p in linkCandidates.providers" :key="'a' + p.aid" :value="'aid:' + p.aid">
                    {{ p.typename }}（{{ p.name }}）
                  </n-radio>
                </n-space>
              </n-radio-group>
            </template>
            <template v-else-if="linkCandidates.defaultLe">
              <n-alert type="warning" :show-icon="true" class="cert-tip">
                {{ t('cdnDomain.defaultLe', { email: linkCandidates.defaultLe.email }) }}
              </n-alert>
              <n-radio-group v-model:value="linkChoice" class="link-group">
                <n-space vertical>
                  <n-radio value="default">{{ linkCandidates.defaultLe.typename }}（{{ linkCandidates.defaultLe.email }}）</n-radio>
                </n-space>
              </n-radio-group>
            </template>
          </template>

          <n-alert v-if="linkError" type="error" :show-icon="true" class="cert-tip">{{ linkError }}</n-alert>
        </template>
        <n-alert v-else-if="linkError" type="error" :show-icon="true" class="cert-tip">{{ linkError }}</n-alert>
      </n-spin>

      <template #footer>
        <n-space justify="end" class="cert-actions">
          <n-button @click="finishLink(null)">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :disabled="!linkCanConfirm" @click="confirmLink">{{ t('cdnDomain.select') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 证书管理：统一设置证书方式、申请/部署与进度 -->
    <n-modal v-model:show="showCertMgr" preset="card" :title="t('cdnDomain.certMgrTitle')" class="modal-lg" :mask-closable="false" @after-leave="closeCertMgr">
      <n-spin :show="certMgrBusy">
        <div class="link-target">{{ t('cdnDomain.accelDomainLabel') }}<b>{{ certMgrTarget?.name }}</b></div>

        <!-- 云端当前证书 -->
        <div class="cloud-cert">
          <div class="cloud-cert-head">
            <span class="cloud-cert-title">{{ t('cdnDomain.cloudCert') }}</span>
            <n-button size="tiny" quaternary :loading="certMgrCloudLoadBusy" @click="refreshCertStatus">{{ t('cdnDomain.refreshCloudStatus') }}</n-button>
          </div>
          <n-spin :show="certMgrCloudLoadBusy">
            <template v-if="certMgrCloud">
              <n-alert v-if="!certMgrCloud.supported || certMgrCloud.error" :type="certMgrCloud.supported ? 'warning' : 'default'" :show-icon="true" class="cert-tip">
                {{ certMgrCloud.error }}
              </n-alert>
              <template v-else>
                <div class="cloud-cert-row">
                  <n-tag :type="cloudSourceType(certMgrCloud.source)" size="small" :bordered="false">{{ certMgrCloud.sourceLabel }}</n-tag>
                  <span class="cloud-cert-meta">{{ certMgrCloud.httpsEnabled ? t('cdnDomain.httpsEnabled') : t('cdnDomain.httpsDisabled') }}</span>
                  <span v-if="certMgrCloud.mode" class="cloud-cert-meta">{{ t('cdnDomain.modeLabel', { mode: certMgrCloud.mode }) }}</span>
                </div>
                <div v-if="certMgrCloud.certs && certMgrCloud.certs.length" class="cloud-cert-list">
                  <div v-for="(c, i) in certMgrCloud.certs" :key="i" class="cloud-cert-item">
                    <div class="cloud-cert-name">{{ c.name || c.commonName || c.id }}</div>
                    <div class="cloud-cert-meta">{{ t('cdnDomain.certIdLabel', { id: c.id }) }}</div>
                    <div v-if="c.commonName" class="cloud-cert-meta">{{ t('cdnDomain.mainDomain', { name: c.commonName }) }}</div>
                    <div v-if="c.san && c.san.length" class="cloud-cert-meta">{{ t('cdnDomain.sanDomains', { domains: c.san.join('、') }) }}</div>
                    <div v-if="c.issuer" class="cloud-cert-meta">{{ t('cdnDomain.issuer', { issuer: c.issuer }) }}</div>
                    <div v-if="c.notAfter" class="cloud-cert-meta">{{ t('cdnDomain.expireTime', { time: (c.notAfter || '').slice(0, 19).replace('T', ' ') }) }}</div>
                  </div>
                </div>
                <div v-else class="cloud-cert-meta">{{ t('cdnDomain.cloudNoDetail') }}</div>
              </template>
            </template>
            <div v-else class="cloud-cert-meta">{{ t('cdnDomain.cloudNoInfo') }}</div>
          </n-spin>
        </div>
        <n-alert v-if="certMgrMismatch" type="warning" :show-icon="true" class="cert-tip">{{ t('cdnDomain.cloudMismatch') }}</n-alert>

        <n-form-item :label="t('cdnDomain.certModeLabel')" label-placement="left" label-width="110">
          <n-radio-group v-model:value="certMgrMode" @update:value="onCertMgrModeChange">
            <n-space vertical>
              <n-radio value="">{{ t('cdnDomain.certNoneMode') }}</n-radio>
              <n-radio v-if="certMgrTarget?.can_freecert" value="freecert">{{ t('cdnDomain.freeCert') }}</n-radio>
              <n-radio v-if="certMgrTarget?.can_certlink" value="certlink">{{ t('cdnDomain.certLink') }}</n-radio>
              <n-radio v-if="certMgrTarget?.can_certapply" value="certapply">{{ t('cdnDomain.certApply') }}</n-radio>
            </n-space>
          </n-radio-group>
        </n-form-item>

        <!-- 平台免费证书 -->
        <template v-if="certMgrMode === 'freecert'">
          <n-alert type="info" :show-icon="true" class="cert-tip">
            {{ t('cdnDomain.freeCertDesc') }}
          </n-alert>
          <n-list v-if="certMgrFree.length" bordered class="cert-list">
            <n-list-item v-for="r in certMgrFree" :key="r.id">
              <div class="cert-head">
                <span class="cert-name">{{ r.name || certMgrTarget?.name }}</span>
                <n-tag :type="statusType(r.status)" size="small" :bordered="false">{{ statusText(r.status, 'freecert') }}</n-tag>
              </div>
              <div v-if="r.message" class="cert-msg">{{ r.message }}</div>
              <div v-if="r.records && r.records.length" class="cert-records">
                <div v-for="(rec, i) in r.records" :key="i" class="cert-record">{{ rec.name }} {{ rec.type }} → {{ rec.value }}</div>
              </div>
            </n-list-item>
          </n-list>
        </template>

        <!-- 由本项目管理 -->
        <template v-else-if="certMgrMode === 'certlink'">
          <n-spin :show="certMgrLoadBusy">
            <template v-if="certMgrCandidates">
              <template v-if="certMgrCandidates.exact && certMgrCandidates.exact.length">
                <n-alert type="success" :show-icon="true" class="cert-tip">{{ t('cdnDomain.exactFound') }}</n-alert>
                <n-radio-group v-model:value="certMgrChoice" class="link-group">
                  <n-space vertical>
                    <n-radio v-for="c in certMgrCandidates.exact" :key="'o' + c.oid" :value="'order:' + c.oid">
                      <div class="link-cert">
                        <div class="link-name">{{ c.name }}{{ t('cdnDomain.certIdWrap', { oid: c.oid }) }}</div>
                        <div class="link-meta">{{ t('cdnDomain.issuer', { issuer: c.issuer || t('common.unknown') }) }} · {{ t('cdnDomain.expireTime', { time: (c.expiretime || '').slice(0, 10) }) }}</div>
                        <div class="link-meta">{{ t('cdnDomain.boundDomains', { domains: (c.domains || []).join('、') }) }}</div>
                      </div>
                    </n-radio>
                  </n-space>
                </n-radio-group>
              </template>
              <template v-else>
                <template v-if="certMgrCandidates.providers && certMgrCandidates.providers.length">
                  <n-alert type="info" :show-icon="true" class="cert-tip">{{ t('cdnDomain.noExactProvider', { name: certMgrTarget?.name }) }}</n-alert>
                  <n-radio-group v-model:value="certMgrChoice" class="link-group">
                    <n-space vertical>
                      <n-radio v-for="p in certMgrCandidates.providers" :key="'a' + p.aid" :value="'aid:' + p.aid">{{ p.typename }}（{{ p.name }}）</n-radio>
                    </n-space>
                  </n-radio-group>
                </template>
                <template v-else-if="certMgrCandidates.defaultLe">
                  <n-alert type="warning" :show-icon="true" class="cert-tip">{{ t('cdnDomain.defaultLe', { email: certMgrCandidates.defaultLe.email }) }}</n-alert>
                  <n-radio-group v-model:value="certMgrChoice" class="link-group">
                    <n-space vertical>
                      <n-radio value="default">{{ certMgrCandidates.defaultLe.typename }}（{{ certMgrCandidates.defaultLe.email }}）</n-radio>
                    </n-space>
                  </n-radio-group>
                </template>
              </template>
            </template>
          </n-spin>
          <n-alert v-if="certMgrError" type="error" :show-icon="true" class="cert-tip">{{ certMgrError }}</n-alert>

          <n-divider class="cert-divider">{{ t('cdnDomain.deployProgress') }}</n-divider>
          <n-alert v-if="linkLogState.summary" :type="linkLogState.type" :show-icon="true" class="cert-tip">{{ linkLogState.summary }}</n-alert>
          <div v-if="linkLog?.order" class="link-meta">
            {{ t('cdnDomain.certOrderText', { id: linkLog.order.id, status: orderStatusText(linkLog.order.status) }) }}
            <span v-if="linkLog.order.domains && linkLog.order.domains.length">（{{ linkLog.order.domains.join('、') }}）</span>
          </div>
          <div v-if="linkLog?.deploy" class="link-meta">{{ t('cdnDomain.deployTaskText', { id: linkLog.deploy.id, status: deployStatusText(linkLog.deploy.status) }) }}</div>
          <div class="link-log-list" v-if="linkLog && linkLog.logs && linkLog.logs.length">
            <div v-for="(l, i) in linkLog.logs" :key="i" class="link-log-item">
              <n-tag :type="logStatusType(l.status)" size="tiny" :bordered="false">{{ logStatusText(l.status) }}</n-tag>
              <span class="link-log-node">{{ nodeText(l.node) }}</span>
              <span class="link-log-msg">{{ l.message }}</span>
              <span class="link-log-time">{{ (l.addtime || '').slice(5, 19) }}</span>
            </div>
          </div>
          <EmptyState v-else compact :icon="FolderOpenOutline" :title="t('cdnDomain.noLog')" />
        </template>

        <!-- 项目申请证书上传绑定 -->
        <template v-else-if="certMgrMode === 'certapply'">
          <n-alert type="info" :show-icon="true" class="cert-tip">
            {{ t('cdnDomain.certApplyDesc') }}
          </n-alert>
          <n-list v-if="certMgrApply.length" bordered class="cert-list">
            <n-list-item v-for="r in certMgrApply" :key="r.id">
              <div class="cert-head">
                <span class="cert-name">{{ r.name || certMgrTarget?.name }}</span>
                <n-tag :type="statusType(r.status)" size="small" :bordered="false">{{ statusText(r.status, 'certapply') }}</n-tag>
              </div>
              <div v-if="r.domains && r.domains.length" class="cert-scope">{{ t('cdnDomain.certScope', { domains: r.domains.join('、') }) }}</div>
              <div v-if="r.message" class="cert-msg">{{ r.message }}</div>
            </n-list-item>
          </n-list>
        </template>

        <n-alert v-else type="warning" :show-icon="true" class="cert-tip">{{ t('cdnDomain.certNoneDesc') }}</n-alert>
      </n-spin>

      <template #footer>
        <n-space justify="end" class="cert-actions">
          <n-button v-if="certMgrHasPendingFree" :loading="certMgrBusy" @click="checkFreeCertMgr">{{ t('cdnDomain.checkDeploy') }}</n-button>
          <n-button v-if="certMgrMode === 'certlink' && linkLog?.order" :loading="linkLogLoadBusy" @click="loadCertMgrLog">{{ t('cdnDomain.refreshProgress') }}</n-button>
          <n-button v-if="certMgrMode === 'certlink' && linkLog?.order" type="primary" secondary :loading="linkLogRetryBusy" @click="retryLink">{{ t('cdnDomain.checkDeployNow') }}</n-button>
          <n-button @click="showCertMgr = false">{{ t('common.close') }}</n-button>
          <n-button v-if="certMgrMode === 'freecert'" type="primary" :loading="certMgrBusy" @click="applyFreeCertMgr">{{ t('cdnDomain.applyDeploy') }}</n-button>
          <n-button v-if="certMgrMode === 'certapply'" type="primary" :loading="certMgrBusy" @click="applyCertApplyMgr">{{ t('cdnDomain.applyDeploy') }}</n-button>
          <n-button v-if="certMgrMode === 'certlink'" type="primary" :loading="certMgrBusy" :disabled="!certMgrChoice" @click="applyLinkMgr">{{ t('cdnDomain.confirmDeploy') }}</n-button>
          <n-button v-if="certMgrMode === ''" type="primary" :loading="certMgrBusy" @click="applyNoneMgr">{{ t('common.save') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { NButton, NTag, NEllipsis, NCheckbox, useMessage, useDialog } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { AddOutline, CloudDownloadOutline, GlobeOutline, CloudOutline, CheckmarkCircleOutline, FolderOpenOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import EmptyState from '../components/EmptyState.vue';
import RuleCreatePicker, { type RuleCreateSource } from '../components/cdn/RuleCreatePicker.vue';
import RuleTemplatePicker from '../components/cdn/RuleTemplatePicker.vue';
import { EO_PRESET_RULES } from '../lib/eoPresetRules';
import { EO_RULE_TEMPLATES } from '../lib/eoRuleTemplates';
import { fillHostValues } from '../lib/cdn/fillRuleHost';

const { t, locale } = useI18n();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const loadBusy = ref(false);
const domains = ref<any[]>([]);
const accountOptions = ref<any[]>([]);
const accountTypes = ref<Record<number, string>>({});
const providerCaps = ref<Record<string, any>>({});
const dnsDomains = ref<any[]>([]);
const dnsDomainOptions = computed(() => dnsDomains.value.map((d: any) => ({ label: d.name, value: d.id })));
const matchedDomain = ref('');
const zoneOptions = ref<any[]>([]);
const serviceAreaOptions = computed(() => [
  { label: t('cdnDomain.areaMainland'), value: 'mainland_china' },
  { label: t('cdnDomain.areaOverseas'), value: 'overseas' },
  { label: t('cdnDomain.areaGlobal'), value: 'global' },
]);

const showAdd = ref(false);
const showSync = ref(false);
const saveBusy = ref(false);
const syncBusy = ref(false);
const syncAid = ref<number | null>(null);
const syncDid = ref<number>(0);
const addStep = ref(1);
const showScenePicker = ref(false);
const showSceneTemplate = ref(false);
const sceneSource = ref<'official' | 'project'>('official');
const form = reactive<any>({
  aid: null,
  did: null,
  zone_id: null,
  zone_name: '',
  sub: '',
  service_area: 'mainland_china',
  name: '',
  origin: '',
  origin_type: 'ipaddr',
  origin_protocol: 'follow',
  http_port: 80,
  https_port: 443,
  origin_host_mode: 'origin',
  origin_host_custom: '',
  cert_mode: 'none',
  cert_choice: '',
  cert_choice_label: '',
  scene_source: '' as '' | 'official' | 'project',
  scene_id: '',
  scene_label: '',
});

const checkedIds = ref<number[]>([]);
const showCert = ref(false);
const certMode = ref<'free' | 'link'>('free');
const certRunBusy = ref(false);
const certResults = ref<any[]>([]);
const certSummary = ref('');

// 由本项目管理：证书选择弹窗（作为选择器返回所选项）
const showLink = ref(false);
const linkLoadBusy = ref(false);
const linkCandidates = ref<any>(null);
const linkChoice = ref('');
const linkError = ref('');
const linkTarget = ref<{ id?: number; name: string } | null>(null);
let linkResolve: ((v: string | null) => void) | null = null;

// 证书管理：统一设置证书方式、申请/部署与进度
const showCertMgr = ref(false);
const certMgrTarget = ref<any>(null);
const certMgrMode = ref('');
const certMgrBusy = ref(false);
const certMgrLoadBusy = ref(false);
const certMgrCandidates = ref<any>(null);
const certMgrChoice = ref('');
const certMgrError = ref('');
const certMgrFree = ref<any[]>([]);
const certMgrApply = ref<any[]>([]);
const certMgrCloud = ref<any>(null);
const certMgrCloudLoadBusy = ref(false);
const certMgrMismatch = ref(false);

// CDN证书部署进度：实时阶段日志
const linkLogLoadBusy = ref(false);
const linkLogRetryBusy = ref(false);
const linkLog = ref<any>(null);
const linkLogDomainId = ref<number | null>(null);
let linkLogTimer: any = null;

const linkLogState = computed(() => {
  const d = linkLog.value;
  if (!d) return { type: 'info' as const, summary: '' };
  if (d.done) return { type: 'success' as const, summary: t('cdnDomain.linkLogDone') };
  if (d.failed) return { type: 'error' as const, summary: d.deploy?.error || d.order?.error || t('cdnDomain.linkLogFailed') };
  if (d.order && Number(d.order.status) === 3) return { type: 'warning' as const, summary: t('cdnDomain.linkLogIssued') };
  return { type: 'info' as const, summary: t('cdnDomain.linkLogWorking') };
});

function nodeText(node: string) {
  const labels: Record<string, string> = {
    order: t('cdnDomain.nodeOrder'),
    issue: t('cdnDomain.nodeIssue'),
    account: t('cdnDomain.nodeAccount'),
    task: t('cdnDomain.nodeTask'),
    deploy: t('cdnDomain.nodeDeploy'),
  };
  return labels[node] || node;
}
function logStatusText(s: string) {
  return s === 'ok' ? t('cdnDomain.logDone') : s === 'fail' ? t('cdnDomain.logFail') : t('cdnDomain.logPending');
}
function logStatusType(s: string): 'success' | 'error' | 'warning' {
  return s === 'ok' ? 'success' : s === 'fail' ? 'error' : 'warning';
}
function orderStatusText(s: number) {
  if (Number(s) === 3) return t('cdnDomain.orderIssued');
  if (Number(s) < 0) return t('cdnDomain.orderFailed');
  if (Number(s) === 0) return t('cdnDomain.orderQueued');
  return t('cdnDomain.orderIssuing');
}
function deployStatusText(s: number) {
  if (Number(s) === 1) return t('cdnDomain.deploySuccess');
  if (Number(s) < 0) return t('cdnDomain.deployFailed');
  return t('cdnDomain.deployWaiting');
}

// 证书管理：打开弹窗并按所选方式加载对应内容
async function openCertMgr(row: any) {
  certMgrTarget.value = row;
  certMgrBusy.value = false;
  certMgrLoadBusy.value = false;
  certMgrCandidates.value = null;
  certMgrChoice.value = '';
  certMgrError.value = '';
  certMgrFree.value = [];
  certMgrApply.value = [];
  certMgrCloud.value = null;
  certMgrMismatch.value = false;
  linkLog.value = null;
  linkLogDomainId.value = Number(row.id);
  certMgrMode.value = row.cert_mode || '';
  showCertMgr.value = true;
  const status = await fetchCertStatus();
  // 优先按云端真实状态预选证书方式，其次沿用本地记录
  certMgrMode.value = inferModeFromCloud(status, row) || row.cert_mode || '';
  await onCertMgrModeChange(certMgrMode.value);
}

// 按云端证书状态推断证书管理方式
function inferModeFromCloud(data: any, row: any): string {
  const cloud = data?.cloud;
  if (!cloud || !cloud.supported || cloud.error) return '';
  const mode = String(cloud.mode || '');
  if ((cloud.source === 'platform' || mode.startsWith('eofreecert') || mode === 'free') && row?.can_freecert) return 'freecert';
  if ((mode === 'sslcert' || mode === 'cas') && row?.can_certlink && data?.linked?.orderId) return 'certlink';
  if (mode === 'disable' || cloud.source === 'none') return '';
  return '';
}

function cloudSourceType(s: string): 'success' | 'info' | 'default' | 'warning' {
  if (s === 'platform') return 'success';
  if (s === 'custom') return 'info';
  if (s === 'none') return 'default';
  return 'warning';
}

// 拉取云端证书状态（只读）
async function fetchCertStatus(): Promise<any | null> {
  if (!certMgrTarget.value) return null;
  certMgrCloudLoadBusy.value = true;
  const res = await api<any>('GET', `/cdn/domains/${certMgrTarget.value.id}/cert_status`);
  certMgrCloudLoadBusy.value = false;
  if (res.code !== 0) return null;
  const data = res.data || {};
  certMgrCloud.value = data.cloud || null;
  const inferred = inferModeFromCloud(data, certMgrTarget.value);
  certMgrMismatch.value = !!(data.cert_mode && inferred && data.cert_mode !== inferred);
  return data;
}

async function refreshCertStatus() {
  const data = await fetchCertStatus();
  if (data) message.success(t('cdnDomain.refreshed'));
}

async function onCertMgrModeChange(mode: string) {
  if (mode === 'certlink') {
    await loadCertMgrCandidates();
    await loadCertMgrLog();
  } else {
    stopLinkLogTimer();
  }
}

async function loadCertMgrCandidates() {
  if (!certMgrTarget.value) return;
  certMgrLoadBusy.value = true;
  certMgrCandidates.value = null;
  certMgrChoice.value = '';
  certMgrError.value = '';
  const res = await fetchCandidates(certMgrTarget.value.name);
  certMgrLoadBusy.value = false;
  if (res.code !== 0) {
    certMgrError.value = res.msg || t('cdnDomain.fetchCandidatesFailed');
    return;
  }
  const d = res.data || {};
  certMgrCandidates.value = d;
  if (d.exact && d.exact.length) certMgrChoice.value = `order:${d.exact[0].oid}`;
  else if (d.providers && d.providers.length) certMgrChoice.value = '';
  else if (d.defaultLe) certMgrChoice.value = 'default';
}

async function loadCertMgrLog() {
  if (!linkLogDomainId.value) return;
  await fetchLinkLog();
  if (!linkLog.value?.done && !linkLog.value?.failed) startLinkLogTimer();
  else stopLinkLogTimer();
}

async function applyFreeCertMgr() {
  if (!certMgrTarget.value) return;
  certMgrBusy.value = true;
  const res = await api<any>('POST', '/cdn/domains/freecert', { ids: [certMgrTarget.value.id] });
  certMgrBusy.value = false;
  if (res.code === 0) {
    certMgrFree.value = res.data || [];
    certMgrTarget.value.cert_mode = 'freecert';
    message.success(res.msg);
  } else message.error(res.msg);
}

async function checkFreeCertMgr() {
  if (!certMgrTarget.value) return;
  certMgrBusy.value = true;
  const res = await api<any>('POST', '/cdn/domains/freecert/check', { ids: [certMgrTarget.value.id] });
  certMgrBusy.value = false;
  if (res.code === 0) {
    certMgrFree.value = res.data || [];
    message.success(res.msg);
  } else message.error(res.msg);
}

async function applyCertApplyMgr() {
  if (!certMgrTarget.value) return;
  certMgrBusy.value = true;
  const res = await api<any>('POST', '/cdn/domains/cert', { ids: [certMgrTarget.value.id] });
  certMgrBusy.value = false;
  if (res.code === 0) {
    certMgrApply.value = res.data || [];
    certMgrTarget.value.cert_mode = 'certapply';
    message.success(res.msg);
  } else message.error(res.msg);
}

async function applyLinkMgr() {
  if (!certMgrTarget.value || !certMgrChoice.value) return;
  certMgrBusy.value = true;
  certMgrError.value = '';
  const res = await api<any>('POST', `/cdn/domains/${certMgrTarget.value.id}/certlink`, choiceExtra(certMgrChoice.value));
  certMgrBusy.value = false;
  if (res.code === 0) {
    certMgrTarget.value.cert_mode = 'certlink';
    message.success(res.msg);
    await loadCertMgrLog();
  } else {
    certMgrError.value = res.msg || t('cdnDomain.certFailedRetry');
  }
}

async function applyNoneMgr() {
  if (!certMgrTarget.value) return;
  certMgrBusy.value = true;
  const res = await api('POST', `/cdn/domains/${certMgrTarget.value.id}/cert_mode`, { mode: '' });
  certMgrBusy.value = false;
  if (res.code === 0) {
    certMgrTarget.value.cert_mode = '';
    message.success(res.msg);
  } else message.error(res.msg);
}

function closeCertMgr() {
  stopLinkLogTimer();
  certMgrTarget.value = null;
  certMgrCandidates.value = null;
  certMgrCloud.value = null;
  certMgrMismatch.value = false;
  linkLog.value = null;
  linkLogDomainId.value = null;
}

async function fetchLinkLog() {
  if (!linkLogDomainId.value) return;
  linkLogLoadBusy.value = true;
  const res = await api<any>('GET', `/cdn/domains/${linkLogDomainId.value}/certlink/log`);
  linkLogLoadBusy.value = false;
  if (res.code === 0) {
    linkLog.value = res.data;
    if (res.data?.done || res.data?.failed) stopLinkLogTimer();
  }
}

async function retryLink() {
  if (!linkLogDomainId.value) return;
  linkLogRetryBusy.value = true;
  const res = await api<any>('POST', `/cdn/domains/${linkLogDomainId.value}/certlink/run`, {});
  linkLogRetryBusy.value = false;
  message[res.code === 0 ? 'success' : 'error'](res.msg);
  await fetchLinkLog();
  if (!linkLog.value?.done && !linkLog.value?.failed) startLinkLogTimer();
}

function startLinkLogTimer() {
  stopLinkLogTimer();
  // 后台标签页不轮询，避免不可见的持续请求
  linkLogTimer = setInterval(() => {
    if (!document.hidden) fetchLinkLog();
  }, 3000);
}
function stopLinkLogTimer() {
  if (linkLogTimer) {
    clearInterval(linkLogTimer);
    linkLogTimer = null;
  }
}
const certMgrHasPendingFree = computed(() => certMgrFree.value.some((r) => r.status === 'pending'));

const enabledCount = computed(() => domains.value.filter((d: any) => d.status !== 'offline').length);
const stoppedCount = computed(() => domains.value.filter((d: any) => d.status === 'offline').length);
const certPendingCount = computed(() => domains.value.filter((d: any) => d.cert_mode === 'none' && !Number(d.https_enabled)).length);
const canFreeCert = computed(() => domains.value.some((d) => d.can_freecert));
const canCertApply = computed(() => domains.value.some((d) => d.can_certapply));
const hasPending = computed(() => certResults.value.some((r) => r.status === 'pending'));
const summaryType = computed(() => (certResults.value.some((r) => r.status === 'failed') ? 'warning' : 'success'));

function statusText(status: string, mode: string = certMode.value) {
  if (status === 'applied') return t('cdnDomain.statusApplied');
  if (status === 'pending') return mode === 'freecert' ? t('cdnDomain.statusPendingFree') : t('cdnDomain.statusPendingLink');
  return t('cdnDomain.statusFailed');
}
function statusType(status: string): 'success' | 'warning' | 'error' {
  if (status === 'applied') return 'success';
  if (status === 'pending') return 'warning';
  return 'error';
}

// 当前账户厂商的接入向导能力（步骤与字段显隐）
const addFlow = computed<any>(() => {
  const caps = providerCaps.value[accountTypes.value[form.aid]] || {};
  return (
    caps.addFlow || {
      zone: { needed: false, label: t('cdnDomain.zone') },
      serviceArea: { needed: false },
      origin: { protocol: true, ports: true, host: true, hostModes: [] },
      cert: [],
    }
  );
});

type AddStepKey = 'account' | 'domain' | 'origin' | 'scene' | 'cert';

// 步骤 key 数组：仅 EO 在回源与证书之间插入「选择加速场景」
const stepKeys = computed<AddStepKey[]>(() => {
  const keys: AddStepKey[] = ['account', 'domain', 'origin'];
  if (addFlow.value.scene?.needed) keys.push('scene');
  keys.push('cert');
  return keys;
});
const stepKey = computed<AddStepKey | undefined>(() => stepKeys.value[addStep.value - 1]);

// 按所选账户类型的厂商能力，动态给出证书配置选项
const certModeOptions = computed(() => {
  const caps = providerCaps.value[accountTypes.value[form.aid]] || {};
  const opts: any[] = [{ label: t('cdnDomain.certModeNone'), value: 'none' }];
  if (caps.freecert) opts.push({ label: t('cdnDomain.freeCert'), value: 'freecert' });
  if (caps.certapply) opts.push({ label: t('cdnDomain.certApply'), value: 'certapply' });
  if (caps.certlink) opts.push({ label: t('cdnDomain.certLink'), value: 'certlink' });
  return opts;
});
const linkCanConfirm = computed(() => !!linkChoice.value && !!linkCandidates.value);

const columns = computed<any[]>(() => [
  { type: 'selection', width: 40 },
  { title: 'ID', key: 'id', width: 60, mobile: 'hide' },
  {
    title: t('cdnDomain.accelDomain'),
    key: 'name',
    width: 200,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.name });
    },
  },
  { title: t('cdnDomain.routeNameCol'), key: 'routename', width: 140 },
  {
    title: t('cdnDomain.originCol'),
    key: 'origin',
    width: 180,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.origin || '' });
    },
  },
  {
    title: 'CNAME',
    key: 'cname',
    mobile: 'hide',
    width: 200,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.cname || '' });
    },
  },
  {
    title: t('common.status'),
    key: 'status',
    width: 90,
    render(row: any) {
      return h(NTag, { type: row.status === 'offline' ? 'default' : 'success', size: 'small' }, { default: () => (row.status === 'offline' ? t('cdnDomain.statusStopped') : t('cdnDomain.statusEnabled')) });
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 400,
    render(row: any) {
      const btns: any[] = [];
      if (row.can_freecert || row.can_certapply || row.can_certlink) {
        btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'info', onClick: () => openCertMgr(row) }, { default: () => t('cdnDomain.certMgrTitle') }));
      }
      btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => (window.location.href = `/cdn-domains/${row.id}/setting`) }, { default: () => t('cdnDomain.config') }));
      btns.push(h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => del(row) }, { default: () => t('common.delete') }));
      return h('div', { class: 'row-actions' }, btns);
    },
  },
]);

async function loadDomains() {
  loadBusy.value = true;
  const res = await api<any>('GET', '/cdn/domains');
  domains.value = res.code === 0 ? res.data : [];
  loadBusy.value = false;
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cdn/accounts');
  if (res.code === 0) {
    accountOptions.value = res.data.map((a: any) => ({ label: `${a.id} - ${a.typename}（${a.name}）`, value: a.id }));
    for (const a of res.data) accountTypes.value[a.id] = a.type;
  }
}

async function loadDnsDomains() {
  const res = await api<any>('GET', '/domains', undefined, { cache: true });
  if (res.code === 0) dnsDomains.value = res.data.map((d: any) => ({ id: d.id, name: d.name }));
}

// 根据加速域名自动匹配已添加的域名（取最长后缀匹配），无需用户选择
function matchDnsDomain(name: string) {
  const n = String(name || '').trim().toLowerCase();
  form.did = null;
  matchedDomain.value = '';
  if (!n) return;
  let best: any = null;
  for (const d of dnsDomains.value) {
    const dn = String(d.name || '').toLowerCase();
    if (!dn) continue;
    if (n === dn || n.endsWith('.' + dn)) {
      if (!best || dn.length > String(best.name).length) best = d;
    }
  }
  if (best) {
    form.did = best.id;
    matchedDomain.value = best.name;
  }
}

let nameMatchTimer: number | null = null;
watch(
  () => form.name,
  (v) => {
    // 输入防抖：匹配需遍历全部域名，避免每次按键都计算
    if (nameMatchTimer) window.clearTimeout(nameMatchTimer);
    nameMatchTimer = window.setTimeout(() => matchDnsDomain(v), 200);
  },
);

// 已选站点时，加速域名由「子域名 + 站点域名」自动拼接（用户只需输入子域名）
watch(
  () => [form.sub, form.zone_name],
  () => {
    if (!form.zone_name) return;
    const sub = String(form.sub || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
    const zone = String(form.zone_name || '').trim().toLowerCase();
    if (!sub) {
      form.name = '';
      return;
    }
    form.name = sub === zone || sub.endsWith('.' + zone) ? sub : `${sub}.${zone}`;
  },
);

async function loadProviders() {
  const res = await api<any>('GET', '/cdn/providers');
  if (res.code === 0) providerCaps.value = res.data || {};
}

async function onAccountChange(aid: number) {
  form.zone_id = null;
  form.zone_name = '';
  zoneOptions.value = [];
  clearScene();
  const type = accountTypes.value[aid];
  if (type === 'tencent_edgeone' || type === 'aliyun_esa') {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/zones`);
    if (res.code === 0) zoneOptions.value = res.data.map((z: any) => ({ label: z.zoneName, value: z.zoneId, name: z.zoneName }));
  }
}

// 记住所选站点的域名，供第 2 步自动拼接加速域名
function onZoneChange(zoneId: string) {
  const zone = zoneOptions.value.find((z: any) => z.value === zoneId);
  form.zone_name = zone?.name || '';
  clearScene();
}

function goZones() {
  router.push('/cdn-zones');
}

function openAdd() {
  Object.assign(form, {
    aid: null,
    did: null,
    zone_id: null,
    zone_name: '',
    sub: '',
    service_area: 'mainland_china',
    name: '',
    origin: '',
    origin_type: 'ipaddr',
    origin_protocol: 'follow',
    http_port: 80,
    https_port: 443,
    origin_host_mode: 'origin',
    origin_host_custom: '',
    cert_mode: 'none',
    cert_choice: '',
    cert_choice_label: '',
    scene_source: '',
    scene_id: '',
    scene_label: '',
  });
  showScenePicker.value = false;
  showSceneTemplate.value = false;
  matchedDomain.value = '';
  zoneOptions.value = [];
  addStep.value = 1;
  showAdd.value = true;
}

function nextAddStep() {
  if (stepKey.value === 'account') {
    if (!form.aid) return message.warning(t('cdnDomain.pleaseSelectAccount'));
    if (addFlow.value.zone.needed && !form.zone_id) return message.warning(t('cdnDomain.pleaseSelectZone', { label: addFlow.value.zone.label }));
    if (addFlow.value.serviceArea.needed && !form.service_area) return message.warning(t('cdnDomain.pleaseSelectArea'));
  } else if (stepKey.value === 'domain') {
    if (form.zone_name) {
      const sub = String(form.sub || '').trim().toLowerCase();
      if (!sub) return message.warning(t('cdnDomain.pleaseInputSub'));
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(sub.replace(/^\.+/, '').replace(/\.+$/, '')))
        return message.warning(t('cdnDomain.subFormatInvalid'));
      if (!form.name) return message.warning(t('cdnDomain.pleaseInputSub'));
    } else if (!form.name) return message.warning(t('cdnDomain.pleaseInputDomain'));
    if (!form.did) return message.warning(t('cdnDomain.noLinkedDomain'));
  } else if (stepKey.value === 'origin') {
    if (!form.origin) return message.warning(t('cdnDomain.pleaseInputOrigin'));
    if (addFlow.value.origin.host && form.origin_host_mode === 'custom' && !form.origin_host_custom) return message.warning(t('cdnDomain.pleaseInputHost'));
  }
  addStep.value++;
}

function clearScene() {
  form.scene_source = '';
  form.scene_id = '';
  form.scene_label = '';
}

function onSceneSource(source: RuleCreateSource) {
  showScenePicker.value = false;
  if (source === 'blank') {
    clearScene();
    return;
  }
  sceneSource.value = source;
  showSceneTemplate.value = true;
}

function onSceneTemplate(id: string) {
  showSceneTemplate.value = false;
  const list = sceneSource.value === 'official' ? EO_PRESET_RULES : EO_RULE_TEMPLATES;
  const tpl = list.find((x) => x.id === id);
  if (!tpl) return;
  const zh = String(locale.value || '').toLowerCase().startsWith('zh');
  form.scene_source = sceneSource.value;
  form.scene_id = tpl.id;
  form.scene_label = zh ? tpl.label.zh : tpl.label.en;
}

/** 域名创建成功后应用场景模板：失败只提示，不回滚域名 */
async function applySceneTemplate() {
  if (!form.scene_id || !form.zone_id) return;
  const list = form.scene_source === 'official' ? EO_PRESET_RULES : EO_RULE_TEMPLATES;
  const tpl = list.find((x) => x.id === form.scene_id);
  if (!tpl) return;
  const zh = String(locale.value || '').toLowerCase().startsWith('zh');
  const built = tpl.build(zh ? 'zh' : 'en');
  const item = Array.isArray(built.Rules) && built.Rules.length ? built.Rules[0] : built;
  const replaced = fillHostValues(item, form.name);
  let ruleRes: any;
  try {
    ruleRes = await api<any>('POST', `/cdn/accounts/${form.aid}/rules`, {
      zoneId: form.zone_id,
      ruleName: item.RuleName,
      status: item.Status ?? 'enable',
      branches: item.Branches || [],
      description: item.Description || [],
    });
  } catch (e: any) {
    ruleRes = { code: -1, msg: e?.message || String(e) };
  }
  if (ruleRes.code === 0) message.success(t('cdnDomain.sceneApplied', { name: form.scene_label }));
  else message.warning(t('cdnDomain.sceneApplyFailed', { msg: ruleRes.msg || '' }), { duration: 8000 });
  if (replaced === 0) message.info(t('cdnDomain.sceneNoHost', { domain: form.name }));
}

function certChoiceLabel(choice: string): string {
  if (choice === 'default') return t('cdnDomain.certChoiceDefault');
  if (choice.startsWith('order:')) return t('cdnDomain.certChoiceOrder', { id: choice.slice(6) });
  return t('cdnDomain.certChoiceProvider', { id: choice.slice(4) });
}

async function pickCertSource() {
  if (!form.name) return message.warning(t('cdnDomain.pleaseInputDomainFirst'));
  const choice = await openLinkDialog({ name: form.name });
  if (!choice) return;
  form.cert_choice = choice;
  form.cert_choice_label = certChoiceLabel(choice);
}

async function submitAdd() {
  if (form.cert_mode === 'certlink' && !form.cert_choice) return message.warning(t('cdnDomain.pleaseSelectCert'));
  const host = form.origin_host_mode === 'accelerate' ? form.name : form.origin_host_mode === 'custom' ? form.origin_host_custom : '';
  const payload: Record<string, any> = {
    aid: form.aid,
    did: form.did,
    zone_id: form.zone_id,
    service_area: form.service_area,
    name: form.name,
    origin: form.origin,
    origin_type: form.origin_type,
    origin_protocol: form.origin_protocol,
    http_port: form.http_port,
    https_port: form.https_port,
    origin_host: host,
    cert_mode: form.cert_mode,
  };
  if (form.cert_mode === 'certlink') Object.assign(payload, choiceExtra(form.cert_choice));
  saveBusy.value = true;
  const res = await api<any>('POST', '/cdn/domains', payload);
  saveBusy.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showAdd.value = false;
    loadDomains();
    // 应用加速场景（不阻断域名创建结果）
    await applySceneTemplate();
    // 由本项目管理：新签发证书需要时间，打开证书管理实时查看执行阶段
    const cert = res.data?.cert;
    const domainId = Number(res.data?.id || 0);
    if (domainId && form.cert_mode === 'certlink' && cert?.status !== 'applied') {
      openCertMgr({ id: domainId, name: form.name, can_certlink: 1, cert_mode: 'certlink' });
    }
  } else message.error(res.msg);
}

// 证书候选：精确匹配证书 / 可用提供商 / 默认 Let's Encrypt
async function fetchCandidates(name: string) {
  return await api<any>('GET', `/cdn/cert/candidates?name=${encodeURIComponent(name)}`);
}

// 把证书来源选择转换为接口参数
function choiceExtra(choice: string): Record<string, any> {
  if (choice === 'default') return { cert_use_default: 1 };
  if (choice.startsWith('order:')) return { cert_order_id: Number(choice.slice(6)) };
  return { cert_aid: Number(choice.slice(4)) };
}

// 由本项目管理：加载证书候选并作为选择器返回所选项（精确匹配证书 / 可用提供商 / 默认 LE）
async function openLinkDialog(target: { id?: number; name: string }): Promise<string | null> {
  linkTarget.value = target;
  linkCandidates.value = null;
  linkChoice.value = '';
  linkError.value = '';
  showLink.value = true;
  linkLoadBusy.value = true;
  // 先挂载 resolve，确保加载期间用户取消弹窗也能正常结束等待（否则 Promise 永不 resolve）
  const done = new Promise<string | null>((resolve) => {
    linkResolve = resolve;
  });
  const res = await fetchCandidates(target.name);
  linkLoadBusy.value = false;
  // 弹窗已在加载期间被关闭则不再覆盖状态
  if (linkResolve) {
    if (res.code !== 0) {
      linkError.value = res.msg || t('cdnDomain.fetchCandidatesFailed');
    } else {
      const d = res.data || {};
      linkCandidates.value = d;
      if (d.exact && d.exact.length) linkChoice.value = `order:${d.exact[0].oid}`;
      else if (d.defaultLe) linkChoice.value = 'default';
    }
  }
  return done;
}

function finishLink(choice: string | null) {
  showLink.value = false;
  if (linkResolve) {
    linkResolve(choice);
    linkResolve = null;
  }
}

// 弹窗被遮罩/关闭按钮关掉时，按取消处理，避免向导一直等待
function onLinkAfterLeave() {
  if (linkResolve) {
    linkResolve(null);
    linkResolve = null;
  }
}

function confirmLink() {
  if (!linkChoice.value) return message.warning(t('cdnDomain.pleaseSelectCertOrProvider'));
  finishLink(linkChoice.value);
}

async function doSync() {
  if (!syncAid.value) return message.warning(t('cdnDomain.pleaseSelectAccount'));
  syncBusy.value = true;
  const res = await api('POST', '/cdn/sync', { aid: syncAid.value, did: syncDid.value });
  syncBusy.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showSync.value = false;
    loadDomains();
  } else message.error(res.msg);
}

async function openCert(ids: number[], mode: 'free' | 'link') {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return message.warning(mode === 'link' ? t('cdnDomain.pleaseSelectDomainsLink') : t('cdnDomain.pleaseSelectDomainsFree'));
  certMode.value = mode;
  certResults.value = [];
  certSummary.value = '';
  showCert.value = true;
  await runCert(list, false);
}

function openFreeCert(ids: number[]) {
  return openCert(ids, 'free');
}

function openCertLink(ids: number[]) {
  return openCert(ids, 'link');
}

async function runCert(ids: number[], checkOnly: boolean) {
  certRunBusy.value = true;
  const base = certMode.value === 'link' ? '/cdn/domains/cert' : '/cdn/domains/freecert';
  const res = await api<any>('POST', checkOnly ? base + '/check' : base, { ids });
  certRunBusy.value = false;
  if (res.code === 0) {
    certResults.value = res.data || [];
    certSummary.value = res.msg || '';
    loadDomains();
  } else message.error(res.msg);
}

async function checkPending() {
  const ids = certResults.value.filter((r) => r.status === 'pending').map((r) => r.id);
  if (!ids.length) return;
  await runCert(ids, true);
}

function del(row: any) {
  const state = reactive({ alsoCloud: false, alsoDns: false });
  dialog.warning({
    title: t('cdnDomain.deleteTitle'),
    content: () =>
      h('div', null, [
        h('div', { style: 'margin-bottom:10px' }, t('cdnDomain.deleteConfirm', { name: row.name })),
        h(
          NCheckbox,
          {
            checked: state.alsoCloud,
            'onUpdate:checked': (v: boolean) => (state.alsoCloud = v),
          },
          { default: () => t('cdnDomain.deleteCloud') },
        ),
        h('div', { style: 'margin-top:6px;color:var(--app-text-3);font-size:12px' }, t('cdnDomain.deleteCloudHint')),
        h(
          NCheckbox,
          {
            checked: state.alsoDns,
            style: 'margin-top:10px',
            'onUpdate:checked': (v: boolean) => (state.alsoDns = v),
          },
          { default: () => t('cdnDomain.deleteDns') },
        ),
        h('div', { style: 'margin-top:6px;color:var(--app-text-3);font-size:12px' }, t('cdnDomain.deleteDnsHint')),
        h('div', { style: 'margin-top:6px;color:var(--app-warning);font-size:12px' }, t('cdnDomain.deleteCertHint')),
      ]),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      if (state.alsoCloud) {
        // 删除云端域名需要二次确认
        dialog.warning({
          title: t('cdnDomain.confirmAgain'),
          content: t('cdnDomain.deleteCloudConfirm', { name: row.name }),
          positiveText: t('cdnDomain.confirmDelete'),
          negativeText: t('common.cancel'),
          onPositiveClick: () => doDelete(row, true, state.alsoDns),
        });
        return true;
      }
      await doDelete(row, false, state.alsoDns);
      return true;
    },
  });
}

async function doDelete(row: any, deleteCloud: boolean, deleteDns: boolean) {
  const params = new URLSearchParams();
  if (deleteCloud) params.set('delete_cloud', '1');
  if (deleteDns) params.set('delete_dns', '1');
  const qs = params.toString();
  // 乐观移除：后端失败时本地记录并未删除，直接回滚
  const idx = domains.value.findIndex((d: any) => Number(d.id) === Number(row.id));
  const removed = idx >= 0 ? domains.value[idx] : null;
  if (idx >= 0) domains.value.splice(idx, 1);
  const res = await api('DELETE', `/cdn/domains/${row.id}${qs ? '?' + qs : ''}`);
  if (res.code === 0) {
    // 同步移除选中集合中的该行，避免「选中 N」偏高、批量提交携带已删 id
    checkedIds.value = checkedIds.value.filter((k: any) => Number(k) !== Number(row.id));
    message.success(res.msg);
  } else {
    if (removed) domains.value.splice(idx, 0, removed); // 失败回滚
    message.error(res.msg);
  }
}

onMounted(() => {
  loadDomains();
  loadAccounts();
  loadDnsDomains();
  loadProviders();
});

onUnmounted(() => {
  stopLinkLogTimer();
  if (nameMatchTimer) window.clearTimeout(nameMatchTimer);
});
</script>

<style scoped>
.cert-tip + .cert-tip {
  margin-top: 10px;
}
.cert-hint {
  color: var(--app-text-3);
  font-size: 12px;
  line-height: 1.6;
}
.link-target {
  margin-bottom: 12px;
  font-size: 13px;
  word-break: break-all;
}
.link-hint {
  color: var(--app-text-3);
  font-size: 13px;
}
.link-warn {
  color: var(--app-warning);
  font-size: 13px;
  line-height: 1.6;
}
.link-group {
  display: block;
  width: 100%;
}
.link-cert {
  padding-bottom: 2px;
}
.link-name {
  font-weight: 600;
  word-break: break-all;
}
.link-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--app-text-3);
  word-break: break-all;
}
.cert-list {
  margin-top: 12px;
}
.cert-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cert-name {
  font-weight: 600;
  word-break: break-all;
}
.cert-msg {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--app-text-3);
  word-break: break-word;
}
.cert-scope {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--app-primary);
  word-break: break-all;
}
.cert-records {
  margin-top: 6px;
  padding: 8px;
  border-radius: 6px;
  background: var(--app-surface-2);
  font-size: 12px;
  word-break: break-all;
}
.cert-record + .cert-record {
  margin-top: 4px;
}
.link-log-list {
  margin-top: 12px;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  padding: 4px 10px;
}
.link-log-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--app-divider);
  font-size: 12px;
}
.link-log-item:last-child {
  border-bottom: none;
}
.link-log-node {
  color: var(--app-primary);
  white-space: nowrap;
}
.link-log-msg {
  flex: 1;
  color: var(--app-text-2);
  word-break: break-word;
}
.link-log-time {
  color: var(--app-text-3);
  white-space: nowrap;
}
.cert-divider {
  margin: 16px 0 8px;
  font-size: 13px;
}
.cloud-cert {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: var(--app-surface-2);
}
.cloud-cert-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.cloud-cert-title {
  font-size: 13px;
  font-weight: 600;
}
.cloud-cert-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.cloud-cert-list {
  margin-top: 8px;
}
.cloud-cert-item + .cloud-cert-item {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--app-divider);
}
.cloud-cert-name {
  font-weight: 600;
  word-break: break-all;
}
.cloud-cert-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--app-text-3);
  word-break: break-all;
}
.add-form {
  min-height: 200px;
}
.port-label {
  font-size: 13px;
  color: var(--app-text-3);
}

@media (max-width: 768px) {
  .cert-actions {
    width: 100%;
    justify-content: space-between;
  }
  .cert-actions :deep(.n-button) {
    flex: 1;
  }
}
</style>