<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">CDN 域名</span>
          <n-space>
            <n-button v-if="canFreeCert" type="primary" secondary :disabled="!checkedIds.length" @click="openFreeCert(checkedIds)">
              平台免费证书<template v-if="checkedIds.length">（{{ checkedIds.length }}）</template>
            </n-button>
            <n-button v-if="canCertApply" type="primary" secondary :disabled="!checkedIds.length" @click="openCertLink(checkedIds)">
              项目申请证书<template v-if="checkedIds.length">（{{ checkedIds.length }}）</template>
            </n-button>
            <n-button @click="goZones">站点设置</n-button>
            <n-button type="primary" @click="openAdd">
              <template #icon><n-icon :component="AddOutline" /></template>
              接入域名
            </n-button>
            <n-button @click="showSync = true">
              <template #icon><n-icon :component="CloudDownloadOutline" /></template>
              同步云端
            </n-button>
          </n-space>
        </div>
      </template>
      <n-data-table
        :columns="columns"
        :data="domains"
        :loading="loading"
        :bordered="false"
        :row-key="(row: any) => row.id"
        v-model:checked-row-keys="checkedIds"
      />
      <n-empty class="list-empty" v-if="!loading && !domains.length" description="暂无 CDN 加速域名" />
    </n-card>

    <!-- 接入域名弹窗（分步向导） -->
    <n-modal v-model:show="showAdd" preset="card" title="接入加速域名" style="max-width:640px" :mask-closable="false">
      <n-steps :current="addStep" size="small" class="add-steps">
        <n-step title="账户与站点" />
        <n-step title="加速域名" />
        <n-step title="回源配置" />
        <n-step title="证书设置" />
      </n-steps>

      <!-- 步骤1：账户与站点 -->
      <n-form v-show="addStep === 1" label-placement="left" label-width="110" class="add-form">
        <n-form-item label="CDN 账户">
          <n-select v-model:value="form.aid" :options="accountOptions" @update:value="onAccountChange" />
        </n-form-item>
        <n-form-item v-if="addFlow.zone.needed" :label="addFlow.zone.label">
          <n-select v-model:value="form.zone_id" :options="zoneOptions" :placeholder="'选择' + addFlow.zone.label" />
        </n-form-item>
        <n-form-item v-if="addFlow.serviceArea.needed" label="服务区域">
          <n-select v-model:value="form.service_area" :options="serviceAreaOptions" />
        </n-form-item>
      </n-form>

      <!-- 步骤2：加速域名 -->
      <n-form v-show="addStep === 2" label-placement="left" label-width="110" class="add-form">
        <n-form-item label="加速域名">
          <n-input v-model:value="form.name" placeholder="如 www.example.com" />
        </n-form-item>
        <n-form-item label="联动域名">
          <n-tag v-if="matchedDomain" type="success" :bordered="false">{{ matchedDomain }}</n-tag>
          <span v-else-if="form.name" class="link-warn">未匹配到已添加的域名，请先在「域名管理」中添加该域名</span>
          <span v-else class="link-hint">填写加速域名后自动匹配</span>
        </n-form-item>
      </n-form>

      <!-- 步骤3：回源配置 -->
      <n-form v-show="addStep === 3" label-placement="left" label-width="110" class="add-form">
        <n-form-item label="源站地址">
          <n-input v-model:value="form.origin" placeholder="IP 或域名" />
        </n-form-item>
        <n-form-item label="源站类型">
          <n-radio-group v-model:value="form.origin_type">
            <n-radio value="ipaddr">IP 源站</n-radio>
            <n-radio value="domain">域名源站</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="addFlow.origin.protocol" label="回源协议">
          <n-radio-group v-model:value="form.origin_protocol">
            <n-radio value="follow">协议跟随</n-radio>
            <n-radio value="http">HTTP</n-radio>
            <n-radio value="https">HTTPS</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="addFlow.origin.ports" label="回源端口">
          <n-space align="center">
            <span class="port-label">HTTP</span>
            <n-input-number v-model:value="form.http_port" :min="1" :max="65535" style="width:110px" placeholder="80" />
            <span class="port-label">HTTPS</span>
            <n-input-number v-model:value="form.https_port" :min="1" :max="65535" style="width:110px" placeholder="443" />
          </n-space>
        </n-form-item>
        <n-form-item v-if="addFlow.origin.host" label="回源 HOST">
          <n-space vertical style="width:100%">
            <n-radio-group v-model:value="form.origin_host_mode">
              <n-space :wrap="true">
                <n-radio value="accelerate">使用加速域名</n-radio>
                <n-radio value="origin">使用源站域名</n-radio>
                <n-radio value="custom">自定义</n-radio>
              </n-space>
            </n-radio-group>
            <n-input v-if="form.origin_host_mode === 'custom'" v-model:value="form.origin_host_custom" placeholder="请输入回源 HOST" />
          </n-space>
        </n-form-item>
      </n-form>

      <!-- 步骤4：证书设置 -->
      <div v-show="addStep === 4" class="add-form">
        <n-form-item v-if="certModeOptions.length > 1" label="证书设置" label-placement="left" label-width="110">
          <n-radio-group v-model:value="form.cert_mode">
            <n-space vertical>
              <n-radio v-for="o in certModeOptions" :key="o.value" :value="o.value">{{ o.label }}</n-radio>
            </n-space>
          </n-radio-group>
        </n-form-item>
        <n-alert v-else type="info" :show-icon="true" class="cert-tip">该 CDN 账户接入时暂不需要配置证书，可接入后在「证书管理」中设置。</n-alert>

        <template v-if="form.cert_mode === 'certlink'">
          <n-alert type="info" :show-icon="true" class="cert-tip">已选择「由本项目管理」，请先选择证书来源（精确匹配证书 / 证书提供商 / 默认 Let's Encrypt）。</n-alert>
          <n-space align="center" class="cert-tip">
            <n-button size="small" @click="pickCertSource">选择证书来源</n-button>
            <span class="link-meta">{{ form.cert_choice_label || '未选择' }}</span>
          </n-space>
        </template>
        <n-alert v-else-if="form.cert_mode === 'freecert'" type="info" :show-icon="true" class="cert-tip">平台免费证书由 CDN 厂商直接签发并部署到加速域名。</n-alert>
        <n-alert v-else-if="form.cert_mode === 'certapply'" type="info" :show-icon="true" class="cert-tip">按站点申请一张通配符证书，签发后自动上传绑定，后续续签自动更新。</n-alert>
      </div>

      <template #footer>
        <n-space justify="space-between" class="cert-actions" style="width:100%">
          <n-button v-if="addStep > 1" @click="addStep--">上一步</n-button>
          <span v-else />
          <n-space>
            <n-button @click="showAdd = false">取消</n-button>
            <n-button v-if="addStep < 4" type="primary" @click="nextAddStep">下一步</n-button>
            <n-button v-else type="primary" :loading="saving" @click="submitAdd">提交接入</n-button>
          </n-space>
        </n-space>
      </template>
    </n-modal>

    <!-- 同步云端弹窗 -->
    <n-modal v-model:show="showSync" preset="card" title="同步云端已有加速域名" style="max-width:440px">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="CDN 账户">
          <n-select v-model:value="syncAid" :options="accountOptions" />
        </n-form-item>
        <n-form-item label="联动域名">
          <n-select v-model:value="syncDid" :options="[{ label: '全部', value: 0 }, ...dnsDomainOptions]" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showSync = false">取消</n-button>
          <n-button type="primary" :loading="syncing" @click="doSync">开始同步</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 证书弹窗（平台免费证书 / 证书申请联动） -->
    <n-modal v-model:show="showCert" preset="card" :title="certMode === 'link' ? '项目申请证书' : '平台免费证书'" style="max-width:680px">
      <n-spin :show="certRunning">
        <n-alert v-if="certMode === 'link'" type="info" :show-icon="true" class="cert-tip">
          按站点申请一张通配符证书（*.站点根域 + 站点根域），系统会自动完成 DNS 验证与签发，并创建自动部署任务；签发后自动上传到 CDN 并启用 HTTPS，后续续签自动更新。也可点击「检查并部署」立即处理。
        </n-alert>
        <n-alert v-else type="info" :show-icon="true" class="cert-tip">
          腾讯云 EdgeOne：托管接入（NS / DNSPod）可自动申请并部署免费证书；CNAME 接入会返回 DNS 委派验证记录，系统已尝试自动添加解析，生效后点击「检查并部署」完成下发。
        </n-alert>
        <n-alert v-if="certSummary" :type="summaryType" :show-icon="true" class="cert-tip">{{ certSummary }}</n-alert>

        <n-list v-if="certResults.length" bordered class="cert-list">
          <n-list-item v-for="r in certResults" :key="r.id">
            <div class="cert-head">
              <span class="cert-name">{{ r.name || '#' + r.id }}</span>
              <n-tag :type="statusType(r.status)" size="small" :bordered="false">{{ statusText(r.status) }}</n-tag>
            </div>
            <div v-if="r.domains && r.domains.length" class="cert-scope">证书覆盖：{{ r.domains.join('、') }}</div>
            <div v-if="r.message" class="cert-msg">{{ r.message }}</div>
            <div v-if="r.records && r.records.length" class="cert-records">
              <div v-for="(rec, i) in r.records" :key="i" class="cert-record">{{ rec.name }} {{ rec.type }} → {{ rec.value }}</div>
            </div>
          </n-list-item>
        </n-list>
      </n-spin>
      <template #footer>
        <n-space justify="end" class="cert-actions">
          <n-button v-if="hasPending" :loading="certRunning" @click="checkPending">检查并部署</n-button>
          <n-button @click="showCert = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 由本项目管理：证书选择弹窗（选择器） -->
    <n-modal v-model:show="showLink" preset="card" title="由本项目管理 · 选择证书" style="max-width: 680px" @after-leave="onLinkAfterLeave">
      <n-spin :show="linkLoading">
        <div v-if="linkTarget" class="link-target">目标域名：<b>{{ linkTarget.name }}</b></div>

        <template v-if="linkCandidates">
          <template v-if="linkCandidates.exact && linkCandidates.exact.length">
            <n-alert type="success" :show-icon="true" class="cert-tip">
              已找到与目标子域名精确匹配的证书，将直接复用绑定，不再重新签发。
            </n-alert>
            <n-radio-group v-model:value="linkChoice" class="link-group">
              <n-space vertical>
                <n-radio v-for="c in linkCandidates.exact" :key="'o' + c.oid" :value="'order:' + c.oid">
                  <div class="link-cert">
                    <div class="link-name">{{ c.name }}（证书 #{{ c.oid }}）</div>
                    <div class="link-meta">颁发机构：{{ c.issuer || '未知' }} · 到期时间：{{ (c.expiretime || '').slice(0, 10) }}</div>
                    <div class="link-meta">绑定域名：{{ (c.domains || []).join('、') }}</div>
                  </div>
                </n-radio>
              </n-space>
            </n-radio-group>
          </template>

          <template v-else>
            <template v-if="linkCandidates.providers && linkCandidates.providers.length">
              <n-alert type="info" :show-icon="true" class="cert-tip">
                未找到精确匹配证书，请选择证书提供商自动签发（仅包含目标子域名 {{ linkTarget?.name }}）。
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
                当前没有可用的证书提供商，将自动使用默认 Let's Encrypt（{{ linkCandidates.defaultLe.email }}）签发精确子域名证书。
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
          <n-button @click="finishLink(null)">取消</n-button>
          <n-button type="primary" :disabled="!linkCanConfirm" @click="confirmLink">选择</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 证书管理：统一设置证书方式、申请/部署与进度 -->
    <n-modal v-model:show="showCertMgr" preset="card" title="证书管理" style="max-width: 760px" :mask-closable="false" @after-leave="closeCertMgr">
      <n-spin :show="certMgrBusy">
        <div class="link-target">加速域名：<b>{{ certMgrTarget?.name }}</b></div>

        <!-- 云端当前证书 -->
        <div class="cloud-cert">
          <div class="cloud-cert-head">
            <span class="cloud-cert-title">云端当前证书</span>
            <n-button size="tiny" quaternary :loading="certMgrCloudLoading" @click="refreshCertStatus">刷新云端状态</n-button>
          </div>
          <n-spin :show="certMgrCloudLoading">
            <template v-if="certMgrCloud">
              <n-alert v-if="!certMgrCloud.supported || certMgrCloud.error" :type="certMgrCloud.supported ? 'warning' : 'default'" :show-icon="true" class="cert-tip">
                {{ certMgrCloud.error }}
              </n-alert>
              <template v-else>
                <div class="cloud-cert-row">
                  <n-tag :type="cloudSourceType(certMgrCloud.source)" size="small" :bordered="false">{{ certMgrCloud.sourceLabel }}</n-tag>
                  <span class="cloud-cert-meta">HTTPS：{{ certMgrCloud.httpsEnabled ? '已启用' : '未启用' }}</span>
                  <span v-if="certMgrCloud.mode" class="cloud-cert-meta">模式：{{ certMgrCloud.mode }}</span>
                </div>
                <div v-if="certMgrCloud.certs && certMgrCloud.certs.length" class="cloud-cert-list">
                  <div v-for="(c, i) in certMgrCloud.certs" :key="i" class="cloud-cert-item">
                    <div class="cloud-cert-name">{{ c.name || c.commonName || c.id }}</div>
                    <div class="cloud-cert-meta">证书 ID：{{ c.id }}</div>
                    <div v-if="c.commonName" class="cloud-cert-meta">主域名：{{ c.commonName }}</div>
                    <div v-if="c.san && c.san.length" class="cloud-cert-meta">覆盖域名：{{ c.san.join('、') }}</div>
                    <div v-if="c.issuer" class="cloud-cert-meta">颁发机构：{{ c.issuer }}</div>
                    <div v-if="c.notAfter" class="cloud-cert-meta">到期时间：{{ (c.notAfter || '').slice(0, 19).replace('T', ' ') }}</div>
                  </div>
                </div>
                <div v-else class="cloud-cert-meta">云端未返回证书详情</div>
              </template>
            </template>
            <div v-else class="cloud-cert-meta">未获取到云端证书信息</div>
          </n-spin>
        </div>
        <n-alert v-if="certMgrMismatch" type="warning" :show-icon="true" class="cert-tip">本地记录与云端证书不一致，请以云端为准确认证书方式。</n-alert>

        <n-form-item label="证书方式" label-placement="left" label-width="90">
          <n-radio-group v-model:value="certMgrMode" @update:value="onCertMgrModeChange">
            <n-space vertical>
              <n-radio value="">不使用证书（停用自动部署）</n-radio>
              <n-radio v-if="certMgrTarget?.can_freecert" value="freecert">平台免费证书</n-radio>
              <n-radio v-if="certMgrTarget?.can_certlink" value="certlink">由本项目管理</n-radio>
              <n-radio v-if="certMgrTarget?.can_certapply" value="certapply">项目申请证书上传绑定</n-radio>
            </n-space>
          </n-radio-group>
        </n-form-item>

        <!-- 平台免费证书 -->
        <template v-if="certMgrMode === 'freecert'">
          <n-alert type="info" :show-icon="true" class="cert-tip">
            腾讯云 EdgeOne：托管接入（NS / DNSPod）可自动申请并部署免费证书；CNAME 接入会返回 DNS 委派验证记录，系统已尝试自动添加解析，生效后点击「检查并部署」完成下发。
          </n-alert>
          <n-list v-if="certMgrFree.length" bordered class="cert-list">
            <n-list-item v-for="r in certMgrFree" :key="r.id">
              <div class="cert-head">
                <span class="cert-name">{{ r.name || certMgrTarget?.name }}</span>
                <n-tag :type="statusType(r.status)" size="small" :bordered="false">{{ statusText(r.status) }}</n-tag>
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
          <n-spin :show="certMgrLoading">
            <template v-if="certMgrCandidates">
              <template v-if="certMgrCandidates.exact && certMgrCandidates.exact.length">
                <n-alert type="success" :show-icon="true" class="cert-tip">已找到与目标子域名精确匹配的证书，将直接复用绑定，不再重新签发。</n-alert>
                <n-radio-group v-model:value="certMgrChoice" class="link-group">
                  <n-space vertical>
                    <n-radio v-for="c in certMgrCandidates.exact" :key="'o' + c.oid" :value="'order:' + c.oid">
                      <div class="link-cert">
                        <div class="link-name">{{ c.name }}（证书 #{{ c.oid }}）</div>
                        <div class="link-meta">颁发机构：{{ c.issuer || '未知' }} · 到期时间：{{ (c.expiretime || '').slice(0, 10) }}</div>
                        <div class="link-meta">绑定域名：{{ (c.domains || []).join('、') }}</div>
                      </div>
                    </n-radio>
                  </n-space>
                </n-radio-group>
              </template>
              <template v-else>
                <template v-if="certMgrCandidates.providers && certMgrCandidates.providers.length">
                  <n-alert type="info" :show-icon="true" class="cert-tip">未找到精确匹配证书，请选择证书提供商自动签发（仅包含目标子域名 {{ certMgrTarget?.name }}）。</n-alert>
                  <n-radio-group v-model:value="certMgrChoice" class="link-group">
                    <n-space vertical>
                      <n-radio v-for="p in certMgrCandidates.providers" :key="'a' + p.aid" :value="'aid:' + p.aid">{{ p.typename }}（{{ p.name }}）</n-radio>
                    </n-space>
                  </n-radio-group>
                </template>
                <template v-else-if="certMgrCandidates.defaultLe">
                  <n-alert type="warning" :show-icon="true" class="cert-tip">当前没有可用的证书提供商，将自动使用默认 Let's Encrypt（{{ certMgrCandidates.defaultLe.email }}）签发精确子域名证书。</n-alert>
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

          <n-divider class="cert-divider">CDN证书部署进度</n-divider>
          <n-alert v-if="linkLogState.summary" :type="linkLogState.type" :show-icon="true" class="cert-tip">{{ linkLogState.summary }}</n-alert>
          <div v-if="linkLog?.order" class="link-meta">
            证书订单 #{{ linkLog.order.id }}：{{ orderStatusText(linkLog.order.status) }}
            <span v-if="linkLog.order.domains && linkLog.order.domains.length">（{{ linkLog.order.domains.join('、') }}）</span>
          </div>
          <div v-if="linkLog?.deploy" class="link-meta">自动部署任务 #{{ linkLog.deploy.id }}：{{ deployStatusText(linkLog.deploy.status) }}</div>
          <div class="link-log-list" v-if="linkLog && linkLog.logs && linkLog.logs.length">
            <div v-for="(l, i) in linkLog.logs" :key="i" class="link-log-item">
              <n-tag :type="logStatusType(l.status)" size="tiny" :bordered="false">{{ logStatusText(l.status) }}</n-tag>
              <span class="link-log-node">{{ nodeText(l.node) }}</span>
              <span class="link-log-msg">{{ l.message }}</span>
              <span class="link-log-time">{{ (l.addtime || '').slice(5, 19) }}</span>
            </div>
          </div>
          <n-empty v-else size="small" description="暂无执行日志" />
        </template>

        <!-- 项目申请证书上传绑定 -->
        <template v-else-if="certMgrMode === 'certapply'">
          <n-alert type="info" :show-icon="true" class="cert-tip">
            按站点申请一张通配符证书（*.站点根域 + 站点根域），申请账户在「自动续签设置」中配置；签发后自动上传绑定，后续续签自动更新。
          </n-alert>
          <n-list v-if="certMgrApply.length" bordered class="cert-list">
            <n-list-item v-for="r in certMgrApply" :key="r.id">
              <div class="cert-head">
                <span class="cert-name">{{ r.name || certMgrTarget?.name }}</span>
                <n-tag :type="statusType(r.status)" size="small" :bordered="false">{{ statusText(r.status) }}</n-tag>
              </div>
              <div v-if="r.domains && r.domains.length" class="cert-scope">证书覆盖：{{ r.domains.join('、') }}</div>
              <div v-if="r.message" class="cert-msg">{{ r.message }}</div>
            </n-list-item>
          </n-list>
        </template>

        <n-alert v-else type="warning" :show-icon="true" class="cert-tip">不使用证书：仅停用「由本项目管理」的自动部署任务，不影响已部署到 CDN 的证书。</n-alert>
      </n-spin>

      <template #footer>
        <n-space justify="end" class="cert-actions">
          <n-button v-if="certMgrHasPendingFree" :loading="certMgrBusy" @click="checkFreeCertMgr">检查并部署</n-button>
          <n-button v-if="certMgrMode === 'certlink' && linkLog?.order" :loading="linkLogLoading" @click="loadCertMgrLog">刷新进度</n-button>
          <n-button v-if="certMgrMode === 'certlink' && linkLog?.order" type="primary" secondary :loading="linkLogRetrying" @click="retryLink">立即检查并部署</n-button>
          <n-button @click="showCertMgr = false">关闭</n-button>
          <n-button v-if="certMgrMode === 'freecert'" type="primary" :loading="certMgrBusy" @click="applyFreeCertMgr">申请并部署</n-button>
          <n-button v-if="certMgrMode === 'certapply'" type="primary" :loading="certMgrBusy" @click="applyCertApplyMgr">申请并部署</n-button>
          <n-button v-if="certMgrMode === 'certlink'" type="primary" :loading="certMgrBusy" :disabled="!certMgrChoice" @click="applyLinkMgr">确认并部署</n-button>
          <n-button v-if="certMgrMode === ''" type="primary" :loading="certMgrBusy" @click="applyNoneMgr">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { NButton, NSpace, NTag, NEllipsis, NCheckbox, useMessage, useDialog } from 'naive-ui';
