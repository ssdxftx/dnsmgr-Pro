import type { FastifyInstance } from 'fastify';
import net from 'node:net';
import { query, queryOne, table } from '../db.js';
import { getDnsProvider } from '../lib/dns/factory.js';
import { getUserPermissions, matchPermission, isRecordInScope, checkLevel, type SubPermission } from '../auth.js';
import { localResolve, recordValueMatches } from '../lib/dns/localResolve.js';
import { ConfigDecryptError, decryptConfig, isEncryptedConfig } from '../lib/secret.js';
import { audit } from '../lib/audit/context.js';
import { diffFields } from '../lib/audit/mask.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

/** 拼接完整记录名：主机记录为 @ 或空时指向根域名，避免出现 @.example.com */
function recFull(name: string | undefined | null, domain: string): string {
  return !name || name === '@' ? domain : `${name}.${domain}`;
}

function safeJson(s: any): Record<string, any> {
  if (s && typeof s === 'object') return s as Record<string, any>;
  const cfg = decryptConfig(s);
  if (cfg) return cfg;
  if (isEncryptedConfig(s)) {
    throw new ConfigDecryptError('账户配置无法解密（系统密钥可能已变更），请重新填写账户凭证');
  }
  return {};
}

/** 并发工作池：按 limit 并发执行，保持结果与输入同序，避免批量操作串行 await 拉长请求时长 */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let aborted = false;
  const worker = async () => {
    while (cursor < items.length) {
      // 首个任务出错后不再领取新任务（批量写操作 fail-fast），
      // 避免接口已返回错误、其余 worker 仍在后台继续写云端数据
      if (aborted) return;
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        aborted = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 缓存超限时淘汰最旧的一批（约 10%），避免整表 clear 造成命中率归零 */
function evictOldest<K, V extends { at: number }>(map: Map<K, V>, max: number): void {
  if (map.size < max) return;
  const drop = Math.max(1, Math.floor(max * 0.1));
  const entries = [...map.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < drop && i < entries.length; i++) map.delete(entries[i][0]);
}

const allRecordsCache = new Map<string, { at: number; list: any[] }>();
const RECORDS_TTL = 60_000;
const RECORDS_CACHE_MAX = 300;

/** 批量取账户（含 AES 解密配置），避免每条授权各查一次 account */
async function fetchAccountMap(aids: number[]): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  const uniq = [...new Set(aids.map((a) => Number(a)).filter((a) => Number.isFinite(a) && a > 0))];
  if (!uniq.length) return map;
  const rows = await query(`SELECT * FROM ${table('account')} WHERE id IN (${uniq.map(() => '?').join(',')})`, uniq);
  for (const r of rows as any[]) map.set(Number(r.id), r);
  return map;
}

/** 拉取某域名全部解析记录（带 60s 内存缓存），用于统计子域名记录数；acct 可由调用方批量预取后传入。
 *  返回 ok 以区分「记录为空」与「云端拉取失败」：失败时不写缓存，由调用方在行上标记，避免把失败伪装成 0 条。 */
async function fetchAllRecords(d: any, acct?: any): Promise<{ list: any[]; ok: boolean }> {
  const cached = allRecordsCache.get(d.name);
  if (cached && Date.now() - cached.at < RECORDS_TTL) return { list: cached.list, ok: true };
  let list: any[] = [];
  let ok = false;
  const acctRow = acct !== undefined ? acct : await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [d.aid]);
  if (acctRow) {
    const provider = getDnsProvider(acctRow.type, safeJson(acctRow.config), d.name, d.thirdid);
    if (provider) {
      ok = true;
      let pageSize = 500;
      for (let page = 1; page <= 10; page++) {
        const r = await provider.getDomainRecords(page, 500, null, null, null, null, null, null);
        if (r === false) {
          // 云端返回失败：标记失败且不写缓存
          ok = false;
          break;
        }
        if (!r.list || !r.list.length) break;
        list = list.concat(r.list);
        if (page === 1) pageSize = r.list.length;
        // 返回条数不足一页即结束，不依赖厂商 total（部分厂商 total 只代表本页条数）
        if (r.list.length < pageSize) break;
      }
    }
  }
  if (ok) {
    evictOldest(allRecordsCache, RECORDS_CACHE_MAX);
    allRecordsCache.set(d.name, { at: Date.now(), list });
  }
  return { list, ok };
}

