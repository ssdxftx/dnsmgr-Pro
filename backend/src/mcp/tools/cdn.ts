import { callRoute } from '../invoker.js';
import {
  arr,
  int,
  listResponse,
  obj,
  pagingDefaults,
  requireArgs,
  str,
  type McpContext,
  type ToolArgs,
  type ToolDef,
} from '../types.js';

const need = (...keys: string[]) => (args: ToolArgs) => {
  requireArgs(args, keys);
  return args;
};

function csv(value: any): any {
  return Array.isArray(value) ? value.join(',') : value;
}

function jsonText(value: any): any {
  return value && typeof value === 'object' ? JSON.stringify(value) : value;
}

async function accountList(ctx: McpContext, args: ToolArgs): Promise<any> {
  const res = await callRoute(ctx, { method: 'GET', path: '/api/cdn/accounts' });
  if (res?.code !== 0) return res;
  let rows: any[] = Array.isArray(res.data) ? res.data : [];
  const kw = String(args.kw || '').trim().toLowerCase();
  if (kw) {
    rows = rows.filter((r) => {
      return (
        String(r.name || '').toLowerCase().includes(kw) ||
        String(r.remark || '').toLowerCase().includes(kw) ||
        String(r.typename || '').toLowerCase().includes(kw) ||
        String(r.id || '') === kw
      );
    });
  }
  const offset = Math.max(0, Number(args.offset ?? 0) || 0);
  const limit = Math.max(1, Math.min(500, Number(args.limit ?? 20) || 20));
  return { total: rows.length, rows: rows.slice(offset, offset + limit) };
}