import { AddOutline, CloudDownloadOutline } from '@vicons/ionicons5';
import { api } from '../api';

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const domains = ref<any[]>([]);
const accountOptions = ref<any[]>([]);
const accountTypes = ref<Record<number, string>>({});
const providerCaps = ref<Record<string, any>>({});
const dnsDomains = ref<any[]>([]);
const dnsDomainOptions = computed(() => dnsDomains.value.map((d: any) => ({ label: d.name, value: d.id })));
const matchedDomain = ref('');
const zoneOptions = ref<any[]>([]);
const serviceAreaOptions = [
  { label: '中国大陆', value: 'mainland_china' },
  { label: '中国大陆以外', value: 'overseas' },
  { label: '全球', value: 'global' },
];

const showAdd = ref(false);
const showSync = ref(false);
const saving = ref(false);
const syncing = ref(false);
const syncAid = ref<number | null>(null);
const syncDid = ref<number>(0);
const addStep = ref(1);
const form = reactive<any>({
  aid: null,
  did: null,
  zone_id: null,
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
});

const checkedIds = ref<number[]>([]);
const showCert = ref(false);
const certMode = ref<'free' | 'link'>('free');
const certRunning = ref(false);
const certResults = ref<any[]>([]);
const certSummary = ref('');

// 由本项目管理：证书选择弹窗（作为选择器返回所选项）
const showLink = ref(false);
const linkLoading = ref(false);
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
const certMgrLoading = ref(false);
const certMgrCandidates = ref<any>(null);
const certMgrChoice = ref('');
const certMgrError = ref('');
const certMgrFree = ref<any[]>([]);
const certMgrApply = ref<any[]>([]);
const certMgrCloud = ref<any>(null);
const certMgrCloudLoading = ref(false);
const certMgrMismatch = ref(false);

