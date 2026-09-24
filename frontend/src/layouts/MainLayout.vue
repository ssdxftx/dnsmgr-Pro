<template>
  <div class="app-shell">
    <!-- 桌面端侧边栏 -->
    <aside v-if="!isMobile" class="app-sidebar" :class="{ 'is-collapsed': collapsed }">
      <div class="app-sidebar__brand" @click="router.push('/dashboard')">
        <div class="brand-mark">
          <n-icon size="20" :component="GlobeOutline" />
        </div>
        <span v-if="!collapsed" class="brand-name">聚合 DNS</span>
      </div>

      <div class="app-sidebar__nav">
        <n-menu
          :value="activeKey"
          :collapsed="collapsed"
          :collapsed-width="72"
          :collapsed-icon-size="20"
          :options="visibleMenu"
          :expanded-keys="expandedKeys"
          :indent="18"
          accordion
          @update:value="onMenu"
          @update:expanded-keys="expandedKeys = $event"
        />
      </div>

      <div class="app-sidebar__foot">
        <n-tooltip :disabled="!collapsed" placement="right">
          <template #trigger>
            <button class="foot-btn" @click="toggleTheme">
              <n-icon size="18" :component="isDark ? SunnyOutline : MoonOutline" />
              <span v-if="!collapsed">{{ isDark ? '浅色模式' : '深色模式' }}</span>
            </button>
          </template>
          {{ isDark ? '浅色模式' : '深色模式' }}
        </n-tooltip>
        <button class="foot-btn" @click="collapsed = !collapsed">
          <n-icon size="18" :component="collapsed ? ChevronForwardOutline : ChevronBackOutline" />
          <span v-if="!collapsed">收起菜单</span>
        </button>
        <div v-if="!collapsed" class="foot-version">v{{ version }}</div>
      </div>
    </aside>

    <!-- 移动端抽屉导航 -->
    <n-drawer v-model:show="drawerShow" placement="left" :width="264" class="app-drawer">
      <n-drawer-content :native-scrollbar="false" body-content-style="padding:0">
        <div class="drawer-brand">
          <div class="brand-mark">
            <n-icon size="20" :component="GlobeOutline" />
          </div>
          <span class="brand-name">聚合 DNS</span>
        </div>
        <n-menu
          :value="activeKey"
          :options="visibleMenu"
          :expanded-keys="expandedKeys"
          accordion
          :indent="18"
          @update:value="onMenu"
          @update:expanded-keys="expandedKeys = $event"
        />
        <div class="drawer-foot">
          <button class="foot-btn" @click="toggleTheme">
            <n-icon size="18" :component="isDark ? SunnyOutline : MoonOutline" />
            <span>{{ isDark ? '浅色模式' : '深色模式' }}</span>
          </button>
        </div>
      </n-drawer-content>
    </n-drawer>

    <!-- 主区域 -->
    <div class="app-main">
      <header class="app-header">
        <div class="app-header__left">
          <n-button v-if="isMobile" quaternary circle @click="drawerShow = true">
            <template #icon><n-icon :component="MenuOutline" /></template>
          </n-button>
          <div class="app-header__titles">
            <div class="app-header__title">{{ pageTitle }}</div>
            <div v-if="!isMobile" class="app-header__crumb">聚合 DNS · {{ groupLabel }}</div>
          </div>
        </div>
        <div class="app-header__right">
          <n-button v-if="!isMobile" quaternary circle @click="toggleTheme">
            <template #icon><n-icon :component="isDark ? SunnyOutline : MoonOutline" /></template>
          </n-button>
          <n-dropdown :options="userOptions" trigger="click" @select="onUserSelect">
            <button class="user-chip">
              <n-avatar round :size="30" class="user-chip__avatar">{{ avatarText }}</n-avatar>
              <span v-if="!isMobile" class="user-chip__name">{{ user?.username || '用户' }}</span>
              <n-icon v-if="!isMobile" size="14" :component="ChevronDownOutline" />
            </button>
          </n-dropdown>
        </div>
      </header>

      <main class="app-content" :native-scrollbar="true">
        <div class="app-page">
          <router-view v-slot="{ Component }">
            <transition name="fade-slide" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NAvatar, NButton, NDrawer, NDrawerContent, NDropdown, NIcon, NMenu, NTooltip, type MenuOption } from 'naive-ui';
import { GlobeOutline, MenuOutline, ServerOutline, CloudOutline, SpeedometerOutline, LinkOutline, ShieldCheckmarkOutline, RocketOutline, PulseOutline, SwapHorizontalOutline, FlashOutline, TimeOutline, SettingsOutline, PeopleOutline, DocumentTextOutline, BarChartOutline, RefreshOutline, FolderOutline, InformationCircleOutline, MoonOutline, SunnyOutline, ChevronBackOutline, ChevronForwardOutline, ChevronDownOutline } from '@vicons/ionicons5';
import { useAuthStore } from '../stores/auth';
import { clearToken } from '../api';
import { isAdminUser, requiresAdmin } from '../lib/admin';
import { useResponsive } from '../composables/useResponsive';
import { useThemeMode } from '../composables/useThemeMode';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const user = computed(() => auth.user);
const { isMobile } = useResponsive();
const { isDark, toggle: toggleTheme } = useThemeMode();

