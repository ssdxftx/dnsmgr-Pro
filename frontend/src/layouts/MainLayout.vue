<template>
  <n-layout has-sider position="absolute">
    <!-- 桌面端侧边栏 -->
    <n-layout-sider
      v-if="!isMobile"
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      :width="220"
      :collapsed="collapsed"
      show-trigger
      @collapse="collapsed = true"
      @expand="collapsed = false"
    >
      <div class="logo" @click="$router.push('/dashboard')">
        <n-icon size="22" :component="GlobeOutline" color="#3b6df0" />
        <span v-if="!collapsed" class="logo-text">聚合 DNS</span>
      </div>
      <n-menu
        :value="activeKey"
        :collapsed="collapsed"
        :collapsed-width="64"
        :options="visibleMenu"
        :expanded-keys="expandedKeys"
        accordion
        @update:value="onMenu"
        @update:expanded-keys="expandedKeys = $event"
      />
    </n-layout-sider>

    <!-- 移动端抽屉 -->
    <n-drawer v-if="isMobile" v-model:show="drawerShow" placement="left" :width="220">
      <n-drawer-content :native-scrollbar="false" body-content-style="padding:0">
        <div class="logo">
          <n-icon size="22" :component="GlobeOutline" color="#3b6df0" />
          <span class="logo-text">聚合 DNS</span>
        </div>
        <n-menu
          :value="activeKey"
          :options="visibleMenu"
          :expanded-keys="expandedKeys"
          accordion
          @update:value="onMenu"
          @update:expanded-keys="expandedKeys = $event"
        />
      </n-drawer-content>
    </n-drawer>

    <n-layout class="main-layout">
      <n-layout-header bordered class="header">
        <div class="header-left">
          <n-button v-if="isMobile" quaternary circle @click="drawerShow = true">
            <template #icon><n-icon :component="MenuOutline" /></template>
          </n-button>
          <span class="page-title">{{ pageTitle }}</span>
        </div>
        <div class="header-right">
          <n-dropdown :options="userOptions" @select="onUserSelect">
            <n-button quaternary>
              <template #icon><n-icon :component="PersonOutline" /></template>
              {{ user?.username || '用户' }}
            </n-button>
          </n-dropdown>
        </div>
      </n-layout-header>
      <n-layout-content class="content" :native-scrollbar="false">
        <router-view />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NIcon, type MenuOption } from 'naive-ui';
import { GlobeOutline, MenuOutline, PersonOutline, ServerOutline, CloudOutline, SpeedometerOutline, LinkOutline, ShieldCheckmarkOutline, RocketOutline, PulseOutline, SwapHorizontalOutline, FlashOutline, TimeOutline, SettingsOutline, PeopleOutline, DocumentTextOutline, BarChartOutline, RefreshOutline, FolderOutline, InformationCircleOutline } from '@vicons/ionicons5';
import { useAuthStore } from '../stores/auth';
import { clearToken } from '../api';
import { isAdminUser, requiresAdmin } from '../lib/admin';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const user = computed(() => auth.user);

const collapsed = ref(false);
const isMobile = ref(false);
const drawerShow = ref(false);

function renderIcon(icon: Component) {
  return () => h(NIcon, null, { default: () => h(icon) });
}