const cdnTools: ToolDef[] = [
  {
    name: 'cdn_account_query',
    title: '查询CDN账户',
    description: '查询已接入的 CDN 账户、CDN 服务商，以及账户下的站点列表。普通用户只能看到共享账户和自己创建的私有账户。',
    readOnly: true,
    properties: {
      id: int('账户ID（zones 必填）'),
      kw: str('按账户名称或备注搜索'),
      offset: int('分页偏移量，默认0'),
      limit: int('每页数量，默认20，最大500'),
    },
    actions: {
      providers: {
        desc: 'CDN 服务商类型列表',
        level: 1,
        scope: { module: 'cdn' },
        request: () => ({ method: 'GET', path: '/api/cdn/providers' }),
      },
      list: {
        desc: 'CDN 账户列表',
        level: 1,
        scope: { module: 'cdn' },
        defaults: pagingDefaults(),
        handler: (args, ctx) => accountList(ctx, args),
      },
      zones: {
        desc: '账户下可用的云端站点列表',
        level: 1,
        scope: { module: 'cdn' },
        before: need('id'),
        request: (args) => ({ method: 'GET', path: `/api/cdn/accounts/${Number(args.id)}/zones` }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'cdn_domain_query',
    title: '查询CDN加速域名',
    description:
      '查询已接入的 CDN 加速域名、详情、缓存规则、证书状态、证书候选和联动日志，也可查询切换线路的目标站点与预检结果。',
    readOnly: true,
    properties: {
      id: int('加速域名ID（get/access/cert_status/certlink_log/switch_sites/switch_check 必填）'),
      aid: int('CDN 账户ID（list/switch_sites/switch_check 使用）'),
      zone_id: str('站点ID（switch_check 必填）'),
      name: str('加速域名（cert_candidates 必填）'),
      page: int('list：页码，默认1'),
      size: int('list：每页数量，默认20，最大500'),
    },
    actions: {
      list: {
        desc: '加速域名列表（支持按账户、站点和分页）',
        level: 1,
        scope: { module: 'cdn' },
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: '/api/cdn/domains',
          query: { aid: args.aid, zone_id: args.zone_id, page: args.page, size: args.size },
        }),
        after: (data) => listResponse(data),
      },
      get: {
        desc: '加速域名详情（含回源、HTTPS、线路和缓存规则）',
        level: 1,
        scope: { module: 'cdn' },
        before: need('id'),
        request: (args) => ({ method: 'GET', path: `/api/cdn/domains/${Number(args.id)}` }),
      },
      access: {
        desc: '加速域名的访问控制配置',
        level: 1,
        scope: { module: 'cdn' },
        before: need('id'),
        request: (args) => ({ method: 'GET', path: `/api/cdn/domains/${Number(args.id)}/access` }),
      },
      switch_sites: {
        desc: '切换线路时目标账户下可用的站点',
        level: 1,
        scope: { module: 'cdn' },
        before: need('id', 'aid'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/domains/${Number(args.id)}/switch/sites`,
          query: { aid: args.aid },
        }),
      },
      switch_check: {
        desc: '切换线路预检（目标站点是否已有同名加速域名）',
        level: 1,
        scope: { module: 'cdn' },
        before: need('id', 'aid', 'zone_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/domains/${Number(args.id)}/switch/check`,
          query: { aid: args.aid, zone_id: args.zone_id },
        }),
      },
      cert_status: {
        desc: '加速域名在 CDN 云端的证书状态与项目联动摘要',
        level: 1,
        scope: { module: 'cdn' },
        before: need('id'),
        request: (args) => ({ method: 'GET', path: `/api/cdn/domains/${Number(args.id)}/cert_status` }),
      },
      cert_candidates: {
        desc: '按加速域名查找可用于证书联动的已签发证书与签发账户',
        level: 2,
        scope: { module: 'cdn' },
        before: need('name'),
        request: (args) => ({
          method: 'GET',
          path: '/api/cdn/cert/candidates',
          query: { name: args.name },
        }),
      },
      certlink_log: {
        desc: '证书联动实时进度日志',
        level: 1,
        scope: { module: 'cdn' },
        before: need('id'),
        request: (args) => ({ method: 'GET', path: `/api/cdn/domains/${Number(args.id)}/certlink/log` }),
      },
    },
  },
  {
    name: 'cdn_zone_query',
    title: '查询CDN站点',
    description:
      '查询 CDN 站点（Zone）列表、套餐实例、NS、站点属性、站点配置、自定义变量和配置导入结果。站点级配置查询要求管理员。',
    readOnly: true,
    properties: {
      aid: int('CDN 账户ID（除 zones 外的站点动作必填）'),
      zone_id: str('站点ID（ns/properties/setting/config_export/custom_variables/import_status 必填）'),
      task_id: str('配置导入任务ID（import_status 必填）'),
      types: arr('config_export：要导出的配置类型列表'),
      service_id: str('边缘推理服务ID（inference_records/inference_logs/inference_domains 必填）'),
      record_id: str('边缘推理部署记录ID（inference_logs 必填）'),
      token_id: str('边缘推理 Token ID（inference_token_del 必填）'),
      template_ids: arr('即时转码模板ID列表（transcode_del 必填）'),
      log_task_id: str('实时日志任务ID（realtime_log_edit/realtime_log_del 必填）'),
      zone_ids: str('站点ID列表，多个用逗号分隔（offline_l7/offline_l4 使用）'),
      proxy_ids: str('四层代理ID列表，多个用逗号分隔（offline_l4 使用）'),
      domains: str('加速域名列表，多个用逗号分隔（offline_l7 使用）'),
      startTime: str('离线日志开始时间，格式 YYYY-MM-DD HH:mm:ss'),
      endTime: str('离线日志结束时间，格式 YYYY-MM-DD HH:mm:ss'),
      name: str('加速域名（domain_exists 必填）'),
      type: str('配额类型，默认 file（quota_purge 使用）'),
      page: int('页码，默认1'),
      size: int('每页数量，默认20，最大200'),
      operation: str('推理服务操作类型（inference_service_operate 必填）'),
      params: obj('服务商原生参数对象（推理、转码、实时日志动作使用）'),
    },
    actions: {
      zones: {
        desc: '站点列表（不传 aid 时返回本地已接入站点的聚合）',
        level: 1,
        scope: { module: 'cdn' },
        request: (args) => ({ method: 'GET', path: '/api/cdn/zones', query: { aid: args.aid } }),
        after: (data) => listResponse(data),
      },
      sites: {
        desc: '账户下云端站点列表（含未接入任何域名的站点）',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid'),
        request: (args) => ({ method: 'GET', path: `/api/cdn/accounts/${Number(args.aid)}/sites` }),
        after: (data) => listResponse(data),
      },
      plan_instances: {
        desc: '账户下可用套餐实例（ESA 创建站点使用）',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid'),
        request: (args) => ({ method: 'GET', path: `/api/cdn/accounts/${Number(args.aid)}/plan-instances` }),
      },
      ns: {
        desc: '站点 NS 列表',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/sites/${encodeURIComponent(String(args.zone_id))}/ns`,
        }),
      },
      properties: {
        desc: '站点完整属性（接入类型、覆盖范围、自定义 NS 等）',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/sites/${encodeURIComponent(String(args.zone_id))}/properties`,
        }),
      },
      setting: {
        desc: '站点级配置',
        level: 2,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        request: (args) => ({
          method: 'GET',
          path: '/api/cdn/zones/setting',
          query: { aid: args.aid, zone_id: args.zone_id },
        }),
      },
      config_export: {
        desc: '导出站点配置',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/sites/${encodeURIComponent(String(args.zone_id))}/config/export`,
          query: { types: csv(args.types) },
        }),
      },
      import_status: {
        desc: '查询站点配置导入结果',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id', 'task_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/sites/${encodeURIComponent(String(args.zone_id))}/config/import/${encodeURIComponent(String(args.task_id))}`,
        }),
      },
      custom_variables: {
        desc: '站点级自定义变量',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/sites/${encodeURIComponent(String(args.zone_id))}/custom-variables`,
        }),
      },
      inference_services: {
        desc: '边缘推理服务列表',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/inference/services`,
          query: { zoneId: args.zone_id, page: args.page, size: args.size },
        }),
        after: (data) => listResponse(data),
      },
      inference_records: {
        desc: '边缘推理服务部署记录',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id', 'service_id'),
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/inference/services/${encodeURIComponent(String(args.service_id))}/records`,
          query: { zoneId: args.zone_id, page: args.page, size: args.size },
        }),
        after: (data) => listResponse(data),
      },
      inference_logs: {
        desc: '边缘推理部署记录日志',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id', 'service_id', 'record_id'),
        defaults: { page: 1, size: 100 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/inference/services/${encodeURIComponent(String(args.service_id))}/records/${encodeURIComponent(String(args.record_id))}/logs`,
          query: { zoneId: args.zone_id, page: args.page, size: args.size },
        }),
        after: (data) => listResponse(data),
      },
      inference_monitor: {
        desc: '边缘推理监控数据（POST 查询，需 cdn:write）',
        level: 1,
        scope: { module: 'cdn', write: true },
        before: need('aid', 'zone_id'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cdn/accounts/${Number(args.aid)}/inference/monitor`,
          body: { zoneId: args.zone_id, params: args.params || {} },
        }),
      },
      inference_tokens: {
        desc: '边缘推理 API Token 列表',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/inference/tokens`,
          query: { zoneId: args.zone_id, page: args.page, size: args.size },
        }),
        after: (data) => listResponse(data),
      },
      inference_domains: {
        desc: '边缘推理服务域名列表',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id', 'service_id'),
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/inference/domains`,
          query: { zoneId: args.zone_id, serviceId: args.service_id, page: args.page, size: args.size },
        }),
        after: (data) => listResponse(data),
      },
      inference_hardware: {
        desc: '边缘推理硬件规格',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/inference/hardware`,
          query: { zoneId: args.zone_id },
        }),
      },
      transcode_templates: {
        desc: '即时转码模板列表',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/media/transcode-templates`,
          query: { zoneId: args.zone_id, page: args.page, size: args.size },
        }),
        after: (data) => listResponse(data),
      },
      realtime_logs: {
        desc: '实时日志任务列表',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        defaults: { page: 1, size: 100 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/logs/realtime`,
          query: { zoneId: args.zone_id, page: args.page, size: args.size },
        }),
        after: (data) => listResponse(data),
      },
      offline_l7: {
        desc: '七层离线日志',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid'),
        defaults: { limit: 20, offset: 0 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/logs/offline/l7`,
          query: {
            zoneIds: args.zone_ids, domains: args.domains, startTime: args.startTime,
            endTime: args.endTime, limit: args.limit, offset: args.offset,
          },
        }),
      },
      offline_l4: {
        desc: '四层离线日志',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid'),
        defaults: { limit: 20, offset: 0 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/logs/offline/l4`,
          query: {
            zoneIds: args.zone_ids, proxyIds: args.proxy_ids, startTime: args.startTime,
            endTime: args.endTime, limit: args.limit, offset: args.offset,
          },
        }),
      },
      quota_content: {
        desc: '内容配额',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/quota/content`,
          query: { zoneId: args.zone_id },
        }),
      },
      quota_purge: {
        desc: '刷新配额',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/quota/purge`,
          query: { zoneId: args.zone_id, type: args.type || 'file' },
        }),
      },
      domain_exists: {
        desc: '检查加速域名是否已接入（本地或云端）',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'name'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/domains/exists`,
          query: { name: args.name },
        }),
      },
    },
  },
  {
    name: 'cdn_cache_query',
    title: '查询CDN缓存任务',
    description: '查询 CDN 刷新/预热历史、任务详情、定时预热任务、刷新任务、预热任务和预热回源限速配置。仅管理员可用。',
    readOnly: true,
    properties: {
      id: int('任务记录ID（task_detail 必填）'),
      aid: int('CDN 账户ID（purge_tasks/prefetch_tasks/prefetch_origin_limit 必填）'),
      zone_id: str('站点ID（prefetch_origin_limit 必填）'),
      page: int('页码，默认1'),
      size: int('每页数量，默认20'),
    },
    actions: {
      tasks: {
        desc: '刷新/预热历史记录',
        level: 2,
        scope: { module: 'cdn' },
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: '/api/cdn/cache-tasks',
          query: { page: args.page, size: args.size },
        }),
        after: (data) => listResponse(data),
      },
      task_detail: {
        desc: '刷新/预热任务记录详情',
        level: 2,
        scope: { module: 'cdn' },
        before: need('id'),
        request: (args) => ({ method: 'GET', path: `/api/cdn/cache-tasks/${Number(args.id)}` }),
      },
      preheat_tasks: {
        desc: '定时预热/刷新任务列表',
        level: 2,
        scope: { module: 'cdn' },
        request: () => ({ method: 'GET', path: '/api/cdn/preheat-tasks' }),
        after: (data) => listResponse(data),
      },
      purge_tasks: {
        desc: '云端刷新任务列表',
        level: 2,
        scope: { module: 'cdn' },
        before: need('aid'),
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/tasks/purge`,
          query: { zoneId: args.zone_id, page: args.page, size: args.size },
        }),
      },
      prefetch_tasks: {
        desc: '云端预热任务列表',
        level: 2,
        scope: { module: 'cdn' },
        before: need('aid'),
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/tasks/prefetch`,
          query: { zoneId: args.zone_id, page: args.page, size: args.size },
        }),
      },
      prefetch_origin_limit: {
        desc: '预热回源限速配置',
        level: 2,
        scope: { module: 'cdn' },
        before: need('aid', 'zone_id'),
        defaults: { page: 1, size: 20 },
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/cache/prefetch-origin-limit`,
          query: { zoneId: args.zone_id, page: args.page, size: args.size },
        }),
      },
    },
  },
  {
    name: 'cdn_statistics_query',
    title: '查询CDN统计',
    description:
      '查询 CDN 统计概览、详情、时序、Top、缓存命中、DDoS 事件、四层时序和 IP 归属。普通用户仅能读取已开启的统计缓存，且不支持筛选。',
    readOnly: true,
    properties: {
      startTime: str('开始时间，格式 YYYY-MM-DD HH:mm:ss'),
      endTime: str('结束时间，格式 YYYY-MM-DD HH:mm:ss'),
      aid: int('CDN 账户ID'),
      route: str('服务商类型，如 eo、esa'),
      domains: str('按加速域名筛选，多个用逗号分隔'),
      zoneIds: str('站点ID列表，多个用逗号分隔'),
      zone_id: str('站点ID（ip_region 使用）'),
      groups: str('统计指标组，多个用逗号分隔'),
      filters: obj('统计筛选对象，如 {"domain":["a.example.com"]}'),
      top: str('Top 维度，多个用逗号分隔'),
      type: str('统计类型', ['Resource', 'Visits', 'HttpCodeStatus', 'All']),
      metricName: str('Top/DDoS 指标名'),
      metricNames: str('时序指标名，多个用逗号分隔'),
      interval: str('四层时序间隔，默认 hour'),
      ips: str('IP 归属查询，多个用逗号分隔'),
      limit: int('返回数量上限'),
    },
    actions: {
      overview: {
        desc: '按服务商聚合的统计概览',
        level: 1,
        scope: { module: 'cdn' },
        before: need('startTime', 'endTime'),
        request: (args) => ({
          method: 'GET',
          path: '/api/cdn/statistics/overview',
          query: { startTime: args.startTime, endTime: args.endTime, aid: args.aid, route: args.route },
        }),
      },
      detail: {
        desc: '按服务商能力目录返回统计详情（序列与 Top 表）',
        level: 1,
        scope: { module: 'cdn' },
        before: need('route', 'startTime', 'endTime'),
        request: (args) => ({
          method: 'GET',
          path: '/api/cdn/statistics/detail',
          query: {
            route: args.route,
            startTime: args.startTime,
            endTime: args.endTime,
            aid: args.aid,
            domains: csv(args.domains),
            groups: csv(args.groups),
            filters: jsonText(args.filters),
            top: csv(args.top),
          },
        }),
      },
      series: {
        desc: '加速流量、带宽、请求数、缓存命中和状态码时序',
        level: 1,
        scope: { module: 'cdn' },
        before: need('startTime', 'endTime'),
        request: (args) => ({
          method: 'GET',
          path: '/api/cdn/statistics',
          query: {
            type: args.type,
            startTime: args.startTime,
            endTime: args.endTime,
            aid: args.aid,
            domains: csv(args.domains),
          },
        }),
      },
      top: {
        desc: 'Top 分析',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'startTime', 'endTime'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/analysis/top`,
          query: {
            zoneIds: csv(args.zoneIds),
            startTime: args.startTime,
            endTime: args.endTime,
            metricName: args.metricName,
            limit: args.limit,
          },
        }),
      },
      timing_cache: {
        desc: '缓存命中时序',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'startTime', 'endTime'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/analysis/timing-cache`,
          query: {
            zoneIds: csv(args.zoneIds),
            startTime: args.startTime,
            endTime: args.endTime,
            metricNames: csv(args.metricNames),
          },
        }),
      },
      ddos_events: {
        desc: 'DDoS 攻击事件',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'startTime', 'endTime'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/analysis/ddos/events`,
          query: {
            zoneIds: csv(args.zoneIds),
            startTime: args.startTime,
            endTime: args.endTime,
            limit: args.limit,
          },
        }),
      },
      ddos_top: {
        desc: 'DDoS Top 分析',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'startTime', 'endTime'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/analysis/ddos/top`,
          query: {
            zoneIds: csv(args.zoneIds),
            startTime: args.startTime,
            endTime: args.endTime,
            metricName: args.metricName,
            limit: args.limit,
          },
        }),
      },
      l4_timing: {
        desc: '四层流量时序',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'startTime', 'endTime'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/analysis/l4-timing`,
          query: {
            zoneIds: csv(args.zoneIds),
            startTime: args.startTime,
            endTime: args.endTime,
            metricNames: csv(args.metricNames),
            interval: args.interval,
          },
        }),
      },
      ip_region: {
        desc: '查询 IP 归属',
        level: 1,
        scope: { module: 'cdn' },
        before: need('aid', 'ips'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cdn/accounts/${Number(args.aid)}/diagnostics/ip-region`,
          query: { zoneId: args.zone_id, ips: csv(args.ips) },
        }),
      },
    },
  },
];

export default cdnTools;