<template>
  <div>
    <template v-if="sub === 'smart'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.smartRouting') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaZone.smartRoutingHint') }}</p>
        <n-button size="small" type="primary" @click="emit('go', 'network', 'optimization')">{{ t('esaZone.goNetworkOptimization') }}</n-button>
      </div>
    </template>

    <template v-else-if="sub === 'waiting'">
      <EsaWaitingRoomModule :aid="aid" :zone-id="zoneId" />
    </template>

    <template v-else-if="sub === 'pools'">
      <EsaActionTable
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.originPools')"
        :desc="t('esaZone.originPoolsDesc')"
        list-action="ListOriginPools"
        items-path="OriginPools"
        id-key="Id"
        name-key="Name"
        :columns="poolColumns"
        create-action="CreateOriginPool"
        :create-fields="poolCreateFields"
        update-action="UpdateOriginPool"
        :update-fields="poolUpdateFields"
        delete-action="DeleteOriginPool"
      />
    </template>

    <template v-else>
      <EsaLoadBalancerModule :aid="aid" :zone-id="zoneId" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton } from 'naive-ui';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';
import EsaWaitingRoomModule from './EsaWaitingRoomModule.vue';
import EsaLoadBalancerModule from './EsaLoadBalancerModule.vue';
import type { EsaFieldDef } from './EsaActionPanel.vue';
import type { EsaRowFieldDef } from './EsaRowsEditor.vue';

defineProps<{ aid: number; zoneId: string }>();
const emit = defineEmits<{ (e: 'go', target: string, sub?: string): void }>();
const { t } = useI18n();

const sub = defineModel<string>('sub', { default: 'pools' });

const poolColumns = computed<EsaTableColumn[]>(() => [
  { key: 'Id', label: 'Id', width: 110, mono: true },
  { key: 'Name', label: t('esaZone.name'), minWidth: 160 },
  { key: 'Enabled', label: t('esaZone.enabled'), width: 90, format: 'bool' },
  { key: 'Origins', label: t('esaZone.origins'), minWidth: 260, format: 'json', mono: true },
]);

const originRowFields = computed<EsaRowFieldDef[]>(() => [
  { name: 'Name', label: t('esaZone.originName'), width: 100, placeholder: 'origin-1' },
  { name: 'Address', label: t('esaZone.originAddress'), width: 150, placeholder: '1.2.3.4' },
  { name: 'Weight', label: t('esaZone.weight'), type: 'number', width: 70, min: 0, max: 100 },
  { name: 'Enabled', label: t('esaZone.enabled'), type: 'switch', width: 64 },
  {
    name: 'Type',
    label: t('esaZone.originType'),
    type: 'select',
    width: 96,
    options: [
      { label: 'IP / Domain', value: 'ip_domain' },
      { label: 'OSS', value: 'OSS' },
      { label: 'S3', value: 'S3' },
    ],
  },
  {
    name: 'IpVersionPolicy',
    label: t('esaZone.ipVersionPolicy'),
    type: 'select',
    width: 110,
    options: [
      { label: 'Round robin', value: 'round_robin' },
      { label: 'IPv4 first', value: 'ipv4_first' },
      { label: 'IPv6 first', value: 'ipv6_first' },
      { label: 'Follow client', value: 'follow' },
    ],
  },
]);

const poolCreateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaZone.name'), type: 'text', required: true },
  { name: 'Enabled', label: t('esaZone.enabled'), type: 'switch', default: true },
  {
    name: 'Origins',
    label: t('esaZone.origins'),
    type: 'rows',
    rowFields: originRowFields.value,
    defaultRow: { Name: '', Address: '', Weight: 1, Enabled: true, Type: 'ip_domain', IpVersionPolicy: 'round_robin' },
    addLabel: t('esaZone.addOrigin'),
    help: t('esaZone.originsHelp'),
  },
]);

const poolUpdateFields = computed<EsaFieldDef[]>(() => poolCreateFields.value.filter((f) => f.name !== 'Name'));
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
</style>