const menuOptions: MenuOption[] = [
  { label: '仪表盘', key: 'dashboard', icon: renderIcon(SpeedometerOutline) },
  {
    label: '域名管理',
    key: 'group-domain',
    icon: renderIcon(ServerOutline),
    children: [
      { label: '域名列表', key: 'domains', icon: renderIcon(ServerOutline) },
      { label: 'DNS 账户', key: 'dns-accounts', icon: renderIcon(LinkOutline) },
      { label: '到期提醒', key: 'expire-notice', icon: renderIcon(TimeOutline) },
      { label: '劫持检测', key: 'dns-check', icon: renderIcon(ShieldCheckmarkOutline) },
    ],
  },
  {
    label: 'CDN 管理',
    key: 'group-cdn',
    icon: renderIcon(CloudOutline),
    children: [
      { label: 'CDN 账户', key: 'cdn-accounts', icon: renderIcon(CloudOutline) },
      { label: 'CDN 域名', key: 'cdn-domains', icon: renderIcon(GlobeOutline) },
      { label: 'CDN 站点设置', key: 'cdn-zones', icon: renderIcon(FolderOutline) },
      { label: '缓存刷新', key: 'cache-refresh', icon: renderIcon(RefreshOutline) },
      { label: '自动预热', key: 'preheat-tasks', icon: renderIcon(TimeOutline) },
      { label: '数据统计', key: 'statistics', icon: renderIcon(BarChartOutline) },
    ],
  },
  {
    label: '容灾切换',
    key: 'group-dm',
    icon: renderIcon(PulseOutline),
    children: [
      { label: '运行概览', key: 'dm-overview', icon: renderIcon(PulseOutline) },
      { label: '切换策略', key: 'dm-tasks', icon: renderIcon(SwapHorizontalOutline) },
      { label: '定时切换', key: 'schedule-tasks', icon: renderIcon(TimeOutline) },
    ],
  },
  {
    label: 'CF 优选IP',
    key: 'group-optimize',
    icon: renderIcon(FlashOutline),
    children: [
      { label: '优选设置', key: 'optimize-settings', icon: renderIcon(SettingsOutline) },
      { label: '任务管理', key: 'optimize-tasks', icon: renderIcon(FlashOutline) },
    ],
  },
  {
    label: 'SSL 证书',
    key: 'group-cert',
    icon: renderIcon(ShieldCheckmarkOutline),
    children: [
      { label: 'SSL 证书账户', key: 'cert-accounts', icon: renderIcon(ShieldCheckmarkOutline) },
      { label: 'SSL 证书订单', key: 'cert-orders', icon: renderIcon(ShieldCheckmarkOutline) },
      { label: '自动部署账户', key: 'deploy-accounts', icon: renderIcon(RocketOutline) },
      { label: '自动部署任务', key: 'deploy-tasks', icon: renderIcon(RocketOutline) },
      { label: '自动续签设置', key: 'cert-settings', icon: renderIcon(TimeOutline) },
    ],
  },
  {
    label: '系统设置',
    key: 'group-system',
    icon: renderIcon(SettingsOutline),
    children: [
      { label: '系统设置', key: 'system-settings', icon: renderIcon(SettingsOutline) },
      { label: '用户管理', key: 'users', icon: renderIcon(PeopleOutline) },
      { label: '操作日志', key: 'logs', icon: renderIcon(DocumentTextOutline) },
      { label: '关于', key: 'about', icon: renderIcon(InformationCircleOutline) },
    ],
  },
];

// 非管理员隐藏管理类菜单（服务端已强制鉴权，这里只收敛入口）
const visibleMenu = computed<MenuOption[]>(() => {
  const admin = isAdminUser(user.value);
  const walk = (opts: MenuOption[]): MenuOption[] => {
    const out: MenuOption[] = [];
    for (const o of opts) {
      const children = (o as any).children as MenuOption[] | undefined;
      if (children && children.length) {
        const kept = walk(children);
        if (kept.length) out.push({ ...o, children: kept } as MenuOption);
      } else if (admin || !requiresAdmin('/' + String(o.key))) {
        out.push(o);
      }
    }
    return out;
  };
  return walk(menuOptions);
});