// CDN证书部署进度：实时阶段日志
const linkLogLoading = ref(false);
const linkLogRetrying = ref(false);
const linkLog = ref<any>(null);
const linkLogDomainId = ref<number | null>(null);
let linkLogTimer: any = null;

const linkLogState = computed(() => {
  const d = linkLog.value;
  if (!d) return { type: 'info' as const, summary: '' };
  if (d.done) return { type: 'success' as const, summary: '证书已签发并部署到 CDN，HTTPS 已启用；后续续签将自动更新。' };
  if (d.failed) return { type: 'error' as const, summary: d.deploy?.error || d.order?.error || '执行失败，可点击「立即检查并部署」重试。' };
  if (d.order && Number(d.order.status) === 3) return { type: 'warning' as const, summary: '证书已签发，正在创建自动部署任务并部署到 CDN，请稍候…' };
  return { type: 'info' as const, summary: '证书正在申请/签发中，系统会自动完成后续部署，请稍候…' };
});

function nodeText(node: string) {
  return ({ order: '证书订单', issue: '证书签发', account: '部署账户', task: '部署任务', deploy: '部署到CDN' } as any)[node] || node;
}
function logStatusText(s: string) {
  return s === 'ok' ? '完成' : s === 'fail' ? '失败' : '进行中';
}
function logStatusType(s: string): 'success' | 'error' | 'warning' {
  return s === 'ok' ? 'success' : s === 'fail' ? 'error' : 'warning';
}
function orderStatusText(s: number) {
  if (Number(s) === 3) return '已签发';
  if (Number(s) < 0) return '处理失败';
  if (Number(s) === 0) return '排队中';
  return '签发中';
}
function deployStatusText(s: number) {
  if (Number(s) === 1) return '部署成功';
  if (Number(s) < 0) return '部署失败';
  return '等待部署';
}

