import { query, queryOne, table } from '../../db.js';
import { decryptText } from '../../lib/secret.js';
import { getMainDomain } from '../../lib/cert/utils.js';
import { audit } from '../../lib/audit/context.js';
import { callRoute } from '../invoker.js';
import {
  int,
  str,
  arr,
  obj,
  bool,
  ids,
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
import { accountNameFromConfig, prefill } from '../helpers.js';

const need = (...keys: string[]) => (args: ToolArgs) => {
  requireArgs(args, keys);
  return args;
};

function normalizeConfig(value: any): any {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readStoredPrivateKey(raw: any): string | null {
  const value = String(raw ?? '');
  if (!value) return '';
  if (!value.toLowerCase().startsWith('enc:')) return value;
  const plain = decryptText(value);
  if (plain === null || plain.toLowerCase().startsWith('enc:')) return null;
  return plain;
}

async function orderGet(ctx: McpContext, args: ToolArgs): Promise<any> {
  const id = Number(args.id);
  // 私钥/PFX 读取必须与 UI 一致走登录密码确认：MCP 不再保留绕过确认的旧版直查分支。
  const res = await callRoute(ctx, {
    method: 'GET',
    path: `/api/cert/orders/${id}/info`,
    headers: boolValue(args.include_pfx) ? { 'x-pfx-pass': '123456' } : undefined,
  });
  if (res?.code === 0 && res.data && boolValue(args.include_pfx)) {
    delete res.data.pfx_pass;
  } else if (res?.code === 0 && res.data) {
    delete res.data.pfx;
    delete res.data.pfx_pass;
  }
  return res;
}

async function orderLog(ctx: McpContext, args: ToolArgs): Promise<any> {
  let id = Number(args.id || 0);
  if (args.processid) {
    const row: any = await queryOne(
      `SELECT id FROM ${table('cert_order')} WHERE processid = ? OR last_processid = ? ORDER BY id DESC LIMIT 1`,
      [String(args.processid), String(args.processid)],
    );
    if (!row) return { code: -1, msg: '日志文件不存在' };
    id = Number(row.id);
  }
  if (!id) throw new McpToolError('缺少必填参数：id 或 processid');
  return callRoute(ctx, { method: 'GET', path: `/api/cert/orders/${id}/log` });
}

async function orderEdit(args: ToolArgs): Promise<ToolArgs> {
  requireArgs(args, ['id']);
  const row: any = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [Number(args.id)]);
  if (!row) throw new McpToolError('证书订单不存在');
  if (args.aid === undefined || args.aid === null || args.aid === '') args.aid = Number(row.aid) === 0 ? -1 : Number(row.aid);
  if (Number(args.aid) === -1) {
    if (args.fullchain === undefined) args.fullchain = row.fullchain;
    if (args.privatekey === undefined) args.privatekey = readStoredPrivateKey(row.privatekey);
  } else {
    if (args.keytype === undefined) args.keytype = row.keytype;
    if (args.keysize === undefined) args.keysize = row.keysize;
    if (args.domains === undefined) {
      const rows: any[] = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [Number(args.id)]);
      args.domains = rows.map((r) => r.domain);
    }
  }
  return args;
}

async function orderBatch(ctx: McpContext, args: ToolArgs): Promise<any> {
  const list = Array.isArray(args.ids) ? args.ids.map(Number).filter((n: number) => n > 0) : [];
  const act = String(args.act || '');
  if (!list.length || !act) throw new McpToolError('缺少必填参数：ids、act');
  let success = 0;
  const errors: string[] = [];
  for (const id of list) {
    let res: any;
    if (act === 'delete') res = await callRoute(ctx, { method: 'DELETE', path: `/api/cert/orders/${id}` });
    else if (act === 'reset') res = await callRoute(ctx, { method: 'POST', path: `/api/cert/orders/${id}/reset` });
    else if (act === 'open' || act === 'close') {
      res = await callRoute(ctx, { method: 'POST', path: `/api/cert/orders/${id}/setauto`, body: { isauto: act === 'open' } });
    } else {
      throw new McpToolError('act 参数无效');
    }
    if (res?.code === 0) success++;
    else if (errors.length < 5) errors.push(String(res?.msg || id));
  }
  return { code: 0, msg: `成功操作${success}个证书订单`, data: errors.length ? { errors } : undefined };
}