const activeKey = computed(() => {
  if (route.path.startsWith('/dashboard')) return 'dashboard';
  if (route.path.startsWith('/domains')) return 'domains';
  if (route.path.startsWith('/dns-accounts')) return 'dns-accounts';
  if (route.path.startsWith('/expire-notice')) return 'expire-notice';
  if (route.path.startsWith('/dns-check')) return 'dns-check';
  if (route.path.startsWith('/cdn-accounts')) return 'cdn-accounts';
  if (route.path.startsWith('/cdn-domains')) return 'cdn-domains';
  if (route.path.startsWith('/cdn-zones')) return 'cdn-zones';
  if (route.path.startsWith('/cache-refresh')) return 'cache-refresh';
  if (route.path.startsWith('/preheat-tasks')) return 'preheat-tasks';
  if (route.path.startsWith('/statistics')) return 'statistics';
  if (route.path.startsWith('/dm-overview')) return 'dm-overview';
  if (route.path.startsWith('/dm-tasks')) return 'dm-tasks';
  if (route.path.startsWith('/schedule-tasks')) return 'schedule-tasks';
  if (route.path.startsWith('/optimize-settings')) return 'optimize-settings';
  if (route.path.startsWith('/optimize-tasks')) return 'optimize-tasks';
  if (route.path.startsWith('/cert-accounts')) return 'cert-accounts';
  if (route.path.startsWith('/cert-orders')) return 'cert-orders';
  if (route.path.startsWith('/deploy-accounts')) return 'deploy-accounts';
  if (route.path.startsWith('/deploy-tasks')) return 'deploy-tasks';
  if (route.path.startsWith('/cert-settings')) return 'cert-settings';
  if (route.path.startsWith('/system-settings')) return 'system-settings';
  if (route.path.startsWith('/users')) return 'users';
  if (route.path.startsWith('/logs')) return 'logs';
  if (route.path.startsWith('/about')) return 'about';
  return 'dashboard';
});

const pageTitle = computed(() => (route.meta.title as string) || '聚合 DNS');

const activeGroupMap: Record<string, string> = {
  domains: 'group-domain',
  'dns-accounts': 'group-domain',
  'expire-notice': 'group-domain',
  'dns-check': 'group-domain',
  'cdn-accounts': 'group-cdn',
  'cdn-domains': 'group-cdn',
  'cdn-zones': 'group-cdn',
  'cache-refresh': 'group-cdn',
  'preheat-tasks': 'group-cdn',
  statistics: 'group-cdn',
  'dm-overview': 'group-dm',
  'dm-tasks': 'group-dm',
  'schedule-tasks': 'group-dm',
  'optimize-settings': 'group-optimize',
  'optimize-tasks': 'group-optimize',
  'cert-accounts': 'group-cert',
  'cert-orders': 'group-cert',
  'deploy-accounts': 'group-cert',
  'deploy-tasks': 'group-cert',
  'cert-settings': 'group-cert',
  'system-settings': 'group-system',
  users: 'group-system',
  logs: 'group-system',
  about: 'group-system',
};

const expandedKeys = ref<string[]>([]);

watch(
  activeKey,
  (key) => {
    const group = activeGroupMap[key];
    expandedKeys.value = group ? [group] : [];
  },
  { immediate: true },
);

const userOptions = [
  { label: '安全设置（TOTP）', key: 'totp' },
  { label: '退出登录', key: 'logout' },
];

function onMenu(key: string) {
  drawerShow.value = false;
  router.push('/' + key);
}
function onUserSelect(key: string) {
  if (key === 'totp') {
    router.push('/totp');
  } else if (key === 'logout') {
    clearToken();
    auth.logout();
    router.push('/login');
  }
}

function checkMobile() {
  isMobile.value = window.innerWidth < 768;
}
onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
});
onBeforeUnmount(() => window.removeEventListener('resize', checkMobile));
</script>

<style scoped>
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  cursor: pointer;
  font-weight: 600;
  font-size: 16px;
}
.logo-text {
  white-space: nowrap;
}
.main-layout {
  min-height: 100vh;
}
.header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.page-title {
  font-size: 16px;
  font-weight: 600;
}
.content {
  padding: 16px;
  height: calc(100vh - 56px);
}
</style>