// 证书管理：打开弹窗并按所选方式加载对应内容
async function openCertMgr(row: any) {
  certMgrTarget.value = row;
  certMgrBusy.value = false;
  certMgrLoading.value = false;
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
  certMgrCloudLoading.value = true;
  const res = await api<any>('GET', `/cdn/domains/${certMgrTarget.value.id}/cert_status`);
  certMgrCloudLoading.value = false;
  if (res.code !== 0) return null;
  const data = res.data || {};
  certMgrCloud.value = data.cloud || null;
  const inferred = inferModeFromCloud(data, certMgrTarget.value);
  certMgrMismatch.value = !!(data.cert_mode && inferred && data.cert_mode !== inferred);
  return data;
}

async function refreshCertStatus() {
  const data = await fetchCertStatus();
  if (data) message.success('已刷新云端证书状态');
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
  certMgrLoading.value = true;
  certMgrCandidates.value = null;
  certMgrChoice.value = '';
  certMgrError.value = '';
  const res = await fetchCandidates(certMgrTarget.value.name);
  certMgrLoading.value = false;
  if (res.code !== 0) {
    certMgrError.value = res.msg || '获取证书候选失败';
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
    loadDomains();
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
    loadDomains();
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
    loadDomains();
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
    loadDomains();
    await loadCertMgrLog();
  } else {
    certMgrError.value = res.msg || '操作失败，请重试或更换证书';
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
    loadDomains();
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
  linkLogLoading.value = true;
  const res = await api<any>('GET', `/cdn/domains/${linkLogDomainId.value}/certlink/log`);
  linkLogLoading.value = false;
  if (res.code === 0) {
    linkLog.value = res.data;
    if (res.data?.done || res.data?.failed) stopLinkLogTimer();
  }
}

async function retryLink() {
  if (!linkLogDomainId.value) return;
  linkLogRetrying.value = true;
  const res = await api<any>('POST', `/cdn/domains/${linkLogDomainId.value}/certlink/run`, {});
  linkLogRetrying.value = false;
  message[res.code === 0 ? 'success' : 'error'](res.msg);
  await fetchLinkLog();
  if (!linkLog.value?.done && !linkLog.value?.failed) startLinkLogTimer();
}

function startLinkLogTimer() {
  stopLinkLogTimer();
  linkLogTimer = setInterval(() => fetchLinkLog(), 3000);
}
function stopLinkLogTimer() {
  if (linkLogTimer) {
    clearInterval(linkLogTimer);
    linkLogTimer = null;
  }
}
const certMgrHasPendingFree = computed(() => certMgrFree.value.some((r) => r.status === 'pending'));

const canFreeCert = computed(() => domains.value.some((d) => d.can_freecert));
const canCertApply = computed(() => domains.value.some((d) => d.can_certapply));
const hasPending = computed(() => certResults.value.some((r) => r.status === 'pending'));
const summaryType = computed(() => (certResults.value.some((r) => r.status === 'failed') ? 'warning' : 'success'));

function statusText(status: string) {
  if (status === 'applied') return '已部署';
  if (status === 'pending') return certMode.value === 'link' ? '待签发' : '待验证';
  return '失败';
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
      zone: { needed: false, label: '站点' },
      serviceArea: { needed: false },
      origin: { protocol: true, ports: true, host: true, hostModes: [] },
      cert: [],
    }
  );
});

