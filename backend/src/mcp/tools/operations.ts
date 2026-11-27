import {
  bool,
  boolValue,
  int,
  listResponse,
  paging,
  pagingDefaults,
  requireArgs,
  str,
  type ToolArgs,
  type ToolDef,
} from '../types.js';

const need = (...keys: string[]) => (args: ToolArgs) => {
  requireArgs(args, keys);
  return args;
};

function auditLogs(data: any): any {
  const out = listResponse(data);
  const inner = data?.data;
  if (inner && typeof inner === 'object' && inner.truncated !== undefined) out.truncated = inner.truncated;
  return out;
}

const operationsTools: ToolDef[] = [
  {
    name: 'dnscheck_query',
    title: '查询DNS检测',
    description: '查询 DNS 检测任务、可检测的域名和指定域名下的可选子域名。普通用户只能看到自己的任务和有权限的域名。',
    readOnly: true,
    properties: {
      kw: str('domains：按域名关键词搜索'),
      domain_id: int('subs：域名ID'),
    },
    actions: {
      tasks: {
        desc: 'DNS 检测任务列表',
        level: 1,
        scope: { module: 'dnscheck' },
        request: () => ({ method: 'GET', path: '/api/dns-check/tasks' }),
        after: (data) => listResponse(data),
      },
      domains: {
        desc: '当前用户可选的检测域名',
        level: 1,
        scope: { module: 'dnscheck' },
        request: (args) => ({ method: 'GET', path: '/api/dns-check/domains', query: { kw: args.kw } }),
        after: (data) => listResponse(data),
      },
      subs: {
        desc: '指定域名的可选检测子域名',
        level: 1,
        scope: { module: 'dnscheck' },
        before: need('domain_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/dns-check/domains/${Number(args.domain_id)}/subs`,
        }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'expire_query',
    title: '查询到期提醒设置',
    description: '查询域名到期提醒的全局设置。仅管理员可用。',
    readOnly: true,
    actions: {
      settings: {
        desc: '到期提醒设置',
        level: 2,
        scope: { module: 'expire' },
        request: () => ({ method: 'GET', path: '/api/expire/settings' }),
      },
    },
  },
  {
    name: 'audit_query',
    title: '查询审计日志',
    description: '查询系统审计日志和统计。普通用户只能看到自己的审计记录。',
    readOnly: true,
    properties: {
      startTime: str('开始时间，格式 YYYY-MM-DD HH:mm:ss'),
      endTime: str('结束时间，格式 YYYY-MM-DD HH:mm:ss'),
      uid: int('按用户ID筛选（仅管理员）'),
      module: str('按模块筛选'),
      log_action: str('按动作筛选'),
      result: str('按结果筛选：0=失败，1=成功', ['0', '1']),
      target: str('按目标名称搜索'),
      kw: str('按摘要、目标、IP、用户名搜索'),
      ...paging(),
    },
    actions: {
      logs: {
        desc: '审计日志列表',
        level: 1,
        scope: { module: 'audit' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/audit/logs',
          query: {
            startTime: args.startTime,
            endTime: args.endTime,
            uid: args.uid,
            module: args.module,
            action: args.log_action,
            result: args.result,
            target: args.target,
            kw: args.kw,
            offset: args.offset,
            limit: args.limit,
          },
        }),
        after: auditLogs,
      },
      stats: {
        desc: '审计统计卡（今日、近7天失败、近30天活跃用户）',
        level: 1,
        scope: { module: 'audit' },
        request: () => ({ method: 'GET', path: '/api/audit/stats' }),
      },
    },
  },
  {
    name: 'job_query',
    title: '查询异步任务',
    description: '查询后台异步任务列表和详情。普通用户只能看到自己的任务。长任务触发后可轮询本工具。',
    readOnly: true,
    properties: {
      id: int('任务ID（get 必填）'),
      uid: int('按用户ID筛选（仅管理员）'),
      type: str('按任务类型筛选'),
      status: str('按状态筛选'),
      ...paging(),
    },
    actions: {
      list: {
        desc: '异步任务列表',
        level: 1,
        scope: { module: 'jobs' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/jobs',
          query: { uid: args.uid, type: args.type, status: args.status, offset: args.offset, limit: args.limit },
        }),
        after: (data) => listResponse(data),
      },
      get: {
        desc: '异步任务详情',
        level: 1,
        scope: { module: 'jobs' },
        before: need('id'),
        request: (args) => ({ method: 'GET', path: `/api/jobs/${Number(args.id)}` }),
      },
    },
  },
  {
    name: 'backup_query',
    title: '查询备份',
    description:
      '查询备份任务、备份密钥状态、远端存储、备份计划和远端备份文件。普通用户只能查询自己的备份任务，其余动作仅管理员可用。',
    readOnly: true,
    properties: {
      page: int('jobs：页码，默认1'),
      size: int('jobs：每页数量，默认20，最大200'),
      mine: bool('jobs：仅查看自己的个人备份'),
      destId: int('remote：备份目的地ID'),
    },
    actions: {
      jobs: {
        desc: '备份任务列表',
        level: 1,
        scope: { module: 'backup' },
        defaults: { page: 1, size: 20, mine: false },
        request: (args) => ({
          method: 'GET',
          path: '/api/backup/jobs',
          query: { page: args.page, size: args.size, mine: args.mine ? '1' : '' },
        }),
        after: (data) => listResponse(data),
      },
      key_status: {
        desc: '备份密钥配置状态',
        level: 2,
        scope: { module: 'backup' },
        request: () => ({ method: 'GET', path: '/api/backup/key/status' }),
      },
      destinations: {
        desc: '备份目的地列表',
        level: 2,
        scope: { module: 'backup' },
        request: () => ({ method: 'GET', path: '/api/backup/destinations' }),
        after: (data) => listResponse(data),
      },
      schedules: {
        desc: '备份计划列表',
        level: 2,
        scope: { module: 'backup' },
        request: () => ({ method: 'GET', path: '/api/backup/schedules' }),
        after: (data) => listResponse(data),
      },
      remote: {
        desc: '远端备份文件列表',
        level: 2,
        scope: { module: 'backup' },
        before: need('destId'),
        request: (args) => ({ method: 'GET', path: `/api/backup/remote/${Number(args.destId)}` }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'system_query',
    title: '查询系统信息',
    description: '查询系统设置、项目信息和通知发送日志。系统设置与通知日志仅管理员可用。',
    readOnly: true,
    properties: {
      module: str('notifications：按模块筛选'),
      event: str('notifications：按事件筛选'),
      detail: bool('notifications：是否返回完整详情，默认 false'),
      force: bool('check_update：是否强制刷新更新检查缓存'),
      ...paging(),
    },
    actions: {
      about: {
        desc: '项目名称、版本、仓库和许可证信息',
        level: 1,
        scope: { module: 'general' },
        request: () => ({ method: 'GET', path: '/api/about' }),
      },
      settings: {
        desc: '系统设置（密钥类字段以掩码返回）',
        level: 2,
        scope: { module: 'system' },
        request: () => ({ method: 'GET', path: '/api/system/settings' }),
      },
      notifications: {
        desc: '通知发送日志',
        level: 2,
        scope: { module: 'system' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/notifications/logs',
          query: { module: args.module, event: args.event, offset: args.offset, limit: args.limit, detail: args.detail ? 1 : 0 },
        }),
        after: (data) => listResponse(data),
      },
      cronkey: {
        desc: '查询外部 Cron 触发密钥和触发方式',
        level: 2,
        scope: { module: 'system' },
        request: () => ({ method: 'GET', path: '/api/system/cronkey' }),
      },
      check_update: {
        desc: '检查系统更新（POST 查询，需 general:write）',
        level: 2,
        scope: { module: 'general', write: true },
        request: (args) => ({
          method: 'POST',
          path: '/api/about/check-update',
          body: { force: boolValue(args.force) ? 1 : 0 },
        }),
      },
    },
  },
  {
    name: 'announcement_query',
    title: '查询公告',
    description: '查询当前有效公告，或由管理员查询全部公告。',
    readOnly: true,
    actions: {
      list: {
        desc: '当前有效的公开公告',
        level: 1,
        scope: { module: 'system' },
        request: () => ({ method: 'GET', path: '/api/announcements' }),
        after: (data) => listResponse(data),
      },
      admin_list: {
        desc: '全部公告（含停用和未到时间的公告）',
        level: 2,
        scope: { module: 'system' },
        request: () => ({ method: 'GET', path: '/api/system/announcements' }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'user_query',
    title: '查询用户',
    description: '查询用户列表、用户详情、可授权域名和操作日志。用户列表与详情仅管理员可用，普通用户只能查看自己的操作日志。',
    readOnly: true,
    properties: {
      id: int('用户ID（get 必填）'),
      uid: int('logs：按用户ID筛选（仅管理员）'),
      domain: str('logs：按域名筛选'),
      kw: str('list/domains/logs：搜索关键词'),
      ...paging(),
    },
    actions: {
      list: {
        desc: '用户列表',
        level: 2,
        scope: { module: 'users' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/users',
          query: {
            kw: args.kw,
            offset: args.offset,
            limit: args.limit,
            sortName: args.sortName,
            sortOrder: args.sortOrder,
          },
        }),
        after: (data) => listResponse(data),
      },
      get: {
        desc: '用户详情与权限',
        level: 2,
        scope: { module: 'users' },
        before: need('id'),
        request: (args) => ({ method: 'GET', path: `/api/users/${Number(args.id)}` }),
      },
      domains: {
        desc: '可授权域名列表',
        level: 2,
        scope: { module: 'users' },
        request: (args) => ({ method: 'GET', path: '/api/user/domains', query: { kw: args.kw } }),
        after: (data) => listResponse(data),
      },
      logs: {
        desc: '操作日志列表',
        level: 1,
        scope: { module: 'users' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/logs',
          query: {
            uid: args.uid,
            domain: args.domain,
            kw: args.kw,
            offset: args.offset,
            limit: args.limit,
          },
        }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'event_query',
    title: '查询事件回调',
    description: '查询事件订阅和投递记录。仅管理员可用，订阅密钥不会返回。',
    readOnly: true,
    properties: {
      sub_id: int('deliveries：按订阅ID筛选'),
      event: str('deliveries：按事件名筛选'),
      ...paging(),
    },
    actions: {
      subscriptions: {
        desc: '事件订阅列表',
        level: 2,
        scope: { module: 'events' },
        request: () => ({ method: 'GET', path: '/api/events/subscriptions' }),
        after: (data) => listResponse(data),
      },
      deliveries: {
        desc: '事件投递记录',
        level: 2,
        scope: { module: 'events' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/events/deliveries',
          query: { sub_id: args.sub_id, event: args.event, offset: args.offset, limit: args.limit },
        }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'cf_rules_query',
    title: '查询Cloudflare规则引擎',
    description: '查询 Cloudflare 规则引擎的规则类型、可管理域名、账户聚合、专用凭证状态和规则列表。仅管理员可用。',
    readOnly: true,
    properties: {
      aid: int('credential：Cloudflare 账户ID'),
      domain_id: int('rules：Cloudflare 域名ID'),
      phase: str('rules：规则类型'),
    },
    actions: {
      phases: {
        desc: '规则类型元数据',
        level: 2,
        scope: { module: 'cloudflare' },
        request: () => ({ method: 'GET', path: '/api/cf-rules/phases' }),
      },
      domains: {
        desc: '可管理的 Cloudflare 域名',
        level: 2,
        scope: { module: 'cloudflare' },
        request: () => ({ method: 'GET', path: '/api/cf-rules/domains' }),
        after: (data) => listResponse(data),
      },
      accounts: {
        desc: 'Cloudflare 账户聚合（域名数、站点数、凭证状态）',
        level: 2,
        scope: { module: 'cloudflare' },
        request: () => ({ method: 'GET', path: '/api/cf-rules/accounts' }),
        after: (data) => listResponse(data),
      },
      credential: {
        desc: '账户专用凭证状态',
        level: 2,
        scope: { module: 'cloudflare' },
        before: need('aid'),
        request: (args) => ({ method: 'GET', path: '/api/cf-rules/credential', query: { aid: args.aid } }),
      },
      rules: {
        desc: '规则列表',
        level: 2,
        scope: { module: 'cloudflare' },
        before: need('domain_id', 'phase'),
        request: (args) => ({
          method: 'GET',
          path: '/api/cf-rules/rules',
          query: { domainId: args.domain_id, phase: args.phase },
        }),
      },
    },
  },
  {
    name: 'cert_settings_query',
    title: '查询证书设置',
    description: '查询证书续期、部署时段、CDN 证书账户和证书通知设置。仅管理员可用。',
    readOnly: true,
    actions: {
      get: {
        desc: '证书全局设置',
        level: 2,
        scope: { module: 'cert' },
        request: () => ({ method: 'GET', path: '/api/cert/settings' }),
      },
    },
  },
  {
    name: 'vault_query',
    title: '查询保险库状态',
    description: '查询当前用户的保险库状态（是否启用、保护方式、是否已解锁）。',
    readOnly: true,
    actions: {
      status: {
        desc: '保险库状态',
        level: 1,
        scope: { module: 'vault' },
        request: () => ({ method: 'GET', path: '/api/vault/status' }),
      },
    },
  },
];

export default operationsTools;