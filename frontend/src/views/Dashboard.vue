<template>
  <div class="app-stack">
    <PageHeader title="仪表盘" subtitle="聚合 DNS 系统运行概览与快捷入口" />

    <n-grid :cols="isMobile ? 1 : 3" :x-gap="14" :y-gap="14" responsive="screen" item-responsive>
      <n-grid-item span="1">
        <StatCard label="域名数量" :value="stats.domains" tone="primary" :icon="ServerOutline" />
      </n-grid-item>
      <n-grid-item span="1">
        <StatCard label="DNS 账户" :value="stats.accounts" tone="success" :icon="LinkOutline" />
      </n-grid-item>
      <n-grid-item span="1">
        <StatCard label="CDN 域名" :value="stats.cdnDomains" tone="warning" :icon="GlobeOutline" />
      </n-grid-item>
    </n-grid>

    <n-card :bordered="false" title="快速开始">
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NIcon } from 'naive-ui';
import { ServerOutline, LinkOutline, GlobeOutline, ArrowForwardOutline, CloudDownloadOutline, CloudOutline, ShieldCheckmarkOutline, RocketOutline } from '@vicons/ionicons5';
import { api } from '../api';
import { useResponsive } from '../composables/useResponsive';
import PageHeader from '../components/PageHeader.vue';
import StatCard from '../components/StatCard.vue';

const router = useRouter();
const { isMobile } = useResponsive();
const stats = ref({ domains: 0, accounts: 0, cdnDomains: 0 });

const quickActions = [
  { title: '添加 DNS 账户', desc: '接入阿里云、腾讯云、Cloudflare 等', path: '/dns-accounts', icon: LinkOutline, tone: 'primary' },
  { title: '导入并管理域名', desc: '从 DNS 账户拉取域名并管理解析', path: '/domains', icon: CloudDownloadOutline, tone: 'success' },
  { title: '添加 CDN 账户', desc: '配置加速域名与缓存规则', path: '/cdn-accounts', icon: CloudOutline, tone: 'info' },
  { title: '申请 SSL 证书', desc: '自动签发并部署到目标服务器', path: '/cert-orders', icon: ShieldCheckmarkOutline, tone: 'warning' },
  { title: '容灾切换监控', desc: '实时探测并自动切换解析线路', path: '/dm-overview', icon: RocketOutline, tone: 'error' },
];

onMounted(async () => {
  const [d, a, c] = await Promise.all([
    api<any>('GET', '/domains').catch(() => ({ code: -1 })),
    api<any>('GET', '/dns/accounts').catch(() => ({ code: -1 })),
    api<any>('GET', '/cdn/domains').catch(() => ({ code: -1 })),
  ]);
  stats.value = {
    domains: d.code === 0 ? d.data.length : 0,
    accounts: a.code === 0 ? a.data.length : 0,
    cdnDomains: c.code === 0 ? c.data.length : 0,
  };
});
</script>

<style scoped>
.quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.quick-tile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  text-align: left;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  cursor: pointer;
  transition: transform 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease), border-color 0.18s var(--app-ease);
}
.quick-tile:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--app-primary) 35%, var(--app-divider));
  box-shadow: var(--app-shadow);
}
.quick-tile__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  flex-shrink: 0;
}
.quick-tile__icon--primary {
  background: var(--app-primary-weak);
  color: var(--app-primary-strong);
}
.quick-tile__icon--success {
  background: var(--app-success-weak);
  color: var(--app-success);
}
.quick-tile__icon--info {
  background: color-mix(in srgb, #38a3f5 16%, transparent);
  color: #1d6fd0;
}
.quick-tile__icon--warning {
  background: var(--app-warning-weak);
  color: var(--app-warning);
}
.quick-tile__icon--error {
  background: var(--app-error-weak);
  color: var(--app-error);
}
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
}
</style>