// 按所选账户类型的厂商能力，动态给出证书配置选项
const certModeOptions = computed(() => {
  const caps = providerCaps.value[accountTypes.value[form.aid]] || {};
  const opts: any[] = [{ label: '什么都不做', value: 'none' }];
  if (caps.freecert) opts.push({ label: '平台免费证书', value: 'freecert' });
  if (caps.certapply) opts.push({ label: '项目申请证书上传绑定', value: 'certapply' });
  if (caps.certlink) opts.push({ label: '由本项目管理', value: 'certlink' });
  return opts;
});
const linkCanConfirm = computed(() => !!linkChoice.value && !!linkCandidates.value);

const columns: any[] = [
  { type: 'selection' },
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '加速域名',
    key: 'name',
    minWidth: 170,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.name });
    },
  },
  { title: '线路', key: 'routename', width: 140 },
  {
    title: '源站',
    key: 'origin',
    minWidth: 160,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.origin || '' });
    },
  },
  {
    title: 'CNAME',
    key: 'cname',
    minWidth: 180,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.cname || '' });
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row: any) {
      return h(NTag, { type: row.status === 'offline' ? 'default' : 'success', size: 'small' }, { default: () => row.status });
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 400,
    render(row: any) {
      const btns: any[] = [];
      if (row.can_freecert || row.can_certapply || row.can_certlink) {
        btns.push(h(NButton, { size: 'tiny', type: 'info', onClick: () => openCertMgr(row) }, { default: () => '证书管理' }));
      }
      btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => (window.location.href = `/cdn-domains/${row.id}/setting`) }, { default: () => '配置' }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }));
      return h(NSpace, null, { default: () => btns });
    },
  },
];