async function deployList(ctx: McpContext, args: ToolArgs): Promise<any> {
  const res = await callRoute(ctx, {
    method: 'GET',
    path: '/api/deploy/tasks',
    query: {
      offset: args.offset,
      limit: args.limit,
      status: args.status,
      oid: args.oid,
      aid: args.aid,
      type: args.type,
      domain: args.domain,
      remark: args.remark,
      sortName: args.sortName,
      sortOrder: args.sortOrder,
    },
  });
  return listResponse(res);
}

async function deployLog(ctx: McpContext, args: ToolArgs): Promise<any> {
  let id = Number(args.id || 0);
  if (args.processid) {
    const row: any = await queryOne(
      `SELECT id FROM ${table('cert_deploy')} WHERE processid = ? OR last_processid = ? ORDER BY id DESC LIMIT 1`,
      [String(args.processid), String(args.processid)],
    );
    if (!row) return { code: -1, msg: '日志文件不存在' };
    id = Number(row.id);
  }
  if (!id) throw new McpToolError('缺少必填参数：id 或 processid');
  return callRoute(ctx, { method: 'GET', path: `/api/deploy/tasks/${id}/logs` });
}

async function deployProcess(ctx: McpContext, args: ToolArgs): Promise<any> {
  const id = Number(args.id);
  if (boolValue(args.reset)) {
    const reset = await callRoute(ctx, { method: 'POST', path: `/api/deploy/tasks/${id}/reset` });
    if (reset?.code !== 0) return reset;
  }
  return callRoute(ctx, { method: 'POST', path: `/api/deploy/tasks/${id}/process` });
}

async function deployBatch(ctx: McpContext, args: ToolArgs): Promise<any> {
  const list = Array.isArray(args.ids) ? args.ids.map(Number).filter((n: number) => n > 0) : [];
  const act = String(args.act || '');
  if (!list.length || !act) throw new McpToolError('缺少必填参数：ids、act');
  let success = 0;
  const errors: string[] = [];
  for (const id of list) {
    let res: any;
    if (act === 'delete') res = await callRoute(ctx, { method: 'DELETE', path: `/api/deploy/tasks/${id}` });
    else if (act === 'reset') res = await callRoute(ctx, { method: 'POST', path: `/api/deploy/tasks/${id}/reset` });
    else if (act === 'open' || act === 'close') {
      res = await callRoute(ctx, { method: 'POST', path: `/api/deploy/tasks/${id}/setactive`, body: { active: act === 'open' } });
    } else if (act === 'cert') {
      const row: any = await queryOne(`SELECT * FROM ${table('cert_deploy')} WHERE id = ?`, [id]);
      if (!row) res = { code: -1, msg: '部署任务不存在' };
      else {
        res = await callRoute(ctx, {
          method: 'PUT',
          path: `/api/deploy/tasks/${id}`,
          body: { aid: row.aid, oid: args.certid, config: {}, remark: row.remark },
        });
      }
    } else {
      throw new McpToolError('act 参数无效');
    }
    if (res?.code === 0) success++;
    else if (errors.length < 5) errors.push(String(res?.msg || id));
  }
  return { code: 0, msg: `成功操作${success}个部署任务`, data: errors.length ? { errors } : undefined };
}

async function cnameHost(domain: string): Promise<string> {
  const main = await getMainDomain(domain);
  if (main === domain) return '_acme-challenge';
  return '_acme-challenge.' + domain.slice(0, -(main.length + 1));
}

async function cnameList(ctx: McpContext, args: ToolArgs): Promise<any> {
  const res = await callRoute(ctx, {
    method: 'GET',
    path: '/api/cert/cnames',
    query: {
      offset: args.offset,
      size: args.limit,
      kw: args.kw,
      sortName: args.sortName,
      sortOrder: args.sortOrder,
    },
  });
  if (res?.code !== 0) return res;
  const rows: any[] = Array.isArray(res.data) ? res.data : [];
  return {
    total: Number(res.total ?? rows.length),
    rows: await Promise.all(
      rows.map(async (r) => ({
        ...r,
        host: await cnameHost(String(r.domain || '')),
        record: `${r.rr}.${r.cnamedomain}`,
      })),
    ),
  };
}

