import { randomUUID } from 'node:crypto';
import { domainNameNorm } from '../../lib/domainNorm.js';
import { query, queryOne, table } from '../../db.js';
import { md5, sameDomain, matchPermission, checkLevel } from '../../auth.js';
import { getEffectivePermissions } from '../../lib/accounts/visibility.js';
import { configGet, getSysKey } from '../../config.js';
import { dnsProviders, getDnsProvider } from '../../lib/dns/factory.js';
import { certConfig } from '../../lib/cert/factory.js';
import { deployConfig, isDeployImplemented } from '../../lib/deploy/factory.js';
import { canAccessDomainAccount, getVisibleAccount } from '../../lib/accounts/visibility.js';
import { loadAccountConfig } from '../../lib/accounts/taskConfig.js';
import { invalidateDomainNamesCache } from '../../lib/certService.js';
import { audit } from '../../lib/audit/context.js';
import { callRoute } from '../invoker.js';
import {
  boolValue,
  listResponse,
  paging,
  pagingDefaults,
  int,
  str,
  arr,
  ids,
  bool,
  obj,
  requireArgs,
  McpToolError,
  type ToolArgs,
  type ToolDef,
  type McpContext,
} from '../types.js';
import { accountNameFromConfig, prefill } from '../helpers.js';

function providerFields(item: any): string[] {
  const source = item?.config || item?.inputs || {};
  return Object.keys(source);
}

function normalizeConfig(value: any): any {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function overviewNumber(value: any): number {
  return Number(value || 0);
}

async function overviewDomains(ctx: McpContext): Promise<number> {
  if (checkLevel(ctx.user, 2)) {
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id
        WHERE (B.visibility IS NULL OR B.visibility <> 'private' OR B.owner_uid = ?)`,
      [ctx.uid],
    );
    return Number(row?.c || 0);
  }
  const perms = await getEffectivePermissions(ctx.user);
  const names = [...new Set(perms.map((p) => String(p.domain || '').trim().toLowerCase().replace(/\.$/, '')).filter(Boolean))];
  if (!names.length) return 0;
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id
      WHERE A.is_hide = 0 AND ${domainNameNorm('A')} IN (${names.map(() => '?').join(',')})
        AND (B.visibility IS NULL OR B.visibility <> 'private' OR B.owner_uid = ?)`,
    [...names, ctx.uid],
  );
  return Number(row?.c || 0);
}

async function getOverview(ctx: McpContext): Promise<any> {
  const admin = checkLevel(ctx.user, 2);
  const dmWhere = admin ? '1=1' : "(C.visibility <> 'private' OR C.owner_uid = ?)";
  const dmParams = admin ? [] : [ctx.uid];
  const certWhere = admin ? '1=1' : "(A2.visibility = 'private' AND A2.owner_uid = ?)";
  const certParams = admin ? [] : [ctx.uid];
  const domains = await overviewDomains(ctx);
  const [tasks, certs, deploys, dmActive, dm0, dm1, optActive, opt1, opt2, cert3, cert5, cert6, cert7, dep0, dep1, depM1] =
    await Promise.all([
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('dmtask')} A
           JOIN ${table('domain')} B ON A.did = B.id
           JOIN ${table('account')} C ON B.aid = C.id
          WHERE ${dmWhere}`,
        dmParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cert_order')} A
           LEFT JOIN ${table('cert_account')} A2 ON A.aid = A2.id
          WHERE ${certWhere}`,
        certParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cert_deploy')} A
           LEFT JOIN ${table('cert_account')} A2 ON A.aid = A2.id
          WHERE ${certWhere}`,
        certParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('dmtask')} A
           JOIN ${table('domain')} B ON A.did = B.id
           JOIN ${table('account')} C ON B.aid = C.id
          WHERE ${dmWhere} AND A.active = 1`,
        dmParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('dmtask')} A
           JOIN ${table('domain')} B ON A.did = B.id
           JOIN ${table('account')} C ON B.aid = C.id
          WHERE ${dmWhere} AND A.status = 0`,
        dmParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('dmtask')} A
           JOIN ${table('domain')} B ON A.did = B.id
           JOIN ${table('account')} C ON B.aid = C.id
          WHERE ${dmWhere} AND A.status = 1`,
        dmParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('optimizeip')} A
           JOIN ${table('domain')} B ON A.did = B.id
           JOIN ${table('account')} C ON B.aid = C.id
          WHERE ${dmWhere} AND A.active = 1`,
        dmParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('optimizeip')} A
           JOIN ${table('domain')} B ON A.did = B.id
           JOIN ${table('account')} C ON B.aid = C.id
          WHERE ${dmWhere} AND A.status = 1`,
        dmParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('optimizeip')} A
           JOIN ${table('domain')} B ON A.did = B.id
           JOIN ${table('account')} C ON B.aid = C.id
          WHERE ${dmWhere} AND A.status = 2`,
        dmParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cert_order')} A
           LEFT JOIN ${table('cert_account')} A2 ON A.aid = A2.id
          WHERE ${certWhere} AND A.status = 3`,
        certParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cert_order')} A
           LEFT JOIN ${table('cert_account')} A2 ON A.aid = A2.id
          WHERE ${certWhere} AND A.status < 0`,
        certParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cert_order')} A
           LEFT JOIN ${table('cert_account')} A2 ON A.aid = A2.id
          WHERE ${certWhere} AND A.expiretime < DATE_ADD(NOW(), INTERVAL 7 DAY) AND A.expiretime >= NOW()`,
        certParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cert_order')} A
           LEFT JOIN ${table('cert_account')} A2 ON A.aid = A2.id
          WHERE ${certWhere} AND A.expiretime < NOW()`,
        certParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cert_deploy')} A
           LEFT JOIN ${table('cert_account')} A2 ON A.aid = A2.id
          WHERE ${certWhere} AND A.status = 0`,
        certParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cert_deploy')} A
           LEFT JOIN ${table('cert_account')} A2 ON A.aid = A2.id
          WHERE ${certWhere} AND A.status = 1`,
        certParams,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cert_deploy')} A
           LEFT JOIN ${table('cert_account')} A2 ON A.aid = A2.id
          WHERE ${certWhere} AND A.status = -1`,
        certParams,
      ),
    ]);
  const runTime = await configGet('run_time', null, true);
  const runAt = runTime ? new Date(String(runTime).replace(/-/g, '/')).getTime() : 0;
  return {
    domains: overviewNumber(domains),
    tasks: overviewNumber(tasks?.c),
    certs: overviewNumber(certs?.c),
    deploys: overviewNumber(deploys?.c),
    dmonitor_state: runAt && Date.now() - runAt <= 10_000 ? 1 : 0,
    dmonitor_active: overviewNumber(dmActive?.c),
    dmonitor_status_0: overviewNumber(dm0?.c),
    dmonitor_status_1: overviewNumber(dm1?.c),
    optimizeip_active: overviewNumber(optActive?.c),
    optimizeip_status_1: overviewNumber(opt1?.c),
    optimizeip_status_2: overviewNumber(opt2?.c),
    certorder_status_3: overviewNumber(cert3?.c),
    certorder_status_5: overviewNumber(cert5?.c),
    certorder_status_6: overviewNumber(cert6?.c),
    certorder_status_7: overviewNumber(cert7?.c),
    certdeploy_status_0: overviewNumber(dep0?.c),
    certdeploy_status_1: overviewNumber(dep1?.c),
    certdeploy_status_2: overviewNumber(depM1?.c),
  };
}

