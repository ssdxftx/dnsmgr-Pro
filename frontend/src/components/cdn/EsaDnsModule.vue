<template>
  <div>
    <template v-if="sub === 'analytics'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.dnsAnalytics') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaZone.dnsAnalyticsHint') }}</p>
        <n-button size="small" type="primary" @click="openStats('account')">{{ t('esaZone.openAnalytics') }}</n-button>
      </div>
    </template>

    <template v-else-if="sub === 'saas'">
      <EsaActionTable
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.saasTitle')"
        :desc="t('esaZone.saasDesc')"
        list-action="ListCustomHostnames"
        id-key="Id"
        name-key="Hostname"
        :columns="saasColumns"
        create-action="CreateCustomHostname"
        :create-fields="saasCreateFields"
        delete-action="DeleteCustomHostname"
      />
    </template>

    <template v-else>
      <EsaActionPanel
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.dnsFlatten')"
        :desc="t('esaZone.dnsFlattenDesc')"
        load-action="GetCnameFlattening"
        save-action="UpdateCnameFlattening"
        :fields="flattenFields"
      />
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.dnsAdvanced') }}</h3>
        </div>
        <n-descriptions :column="1" label-placement="left" size="small" bordered>
          <n-descriptions-item :label="t('esaZone.dnsStaticIp')">
            <n-tag size="tiny" :bordered="false" type="warning">Enterprise</n-tag>
            <span class="hint-text" style="margin-left: 8px">{{ t('esaZone.dnsStaticIpHint') }}</span>
          </n-descriptions-item>
          <n-descriptions-item :label="t('esaZone.dnsVanityNs')">
            <span class="hint-text">{{ t('esaZone.dnsVanityNsHint') }}</span>
          </n-descriptions-item>
        </n-descriptions>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NDescriptions, NDescriptionsItem, NTag } from 'naive-ui';
import EsaActionPanel, { type EsaFieldDef } from './EsaActionPanel.vue';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';

const props = defineProps<{ aid: number; zoneId: string }>();
const { t } = useI18n();
const router = useRouter();

function openStats(target: string) {
  router.push({ path: '/statistics/aliyun_esa', query: { aid: String(props.aid), zone: props.zoneId, tab: 'analytics', sub: target } });
}

const sub = defineModel<string>('sub', { default: 'analytics' });

const saasColumns = computed<EsaTableColumn[]>(() => [
  { key: 'Hostname', label: t('esaZone.saasHostname'), minWidth: 200, mono: true },
  { key: 'Status', label: t('esaZone.status'), width: 110 },
  { key: 'RecordId', label: 'RecordId', width: 120 },
  { key: 'SslFlag', label: 'SSL', width: 80 },
  { key: 'CertType', label: t('esaZone.saasCertType'), width: 110 },
]);

const saasCreateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Hostname', label: t('esaZone.saasHostname'), type: 'text', required: true },
  { name: 'RecordId', label: 'RecordId', type: 'number', required: true, help: t('esaZone.saasRecordIdHelp') },
  { name: 'SslFlag', label: 'SSL', type: 'onoff', default: true },
  {
    name: 'CertType',
    label: t('esaZone.saasCertType'),
    type: 'select',
    default: 'free',
    options: [
      { label: 'free', value: 'free' },
      { label: 'upload', value: 'upload' },
      { label: 'cas', value: 'cas' },
    ],
  },
]);

const flattenFields = computed<EsaFieldDef[]>(() => [
  {
    name: 'FlattenMode',
    label: 'FlattenMode',
    type: 'cards',
    default: 'flatten_at_root',
    options: [
      { label: t('esaZone.flattenAll'), value: 'flatten_all', desc: t('esaZone.flattenAllDesc') },
      { label: t('esaZone.flattenRoot'), value: 'flatten_at_root', desc: t('esaZone.flattenRootDesc') },
    ],
    help: t('esaZone.flattenHelp'),
  },
]);
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
</style>
