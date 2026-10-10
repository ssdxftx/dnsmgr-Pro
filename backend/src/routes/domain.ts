import type { FastifyInstance } from 'fastify';
import net from 'node:net';
import { query, queryOne, table } from '../db.js';
import { getDnsProvider } from '../lib/dns/factory.js';
import { getUserPermissions, matchPermission, isRecordInScope, checkLevel, type SubPermission } from '../auth.js';
import { localResolve, recordValueMatches } from '../lib/dns/localResolve.js';
import { decryptConfig } from '../lib/secret.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

// 兼容历史明文与新版加密存储的账户配置
function safeJson(s: any): Record<string, any> {
  if (s && typeof s === 'object') return s as Record<string, any>;
  return decryptConfig(s) || {};
}

const allRecordsCache = new Map<string, { at: number; list: any[] }>();
const RECORDS_TTL = 60_000;

/** 拉取某域名全部解析记录（带 60s 内存缓存），用于统计子域名记录数 */
async function fetchAllRecords(d: any): Promise<any[]> {
  const cached = allRecordsCache.get(d.name);
  if (cached && Date.now() - cached.at < RECORDS_TTL) return cached.list;
  let list: any[] = [];
  const acct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [d.aid]);
  if (acct) {
    const provider = getDnsProvider(acct.type, safeJson(acct.config), d.name, d.thirdid);
    if (provider) {
      for (let page = 1; page <= 10; page++) {
        const r = await provider.getDomainRecords(page, 500, null, null, null, null, null, null);
        if (r === false || !r.list || !r.list.length) break;
        list = list.concat(r.list);
        if (list.length >= (r.total || 0)) break;
      }
    }
  }
  allRecordsCache.set(d.name, { at: Date.now(), list });
  return list;
}

async function getUserPerms(req: any): Promise<{ admin: boolean; perms: SubPermission[] }> {
  if (Number(req.user?.level ?? 0) >= 2) return { admin: true, perms: [] };
  return { admin: false, perms: await getUserPermissions(req.user.uid) };
}

/** 写操作权限校验，返回错误信息；为空表示允许 */
function writeErr(acc: { admin: boolean; perms: SubPermission[] }, domainName: string, recordName: string): string | null {
  if (acc.admin) return null;
  const m = matchPermission(acc.perms, domainName, String(recordName ?? ''));
  if (m < 0) return '无权限操作该子域名';
  if (m === 1) return '该子域名仅查看，禁止修改';
  return null;
}

/** 普通用户记录列表过滤：只保留授权子域名树内的记录 */
function filterRecords(acc: { admin: boolean; perms: SubPermission[] }, domainName: string, list: any[]): any[] {
  if (acc.admin) return list;
  const subs = new Set<string>();
  let full = false;
  for (const p of acc.perms) {
    if (p.domain !== domainName) continue;
    if (!p.sub) {
      full = true;
      break;
    }
    subs.add(p.sub);
  }
  if (full) return list;
  return list.filter((r: any) => {
    for (const s of subs) if (isRecordInScope(r.Name, s)) return true;
    return false;
  });
}

/** 返回当前用户对某域名的访问信息，供前端控制写操作按钮 */
function buildAccess(acc: { admin: boolean; perms: SubPermission[] }, domainName: string) {
  if (acc.admin) return { admin: true, readonly: false, writable: true, subs: [] };
  const mine = acc.perms.filter((p) => p.domain === domainName);
  const writable = mine.some((p) => p.readonly !== 1);
  return { admin: false, readonly: !writable, writable, subs: mine.map((p) => p.sub).filter(Boolean) };
}

async function getDomainWithAccount(domainId: number) {
  const d = await queryOne(`SELECT * FROM ${table('domain')} WHERE id = ?`, [domainId]);
  if (!d) return null;
  const acct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [d.aid]);
  if (!acct) return null;
  return { domain: d, account: acct };
}