async function listProviderTypes(args: ToolArgs): Promise<any> {
  const category = String(args.category || '');
  let list: Record<string, any>;
  if (category === 'dns') list = dnsProviders;
  else if (category === 'cert') list = certConfig;
  else if (category === 'deploy') list = deployConfig;
  else throw new McpToolError('category 参数无效');
  const type = String(args.type || '');
  if (type) {
    if (!list[type]) throw new McpToolError(`服务商类型不存在：${type}`);
    const info = { ...list[type] };
    delete info.icon;
    if (category === 'deploy') info.implemented = isDeployImplemented(type);
    return { code: 0, data: { type, ...info } };
  }
  const data = Object.entries(list).map(([key, item]: [string, any]) => {
    const row: any = { type: key, name: item.name };
    if (item.class !== undefined) row.class = item.class;
    if (item.desc) row.desc = item.desc;
    row.fields = providerFields(item);
    if (category === 'deploy') row.implemented = isDeployImplemented(key);
    return row;
  });
  return { code: 0, data };
}

async function dnsAccountList(ctx: McpContext, args: ToolArgs): Promise<any> {
  const res = listResponse(await callRoute(ctx, { method: 'GET', path: '/api/dns/accounts' }));
  let rows: any[] = Array.isArray(res?.rows) ? res.rows : [];
  const kw = String(args.kw || '').trim().toLowerCase();
  if (kw) {
    rows = rows.filter((r: any) => {
      return (
        String(r.name || '').toLowerCase().includes(kw) ||
        String(r.remark || '').toLowerCase().includes(kw) ||
        String(r.id || '') === kw
      );
    });
  }
  const sort = String(args.sortName || '');
  const dir = String(args.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  if (sort) {
    rows.sort((a: any, b: any) => {
      const va = sort === 'typename' ? a.type : a[sort];
      const vb = sort === 'typename' ? b.type : b[sort];
      return va === vb ? 0 : va > vb ? dir : -dir;
    });
  }
  const offset = Math.max(0, Number(args.offset ?? 0) || 0);
  const limit = Math.max(1, Math.min(500, Number(args.limit ?? 20) || 20));
  const total = rows.length;
  rows = rows.slice(offset, offset + limit).map((r: any) => {
    const meta: any = dnsProviders[r.type] || {};
    return { ...r, typename: meta.name || r.type || '未知', icon: meta.icon || '' };
  });
  return { total, rows };
}

async function domainList(ctx: McpContext, args: ToolArgs): Promise<any> {
  const admin = checkLevel(ctx.user, 2);
  const where: string[] = ["(B.visibility IS NULL OR B.visibility <> 'private' OR B.owner_uid = ?)"];
  const params: any[] = [ctx.uid];
  if (!admin) {
    const perms = await getEffectivePermissions(ctx.user);
    const names = [...new Set(perms.map((p) => String(p.domain || '').trim().toLowerCase().replace(/\.$/, '')).filter(Boolean))];
    if (!names.length) return { total: 0, rows: [] };
    where.push(`${domainNameNorm('A')} IN (${names.map(() => '?').join(',')})`);
    params.push(...names);
    where.push('A.is_hide = 0');
  }
  const id = Number(args.id || 0);
  if (id > 0) {
    where.push('A.id = ?');
    params.push(id);
  } else {
    const kw = String(args.kw || '').trim();
    if (kw) {
      where.push('(A.name LIKE ? OR A.remark LIKE ?)');
      params.push(`%${kw}%`, `%${kw}%`);
    }
  }
  if (args.aid !== undefined && args.aid !== null && args.aid !== '') {
    where.push('A.aid = ?');
    params.push(Number(args.aid));
  }
  if (args.type) {
    where.push('B.type LIKE ?');
    params.push(`%${String(args.type)}%`);
  }
  if (args.cid !== undefined && args.cid !== null && args.cid !== '') {
    where.push('A.cid = ?');
    params.push(Number(args.cid));
  }
  if (String(args.status || '') === '2') {
    where.push('A.expiretime <= NOW()');
  } else if (String(args.status || '') === '1') {
    where.push('A.expiretime <= DATE_ADD(NOW(), INTERVAL 30 DAY) AND A.expiretime > NOW()');
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const totalRow = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id${whereSql}`,
    params,
  );
  const total = Number(totalRow?.c || 0);
  const allowedSort: Record<string, string> = {
    id: 'A.id',
    name: 'A.name',
    recordcount: 'A.recordcount',
    addtime: 'A.addtime',
    regtime: 'A.regtime',
    expiretime: 'A.expiretime',
    is_notice: 'A.is_notice',
    is_hide: 'A.is_hide',
    is_sso: 'A.is_sso',
    typename: 'B.type',
    category_name: 'A.cid',
    remark: 'A.remark',
  };
  const sort = String(args.sortName || '');
  const order = allowedSort[sort] || 'A.id';
  const dir = String(args.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const offset = Math.max(0, Number(args.offset ?? 0) || 0);
  const limit = Math.max(1, Math.min(500, Number(args.limit ?? 20) || 20));
  const rows: any[] = await query(
    `SELECT A.*, B.type, B.remark AS aremark
       FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id
       ${whereSql} ORDER BY ${order} ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const cats: any[] = await query(`SELECT id, name FROM ${table('domain_category')}`);
  const catMap = Object.fromEntries(cats.map((c) => [Number(c.id), String(c.name || '')]));
  return {
    total,
    rows: rows.map((r: any) => {
      const meta: any = dnsProviders[r.type] || {};
      return {
        ...r,
        typename: meta.name || r.type || '未知',
        icon: meta.icon || '',
        category_name: catMap[Number(r.cid)] || '',
      };
    }),
  };
}

async function domainRow(ctx: McpContext, id: number): Promise<any> {
  const row: any = await queryOne(
    `SELECT A.*, B.type AS account_type, B.visibility AS account_visibility, B.owner_uid AS account_owner
       FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id WHERE A.id = ?`,
    [id],
  );
  if (!row) throw new McpToolError('域名不存在');
  if (row.account_visibility === 'private' && Number(row.account_owner) !== Number(ctx.uid)) {
    throw new McpToolError('域名不存在');
  }
  if (!checkLevel(ctx.user, 2)) {
    const perms = await getEffectivePermissions(ctx.user);
    if (!perms.some((p) => sameDomain(p.domain, row.name))) throw new McpToolError('无权限');
  }
  delete row.account_visibility;
  delete row.account_owner;
  return row;
}

async function lineList(ctx: McpContext, id: number): Promise<any[]> {
  const res = await callRoute(ctx, { method: 'GET', path: `/api/domains/${id}/lines` });
  if (res?.code !== 0) return [];
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([name, line]: [string, any]) => {
      if (line && typeof line === 'object') {
        return {
          id: String(line.id ?? line.code ?? name),
          name: String(line.name ?? name),
          parent: line.parent ?? null,
        };
      }
      return { id: String(line), name, parent: null };
    });
  }
  return [];
}

