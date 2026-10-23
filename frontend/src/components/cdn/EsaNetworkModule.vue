<template>
  <div>
    <template v-if="sub === 'speed'">
      <EsaActionPanel
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.speedMonitor')"
        :desc="t('esaZone.speedMonitorHint')"
        load-action="GetPerformanceDataCollection"
        save-action="UpdatePerformanceDataCollection"
        :fields="speedFields"
      />
    </template>

    <template v-else>
      <EsaActionTable
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.compressionRules')"
        :desc="t('esaZone.compressionRulesDesc')"
        list-action="ListCompressionRules"
        items-path="Configs"
        id-key="ConfigId"
        name-key="RuleName"
        :columns="compressionColumns"
        create-action="CreateCompressionRule"
        :create-fields="compressionFields"
        update-action="UpdateCompressionRule"
        :update-fields="compressionFields"
        delete-action="DeleteCompressionRule"
      />
      <EsaActionTable
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.networkOptimization')"
        :desc="t('esaZone.networkOptimizationDesc')"
        list-action="ListNetworkOptimizations"
        items-path="Configs"
        id-key="ConfigId"
        name-key="RuleName"
        :columns="networkColumns"
        create-action="CreateNetworkOptimization"
        :create-fields="networkFields"
        update-action="UpdateNetworkOptimization"
        :update-fields="networkFields"
        delete-action="DeleteNetworkOptimization"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';
import EsaActionPanel, { type EsaFieldDef } from './EsaActionPanel.vue';

defineProps<{ aid: number; zoneId: string }>();
const { t } = useI18n();

const sub = defineModel<string>('sub', { default: 'optimization' });

const speedFields = computed<EsaFieldDef[]>(() => [
  { name: 'Enable', label: t('esaZone.speedMonitorEnable'), type: 'onoff', default: false, help: t('esaZone.speedMonitorEnableHelp') },
]);

const onoffOptions = [
  { label: 'on', value: 'on' },
  { label: 'off', value: 'off' },
];

const compressionColumns = computed<EsaTableColumn[]>(() => [
  { key: 'RuleName', label: t('esaZone.ruleName'), minWidth: 160 },
  { key: 'Gzip', label: 'Gzip', width: 80 },
  { key: 'Brotli', label: 'Brotli', width: 80 },
  { key: 'Zstd', label: 'Zstd', width: 80 },
  { key: 'RuleEnable', label: t('esaZone.ruleStatus'), width: 100 },
  { key: 'Sequence', label: 'Sequence', width: 100 },
]);

const compressionFields = computed<EsaFieldDef[]>(() => [
  { name: 'RuleName', label: t('esaZone.ruleName'), type: 'text', required: true },
  { name: 'RuleEnable', label: t('esaZone.ruleStatus'), type: 'select', default: 'on', options: onoffOptions },
  { name: 'Rule', label: 'Rule', type: 'text', placeholder: '(http.host eq "example.com")' },
  { name: 'Gzip', label: 'Gzip', type: 'select', default: 'on', options: onoffOptions },
  { name: 'Brotli', label: 'Brotli', type: 'select', default: 'on', options: onoffOptions },
  { name: 'Zstd', label: 'Zstd', type: 'select', default: 'off', options: onoffOptions },
  { name: 'Sequence', label: 'Sequence', type: 'number', default: 0 },
]);

const networkColumns = computed<EsaTableColumn[]>(() => [
  { key: 'RuleName', label: t('esaZone.ruleName'), minWidth: 160 },
  { key: 'SmartRouting', label: t('esaZone.smartRouting'), width: 110 },
  { key: 'Http2Origin', label: 'HTTP/2 Origin', width: 120 },
  { key: 'Websocket', label: 'WebSocket', width: 110 },
  { key: 'Grpc', label: 'gRPC', width: 90 },
  { key: 'UploadMaxFilesize', label: 'Upload MB', width: 110 },
  { key: 'RuleEnable', label: t('esaZone.ruleStatus'), width: 100 },
]);

const networkFields = computed<EsaFieldDef[]>(() => [
  { name: 'RuleName', label: t('esaZone.ruleName'), type: 'text', required: true },
  { name: 'RuleEnable', label: t('esaZone.ruleStatus'), type: 'select', default: 'on', options: onoffOptions },
  { name: 'Rule', label: 'Rule', type: 'text', placeholder: '(http.host eq "example.com")' },
  { name: 'SmartRouting', label: t('esaZone.smartRouting'), type: 'select', default: 'off', options: onoffOptions },
  { name: 'Http2Origin', label: 'HTTP/2 Origin', type: 'select', default: 'off', options: onoffOptions },
  { name: 'Websocket', label: 'WebSocket', type: 'select', default: 'on', options: onoffOptions },
  { name: 'Grpc', label: 'gRPC', type: 'select', default: 'off', options: onoffOptions },
  { name: 'UploadMaxFilesize', label: 'Upload MB', type: 'number', default: 100, min: 100, max: 500 },
  { name: 'Sequence', label: 'Sequence', type: 'number', default: 0 },
]);
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
</style>
