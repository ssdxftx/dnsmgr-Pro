<template>
  <div>
    <template v-if="sub === 'rules'">
      <EsaRulesModule :aid="aid" :zone-id="zoneId" :domains="domains" only-kind="CacheRule" :title="t('esaZone.cacheRules')" />
    </template>

    <template v-else-if="sub === 'tags'">
      <EsaActionPanel
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.cacheTags')"
        :desc="t('esaZone.cacheTagsDesc')"
        load-action="GetCacheTag"
        save-action="UpdateCacheTag"
        :fields="cacheTagFields"
      />
    </template>

    <template v-else-if="sub === 'devmode'">
      <EsaActionPanel
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.cacheDevMode')"
        :desc="t('esaZone.cacheDevModeDesc')"
        load-action="GetDevelopmentMode"
        save-action="UpdateDevelopmentMode"
        :fields="devModeFields"
      />
    </template>

    <template v-else-if="sub === 'analytics'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.cacheAnalytics') }}</h3>
        </div>
        <p class="esa-module__hint">{{ t('esaZone.cacheAnalyticsHint') }}</p>
        <n-button size="small" type="primary" @click="openStats('account')">{{ t('esaZone.openAnalytics') }}</n-button>
      </div>
    </template>

    <template v-else-if="sub === 'purge'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.cachePurge') }}</h3>
          <div class="app-panel__extra">
            <n-tag v-if="quota" size="small" :bordered="false">
              {{ t('esaZone.cachePurgeQuota') }}：{{ quota.Usage ?? 0 }} / {{ quota.Quota ?? 0 }}
            </n-tag>
          </div>
        </div>
        <n-form label-placement="left" label-width="120" size="small">
          <n-form-item :label="t('esaZone.purgeType')">
            <EsaCardSelect
              v-model="purgeForm.Type"
              :options="purgeTypes"
              style="max-width: 460px"
              @update:model-value="loadQuota"
            />
          </n-form-item>
          <n-form-item :label="t('esaZone.purgeContent')">
            <n-input
              v-model:value="purgeForm.Content"
              type="textarea"
              :rows="6"
              class="mono-input"
              spellcheck="false"
              :placeholder="purgePlaceholder"
            />
          </n-form-item>
          <n-form-item :label="t('esaZone.purgeForce')">
            <n-switch v-model:value="purgeForm.Force" size="small" />
          </n-form-item>
          <n-form-item :show-label="false">
            <n-button size="small" type="primary" :loading="purgeBusy" :disabled="purgeBusy" @click="submitPurge">
              {{ t('esaZone.purgeSubmit') }}
            </n-button>
          </n-form-item>
        </n-form>
      </div>
      <EsaActionTable
        ref="purgeTasks"
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.purgeTasks')"
        :columns="taskColumns"
        list-action="DescribePurgeTasks"
        items-path="Tasks"
      />
    </template>

    <template v-else-if="sub === 'prefetch'">
      <div class="app-panel">
        <div class="app-panel__head">
          <h3 class="app-panel__title">{{ t('esaZone.cachePrefetch') }}</h3>
        </div>
        <n-form label-placement="left" label-width="120" size="small">
          <n-form-item :label="t('esaZone.prefetchContent')">
            <n-input
              v-model:value="prefetchForm.Content"
              type="textarea"
              :rows="6"
              class="mono-input"
              spellcheck="false"
              placeholder='["https://example.com/a.js"]'
            />
          </n-form-item>
          <n-form-item label="Headers">
            <n-input
              v-model:value="prefetchForm.Headers"
              type="textarea"
              :rows="3"
              class="mono-input"
              spellcheck="false"
              placeholder='{"X-Test":["1"]}'
            />
          </n-form-item>
          <n-form-item :show-label="false">
            <n-button size="small" type="primary" :loading="prefetchBusy" :disabled="prefetchBusy" @click="submitPrefetch">
              {{ t('esaZone.prefetchSubmit') }}
            </n-button>
          </n-form-item>
        </n-form>
      </div>
      <EsaActionTable
        ref="prefetchTasks"
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.prefetchTasks')"
        :columns="taskColumns"
        list-action="DescribePreloadTasks"
        items-path="Tasks"
      />
    </template>

    <template v-else-if="sub === 'tiered'">
      <EsaActionPanel
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.cacheTiered')"
        :desc="t('esaZone.cacheTieredDesc')"
        load-action="GetTieredCache"
        save-action="UpdateTieredCache"
        :fields="tieredFields"
      />
    </template>

    <template v-else>
      <EsaActionPanel
        :aid="aid"
        :zone-id="zoneId"
        :title="t('esaZone.cacheReserve')"
        :desc="t('esaZone.cacheReserveDesc')"
        gate="Enterprise"
        load-action="GetCacheReserve"
        save-action="UpdateCacheReserve"
        :fields="reserveFields"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessage, NButton, NForm, NFormItem, NInput, NSwitch, NTag } from 'naive-ui';
import { api } from '../../api';
import EsaActionPanel, { type EsaFieldDef } from './EsaActionPanel.vue';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';
import EsaRulesModule from './EsaRulesModule.vue';
import EsaCardSelect from './EsaCardSelect.vue';

const props = defineProps<{ aid: number; zoneId: string; domains: string[] }>();
const { t } = useI18n();
const router = useRouter();

function openStats(target: string) {
  router.push({ path: '/statistics/aliyun_esa', query: { aid: String(props.aid), zone: props.zoneId, tab: 'analytics', sub: target } });
}
const message = useMessage();