function domainMeta(type: string): any {
  const meta: any = dnsProviders[type] || {};
  return {
    ...meta,
    type,
    alias: ['aliyun', 'henet', 'powerdns', 'spaceship'].includes(type),
  };
}

async function loginUrl(ctx: McpContext, row: any): Promise<string> {
  let readonly = 0;
  if (!checkLevel(ctx.user, 2)) {
    const perms = await getEffectivePermissions(ctx.user);
    const m = matchPermission(perms, row.name, '@', { id: row.id, aid: row.aid });
    if (m < 0) throw new McpToolError('无权限：仅整域名授权可使用快捷登录');
    readonly = m === 1 ? 1 : 0;
  }
  const token = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const sysKey = await getSysKey();
  const sign = md5(String(sysKey) + row.name + timestamp + token + (readonly ? '1' : '') + sysKey);
  const proto = String(ctx.req.headers?.['x-forwarded-proto'] || ctx.req.protocol || 'http').split(',')[0].trim() || 'http';
  const host = String(ctx.req.headers?.host || '');
  const base = host ? `${proto}://${host}` : '';
  const ro = readonly ? '&ro=1' : '';
  return `${base}/quicklogin?domain=${encodeURIComponent(row.name)}&timestamp=${timestamp}&token=${encodeURIComponent(token)}${ro}&sign=${sign}`;
}

