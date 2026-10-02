<template>
  <div class="app-stack">
    <PageHeader :title="info?.name || t('cdnSetting.title')" :subtitle="t('cdnSetting.subtitle')" back="/cdn-domains">
      <template #actions>
        <n-space align="center">
          <n-tag size="small">{{ info?.routename || info?.route }}</n-tag>
          <n-tag size="small" :type="info?.status === 'offline' ? 'default' : 'success'">{{ t('cdnSetting.statusLabel') }}{{ info?.status === 'offline' ? t('cdnSetting.statusDisabled') : t('cdnSetting.statusEnabled') }}</n-tag>
          <span class="cname">{{ t('cdnSetting.cnameLabel') }}{{ info?.cname || t('cdnSetting.cnameNone') }}</span>
        </n-space>
      </template>
    </PageHeader>

    <n-space vertical :size="12" style="margin-top:12px">
      <n-card :title="t('cdnSetting.statusCard')" size="small" :bordered="false">
        <n-space>
          <n-button :type="info?.status === 'offline' ? 'success' : 'warning'" size="small" :loading="statusBusy" @click="toggleStatus">
            {{ info?.status === 'offline' ? t('cdnSetting.enableAccel') : t('cdnSetting.disableAccel') }}
          </n-button>
        </n-space>
      </n-card>

      <n-card :title="t('cdnSetting.originCard')" size="small" :bordered="false">
        <n-form label-placement="left" label-width="110">
          <n-form-item :label="t('cdnSetting.originLabel')">
            <n-input v-model:value="originForm.origin" :placeholder="t('cdnSetting.originPlaceholder')" />
          </n-form-item>
          <n-form-item :label="t('cdnSetting.originTypeLabel')">
            <n-radio-group v-model:value="originForm.origin_type">
              <n-radio value="ipaddr">{{ t('cdnSetting.originIp') }}</n-radio>
              <n-radio value="domain">{{ t('cdnSetting.originDomain') }}</n-radio>
            </n-radio-group>
          </n-form-item>
          <n-form-item :label="t('cdnSetting.originHostLabel')">
            <n-input v-model:value="originForm.origin_host" :placeholder="t('cdnSetting.originHostPlaceholder')" />
          </n-form-item>
          <n-form-item :label="t('cdnSetting.originProtocolLabel')">
            <n-select v-model:value="originForm.origin_protocol" :options="protoOptions" style="width:200px" />
          </n-form-item>
          <n-form-item :label="t('cdnSetting.originPortLabel')">
            <n-space>
              <n-input-number v-model:value="originForm.http_port" :min="1" style="width:120px" placeholder="HTTP" />
              <n-input-number v-model:value="originForm.https_port" :min="1" style="width:120px" placeholder="HTTPS" />
            </n-space>
          </n-form-item>
          <n-button type="primary" size="small" @click="saveOrigin">{{ t('cdnSetting.saveOrigin') }}</n-button>
        </n-form>
      </n-card>

      <n-card :title="t('cdnSetting.cacheCard')" size="small" :bordered="false">
        <n-space vertical size="small">
          <div v-for="(rule, idx) in cacheForm.rules" :key="idx" class="rule-row">
            <n-input v-model:value="rule.path" :placeholder="t('cdnSetting.cachePathPlaceholder')" />
            <n-input-number v-model:value="rule.ttl" :min="0" style="width:140px" :placeholder="t('cdnSetting.ttlPlaceholder')" />
            <n-button size="small" @click="removeRule(idx)">{{ t('common.delete') }}</n-button>
          </div>
          <n-space>
            <n-button size="small" dashed @click="addRule">{{ t('cdnSetting.addRule') }}</n-button>
            <n-button type="primary" size="small" :loading="savingCache" @click="saveCache">{{ t('cdnSetting.saveCache') }}</n-button>
          </n-space>
          <n-text depth="3" style="font-size: 12px">{{ t('cdnSetting.cacheHint') }}</n-text>
        </n-space>
      </n-card>

      <n-card :title="t('cdnSetting.httpsCard')" size="small" :bordered="false">
        <n-space vertical size="small">
          <n-space align="center">
            <span style="width:120px">{{ t('cdnSetting.enableHttps') }}</span>
            <n-switch v-model:value="httpsForm.https_enabled" />
          </n-space>
          <n-space align="center">
            <span style="width:120px">{{ t('cdnSetting.forceHttps') }}</span>
            <n-switch v-model:value="httpsForm.force_redirect" :disabled="!httpsForm.https_enabled" />
          </n-space>
          <n-button type="primary" size="small" :loading="savingHttps" @click="saveHttps">{{ t('cdnSetting.saveHttps') }}</n-button>
          <n-text depth="3" style="font-size: 12px">{{ t('cdnSetting.httpsHint') }}</n-text>
        </n-space>
      </n-card>

      <n-card :title="t('cdnSetting.accessCard')" size="small" :bordered="false">
        <n-form label-placement="left" label-width="110">
          <n-form-item :label="t('cdnSetting.refererLabel')">
            <n-radio-group v-model:value="accessForm.referer_mode">
              <n-radio value="off">{{ t('cdnSetting.off') }}</n-radio>
              <n-radio value="whitelist">{{ t('cdnSetting.whitelist') }}</n-radio>
              <n-radio value="blacklist">{{ t('cdnSetting.blacklist') }}</n-radio>
            </n-radio-group>
            <n-dynamic-tags
              v-if="accessForm.referer_mode !== 'off'"
              v-model:value="accessForm.referer_list"
              style="margin-top:8px"
            />
            <n-text v-if="accessForm.referer_mode !== 'off'" depth="3" style="font-size:12px">{{ t('cdnSetting.refererHint') }}</n-text>
          </n-form-item>
          <n-form-item :label="t('cdnSetting.ipListLabel')">
            <n-radio-group v-model:value="accessForm.ip_mode">
              <n-radio value="off">{{ t('cdnSetting.off') }}</n-radio>
              <n-radio value="whitelist">{{ t('cdnSetting.whitelist') }}</n-radio>
              <n-radio value="blacklist">{{ t('cdnSetting.blacklist') }}</n-radio>
            </n-radio-group>
            <n-dynamic-input
              v-if="accessForm.ip_mode !== 'off'"
              v-model:value="accessForm.ip_list"
              :placeholder="t('cdnSetting.ipPlaceholder')"
              style="margin-top:8px"
              type="input"
            />
          </n-form-item>
          <n-form-item :label="t('cdnSetting.uaLabel')">
            <n-dynamic-tags v-model:value="accessForm.ua_list" style="margin-top:8px" />
            <n-text depth="3" style="font-size:12px">{{ t('cdnSetting.uaHint') }}</n-text>
          </n-form-item>
          <n-button type="primary" size="small" :loading="savingAccess" @click="saveAccess">{{ t('cdnSetting.saveAccess') }}</n-button>
        </n-form>
      </n-card>
    </n-space>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';

