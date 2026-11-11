<template>
  <n-modal
    :show="show"
    preset="card"
    :title="modalTitle"
    class="modal-md"
    :mask-closable="false"
    @update:show="onVisibleChange"
  >
    <n-spin :show="zoneBusy || checkBusy || switchBusy">
      <n-alert v-if="errorMsg" type="error" :show-icon="true" class="switch-alert">{{ errorMsg }}</n-alert>

      <template v-if="step === 'target'">
        <div class="switch-route">
          <n-tag :bordered="false">{{ currentRouteName }}</n-tag>
          <span class="switch-arrow">→</span>
          <n-tag type="info" :bordered="false">{{ targetRouteName }}</n-tag>
        </div>
        <n-form label-placement="left" label-width="110" class="switch-form">
          <n-form-item :label="t('cdnDomain.accelDomain')">
            <n-input :value="row?.name || ''" readonly />
          </n-form-item>
          <n-form-item :label="t('cdnDomain.switchAccount')">
            <EsaCardSelect
              :model-value="targetAid"
              :options="targetAccounts"
              compact
              :disabled="checkBusy"
              :placeholder="targetAccounts.length ? t('common.pleaseSelect') : t('cdnDomain.switchNoAccount')"
              @update:model-value="onAidChange"
            />
          </n-form-item>
          <n-form-item :label="t('cdnDomain.switchSite')">
            <EsaCardSelect
              :model-value="targetZoneId"
              :options="siteOptions"
              compact
              searchable
              :disabled="!targetAid || zoneBusy || checkBusy"
              :placeholder="t('cdnDomain.switchSitePlaceholder')"
              @update:model-value="(v: any) => (targetZoneId = v)"
            />
          </n-form-item>
        </n-form>
        <n-alert v-if="targetAid && !zoneBusy && !siteOptions.length" type="warning" :show-icon="true" class="switch-alert">
          {{ t('cdnDomain.switchNoSite', { domain: dnsName || row?.name || '-' }) }}
        </n-alert>
        <n-alert type="info" :show-icon="true" class="switch-alert">{{ t('cdnDomain.switchSiteHint') }}</n-alert>
      </template>

      <template v-else-if="step === 'confirm'">
        <n-alert type="success" :show-icon="true" class="switch-alert">
          {{ t('cdnDomain.switchExistsHint', { zone: targetZoneName || targetZoneId }) }}
        </n-alert>
        <div class="switch-cname">
          <span class="switch-label">{{ t('cdnDomain.switchTargetCname') }}</span>
          <code>{{ targetCname }}</code>
        </div>
        <n-alert type="info" :show-icon="true" class="switch-alert">
          {{ t('cdnDomain.switchDnsHint', { record: recordName, dns: dnsName }) }}
        </n-alert>
        <n-alert type="warning" :show-icon="true" class="switch-alert">{{ t('cdnDomain.switchCertWarn') }}</n-alert>
      </template>

      <template v-else-if="step === 'origin'">
        <n-alert type="info" :show-icon="true" class="switch-alert">
          {{ t('cdnDomain.switchCreateHint', { name: row?.name || '' }) }}
        </n-alert>
        <n-form label-placement="left" label-width="110" class="switch-form">
          <n-form-item :label="t('cdnDomain.origin')">
            <n-input v-model:value="originForm.origin" :placeholder="t('cdnDomain.originPlaceholder')" />
          </n-form-item>
          <n-form-item :label="t('cdnDomain.originType')">
            <n-radio-group v-model:value="originForm.origin_type">
              <n-radio value="ipaddr">{{ t('cdnDomain.originTypeIp') }}</n-radio>
              <n-radio value="domain">{{ t('cdnDomain.originTypeDomain') }}</n-radio>
            </n-radio-group>
          </n-form-item>
          <n-form-item v-if="originCaps.protocol" :label="t('cdnDomain.originProtocol')">
            <n-radio-group v-model:value="originForm.origin_protocol">
              <n-radio value="follow">{{ t('cdnDomain.protoFollow') }}</n-radio>
              <n-radio value="http">HTTP</n-radio>
              <n-radio value="https">HTTPS</n-radio>
            </n-radio-group>
          </n-form-item>
          <n-form-item v-if="originCaps.ports" :label="t('cdnDomain.originPort')">
            <div class="port-grid">
              <label class="port-field">
                <span class="port-field__label">HTTP</span>
                <n-input-number v-model:value="originForm.http_port" :min="1" :max="65535" :show-button="false" placeholder="80" class="port-field__input" />
              </label>
              <label class="port-field">
                <span class="port-field__label">HTTPS</span>
                <n-input-number v-model:value="originForm.https_port" :min="1" :max="65535" :show-button="false" placeholder="443" class="port-field__input" />
              </label>
            </div>
          </n-form-item>
          <n-form-item v-if="originCaps.host" :label="t('cdnDomain.originHost')">
            <n-space vertical style="width: 100%">
              <n-radio-group v-model:value="originForm.origin_host_mode">
                <n-space :wrap="true">
                  <n-radio value="accelerate">{{ t('cdnDomain.hostAccelerate') }}</n-radio>
                  <n-radio value="origin">{{ t('cdnDomain.hostOrigin') }}</n-radio>
                  <n-radio value="custom">{{ t('cdnDomain.custom') }}</n-radio>
                </n-space>
              </n-radio-group>
              <n-input
                v-if="originForm.origin_host_mode === 'custom'"
                v-model:value="originForm.origin_host_custom"
                :placeholder="t('cdnDomain.hostCustomPlaceholder')"
              />
            </n-space>
          </n-form-item>
        </n-form>
      </template>

      <template v-else>
        <div class="switch-route">
          <n-tag :bordered="false">{{ row?.name }}</n-tag>
          <span class="switch-arrow">→</span>
          <n-tag type="info" :bordered="false">{{ targetRouteName }}</n-tag>
        </div>
        <n-form-item v-if="certModeOptions.length > 1" :label="t('cdnDomain.certSetting')" label-placement="left" label-width="110">
          <n-radio-group v-model:value="certMode" @update:value="onCertModeChange">
            <n-space vertical>
              <n-radio v-for="o in certModeOptions" :key="o.value" :value="o.value">{{ o.label }}</n-radio>
            </n-space>
          </n-radio-group>
        </n-form-item>
        <n-alert v-else type="info" :show-icon="true" class="switch-alert">{{ t('cdnDomain.certNotNeeded') }}</n-alert>

        <template v-if="certMode === 'certlink'">
          <n-alert type="info" :show-icon="true" class="switch-alert">{{ t('cdnDomain.certLinkHint') }}</n-alert>
          <n-form-item :label="t('cdnDomain.pickCertSource')" label-placement="left" label-width="110">
            <n-select
              v-model:value="certChoice"
              :options="certSourceOptions"
              :loading="certSourceBusy"
              :placeholder="certSourceOptions.length ? t('common.pleaseSelect') : t('cdnDomain.notSelected')"
              style="width: 100%"
            />
          </n-form-item>
          <n-alert v-if="certSourceError" type="error" :show-icon="true" class="switch-alert">{{ certSourceError }}</n-alert>
        </template>
        <n-alert v-else-if="certMode === 'freecert'" type="info" :show-icon="true" class="switch-alert">{{ t('cdnDomain.freeCertHint') }}</n-alert>
        <n-alert v-else-if="certMode === 'certapply'" type="info" :show-icon="true" class="switch-alert">{{ t('cdnDomain.certApplyHint') }}</n-alert>
      </template>
    </n-spin>

    <template #footer>
      <n-space justify="space-between" style="width: 100%">
        <n-button :disabled="switchBusy" @click="close">{{ t('common.cancel') }}</n-button>
        <n-space>
          <n-button v-if="step !== 'target'" :disabled="switchBusy" @click="prev">{{ t('cdnDomain.prev') }}</n-button>
          <n-button type="primary" :loading="checkBusy || switchBusy" :disabled="primaryDisabled" @click="primary">
            {{ primaryText }}
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { NAlert, NButton, NForm, NFormItem, NInput, NInputNumber, NModal, NRadio, NRadioGroup, NSelect, NSpace, NSpin, NTag, useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';
import EsaCardSelect from './EsaCardSelect.vue';

type Step = 'target' | 'confirm' | 'origin' | 'cert';

const props = defineProps<{
  show: boolean;
  row: any;
  accounts: { label: string; value: any }[];
  accountTypes: Record<number, string>;
  providerCaps: Record<string, any>;
}>();

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void;
  (e: 'done', v: any): void;
}>();