async function cnameEdit(ctx: McpContext, args: ToolArgs): Promise<any> {
  requireArgs(args, ['id']);
  const id = Number(args.id);
  const row: any = await queryOne(
    `SELECT A.*, C.visibility, C.owner_uid FROM ${table('cert_cname')} A
       LEFT JOIN ${table('domain')} B ON A.did = B.id LEFT JOIN ${table('account')} C ON B.aid = C.id
      WHERE A.id = ?`,
    [id],
  );
  if (!row) return { code: -1, msg: 'CNAME记录不存在' };
  if (row.visibility === 'private' && Number(row.owner_uid) !== Number(ctx.user.uid)) {
    return { code: -1, msg: 'CNAME记录不存在' };
  }
  const rr = args.rr !== undefined ? String(args.rr).trim() : String(row.rr || '');
  const did = args.did !== undefined ? Number(args.did) : Number(row.did);
  if (!rr || !did) return { code: -1, msg: '缺少必填参数：rr、did' };
  const target: any = await queryOne(
    `SELECT D.name, A.visibility, A.owner_uid FROM ${table('domain')} D
       LEFT JOIN ${table('account')} A ON D.aid = A.id WHERE D.id = ?`,
    [did],
  );
  if (!target || (target.visibility === 'private' && Number(target.owner_uid) !== Number(ctx.user.uid))) {
    return { code: -1, msg: '域名不存在或无权操作该私有账户域名' };
  }
  const dup: any = await queryOne(
    `SELECT id FROM ${table('cert_cname')} WHERE rr = ? AND did = ? AND id <> ?`,
    [rr, did, id],
  );
  if (dup) return { code: -1, msg: '已存在相同CNAME记录值' };
  const changed = String(row.rr || '') !== rr || Number(row.did) !== did;
  await query(
    `UPDATE ${table('cert_cname')} SET rr = ?, did = ?${changed ? ', status = 0' : ''} WHERE id = ?`,
    [rr, did, id],
  );
  audit(ctx.req, {
    targetType: 'cert_cname',
    targetId: id,
    targetName: String(row.domain || ''),
    summary: `修改CNAME代理 #${id}`,
    detail: { rr, did },
  });
  return { code: 0, msg: '修改成功' };
}