const recordTotalCache = new Map<string, { at: number; total: number }>();
const RECORD_TOTAL_CACHE_MAX = 500;

/** 仅取某域名的记录总数（不带子域名过滤时使用）：只请求 1 条 + 读取分页 total，避免全量拉取；acct 可由调用方批量预取后传入 */
async function fetchRecordTotal(d: any, acct?: any): Promise<number> {
  const cached = recordTotalCache.get(d.name);
  if (cached && Date.now() - cached.at < RECORDS_TTL) return cached.total;
  let total = Number(d.recordcount || 0);
  const acctRow = acct !== undefined ? acct : await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [d.aid]);
  if (acctRow) {
    const provider = getDnsProvider(acctRow.type, safeJson(acctRow.config), d.name, d.thirdid);
    if (provider) {
      const r = await provider.getDomainRecords(1, 1, null, null, null, null, null, null);
      if (r && typeof (r as any).total === 'number') total = Number((r as any).total);
    }
  }
  if (recordTotalCache.size >= RECORD_TOTAL_CACHE_MAX) evictOldest(recordTotalCache, RECORD_TOTAL_CACHE_MAX);
  recordTotalCache.set(d.name, { at: Date.now(), total });
  return total;
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

/** 校验记录实际归属：provider 仅凭 RecordId 定位记录，需确认其属于当前域名，避免跨域名越权改/删 */
function recordOwnedByDomain(cur: any, domainName: string): boolean {
  const d = cur && cur.Domain;
  if (!d) return true; // 部分厂商不返回 Domain，交由子域名权限校验兜底
  const norm = (s: any) => String(s ?? '').trim().toLowerCase().replace(/\.$/, '');
  return norm(d) === norm(domainName);
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
  const writable = mine.some((p) => Number(p.readonly) !== 1);
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
      // 按域名聚合授权：同一域名只拉取一次云端记录，避免多子域名授权重复请求
      const permsByDomain = new Map<string, SubPermission[]>();
      for (const p of acc.perms) {
        if (!byName.has(p.domain)) continue;
        const arr = permsByDomain.get(p.domain) || [];
        arr.push(p);
        permsByDomain.set(p.domain, arr);
      }
      // 批量取账户（一次 IN 查询），替代每条授权各查一次 account（含 AES 解密）
      const acctMap = await fetchAccountMap([...permsByDomain.keys()].map((n) => Number(byName.get(n)!.aid)));
      const domainResult = new Map<string, { total: number; records: any[]; countOk: boolean }>();
      const entries = [...permsByDomain.entries()];
      let cursor = 0;
      // 并发工作池：最多 8 个域名同时拉取云端记录（原实现为串行，M 条授权 ≈ M 次 DB + 最多 10M 次 HTTP）
      const worker = async () => {
        while (cursor < entries.length) {
          const [name, perms] = entries[cursor++];
          const d: any = byName.get(name);
          const acctRow = acctMap.get(Number(d.aid));
          const hasFull = perms.some((p) => !p.sub);
          const hasSub = perms.some((p) => !!p.sub);
          try {
            const [total, recordsRes] = await Promise.all([
              hasFull ? fetchRecordTotal(d, acctRow) : Promise.resolve(0),
              hasSub ? fetchAllRecords(d, acctRow) : Promise.resolve({ list: [] as any[], ok: true }),
            ]);
            domainResult.set(name, { total, records: recordsRes.list, countOk: recordsRes.ok });
          } catch {
            // 单个域名云端拉取失败时降级为库内记录数，并标记「记录数不可信」，避免把失败伪装成 0 条
            domainResult.set(name, { total: Number(d.recordcount || 0), records: [], countOk: false });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, entries.length) }, worker));

      // 按原授权顺序输出，保持与既有行为一致
      const out: any[] = [];
      for (const p of acc.perms) {
        const d: any = byName.get(p.domain);
        if (!d) continue;
        const res = domainResult.get(p.domain);
        const cnt = p.sub
          ? (res?.records || []).filter((r: any) => isRecordInScope(r.Name, p.sub)).length
          : res?.total ?? Number(d.recordcount || 0);
        // 普通用户不需要知道底层云账号别名，剔除避免信息泄露
        const dSafe = { ...d };
        delete dSafe.account_type;
        delete dSafe.account_name;
        out.push({
          ...dSafe,
          recordcount: cnt,
          _count_error: p.sub ? !(res && res.countOk) : false,
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
    // 批量取账户，避免逐个域名查 account
    const acctMap = await fetchAccountMap(targets.map((t: any) => Number(t.aid)));
    const LIMIT = 200;
    const out: any[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length && out.length < LIMIT) {
        const d = targets[cursor++];
        if (out.length >= LIMIT) return;
        try {
          const list = (await fetchAllRecords(d, acctMap.get(Number(d.aid)))).list;
          for (const r of list || []) {
            // 命中上限即早停，避免为返回 200 条而全量拉取所有域名
            if (out.length >= LIMIT) return;
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
    // 并发早停会让「先跑到上限」的 worker 决定结果集，且可能丢弃后续匹配；
    // 明确返回 truncated 让前端提示「结果过多，请细化关键词」，避免用户误以为结果完整
    const truncated = out.length >= LIMIT;
    return { code: 0, data: out.slice(0, LIMIT), truncated };
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
    audit(req, { targetType: 'domain', targetName: String(name), summary: `新建域名分组 ${name}` });
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
    audit(req, {
      targetType: 'domain',
      targetId: id,
      targetName: String(domain),
      summary: `接入域名 ${domain}`,
      changes: [{ field: '域名', to: String(domain) }],
      detail: { aid, domain, thirdid, recordcount },
    });
    return { code: 0, msg: '添加域名成功', data: id };
  });

  app.delete('/api/domains/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const row = await queryOne(`SELECT name FROM ${table('domain')} WHERE id = ?`, [id]);
    // 与源项目一致：删除域名时级联清理别名与关联任务，避免残留任务引用已删除域名
    await query(`DELETE FROM ${table('domain')} WHERE id = ?`, [id]);
    await query(`DELETE FROM ${table('domain_alias')} WHERE did = ?`, [id]);
    await query(`DELETE FROM ${table('dmtask')} WHERE did = ?`, [id]);
    await query(`DELETE FROM ${table('optimizeip')} WHERE did = ?`, [id]);
    await query(`DELETE FROM ${table('sctask')} WHERE did = ?`, [id]);
    await query(`DELETE FROM ${table('dns_check_task')} WHERE did = ?`, [id]);
    audit(req, {
      targetType: 'domain',
      targetId: id,
      targetName: String(row?.name || ''),
      summary: `删除域名 ${row?.name || '#' + id}`,
    });
    return { code: 0, msg: '删除成功' };
  });

  // 编辑域名属性（备注/分类/隐藏/单点登录/到期提醒/到期时间）
  app.put('/api/domains/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number((req.params as any).id);
    const row: any = await queryOne(`SELECT * FROM ${table('domain')} WHERE id = ?`, [id]);
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
    audit(req, {
      targetType: 'domain',
      targetId: id,
      targetName: String(row.name || ''),
      summary: `修改域名 ${row.name || '#' + id}`,
      changes: diffFields(row, { ...row, ...upd }, {
        remark: '备注',
        cid: '分组',
        is_hide: '隐藏',
        is_sso: '单点登录',
        is_notice: '到期提醒',
        expiretime: '到期时间',
      }),
      detail: { fields: cols },
    });
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
    audit(req, {
      targetType: 'domain',
      summary: `批量删除 ${ids.length} 个域名`,
      detail: { ids: ids.slice(0, 50) },
    });
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
      // 有整域名授权时可见全部记录，provider 的 total 准确且不构成信息泄露，直接沿用；
      // 仅子域名授权时不得用 provider 全量 total（会泄露域名记录总数），也不能用本页可见数
      // 冒充总数（会导致分页恒为 1 页、授权记录不在首页时完全看不到，见审计 B-04）。
      // 这里按「页边界」推断占位总数：满页时给出足以启用下一页的值，未满页时按已见数累加。
      const fullAccess = acc.perms.some((p) => p.domain === info.domain.name && !p.sub);
      if (!fullAccess) {
        const pageSize = Number(q.pagesize || 20) || 20;
        const page = Number(q.page || 1) || 1;
        const visible = res.list.length;
        res.total = visible >= pageSize ? page * pageSize + 1 : (page - 1) * pageSize + visible;
      }
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
    audit(req, {
      targetType: 'record',
      targetName: fullDomain,
      summary: `检测解析 ${fullDomain}（${type}）`,
      detail: { name, type, value: rawValue },
    });
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
    audit(req, {
      targetType: 'record',
      targetId: recordId,
      targetName: recFull(name, info.domain.name),
      summary: `新增 ${type} 记录 ${name || '@'} → ${value}`,
      changes: [{ field: '记录', to: `${type} ${name || '@'} ${value}` }],
      detail: { name, type, value, line, ttl, mx, weight, remark },
    });
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
        if (!recordOwnedByDomain(cur, info.domain.name)) return { code: -1, msg: '无权限操作该记录' };
        const err = writeErr(acc, info.domain.name, cur.Name);
        if (err) return { code: -1, msg: err };
      }
    }
    if (typeof provider.updateDomainRecordRemark === 'function') {
      const ok = await provider.updateDomainRecordRemark(recordId, remark);
      if (!ok) return { code: -1, msg: provider.getError() };
      audit(req, {
        targetType: 'record',
        targetId: recordId,
        targetName: info.domain.name,
        summary: `修改解析备注 ${recordId}`,
        changes: [{ field: '备注', to: String(remark ?? '') }],
      });
      return { code: 0, msg: '备注修改成功' };
    }
    const cur = await provider.getDomainRecordInfo(recordId);
    if (!cur) return { code: -1, msg: provider.getError?.() || '获取记录信息失败' };
    const ok = await provider.updateDomainRecord(recordId, cur.Name, cur.Type, cur.Value, cur.Line, cur.TTL, cur.MX, cur.Weight, remark);
    if (!ok) return { code: -1, msg: provider.getError?.() || '备注修改失败' };
    audit(req, {
      targetType: 'record',
      targetId: recordId,
      targetName: recFull(cur.Name, info.domain.name),
      summary: `修改解析备注 ${cur.Name || recordId}`,
      changes: [{ field: '备注', from: String(cur.Remark ?? ''), to: String(remark ?? '') }],
    });
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
        if (!recordOwnedByDomain(cur, info.domain.name)) return { code: -1, msg: '无权限操作该记录' };
        let e = writeErr(acc, info.domain.name, cur.Name);
        if (e) return { code: -1, msg: e };
        e = writeErr(acc, info.domain.name, name);
        if (e) return { code: -1, msg: '新记录超出授权子域名范围' };
      }
    }
    const cur =
      typeof (provider as any).getDomainRecordInfo === 'function'
        ? await (provider as any).getDomainRecordInfo(recordId).catch(() => null)
        : null;
    const ok = await provider.updateDomainRecord(recordId, name, type, value, line || 'default', Number(ttl || 600), Number(mx || 1), weight ?? null, remark || null);
    if (!ok) return { code: -1, msg: provider.getError() };
    audit(req, {
      targetType: 'record',
      targetId: recordId,
      targetName: recFull(name || cur?.Name, info.domain.name),
      summary: `修改解析记录 ${cur?.Name || name || recordId}：${cur?.Value ?? '-'} → ${value}`,
      changes: diffFields(
        cur && { Name: cur.Name, Type: cur.Type, Value: cur.Value, Line: cur.Line, TTL: cur.TTL, MX: cur.MX, Remark: cur.Remark },
        { Name: name, Type: type, Value: value, Line: line, TTL: ttl, MX: mx, Remark: remark },
        { Name: '主机记录', Type: '类型', Value: '记录值', Line: '线路', TTL: 'TTL', MX: 'MX', Remark: '备注' },
      ),
      detail: { recordId, name, type, value, line, ttl, mx, weight, remark },
    });
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
        if (!recordOwnedByDomain(cur, info.domain.name)) return { code: -1, msg: '无权限操作该记录' };
        const e = writeErr(acc, info.domain.name, cur.Name);
        if (e) return { code: -1, msg: e };
      }
    }
    const cur =
      typeof (provider as any).getDomainRecordInfo === 'function'
        ? await (provider as any).getDomainRecordInfo(recordId).catch(() => null)
        : null;
    const ok = await provider.deleteDomainRecord(recordId);
    if (!ok) return { code: -1, msg: provider.getError() };
    await bumpRecordCount(id, -1);
    audit(req, {
      targetType: 'record',
      targetId: recordId,
      targetName: recFull(cur?.Name, info.domain.name),
      summary: `删除 ${cur?.Type || '解析'} 记录 ${cur?.Name || recordId} → ${cur?.Value ?? '-'}`,
      changes: [{ field: '记录', from: cur ? `${cur.Type} ${cur.Name} ${cur.Value}` : String(recordId), to: '' }],
    });
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
        if (!recordOwnedByDomain(cur, info.domain.name)) return { code: -1, msg: '无权限操作该记录' };
        const e = writeErr(acc, info.domain.name, cur.Name);
        if (e) return { code: -1, msg: e };
      }
    }
    const cur =
      typeof (provider as any).getDomainRecordInfo === 'function'
        ? await (provider as any).getDomainRecordInfo(recordId).catch(() => null)
        : null;
    const ok = await provider.setDomainRecordStatus(recordId, status);
    if (!ok) return { code: -1, msg: provider.getError() };
    audit(req, {
      targetType: 'record',
      targetId: recordId,
      targetName: recFull(cur?.Name, info.domain.name),
      summary: `${Number(status) ? '启用' : '暂停'}解析记录 ${cur?.Name || recordId}`,
      changes: [{ field: '状态', to: Number(status) ? '启用' : '暂停' }],
    });
    return { code: 0, msg: '状态更新成功' };
  });

  // 批量操作解析记录：open/pause/delete/remark/value/line/group
  app.post('/api/domains/:id/records/batch', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    // 批量任务并发放大，provider 实例字段（this.error、记录缓存等）会被并发读写串台，
    // 故为每个任务创建独立实例
    const makeProvider = (): any => getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    const acc = await getUserPerms(req);
    const b = req.body || {};
    const action = String(b.action || '');
    const records: any[] = Array.isArray(b.records) ? b.records : [];
    if (!action || !records.length) return { code: -1, msg: '参数不能为空' };
    const actionText: Record<string, string> = {
      open: '启用', pause: '暂停', delete: '删除', remark: '修改备注', value: '修改记录值', line: '修改线路', group: '修改分组',
    };
    audit(req, {
      targetType: 'record',
      targetName: info.domain.name,
      summary: `批量${actionText[action] || action} ${records.length} 条解析记录`,
      detail: { action, count: records.length, ids: records.slice(0, 20).map((r: any) => r.RecordId) },
    });
    if (!acc.admin) {
      // 以云端真实记录名判权，避免客户端用 r.Name 通过校验、却用 r.RecordId 越权操作
      const fn = provider.getDomainRecordInfo;
      if (typeof fn !== 'function') return { code: -1, msg: '该DNS类型不支持批量操作' };
      try {
        await runPool(records, 8, async (r: any) => {
          // 本地范围预筛：目标名明显越权时直接拒绝，无需打云端
          if ((action === 'value' || action === 'line') && r.Name) {
            const le = writeErr(acc, info.domain.name, r.Name);
            if (le) throw new Error('新记录超出授权子域名范围');
          }
          const p: any = makeProvider();
          const cur = await p.getDomainRecordInfo(r.RecordId);
          if (!cur) throw new Error('无权限操作该记录');
          if (!recordOwnedByDomain(cur, info.domain.name)) throw new Error('无权限操作该记录');
          const e = writeErr(acc, info.domain.name, cur.Name);
          if (e) throw new Error(e);
        });
      } catch (e: any) {
        // runPool 首个错误即中止其余 worker，避免首个越权后仍对全部 recordId 打云端
        return { code: -1, msg: e?.message || '无权限操作该记录' };
      }
    }
    let success = 0;
    let fail = 0;
    if (action === 'open' || action === 'pause') {
      const st = action === 'open' ? '1' : '0';
      const results = await runPool(records, 8, async (r: any) => !!(await makeProvider().setDomainRecordStatus(r.RecordId, st)));
      success = results.filter(Boolean).length;
      fail = results.length - success;
      return { code: 0, msg: `成功${action === 'open' ? '启用' : '暂停'}${success}条解析记录` };
    }
    if (action === 'delete') {
      const results = await runPool(records, 8, async (r: any) => !!(await makeProvider().deleteDomainRecord(r.RecordId)));
      success = results.filter(Boolean).length;
      fail = results.length - success;
      if (success) await bumpRecordCount(id, -success);
      return { code: 0, msg: `成功删除${success}条解析记录` };
    }
    if (action === 'remark') {
      const remark = b.remark ? String(b.remark) : null;
      const fn = provider.updateDomainRecordRemark;
      if (typeof fn !== 'function') return { code: -1, msg: '该DNS类型不支持备注' };
      const results = await runPool(records, 8, async (r: any) => !!(await makeProvider().updateDomainRecordRemark(r.RecordId, remark)));
      success = results.filter(Boolean).length;
      fail = results.length - success;
      return { code: 0, msg: `批量修改备注，成功${success}条，失败${fail}条` };
    }
    if (action === 'value' || action === 'line') {
      const results = await runPool(records, 8, async (r: any) => {
        const type = action === 'value' ? String(b.type || r.Type) : r.Type;
        const value = action === 'value' ? String(b.value ?? '') : (Array.isArray(r.Value) ? r.Value.join(',') : r.Value);
        const line = action === 'line' ? String(b.line ?? '') : r.Line;
        return !!(await makeProvider().updateDomainRecord(r.RecordId, r.Name, type, value, line || 'default', Number(r.TTL || 600), Number(r.MX || 1), r.Weight ?? null, r.Remark ?? null));
      });
      success = results.filter(Boolean).length;
      fail = results.length - success;
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
    if (lines.length > 500) return { code: -1, msg: '单次最多添加 500 条解析记录' };
    const acc = await getUserPerms(req);
    // 格式非法的行（缺少主机记录或记录值）不计入失败数，与既有语义一致
    const parsed = lines.map((ln: string) => {
      const [name, value] = ln.split(/\s+/);
      return { ln, name, value };
    });
    const valid = parsed.filter((p) => p.name && p.value);
    const invalid = parsed.length - valid.length;
    const results = await runPool(valid, 8, async (p: { ln: string; name: string; value: string }) => {
      const rType = type || detectType(p.value);
      const e = writeErr(acc, info.domain.name, p.name);
      if (e) return false;
      const rid = await provider.addDomainRecord(p.name, rType, p.value, line, ttl, mx, null, remark);
      return !!rid;
    });
    const success = results.filter(Boolean).length;
    const fail = results.length - success;
    const invalidNote = invalid ? `，忽略${invalid}条格式错误的行` : '';
    if (success) await bumpRecordCount(id, success);
    audit(req, {
      targetType: 'record',
      targetName: info.domain.name,
      summary: `批量添加解析 ${success} 条（失败 ${fail}）`,
      detail: { type, count: valid.length, invalid },
    });
    if (success > 0) return { code: 0, msg: `批量添加解析，成功${success}条，失败${fail}条${invalidNote}` };
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
    const acc = await getUserPerms(req);
    if (!acc.admin && matchPermission(acc.perms, info.domain.name, '@') < 0) return { code: -1, msg: '无权限' };
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
    const acc = await getUserPerms(req);
    if (!acc.admin && matchPermission(acc.perms, info.domain.name, '@') < 0) return { code: -1, msg: '无权限' };
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
      if (ok) {
        audit(req, {
          targetType: 'domain',
          targetId: id,
          targetName: `${subdomain}.${info.domain.name}`,
          summary: `${Number(status) ? '启用' : '停用'}权重解析 ${subdomain}`,
        });
        return { code: 0, msg: '操作成功' };
      }
      return { code: -1, msg: '操作失败，' + provider.getError() };
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
      audit(req, {
        targetType: 'domain',
        targetId: id,
        targetName: `${subdomain}.${info.domain.name}`,
        summary: `修改权重解析 ${subdomain}`,
        detail: { act, subdomain, type, line },
      });
      if (status === '1') {
        let success = 0;
        for (const [recordId, w] of Object.entries(weight)) {
          // 逐条判权：避免以任意 recordId 修改授权子域名之外的记录权重
          if (!acc.admin) {
            const cur = await (provider as any).getDomainRecordInfo(recordId);
            if (!cur) continue;
            if (!recordOwnedByDomain(cur, info.domain.name)) continue;
            if (writeErr(acc, info.domain.name, cur.Name)) continue;
          }
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
    const acc = await getUserPerms(req);
    if (!acc.admin && matchPermission(acc.perms, info.domain.name, '@') < 0) return { code: -1, msg: '无权限' };
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
    if (ok) {
      audit(req, { targetType: 'domain', targetId: id, targetName: alias, summary: `添加域名别名 ${alias}` });
      return { code: 0, msg: '添加域名别名成功' };
    }
    return { code: -1, msg: '添加域名别名失败，' + provider.getError() };
  });

  app.delete('/api/domains/:id/aliases/:aliasId', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const { id, aliasId } = req.params as any;
    const info = await getDomainWithAccount(Number(id));
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const provider: any = getDnsProvider(info.account.type, safeJson(info.account.config), info.domain.name, info.domain.thirdid);
    if (!provider || typeof provider.deleteDomainAlias !== 'function') return { code: -1, msg: '该DNS类型不支持域名别名（仅DNSPod）' };
    const ok = await provider.deleteDomainAlias(String(aliasId));
    if (ok) {
      audit(req, { targetType: 'domain', targetId: id, summary: `删除域名别名 ${aliasId}` });
      return { code: 0, msg: '删除域名别名成功' };
    }
    return { code: -1, msg: '删除域名别名失败，' + provider.getError() };
  });

  // ============ 解析操作日志（阿里云）============
  app.get('/api/domains/:id/recordlog', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const info = await getDomainWithAccount(id);
    if (!info) return { code: -1, msg: '域名或账户不存在' };
    const acc = await getUserPerms(req);
    if (!acc.admin && matchPermission(acc.perms, info.domain.name, '@') < 0) return { code: -1, msg: '无权限' };
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