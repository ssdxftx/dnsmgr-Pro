<template>
  <div>
    <template v-if="sub === 'overview'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.sslOverview') }}</h3>
          <div class="app-panel__extra">
            <n-button size="small" :loading="busy" :disabled="busy" @click="loadCounts">{{ t('esaZone.reload') }}</n-button>
          </div>
        </div>
        <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>
        <div class="esa-ssl__grid">
          <button type="button" class="esa-ssl__card" @click="sub = 'edge'">
            <span class="esa-ssl__card-title">{{ t('esaZone.sslEdgeCerts') }}</span>
            <span class="esa-ssl__card-value">{{ counts.edge }}</span>
            <span class="esa-ssl__card-desc">{{ t('esaZone.sslEdgeCertsDesc') }}</span>
          </button>
          <button type="button" class="esa-ssl__card" @click="sub = 'client'">
            <span class="esa-ssl__card-title">{{ t('esaZone.sslClientCerts') }}</span>
            <span class="esa-ssl__card-value">{{ counts.client }}</span>
            <span class="esa-ssl__card-desc">{{ t('esaZone.sslClientCertsDesc') }}</span>
          </button>
          <button type="button" class="esa-ssl__card" @click="sub = 'origin'">
            <span class="esa-ssl__card-title">{{ t('esaZone.sslOriginCerts') }}</span>
            <span class="esa-ssl__card-value">{{ counts.origin }}</span>
            <span class="esa-ssl__card-desc">{{ t('esaZone.sslOriginCertsDesc') }}</span>
          </button>
          <div class="esa-ssl__card esa-ssl__card--static">
            <span class="esa-ssl__card-title">{{ t('esaZone.sslFreeQuota') }}</span>
            <span class="esa-ssl__card-value">{{ quota ? `${quota.QuotaUsage ?? 0} / ${quota.Quota ?? 0}` : '-' }}</span>
            <span class="esa-ssl__card-desc">{{ t('esaZone.sslFreeQuotaDesc') }}</span>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="sub === 'edge'">
      <EsaActionTable
        ref="edgeTable"
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.sslEdgeCerts')"
        :desc="t('esaZone.sslEdgeCertsDesc')"
        :columns="certColumns"
        list-action="ListCertificates"
        items-path="Result"
        id-key="Id"
        name-key="Name"
      >
        <template #actions>
          <n-button size="small" type="primary" @click="showApply = true">{{ t('esaZone.sslApply') }}</n-button>
        </template>
      </EsaActionTable>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.sslFreeQuota') }}</h3>
        </div>
        <n-descriptions :column="3" label-placement="left" size="small">
          <n-descriptions-item :label="t('esaZone.sslQuota')">{{ quota?.Quota ?? '-' }}</n-descriptions-item>
          <n-descriptions-item :label="t('esaZone.sslUsage')">{{ quota?.QuotaUsage ?? '-' }}</n-descriptions-item>
          <n-descriptions-item :label="t('esaZone.sslType')">{{ quota?.Type ?? 'free' }}</n-descriptions-item>
        </n-descriptions>
      </div>
    </template>

    <template v-else-if="sub === 'client'">
      <EsaActionTable
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.sslClientCerts')"
        :desc="t('esaZone.sslClientCertsDesc')"
        :columns="certColumns"
        list-action="ListClientCertificates"
        id-key="Id"
        name-key="Name"
        create-action="CreateClientCertificate"
        delete-action="DeleteClientCertificate"
      />
    </template>

    <template v-else>
      <EsaActionTable
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.sslOriginCerts')"
        :desc="t('esaZone.sslOriginCertsDesc')"
        :columns="certColumns"
        list-action="ListSiteOriginClientCertificates"
        id-key="Id"
        name-key="Name"
        create-action="UploadSiteOriginClientCertificate"
        delete-action="DeleteSiteOriginClientCertificate"
      />
    </template>

    <n-modal v-model:show="showApply" preset="card" :title="t('esaZone.sslApply')" class="modal-md" :mask-closable="false">
      <n-form label-placement="left" label-width="110" size="small">
        <n-form-item :label="t('esaZone.sslDomains')">
          <n-input v-model:value="applyForm.Domains" placeholder="example.com,www.example.com" />
        </n-form-item>
        <n-form-item :label="t('esaZone.sslCertType')">
          <EsaCardSelect v-model="applyForm.Type" :options="certTypeOptions" compact />
        </n-form-item>
        <n-form-item :label="t('esaZone.sslAlgType')">
          <n-input v-model:value="applyForm.AlgType" placeholder="RSA / ECC" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showApply = false">{{ t('esaZone.cancel') }}</n-button>
          <n-button type="primary" :loading="applyBusy" :disabled="applyBusy" @click="applyCert">{{ t('esaZone.sslApply') }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessage, NAlert, NButton, NDescriptions, NDescriptionsItem, NForm, NFormItem, NInput, NModal, NSpace } from 'naive-ui';
