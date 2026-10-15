<template>
  <div class="app-stack">
    <PageHeader :title="t('cdnZone.title')" :subtitle="t('cdnZone.subtitle')" back="/cdn-domains">
      <template #actions>
        <n-space :size="8" align="center">
          <n-select
            v-model:value="accountId"
            :options="accountOptions"
            :placeholder="t('cdnZone.selectAccount')"
            clearable
            style="width: 260px"
            @update:value="onAccountChange"
          />
          <n-button size="small" :loading="loading" @click="loadZones">{{ t('cdnZoneSetting.refresh') }}</n-button>
        </n-space>
      </template>
    </PageHeader>

    <n-card :bordered="false" :title="t('cdnZone.listTitle')">
      <ResponsiveDataTable
        :columns="columns"
        :data="zoneList"
        :loading="loading"
        :empty-text="t('cdnZone.empty')"
        :row-key="(r: any) => r.key"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NTag, useMessage } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const { t } = useI18n();
const message = useMessage();
const route = useRoute();
const router = useRouter();

const loading = ref(false);
const zoneList = ref<any[]>([]);
const accounts = ref<any[]>([]);
const accountId = ref<number | null>(null);

const accountOptions = computed(() => accounts.value.map((a: any) => ({ label: `${a.typename || a.type} · ${a.name}`, value: a.id })));

function statusLabel(row: any) {
  if (row.paused) return t('cdnSite.statusPaused');
  const map: Record<string, string> = {
    active: t('cdnSite.statusActive'),
    pending: t('cdnSite.statusPending'),
    offline: t('cdnSite.statusOffline'),
    moved: t('cdnSite.statusMoved'),
    deactivated: t('cdnSite.statusDeactivated'),
    initializing: t('cdnSite.statusInitializing'),
  };
  return map[String(row.status || '').toLowerCase()] || row.status || '-';
}

type TagType = 'success' | 'warning' | 'error' | 'info' | 'default';
function statusTagType(row: any): TagType {
  if (row.paused) return 'warning';
  const map: Record<string, TagType> = {
    active: 'success',
    pending: 'info',
    initializing: 'info',
    offline: 'default',
    moved: 'error',
    deactivated: 'error',
  };
  return map[String(row.status || '').toLowerCase()] || 'default';
}

const columns = computed(() => [
  { title: t('cdnZone.colType'), key: 'routename', width: 150 },
  {
    title: t('cdnZone.colSite'),
    key: 'name',
    minWidth: 200,
    render: (row: any) => row.zone_name || row.name || '-',
  },
  {
    title: t('cdnZone.colZoneId'),
    key: 'zone_id',
    minWidth: 180,
    render: (row: any) =>
      h(NSpace, { size: 4, align: 'center' }, {
        default: () => [
          h('span', { style: 'font-family: var(--app-font-mono); font-size: 12px' }, String(row.zone_id || '')),
          h(NTag, { size: 'tiny', type: row.cloud ? 'info' : 'default' }, {
            default: () => (row.cloud ? t('cdnZone.cloudBadge') : t('cdnZone.localBadge')),
          }),
        ],
      }),
  },
  {
    title: t('cdnZone.colStatus'),
    key: 'status',
    width: 120,
    render: (row: any) => h(NTag, { size: 'small', type: statusTagType(row) }, { default: () => statusLabel(row) }),
  },
  { title: t('cdnZone.colDomains'), key: 'domain_count', width: 110 },
  {
    title: t('cdnZone.colActions'),
    key: 'actions',
    width: 140,
    render: (row: any) =>
      h(NButton, { size: 'tiny', type: 'primary', onClick: () => openSetting(row) }, { default: () => t('cdnZone.goSetting') }),
  },
]);

function openSetting(row: any) {
  router.push(`/cdn-zones/${row.aid}/${encodeURIComponent(String(row.zone_id))}`);
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cdn/accounts');
  accounts.value = res.code === 0 ? res.data || [] : [];
}

async function loadZones() {
  loading.value = true;
  // 选定账户时以云端站点为准（含尚未接入域名的站点）；未选定时展示本地已接入站点的聚�?
  const res = await api<any>('GET', '/cdn/zones', accountId.value ? { aid: accountId.value } : undefined);
  loading.value = false;
  if (res.code === 0) {
    zoneList.value = (res.data || []).map((z: any) => ({ ...z, key: `${z.aid}:${z.zone_id}` }));
  } else {
    zoneList.value = [];
    message.error(res.msg);
  }
}

function onAccountChange() {
  loadZones();
}

onMounted(async () => {
  const qAid = Number(route.query.aid || 0);
  if (qAid) accountId.value = qAid;
  await loadAccounts();
  await loadZones();
});
</script>