async function loadDomains() {
  loading.value = true;
  const res = await api<any>('GET', '/cdn/domains');
  domains.value = res.code === 0 ? res.data : [];
  loading.value = false;
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cdn/accounts');
  if (res.code === 0) {
    accountOptions.value = res.data.map((a: any) => ({ label: `${a.id} - ${a.typename}（${a.name}）`, value: a.id }));
    for (const a of res.data) accountTypes.value[a.id] = a.type;
  }
}

async function loadDnsDomains() {
  const res = await api<any>('GET', '/domains');
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

watch(
  () => form.name,
  (v) => matchDnsDomain(v),
);

async function loadProviders() {
  const res = await api<any>('GET', '/cdn/providers');
  if (res.code === 0) providerCaps.value = res.data || {};
}

async function onAccountChange(aid: number) {
  form.zone_id = null;
  zoneOptions.value = [];
  const type = accountTypes.value[aid];
  if (type === 'tencent_edgeone' || type === 'aliyun_esa') {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/zones`);
    if (res.code === 0) zoneOptions.value = res.data.map((z: any) => ({ label: z.zoneName, value: z.zoneId }));
  }
}

function goZones() {
  window.location.href = '/cdn-zones';
}

function openAdd() {
  Object.assign(form, {
    aid: null,
    did: null,
    zone_id: null,
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
  });
  matchedDomain.value = '';
  zoneOptions.value = [];
  addStep.value = 1;
  showAdd.value = true;
}

function nextAddStep() {
  if (addStep.value === 1) {
    if (!form.aid) return message.warning('请选择 CDN 账户');
    if (addFlow.value.zone.needed && !form.zone_id) return message.warning('请选择' + addFlow.value.zone.label);
    if (addFlow.value.serviceArea.needed && !form.service_area) return message.warning('请选择服务区域');
  } else if (addStep.value === 2) {
    if (!form.name) return message.warning('请输入加速域名');
    if (!form.did) return message.warning('未匹配到联动域名，请确认加速域名属于已在「域名管理」中添加的域名');
  } else if (addStep.value === 3) {
    if (!form.origin) return message.warning('请输入源站地址');
    if (addFlow.value.origin.host && form.origin_host_mode === 'custom' && !form.origin_host_custom) return message.warning('请输入回源 HOST');
  }
  addStep.value++;
}

function certChoiceLabel(choice: string): string {
  if (choice === 'default') return "默认 Let's Encrypt";
  if (choice.startsWith('order:')) return `证书 #${choice.slice(6)}`;
  return `证书提供商 #${choice.slice(4)}`;
}

async function pickCertSource() {
  if (!form.name) return message.warning('请先填写加速域名');
  const choice = await openLinkDialog({ name: form.name });
  if (!choice) return;
  form.cert_choice = choice;
  form.cert_choice_label = certChoiceLabel(choice);
}

async function submitAdd() {
  if (form.cert_mode === 'certlink' && !form.cert_choice) return message.warning('请选择证书来源');
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
  saving.value = true;
  const res = await api<any>('POST', '/cdn/domains', payload);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showAdd.value = false;
    loadDomains();
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
  linkLoading.value = true;
  const res = await fetchCandidates(target.name);
  linkLoading.value = false;
  if (res.code !== 0) {
    linkError.value = res.msg || '获取证书候选失败';
  } else {
    const d = res.data || {};
    linkCandidates.value = d;
    if (d.exact && d.exact.length) linkChoice.value = `order:${d.exact[0].oid}`;
    else if (d.defaultLe) linkChoice.value = 'default';
  }
  return new Promise((resolve) => {
    linkResolve = resolve;
  });
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
  if (!linkChoice.value) return message.warning('请选择证书或证书提供商');
  finishLink(linkChoice.value);
}

async function doSync() {
  if (!syncAid.value) return message.warning('请选择 CDN 账户');
  syncing.value = true;
  const res = await api('POST', '/cdn/sync', { aid: syncAid.value, did: syncDid.value });
  syncing.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showSync.value = false;
    loadDomains();
  } else message.error(res.msg);
}

async function openCert(ids: number[], mode: 'free' | 'link') {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return message.warning(mode === 'link' ? '请先勾选要申请证书的加速域名' : '请先勾选要配置平台免费证书的加速域名');
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
  certRunning.value = true;
  const base = certMode.value === 'link' ? '/cdn/domains/cert' : '/cdn/domains/freecert';
  const res = await api<any>('POST', checkOnly ? base + '/check' : base, { ids });
  certRunning.value = false;
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
  const state = reactive({ alsoCloud: false });
  dialog.warning({
    title: '删除加速域名',
    content: () =>
      h('div', null, [
        h('div', { style: 'margin-bottom:10px' }, `确定删除 ${row.name} 吗？`),
        h(
          NCheckbox,
          {
            checked: state.alsoCloud,
            'onUpdate:checked': (v: boolean) => (state.alsoCloud = v),
          },
          { default: () => '同时删除云端加速域名（云端删除后不可恢复）' },
        ),
        h('div', { style: 'margin-top:6px;color:#9ca3af;font-size:12px' }, '不勾选时仅删除本系统记录，云端加速域名保留。'),
      ]),
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (state.alsoCloud) {
        // 删除云端域名需要二次确认
        dialog.warning({
          title: '二次确认',
          content: `将同时删除云端加速域名 ${row.name}，删除后云端资源不可恢复，确定继续吗？`,
          positiveText: '确认删除',
          negativeText: '取消',
          onPositiveClick: () => doDelete(row, true),
        });
        return true;
      }
      await doDelete(row, false);
      return true;
    },
  });
}

