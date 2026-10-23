<template>
  <div>
    <template v-if="sub === 'lists'">
      <EsaActionTable
        :aid="aid"
        zone-id=""
        :title="t('esaAccount.globalLists')"
        :desc="t('esaAccount.globalListsDesc')"
        list-action="ListLists"
        items-path="Lists"
        id-key="Id"
        name-key="Name"
        :columns="listColumns"
        :create-action="'CreateList'"
        :create-label="t('esaZone.create')"
        :create-fields="listCreateFields"
        :update-action="'UpdateList'"
        :update-fields="listUpdateFields"
        :delete-action="'DeleteList'"
        :paginate="false"
      />
    </template>

    <template v-else-if="sub === 'waf'">
      <div v-if="!instanceId" class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">
            {{ t('esaAccount.globalWaf') }}
            <n-tag size="tiny" :bordered="false" type="warning" style="margin-left: 6px">{{ t('esaAccount.globalWafGate') }}</n-tag>
          </h3>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.globalWafDesc') }}</p>
        <n-alert type="info" :show-icon="false">{{ t('esaAccount.globalWafNoInstance') }}</n-alert>
      </div>
      <EsaActionTable
        v-else
        :aid="aid"
        zone-id=""
        :title="t('esaAccount.globalWaf')"
        :desc="t('esaAccount.globalWafDesc')"
        list-action="ListUserWafRulesets"
        items-path="Rulesets"
        id-key="Id"
        name-key="Name"
        :columns="wafColumns"
        :list-params="{ InstanceId: instanceId }"
        :extra-params="{ InstanceId: instanceId }"
        :create-action="'CreateUserWafRuleset'"
        :create-label="t('esaZone.create')"
        :create-fields="wafCreateFields"
        :update-action="'UpdateUserWafRuleset'"
        :update-fields="wafUpdateFields"
        :delete-action="'DeleteUserWafRuleset'"
        :paginate="false"
      />
    </template>

    <template v-else-if="sub === 'scenario'">
      <EsaActionTable
        :aid="aid"
        zone-id=""
        :title="t('esaAccount.globalScenario')"
        :desc="t('esaAccount.globalScenarioDesc')"
        list-action="DescribeCustomScenePolicies"
        items-path="Policies"
        id-key="PolicyId"
        name-key="Name"
        :columns="scenarioColumns"
        :create-action="'CreateCustomScenePolicy'"
        :create-label="t('esaZone.create')"
        :create-fields="scenarioCreateFields"
        :update-action="'UpdateCustomScenePolicy'"
        :update-fields="scenarioCreateFields"
        :delete-action="'DeleteCustomScenePolicy'"
        :paginate="false"
      />
    </template>

    <template v-else-if="sub === 'pages'">
      <EsaActionTable
        :aid="aid"
        zone-id=""
        :title="t('esaAccount.globalPages')"
        :desc="t('esaAccount.globalPagesDesc')"
        list-action="ListPages"
        items-path="Pages"
        id-key="Id"
        name-key="Name"
        :columns="pageColumns"
        :create-action="'CreatePage'"
        :create-label="t('esaZone.create')"
        :create-fields="pageCreateFields"
        :update-action="'UpdatePage'"
        :update-fields="pageUpdateFields"
        :delete-action="'DeletePage'"
        :paginate="false"
      />
    </template>

    <template v-else>
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">
            {{ t('esaAccount.globalRateLimit') }}
            <n-tag size="tiny" :bordered="false" type="warning" style="margin-left: 6px">{{ t('esaAccount.globalRateLimitGate') }}</n-tag>
          </h3>
        </div>
        <p class="esa-module__hint">{{ t('esaAccount.globalRateLimitDesc') }}</p>
        <n-alert type="info" :show-icon="false">{{ t('esaAccount.globalRateLimitNote') }}</n-alert>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NAlert, NTag } from 'naive-ui';
