import { callRoute } from '../invoker.js';
import {
  int,
  str,
  arr,
  obj,
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
import { normalizeRecords, pagingToPage } from '../helpers.js';
import { queryOne, table } from '../../db.js';
import { defaultRecordLine } from '../../lib/dns/defaultLine.js';

const recordObject = {
  type: 'object',
  description: '解析记录对象（取自 record_query list 的返回），需包含 RecordId、Name、Type、Value、Line、TTL、MX、Weight、Remark',
  properties: {
    RecordId: { type: 'string' },
    Name: { type: 'string' },
    Type: { type: 'string' },
    Value: { type: 'string' },
    Line: { type: 'string' },
    TTL: { type: 'integer' },
  },
  required: ['RecordId'],
};

function parseRecordInfo(value: any): ToolArgs {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

async function subdomainRecords(ctx: McpContext, args: ToolArgs): Promise<any> {
  requireArgs(args, ['domain_id', 'rr']);
  const res = await callRoute(ctx, {
    method: 'GET',
    path: `/api/domains/${Number(args.domain_id)}/records`,
    query: { page: 1, pagesize: 100, subdomain: args.rr },
  });
  if (res?.code !== 0) return res;
  const data = res.data;
  const rows = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
  const filtered =
    String(args.rr) === '@'
      ? rows.filter((r: any) => !['NS', 'SOA'].includes(String(r?.Type || '').toUpperCase()))
      : rows;
  return { code: 0, data: filtered };
}

async function searchRecords(ctx: McpContext, args: ToolArgs): Promise<any> {
  requireArgs(args, ['keyword']);
  return callRoute(ctx, {
    method: 'GET',
    path: '/api/records/search',
    query: { kw: args.keyword },
  });
}

async function recordGroups(ctx: McpContext, args: ToolArgs): Promise<any> {
  const res = await callRoute(ctx, {
    method: 'GET',
    path: `/api/domains/${Number(args.domain_id)}/groups`,
  });
  if (res?.code !== 0 || !Array.isArray(res.data)) return res;
  const acct: any = await queryOne(
    `SELECT B.type FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id WHERE A.id = ?`,
    [Number(args.domain_id)],
  );
  if (String(acct?.type || '') === 'dnspod') {
    res.data.unshift({ id: '', name: '全部记录' });
  }
  return res;
}

async function checkRecord(ctx: McpContext, args: ToolArgs): Promise<any> {
  requireArgs(args, ['domain_id', 'name', 'type']);
  let value = args.value;
  if ((value === undefined || value === null || value === '') && args.recordid) {
    const res = await callRoute(ctx, {
      method: 'GET',
      path: `/api/domains/${Number(args.domain_id)}/records`,
      query: { page: 1, pagesize: 500, subdomain: args.name },
    });
    const rows = Array.isArray(res?.data?.list) ? res.data.list : Array.isArray(res?.data) ? res.data : [];
    const hit = rows.find((r: any) => String(r.RecordId) === String(args.recordid));
    if (hit) value = Array.isArray(hit.Value) ? hit.Value.join(',') : hit.Value;
  }
  if (value === undefined || value === null || value === '') throw new McpToolError('缺少必填参数：value');
  return callRoute(ctx, {
    method: 'POST',
    path: `/api/domains/${Number(args.domain_id)}/records/check`,
    body: { name: args.name, type: args.type, value },
  });
}

function fillFromRecordInfo(args: ToolArgs): ToolArgs {
  const info = parseRecordInfo(args.recordinfo);
  const map: Record<string, string> = {
    name: 'Name',
    type: 'Type',
    value: 'Value',
    line: 'Line',
    ttl: 'TTL',
    mx: 'MX',
    weight: 'Weight',
    remark: 'Remark',
  };
  for (const [key, source] of Object.entries(map)) {
    if ((args[key] === undefined || args[key] === null || args[key] === '') && info[source] !== undefined) {
      args[key] = info[source];
    }
  }
  if ((args.recordid === undefined || args.recordid === null || args.recordid === '') && info.RecordId !== undefined) {
    args.recordid = info.RecordId;
  }
  return args;
}

async function editByName(ctx: McpContext, args: ToolArgs): Promise<any> {
  requireArgs(args, ['domain_id', 'name', 'type', 'value']);
  const res = await callRoute(ctx, {
    method: 'GET',
    path: `/api/domains/${Number(args.domain_id)}/records`,
    query: { page: 1, pagesize: 500, subdomain: args.name },
  });
  if (res?.code !== 0) return res;
  const rows = Array.isArray(res?.data?.list) ? res.data.list : Array.isArray(res?.data) ? res.data : [];
  const wanted = String(args.type || '').toUpperCase();
  const sameName = rows.filter((r: any) => String(r.Name) === String(args.name));
  let records = sameName.filter((r: any) => String(r.Type).toUpperCase() === wanted);
  // 与原项目一致：A/AAAA/CNAME 互为兼容类型，找不到精确类型时回退到这三类
  if (!records.length && ['A', 'AAAA', 'CNAME'].includes(wanted)) {
    records = sameName.filter((r: any) => ['A', 'AAAA', 'CNAME'].includes(String(r.Type).toUpperCase()));
  }
  if (String(args.name) === '@') {
    records = records.filter((r: any) => !['NS', 'SOA'].includes(String(r.Type).toUpperCase()));
  }
  if (!records.length) return { code: -1, msg: `没有可修改的${args.type}记录` };
  const acct: any = await queryOne(
    `SELECT B.type FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id WHERE A.id = ?`,
    [Number(args.domain_id)],
  );
  const line = defaultRecordLine(String(acct?.type || ''));
  if (line !== undefined) {
    const onDefault = records.filter((r: any) => String(r.Line ?? '') === line);
    if (onDefault.length) records = onDefault;
  }
  const ttl = Number(args.ttl || 0);
  const mx = Number(args.mx || 0);
  if (ttl > 0 || mx > 0) {
    records = records.map((r: any) => ({
      ...r,
      ...(ttl > 0 ? { TTL: ttl } : {}),
      ...(mx > 0 ? { MX: mx } : {}),
    }));
  }
  return callRoute(ctx, {
    method: 'POST',
    path: `/api/domains/${Number(args.domain_id)}/records/batch`,
    body: { action: 'value', type: args.type, value: args.value, records },
  });
}

function requireDomainId(args: ToolArgs): ToolArgs {
  requireArgs(args, ['domain_id']);
  return args;
}

const tools: ToolDef[] = [
  {
    name: 'record_query',
    title: '查询解析记录',
    description:
      '查询某个域名的DNS解析记录、解析日志、记录分组、权重配置，或检测解析是否生效；也可按关键词跨域名搜索解析记录。domain_id 为系统内的域名ID（可通过 domain_query list 获取），除 search 外的动作必填。',
    readOnly: true,
    properties: {
      domain_id: int('域名ID（search 外的动作必填）'),
      keyword: str('list/weight_list：关键词搜索；search：跨域名模糊匹配主机记录、完整子域名或备注'),
      subdomain: str('list：按主机记录精确筛选，如 www、@'),
      value: str('list：按记录值筛选；check：期望的记录值'),
      type: str('list：按记录类型筛选；check：记录类型，如 A、CNAME'),
      line: str('list：按线路ID筛选'),
      status: str('list：按状态筛选，1=启用，0=暂停', ['0', '1']),
      rr: str('subdomain：主机记录，如 www、@'),
      recordid: str('check：解析记录ID'),
      name: str('check：主机记录'),
      ...paging(),
    },
    actions: {
      list: {
        desc: '解析记录列表（支持分页和筛选）',
        level: 1,
        scope: { module: 'dns' },
        defaults: pagingDefaults(),
        before: requireDomainId,
        request: (args) => {
          const { page, pagesize } = pagingToPage(args, 20);
          return {
            method: 'GET',
            path: `/api/domains/${Number(args.domain_id)}/records`,
            query: {
              page,
              pagesize,
              keyword: args.keyword,
              subdomain: args.subdomain,
              value: args.value,
              type: args.type,
              line: args.line,
              status: args.status,
              sortName: args.sortName,
              sortOrder: args.sortOrder,
            },
          };
        },
        after: (data) => listResponse(data),
      },
      search: {
        desc: '跨域名搜索解析记录（keyword 必填，匹配主机记录、完整子域名或备注，最多返回 200 条）',
        level: 1,
        scope: { module: 'dns', path: '/api/records' },
        handler: (args, ctx) => searchRecords(ctx, args),
        after: (data) => listResponse(data),
      },
      subdomain: {
        desc: '获取指定主机记录（rr）下的全部解析记录',
        level: 1,
        scope: { module: 'dns' },
        handler: (args, ctx) => subdomainRecords(ctx, args),
      },
      log: {
        desc: 'DNS服务商侧的解析操作日志（部分服务商支持）',
        level: 1,
        scope: { module: 'dns' },
        defaults: pagingDefaults(),
        before: requireDomainId,
        request: (args) => {
          const { page, pagesize } = pagingToPage(args, 20);
          return {
            method: 'GET',
            path: `/api/domains/${Number(args.domain_id)}/recordlog`,
            query: { page, pagesize },
          };
        },
        after: (data) => listResponse(data),
      },
      groups: {
        desc: '解析记录分组列表（仅阿里云、腾讯云）',
        level: 1,
        scope: { module: 'dns' },
        before: requireDomainId,
        handler: (args, ctx) => recordGroups(ctx, args),
      },
      check: {
        desc: '检测解析记录是否已生效（recordid、name、type、value 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        handler: (args, ctx) => checkRecord(ctx, args),
      },
      weight_list: {
        desc: '权重配置的子域名列表（仅阿里云）',
        level: 1,
        scope: { module: 'dns' },
        defaults: pagingDefaults(),
        before: requireDomainId,
        request: (args) => {
          const { pagesize } = pagingToPage(args, 20);
          return {
            method: 'GET',
            path: `/api/domains/${Number(args.domain_id)}/weight`,
            query: { subdomain: args.keyword, pagesize, offset: args.offset },
          };
        },
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'record_manage',
    title: '管理解析记录',
    description:
      "添加、修改、删除、启用/暂停DNS解析记录，以及批量操作和权重设置。domain_id 为系统内的域名ID。\n线路 line 使用 domain_query(action=quickinfo) 返回的线路 id，留空为默认线路。修改/删除前请先用 record_query 获取 RecordId。",
    destructive: true,
    properties: {
      domain_id: int('域名ID'),
      recordid: str('解析记录ID（update/delete/set_status/set_remark 必填）'),
      name: str('主机记录，如 www、@、*（add/update/edit_by_name 必填）'),
      type: str('记录类型，如 A、AAAA、CNAME、MX、TXT、NS、SRV、CAA'),
      value: str('记录值'),
      line: str('线路ID'),
      ttl: int('TTL，默认600'),
      mx: int('MX优先级，默认1'),
      weight: int('add/update：权重值'),
      weights: obj('weight_update：各记录权重，键为记录ID，值为权重，如 {"123": 10, "456": 20}'),
      remark: str('备注'),
      status: str('set_status：1=启用，0=暂停；weight_status/weight_update：1=开启权重，0=关闭', ['0', '1']),
      recordinfo: obj('update/delete/set_status：可选，原记录对象，用于生成更详细的操作日志'),
      records: arr('batch/batch_edit：要操作的记录对象数组', recordObject),
      batch_action: str('batch：批量操作类型，open=启用，pause=暂停，delete=删除，remark=修改备注，group=修改分组', [
        'open',
        'pause',
        'delete',
        'remark',
        'group',
      ]),
      groupid: str('batch(group)：分组ID'),
      edit_type: str('batch_edit：value=批量修改记录值（需 type、value），line=批量修改线路（需 line）', ['value', 'line']),
      record: str('batch_add：批量记录文本，每行一条，格式为“主机记录 记录值”，如\nwww 1.2.3.4\napi 5.6.7.8'),
      proxy: bool('batch_add：Cloudflare 是否开启代理（未指定 line 时生效）'),
      subdomain: str('weight_status/weight_update：子域名主机记录'),
    },
    required: ['domain_id'],
    actions: {
      add: {
        desc: '添加解析记录（name、type、value 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['name', 'type', 'value']);
          if (args.ttl === undefined || args.ttl === null || args.ttl === '') args.ttl = 600;
          if (args.mx === undefined || args.mx === null || args.mx === '') args.mx = 1;
          if (args.weight === undefined || args.weight === null || args.weight === '') args.weight = 0;
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: `/api/domains/${Number(args.domain_id)}/records`,
          body: {
            name: args.name,
            type: args.type,
            value: args.value,
            line: args.line,
            ttl: args.ttl,
            mx: args.mx,
            weight: args.weight,
            remark: args.remark,
          },
        }),
      },
      update: {
        desc: '修改解析记录（recordid、name、type、value 必填，line/ttl 等需传入完整值）',
        level: 1,
        scope: { module: 'dns', write: true },
        before: (args) => {
          fillFromRecordInfo(args);
          requireArgs(args, ['recordid', 'name', 'type', 'value']);
          if (args.ttl === undefined || args.ttl === null || args.ttl === '') args.ttl = 600;
          if (args.mx === undefined || args.mx === null || args.mx === '') args.mx = 1;
          if (args.weight === undefined || args.weight === null || args.weight === '') args.weight = 0;
          return args;
        },
        request: (args) => ({
          method: 'PUT',
          path: `/api/domains/${Number(args.domain_id)}/records/${encodeURIComponent(String(args.recordid))}`,
          body: {
            name: args.name,
            type: args.type,
            value: args.value,
            line: args.line,
            ttl: args.ttl,
            mx: args.mx,
            weight: args.weight,
            remark: args.remark,
          },
        }),
      },
      delete: {
        desc: '删除解析记录（recordid 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['recordid']);
          return args;
        },
        request: (args) => ({
          method: 'DELETE',
          path: `/api/domains/${Number(args.domain_id)}/records/${encodeURIComponent(String(args.recordid))}`,
        }),
      },
      set_status: {
        desc: '启用或暂停解析记录（recordid、status 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['recordid', 'status']);
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: `/api/domains/${Number(args.domain_id)}/records/${encodeURIComponent(String(args.recordid))}/status`,
          body: { status: args.status },
        }),
      },
      set_remark: {
        desc: '修改解析记录备注（recordid 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['recordid']);
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: `/api/domains/${Number(args.domain_id)}/records/${encodeURIComponent(String(args.recordid))}/remark`,
          body: { remark: args.remark },
        }),
      },
      batch: {
        desc: '批量启用/暂停/删除/修改备注/修改分组（records、batch_action 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['batch_action', 'records']);
          args.records = normalizeRecords(args.records);
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: `/api/domains/${Number(args.domain_id)}/records/batch`,
          body: { action: args.batch_action, records: args.records, remark: args.remark, groupid: args.groupid },
        }),
      },
      batch_edit: {
        desc: '批量修改记录值或线路（records、edit_type 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['edit_type', 'records']);
          args.records = normalizeRecords(args.records);
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: `/api/domains/${Number(args.domain_id)}/records/batch`,
          body: { action: args.edit_type, records: args.records, type: args.type, value: args.value, line: args.line },
        }),
      },
      batch_add: {
        desc: '批量添加解析记录（record 必填；type 留空时根据记录值自动识别 A/AAAA/CNAME）',
        level: 1,
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['record']);
          if (args.ttl === undefined || args.ttl === null || args.ttl === '') args.ttl = 600;
          if (args.mx === undefined || args.mx === null || args.mx === '') args.mx = 1;
          return args;
        },
        request: (args) => ({
          method: 'POST',
          path: `/api/domains/${Number(args.domain_id)}/records/batch-add`,
          body: {
            record: args.record,
            type: args.type,
            line: args.line,
            proxy: boolValue(args.proxy) ? 1 : 0,
            ttl: args.ttl,
            mx: args.mx,
            remark: args.remark,
          },
        }),
      },
      edit_by_name: {
        desc: '按主机记录修改：将 name 下默认线路的同类型记录值统一改为 value（name、type、value 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['name', 'type', 'value']);
          return args;
        },
        handler: (args, ctx) => editByName(ctx, args),
      },
      weight_status: {
        desc: '开启或关闭子域名的权重配置（subdomain、status、type、line 必填，仅阿里云）',
        level: 1,
        scope: { module: 'dns', write: true },
        request: (args) => ({
          method: 'POST',
          path: `/api/domains/${Number(args.domain_id)}/weight`,
          body: { act: 'status', subdomain: args.subdomain, status: args.status, type: args.type, line: args.line },
        }),
      },
      weight_update: {
        desc: '设置子域名下各记录的权重（subdomain、status、type、line 必填，status=1 时需 weights，仅阿里云）',
        level: 1,
        scope: { module: 'dns', write: true },
        request: (args) => ({
          method: 'POST',
          path: `/api/domains/${Number(args.domain_id)}/weight`,
          body: { act: 'update', subdomain: args.subdomain, status: args.status, type: args.type, line: args.line, weight: args.weights },
        }),
      },
    },
  },
];

export default tools;
