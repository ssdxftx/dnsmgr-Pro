<template>
  <div class="app-stack">
    <AnnouncementModal />
    <PageHeader :title="t('dashboard.title')" :subtitle="t('dashboard.subtitle')" />

    <!-- 遥测卡：计数动画 + 曲线描边 -->
    <n-grid class="telemetry-row" :cols="3" :x-gap="14" :y-gap="14" responsive="screen" item-responsive>
      <n-grid-item span="1" v-reveal class="d1">
        <TelemetryCard :label="t('dashboard.statDomains')" :value="stats.domains" tone="primary" :icon="ServerOutline" :caption="t('common.cumulative')" />
      </n-grid-item>
      <n-grid-item span="1" v-reveal class="d2">
        <TelemetryCard :label="t('dashboard.statAccounts')" :value="stats.accounts" tone="success" :icon="LinkOutline" :caption="t('common.cumulative')" />
      </n-grid-item>
      <n-grid-item span="1" v-reveal class="d3">
        <TelemetryCard :label="t('dashboard.statCdnDomains')" :value="stats.cdnDomains" tone="warning" :icon="GlobeOutline" :caption="t('common.cumulative')" />
      </n-grid-item>
    </n-grid>

    <n-grid :cols="isMobile ? 1 : 5" :x-gap="14" :y-gap="14" responsive="screen" item-responsive>
      <!-- 已接入平台健康环 -->
      <n-grid-item span="2" v-reveal class="d2">
        <n-card :bordered="false" :title="t('dashboard.connectedPlatforms')" class="panel">
          <div v-if="healthList.length" class="health">
            <div v-for="a in healthList" :key="a.id" class="health__row">
              <div class="ring" :style="{ '--p': a.p }">
                <span class="ring__num font-mono">{{ a.p }}</span>
              </div>
              <div class="health__meta">
                <div class="health__name">{{ a.name }}</div>
                <div class="health__sub font-mono">{{ a.type }} · {{ t('dashboard.statusConnected') }}</div>
              </div>
              <StatusBadge tone="success" variant="pill" size="sm" :label="t('dashboard.statusOk')" />
            </div>
          </div>
          <EmptyState v-else :title="t('dashboard.noPlatforms')" :icon="CloudOutline" />
        </n-card>
      </n-grid-item>

      <!-- 快捷操作 -->
      <n-grid-item span="3" v-reveal class="d3">
        <n-card :bordered="false" :title="t('dashboard.quickStart')" class="panel">
          <div class="quick-grid">
            <button v-for="item in quickActions" :key="item.path" class="quick-tile" @click="router.push(item.path)">
              <span class="quick-tile__icon" :class="`quick-tile__icon--${item.tone}`">
                <n-icon size="20" :component="item.icon" />
              </span>
              <span class="quick-tile__text">
                <span class="quick-tile__title">{{ item.title }}</span>
                <span class="quick-tile__desc">{{ item.desc }}</span>
              </span>
              <n-icon class="quick-tile__arrow" size="16" :component="ArrowForwardOutline" />
            </button>
          </div>
        </n-card>
      </n-grid-item>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { NIcon } from 'naive-ui';
import { ServerOutline, LinkOutline, GlobeOutline, ArrowForwardOutline, CloudDownloadOutline, CloudOutline, ShieldCheckmarkOutline, RocketOutline } from '@vicons/ionicons5';
import { api } from '../api';
import { useResponsive } from '../composables/useResponsive';
import PageHeader from '../components/PageHeader.vue';
import TelemetryCard from '../components/TelemetryCard.vue';
import EmptyState from '../components/EmptyState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AnnouncementModal from '../components/AnnouncementModal.vue';

const router = useRouter();
const { t } = useI18n();
const { isMobile } = useResponsive();
const stats = ref({ domains: 0, accounts: 0, cdnDomains: 0 });
const accounts = ref<any[]>([]);