import EsaActionTable from './EsaActionTable.vue';
import type { EsaFieldDef } from './EsaActionPanel.vue';
import type { EsaTableColumn } from './EsaActionTable.vue';

defineProps<{ aid: number; instanceId: string }>();
const { t } = useI18n();

const sub = defineModel<string>('sub', { default: 'lists' });

const listColumns = computed<EsaTableColumn[]>(() => [
  { key: 'Id', label: 'ID', width: 70 },
  { key: 'Name', label: t('esaAccount.listName'), minWidth: 160 },
  { key: 'Kind', label: t('esaAccount.listKind'), width: 110 },
  { key: 'Description', label: t('esaAccount.listDescription'), minWidth: 180 },
  { key: 'Items', label: t('esaAccount.listItems'), minWidth: 220, format: 'json' },
]);

const listItemRows: EsaFieldDef['rowFields'] = [
  { name: 'Value', label: t('esaAccount.listItemValue'), width: 220 },
  { name: 'Description', label: t('esaAccount.listItemDescription'), width: 240 },
];

const listCreateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaAccount.listName'), required: true },
  {
    name: 'Kind',
    label: t('esaAccount.listKind'),
    type: 'select',
    options: [
      { label: 'IP', value: 'ip' },
      { label: 'ASN', value: 'asn' },
      { label: 'Host', value: 'host' },
      { label: 'Country', value: 'country' },
    ],
  },
  { name: 'Description', label: t('esaAccount.listDescription'), type: 'textarea' },
  { name: 'Items', label: t('esaAccount.listItems'), type: 'rows', rowFields: listItemRows, addLabel: t('esaZone.addItem') },
]);

const listUpdateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaAccount.listName'), required: true },
  { name: 'Description', label: t('esaAccount.listDescription'), type: 'textarea' },
  { name: 'Items', label: t('esaAccount.listItems'), type: 'rows', rowFields: listItemRows, addLabel: t('esaZone.addItem') },
]);

const wafColumns = computed<EsaTableColumn[]>(() => [
  { key: 'Id', label: 'ID', width: 70 },
  { key: 'Name', label: t('esaAccount.wafName'), minWidth: 160 },
  { key: 'Phase', label: t('esaAccount.wafPhase'), minWidth: 150 },
  { key: 'Status', label: t('esaAccount.wafStatus'), width: 100 },
  { key: 'Expression', label: t('esaAccount.wafExpression'), minWidth: 220, mono: true },
]);

const wafPhaseOptions = [
  { label: 'http_custom', value: 'http_custom' },
  { label: 'http_ratelimit', value: 'http_ratelimit' },
  { label: 'http_managed', value: 'http_managed' },
  { label: 'http_anti_scan', value: 'http_anti_scan' },
  { label: 'http_whitelist', value: 'http_whitelist' },
  { label: 'ip_access_rule', value: 'ip_access_rule' },
  { label: 'http_security_level_rule', value: 'http_security_level_rule' },
];

const wafCreateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Phase', label: t('esaAccount.wafPhase'), type: 'select', required: true, options: wafPhaseOptions },
  { name: 'Name', label: t('esaAccount.wafName'), required: true },
  { name: 'Description', label: t('esaAccount.listDescription'), type: 'textarea' },
  {
    name: 'Status',
    label: t('esaAccount.wafStatus'),
    type: 'select',
    required: true,
    options: [
      { label: 'on', value: 'on' },
      { label: 'off', value: 'off' },
    ],
  },
  { name: 'Expression', label: t('esaAccount.wafExpression'), type: 'textarea', required: true, placeholder: '(http.host eq "example.com")' },
  {
    name: 'Shared',
    label: 'Shared',
    type: 'select',
    options: [
      { label: 'on', value: 'on' },
      { label: 'off', value: 'off' },
    ],
  },
  { name: 'Rules', label: t('esaAccount.wafRules'), type: 'json', help: 'JSON array' },
]);

const wafUpdateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaAccount.wafName') },
  { name: 'Description', label: t('esaAccount.listDescription'), type: 'textarea' },
  {
    name: 'Status',
    label: t('esaAccount.wafStatus'),
    type: 'select',
    options: [
      { label: 'on', value: 'on' },
      { label: 'off', value: 'off' },
    ],
  },
  { name: 'Expression', label: t('esaAccount.wafExpression'), type: 'textarea' },
  {
    name: 'Shared',
    label: 'Shared',
    type: 'select',
    options: [
      { label: 'on', value: 'on' },
      { label: 'off', value: 'off' },
    ],
  },
  { name: 'Position', label: 'Position', type: 'number', min: 0 },
  { name: 'Rules', label: t('esaAccount.wafRules'), type: 'json', help: 'JSON array' },
]);

const scenarioColumns = computed<EsaTableColumn[]>(() => [
  { key: 'PolicyId', label: 'ID', width: 70 },
  { key: 'Name', label: t('esaAccount.scenarioName'), minWidth: 160 },
  { key: 'Template', label: t('esaAccount.scenarioTemplate'), minWidth: 140 },
  { key: 'StartTime', label: t('esaAccount.scenarioStart'), minWidth: 170 },
  { key: 'EndTime', label: t('esaAccount.scenarioEnd'), minWidth: 170 },
  { key: 'Status', label: t('esaAccount.planStatus'), width: 100 },
]);

const scenarioCreateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaAccount.scenarioName'), required: true },
  {
    name: 'Template',
    label: t('esaAccount.scenarioTemplate'),
    type: 'select',
    required: true,
    options: [
      { label: 'Major Event', value: 'major_event' },
      { label: 'Promotion', value: 'promotion' },
      { label: 'Custom', value: 'custom' },
    ],
  },
  { name: 'StartTime', label: t('esaAccount.scenarioStart'), required: true, placeholder: '2026-11-10T20:00:00Z' },
  { name: 'EndTime', label: t('esaAccount.scenarioEnd'), required: true, placeholder: '2026-11-11T02:00:00Z' },
  { name: 'SiteIds', label: t('esaAccount.scenarioSites'), placeholder: '1000000001,1000000002' },
  { name: 'Objects', label: t('esaAccount.scenarioObjects'), type: 'textarea', placeholder: 'JSON' },
]);

const pageColumns = computed<EsaTableColumn[]>(() => [
  { key: 'Id', label: 'ID', width: 70 },
  { key: 'Name', label: t('esaAccount.pageName'), minWidth: 160 },
  { key: 'ContentType', label: t('esaAccount.pageContentType'), minWidth: 130 },
  { key: 'Description', label: t('esaAccount.pageDescription'), minWidth: 200 },
]);

const pageCreateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaAccount.pageName'), required: true },
  { name: 'Description', label: t('esaAccount.pageDescription'), type: 'textarea' },
  {
    name: 'ContentType',
    label: t('esaAccount.pageContentType'),
    type: 'select',
    required: true,
    options: [
      { label: 'text/html', value: 'text/html' },
      { label: 'application/json', value: 'application/json' },
    ],
  },
  { name: 'Content', label: t('esaAccount.pageContent'), type: 'textarea' },
  { name: 'SiteIds', label: t('esaAccount.pageSites'), type: 'json', help: 'JSON array' },
]);

const pageUpdateFields = computed<EsaFieldDef[]>(() => [
  { name: 'Name', label: t('esaAccount.pageName'), required: true },
  { name: 'Description', label: t('esaAccount.pageDescription'), type: 'textarea', required: true },
  { name: 'ContentType', label: t('esaAccount.pageContentType'), type: 'select', required: true, options: pageCreateFields.value[2].options },
  { name: 'Content', label: t('esaAccount.pageContent'), type: 'textarea', required: true },
  { name: 'SiteIds', label: t('esaAccount.pageSites'), type: 'json', help: 'JSON array' },
]);
</script>