const { t } = useI18n();
const message = useMessage();

const step = ref<Step>('target');
const targetAid = ref<number | null>(null);
const targetZoneId = ref('');
const targetZoneName = ref('');
const zones = ref<any[]>([]);
const zoneBusy = ref(false);
const checkBusy = ref(false);
const switchBusy = ref(false);
const errorMsg = ref('');
const targetCname = ref('');
const dnsName = ref('');
const recordName = ref('');

const originForm = reactive<any>({
  origin: '',
  origin_type: 'ipaddr',
  origin_protocol: 'follow',
  http_port: 80,
  https_port: 443,
  origin_host_mode: 'accelerate',
  origin_host_custom: '',
});

const certMode = ref('none');
const certChoice = ref('');
const certSourceOptions = ref<{ label: string; value: string }[]>([]);
const certSourceBusy = ref(false);
const certSourceError = ref('');
// 账户/站点快速切换时丢弃旧请求，避免晚到的站点列表覆盖新选择
let sitesSeq = 0;
let checkSeq = 0;

const partner = computed(() => String(props.providerCaps?.[props.row?.route]?.switchPartner || ''));
const targetRouteName = computed(() => props.providerCaps?.[partner.value]?.name || partner.value || '-');
const currentRouteName = computed(() => props.providerCaps?.[props.row?.route]?.name || props.row?.routename || props.row?.route || '-');
const targetAccounts = computed(() => props.accounts.filter((a) => props.accountTypes[a.value] === partner.value));
const siteOptions = computed(() => zones.value.map((z: any) => ({ label: z.zoneName, value: z.zoneId, desc: z.planName || z.area || '' })));
const originCaps = computed<any>(() => props.providerCaps?.[partner.value]?.addFlow?.origin || { protocol: true, ports: true, host: true });

