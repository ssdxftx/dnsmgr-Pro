// 前端管理员路由守卫（服务端已强制校验，此处仅收敛管理入口展示）
export const ADMIN_PREFIXES = [
  '/dashboard',
  '/dns-accounts',
  '/expire-notice',
  '/dns-check',
  '/cdn-accounts',
  '/cdn-domains',
  '/cdn-zones',
  '/cache-refresh',
  '/preheat-tasks',
  '/statistics',
  '/dm-',
  '/schedule-',
  '/optimize-',
  '/cert-',
  '/deploy-',
  '/system-settings',
  '/users',
  '/logs',
];

export function requiresAdmin(path: string): boolean {
  return ADMIN_PREFIXES.some((p) => String(path || '').startsWith(p));
}

export function isAdminUser(user: any): boolean {
  return Number(user?.level ?? 0) >= 2;
}