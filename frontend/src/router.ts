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
      { path: 'cache-refresh', component: () => import('./views/CachePurge.vue'), meta: { titleKey: 'route.cacheRefresh' } },
      { path: 'preheat-tasks', component: () => import('./views/PreheatTask.vue'), meta: { titleKey: 'route.preheatTasks' } },
      { path: 'dns-check', component: () => import('./views/DnsCheckTask.vue'), meta: { titleKey: 'route.dnsCheck' } },
      { path: 'cdn-zones', component: () => import('./views/CdnZone.vue'), meta: { titleKey: 'route.cdnZones' } },
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
  next();
});

export default router;