const certModeOptions = computed(() => {
  const caps = props.providerCaps?.[partner.value] || {};
  const opts: { label: string; value: string }[] = [{ label: t('cdnDomain.certModeNone'), value: 'none' }];
  if (caps.freecert) opts.push({ label: t('cdnDomain.freeCert'), value: 'freecert' });
  if (caps.certapply) opts.push({ label: t('cdnDomain.certApply'), value: 'certapply' });
  if (caps.certlink) opts.push({ label: t('cdnDomain.certLink'), value: 'certlink' });
  return opts;
});

const modalTitle = computed(() => {
  if (step.value === 'confirm') return t('cdnDomain.switchConfirmTitle');
  if (step.value === 'origin') return t('cdnDomain.switchOriginTitle');
  if (step.value === 'cert') return t('cdnDomain.addTitle4');
  return t('cdnDomain.switchTitle');
});

const primaryText = computed(() => {
  if (step.value === 'target') return t('cdnDomain.next');
  if (step.value === 'origin') return t('cdnDomain.next');
  if (step.value === 'confirm') return t('cdnDomain.switchConfirm');
  return t('cdnDomain.switchCreate');
});

const primaryDisabled = computed(() => {
  if (switchBusy.value) return true;
  if (step.value === 'target') return !targetAid.value || !targetZoneId.value || !!zoneBusy.value;
  if (step.value === 'origin') {
    if (!originForm.origin) return true;
    if (originCaps.value.host && originForm.origin_host_mode === 'custom' && !originForm.origin_host_custom) return true;
    return false;
  }
  if (step.value === 'cert') return certMode.value === 'certlink' && !certChoice.value;
  return false;
});