async function domainInfo(ctx: McpContext, args: ToolArgs): Promise<any> {
  const id = Number(args.id);
  const row = await domainRow(ctx, id);
  if (!row.account_type || !dnsProviders[row.account_type]) throw new McpToolError('DNS账户类型不存在或已失效');
  const [lines, quick] = await Promise.all([
    lineList(ctx, id),
    callRoute(ctx, { method: 'GET', path: `/api/domains/${id}/quickinfo` }),
  ]);
  const data: any = {
    ...row,
    config: domainMeta(String(row.account_type || '')),
    recordLine: lines,
    minTTL: Number(quick?.data?.minTTL || 1),
  };
  delete data.account_type;
  if (boolValue(args.loginurl)) data.loginurl = await loginUrl(ctx, row);
  return { code: 0, data };
}

async function domainQuickInfo(ctx: McpContext, args: ToolArgs): Promise<any> {
  const id = Number(args.id);
  const row = await domainRow(ctx, id);
  if (!row.account_type || !dnsProviders[row.account_type]) throw new McpToolError('DNS账户类型不存在或已失效');
  const meta = domainMeta(String(row.account_type || ''));
  const [lines, quick] = await Promise.all([
    lineList(ctx, id),
    callRoute(ctx, { method: 'GET', path: `/api/domains/${id}/quickinfo` }),
  ]);
  return {
    code: 0,
    data: {
      recordLine: lines,
      minTTL: Number(quick?.data?.minTTL || 1),
      weight: meta.weight ?? false,
      remark: meta.remark ?? 0,
      alias: meta.alias,
    },
  };
}

async function remoteList(ctx: McpContext, args: ToolArgs): Promise<any> {
  const aid = Number(args.aid);
  const res = await callRoute(ctx, { method: 'GET', path: `/api/dns/accounts/${aid}/pull` });
  if (res?.code !== 0) return res;
  const cloud: any[] = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.cloud) ? res.data.cloud : [];
  const localRows: any[] = await query(`SELECT name FROM ${table('domain')} WHERE aid = ?`, [aid]);
  const local = new Set(localRows.map((r) => String(r.name || '').trim().toLowerCase().replace(/\.$/, '')));
  const kw = String(args.kw || '').trim().toLowerCase();
  let rows = cloud.map((r: any) => {
    const name = String(r.Domain ?? r.name ?? r.domain ?? '');
    const domainId = r.DomainId ?? r.domainId ?? r.thirdid ?? r.id ?? '';
    const recordcount = r.RecordCount ?? r.recordcount ?? 0;
    return {
      ...r,
      Domain: name,
      DomainId: domainId,
      RecordCount: recordcount,
      disabled: local.has(name.trim().toLowerCase().replace(/\.$/, '')),
    };
  });
  if (kw) rows = rows.filter((r: any) => String(r.Domain || '').toLowerCase().includes(kw));
  const page = Math.max(1, Number(args.page ?? 1) || 1);
  const pagesize = Math.max(1, Math.min(500, Number(args.pagesize ?? 10) || 10));
  const total = rows.length;
  return { code: 0, data: { total, list: rows.slice((page - 1) * pagesize, page * pagesize) } };
}

async function categoryList(ctx: McpContext): Promise<any> {
  if (!checkLevel(ctx.user, 2)) return { code: -1, msg: '无权限' };
  const res = await callRoute(ctx, { method: 'GET', path: '/api/domains/categories' });
  if (res?.code !== 0 || !Array.isArray(res.data)) return res;
  const counts: any[] = await query(`SELECT cid, COUNT(*) AS c FROM ${table('domain')} GROUP BY cid`);
  const map = new Map(counts.map((r: any) => [Number(r.cid), Number(r.c)]));
  const data = res.data
    .sort((a: any, b: any) => Number(a.sort || 0) - Number(b.sort || 0) || Number(b.id) - Number(a.id))
    .map((r: any) => ({ ...r, domain_count: map.get(Number(r.id)) || 0 }));
  return { code: 0, data };
}

async function addDomain(ctx: McpContext, args: ToolArgs): Promise<any> {
  const aid = Number(args.aid);
  const name = String(args.name || '').trim();
  if (!aid || !name) throw new McpToolError('缺少必填参数：aid、name');
  const method = Number(args.method ?? 0);
  let thirdid = args.thirdid;
  if (method === 1) {
    const acct: any = await getVisibleAccount('account', aid, ctx.user);
    if (!acct) throw new McpToolError('账户不存在');
    const provider: any = getDnsProvider(acct.type, await loadAccountConfig(acct), name, null);
    if (!provider) throw new McpToolError('该厂商暂未支持');
    if (!(await provider.addDomain(name))) throw new McpToolError(provider.getError?.() || '添加域名失败');
    const key = name.toLowerCase().replace(/\.$/, '');
    let found: any = null;
    // 厂商创建域名后列表可能短暂延迟；失败时重试几次，避免写入手工缺失 thirdid 的域名
    for (let attempt = 0; attempt < 5 && !found; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000));
      const list: any = await provider.getDomainList(name, 1, 100).catch(() => false);
      found = list && Array.isArray(list.list)
        ? list.list.find((r: any) => String(r.name ?? r.Domain ?? r.domain ?? '').toLowerCase().replace(/\.$/, '') === key)
        : null;
    }
    if (!found) throw new McpToolError('域名已创建，但获取域名ID失败，请稍后在域名列表确认');
    thirdid = found.DomainId ?? found.domainId ?? found.thirdid ?? found.id;
    if (!thirdid) throw new McpToolError('域名已创建，但服务商未返回域名ID，请稍后在域名列表确认');
  }
  return callRoute(ctx, {
    method: 'POST',
    path: '/api/domains',
    body: { aid, domain: name, thirdid, recordcount: args.recordcount },
  });
}