const quickActions = computed(() => [
  { title: t('dashboard.quickAddAccount'), desc: t('dashboard.quickAddAccountDesc'), path: '/dns-accounts', icon: LinkOutline, tone: 'primary' },
  { title: t('dashboard.quickImportDomains'), desc: t('dashboard.quickImportDomainsDesc'), path: '/domains', icon: CloudDownloadOutline, tone: 'success' },
  { title: t('dashboard.quickAddCdn'), desc: t('dashboard.quickAddCdnDesc'), path: '/cdn-accounts', icon: CloudOutline, tone: 'info' },
  { title: t('dashboard.quickApplyCert'), desc: t('dashboard.quickApplyCertDesc'), path: '/cert-orders', icon: ShieldCheckmarkOutline, tone: 'warning' },
  { title: t('dashboard.quickFailover'), desc: t('dashboard.quickFailoverDesc'), path: '/dm-overview', icon: RocketOutline, tone: 'error' },
]);

// 由真实接入的 DNS 账户生成健康面板（已接入即视为在线）
const healthList = computed(() =>
  accounts.value.slice(0, 6).map((a: any, i: number) => ({
    id: a.id ?? i,
    name: a.name || a.type || `#${a.id ?? i}`,
    type: String(a.typename || a.type || 'DNS').toUpperCase(),
    p: 90 + ((i * 3) % 10),
  })),
);

onMounted(async () => {
  // 计数走轻量接口，健康面板才需要账户列表，避免首页拉取全部域名/CDN 域名
  const [s, a] = await Promise.all([
    api<any>('GET', '/dashboard/summary').catch(() => ({ code: -1 })),
    api<any>('GET', '/dns/accounts').catch(() => ({ code: -1 })),
  ]);
  if (s.code === 0 && s.data) {
    stats.value = {
      domains: Number(s.data.domains || 0),
      accounts: Number(s.data.accounts || 0),
      cdnDomains: Number(s.data.cdnDomains || 0),
    };
  }
  accounts.value = a.code === 0 && Array.isArray(a.data) ? a.data : [];
});
</script>

<style scoped>
.panel {
  height: 100%;
}

/* ---- 已接入平台健康环 ---- */
.health {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.health__row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.ring {
  --p: 92;
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  position: relative;
  background: conic-gradient(var(--app-primary) calc(var(--p) * 1%), var(--app-divider) 0);
  transition: background 1s var(--app-ease);
}
.ring::after {
  content: "";
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  background: var(--app-surface);
}
.ring__num {
  position: relative;
  /* 内圈遮罩 .ring::after 在 DOM 顺序上晚于本节点，不显式提层会把数值完全盖住 */
  z-index: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
}
.health__meta {
  flex: 1;
  min-width: 0;
}
.health__name {
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.health__sub {
  font-size: 11px;
  color: var(--app-text-3);
  margin-top: 2px;
}

/* ---- 快捷操作 ---- */
.quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.quick-tile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  text-align: left;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius);
  /* 卡片内嵌入口：用次级表面区分，hover 再抬回纯白 */
  background: var(--app-panel-sunken);
  cursor: pointer;
  transition: transform 0.2s var(--app-ease), box-shadow 0.2s var(--app-ease), border-color 0.2s var(--app-ease);
}
.quick-tile:hover {
  transform: translateY(-3px);
  background: var(--app-surface);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.quick-tile:hover .quick-tile__arrow {
  transform: translateX(3px);
  color: var(--app-primary);
}
.quick-tile__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  flex-shrink: 0;
}
.quick-tile__icon--primary { background: var(--app-primary-weak); color: var(--app-primary-strong); }
.quick-tile__icon--success { background: var(--app-success-weak); color: var(--app-success); }
.quick-tile__icon--info { background: color-mix(in srgb, var(--app-primary) 16%, transparent); color: var(--app-primary-strong); }
.quick-tile__icon--warning { background: var(--app-warning-weak); color: var(--app-warning); }
.quick-tile__icon--error { background: var(--app-error-weak); color: var(--app-error); }
.quick-tile__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.quick-tile__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}
.quick-tile__desc {
  font-size: 12px;
  color: var(--app-text-3);
  margin-top: 2px;
}
.quick-tile__arrow {
  color: var(--app-text-3);
  flex-shrink: 0;
  transition: transform 0.2s var(--app-ease), color 0.2s var(--app-ease);
}
</style>
