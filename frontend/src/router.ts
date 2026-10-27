import { createRouter, createWebHistory } from 'vue-router';
import { getToken, getUser } from './api';
import { isAdminUser, requiresAdmin } from './lib/admin';

const routes = [
  { path: '/setup', component: () => import('./views/Setup.vue'), meta: { public: true } },
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/register', component: () => import('./views/Register.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('./layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/domains' },
      { path: 'dashboard', component: () => import('./views/Dashboard.vue'), meta: { titleKey: 'route.dashboard' } },
      { path: 'my-accounts', redirect: '/backup?tab=vault' },
      { path: 'my-backup', redirect: '/backup?tab=mine' },
      { path: 'backup', component: () => import('./views/Backup.vue'), meta: { titleKey: 'route.backup' } },
      { path: 'domains', component: () => import('./views/DomainList.vue'), meta: { titleKey: 'route.domains' } },
      { path: 'domains/:id/records', component: () => import('./views/RecordList.vue'), meta: { titleKey: 'route.records' } },
      { path: 'domains/:id/records/import', component: () => import('./views/RecordImport.vue'), meta: { titleKey: 'route.recordImport' } },
      { path: 'domains/:id/weight', component: () => import('./views/RecordWeight.vue'), meta: { titleKey: 'route.recordWeight' } },
      { path: 'domains/:id/alias', component: () => import('./views/RecordAlias.vue'), meta: { titleKey: 'route.recordAlias' } },
      { path: 'domains/:id/recordlog', component: () => import('./views/RecordLog.vue'), meta: { titleKey: 'route.recordLog' } },
      { path: 'dns-accounts', component: () => import('./views/DnsAccount.vue'), meta: { titleKey: 'route.dnsAccounts' } },
      { path: 'cdn-accounts', component: () => import('./views/CdnAccount.vue'), meta: { titleKey: 'route.cdnAccounts' } },
      { path: 'cdn-domains', component: () => import('./views/CdnDomain.vue'), meta: { titleKey: 'route.cdnDomains' } },
      { path: 'statistics', component: () => import('./views/Statistics.vue'), meta: { titleKey: 'route.statistics' } },
      { path: 'statistics/:route', component: () => import('./views/StatisticsDetail.vue'), meta: { titleKey: 'route.statistics' } },
      { path: 'cache-refresh', component: () => import('./views/CachePurge.vue'), meta: { titleKey: 'route.cacheRefresh' } },
      { path: 'preheat-tasks', component: () => import('./views/PreheatTask.vue'), meta: { titleKey: 'route.preheatTasks' } },
      { path: 'dns-check', component: () => import('./views/DnsCheckTask.vue'), meta: { titleKey: 'route.dnsCheck' } },
      { path: 'cdn-zones', component: () => import('./views/CdnZone.vue'), meta: { titleKey: 'route.cdnZones' } },
      { path: 'cdn-accounts/:aid/esa-api', component: () => import('./views/CdnEsaApi.vue'), meta: { titleKey: 'route.cdnEsaApi' } },
      { path: 'cdn-accounts/:aid/esa-console', component: () => import('./views/CdnEsaConsole.vue'), meta: { titleKey: 'route.cdnEsaConsole' } },
      { path: 'cdn-zones/:aid/:zoneId', component: () => import('./views/CdnZoneSetting.vue'), meta: { titleKey: 'route.cdnZones' } },
      { path: 'cf-rules', component: () => import('./views/CfRules.vue'), meta: { titleKey: 'route.cfRules' } },
      { path: 'cdn-domains/:id/setting', component: () => import('./views/CdnDomainSetting.vue'), meta: { titleKey: 'route.cdnSetting' } },
      { path: 'cloudflare/domains/:id/hostnames', component: () => import('./views/CfHostnames.vue'), meta: { titleKey: 'route.cfHostnames' } },
      { path: 'cloudflare/accounts/:id/tunnels', component: () => import('./views/CfTunnels.vue'), meta: { titleKey: 'route.cfTunnels' } },
      { path: 'expire-notice', component: () => import('./views/ExpireNotice.vue'), meta: { titleKey: 'route.expireNotice' } },
      { path: 'totp', component: () => import('./views/TotpSet.vue'), meta: { titleKey: 'route.totp' } },
      { path: 'preferences', component: () => import('./views/Preferences.vue'), meta: { titleKey: 'route.preferences' } },
      { path: 'cert-accounts', component: () => import('./views/CertAccount.vue'), meta: { titleKey: 'route.certAccounts' } },
      { path: 'cert-cname', component: () => import('./views/CertCname.vue'), meta: { titleKey: 'route.certCname' } },
      { path: 'cert-orders', component: () => import('./views/CertOrder.vue'), meta: { titleKey: 'route.certOrders' } },
      { path: 'cert-settings', component: () => import('./views/CertSet.vue'), meta: { titleKey: 'route.certSettings' } },
      { path: 'deploy-accounts', component: () => import('./views/DeployAccount.vue'), meta: { titleKey: 'route.deployAccounts' } },
      { path: 'deploy-tasks', component: () => import('./views/DeployTask.vue'), meta: { titleKey: 'route.deployTasks' } },
      { path: 'dm-overview', component: () => import('./views/DmOverview.vue'), meta: { titleKey: 'route.dmOverview' } },
      { path: 'dm-tasks', component: () => import('./views/DmTask.vue'), meta: { titleKey: 'route.dmTasks' } },
      { path: 'dm-tasks/add', component: () => import('./views/DmTaskForm.vue'), meta: { titleKey: 'route.dmTaskAdd' } },
      { path: 'dm-tasks/:id/edit', component: () => import('./views/DmTaskForm.vue'), meta: { titleKey: 'route.dmTaskEdit' } },
      { path: 'dm-tasks/:id', component: () => import('./views/DmTaskInfo.vue'), meta: { titleKey: 'route.dmTaskInfo' } },
      { path: 'optimize-tasks', component: () => import('./views/OptimizeList.vue'), meta: { titleKey: 'route.optimizeTasks' } },
      { path: 'optimize-tasks/add', component: () => import('./views/OptimizeForm.vue'), meta: { titleKey: 'route.optimizeAdd' } },
      { path: 'optimize-tasks/:id/edit', component: () => import('./views/OptimizeForm.vue'), meta: { titleKey: 'route.optimizeEdit' } },
      { path: 'optimize-settings', component: () => import('./views/OptimizeSet.vue'), meta: { titleKey: 'route.optimizeSettings' } },
      { path: 'schedule-tasks', component: () => import('./views/ScheduleList.vue'), meta: { titleKey: 'route.scheduleTasks' } },
      { path: 'schedule-tasks/add', component: () => import('./views/ScheduleForm.vue'), meta: { titleKey: 'route.scheduleAdd' } },
      { path: 'schedule-tasks/:id/edit', component: () => import('./views/ScheduleForm.vue'), meta: { titleKey: 'route.scheduleEdit' } },
      { path: 'system-settings', component: () => import('./views/SystemSet.vue'), meta: { titleKey: 'route.systemSettings' } },
      { path: 'users', component: () => import('./views/UserList.vue'), meta: { titleKey: 'route.users' } },
      { path: 'logs', component: () => import('./views/UserLog.vue'), meta: { titleKey: 'route.logs' } },
      { path: 'about', component: () => import('./views/About.vue'), meta: { titleKey: 'route.about' } },
      // 兜底：未匹配的路径不再渲染成整页空白，统一进 404 页
      { path: ':pathMatch(.*)*', component: () => import('./views/NotFound.vue'), meta: { titleKey: 'route.notFound' } },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

let setupChecked = false;
let setupInstalled = true;

router.beforeEach(async (to, from, next) => {
  if (to.path === '/setup') return next();
  if (!setupChecked) {
    try {
      const res = await fetch('/api/setup/status');
      const json = await res.json();
      setupInstalled = json?.data?.installed ?? true;
    } catch {
      setupInstalled = true;
    }
    setupChecked = true;
  }
  if (!setupInstalled) return next('/setup');
  if (to.meta.public) return next();
  if (!getToken()) return next('/login');
  // 管理员页面仅管理员可进入（服务端仍会二次校验）
  if (requiresAdmin(to.path) && !isAdminUser(getUser())) {
    const u = getUser();
    if (to.path.startsWith('/statistics') && Number(u?.stat_cache) === 1) return next();
    return next('/domains');
  }
  // CDN 相关路由：aid 必须为正整数；带 zoneId 的路由同时校验 zoneId
  if (to.params.aid !== undefined) {
    const aid = Number(to.params.aid);
    if (!Number.isInteger(aid) || aid <= 0) return next('/cdn-zones');
  }
  if (to.params.zoneId !== undefined && !String(to.params.zoneId).trim()) return next('/cdn-zones');
  // 带参数路由的 id 必须是正整数，避免 Number('abc')=NaN 直接进接口（页面回显 #NaN、报错无意义）
  if (to.params.id !== undefined) {
    const id = Number(to.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      const listMap: [string, string][] = [
        ['/domains/', '/domains'],
        ['/cdn-domains/', '/cdn-domains'],
        ['/cloudflare/domains/', '/cdn-domains'],
        ['/cloudflare/accounts/', '/cdn-accounts'],
        ['/dm-tasks/', '/dm-tasks'],
        ['/optimize-tasks/', '/optimize-tasks'],
        ['/schedule-tasks/', '/schedule-tasks'],
      ];
      const fallback = listMap.find(([p]) => to.path.startsWith(p))?.[1] || '/domains';
      return next(fallback);
    }
  }
  next();
});

export default router;