export interface RouteMeta {
  module: string;
  action: string;
  targetType?: string;
}

/**
 * 精确映射：key = `${METHOD} ${路由模板}`
 * 只列「命名有歧义」或「高频」的，其余走 fallback（见 resolveRoute）
 */
export const AUDIT_ROUTES: Record<string, RouteMeta> = {
  // 认证
  'POST /api/auth/login': { module: 'auth', action: 'auth.login', targetType: 'user' },
  'POST /api/auth/totp': { module: 'auth', action: 'auth.login', targetType: 'user' },
  'POST /api/auth/lang': { module: 'auth', action: 'auth.lang', targetType: 'user' },
  'POST /api/auth/totp-config': { module: 'auth', action: 'auth.totpConfig', targetType: 'user' },
  'POST /api/auth/reauth': { module: 'auth', action: 'auth.reauth', targetType: 'user' },
  'POST /api/api-keys': { module: 'apikeys', action: 'apikey.create', targetType: 'api_key' },
  'PATCH /api/api-keys/:id': { module: 'apikeys', action: 'apikey.update', targetType: 'api_key' },
  'POST /api/api-keys/:id/rotate': { module: 'apikeys', action: 'apikey.rotate', targetType: 'api_key' },
  'DELETE /api/api-keys/:id': { module: 'apikeys', action: 'apikey.revoke', targetType: 'api_key' },
  'POST /api/api-keys/revoke-all': { module: 'apikeys', action: 'apikey.revokeAll', targetType: 'api_key' },
  'DELETE /api/api-keys/legacy': { module: 'apikeys', action: 'apikey.revoke', targetType: 'api_key' },

  // 解析记录
  'POST /api/domains/:id/records': { module: 'record', action: 'record.create', targetType: 'record' },
  'PUT /api/domains/:id/records/:recordId': { module: 'record', action: 'record.update', targetType: 'record' },
  'DELETE /api/domains/:id/records/:recordId': { module: 'record', action: 'record.delete', targetType: 'record' },
  'POST /api/domains/:id/records/:recordId/status': { module: 'record', action: 'record.status', targetType: 'record' },
  'POST /api/domains/:id/records/:recordId/remark': { module: 'record', action: 'record.remark', targetType: 'record' },
  'POST /api/domains/:id/records/batch': { module: 'record', action: 'record.batch', targetType: 'record' },
  'POST /api/domains/:id/records/batch-add': { module: 'record', action: 'record.batchAdd', targetType: 'record' },
  'POST /api/domains/:id/records/check': { module: 'record', action: 'record.check', targetType: 'record' },

  // 域名
  'POST /api/domains': { module: 'domain', action: 'domain.create', targetType: 'domain' },
  'PUT /api/domains/:id': { module: 'domain', action: 'domain.update', targetType: 'domain' },
  'DELETE /api/domains/:id': { module: 'domain', action: 'domain.delete', targetType: 'domain' },
  'POST /api/domains/batch-del': { module: 'domain', action: 'domain.batchDelete', targetType: 'domain' },
  'POST /api/domains/categories': { module: 'domain', action: 'domain.categoryCreate' },
  'PUT /api/domains/categories/:id': { module: 'domain', action: 'domain.categoryUpdate' },
  'DELETE /api/domains/categories/:id': { module: 'domain', action: 'domain.categoryDelete' },
  'POST /api/domains/:id/aliases': { module: 'domain', action: 'domain.aliasCreate', targetType: 'domain' },
  'PUT /api/domains/:id/aliases/:aliasId': { module: 'domain', action: 'domain.aliasUpdate', targetType: 'domain' },
  'DELETE /api/domains/:id/aliases/:aliasId': { module: 'domain', action: 'domain.aliasDelete', targetType: 'domain' },
  'POST /api/domains/:id/weight': { module: 'domain', action: 'domain.weight', targetType: 'domain' },
  'POST /api/domains/:id/update-date': { module: 'domain', action: 'domain.updateDate', targetType: 'domain' },
  'POST /api/domains/batch-notice': { module: 'expire', action: 'expire.notice.batch', targetType: 'domain' },
  'POST /api/expire/settings': { module: 'expire', action: 'expire.settings.update' },
  'POST /api/expire/scan': { module: 'expire', action: 'expire.scan', targetType: 'job' },

  // 账户
  'POST /api/dns/accounts': { module: 'account', action: 'account.dns.create' },
  'PUT /api/dns/accounts/:id': { module: 'account', action: 'account.dns.update', targetType: 'account' },
  'DELETE /api/dns/accounts/:id': { module: 'account', action: 'account.dns.delete', targetType: 'account' },
  'POST /api/cdn/accounts': { module: 'account', action: 'account.cdn.create' },
  'PUT /api/cdn/accounts/:id': { module: 'account', action: 'account.cdn.update', targetType: 'account' },
  'DELETE /api/cdn/accounts/:id': { module: 'account', action: 'account.cdn.delete', targetType: 'account' },

  // 备份与恢复
  'POST /api/backup/export': { module: 'backup', action: 'backup.export' },
  'POST /api/backup/import': { module: 'backup', action: 'backup.import' },
  'POST /api/backup/restore': { module: 'backup', action: 'backup.restore' },
  'DELETE /api/backup/jobs/:id': { module: 'backup', action: 'backup.delete', targetType: 'backup' },
  'POST /api/backup/key': { module: 'backup', action: 'backup.key.rotate' },
  'POST /api/backup/destinations': { module: 'backup', action: 'backup.destination.create' },
  'PUT /api/backup/destinations/:id': { module: 'backup', action: 'backup.destination.update' },
  'DELETE /api/backup/destinations/:id': { module: 'backup', action: 'backup.destination.delete' },
  'POST /api/backup/destinations/:id/test': { module: 'backup', action: 'backup.destination.test' },
  'POST /api/backup/schedules': { module: 'backup', action: 'backup.schedule.create' },
  'PUT /api/backup/schedules/:id': { module: 'backup', action: 'backup.schedule.update' },
  'DELETE /api/backup/schedules/:id': { module: 'backup', action: 'backup.schedule.delete' },
  'POST /api/backup/schedules/:id/run': { module: 'backup', action: 'backup.schedule.run' },
  'POST /api/backup/remote/:destId/pull': { module: 'backup', action: 'backup.remote.pull' },
  'DELETE /api/backup/remote/:destId': { module: 'backup', action: 'backup.remote.delete' },

  // 个人凭证保险库
  'POST /api/vault/init': { module: 'vault', action: 'vault.init' },
  'POST /api/vault/unlock': { module: 'vault', action: 'vault.unlock' },
  'POST /api/vault/lock': { module: 'vault', action: 'vault.lock' },
  'POST /api/vault/passphrase': { module: 'vault', action: 'vault.passphrase' },
  'POST /api/vault/upgrade': { module: 'vault', action: 'vault.upgrade' },
  'POST /api/vault/downgrade': { module: 'vault', action: 'vault.downgrade' },
  'POST /api/vault/recover': { module: 'vault', action: 'vault.recover' },
  'POST /api/vault/recovery': { module: 'vault', action: 'vault.recovery' },
  'POST /api/vault/destroy': { module: 'vault', action: 'vault.destroy' },
  'POST /api/vault/backup-exclude': { module: 'vault', action: 'vault.backupExclude' },
  'POST /api/vault/auto-unlock': { module: 'vault', action: 'vault.autoUnlock' },

  // 系统
  'POST /api/system/settings': { module: 'system', action: 'system.settings.update' },
  'POST /api/system/stat-cache-clear': { module: 'system', action: 'system.cache.clear' },
  'POST /api/system/stat-cache-refresh': { module: 'system', action: 'system.cache.refresh' },
  'POST /api/system/mailtest': { module: 'system', action: 'system.test.mail' },
  'POST /api/system/tgbottest': { module: 'system', action: 'system.test.telegram' },
  'POST /api/system/qqbottest': { module: 'system', action: 'system.test.qqbot' },
  'POST /api/system/webhooktest': { module: 'system', action: 'system.test.webhook' },
  'POST /api/system/customwebhooktest': { module: 'system', action: 'system.test.customWebhook' },
  'POST /api/system/proxytest': { module: 'system', action: 'system.test.proxy' },
  'POST /api/system/announcements': { module: 'system', action: 'system.announcement.create', targetType: 'announcement' },
  'PUT /api/system/announcements/:id': { module: 'system', action: 'system.announcement.update', targetType: 'announcement' },
  'POST /api/system/announcements/:id/status': { module: 'system', action: 'system.announcement.status', targetType: 'announcement' },
  'DELETE /api/system/announcements/:id': { module: 'system', action: 'system.announcement.delete', targetType: 'announcement' },
  'POST /api/about/check-update': { module: 'system', action: 'system.checkUpdate' },

  // 用户
  'POST /api/users': { module: 'user', action: 'user.create' },
  'PUT /api/users/:id': { module: 'user', action: 'user.update', targetType: 'user' },
  'DELETE /api/users/:id': { module: 'user', action: 'user.delete', targetType: 'user' },
  'POST /api/users/:id/status': { module: 'user', action: 'user.status', targetType: 'user' },
  'POST /api/users/:id/stat-cache': { module: 'user', action: 'user.statCache', targetType: 'user' },

  // CDN 加速域名
  'POST /api/cdn/domains': { module: 'cdn', action: 'cdn.domain.create', targetType: 'cdn_domain' },
  'DELETE /api/cdn/domains/:id': { module: 'cdn', action: 'cdn.domain.delete', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/:id/status': { module: 'cdn', action: 'cdn.domain.status', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/:id/origin': { module: 'cdn', action: 'cdn.domain.origin', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/:id/cache': { module: 'cdn', action: 'cdn.domain.cache', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/:id/https': { module: 'cdn', action: 'cdn.domain.https', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/:id/access': { module: 'cdn', action: 'cdn.domain.access', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/:id/cert_mode': { module: 'cdn', action: 'cdn.domain.certMode', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/:id/zone_setting': { module: 'cdn', action: 'cdn.domain.zoneSetting', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/:id/certlink': { module: 'cdn', action: 'cdn.domain.certLink', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/:id/certlink/run': { module: 'cdn', action: 'cdn.domain.certLinkRun', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/freecert': { module: 'cdn', action: 'cdn.domain.freeCert', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/freecert/check': { module: 'cdn', action: 'cdn.domain.freeCertCheck', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/cert': { module: 'cdn', action: 'cdn.domain.cert', targetType: 'cdn_domain' },
  'POST /api/cdn/domains/cert/check': { module: 'cdn', action: 'cdn.domain.certCheck', targetType: 'cdn_domain' },
  'POST /api/cdn/zones/setting': { module: 'cdn', action: 'cdn.zone.update', targetType: 'cdn_zone' },
  'POST /api/cdn/purge': { module: 'cdn', action: 'cdn.purge', targetType: 'cdn_domain' },
  'POST /api/cdn/cache-tasks/:id/retry': { module: 'cdn', action: 'cdn.cacheTask.retry', targetType: 'cdn_cache_task' },
  'POST /api/cdn/preheat': { module: 'cdn', action: 'cdn.preheat', targetType: 'cdn_domain' },
  'POST /api/cdn/sync': { module: 'cdn', action: 'cdn.sync' },

  // CDN 站点 / 规则（路径末段是动词，必须精确映射）
  'POST /api/cdn/accounts/:aid/sites/check': { module: 'cdn', action: 'cdn.site.check', targetType: 'cdn_zone' },
  'POST /api/cdn/accounts/:aid/sites': { module: 'cdn', action: 'cdn.site.create', targetType: 'cdn_zone' },
  'POST /api/cdn/accounts/:aid/sites/verify': { module: 'cdn', action: 'cdn.site.verify', targetType: 'cdn_zone' },
  'POST /api/cdn/accounts/:aid/sites/pause': { module: 'cdn', action: 'cdn.site.pause', targetType: 'cdn_zone' },
  'PUT /api/cdn/accounts/:aid/sites/:zoneId': { module: 'cdn', action: 'cdn.site.update', targetType: 'cdn_zone' },
  'DELETE /api/cdn/accounts/:aid/sites/:zoneId': { module: 'cdn', action: 'cdn.site.delete', targetType: 'cdn_zone' },
  'POST /api/cdn/accounts/:aid/rules': { module: 'cdn', action: 'cdn.rule.create', targetType: 'cdn_rule' },
  'PUT /api/cdn/accounts/:aid/rules/:ruleId': { module: 'cdn', action: 'cdn.rule.update', targetType: 'cdn_rule' },
  'DELETE /api/cdn/accounts/:aid/rules': { module: 'cdn', action: 'cdn.rule.delete', targetType: 'cdn_rule' },
  'POST /api/cdn/accounts/:aid/rules/priority': { module: 'cdn', action: 'cdn.rule.priority', targetType: 'cdn_rule' },
  'POST /api/cdn/accounts/:aid/rule-configs': { module: 'cdn', action: 'cdn.ruleConfig.create', targetType: 'cdn_rule' },
  'DELETE /api/cdn/accounts/:aid/rule-configs/:configId': {
    module: 'cdn',
    action: 'cdn.ruleConfig.delete',
    targetType: 'cdn_rule',
  },
  'POST /api/cdn/accounts/:aid/origin-groups': { module: 'cdn', action: 'cdn.originGroup.create' },
  'PUT /api/cdn/accounts/:aid/origin-groups/:groupId': { module: 'cdn', action: 'cdn.originGroup.update' },
  'DELETE /api/cdn/accounts/:aid/origin-groups/:groupId': { module: 'cdn', action: 'cdn.originGroup.delete' },
  'POST /api/cdn/accounts/:aid/load-balancers': { module: 'cdn', action: 'cdn.loadBalancer.create' },
  'PUT /api/cdn/accounts/:aid/load-balancers/:instanceId': { module: 'cdn', action: 'cdn.loadBalancer.update' },
  'DELETE /api/cdn/accounts/:aid/load-balancers/:instanceId': { module: 'cdn', action: 'cdn.loadBalancer.delete' },
  'POST /api/cdn/accounts/:aid/security/ip-groups': { module: 'cdn', action: 'cdn.ipGroup.create' },
  'PUT /api/cdn/accounts/:aid/security/ip-groups/:groupId': { module: 'cdn', action: 'cdn.ipGroup.update' },
  'DELETE /api/cdn/accounts/:aid/security/ip-groups/:groupId': { module: 'cdn', action: 'cdn.ipGroup.delete' },
  'POST /api/cdn/accounts/:aid/l4-proxies': { module: 'cdn', action: 'cdn.l4Proxy.create' },
  'PUT /api/cdn/accounts/:aid/l4-proxies/:proxyId': { module: 'cdn', action: 'cdn.l4Proxy.update' },
  'DELETE /api/cdn/accounts/:aid/l4-proxies/:proxyId': { module: 'cdn', action: 'cdn.l4Proxy.delete' },
  'POST /api/cdn/accounts/:aid/esa/actions': { module: 'cdn', action: 'cdn.esa.api', targetType: 'cdn_zone' },
  'POST /api/cdn/accounts/:aid/l4-proxies/:proxyId/rules': { module: 'cdn', action: 'cdn.l4Rule.create' },
  'DELETE /api/cdn/accounts/:aid/l4-proxies/:proxyId/rules': { module: 'cdn', action: 'cdn.l4Rule.delete' },

  // 预热任务
  'POST /api/cdn/preheat-tasks': { module: 'preheat', action: 'preheat.task.create', targetType: 'preheat_task' },
  'PUT /api/cdn/preheat-tasks/:id': { module: 'preheat', action: 'preheat.task.update', targetType: 'preheat_task' },
  'DELETE /api/cdn/preheat-tasks/:id': { module: 'preheat', action: 'preheat.task.delete', targetType: 'preheat_task' },
  'POST /api/cdn/preheat-tasks/:id/run': { module: 'preheat', action: 'preheat.task.run', targetType: 'preheat_task' },
  'POST /api/cdn/preheat-tasks/:id/toggle': { module: 'preheat', action: 'preheat.task.toggle', targetType: 'preheat_task' },

  // 证书
  'POST /api/cert/orders': { module: 'cert', action: 'cert.order.create', targetType: 'cert_order' },
  'PUT /api/cert/orders/:id': { module: 'cert', action: 'cert.order.update', targetType: 'cert_order' },
  'DELETE /api/cert/orders/:id': { module: 'cert', action: 'cert.order.delete', targetType: 'cert_order' },
  'POST /api/cert/orders/:id/process': { module: 'cert', action: 'cert.order.process', targetType: 'cert_order' },
  'POST /api/cert/orders/batch/process': { module: 'cert', action: 'cert.order.batch', targetType: 'job' },
  'POST /api/cert/orders/:id/reset': { module: 'cert', action: 'cert.order.reset', targetType: 'cert_order' },
  'POST /api/cert/orders/:id/revoke': { module: 'cert', action: 'cert.order.revoke', targetType: 'cert_order' },
  'POST /api/cert/orders/:id/setauto': { module: 'cert', action: 'cert.order.setAuto', targetType: 'cert_order' },
  'POST /api/cert/accounts': { module: 'cert', action: 'cert.account.create' },
  'PUT /api/cert/accounts/:id': { module: 'cert', action: 'cert.account.update', targetType: 'cert_account' },
  'DELETE /api/cert/accounts/:id': { module: 'cert', action: 'cert.account.delete', targetType: 'cert_account' },
  'POST /api/cert/cnames': { module: 'cert', action: 'cert.cname.create', targetType: 'cert_cname' },
  'POST /api/cert/cnames/:id/check': { module: 'cert', action: 'cert.cname.check', targetType: 'cert_cname' },
  'DELETE /api/cert/cnames/:id': { module: 'cert', action: 'cert.cname.delete', targetType: 'cert_cname' },
  'POST /api/cert/settings': { module: 'cert', action: 'cert.settings.update' },
  'POST /api/deploy/tasks': { module: 'cert', action: 'cert.deploy.create', targetType: 'deploy_task' },
  'PUT /api/deploy/tasks/:id': { module: 'cert', action: 'cert.deploy.update', targetType: 'deploy_task' },
  'DELETE /api/deploy/tasks/:id': { module: 'cert', action: 'cert.deploy.delete', targetType: 'deploy_task' },
  'POST /api/deploy/tasks/:id/process': { module: 'cert', action: 'cert.deploy.run', targetType: 'deploy_task' },
  'POST /api/deploy/tasks/batch/process': { module: 'cert', action: 'cert.deploy.batch', targetType: 'job' },
  'POST /api/deploy/tasks/:id/reset': { module: 'cert', action: 'cert.deploy.reset', targetType: 'deploy_task' },
  'POST /api/deploy/tasks/:id/setactive': { module: 'cert', action: 'cert.deploy.setActive', targetType: 'deploy_task' },

  // 监控 / 优选 / 定时 / DNS 检测
  'POST /api/dmonitor/tasks': { module: 'monitor', action: 'monitor.task.create', targetType: 'monitor_task' },
  'PUT /api/dmonitor/tasks/:id': { module: 'monitor', action: 'monitor.task.update', targetType: 'monitor_task' },
  'POST /api/dmonitor/tasks/:id/active': { module: 'monitor', action: 'monitor.task.toggle', targetType: 'monitor_task' },
  'POST /api/dmonitor/tasks/:id/run': { module: 'monitor', action: 'monitor.task.run', targetType: 'monitor_task' },
  'DELETE /api/dmonitor/tasks/:id': { module: 'monitor', action: 'monitor.task.delete', targetType: 'monitor_task' },
  'POST /api/dmonitor/tasks/batch': { module: 'monitor', action: 'monitor.task.batch', targetType: 'monitor_task' },
  'POST /api/dmonitor/clean': { module: 'monitor', action: 'monitor.record.clean' },
  'POST /api/optimize/settings': { module: 'optimize', action: 'optimize.settings.update' },
  'POST /api/optimize/queryapi': { module: 'optimize', action: 'optimize.queryApi.update' },
  'POST /api/optimize/tasks': { module: 'optimize', action: 'optimize.task.create', targetType: 'optimize_task' },
  'PUT /api/optimize/tasks/:id': { module: 'optimize', action: 'optimize.task.update', targetType: 'optimize_task' },
  'POST /api/optimize/tasks/:id/active': { module: 'optimize', action: 'optimize.task.toggle', targetType: 'optimize_task' },
  'POST /api/optimize/tasks/:id/run': { module: 'optimize', action: 'optimize.task.run', targetType: 'optimize_task' },
  'DELETE /api/optimize/tasks/:id': { module: 'optimize', action: 'optimize.task.delete', targetType: 'optimize_task' },
  'POST /api/schedule/tasks': { module: 'schedule', action: 'schedule.task.create', targetType: 'schedule_task' },
  'PUT /api/schedule/tasks/:id': { module: 'schedule', action: 'schedule.task.update', targetType: 'schedule_task' },
  'POST /api/schedule/tasks/:id/active': { module: 'schedule', action: 'schedule.task.toggle', targetType: 'schedule_task' },
  'POST /api/schedule/tasks/:id/run': { module: 'schedule', action: 'schedule.task.run', targetType: 'schedule_task' },
  'DELETE /api/schedule/tasks/:id': { module: 'schedule', action: 'schedule.task.delete', targetType: 'schedule_task' },
  'POST /api/schedule/tasks/batch': { module: 'schedule', action: 'schedule.task.batch', targetType: 'schedule_task' },
  'POST /api/dns-check/tasks': { module: 'dnscheck', action: 'dnscheck.task.create', targetType: 'dnscheck_task' },
  'PUT /api/dns-check/tasks/:id': { module: 'dnscheck', action: 'dnscheck.task.update', targetType: 'dnscheck_task' },
  'POST /api/dns-check/tasks/:id/toggle': { module: 'dnscheck', action: 'dnscheck.task.toggle', targetType: 'dnscheck_task' },
  'POST /api/dns-check/tasks/:id/run': { module: 'dnscheck', action: 'dnscheck.task.run', targetType: 'dnscheck_task' },
  'DELETE /api/dns-check/tasks/:id': { module: 'dnscheck', action: 'dnscheck.task.delete', targetType: 'dnscheck_task' },

  // Cloudflare
  'POST /api/cloudflare/domains/:domainId/hostnames': { module: 'cloudflare', action: 'cloudflare.hostname.create' },
  'POST /api/cloudflare/domains/:domainId/hostnames/batch_add': { module: 'cloudflare', action: 'cloudflare.hostname.batchAdd' },
  'PUT /api/cloudflare/domains/:domainId/hostnames/:hostnameId': { module: 'cloudflare', action: 'cloudflare.hostname.update' },
  'POST /api/cloudflare/domains/:domainId/hostnames/:hostnameId/refresh': {
    module: 'cloudflare',
    action: 'cloudflare.hostname.refresh',
  },
  'DELETE /api/cloudflare/domains/:domainId/hostnames/:hostnameId': { module: 'cloudflare', action: 'cloudflare.hostname.delete' },
  'POST /api/cloudflare/domains/:domainId/hostnames/batch_delete': {
    module: 'cloudflare',
    action: 'cloudflare.hostname.batchDelete',
  },
  'POST /api/cloudflare/domains/:domainId/hostnames/batch_update': {
    module: 'cloudflare',
    action: 'cloudflare.hostname.batchUpdate',
  },
  'POST /api/cloudflare/domains/:domainId/hostnames/txt-targets': { module: 'cloudflare', action: 'cloudflare.txtTargets' },
  'PUT /api/cloudflare/domains/:domainId/fallback': { module: 'cloudflare', action: 'cloudflare.fallback.update' },
  'DELETE /api/cloudflare/domains/:domainId/fallback': { module: 'cloudflare', action: 'cloudflare.fallback.delete' },
  'POST /api/cloudflare/accounts/:accountId/tunnels': { module: 'cloudflare', action: 'cloudflare.tunnel.create' },
  'DELETE /api/cloudflare/accounts/:accountId/tunnels/:tunnelId': { module: 'cloudflare', action: 'cloudflare.tunnel.delete' },
  'PUT /api/cloudflare/accounts/:accountId/tunnels/:tunnelId/public-hostnames': {
    module: 'cloudflare',
    action: 'cloudflare.publicHostname.update',
  },
  'DELETE /api/cloudflare/accounts/:accountId/tunnels/:tunnelId/public-hostnames': {
    module: 'cloudflare',
    action: 'cloudflare.publicHostname.delete',
  },
  'POST /api/cloudflare/accounts/:accountId/tunnels/:tunnelId/cidr-routes': {
    module: 'cloudflare',
    action: 'cloudflare.cidrRoute.create',
  },
  'DELETE /api/cloudflare/accounts/:accountId/tunnels/:tunnelId/cidr-routes/:routeId': {
    module: 'cloudflare',
    action: 'cloudflare.cidrRoute.delete',
  },
  'POST /api/cloudflare/accounts/:accountId/tunnels/:tunnelId/hostname-routes': {
    module: 'cloudflare',
    action: 'cloudflare.hostnameRoute.create',
  },
  'DELETE /api/cloudflare/accounts/:accountId/tunnels/:tunnelId/hostname-routes/:routeId': {
    module: 'cloudflare',
    action: 'cloudflare.hostnameRoute.delete',
  },
  'POST /api/cf-rules/credential': { module: 'cloudflare', action: 'cloudflare.credential.save' },
  'DELETE /api/cf-rules/credential': { module: 'cloudflare', action: 'cloudflare.credential.delete' },
  'POST /api/cf-rules/rules': { module: 'cloudflare', action: 'cloudflare.rule.create' },
  'PUT /api/cf-rules/rules/:ruleId': { module: 'cloudflare', action: 'cloudflare.rule.update' },
  'DELETE /api/cf-rules/rules/:ruleId': { module: 'cloudflare', action: 'cloudflare.rule.delete' },

  // 事件回调
  'POST /api/events/subscriptions': { module: 'events', action: 'event.subscription.create', targetType: 'event_subscription' },
  'PUT /api/events/subscriptions/:id': { module: 'events', action: 'event.subscription.update', targetType: 'event_subscription' },
  'DELETE /api/events/subscriptions/:id': { module: 'events', action: 'event.subscription.delete', targetType: 'event_subscription' },
  'POST /api/events/subscriptions/:id/test': { module: 'events', action: 'event.subscription.test', targetType: 'event_subscription' },

  // 注册
  'POST /api/register': { module: 'auth', action: 'auth.register' },
  'POST /api/register/send-code': { module: 'auth', action: 'auth.sendCode' },
  'POST /api/register/codes': { module: 'auth', action: 'auth.regCode.create' },
  'POST /api/register/codes/:id/status': { module: 'auth', action: 'auth.regCode.status' },
  'DELETE /api/register/codes/:id': { module: 'auth', action: 'auth.regCode.delete' },
};

/** 一级路径 → 模块 */
const MODULE_BY_SEGMENT: Record<string, string> = {
  auth: 'auth',
  register: 'auth',
  users: 'user',
  user: 'user',
  domains: 'domain',
  records: 'record',
  dns: 'account',
  account: 'account',
  cdn: 'cdn',
  cert: 'cert',
  deploy: 'cert',
  cloudflare: 'cloudflare',
  'cf-rules': 'cloudflare',
  'api-keys': 'apikeys',
  jobs: 'jobs',
  events: 'events',
  schedule: 'schedule',
  dmonitor: 'monitor',
  dnscheck: 'dnscheck',
  'dns-check': 'dnscheck',
  optimize: 'optimize',
  preheat: 'preheat',
  expire: 'expire',
  system: 'system',
  about: 'system',
  qqbot: 'system',
  logs: 'system',
  audit: 'system',
};

/** 名词单数化（只处理本项目出现过的复数） */
const SINGULAR: Record<string, string> = {
  domains: 'domain',
  records: 'record',
  accounts: 'account',
  users: 'user',
  rules: 'rule',
  sites: 'site',
  zones: 'zone',
  tasks: 'task',
  aliases: 'alias',
  categories: 'category',
  cnames: 'cname',
  orders: 'order',
  codes: 'code',
  tunnels: 'tunnel',
  hostnames: 'hostname',
  'origin-groups': 'originGroup',
  'load-balancers': 'loadBalancer',
  'l4-proxies': 'l4Proxy',
  'ip-groups': 'ipGroup',
  'rule-configs': 'ruleConfig',
  'preheat-tasks': 'preheatTask',
  'stat-cache-clear': 'statCache',
  'stat-cache-refresh': 'statCache',
};

/** 路径末段是"动作"而不是"资源"的，先识别出来，避免生成 cdn.pause.create 这种名字 */
const VERB_SEG = new Set([
  'check', 'verify', 'pause', 'active', 'run', 'priority', 'refresh', 'reset', 'process',
  'revoke', 'setactive', 'setauto', 'toggle', 'remark', 'weight', 'update-date', 'batch',
  'batch-add', 'batch_add', 'batch_delete', 'batch_update', 'clean', 'sync', 'purge', 'certlink', 'lang',
]);

function camel(s: string): string {
  return s.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function resolveRoute(method: string, route: string): RouteMeta {
  const exact = AUDIT_ROUTES[`${method} ${route}`];
  if (exact) return exact;

  const segs = route.split('/').filter(Boolean); // ['api','cdn','accounts',':aid','rules']
  const module = MODULE_BY_SEGMENT[segs[1] || ''] || segs[1] || 'other';
  const statics = segs.filter((s) => !s.startsWith(':') && s !== 'api');

  let last = statics[statics.length - 1] || module;
  let verb = '';
  if (VERB_SEG.has(last) && statics.length >= 2) {
    verb = camel(last);
    last = statics[statics.length - 2];
  }

  const noun = SINGULAR[last] || camel(last).replace(/(?<=[a-z])s$/, '');
  const fallbackVerb =
    verb || (method === 'POST' ? 'create' : method === 'PUT' || method === 'PATCH' ? 'update' : 'delete');
  const prefix = noun === module ? module : `${module}.${noun}`;

  return { module, action: `${prefix}.${fallbackVerb}` };
}