async function batchAddDomain(ctx: McpContext, args: ToolArgs): Promise<any> {
  const aid = Number(args.aid);
  const domains = Array.isArray(args.domains) ? args.domains : [];
  if (!aid || !domains.length) throw new McpToolError('缺少必填参数：aid、domains');
  let success = 0;
  const errors: string[] = [];
  for (const item of domains) {
    const res = await callRoute(ctx, {
      method: 'POST',
      path: '/api/domains',
      body: { aid, domain: item?.name, thirdid: item?.id, recordcount: item?.recordcount },
    });
    if (res?.code === 0) success++;
    else if (errors.length < 5) errors.push(String(res?.msg || item?.name || ''));
  }
  return {
    code: success ? 0 : -1,
    msg: `成功添加${success}个域名${success < domains.length ? `，失败${domains.length - success}个` : ''}`,
    data: errors.length ? { errors } : undefined,
  };
}

function normalizeIds(value: any): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
    : [];
}

async function visibleDomainIds(ctx: McpContext, ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const rows: any[] = await query(
    `SELECT D.id FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id
      WHERE D.id IN (${ids.map(() => '?').join(',')})
        AND (A.visibility IS NULL OR A.visibility <> 'private' OR A.owner_uid = ?)`,
    [...ids, ctx.uid],
  );
  return rows.map((r) => Number(r.id));
}

async function refreshExpire(ctx: McpContext, args: ToolArgs): Promise<any> {
  const ids = normalizeIds(args.ids);
  if (!ids.length) throw new McpToolError('缺少必填参数：ids');
  const allowed = await visibleDomainIds(ctx, ids);
  if (allowed.length) {
    await query(`UPDATE ${table('domain')} SET checkstatus = 0 WHERE id IN (${allowed.map(() => '?').join(',')})`, allowed);
  }
  audit(ctx.req, {
    targetType: 'domain',
    summary: `提交刷新 ${allowed.length} 个域名的到期时间`,
    detail: { ids: allowed.slice(0, 50) },
  });
  return { code: 0, msg: `已提交${allowed.length}个域名，约${Math.ceil(allowed.length / 5)}分钟后刷新完成。` };
}

async function batchRemark(ctx: McpContext, args: ToolArgs): Promise<any> {
  const ids = normalizeIds(args.ids);
  if (!ids.length) throw new McpToolError('缺少必填参数：ids');
  const allowed = await visibleDomainIds(ctx, ids);
  const text = args.remark === undefined || args.remark === null ? '' : String(args.remark).trim();
  const remark = text === '' ? null : text;
  if (allowed.length) {
    await query(`UPDATE ${table('domain')} SET remark = ? WHERE id IN (${allowed.map(() => '?').join(',')})`, [
      remark,
      ...allowed,
    ]);
  }
  audit(ctx.req, {
    targetType: 'domain',
    summary: `批量修改 ${allowed.length} 个域名的备注`,
    detail: { ids: allowed.slice(0, 50), remark },
  });
  return { code: 0, msg: `成功修改${allowed.length}个域名！` };
}

async function setDomainCategory(ctx: McpContext, args: ToolArgs): Promise<any> {
  const ids = normalizeIds(args.ids);
  if (!ids.length) throw new McpToolError('缺少必填参数：ids');
  const allowed = await visibleDomainIds(ctx, ids);
  const cid = Number(args.cid || 0);
  if (allowed.length) {
    await query(`UPDATE ${table('domain')} SET cid = ? WHERE id IN (${allowed.map(() => '?').join(',')})`, [
      cid,
      ...allowed,
    ]);
  }
  audit(ctx.req, {
    targetType: 'domain',
    summary: `批量设置 ${allowed.length} 个域名的分类`,
    detail: { ids: allowed.slice(0, 50), cid },
  });
  return { code: 0, msg: `成功设置${allowed.length}个域名的分类！` };
}