import { api } from '../../api';
import EsaCardSelect from './EsaCardSelect.vue';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';

const props = defineProps<{ aid: number; zoneId: string }>();
const { t } = useI18n();
const message = useMessage();

const sub = defineModel<string>('sub', { default: 'overview' });
const busy = ref(false);
const loadError = ref('');
const counts = reactive({ edge: 0, client: 0, origin: 0 });
const quota = ref<any>(null);
const showApply = ref(false);
const applyBusy = ref(false);
const edgeTable = ref<any>(null);
const applyForm = reactive({ Domains: '', Type: 'lets_encrypt', AlgType: '' });

const certColumns = computed<EsaTableColumn[]>(() => [
  { key: 'Id', label: t('esaZone.certId'), width: 150, mono: true, fallbackKeys: ['CertificateId'] },
  { key: 'Name', label: t('esaZone.name'), minWidth: 180, fallbackKeys: ['Domain'] },
  { key: 'Type', label: t('esaZone.sslCertType'), width: 110 },
  { key: 'Status', label: t('esaZone.status'), width: 100 },
  { key: 'NotAfter', label: t('esaZone.certNotAfter'), minWidth: 170 },
]);

const certTypeOptions = computed(() => [
  { label: t('esaZone.sslCertLetsEncrypt'), value: 'lets_encrypt', desc: t('esaZone.sslCertLetsEncryptDesc') },
  { label: t('esaZone.sslCertDigiSingle'), value: 'digicert_single', desc: t('esaZone.sslCertDigiSingleDesc') },
  { label: t('esaZone.sslCertDigiWildcard'), value: 'digicert_wildcard', desc: t('esaZone.sslCertDigiWildcardDesc') },
]);

async function call(action: string, params: Record<string, any> = {}) {
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action,
      zoneId: props.zoneId,
      params,
    });
    return res.code === 0 ? res.data : null;
  } catch {
    return null;
  }
}

async function loadCounts() {
  busy.value = true;
  loadError.value = '';
  try {
    const [edge, client, origin, q] = await Promise.all([
      call('ListCertificates', { PageSize: 1 }),
      call('ListClientCertificates', { PageSize: 1 }),
      call('ListSiteOriginClientCertificates', { PageSize: 1 }),
      call('GetCertificateQuota', { Type: 'free' }),
    ]);
    if ([edge, client, origin, q].every((v) => v === null)) {
      loadError.value = t('esaZone.loadFailed');
      return;
    }
    counts.edge = Number(edge?.TotalCount ?? (edge?.Result || []).length ?? 0);
    counts.client = Number(client?.TotalCount ?? (client?.Result || []).length ?? 0);
    counts.origin = Number(origin?.TotalCount ?? (origin?.Result || []).length ?? 0);
    quota.value = q || null;
  } finally {
    busy.value = false;
  }
}

async function applyCert() {
  if (!applyForm.Domains.trim()) return message.warning(t('esaZone.sslDomainsRequired'));
  applyBusy.value = true;
  try {
    const params: Record<string, any> = { Domains: applyForm.Domains.trim(), Type: applyForm.Type };
    if (applyForm.AlgType.trim()) params.AlgType = applyForm.AlgType.trim();
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action: 'ApplyCertificate',
      zoneId: props.zoneId,
      params,
    });
    if (res.code === 0) {
      message.success(t('esaZone.saved'));
      showApply.value = false;
      edgeTable.value?.load?.();
      loadCounts();
    } else {
      message.error(res.msg || t('esaZone.saveFailed'));
    }
  } finally {
    applyBusy.value = false;
  }
}

onMounted(loadCounts);
</script>

<style scoped>
.esa-ssl__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}
.esa-ssl__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px 12px 16px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.18s var(--app-ease), transform 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.esa-ssl__card::before {
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
.esa-ssl__card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.esa-ssl__card:hover::before {
  opacity: 1;
}
.esa-ssl__card--static {
  cursor: default;
}
.esa-ssl__card--static:hover {
  transform: none;
  box-shadow: none;
  border-color: var(--app-divider);
}
.esa-ssl__card--static:hover::before {
  opacity: 0;
}
.esa-ssl__card-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-ssl__card-value {
  font-family: var(--app-font-mono);
  font-size: 20px;
  color: var(--app-primary);
}
.esa-ssl__card-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--app-text-3);
}
</style>