const { t } = useI18n();
const route = useRoute();
const message = useMessage();
const domainId = Number(route.params.id);

const info = ref<any>(null);
const cacheRules = ref<any[]>([]);
const savingCache = ref(false);
const savingHttps = ref(false);
const savingAccess = ref(false);
const statusBusy = ref(false);

const protoOptions = computed(() => [
  { label: t('cdnSetting.protoFollow'), value: 'follow' },
  { label: 'HTTP', value: 'http' },
  { label: 'HTTPS', value: 'https' },
]);

const originForm = reactive<any>({ origin: '', origin_type: 'ipaddr', origin_host: '', origin_protocol: 'follow', http_port: 80, https_port: 443 });
const httpsForm = reactive<any>({ https_enabled: false, force_redirect: false });
const cacheForm = reactive<{ rules: { path: string; ttl: number }[] }>({ rules: [] });
const accessForm = reactive<any>({
  referer_mode: 'off',
  referer_list: [],
  ip_mode: 'off',
  ip_list: [],
  ua_list: [],
});

async function load() {
  const res = await api<any>('GET', `/cdn/domains/${domainId}`);
  if (res.code !== 0) {
    message.error(res.msg);
    return;
  }
  const { info: _info, cacheRules: _rules } = res.data;
  info.value = _info;
  cacheRules.value = _rules || [];
  Object.assign(originForm, {
    origin: _info.origin || '',
    origin_type: _info.origin_type || 'ipaddr',
    origin_host: _info.origin_host || '',
    origin_protocol: _info.origin_protocol || 'follow',
    http_port: _info.http_port || 80,
    https_port: _info.https_port || 443,
  });
  httpsForm.https_enabled = !!_info.https_enabled;
  httpsForm.force_redirect = !!_info.force_redirect;
  cacheForm.rules = (_rules || []).map((r: any) => ({ path: r.path, ttl: Number(r.ttl || 0) }));
  loadAccess();
}

async function loadAccess() {
  const res = await api<any>('GET', `/cdn/domains/${domainId}/access`).catch(() => ({ code: -1, data: null }));
  if (res.code === 0 && res.data) {
    Object.assign(accessForm, res.data);
  }
}

function addRule() {
  cacheForm.rules.push({ path: '', ttl: 0 });
}
function removeRule(idx: number) {
  cacheForm.rules.splice(idx, 1);
}

async function saveCache() {
  savingCache.value = true;
  try {
    const rules = cacheForm.rules.filter((r) => (r.path || '').trim() !== '');
    const res = await api('POST', `/cdn/domains/${domainId}/cache`, { rules });
    if (res.code === 0) {
      message.success(res.msg);
      load();
    } else message.error(res.msg);
  } finally {
    savingCache.value = false;
  }
}

async function saveHttps() {
  savingHttps.value = true;
  try {
    const res = await api('POST', `/cdn/domains/${domainId}/https`, {
      https_enabled: httpsForm.https_enabled,
      force_redirect: httpsForm.force_redirect,
    });
    if (res.code === 0) {
      message.success(res.msg);
      load();
    } else message.error(res.msg);
  } finally {
    savingHttps.value = false;
  }
}

async function saveAccess() {
  savingAccess.value = true;
  try {
    const res = await api('POST', `/cdn/domains/${domainId}/access`, accessForm);
    if (res.code === 0) {
      message.success(res.msg);
      loadAccess();
    } else message.error(res.msg);
  } finally {
    savingAccess.value = false;
  }
}

async function setStatus(status: string) {
  statusBusy.value = true;
  try {
    const res = await api('POST', `/cdn/domains/${domainId}/status`, { status });
    if (res.code === 0) {
      message.success(res.msg);
      load();
    } else message.error(res.msg);
  } finally {
    statusBusy.value = false;
  }
}

function toggleStatus() {
  return setStatus(info.value?.status === 'offline' ? 'online' : 'offline');
}

async function saveOrigin() {
  if (!originForm.origin) return message.warning(t('cdnSetting.originRequired'));
  const res = await api('POST', `/cdn/domains/${domainId}/origin`, originForm);
  if (res.code === 0) {
    message.success(res.msg);
    load();
  } else message.error(res.msg);
}

onMounted(load);
</script>

<style scoped>
.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.domain-name {
  font-weight: 600;
  font-size: 16px;
}
.cname {
  color: var(--app-text-3);
  font-size: 13px;
}
.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rule-row .n-input {
  flex: 1;
}
</style>