const version = __APP_VERSION__;
const collapsed = ref(false);
const drawerShow = ref(false);

const avatarText = computed(() => String(user.value?.username || 'U').slice(0, 1).toUpperCase());

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
  const matched = [
    'dashboard', 'domains', 'dns-accounts', 'expire-notice', 'dns-check',
    'cdn-accounts', 'cdn-domains', 'cdn-zones', 'cache-refresh', 'preheat-tasks', 'statistics',
    'dm-overview', 'dm-tasks', 'schedule-tasks',
    'optimize-settings', 'optimize-tasks',
    'cert-accounts', 'cert-orders', 'deploy-accounts', 'deploy-tasks', 'cert-settings',
    'system-settings', 'users', 'logs', 'about',
  ].find((k) => route.path.startsWith('/' + k));
  return matched || 'dashboard';
});

const pageTitle = computed(() => (route.meta.title as string) || '聚合 DNS');

const activeGroupMap: Record<string, string> = {
  domains: 'group-domain', 'dns-accounts': 'group-domain', 'expire-notice': 'group-domain', 'dns-check': 'group-domain',
  'cdn-accounts': 'group-cdn', 'cdn-domains': 'group-cdn', 'cdn-zones': 'group-cdn', 'cache-refresh': 'group-cdn', 'preheat-tasks': 'group-cdn', statistics: 'group-cdn',
  'dm-overview': 'group-dm', 'dm-tasks': 'group-dm', 'schedule-tasks': 'group-dm',
  'optimize-settings': 'group-optimize', 'optimize-tasks': 'group-optimize',
  'cert-accounts': 'group-cert', 'cert-orders': 'group-cert', 'deploy-accounts': 'group-cert', 'deploy-tasks': 'group-cert', 'cert-settings': 'group-cert',
  'system-settings': 'group-system', users: 'group-system', logs: 'group-system', about: 'group-system',
};

const groupLabels: Record<string, string> = {
  dashboard: '仪表盘',
  'group-domain': '域名管理',
  'group-cdn': 'CDN 管理',
  'group-dm': '容灾切换',
  'group-optimize': 'CF 优选IP',
  'group-cert': 'SSL 证书',
  'group-system': '系统设置',
};

const groupLabel = computed(() => groupLabels[activeGroupMap[activeKey.value] || 'dashboard'] || '控制台');

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
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100dvh;
  overflow: hidden;
  background: var(--app-bg);
}

/* ---------- 侧边栏 ---------- */
.app-sidebar {
  display: flex;
  flex-direction: column;
  width: var(--app-sidebar-w);
  flex-shrink: 0;
  background: var(--app-surface);
  border-right: 1px solid var(--app-divider);
  transition: width 0.22s var(--app-ease);
}
.app-sidebar.is-collapsed {
  width: 72px;
}
.app-sidebar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--app-header-h);
  padding: 0 16px;
  cursor: pointer;
  flex-shrink: 0;
}
.app-sidebar.is-collapsed .app-sidebar__brand {
  justify-content: center;
  padding: 0;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: #fff;
  flex-shrink: 0;
  background: linear-gradient(135deg, #4b7bf5, #2c59d0);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--app-primary) 35%, transparent);
}
.brand-name {
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
  color: var(--app-text);
}
.app-sidebar__nav {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 10px;
}
.app-sidebar.is-collapsed .app-sidebar__nav {
  padding: 6px;
}
.app-sidebar__foot {
  flex-shrink: 0;
  padding: 10px;
  border-top: 1px solid var(--app-divider);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.foot-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--app-text-2);
  font-size: 13.5px;
  cursor: pointer;
  transition: background 0.18s var(--app-ease), color 0.18s var(--app-ease);
}
.foot-btn:hover {
  background: var(--app-bg-soft);
  color: var(--app-text);
}
.app-sidebar.is-collapsed .foot-btn {
  justify-content: center;
  padding: 0;
}
.foot-version {
  padding: 4px 12px 0;
  font-size: 12px;
  color: var(--app-text-3);
}

/* ---------- 主区域 ---------- */
.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: var(--app-header-h);
  padding: 0 20px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--app-surface) 88%, transparent);
  backdrop-filter: saturate(1.2) blur(8px);
  border-bottom: 1px solid var(--app-divider);
}
.app-header__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.app-header__titles {
  min-width: 0;
}
.app-header__title {
  font-size: 17px;
  font-weight: 650;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-header__crumb {
  font-size: 12px;
  color: var(--app-text-3);
  margin-top: 1px;
}
.app-header__right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 4px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--app-text-2);
  cursor: pointer;
  transition: background 0.18s var(--app-ease);
}
.user-chip:hover {
  background: var(--app-bg-soft);
}
.user-chip__avatar {
  background: linear-gradient(135deg, #4b7bf5, #2c59d0);
  color: #fff;
  font-weight: 600;
}
.user-chip__name {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--app-text);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}

/* ---------- 抽屉 ---------- */
.app-drawer .drawer-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
}
.drawer-foot {
  padding: 10px;
  border-top: 1px solid var(--app-divider);
  margin-top: 8px;
}

@media (max-width: 767px) {
  .app-header {
    padding: 0 12px;
  }
  .app-content {
    padding: 12px;
  }
}
</style>