const tools: ToolDef[] = [
  {
    name: 'cert_account_query',
    title: '查询SSL证书/部署账户',
    description: '查询SSL证书申请账户（deploy=0）或证书自动部署账户（deploy=1）列表。',
    readOnly: true,
    properties: { deploy: int('0=SSL证书账户（默认），1=自动部署账户'), kw: str('按名称、备注或ID搜索'), ...paging() },
    actions: {
      list: {
        desc: '账户列表',
        scope: { module: 'cert' },
        defaults: { ...pagingDefaults(), deploy: 0 },
        request: (args) => ({
          method: 'GET',
          path: '/api/cert/accounts',
          query: {
            deploy: args.deploy, kw: args.kw, offset: args.offset, limit: args.limit,
            sortName: args.sortName, sortOrder: args.sortOrder,
          },
        }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'cert_account_manage',
    title: '管理SSL证书/部署账户',
    description:
      '添加、修改、删除SSL证书申请账户（deploy=0）或证书自动部署账户（deploy=1）。添加前用 list_provider_types(category=cert 或 deploy, type=xxx) 查看 config 字段。添加/修改时会自动校验账户可用性。',
    destructive: true,
    properties: {
      deploy: int('0=SSL证书账户（默认），1=自动部署账户'),
      id: int('账户ID（edit/del 必填）'),
      type: str('账户类型标识，如 letsencrypt、zerossl、btpanel、ssh（add 必填）'),
      config: obj('账户配置对象，字段见 list_provider_types 的 inputs；edit 时只需传入要修改的字段'),
      name: str('账户名称，留空默认取 config 的第一个字段值'),
      remark: str('备注'),
    },
    actions: {
      add: {
        desc: '添加账户（type、config 必填）',
        scope: { module: 'cert', write: true },
        defaults: { deploy: 0 },
        before: (args) => {
          requireArgs(args, ['type', 'config']);
          return accountNameFromConfig(args);
        },
        request: (args) => ({
          method: 'POST',
          path: '/api/cert/accounts',
          body: { deploy: args.deploy, type: args.type, name: args.name, config: normalizeConfig(args.config), remark: args.remark },
        }),
      },
      edit: {
        desc: '修改账户（id 必填，未传字段保持不变）',
        scope: { module: 'cert', write: true },
        before: async (args) => {
          await prefill('cert_account', args, ['type', 'name', 'remark', 'deploy']);
          if (args.config === undefined) args.config = {};
          args.config = normalizeConfig(args.config);
          return args;
        },
        request: (args) => ({
          method: 'PUT',
          path: `/api/cert/accounts/${Number(args.id)}`,
          body: { deploy: args.deploy, type: args.type, name: args.name, config: args.config, remark: args.remark },
        }),
      },
      del: {
        desc: '删除账户（id 必填）',
        scope: { module: 'cert', write: true },
        request: (args) => ({ method: 'DELETE', path: `/api/cert/accounts/${Number(args.id)}` }),
      },
    },
  },
  {
    name: 'cert_order_query',
    title: '查询SSL证书订单',
    description: '查询SSL证书订单列表、证书内容（证书链与私钥）、申请过程日志。',
    readOnly: true,
    properties: {
      id: int('证书订单ID（get 必填；list 可按ID筛选）'),
      domain: str('list：按绑定域名搜索'),
      aid: int('list：按证书账户ID筛选'),
      type: str('list：按证书账户类型筛选，如 letsencrypt'),
      status: str('list：状态筛选，0=待提交，1=待验证，2=验证中，3=已签发，4=已吊销，5=失败，6=7天内到期，7=已过期'),
      include_pfx: bool('get：是否同时返回 base64 编码的 PFX 证书（密码 123456），默认否'),
      processid: str('show_log：处理过程ID（取自订单的 processid 字段）'),
      ...paging(),
    },
    actions: {
      list: {
        desc: '证书订单列表',
        scope: { module: 'cert' },
        defaults: pagingDefaults(),
        request: (args) => ({
          method: 'GET',
          path: '/api/cert/orders',
          query: {
            id: args.id, domain: args.domain, aid: args.aid, type: args.type, status: args.status,
            offset: args.offset, limit: args.limit, sortName: args.sortName, sortOrder: args.sortOrder,
          },
        }),
        after: (data) => listResponse(data),
      },
      get: {
        desc: '获取证书内容（crt 证书链、key 私钥、到期时间、域名）',
        scope: { module: 'cert' },
        handler: (args, ctx) => orderGet(ctx, args),
      },
      show_log: {
        desc: '查看证书申请过程日志',
        scope: { module: 'cert' },
        handler: (args, ctx) => orderLog(ctx, args),
      },
    },
  },
  {
    name: 'cert_order_manage',
    title: '管理SSL证书订单',
    description:
      "添加、修改、删除SSL证书订单，执行证书申请、重置、吊销等操作。\n添加自动申请订单：aid=证书账户ID，domains=域名列表，keytype=RSA 或 ECC，keysize：RSA 为 2048/3072，ECC 为 256/384。添加后调用 process 开始申请。\n上传已有证书（手动续期）：aid=-1，fullchain=证书链PEM，privatekey=私钥PEM。",
    destructive: true,
    properties: {
      id: int('证书订单ID'),
      ids: ids('batch：订单ID列表'),
      aid: int('证书账户ID，-1 表示上传已有证书'),
      domains: arr('绑定域名列表，支持通配符，如 ["example.com", "*.example.com"]'),
      keytype: str('密钥类型', ['RSA', 'ECC']),
      keysize: str('密钥长度', ['2048', '3072', '256', '384']),
      fullchain: str('aid=-1：证书链PEM'),
      privatekey: str('aid=-1：私钥PEM'),
      isauto: bool('set_auto：是否自动续期'),
      reset: bool('process：是否先重置订单再重新申请'),
      act: str('batch：操作类型', ['delete', 'reset', 'open', 'close']),
    },
    actions: {
      add: {
        desc: '添加证书订单（aid 必填）',
        scope: { module: 'cert', write: true },
        defaults: { keytype: 'RSA', keysize: '2048' },
        request: (args) => ({
          method: 'POST',
          path: '/api/cert/orders?defer=1',
          body: {
            aid: args.aid,
            domains: args.domains,
            keytype: args.keytype,
            keysize: args.keysize,
            fullchain: args.fullchain,
            privatekey: args.privatekey,
          },
        }),
      },
      edit: {
        desc: '修改证书订单（id 必填，未传字段保持不变）',
        scope: { module: 'cert', write: true },
        before: (args) => orderEdit(args),
        request: (args) => ({
          method: 'PUT',
          path: `/api/cert/orders/${Number(args.id)}`,
          body: {
            aid: args.aid,
            domains: args.domains,
            keytype: args.keytype,
            keysize: args.keysize,
            fullchain: args.fullchain,
            privatekey: args.privatekey,
          },
        }),
      },
      del: {
        desc: '删除证书订单（id 必填，关联了部署任务时无法删除）',
        scope: { module: 'cert', write: true },
        request: (args) => ({ method: 'DELETE', path: `/api/cert/orders/${Number(args.id)}` }),
      },
      process: {
        desc: '执行证书申请/验证流程（id 必填，可能耗时较长）',
        scope: { module: 'cert', write: true },
        request: (args) => ({
          method: 'POST',
          path: `/api/cert/orders/${Number(args.id)}/process`,
          body: { reset: boolValue(args.reset) ? 1 : 0 },
        }),
      },
      set_auto: {
        desc: '设置是否自动续期（id、isauto 必填）',
        scope: { module: 'cert', write: true },
        request: (args) => ({
          method: 'POST',
          path: `/api/cert/orders/${Number(args.id)}/setauto`,
          body: { isauto: boolValue(args.isauto) },
        }),
      },
      reset: {
        desc: '重置订单状态以便重新申请（id 必填）',
        scope: { module: 'cert', write: true },
        request: (args) => ({ method: 'POST', path: `/api/cert/orders/${Number(args.id)}/reset` }),
      },
      revoke: {
        desc: '吊销证书（id 必填，不可恢复）',
        scope: { module: 'cert', write: true },
        request: (args) => ({ method: 'POST', path: `/api/cert/orders/${Number(args.id)}/revoke` }),
      },
      batch: {
        desc: '批量操作（ids、act 必填）',
        scope: { module: 'cert', write: true },
        handler: (args, ctx) => orderBatch(ctx, args),
      },
      batch_process: {
        desc: '批量推进证书申请/验证（ids 必填，最多100个，创建异步任务）',
        scope: { module: 'cert', write: true },
        before: need('ids'),
        request: (args) => ({
          method: 'POST',
          path: '/api/cert/orders/batch/process',
          body: { ids: args.ids },
        }),
      },
    },
  },
  {
    name: 'cert_deploy_query',
    title: '查询证书部署任务',
    description: '查询SSL证书自动部署任务列表和部署过程日志。',
    readOnly: true,
    properties: {
      oid: int('list：按证书订单ID筛选'),
      domain: str('list：按证书绑定域名搜索'),
      aid: int('list：按部署账户ID筛选'),
      type: str('list：按部署账户类型筛选，如 btpanel'),
      status: str('list：状态筛选，0=待处理，1=成功，-1=失败'),
      remark: str('list：按备注精确筛选'),
      processid: str('show_log：处理过程ID（取自任务的 processid 字段）'),
      ...paging(),
    },
    actions: {
      list: {
        desc: '部署任务列表',
        scope: { module: 'deploy' },
        defaults: pagingDefaults(),
        handler: (args, ctx) => deployList(ctx, args),
      },
      show_log: {
        desc: '查看部署过程日志',
        scope: { module: 'deploy' },
        handler: (args, ctx) => deployLog(ctx, args),
      },
    },
  },
  {
    name: 'cert_deploy_manage',
    title: '管理证书部署任务',
    description:
      '添加、修改、删除、启停、执行SSL证书自动部署任务。config 字段为部署目标的任务参数，见 list_provider_types(category=deploy, type=部署账户类型) 返回的 taskinputs。',
    destructive: true,
    properties: {
      id: int('任务ID'),
      ids: ids('batch：任务ID列表'),
      aid: int('自动部署账户ID'),
      oid: int('证书订单ID'),
      config: obj('部署任务配置对象（taskinputs 字段）；edit 时只需传入要修改的字段'),
      remark: str('备注'),
      active: bool('set_active：是否启用'),
      reset: bool('process：是否先重置任务再执行'),
      act: str('batch：操作类型，cert=批量更换关联证书（需 certid）', ['delete', 'reset', 'open', 'close', 'cert']),
      certid: int('batch(cert)：新的证书订单ID'),
    },
    actions: {
      add: {
        desc: '添加部署任务（aid、oid、config 必填）',
        scope: { module: 'deploy', write: true },
        request: (args) => ({
          method: 'POST',
          path: '/api/deploy/tasks',
          body: { aid: args.aid, oid: args.oid, config: normalizeConfig(args.config), remark: args.remark },
        }),
      },
      edit: {
        desc: '修改部署任务（id 必填，未传字段保持不变）',
        scope: { module: 'deploy', write: true },
        before: async (args) => {
          await prefill('cert_deploy', args, ['aid', 'oid', 'remark']);
          if (args.config === undefined) args.config = {};
          args.config = normalizeConfig(args.config);
          return args;
        },
        request: (args) => ({
          method: 'PUT',
          path: `/api/deploy/tasks/${Number(args.id)}`,
          body: { aid: args.aid, oid: args.oid, config: args.config, remark: args.remark },
        }),
      },
      del: {
        desc: '删除部署任务（id 必填）',
        scope: { module: 'deploy', write: true },
        request: (args) => ({ method: 'DELETE', path: `/api/deploy/tasks/${Number(args.id)}` }),
      },
      set_active: {
        desc: '启用或停用部署任务（id、active 必填）',
        scope: { module: 'deploy', write: true },
        request: (args) => ({
          method: 'POST',
          path: `/api/deploy/tasks/${Number(args.id)}/setactive`,
          body: { active: boolValue(args.active) },
        }),
      },
      reset: {
        desc: '重置部署任务状态（id 必填）',
        scope: { module: 'deploy', write: true },
        request: (args) => ({ method: 'POST', path: `/api/deploy/tasks/${Number(args.id)}/reset` }),
      },
      process: {
        desc: '立即执行部署（id 必填，可能耗时较长）',
        scope: { module: 'deploy', write: true },
        handler: (args, ctx) => deployProcess(ctx, args),
      },
      batch: {
        desc: '批量操作（ids、act 必填）',
        scope: { module: 'deploy', write: true },
        handler: (args, ctx) => deployBatch(ctx, args),
      },
      batch_process: {
        desc: '批量执行证书部署（ids 必填，最多100个，创建异步任务）',
        scope: { module: 'deploy', write: true },
        before: need('ids'),
        request: (args) => ({
          method: 'POST',
          path: '/api/deploy/tasks/batch/process',
          body: { ids: args.ids },
        }),
      },
    },
  },
  {
    name: 'cert_cname_query',
    title: '查询CNAME代理',
    description: '查询ACME证书验证用的CNAME代理列表（将 _acme-challenge 委派到系统内域名）。',
    readOnly: true,
    properties: { kw: str('按域名搜索'), ...paging() },
    actions: {
      list: {
        desc: 'CNAME代理列表（host 为需添加CNAME的主机记录，record 为CNAME目标）',
        scope: { module: 'cert' },
        defaults: pagingDefaults(),
        handler: (args, ctx) => cnameList(ctx, args),
      },
    },
  },
  {
    name: 'cert_cname_manage',
    title: '管理CNAME代理',
    description: '添加、修改、删除、检测ACME证书验证用的CNAME代理。',
    destructive: true,
    properties: {
      id: int('CNAME代理ID'),
      domain: str('add：被代理的域名'),
      rr: str('代理记录的主机记录'),
      did: int('代理记录所在的域名ID（系统内）'),
    },
    actions: {
      add: {
        desc: '添加CNAME代理（domain、rr、did 必填）',
        scope: { module: 'cert', write: true },
        request: (args) => ({ method: 'POST', path: '/api/cert/cnames', body: { domain: args.domain, rr: args.rr, did: args.did } }),
      },
      edit: {
        desc: '修改CNAME代理（id 必填）',
        scope: { module: 'cert', write: true },
        handler: (args, ctx) => cnameEdit(ctx, args),
      },
      del: {
        desc: '删除CNAME代理（id 必填）',
        scope: { module: 'cert', write: true },
        request: (args) => ({ method: 'DELETE', path: `/api/cert/cnames/${Number(args.id)}` }),
      },
      check: {
        desc: '检测CNAME记录是否已生效（id 必填）',
        scope: { module: 'cert', write: true },
        request: (args) => ({ method: 'POST', path: `/api/cert/cnames/${Number(args.id)}/check` }),
      },
    },
  },
];

export default tools;