async function aliasWrite(ctx: McpContext, args: ToolArgs, remove: boolean): Promise<any> {
  const id = Number(args.id);
  if (!id) throw new McpToolError('缺少必填参数：id');
  const row: any = await queryOne(
    `SELECT D.id, D.name, D.aid, D.thirdid, A.type, A.config, A.owner_uid
       FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id WHERE D.id = ?`,
    [id],
  );
  if (!row) throw new McpToolError('域名不存在');
  if (!(await canAccessDomainAccount(id, ctx.user))) throw new McpToolError('无权限');
  if (!checkLevel(ctx.user, 2)) {
    const perms = await getEffectivePermissions(ctx.user);
    const m = matchPermission(perms, row.name, '@', { id: row.id, aid: row.aid });
    if (m !== 0) throw new McpToolError('无权限');
  }
  const provider: any = getDnsProvider(row.type, await loadAccountConfig(row), row.name, row.thirdid);
  if (!provider) throw new McpToolError('DNS模块不存在');
  if (remove) {
    requireArgs(args, ['alias_id']);
    if (typeof provider.deleteDomainAlias !== 'function') throw new McpToolError('该DNS类型不支持域名别名（仅DNSPod）');
    if (!(await provider.deleteDomainAlias(String(args.alias_id)))) {
      throw new McpToolError(provider.getError?.() || '删除域名别名失败');
    }
    invalidateDomainNamesCache();
    audit(ctx.req, { targetType: 'domain', targetId: id, summary: `删除域名别名 ${args.alias_id}` });
    return { code: 0, msg: '删除域名别名成功' };
  }
  requireArgs(args, ['alias']);
  if (typeof provider.addDomainAlias !== 'function') throw new McpToolError('该DNS类型不支持域名别名（仅DNSPod）');
  if (!(await provider.addDomainAlias(String(args.alias)))) {
    throw new McpToolError(provider.getError?.() || '添加域名别名失败');
  }
  invalidateDomainNamesCache();
  audit(ctx.req, { targetType: 'domain', targetId: id, targetName: String(args.alias), summary: `添加域名别名 ${args.alias}` });
  return { code: 0, msg: '添加域名别名成功' };
}