async function doDelete(row: any, deleteCloud: boolean) {
  const res = await api('DELETE', `/cdn/domains/${row.id}${deleteCloud ? '?delete_cloud=1' : ''}`);
  if (res.code === 0) {
    message.success(res.msg);
    loadDomains();
  } else message.error(res.msg);
}

onMounted(() => {
  loadDomains();
  loadAccounts();
  loadDnsDomains();
  loadProviders();
});

onUnmounted(() => {
  stopLinkLogTimer();
});
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.cert-tip + .cert-tip {
  margin-top: 10px;
}
.cert-hint {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
.link-target {
  margin-bottom: 12px;
  font-size: 13px;
  word-break: break-all;
}
.link-hint {
  color: #9ca3af;
  font-size: 13px;
}
.link-warn {
  color: #f0a020;
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
  color: #6b7280;
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
  color: #6b7280;
  word-break: break-word;
}
.cert-scope {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: #2080f0;
  word-break: break-all;
}
.cert-records {
  margin-top: 6px;
  padding: 8px;
  border-radius: 6px;
  background: #f5f7fa;
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
  border: 1px solid #eef0f3;
  border-radius: 6px;
  padding: 4px 10px;
}
.link-log-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed #f0f1f3;
  font-size: 12px;
}
.link-log-item:last-child {
  border-bottom: none;
}
.link-log-node {
  color: #2080f0;
  white-space: nowrap;
}
.link-log-msg {
  flex: 1;
  color: #4b5563;
  word-break: break-word;
}
.link-log-time {
  color: #9ca3af;
  white-space: nowrap;
}
.cert-divider {
  margin: 16px 0 8px;
  font-size: 13px;
}
.cloud-cert {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #eef0f3;
  border-radius: 6px;
  background: #fafbfc;
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
  border-top: 1px dashed #f0f1f3;
}
.cloud-cert-name {
  font-weight: 600;
  word-break: break-all;
}
.cloud-cert-meta {
  margin-top: 2px;
  font-size: 12px;
  color: #6b7280;
  word-break: break-all;
}
.add-steps {
  margin-bottom: 18px;
}
.add-form {
  min-height: 200px;
}
.port-label {
  font-size: 13px;
  color: #6b7280;
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