export default async function domainRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // ============ 域名管理 ============
  app.get('/api/domains', auth, async (req: any) => {
    const acc = await getUserPerms(req);
    const kw = String(req.query?.kw || '').trim();
    const rows = await query(
      `SELECT A.*, B.type AS account_type, B.name AS account_name FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id ORDER BY A.id DESC`,
    );
    const categories = await query(`SELECT id, name FROM ${table('domain_category')} ORDER BY sort ASC`);
    const catMap = Object.fromEntries(categories.map((c: any) => [c.id, c.name]));
    let data = rows.map((r: any) => ({ ...r, category_name: catMap[r.cid] || '' }));
    if (!acc.admin) {
      const byName = new Map(data.map((r: any) => [r.name, r]));
      const out: any[] = [];
      for (const p of acc.perms) {
        const d: any = byName.get(p.domain);
        if (!d) continue;
        const all = await fetchAllRecords(d);
        const cnt = p.sub ? all.filter((r: any) => isRecordInScope(r.Name, p.sub)).length : (all.length || Number(d.recordcount || 0));
        out.push({
          ...d,
          recordcount: cnt,
          expiretime: p.expiretime || d.expiretime || null,
          checkstatus: p.expiretime ? 1 : d.checkstatus,
          _key: `${d.id}:${p.sub || ''}`,
          _sub: p.sub || '',
          _readonly: Number(p.readonly || 0),
          _base_name: d.name,
          name: p.sub ? `${p.sub}.${d.name}` : d.name,
        });
      }
      data = out;
    }

    // 关键词搜索：仅匹配本地数据（主域名 / 备注 / 别名子域名）；
    // 子域名（解析记录）匹配由 /api/records/search 负责，避免在此重复拉取云端记录
    if (kw) {
      const k = kw.toLowerCase();
      const aliasRows: any[] = await query(`SELECT did, name FROM ${table('domain_alias')}`);
      const aliasMap = new Map<number, string[]>();
      for (const a of aliasRows) {
        const arr = aliasMap.get(Number(a.did)) || [];
        arr.push(String(a.name || '').toLowerCase());
        aliasMap.set(Number(a.did), arr);
      }
      const baseNameOf = (d: any) => String(d._base_name || d.name || '').toLowerCase();

      const localHits: any[] = [];
      for (const d of data) {
        const base = baseNameOf(d);
        const hit =
          base.includes(k) ||
          String(d.name || '').toLowerCase().includes(k) ||
          String(d.remark || '').toLowerCase().includes(k) ||
          (aliasMap.get(Number(d.id)) || []).some((name) => name.includes(k));
        if (hit) localHits.push(d);
      }
      data = localHits.sort((a: any, b: any) => Number(b.id) - Number(a.id));
    }
    return { code: 0, data };
  });

  // 解析记录搜索：按主机记录（子域名）或备注跨域模糊检索，返回可编辑的解析记录条目
  // 供「域名列表」搜索在本地无命中时原地展示记录卡片
  app.get('/api/records/search', auth, async (req: any) => {
    const acc = await getUserPerms(req);
    const kw = String(req.query?.kw || '').trim().toLowerCase();
    if (!kw) return { code: 0, data: [] };
    const rows = await query(
      `SELECT A.* FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id ORDER BY A.id DESC`,
    );
    let targets = rows as any[];
    if (!acc.admin) {
      const byName = new Map(targets.map((r: any) => [r.name, r]));
      const uniq = new Map<string, any>();
      for (const p of acc.perms) {
        const d = byName.get(p.domain);
        if (d) uniq.set(d.name, d);
      }
      targets = Array.from(uniq.values());
    }
    const out: any[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const d = targets[cursor++];
        try {
          const list = await fetchAllRecords(d);
          for (const r of list || []) {
            const n = String(r?.Name ?? '').toLowerCase();
            const full = n === '@' ? String(d.name).toLowerCase() : `${n}.${String(d.name).toLowerCase()}`;
            const remark = String(r?.Remark ?? '').toLowerCase();
            // 模糊匹配：主机记录 / 完整子域名 / 解析记录备注
            if (!n.includes(kw) && !full.includes(kw) && !remark.includes(kw)) continue;
            if (acc.admin) {
              out.push({ ...r, did: d.id, Domain: d.name, _writable: true });
            } else {
              const m = matchPermission(acc.perms, d.name, r.Name);
              if (m < 0) continue;
              out.push({ ...r, did: d.id, Domain: d.name, _writable: m === 0 });
            }
          }
        } catch {
          // 单个域名记录拉取失败忽略
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, targets.length) }, worker));
    return { code: 0, data: out.slice(0, 200) };
  });

  app.get('/api/domains/categories', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const rows = await query(`SELECT * FROM ${table('domain_category')} ORDER BY sort ASC, id ASC`);
    return { code: 0, data: rows };
  });

  app.post('/api/domains/categories', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const { name, remark } = req.body || {};
    if (!name) return { code: -1, msg: '分类名不能为空' };
    await query(`INSERT INTO ${table('domain_category')} (name, remark, sort, addtime) VALUES (?, ?, 0, NOW())`, [name, remark || '']);
    return { code: 0, msg: '添加分类成功' };
  });

  // 从 DNS 账户拉取云端域名列表（用于添加）
  app.get('/api/dns/accounts/:aid/pull', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const { aid } = req.params as any;
    const acct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [aid]);
    if (!acct) return { code: -1, msg: '账户不存在' };
    const provider = getDnsProvider(acct.type, safeJson(acct.config), '', null);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const res = await provider.getDomainList(null, 1, 100);
    if (res === false) return { code: -1, msg: provider.getError() };
    return { code: 0, data: res.list };
  });

  // 导入域名
  app.post('/api/domains', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const { aid, domain, thirdid, recordcount } = req.body || {};
    if (!aid || !domain) return { code: -1, msg: '参数不完整' };
    const exists = await queryOne(`SELECT id FROM ${table('domain')} WHERE name = ?`, [domain]);
    if (exists) return { code: -1, msg: '域名已存在' };
    const acct = await queryOne(`SELECT type FROM ${table('account')} WHERE id = ?`, [aid]);
    if (!acct) return { code: -1, msg: '账户不存在' };
    const id = await query(`INSERT INTO ${table('domain')} (aid, name, thirdid, recordcount, addtime) VALUES (?, ?, ?, ?, NOW())`, [
      aid, domain, thirdid || '', recordcount || 0,
    ]).then((r: any) => r.insertId || 0);
    return { code: 0, msg: '添加域名成功', data: id };
  });

  app.delete('/api/domains/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    // 与源项目一致：删除域名时级联清理别名与关联任务，避免残留任务引用已删除域名
    await query(`DELETE FROM ${table('domain')} WHERE id = ?`, [id]);
    await query(`DELETE FROM ${table('domain_alias')} WHERE did = ?`, [id]);
    await query(`DELETE FROM ${table('dmtask')} WHERE did = ?`, [id]);
    await query(`DELETE FROM ${table('optimizeip')} WHERE did = ?`, [id]);
    await query(`DELETE FROM ${table('sctask')} WHERE did = ?`, [id]);
    await query(`DELETE FROM ${table('dns_check_task')} WHERE did = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  // 编辑域名属性（备注/分类/隐藏/单点登录/到期提醒/到期时间）
  app.put('/api/domains/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number((req.params as any).id);
    const row = await queryOne(`SELECT id FROM ${table('domain')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '域名不存在' };
    const b = req.body || {};
    const upd: Record<string, any> = {};
    const boolField = (k: string) => (Number(b[k]) ? 1 : 0);
    if ('remark' in b) upd.remark = String(b.remark ?? '');
    if ('cid' in b) upd.cid = Number(b.cid || 0);
    if ('is_hide' in b) upd.is_hide = boolField('is_hide');
    if ('is_sso' in b) upd.is_sso = boolField('is_sso');
    if ('is_notice' in b) upd.is_notice = boolField('is_notice');
    if ('expiretime' in b) upd.expiretime = b.expiretime ? String(b.expiretime) : null;
    const cols = Object.keys(upd);
    if (!cols.length) return { code: 0, msg: '无改动' };
    const fields = cols.map((k) => `${k} = ?`).join(', ');
    await query(`UPDATE ${table('domain')} SET ${fields} WHERE id = ?`, [...cols.map((k) => upd[k]), id]);
    return { code: 0, msg: '修改成功' };
  });

  // 批量删除域名（级联清理别名与关联任务）
  app.post('/api/domains/batch-del', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const ids: number[] = Array.isArray((req.body || {}).ids)
      ? (req.body.ids as any[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (!ids.length) return { code: -1, msg: '请选择域名' };
    const ph = ids.map(() => '?').join(',');
    await query(`DELETE FROM ${table('domain')} WHERE id IN (${ph})`, ids);
    await query(`DELETE FROM ${table('domain_alias')} WHERE did IN (${ph})`, ids);
    await query(`DELETE FROM ${table('dmtask')} WHERE did IN (${ph})`, ids);
    await query(`DELETE FROM ${table('optimizeip')} WHERE did IN (${ph})`, ids);
    await query(`DELETE FROM ${table('sctask')} WHERE did IN (${ph})`, ids);
    await query(`DELETE FROM ${table('dns_check_task')} WHERE did IN (${ph})`, ids);
    return { code: 0, msg: '已删除 ' + ids.length + ' 个域名' };
  });

  // ============ 解析记录 ============
  app.get('/api/domains/:id/records', auth, async (req: any) => {
    const { id } = req.params as any;
    const q = req.query || {};
    const acc = await getUserPerms(req);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const res = await provider.getDomainRecords(
      Number(q.page || 1),
      Number(q.pagesize || 20),
      q.keyword || null,
      q.subdomain || null,
      q.value || null,
      q.type || null,
      q.line || null,
      q.status || null,
    );
    if (res === false) return { code: -1, msg: provider.getError() };
    if (!acc.admin) {
      res.list = filterRecords(acc, info.domain.name, res.list);
    }
    (res as any)._access = buildAccess(acc, info.domain.name);
    return { code: 0, data: res };
  });

  // 本地解析检测（单条记录），返回 active/not_found/mismatch
  app.post('/api/domains/:id/records/check', auth, async (req: any) => {
    const { id } = req.params as any;
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const acc = await getUserPerms(req);
    const b = req.body || {};
    const name = String(b.name ?? '').trim();
    const type = String(b.type ?? '').trim();
    const rawValue = Array.isArray(b.value) ? b.value[0] : b.value;
    if (!name || !type || rawValue === undefined || rawValue === null || rawValue === '') {
      return { code: -1, msg: '参数不能为空' };
    }
    const supported = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'SRV', 'CAA', 'PTR', 'LOC', 'LUA'];
    if (!supported.includes(type)) return { code: -1, msg: '该记录类型暂不支持检测' };
    if (!acc.admin) {
      const m = matchPermission(acc.perms, info.domain.name, name);
      if (m < 0) return { code: -1, msg: '无权限操作该子域名' };
    }
    const fullDomain = (name === '@' ? info.domain.name : `${name}.${info.domain.name}`).toLowerCase();
    const actual = await localResolve(fullDomain, type);
    if (!actual.length) {
      return { code: 0, data: { status: 'not_found', message: '未查询到该解析记录', actual: [] } };
    }
    const expected = String(rawValue);
    if (recordValueMatches(expected, actual)) {
      return { code: 0, data: { status: 'active', actual } };
    }
    return { code: 0, data: { status: 'mismatch', expected: String(rawValue).trim().toLowerCase().replace(/\.+$/, ''), actual } };
  });

  app.get('/api/domains/:id/lines', auth, async (req: any) => {
    const { id } = req.params as any;
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const acc = await getUserPerms(req);
    if (!acc.admin && !acc.perms.some((p) => p.domain === info.domain.name)) {
      return { code: -1, msg: '无权限查看该域名' };
    }
    const provider = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const lines = await provider.getRecordLine();
    if (lines === false) return { code: -1, msg: provider.getError() };
    return { code: 0, data: lines };
  });

  app.post('/api/domains/:id/records', auth, async (req: any) => {
    const { id } = req.params as any;
    const { name, type, value, line, ttl, mx, weight, remark } = req.body || {};
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    {
      const acc = await getUserPerms(req);
      const err = writeErr(acc, info.domain.name, name);
      if (err) return { code: -1, msg: err };
    }
    const recordId = await provider.addDomainRecord(name, type, value, line || 'default', Number(ttl || 600), Number(mx || 1), weight ?? null, remark || null);
    if (!recordId) return { code: -1, msg: provider.getError() };
    if (remark && typeof (provider as any).updateDomainRecordRemark === 'function') {
      await (provider as any).updateDomainRecordRemark(recordId, remark);
    }
    await bumpRecordCount(id, 1);
    return { code: 0, msg: '添加记录成功', data: recordId };
  });

  app.post('/api/domains/:id/records/:recordId/remark', auth, async (req: any) => {
    const { id, recordId } = req.params as any;
    const remark = (req.body || {}).remark ?? null;
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    {
      const acc = await getUserPerms(req);
      if (!acc.admin) {
        const cur = await provider.getDomainRecordInfo(recordId);
        if (!cur) return { code: -1, msg: '无权限操作该记录' };
        const err = writeErr(acc, info.domain.name, cur.Name);
        if (err) return { code: -1, msg: err };
      }
    }
    if (typeof provider.updateDomainRecordRemark === 'function') {
      const ok = await provider.updateDomainRecordRemark(recordId, remark);
      if (!ok) return { code: -1, msg: provider.getError() };
      return { code: 0, msg: '备注修改成功' };
    }
    const cur = await provider.getDomainRecordInfo(recordId);
    if (!cur) return { code: -1, msg: provider.getError?.() || '获取记录信息失败' };
    const ok = await provider.updateDomainRecord(recordId, cur.Name, cur.Type, cur.Value, cur.Line, cur.TTL, cur.MX, cur.Weight, remark);
    if (!ok) return { code: -1, msg: provider.getError?.() || '备注修改失败' };
    return { code: 0, msg: '备注修改成功' };
  });

  app.put('/api/domains/:id/records/:recordId', auth, async (req: any) => {
    const { id, recordId } = req.params as any;
    const { name, type, value, line, ttl, mx, weight, remark } = req.body || {};
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    {
      const acc = await getUserPerms(req);
      if (!acc.admin) {
        const cur = await (provider as any).getDomainRecordInfo(recordId);
        if (!cur) return { code: -1, msg: '无权限操作该记录' };
        let e = writeErr(acc, info.domain.name, cur.Name);
        if (e) return { code: -1, msg: e };
        e = writeErr(acc, info.domain.name, name);
        if (e) return { code: -1, msg: '新记录超出授权子域名范围' };
      }
    }
    const ok = await provider.updateDomainRecord(recordId, name, type, value, line || 'default', Number(ttl || 600), Number(mx || 1), weight ?? null, remark || null);
    if (!ok) return { code: -1, msg: provider.getError() };
    return { code: 0, msg: '修改记录成功' };
  });

  app.delete('/api/domains/:id/records/:recordId', auth, async (req: any) => {
    const { id, recordId } = req.params as any;
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    {
      const acc = await getUserPerms(req);
      if (!acc.admin) {
        const cur = await (provider as any).getDomainRecordInfo(recordId);
        if (!cur) return { code: -1, msg: '无权限操作该记录' };
        const e = writeErr(acc, info.domain.name, cur.Name);
        if (e) return { code: -1, msg: e };
      }
    }
    const ok = await provider.deleteDomainRecord(recordId);
    if (!ok) return { code: -1, msg: provider.getError() };
    await bumpRecordCount(id, -1);
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/domains/:id/records/:recordId/status', auth, async (req: any) => {
    const { id, recordId } = req.params as any;
    const { status } = req.body || {};
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    {
      const acc = await getUserPerms(req);
      if (!acc.admin) {
        const cur = await (provider as any).getDomainRecordInfo(recordId);
        if (!cur) return { code: -1, msg: '无权限操作该记录' };
        const e = writeErr(acc, info.domain.name, cur.Name);
        if (e) return { code: -1, msg: e };
      }
    }
    const ok = await provider.setDomainRecordStatus(recordId, status);
    if (!ok) return { code: -1, msg: provider.getError() };
    return { code: 0, msg: '状态更新成功' };
  });

  // 批量操作解析记录：open/pause/delete/remark/value/line/group
  app.post('/api/domains/:id/records/batch', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const acc = await getUserPerms(req);
    const b = req.body || {};
    const action = String(b.action || '');
    const records: any[] = Array.isArray(b.records) ? b.records : [];
    if (!action || !records.length) return { code: -1, msg: '参数不能为空' };
    if (!acc.admin) {
      for (const r of records) {
        const e = writeErr(acc, info.domain.name, r.Name);
        if (e) return { code: -1, msg: e };
      }
    }
    let success = 0;
    let fail = 0;
    if (action === 'open' || action === 'pause') {
      const st = action === 'open' ? '1' : '0';
      for (const r of records) {
        if (await provider.setDomainRecordStatus(r.RecordId, st)) success++;
        else fail++;
      }
      return { code: 0, msg: `成功${action === 'open' ? '启用' : '暂停'}${success}条解析记录` };
    }
    if (action === 'delete') {
      for (const r of records) {
        if (await provider.deleteDomainRecord(r.RecordId)) success++;
        else fail++;
      }
      if (success) await bumpRecordCount(id, -success);
      return { code: 0, msg: `成功删除${success}条解析记录` };
    }
    if (action === 'remark') {
      const remark = b.remark ? String(b.remark) : null;
      const fn = provider.updateDomainRecordRemark;
      if (typeof fn !== 'function') return { code: -1, msg: '该DNS类型不支持备注' };
      for (const r of records) {
        if (await fn.call(provider, r.RecordId, remark)) success++;
        else fail++;
      }
      return { code: 0, msg: `批量修改备注，成功${success}条，失败${fail}条` };
    }
    if (action === 'value' || action === 'line') {
      for (const r of records) {
        const type = action === 'value' ? String(b.type || r.Type) : r.Type;
        const value = action === 'value' ? String(b.value ?? '') : (Array.isArray(r.Value) ? r.Value.join(',') : r.Value);
        const line = action === 'line' ? String(b.line ?? '') : r.Line;
        const ok = await provider.updateDomainRecord(r.RecordId, r.Name, type, value, line || 'default', Number(r.TTL || 600), Number(r.MX || 1), r.Weight ?? null, r.Remark ?? null);
        if (ok) success++;
        else fail++;
      }
      return { code: 0, msg: `批量修改${action === 'value' ? '记录值' : '线路'}，成功${success}条，失败${fail}条` };
    }
    if (action === 'group') {
      if (typeof provider.changeRecordGroup !== 'function') return { code: -1, msg: '该DNS类型不支持分组' };
      const ids = records.map((r) => String(r.RecordId));
      const ok = await provider.changeRecordGroup(ids, String(b.groupid ?? ''));
      return ok ? { code: 0, msg: `成功修改${ids.length}条记录的分组` } : { code: -1, msg: '修改分组失败，' + provider.getError() };
    }
    return { code: -1, msg: '不支持的操作' };
  });

  // 批量添加解析记录（每行「主机记录 记录值」，其余属性统一）
  app.post('/api/domains/:id/records/batch-add', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const b = req.body || {};
    const raw = String(b.record ?? '');
    const type = String(b.type ?? '').trim();
    const line = String(b.line ?? 'default');
    const ttl = Number(b.ttl || 600);
    const mx = Number(b.mx || 1);
    const remark = b.remark ? String(b.remark) : null;
    const lines = raw.split('\n').map((s: string) => s.trim()).filter(Boolean);
    if (!lines.length) return { code: -1, msg: '参数不能为空' };
    const acc = await getUserPerms(req);
    let success = 0;
    let fail = 0;
    for (const ln of lines) {
      const [name, value] = ln.split(/\s+/);
      if (!name || !value) continue;
      const rType = type || detectType(value);
      const e = writeErr(acc, info.domain.name, name);
      if (e) {
        fail++;
        continue;
      }
      const rid = await provider.addDomainRecord(name, rType, value, line, ttl, mx, null, remark);
      if (rid) success++;
      else fail++;
    }
    if (success) await bumpRecordCount(id, success);
    if (success > 0) return { code: 0, msg: `批量添加解析，成功${success}条，失败${fail}条` };
    return { code: -1, msg: '批量添加失败，' + (provider.getError?.() || '没有可添加的记录') };
  });

  // 域名快捷信息：线路列表 + 最小 TTL + 是否支持权重/备注
  app.get('/api/domains/:id/quickinfo', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const acc = await getUserPerms(req);
    if (!acc.admin) {
      const m = matchPermission(acc.perms, info.domain.name, '@');
      if (m < 0) return { code: -1, msg: '无权限' };
    }
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    let minTTL = 1;
    if (typeof provider.getMinTTL === 'function') {
      const t = await provider.getMinTTL();
      if (t !== false && t) minTTL = t;
    }
    return { code: 0, data: { minTTL } };
  });

  // 解析记录分组列表（阿里云 / DNSPod）
  app.get('/api/domains/:id/groups', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider || typeof provider.getRecordGroups !== 'function') return { code: -1, msg: '该DNS类型不支持分组' };
    const groups = await provider.getRecordGroups();
    if (groups === false) return { code: -1, msg: '获取分组列表失败，' + provider.getError() };
    const list = (groups as any[]).map((g) => ({
      id: g.GroupId,
      name: g.GroupName + (g.RecordCount !== undefined ? '(' + g.RecordCount + ')' : ''),
    }));
    return { code: 0, data: list };
  });

  // ============ 权重解析（阿里云）============
  app.get('/api/domains/:id/weight', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider || typeof provider.getWeightSubDomains !== 'function') return { code: -1, msg: '该DNS类型不支持权重解析（仅阿里云）' };
    const res = await provider.getWeightSubDomains(1, Number(req.query?.pagesize || 20), req.query?.subdomain || null);
    if (res === false) return { code: -1, msg: '获取权重列表失败，' + provider.getError() };
    return { code: 0, data: res };
  });

  app.post('/api/domains/:id/weight', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider || typeof provider.setWeightStatus !== 'function') return { code: -1, msg: '该DNS类型不支持权重解析（仅阿里云）' };
    const acc = await getUserPerms(req);
    const b = req.body || {};
    const act = String(b.act || '');
    const subdomain = String(b.subdomain || '').trim();
    if (!subdomain) return { code: -1, msg: '参数不能为空' };
    const perr = writeErr(acc, info.domain.name, subdomain);
    if (perr) return { code: -1, msg: perr };
    if (act === 'status') {
      const status = String(b.status ?? '0');
      const ok = await provider.setWeightStatus(subdomain, status, b.type ?? null, b.line ?? null);
      return ok ? { code: 0, msg: '操作成功' } : { code: -1, msg: '操作失败，' + provider.getError() };
    }
    if (act === 'update') {
      const status = String(b.status ?? '0');
      const type = b.type ?? null;
      const line = b.line ?? null;
      const weight = b.weight || {};
      if (type !== 'CNAME') {
        const okStatus = await provider.setWeightStatus(subdomain, status, type, line);
        if (!okStatus) return { code: -1, msg: '修改失败，' + provider.getError() };
      }
      if (status === '1') {
        let success = 0;
        for (const [recordId, w] of Object.entries(weight)) {
          if (await provider.updateRecordWeight(recordId, Number(w))) success++;
        }
        if (success > 0) return { code: 0, msg: '成功修改' + success + '条解析记录权重' };
        return { code: -1, msg: '修改权重失败，' + provider.getError() };
      }
      return { code: 0, msg: '修改成功' };
    }
    return { code: -1, msg: '参数错误' };
  });

  // ============ 域名别名（DNSPod）============
  app.get('/api/domains/:id/aliases', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider || typeof provider.domainAliasList !== 'function') return { code: -1, msg: '该DNS类型不支持域名别名（仅DNSPod）' };
    const list = await provider.domainAliasList();
    if (list === false) return { code: -1, msg: '获取别名失败，' + provider.getError() };
    return { code: 0, data: list };
  });

  app.post('/api/domains/:id/aliases', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number((req.params as any).id);
    const alias = String((req.body || {}).alias || '').trim();
    if (!alias) return { code: -1, msg: '参数不能为空' };
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider || typeof provider.addDomainAlias !== 'function') return { code: -1, msg: '该DNS类型不支持域名别名（仅DNSPod）' };
    const ok = await provider.addDomainAlias(alias);
    return ok ? { code: 0, msg: '添加域名别名成功' } : { code: -1, msg: '添加域名别名失败，' + provider.getError() };
  });

  app.delete('/api/domains/:id/aliases/:aliasId', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const { id, aliasId } = req.params as any;
    const info = await getDomainWithAccount(Number(id));
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider || typeof provider.deleteDomainAlias !== 'function') return { code: -1, msg: '该DNS类型不支持域名别名（仅DNSPod）' };
    const ok = await provider.deleteDomainAlias(String(aliasId));
    return ok ? { code: 0, msg: '删除域名别名成功' } : { code: -1, msg: '删除域名别名失败，' + provider.getError() };
  });

  // ============ 解析操作日志（阿里云）============
  app.get('/api/domains/:id/recordlog', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider || typeof provider.getDomainRecordLog !== 'function') return { code: -1, msg: '该DNS类型不支持解析日志' };
    const q = req.query || {};
    const res = await provider.getDomainRecordLog(Number(q.page || 1), Number(q.pagesize || 20), q.keyword || null, q.startdate || null, q.enddate || null);
    if (res === false) return { code: -1, msg: '获取解析日志失败，' + provider.getError() };
    return { code: 0, data: res };
  });
}

async function bumpRecordCount(domainId: number, delta: number) {
  await query(`UPDATE ${table('domain')} SET recordcount = GREATEST(recordcount + ?, 0) WHERE id = ?`, [delta, domainId]);
}

// 依据记录值推断记录类型（与原项目 getDnsType 一致）
function detectType(value: string): string {
  const v = String(value).trim();
  if (net.isIPv4(v)) return 'A';
  if (net.isIPv6(v)) return 'AAAA';
  return 'CNAME';
}