async function deleteCategory(ctx: McpContext, args: ToolArgs): Promise<any> {
  const id = Number(args.id);
  const count = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('domain')} WHERE cid = ?`, [id]);
  if (Number(count?.c || 0) > 0) return { code: -1, msg: '分类下存在域名，无法删除' };
  return callRoute(ctx, { method: 'DELETE', path: `/api/domains/categories/${id}` });
}

const tools: ToolDef[] = [
  {
    name: 'get_overview',
    title: '系统概况',
    description: '获取系统首页统计数据：域名数量、容灾监控任务、优选IP任务、SSL证书订单与部署任务的数量和状态。',
    readOnly: true,
    actions: {
      stat: {
        desc: '获取统计数据',
        level: 1,
        scope: { module: 'general' },
        handler: (_args, ctx) => getOverview(ctx),
      },
      dashboard: {
        desc: '获取仪表盘汇总计数（域名、账户、CDN 域名）',
        level: 1,
        scope: { module: 'general' },
        request: () => ({ method: 'GET', path: '/api/dashboard/summary' }),
      },
    },
  },
  {
    name: 'list_provider_types',
    title: '服务商类型列表',
    description:
      '查询系统支持的服务商类型及其配置字段定义。添加/编辑账户或部署任务前调用，了解 config 需要填写哪些字段。\n- category=dns：DNS服务商（用于 dns_account_manage）\n- category=cert：SSL证书申请服务商（用于 cert_account_manage 的 deploy=0）\n- category=deploy：证书自动部署目标（用于 cert_account_manage 的 deploy=1，taskinputs 为 cert_deploy_manage 的 config 字段）\n不传 type 时返回类型摘要列表，传入 type 时返回该类型的完整字段定义。',
    readOnly: true,
    properties: {
      category: str('服务商类别', ['dns', 'cert', 'deploy']),
      type: str('服务商类型标识，如 aliyun、dnspod、cloudflare、letsencrypt、btpanel'),
    },
    required: ['category'],
    actions: {
      query: {
        desc: '查询服务商类型',
        scope: { module: 'general' },
        handler: (args) => listProviderTypes(args),
      },
    },
  },
  {
    name: 'dns_account_query',
    title: '查询域名账户',
    description: '查询已添加的DNS服务商账户（域名账户）列表，返回结果包含账户ID、类型、名称、配置等。',
    readOnly: true,
    properties: { kw: str('按名称或备注搜索'), ...paging() },
    actions: {
      list: {
        desc: '账户列表',
        scope: { module: 'dns' },
        defaults: pagingDefaults(),
        handler: (args, ctx) => dnsAccountList(ctx, args),
      },
    },
  },
  {
    name: 'dns_account_manage',
    title: '管理域名账户',
    description:
      '添加、修改、删除DNS服务商账户。添加前请用 list_provider_types(category=dns, type=xxx) 查看 config 字段。添加/修改时会自动校验账户可用性。',
    destructive: true,
    properties: {
      id: int('账户ID（edit/del 必填）'),
      type: str('DNS服务商类型标识，如 aliyun、dnspod、cloudflare（add 必填）'),
      config: obj('账户配置对象，字段见 list_provider_types；edit 时只需传入要修改的字段'),
      name: str('账户名称，留空默认取 config 的第一个字段值'),
      remark: str('备注'),
    },
    actions: {
      add: {
        desc: '添加账户（type、config 必填）',
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['type', 'config']);
          return accountNameFromConfig(args);
        },
        request: (args) => ({
          method: 'POST',
          path: '/api/dns/accounts',
          body: { type: args.type, name: args.name, config: normalizeConfig(args.config), remark: args.remark },
        }),
      },
      edit: {
        desc: '修改账户（id 必填，未传字段保持不变）',
        scope: { module: 'dns', write: true },
        before: async (args) => {
          await prefill('account', args, ['type', 'name', 'remark']);
          if (args.config === undefined) args.config = {};
          args.config = normalizeConfig(args.config);
          return args;
        },
        request: (args) => ({
          method: 'PUT',
          path: `/api/dns/accounts/${Number(args.id)}`,
          body: { type: args.type, name: args.name, config: args.config, remark: args.remark },
        }),
      },
      del: {
        desc: '删除账户（id 必填，账户下存在域名时无法删除）',
        scope: { module: 'dns', write: true },
        request: (args) => ({ method: 'DELETE', path: `/api/dns/accounts/${Number(args.id)}` }),
      },
    },
  },
  {
    name: 'domain_query',
    title: '查询域名',
    description: '查询系统中已添加的域名及其信息。管理解析记录前，通常先用 list 获取域名ID。',
    readOnly: true,
    properties: {
      id: int('域名ID（get/info/quickinfo/aliases 必填）'),
      kw: str('list：按域名或备注搜索；remote_list：搜索关键词'),
      aid: int('域名账户ID（list 可选筛选；remote_list 必填）'),
      type: str('list：按DNS服务商类型筛选，如 aliyun'),
      cid: int('list：按分类ID筛选'),
      status: str('list：到期状态筛选，1=30天内到期，2=已到期', ['1', '2']),
      loginurl: bool('info：是否生成该域名的单独登录链接'),
      page: int('remote_list：页码，默认1'),
      pagesize: int('remote_list：每页数量，默认10'),
      ...paging(),
    },
    actions: {
      list: {
        desc: '已添加的域名列表',
        level: 1,
        scope: { module: 'dns' },
        defaults: pagingDefaults(),
        handler: (args, ctx) => domainList(ctx, args),
      },
      get: {
        desc: '获取域名基本信息',
        level: 1,
        scope: { module: 'dns' },
        before: (args) => {
          requireArgs(args, ['id']);
          return args;
        },
        handler: async (args, ctx) => {
          const data = await domainRow(ctx, Number(args.id));
          delete data.account_type;
          return { code: 0, data };
        },
      },
      info: {
        desc: '获取域名详细信息（含DNS服务商能力、解析线路列表、最小TTL）',
        level: 1,
        scope: { module: 'dns' },
        before: (args) => {
          requireArgs(args, ['id']);
          return args;
        },
        handler: (args, ctx) => domainInfo(ctx, args),
      },
      quickinfo: {
        desc: '获取域名可用的解析线路、最小TTL、是否支持权重/备注/ALIAS',
        level: 1,
        scope: { module: 'dns' },
        before: (args) => {
          requireArgs(args, ['id']);
          return args;
        },
        handler: (args, ctx) => domainQuickInfo(ctx, args),
      },
      aliases: {
        desc: '获取域名别名列表（部分DNS服务商支持）',
        level: 1,
        scope: { module: 'dns' },
        request: (args) => ({ method: 'GET', path: `/api/domains/${Number(args.id)}/aliases` }),
      },
      remote_list: {
        desc: '从DNS服务商账户中拉取可添加的域名列表（disabled=true 表示已添加）',
        scope: { module: 'dns' },
        before: (args) => {
          requireArgs(args, ['aid']);
          return args;
        },
        handler: (args, ctx) => remoteList(ctx, args),
      },
      categories: {
        desc: '域名分类列表',
        scope: { module: 'dns' },
        handler: (_args, ctx) => categoryList(ctx),
      },
    },
  },
  {
    name: 'domain_manage',
    title: '管理域名',
    description: '添加、修改、删除系统中的域名，以及批量操作、到期时间刷新、设置分类、管理域名别名。',
    destructive: true,
    properties: {
      id: int('域名ID'),
      ids: ids('域名ID列表（批量操作）'),
      aid: int('域名账户ID（add/batch_add 必填）'),
      name: str('add：域名'),
      thirdid: str('add：域名在DNS服务商处的ID（method=0 时必填，可从 domain_query remote_list 获取）'),
      method: int('add：0=添加服务商中已存在的域名，1=在服务商中新建域名'),
      recordcount: int('add：记录数量'),
      domains: arr('batch_add：域名列表，每项为 {name, id, recordcount}，取自 domain_query remote_list 的 Domain/DomainId/RecordCount', {
        type: 'object',
        properties: {
          name: { type: 'string' },
          id: { type: 'string' },
          recordcount: { type: 'integer' },
        },
      }),
      is_hide: bool('edit：是否对普通用户隐藏'),
      is_sso: bool('edit：是否允许单独登录'),
      is_notice: bool('edit/batch_set_notice：是否开启到期提醒'),
      cid: int('edit/set_category：分类ID，0为未分类'),
      expiretime: str('edit：到期时间，格式 Y-m-d H:i:s'),
      remark: str('edit/batch_remark：备注'),
      alias: str('alias_add：别名域名'),
      alias_id: int('alias_delete：别名ID'),
    },
    actions: {
      add: {
        desc: '添加域名（aid、name 必填，method=0 时还需 thirdid）',
        scope: { module: 'dns', write: true },
        defaults: { method: 0 },
        before: (args) => {
          requireArgs(args, ['aid', 'name']);
          if (Number(args.method) === 0) requireArgs(args, ['thirdid']);
          return args;
        },
        handler: (args, ctx) => addDomain(ctx, args),
      },
      batch_add: {
        desc: '批量添加域名（aid、domains 必填）',
        scope: { module: 'dns', write: true },
        before: (args) => {
          requireArgs(args, ['aid', 'domains']);
          return args;
        },
        handler: (args, ctx) => batchAddDomain(ctx, args),
      },
      edit: {
        desc: '修改域名设置（id 必填，未传字段保持不变）',
        scope: { module: 'dns', write: true },
        before: async (args) => prefill('domain', args, ['is_hide', 'is_sso', 'is_notice', 'cid', 'expiretime', 'remark']),
        request: (args) => ({
          method: 'PUT',
          path: `/api/domains/${Number(args.id)}`,
          body: {
            is_hide: args.is_hide,
            is_sso: args.is_sso,
            is_notice: args.is_notice,
            cid: args.cid,
            expiretime: args.expiretime,
            remark: args.remark,
          },
        }),
      },
      del: {
        desc: '从系统中删除域名（仅删除本地记录，不影响DNS服务商；id 必填）',
        scope: { module: 'dns', write: true },
        request: (args) => ({ method: 'DELETE', path: `/api/domains/${Number(args.id)}` }),
      },
      batch_del: {
        desc: '批量删除域名（ids 必填）',
        scope: { module: 'dns', write: true },
        request: (args) => ({ method: 'POST', path: '/api/domains/batch-del', body: { ids: args.ids } }),
      },
      batch_remark: {
        desc: '批量修改备注（ids 必填）',
        scope: { module: 'dns', write: true },
        handler: (args, ctx) => batchRemark(ctx, args),
      },
      batch_set_notice: {
        desc: '批量设置到期提醒（ids、is_notice 必填）',
        scope: { module: 'dns', write: true },
        request: (args) => ({ method: 'POST', path: '/api/domains/batch-notice', body: { ids: args.ids, is_notice: args.is_notice } }),
      },
      refresh_expire: {
        desc: '批量提交刷新域名注册/到期时间（ids 必填，后台异步执行）',
        scope: { module: 'dns', write: true },
        handler: (args, ctx) => refreshExpire(ctx, args),
      },
      update_date: {
        desc: '立即查询并更新单个域名的注册/到期时间（id 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        request: (args) => ({ method: 'POST', path: `/api/domains/${Number(args.id)}/update-date` }),
      },
      set_category: {
        desc: '批量设置域名分类（ids、cid 必填）',
        scope: { module: 'dns', write: true },
        handler: (args, ctx) => setDomainCategory(ctx, args),
      },
      alias_add: {
        desc: '添加域名别名（id、alias 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        handler: (args, ctx) => aliasWrite(ctx, args, false),
      },
      alias_delete: {
        desc: '删除域名别名（id、alias_id 必填）',
        level: 1,
        scope: { module: 'dns', write: true },
        handler: (args, ctx) => aliasWrite(ctx, args, true),
      },
    },
  },
  {
    name: 'domain_category_manage',
    title: '管理域名分类',
    description: '添加、修改、删除域名分类。查询分类列表请用 domain_query(action=categories)。',
    destructive: true,
    properties: {
      id: int('分类ID（edit/del 必填）'),
      name: str('分类名称'),
      remark: str('备注'),
      sort: int('排序，数字越小越靠前'),
    },
    actions: {
      add: {
        desc: '添加分类（name 必填）',
        scope: { module: 'dns', write: true },
        request: (args) => ({
          method: 'POST',
          path: '/api/domains/categories',
          body: { name: args.name, remark: args.remark, sort: args.sort },
        }),
      },
      edit: {
        desc: '修改分类（id 必填）',
        scope: { module: 'dns', write: true },
        before: (args) => prefill('domain_category', args, ['name', 'remark', 'sort']),
        request: (args) => ({
          method: 'PUT',
          path: `/api/domains/categories/${Number(args.id)}`,
          body: { name: args.name, remark: args.remark, sort: args.sort },
        }),
      },
      del: {
        desc: '删除分类（id 必填，分类下有域名时无法删除）',
        scope: { module: 'dns', write: true },
        handler: (args, ctx) => deleteCategory(ctx, args),
      },
    },
  },
  {
    name: 'operation_log_query',
    title: '查询操作日志',
    description: '查询系统操作日志（解析记录增删改等）。普通用户只能看到自己的日志。',
    readOnly: true,
    properties: {
      uid: int('按用户ID筛选（仅管理员）'),
      domain: str('按域名筛选'),
      kw: str('按操作类型或内容搜索'),
      offset: int('分页偏移量，默认0'),
      limit: int('每页数量，默认20'),
    },
    actions: {
      list: {
        desc: '日志列表',
        level: 1,
        scope: { module: 'users' },
        defaults: { offset: 0, limit: 20 },
        request: (args) => ({
          method: 'GET',
          path: '/api/logs',
          query: { uid: args.uid, domain: args.domain, kw: args.kw, offset: args.offset, limit: args.limit },
        }),
        after: (data) => listResponse(data),
      },
    },
  },
];

export default tools;