function reset() {
  sitesSeq++;
  checkSeq++;
  step.value = 'target';
  targetAid.value = targetAccounts.value.length === 1 ? targetAccounts.value[0].value : null;
  targetZoneId.value = '';
  targetZoneName.value = '';
  zones.value = [];
  zoneBusy.value = false;
  checkBusy.value = false;
  errorMsg.value = '';
  targetCname.value = '';
  dnsName.value = '';
  recordName.value = '';
  certMode.value = 'none';
  certChoice.value = '';
  certSourceOptions.value = [];
  certSourceError.value = '';
  Object.assign(originForm, {
    origin: String(props.row?.origin || ''),
    origin_type: String(props.row?.origin_type || 'ipaddr'),
    origin_protocol: String(props.row?.origin_protocol || 'follow'),
    http_port: Number(props.row?.http_port || 80),
    https_port: Number(props.row?.https_port || 443),
    origin_host_mode: props.row?.origin_host ? (String(props.row.origin_host) === String(props.row.name) ? 'accelerate' : 'custom') : 'origin',
    origin_host_custom: String(props.row?.origin_host || ''),
  });
  if (targetAid.value) void loadSites(targetAid.value);
}

watch(
  () => [props.show, props.row?.id] as const,
  ([v]) => {
    if (v) reset();
  },
  { immediate: true },
);

function close() {
  if (switchBusy.value) return;
  sitesSeq++;
  checkSeq++;
  emit('update:show', false);
}

function onVisibleChange(v: boolean) {
  if (!v && switchBusy.value) return;
  emit('update:show', v);
}

function onAidChange(v: any) {
  targetAid.value = v;
  targetZoneId.value = '';
  targetZoneName.value = '';
  zones.value = [];
  if (v) void loadSites(v);
}

async function loadSites(aid: number) {
  if (!props.row?.id) return;
  const seq = ++sitesSeq;
  zoneBusy.value = true;
  errorMsg.value = '';
  try {
    const res = await api<any>('GET', `/cdn/domains/${props.row.id}/switch/sites`, { aid });
    if (seq !== sitesSeq) return;
    if (res.code !== 0) {
      errorMsg.value = res.msg || t('common.loadFailed');
      return;
    }
    zones.value = res.data?.zones || [];
    dnsName.value = res.data?.dnsName || '';
    if (zones.value.length === 1) targetZoneId.value = zones.value[0].zoneId;
  } catch (e: any) {
    if (seq === sitesSeq) errorMsg.value = e?.message || String(e);
  } finally {
    if (seq === sitesSeq) zoneBusy.value = false;
  }
}

async function primary() {
  if (step.value === 'target') return nextFromTarget();
  if (step.value === 'origin') return nextFromOrigin();
  return submit();
}

function prev() {
  errorMsg.value = '';
  if (step.value === 'cert') step.value = 'origin';
  else if (step.value === 'origin' || step.value === 'confirm') step.value = 'target';
}

async function nextFromTarget() {
  if (!targetAid.value || !targetZoneId.value) return;
  const seq = ++checkSeq;
  const zone = zones.value.find((z: any) => String(z.zoneId) === String(targetZoneId.value));
  targetZoneName.value = zone?.zoneName || '';
  checkBusy.value = true;
  errorMsg.value = '';
  try {
    const res = await api<any>('GET', `/cdn/domains/${props.row.id}/switch/check`, { aid: targetAid.value, zone_id: targetZoneId.value });
    if (seq !== checkSeq) return;
    if (res.code !== 0) {
      errorMsg.value = res.msg || t('common.loadFailed');
      return;
    }
    targetCname.value = res.data?.cname || '';
    dnsName.value = res.data?.dnsName || dnsName.value;
    recordName.value = res.data?.recordName || '';
    step.value = res.data?.exists ? 'confirm' : 'origin';
  } catch (e: any) {
    if (seq === checkSeq) errorMsg.value = e?.message || String(e);
  } finally {
    if (seq === checkSeq) checkBusy.value = false;
  }
}

