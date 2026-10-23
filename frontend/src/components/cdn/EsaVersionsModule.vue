<template>
  <div>
    <div class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">{{ t('esaZone.versionsTitle') }}</h3>
        <div class="app-panel__extra">
          <n-tag size="tiny" :bordered="false" type="warning">Premium</n-tag>
        </div>
      </div>
      <p class="esa-module__hint">{{ t('esaZone.versionsHint') }}</p>
      <n-space>
        <n-button size="small" type="primary" :loading="busy" :disabled="busy" @click="toggle(true)">
          {{ t('esaZone.versionsEnable') }}
        </n-button>
        <n-button size="small" :loading="busy" :disabled="busy" @click="toggle(false)">
          {{ t('esaZone.versionsDisable') }}
        </n-button>
      </n-space>
    </div>

    <EsaActionTable
      ref="table"
      :aid="aid"
      :zone-id="zoneId"
      :title="t('esaZone.versionsList')"
      :desc="t('esaZone.versionsListDesc')"
      :columns="versionColumns"
      list-action="ListVersions"
      items-path="SiteVersionList"
      :paginate="false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialog, useMessage, NButton, NSpace, NTag } from 'naive-ui';
import { api } from '../../api';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';

const props = defineProps<{ aid: number; zoneId: string }>();
const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();

const versionColumns = computed<EsaTableColumn[]>(() => [
  { key: 'Version', label: t('esaZone.versionNumber'), width: 110, mono: true, fallbackKeys: ['VersionId'] },
  { key: 'Description', label: t('esaZone.versionDescription'), minWidth: 260 },
  { key: 'CreateTime', label: t('esaZone.createTime'), minWidth: 180 },
]);

const busy = ref(false);
const table = ref<any>(null);

function toggle(enable: boolean) {
  const action = enable ? 'ActivateVersionManagement' : 'DeactivateVersionManagement';
  dialog.warning({
    title: enable ? t('esaZone.versionsEnable') : t('esaZone.versionsDisable'),
    content: enable ? t('esaZone.versionsEnableConfirm') : t('esaZone.versionsDisableConfirm'),
    positiveText: t('esaZone.confirm'),
    negativeText: t('esaZone.cancel'),
    onPositiveClick: async () => {
      busy.value = true;
      try {
        const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
          action,
          zoneId: props.zoneId,
          params: {},
        });
        if (res.code === 0) {
          message.success(t('esaZone.saved'));
          table.value?.load?.();
        } else {
          message.error(res.msg || t('esaZone.saveFailed'));
        }
      } finally {
        busy.value = false;
      }
    },
  });
}
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
</style>
