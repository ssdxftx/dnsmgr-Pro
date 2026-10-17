<template>
  <div class="app-stack">
    <PageHeader :title="t('cdnZone.title')" :subtitle="t('cdnZone.subtitle')" back="/cdn-domains">
      <template #actions>
        <n-button size="small" :loading="loadBusy" @click="loadAll">{{ t('cdnZoneSetting.refresh') }}</n-button>
      </template>
    </PageHeader>

    <n-spin :show="loadBusy && !zoneList.length">
      <div v-if="zoneList.length" class="zone-grid">
        <div v-for="row in zoneList" :key="row.key" class="zone-tile" @click="openSetting(row)">
          <div class="zone-tile__head">
            <span class="zone-tile__name">{{ row.zone_name || row.name || '-' }}</span>
            <n-tag size="small" :type="statusTagType(row)">{{ statusLabel(row) }}</n-tag>
          </div>
          <div class="zone-tile__sub">
            <span class="zone-tile__id">{{ row.zone_id }}</span>
            <n-tag size="tiny" :type="row.cloud ? 'info' : 'default'">
              {{ row.cloud ? t('cdnZone.cloudBadge') : t('cdnZone.localBadge') }}
            </n-tag>
          </div>
          <div class="zone-tile__meta">
            <n-tag size="tiny" :bordered="false" class="zone-tile__vendor">{{ row.typename || row.type || '-' }}</n-tag>
            <span class="zone-tile__account">{{ row.accountName || '-' }}</span>
          </div>
          <div class="zone-tile__foot">
            <span class="zone-tile__domains">{{ t('cdnZone.colDomains') }} · {{ row.domain_count ?? 0 }}</span>
            <n-button size="tiny" type="primary" @click.stop="openSetting(row)">{{ t('cdnZone.goSetting') }}</n-button>
          </div>
        </div>
      </div>
      <n-card v-else-if="!loadBusy" :bordered="false">
        <EmptyState :icon="FolderOpenOutline" :title="t('cdnZone.empty')" />
      </n-card>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NCard, NSpin, NTag, useMessage } from 'naive-ui';
import { FolderOpenOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

const { t } = useI18n();
const message = useMessage();
const route = useRoute();
const router = useRouter();

const loadBusy = ref(false);
const zoneList = ref<any[]>([]);
const accounts = ref<any[]>([]);

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

function openSetting(row: any) {
  router.push(`/cdn-zones/${row.aid}/${encodeURIComponent(String(row.zone_id))}`);
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cdn/accounts');
  accounts.value = res.code === 0 ? res.data || [] : [];
}

async function loadAll() {
  loadBusy.value = true;
  zoneList.value = [];
  try {
    if (!accounts.value.length) await loadAccounts();
    const qAid = Number(route.query.aid || 0);
    const targets = qAid
      ? accounts.value.filter((a: any) => a.id === qAid)
      : accounts.value;
    if (!targets.length) {
      // 无可用账户时回退到本地聚合接口
      const res = await api<any>('GET', '/cdn/zones');
      if (res.code === 0) {
        zoneList.value = (res.data || []).map((z: any) => ({ ...z, key: `${z.aid}:${z.zone_id}` }));
      } else {
        message.error(res.msg);
      }
      return;
    }
    // 全账户并行拉取云端站点（含尚未接入域名的站点）
    const results = await Promise.all(
      targets.map(async (a: any) => {
        const res = await api<any>('GET', '/cdn/zones', { aid: a.id });
        if (res.code !== 0) return [];
        return (res.data || []).map((z: any) => ({
          ...z,
          typename: z.typename || a.typename || a.type,
          accountName: a.name,
          key: `${z.aid ?? a.id}:${z.zone_id}`,
        }));
      }),
    );
    zoneList.value = results.flat();
  } finally {
    loadBusy.value = false;
  }
}

onMounted(loadAll);
</script>

<style scoped>
.zone-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.zone-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface-2);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
}
.zone-tile::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--app-primary), transparent 70%);
  opacity: 0;
  transition: opacity 0.18s ease;
}
.zone-tile:hover {
  border-color: color-mix(in srgb, var(--app-primary) 45%, var(--app-border));
  transform: translateY(-2px);
  box-shadow: var(--app-shadow, 0 8px 24px rgba(0, 0, 0, 0.08));
}
.zone-tile:hover::before {
  opacity: 1;
}

.zone-tile__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.zone-tile__name {
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-tile__sub {
  display: flex;
  align-items: center;
  gap: 6px;
}
.zone-tile__id {
  font-family: var(--app-font-mono);
  font-size: 12px;
  color: var(--app-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-tile__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zone-tile__account {
  font-size: 12px;
  color: var(--app-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-tile__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid var(--app-divider);
}
.zone-tile__domains {
  font-family: var(--app-font-mono);
  font-size: 12px;
  color: var(--app-text-3);
}
</style>