const sub = defineModel<string>('sub', { default: 'rules' });
const taskColumns = computed<EsaTableColumn[]>(() => [
  { key: 'TaskId', label: t('esaZone.taskId'), width: 160, mono: true, fallbackKeys: ['Id'] },
  { key: 'Type', label: t('esaZone.taskType'), width: 110 },
  { key: 'Status', label: t('esaZone.status'), width: 110 },
  { key: 'Progress', label: t('esaZone.taskProgress'), width: 100 },
  { key: 'CreateTime', label: t('esaZone.createTime'), minWidth: 180 },
]);

const purgeTasks = ref<any>(null);
const prefetchTasks = ref<any>(null);
const quota = ref<any>(null);
const purgeBusy = ref(false);
const prefetchBusy = ref(false);
const purgeForm = reactive({ Type: 'file', Content: '', Force: false });
const prefetchForm = reactive({ Content: '[]', Headers: '' });

const purgeTypes = computed(() => [
  { label: t('esaZone.purgeTypeFile'), value: 'file', desc: t('esaZone.purgeTypeFileDesc') },
  { label: t('esaZone.purgeTypeDirectory'), value: 'directory', desc: t('esaZone.purgeTypeDirectoryDesc') },
  { label: t('esaZone.purgeTypeCacheTag'), value: 'cachetag', desc: t('esaZone.purgeTypeCacheTagDesc') },
  { label: t('esaZone.purgeTypeHostname'), value: 'hostname', desc: t('esaZone.purgeTypeHostnameDesc') },
  { label: t('esaZone.purgeTypeIgnoreParams'), value: 'ignoreParams', desc: t('esaZone.purgeTypeIgnoreParamsDesc') },
  { label: t('esaZone.purgeTypeAll'), value: 'purgeall', desc: t('esaZone.purgeTypeAllDesc') },
]);

const purgePlaceholder = computed(() => {
  const map: Record<string, string> = {
    file: '{"Files":["https://example.com/a.js"]}',
    directory: '{"Directories":["https://example.com/static/"]}',
    cachetag: '{"CacheTags":["tag1"]}',
    hostname: '{"Hostnames":["example.com"]}',
    ignoreParams: '{"Files":["https://example.com/a.js"]}',
    purgeall: '{}',
  };
  return map[purgeForm.Type] || '{}';
});

const cacheTagFields = computed<EsaFieldDef[]>(() => [
  { name: 'TagName', label: 'CacheTag', type: 'text', placeholder: 'my-tag', help: t('esaZone.cacheTagNameHelp') },
  { name: 'CaseInsensitive', label: t('esaZone.cacheTagCase'), type: 'onoff', default: false, help: t('esaZone.cacheTagCaseHelp') },
]);

const devModeFields = computed<EsaFieldDef[]>(() => [
  { name: 'Enable', label: t('esaZone.cacheDevModeEnable'), type: 'onoff', default: false, help: t('esaZone.cacheDevModeEnableHelp') },
]);

const tieredFields = computed<EsaFieldDef[]>(() => [
  {
    name: 'CacheArchitectureMode',
    label: t('esaZone.cacheTiered'),
    type: 'cards',
    default: 'edge',
    options: [
      { label: 'Edge', value: 'edge', desc: t('esaZone.cacheTieredEdgeDesc') },
      { label: 'Edge + Smart', value: 'edge_smart', desc: t('esaZone.cacheTieredEdgeSmartDesc') },
      { label: 'Edge + Regional', value: 'edge_regional', desc: t('esaZone.cacheTieredEdgeRegionalDesc') },
    ],
    help: t('esaZone.cacheTieredHelp'),
  },
]);

const reserveFields = computed<EsaFieldDef[]>(() => [
  { name: 'Enable', label: 'Enable', type: 'onoff', default: false },
  { name: 'CacheReserveInstanceId', label: 'InstanceId', type: 'text' },
]);

async function call(action: string, params: Record<string, any> = {}) {
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
    action,
    zoneId: props.zoneId,
    params,
  });
  if (res.code !== 0) throw new Error(res.msg || t('esaZone.loadFailed'));
  return res.data;
}

async function loadQuota() {
  try {
    quota.value = await call('GetPurgeQuota', { Type: purgeForm.Type });
  } catch {
    quota.value = null;
  }
}

async function submitPurge() {
  let content: any = {};
  const text = purgeForm.Content.trim();
  if (text) {
    try {
      content = JSON.parse(text);
    } catch {
      return message.warning(t('esaZone.invalidJson'));
    }
  }
  purgeBusy.value = true;
  try {
    await call('PurgeCaches', { Type: purgeForm.Type, Content: content, Force: purgeForm.Force });
    message.success(t('esaZone.submitted'));
    purgeTasks.value?.load?.();
    loadQuota();
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  } finally {
    purgeBusy.value = false;
  }
}

async function submitPrefetch() {
  let content: any = [];
  try {
    content = JSON.parse(prefetchForm.Content || '[]');
  } catch {
    return message.warning(t('esaZone.invalidJson'));
  }
  if (!Array.isArray(content) || !content.length) return message.warning(t('esaZone.prefetchNeedUrls'));
  let headers: any = undefined;
  if (prefetchForm.Headers.trim()) {
    try {
      headers = JSON.parse(prefetchForm.Headers);
    } catch {
      return message.warning(t('esaZone.invalidJson'));
    }
  }
  prefetchBusy.value = true;
  try {
    await call('PreloadCaches', { Content: content, ...(headers ? { Headers: headers } : {}) });
    message.success(t('esaZone.submitted'));
    prefetchTasks.value?.load?.();
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  } finally {
    prefetchBusy.value = false;
  }
}

onMounted(loadQuota);
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
</style>
