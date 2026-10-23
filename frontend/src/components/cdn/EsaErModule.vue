<template>
  <div>
    <EsaActionTable
      :aid="aid"
      :zone-id="zoneId"
      :title="t('esaZone.erRoutines')"
      :desc="t('esaZone.erRoutinesDesc')"
      list-action="ListUserRoutines"
      items-path="Routines"
      id-key="Name"
      name-key="Name"
      :columns="routineColumns"
      :paginate="false"
    />

    <div class="app-panel">
      <div class="app-panel__head">
        <h3 class="app-panel__title">{{ t('esaZone.erRoutes') }}</h3>
        <div class="app-panel__extra">
          <EsaCardSelect
            v-model="routine"
            :options="routineOptions"
            :placeholder="t('esaZone.erPickRoutine')"
            compact
            searchable
            style="width: 320px"
          />
        </div>
      </div>
      <p class="esa-module__hint">{{ t('esaZone.erRoutesDesc') }}</p>
      <n-empty v-if="!routine" size="small" :description="t('esaZone.erPickRoutineHint')" />
    </div>

    <EsaActionTable
      v-if="routine"
      :key="routine"
      :aid="aid"
      :zone-id="zoneId"
      :title="t('esaZone.erRoutes')"
      :desc="`Routine: ${routine}`"
      list-action="ListRoutineRoutes"
      :list-params="{ RoutineName: routine }"
      items-path="Configs"
      id-key="ConfigId"
      name-key="RouteName"
      :columns="routeColumns"
      create-action="CreateRoutineRoute"
      :create-params="{ RoutineName: routine }"
      :create-fields="routeFields"
      update-action="UpdateRoutineRoute"
      :update-fields="routeFields"
      delete-action="DeleteRoutineRoute"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NEmpty, useMessage } from 'naive-ui';
import { api } from '../../api';
import EsaCardSelect from './EsaCardSelect.vue';
import EsaActionTable, { type EsaTableColumn } from './EsaActionTable.vue';
import type { EsaFieldDef } from './EsaActionPanel.vue';

const props = defineProps<{ aid: number; zoneId: string }>();
const { t } = useI18n();
const message = useMessage();

const routines = ref<any[]>([]);
const routine = ref<string | null>(null);

const routineOptions = computed(() =>
  routines.value.map((r) => ({
    label: r.Description ? `${r.Name} · ${r.Description}` : String(r.Name || ''),
    value: String(r.Name || ''),
  })),
);

const routineColumns = computed<EsaTableColumn[]>(() => [
  { key: 'Name', label: t('esaZone.erRoutineName'), minWidth: 200, mono: true },
  { key: 'Description', label: t('esaZone.description'), minWidth: 260 },
]);

const routeColumns = computed<EsaTableColumn[]>(() => [
  { key: 'RouteName', label: t('esaZone.ruleName'), minWidth: 170 },
  { key: 'RouteEnable', label: t('esaZone.status'), width: 90 },
  { key: 'Rule', label: 'Rule', minWidth: 300, mono: true },
  { key: 'Bypass', label: 'Bypass', width: 90 },
  { key: 'Sequence', label: 'Sequence', width: 100 },
  { key: 'Fallback', label: 'Fallback', width: 90 },
  { key: 'Timeout', label: 'Timeout(s)', width: 110 },
]);

const onoffOptions = [
  { label: 'on', value: 'on' },
  { label: 'off', value: 'off' },
];

const routeFields = computed<EsaFieldDef[]>(() => [
  { name: 'RouteName', label: t('esaZone.ruleName'), type: 'text', required: true },
  { name: 'RouteEnable', label: t('esaZone.ruleStatus'), type: 'select', default: 'on', options: onoffOptions },
  { name: 'Rule', label: 'Rule', type: 'text', required: true, placeholder: '(http.host eq "example.com")' },
  { name: 'Bypass', label: 'Bypass', type: 'select', default: 'off', options: onoffOptions },
  { name: 'Sequence', label: 'Sequence', type: 'number', default: 0 },
  { name: 'Fallback', label: 'Fallback', type: 'select', default: 'on', options: onoffOptions },
  { name: 'Timeout', label: 'Timeout(s)', type: 'text', default: '30', help: t('esaZone.erTimeoutHelp') },
]);

async function loadRoutines() {
  const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
    action: 'ListUserRoutines',
    zoneId: props.zoneId,
    params: { PageNumber: 1, PageSize: 100 },
  });
  if (res.code !== 0) {
    message.error(res.msg || t('esaZone.loadFailed'));
    return;
  }
  routines.value = Array.isArray(res.data?.Routines) ? res.data.Routines : [];
  if (!routine.value && routines.value.length) routine.value = String(routines.value[0].Name || '');
}

onMounted(loadRoutines);
</script>

<style scoped>
.esa-module__hint {
  margin: 0 0 12px;
  color: var(--app-text-3);
  font-size: 12px;
}
</style>