function nextFromOrigin() {
  if (!originForm.origin) return;
  step.value = 'cert';
}

function onCertModeChange(v: string) {
  errorMsg.value = '';
  if (v === 'certlink' && !certSourceOptions.value.length) void loadCertSources();
}

async function loadCertSources() {
  if (!props.row?.name) return;
  certSourceBusy.value = true;
  certSourceError.value = '';
  certSourceOptions.value = [];
  try {
    const res = await api<any>('GET', `/cdn/cert/candidates?name=${encodeURIComponent(props.row.name)}`);
    if (res.code !== 0) {
      certSourceError.value = res.msg || t('cdnDomain.fetchCandidatesFailed');
      return;
    }
    const d = res.data || {};
    const opts: { label: string; value: string }[] = [];
    for (const o of d.exact || []) opts.push({ label: t('cdnDomain.certChoiceOrder', { id: o.oid }), value: `order:${o.oid}` });
    for (const p of d.providers || []) opts.push({ label: `${p.typename}（${p.name}）`, value: `aid:${p.aid}` });
    if (d.defaultLe && !opts.length) opts.push({ label: t('cdnDomain.certChoiceDefault'), value: 'default' });
    certSourceOptions.value = opts;
    if (opts.length === 1) certChoice.value = opts[0].value;
  } catch (e: any) {
    certSourceError.value = e?.message || String(e);
  } finally {
    certSourceBusy.value = false;
  }
}

function certExtra(): Record<string, any> {
  if (certMode.value !== 'certlink') return {};
  if (certChoice.value.startsWith('order:')) return { cert_order_id: Number(certChoice.value.slice(6)) };
  if (certChoice.value.startsWith('aid:')) return { cert_aid: Number(certChoice.value.slice(4)) };
  if (certChoice.value === 'default') return { cert_use_default: 1 };
  return {};
}

async function submit() {
  if (!props.row?.id || !targetAid.value || !targetZoneId.value) return;
  if (step.value === 'cert' && certMode.value === 'certlink' && !certChoice.value) return;
  const host = originForm.origin_host_mode === 'accelerate' ? props.row.name : originForm.origin_host_mode === 'custom' ? originForm.origin_host_custom : '';
  const payload: Record<string, any> = {
    aid: targetAid.value,
    zone_id: targetZoneId.value,
    // 预检后目标域名若被删除，确认页也能用当前回源信息补建；已存在时后端不会改回源
    origin: originForm.origin,
    origin_type: originForm.origin_type,
    origin_protocol: originForm.origin_protocol,
    http_port: originForm.http_port,
    https_port: originForm.https_port,
    origin_host: host,
  };
  if (step.value === 'cert') {
    Object.assign(payload, {
      cert_mode: certMode.value,
      ...certExtra(),
    });
  }
  switchBusy.value = true;
  errorMsg.value = '';
  try {
    const res = await api<any>('POST', `/cdn/domains/${props.row.id}/switch`, payload);
    if (res.code !== 0) {
      errorMsg.value = res.msg || t('cdnDomain.switchFailed');
      return;
    }
    message.success(res.msg || t('cdnDomain.switchSuccess'), { duration: 6000 });
    const warnings = Array.isArray(res.data?.warnings) ? res.data.warnings : [];
    if (warnings.length) message.warning(warnings.join('；'), { duration: 10000 });
    emit('done', res.data || {});
    emit('update:show', false);
  } catch (e: any) {
    errorMsg.value = e?.message || String(e);
  } finally {
    switchBusy.value = false;
  }
}
</script>

<style scoped>
.switch-route {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.switch-arrow {
  color: var(--n-text-color-3, #888);
}
.switch-form {
  margin-top: 4px;
}
.switch-alert {
  margin: 10px 0;
}
.switch-cname {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.switch-label {
  color: var(--n-text-color-3, #888);
}
.switch-cname code {
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.12);
  word-break: break-all;
}
.port-grid {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.port-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.port-field__label {
  font-size: 12px;
  color: var(--n-text-color-3, #888);
}
.port-field__input {
  width: 110px;
}
</style>
