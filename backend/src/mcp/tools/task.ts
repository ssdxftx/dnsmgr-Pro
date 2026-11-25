import { callRoute } from '../invoker.js';
import {
  int,
  str,
  obj,
  ids,
  bool,
  listResponse,
  paging,
  pagingDefaults,
  requireArgs,
  boolValue,
  McpToolError,
  type ToolArgs,
  type ToolDef,
  type McpContext,
} from '../types.js';
import { prefill } from '../helpers.js';

const recordInfoDesc = '所选解析记录信息对象，如 {"Value":"1.2.3.4","Line":"default","LineName":"默认","TTL":600}，取自 record_query subdomain 的返回';

function recordInfoText(value: any): any {
  if (value === undefined || value === null || value === '') return value;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function optimizeBalance(ctx: McpContext): Promise<any> {
  const settings = await callRoute(ctx, { method: 'GET', path: '/api/optimize/settings' });
  if (settings?.code !== 0) return settings;
  return callRoute(ctx, {
    method: 'POST',
    path: '/api/optimize/queryapi',
    body: { optimize_ip_api: settings.data?.optimize_ip_api, optimize_ip_key: settings.data?.optimize_ip_key },
  });
}

const tools: ToolDef[] = [
  {
    name: 'dmonitor_query',
    title: '查询容灾切换',
    description: '查询容灾切换（健康检测与自动切换解析）策略、运行状态和切换日志。',
    readOnly: true,
    properties: {
      id: int('策略ID（info/logs 必填）'),
      kw: str('list：搜索关键词'),
      type: int('list：搜索字段，1=域名/主机记录，2=记录ID，3=主地址，4=备用地址，5=备注'),
      status: str('list：按健康状态筛选，0=正常，1=异常', ['0', '1']),
      log_action: int('logs：按动作筛选，1=异常切换，2=恢复'),
      ...paging(),
    },
    actions: {
      overview: {
        desc: '容灾监控进程运行状态与近24小时切换统计',
        scope: { module: 'monitor' },
        request: () => ({ method: 'GET', path: '/api/dmonitor/overview' }),
      },
      domains: {
        desc: '可添加容灾切换策略的域名列表',
        scope: { module: 'monitor' },
        request: (args) => ({ method: 'GET', path: '/api/dmonitor/domains', query: { kw: args.kw } }),
        after: (data) => listResponse(data),
      },
      status: {
        desc: '容灾监控运行状态',
        scope: { module: 'monitor' },
        request: () => ({ method: 'GET', path: '/api/dmonitor/status' }),
      },
      list: {
        desc: '容灾切换策略列表',
        scope: { module: 'monitor' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/dmonitor/tasks',
          query: {
            kw: args.kw, type: args.type, status: args.status, offset: args.offset, limit: args.limit,
            sortName: args.sortName, sortOrder: args.sortOrder,
          },
        }),
        after: (data) => listResponse(data),
      },
      info: {
        desc: '策略详情与近24小时切换统计',
        scope: { module: 'monitor' },
        before: (args) => {
          requireArgs(args, ['id']);
          return args;
        },
        request: (args) => ({ method: 'GET', path: `/api/dmonitor/tasks/${Number(args.id)}` }),
      },
      logs: {
        desc: '策略的切换日志',
        scope: { module: 'monitor' },
        defaults: pagingDefaults(),
        before: (args) => {
          requireArgs(args, ['id']);
          return args;
        },
        request: (args) => ({
          method: 'GET',
          path: `/api/dmonitor/tasks/${Number(args.id)}/logs`,
          query: { action: args.log_action, offset: args.offset, limit: args.limit },
        }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'dmonitor_manage',
    title: '管理容灾切换',
    description:
      "添加、修改、删除、启停容灾切换策略。添加前先用 record_query(action=subdomain) 获取目标解析记录的 RecordId 与记录信息。\n切换类型 type：0=无操作（仅监控），1=暂停解析，2=切换备用解析，3=条件开启解析。检测方式 checktype：0=PING，1=TCP，2=HTTP(S)。",
    destructive: true,
    properties: {
      id: int('策略ID（edit/set_active/del 必填）'),
      ids: ids('batch：策略ID列表'),
      did: int('域名ID'),
      rr: str('主机记录'),
      recordid: str('解析记录ID'),
      recordinfo: obj(recordInfoDesc),
      main_value: str('主记录值（即所选记录的值）'),
      type: int('切换类型：0=无操作，1=暂停解析，2=切换备用解析，3=条件开启解析'),
      backup_value: str('type=2：备用解析地址（IP或CNAME）'),
      checktype: int('检测方式：0=PING，1=TCP，2=HTTP(S)'),
      checkurl: str('checktype=2：检测URL；checktype=0/1：检测IP（留空为记录值）'),
      tcpport: int('checktype=1：TCP端口'),
      frequency: int('检测间隔（秒），默认5'),
      cycle: int('连续失败几次后切换，默认3；type=3 时为同域名正常记录数<=几条时开启'),
      timeout: int('最大超时时间（秒），默认2，不能大于检测间隔'),
      proxy: bool('HTTP检测是否使用代理'),
      cdn: bool('type=2：切换时同时开启Cloudflare代理'),
      remark: str('备注'),
      active: bool('set_active：是否启用'),
      act: str('batch：操作类型', ['delete', 'retry', 'open', 'close']),
      days: int('clean_logs：清理多少天前的日志'),
    },
    actions: {
      add: {
        desc: '添加策略（did、rr、recordid、recordinfo、main_value 必填）',
        scope: { module: 'monitor', write: true },
        defaults: { type: 1, checktype: 1, tcpport: 80, frequency: 5, cycle: 3, timeout: 2, proxy: 0, cdn: 0 },
        before: (args) => {
          requireArgs(args, ['did', 'rr', 'recordid', 'recordinfo', 'main_value']);
          args.recordinfo = recordInfoText(args.recordinfo);
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: '/api/dmonitor/tasks',
          body: {
            did: args.did,
            rr: args.rr,
            recordid: args.recordid,
            recordinfo: args.recordinfo,
            main_value: args.main_value,
            type: args.type,
            backup_value: args.backup_value,
            checktype: args.checktype,
            checkurl: args.checkurl,
            tcpport: args.tcpport,
            frequency: args.frequency,
            cycle: args.cycle,
            timeout: args.timeout,
            proxy: boolValue(args.proxy) ? 1 : 0,
            cdn: boolValue(args.cdn) ? 1 : 0,
            remark: args.remark,
          },
        }),
      },
      edit: {
        desc: '修改策略（id 必填，未传字段保持不变）',
        scope: { module: 'monitor', write: true },
        before: async (args) => {
          await prefill('dmtask', args, [
            'did',
            'rr',
            'recordid',
            'type',
            'main_value',
            'backup_value',
            'checktype',
            'checkurl',
            'tcpport',
            'frequency',
            'cycle',
            'timeout',
            'proxy',
            'cdn',
            'remark',
            'recordinfo',
          ]);
          args.recordinfo = recordInfoText(args.recordinfo);
          return args;
        },
        request: (args) => ({
          method: 'PUT',
          path: `/api/dmonitor/tasks/${Number(args.id)}`,
          body: {
            did: args.did,
            rr: args.rr,
            recordid: args.recordid,
            recordinfo: args.recordinfo,
            main_value: args.main_value,
            type: args.type,
            backup_value: args.backup_value,
            checktype: args.checktype,
            checkurl: args.checkurl,
            tcpport: args.tcpport,
            frequency: args.frequency,
            cycle: args.cycle,
            timeout: args.timeout,
            proxy: boolValue(args.proxy) ? 1 : 0,
            cdn: boolValue(args.cdn) ? 1 : 0,
            remark: args.remark,
          },
        }),
      },
      set_active: {
        desc: '启用或停用策略（id、active 必填）',
        scope: { module: 'monitor', write: true },
        request: (args) => ({
          method: 'POST',
          path: `/api/dmonitor/tasks/${Number(args.id)}/active`,
          body: { active: boolValue(args.active) ? 1 : 0 },
        }),
      },
      del: {
        desc: '删除策略（id 必填）',
        scope: { module: 'monitor', write: true },
        request: (args) => ({ method: 'DELETE', path: `/api/dmonitor/tasks/${Number(args.id)}` }),
      },
      batch: {
        desc: '批量操作（ids、act 必填）',
        scope: { module: 'monitor', write: true },
        request: (args) => ({ method: 'POST', path: '/api/dmonitor/tasks/batch', body: { ids: args.ids, act: args.act } }),
      },
      clean_logs: {
        desc: '清理指定天数之前的切换日志（days 必填）',
        scope: { module: 'monitor', write: true },
        request: (args) => ({ method: 'POST', path: '/api/dmonitor/clean', body: { days: args.days } }),
      },
      run: {
        desc: '立即执行一次检测并返回最新检测日志（id 必填）',
        scope: { module: 'monitor', write: true },
        before: (args) => {
          requireArgs(args, ['id']);
          return args;
        },
        request: (args) => ({ method: 'POST', path: `/api/dmonitor/tasks/${Number(args.id)}/run` }),
      },
    },
  },
  {
    name: 'optimizeip_query',
    title: '查询优选IP',
    description: '查询优选IP任务（为域名自动解析CDN优选IP）列表，或查询优选IP接口积分余额。',
    readOnly: true,
    properties: {
      kw: str('list：搜索关键词'),
      type: int('list：搜索字段，1=域名/主机记录，2=备注'),
      status: str('list：按状态筛选，0=未运行，1=成功，2=失败', ['0', '1', '2']),
      ...paging(),
    },
    actions: {
      list: {
        desc: '优选IP任务列表',
        scope: { module: 'optimize' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/optimize/tasks',
          query: {
            kw: args.kw, type: args.type, status: args.status, offset: args.offset, limit: args.limit,
            sortName: args.sortName, sortOrder: args.sortOrder,
          },
        }),
        after: (data) => listResponse(data),
      },
      api_balance: {
        desc: '查询当前配置的优选IP接口积分余额',
        scope: { module: 'optimize', write: true },
        handler: (_args, ctx) => optimizeBalance(ctx),
      },
      settings: {
        desc: '优选IP设置（接口密钥以掩码返回）',
        scope: { module: 'optimize' },
        request: () => ({ method: 'GET', path: '/api/optimize/settings' }),
      },
      domains: {
        desc: '可添加优选IP任务的域名列表（不含 Cloudflare）',
        scope: { module: 'optimize' },
        request: (args) => ({ method: 'GET', path: '/api/optimize/domains', query: { kw: args.kw } }),
        after: (data) => listResponse(data),
      },
      status: {
        desc: '优选IP调度运行状态',
        scope: { module: 'optimize' },
        request: () => ({ method: 'GET', path: '/api/optimize/status' }),
      },
    },
  },
  {
    name: 'optimizeip_manage',
    title: '管理优选IP',
    description: '添加、修改、删除、启停、立即执行优选IP任务。仅支持非 Cloudflare 的域名。',
    destructive: true,
    properties: {
      id: int('任务ID（add 以外必填）'),
      did: int('域名ID'),
      rr: str('主机记录'),
      type: int('解析线路类型：0=电信/联通/移动线路，1=默认/联通/移动线路'),
      cdn_type: int('CDN运营商：1=CloudFlare，2=CloudFront，4=EdgeOne'),
      ip_type: str('IP类型，v4、v6 或 v4,v6'),
      recordnum: int('每个线路解析的IP数量（1-50），默认2'),
      ttl: int('TTL，默认600'),
      remark: str('备注'),
      active: bool('set_active：是否启用'),
      optimize_ip_api: str('优选IP接口类型：0=关闭，1=开启（save_settings/query_api 使用）'),
      optimize_ip_key: str('优选IP接口密钥；传掩码表示沿用已保存值（save_settings/query_api 使用）'),
      optimize_ip_proxy: str('优选IP接口代理地址；传掩码表示沿用已保存值（save_settings 使用）'),
      optimize_ip_min: int('自动更新时间间隔，10-10080 分钟（save_settings 使用）'),
    },
    actions: {
      add: {
        desc: '添加任务（did、rr 必填）',
        scope: { module: 'optimize', write: true },
        defaults: { type: 0, cdn_type: 1, ip_type: 'v4', recordnum: 2, ttl: 600 },
        before: (args) => {
          requireArgs(args, ['did', 'rr']);
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: '/api/optimize/tasks',
          body: {
            did: args.did,
            rr: args.rr,
            type: args.type,
            cdn_type: args.cdn_type,
            ip_type: args.ip_type,
            recordnum: args.recordnum,
            ttl: args.ttl,
            remark: args.remark,
          },
        }),
      },
      edit: {
        desc: '修改任务（id 必填，未传字段保持不变）',
        scope: { module: 'optimize', write: true },
        before: async (args) => {
          await prefill('optimizeip', args, ['did', 'rr', 'type', 'ip_type', 'cdn_type', 'recordnum', 'ttl', 'remark']);
          return args;
        },
        request: (args) => ({
          method: 'PUT',
          path: `/api/optimize/tasks/${Number(args.id)}`,
          body: {
            did: args.did,
            rr: args.rr,
            type: args.type,
            cdn_type: args.cdn_type,
            ip_type: args.ip_type,
            recordnum: args.recordnum,
            ttl: args.ttl,
            remark: args.remark,
          },
        }),
      },
      set_active: {
        desc: '启用或停用任务（id、active 必填）',
        scope: { module: 'optimize', write: true },
        request: (args) => ({
          method: 'POST',
          path: `/api/optimize/tasks/${Number(args.id)}/active`,
          body: { active: boolValue(args.active) ? 1 : 0 },
        }),
      },
      del: {
        desc: '删除任务（id 必填）',
        scope: { module: 'optimize', write: true },
        request: (args) => ({ method: 'DELETE', path: `/api/optimize/tasks/${Number(args.id)}` }),
      },
      run: {
        desc: '立即执行一次优选任务（id 必填）',
        scope: { module: 'optimize', write: true },
        request: (args) => ({ method: 'POST', path: `/api/optimize/tasks/${Number(args.id)}/run` }),
      },
      save_settings: {
        desc: '保存优选IP接口设置（仅提交需要变更的字段）',
        scope: { module: 'optimize', write: true },
        before: (args) => {
          const keys = ['optimize_ip_api', 'optimize_ip_key', 'optimize_ip_proxy', 'optimize_ip_min'];
          if (!keys.some((key) => args[key] !== undefined && args[key] !== null && args[key] !== '')) {
            throw new McpToolError('缺少需要保存的设置字段');
          }
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: '/api/optimize/settings',
          body: {
            optimize_ip_api: args.optimize_ip_api,
            optimize_ip_key: args.optimize_ip_key,
            optimize_ip_proxy: args.optimize_ip_proxy,
            optimize_ip_min: args.optimize_ip_min,
          },
        }),
      },
      query_api: {
        desc: '查询优选IP接口积分余额；不传接口参数时使用已保存设置',
        scope: { module: 'optimize', write: true },
        handler: (args, ctx) => {
          if (args.optimize_ip_api !== undefined || args.optimize_ip_key !== undefined) {
            return callRoute(ctx, {
              method: 'POST',
              path: '/api/optimize/queryapi',
              body: { optimize_ip_api: args.optimize_ip_api, optimize_ip_key: args.optimize_ip_key },
            });
          }
          return optimizeBalance(ctx);
        },
      },
    },
  },
  {
    name: 'schedule_query',
    title: '查询定时切换',
    description: '查询定时切换（按时间自动修改/启用/暂停/删除解析）任务列表。',
    readOnly: true,
    properties: {
      kw: str('搜索关键词'),
      type: int('搜索字段，1=域名/主机记录，2=记录ID，3=记录值，4=备注'),
      stype: str('按执行方式筛选，0=单次，1=周期', ['0', '1']),
      ...paging(),
    },
    actions: {
      domains: {
        desc: '可添加定时切换任务的域名列表',
        scope: { module: 'schedule' },
        request: (args) => ({ method: 'GET', path: '/api/schedule/domains', query: { kw: args.kw } }),
        after: (data) => listResponse(data),
      },
      list: {
        desc: '定时切换任务列表',
        scope: { module: 'schedule' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/schedule/tasks',
          query: {
            kw: args.kw, type: args.type, stype: args.stype, offset: args.offset, limit: args.limit,
            sortName: args.sortName, sortOrder: args.sortOrder,
          },
        }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'schedule_manage',
    title: '管理定时切换',
    description:
      "添加、修改、删除、启停定时切换任务。添加前先用 record_query(action=subdomain) 获取目标解析记录的 RecordId 与记录信息。\n执行方式 type：0=单次执行（switchtime 为 Y-m-dTH:i 格式的日期时间），1=周期执行（cycle：0=每天，1=每周，2=每月；switchdate：每周时为0-6（0=周日），每月时为1-31；switchtime 为 H:i）。\n切换操作 switchtype：0=修改解析（需 value），1=启用解析，2=暂停解析，3=删除解析（仅单次）。",
    destructive: true,
    properties: {
      id: int('任务ID（add 以外必填）'),
      ids: ids('batch：任务ID列表'),
      did: int('域名ID'),
      rr: str('主机记录'),
      recordid: str('解析记录ID'),
      recordinfo: obj(recordInfoDesc),
      type: int('执行方式：0=单次，1=周期'),
      cycle: int('周期：0=每天，1=每周，2=每月'),
      switchdate: str('周期日期：每周为0-6，每月为1-31'),
      switchtime: str('执行时间'),
      switchtype: int('切换操作：0=修改解析，1=启用，2=暂停，3=删除'),
      value: str('switchtype=0：新的记录值'),
      line: str('switchtype=0 且为Cloudflare：空=不修改，0=仅DNS，1=代理'),
      remark: str('备注'),
      active: bool('set_active：是否启用'),
      act: str('batch：操作类型', ['delete', 'open', 'close']),
    },
    actions: {
      add: {
        desc: '添加任务（did、rr、recordid、recordinfo、type、switchtype、switchtime 必填）',
        scope: { module: 'schedule', write: true },
        defaults: { type: 0, cycle: 0, switchtype: 0 },
        before: (args) => {
          requireArgs(args, ['did', 'rr', 'recordid', 'recordinfo', 'type', 'switchtype', 'switchtime']);
          args.recordinfo = recordInfoText(args.recordinfo);
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: '/api/schedule/tasks',
          body: {
            did: args.did,
            rr: args.rr,
            recordid: args.recordid,
            recordinfo: args.recordinfo,
            type: args.type,
            cycle: args.cycle,
            switchdate: args.switchdate,
            switchtime: args.switchtime,
            switchtype: args.switchtype,
            value: args.value,
            line: args.line,
            remark: args.remark,
          },
        }),
      },
      edit: {
        desc: '修改任务（id 必填，未传字段保持不变）',
        scope: { module: 'schedule', write: true },
        before: async (args) => {
          await prefill('sctask', args, [
            'did',
            'rr',
            'recordid',
            'type',
            'cycle',
            'switchtype',
            'switchdate',
            'switchtime',
            'value',
            'line',
            'remark',
            'recordinfo',
          ]);
          args.recordinfo = recordInfoText(args.recordinfo);
          return args;
        },
        request: (args) => ({
          method: 'PUT',
          path: `/api/schedule/tasks/${Number(args.id)}`,
          body: {
            did: args.did,
            rr: args.rr,
            recordid: args.recordid,
            recordinfo: args.recordinfo,
            type: args.type,
            cycle: args.cycle,
            switchdate: args.switchdate,
            switchtime: args.switchtime,
            switchtype: args.switchtype,
            value: args.value,
            line: args.line,
            remark: args.remark,
          },
        }),
      },
      set_active: {
        desc: '启用或停用任务（id、active 必填）',
        scope: { module: 'schedule', write: true },
        request: (args) => ({
          method: 'POST',
          path: `/api/schedule/tasks/${Number(args.id)}/active`,
          body: { active: boolValue(args.active) ? 1 : 0 },
        }),
      },
      del: {
        desc: '删除任务（id 必填）',
        scope: { module: 'schedule', write: true },
        request: (args) => ({ method: 'DELETE', path: `/api/schedule/tasks/${Number(args.id)}` }),
      },
      batch: {
        desc: '批量操作（ids、act 必填）',
        scope: { module: 'schedule', write: true },
        request: (args) => ({ method: 'POST', path: '/api/schedule/tasks/batch', body: { ids: args.ids, act: args.act } }),
      },
      run: {
        desc: '立即执行一次定时切换（id 必填，任务必须已启用）',
        scope: { module: 'schedule', write: true },
        before: (args) => {
          requireArgs(args, ['id']);
          return args;
        },
        request: (args) => ({ method: 'POST', path: `/api/schedule/tasks/${Number(args.id)}/run` }),
      },
    },
  },
];

export default tools;
