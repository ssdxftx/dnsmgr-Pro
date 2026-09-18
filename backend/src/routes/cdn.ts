import type { FastifyInstance } from 'fastify';
import { domainToASCII } from 'node:url';
import { query, queryOne, table } from '../db.js';
import { configGet } from '../config.js';
import { getCdnProvider, cdnConfig } from '../lib/cdn/factory.js';
import { getDnsProvider } from '../lib/dns/factory.js';
import { certConfig } from '../lib/cert/factory.js';
import { ensureWildcardOrder, ensureExactOrder, ensureCertDeploy, findExactCertOrders, providerReady } from '../lib/cdn/certLink.js';
import { CertDeployService } from '../lib/deployService.js';
import type { CdnProvider } from '../lib/cdn/types.js';
import { queryByRoute, hasCdnStatistics, type StatisticsDomain } from '../lib/cdn/statistics/index.js';
import { ensureSections, mergeResult } from '../lib/cdn/statistics/util.js';
import { checkLevel } from '../auth.js';

// 所有 CDN 管理接口仅管理员可用
const authenticate = (app: FastifyInstance) => ({
  preHandler: async (req: any, reply: any) => {
    await (app as any).authenticate(req, reply);
    if (!req.user) return;
    if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
  },
});

function parseStatTime(v: any): Date | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    const m = String(url).match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/]+)/);
    return m ? m[1].split(':')[0] : '';
  }
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

function safeJson(s: string): Record<string, any> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}

function calcRecordName(accelDomain: string, dnsDomain: string): string {
  if (accelDomain === dnsDomain) return '@';
  return accelDomain.slice(0, accelDomain.length - dnsDomain.length - 1);
}

function normalizeSetting(v: any): any {
  if (Array.isArray(v)) {
    return v.map(normalizeSetting).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = normalizeSetting(v[k]);
    return out;
  }
  return v;
}

function zoneSettingDiff(current: Record<string, any>, target: Record<string, any>): Record<string, any> {
  const diff: Record<string, any> = {};
  for (const key of Object.keys(target)) {
    const value = target[key];
    const cur = current[key];
    if (JSON.stringify(normalizeSetting(value)) !== JSON.stringify(normalizeSetting(cur))) {
      diff[key] = value;
    }
  }
  return diff;
}

const areaMap: Record<string, string> = { mainland: 'mainland_china', domestic: 'mainland_china', overseas: 'overseas', global: 'global' };

function parseIds(raw: any): number[] {
  return [
    ...new Set(
      (Array.isArray(raw) ? raw : [])
        .map((x: any) => Number(x))
        .filter((n: number) => Number.isInteger(n) && n > 0),
    ),
  ] as number[];
}

function summarizeResults(list: any[], pendingLabel: string): string {
  const applied = list.filter((r) => r.status === 'applied').length;
  const pending = list.filter((r) => r.status === 'pending').length;
  const failed = list.filter((r) => r.status === 'failed').length;
  return `成功 ${applied} 个，${pendingLabel} ${pending} 个，失败 ${failed} 个`;
}

export default async function cdnRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  async function loadCdnDomain(id: number): Promise<any> {
    const row = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE id = ?`, [id]);
    if (!row) return null;
    const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [row.aid]);
    if (!acct) return null;
    row._config = acct.config;
    return row;
  }

  async function cdnForRow(row: any): Promise<CdnProvider | false> {
    return cdnForZone(row.aid, row.zone_id);
  }

  async function cdnForZone(aid: number, zoneId: string | null): Promise<CdnProvider | false> {
    const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
    if (!acct) return false;
    const provider: any = getCdnProvider(acct.type, safeJson(acct.config));
    if (!provider) return false;
    if (zoneId && typeof provider.setZoneId === 'function') provider.setZoneId(zoneId);
    if (zoneId && typeof provider.setSiteId === 'function') provider.setSiteId(zoneId);
    return provider;
  }

  // 列表
  app.get('/api/cdn/domains', auth, async (req: any) => {
    const q = req.query || {};
    const rows = await query(`SELECT * FROM ${table('cdn_domain')} ORDER BY id DESC`);
    const typeNames = Object.fromEntries(Object.entries(cdnConfig).map(([k, v]) => [k, v.name]));
    const freeAids = new Set(
      (await query(`SELECT id, type FROM ${table('cdn_account')}`))
        .filter((a: any) => cdnConfig[a.type]?.freecert)
        .map((a: any) => a.id),
    );
    const certAids = new Set(
      (await query(`SELECT id, type FROM ${table('cdn_account')}`))
        .filter((a: any) => cdnConfig[a.type]?.certapply)
        .map((a: any) => a.id),
    );
    const linkAids = new Set(
      (await query(`SELECT id, type FROM ${table('cdn_account')}`))
        .filter((a: any) => cdnConfig[a.type]?.certlink)
        .map((a: any) => a.id),
    );
    const data = rows.map((r: any) => ({
      ...r,
      routename: typeNames[r.route] || r.route,
      can_freecert: freeAids.has(r.aid) ? 1 : 0,
      can_certapply: certAids.has(r.aid) ? 1 : 0,
      can_certlink: linkAids.has(r.aid) ? 1 : 0,
    }));
    return { code: 0, data };
  });

  // 站点列表（按账户 + 站点聚合）
  app.get('/api/cdn/zones', auth, async () => {
    const rows = await query(
      `SELECT aid, zone_id, route,
              MIN(name) AS primary_name,
              COUNT(*) AS domain_count,
              GROUP_CONCAT(name ORDER BY id ASC SEPARATOR ',') AS domains
       FROM ${table('cdn_domain')}
       WHERE zone_id IS NOT NULL AND zone_id != ''
       GROUP BY aid, zone_id
       ORDER BY aid ASC, zone_id ASC`,
    );
    const typeNames = Object.fromEntries(Object.entries(cdnConfig).map(([k, v]) => [k, v.name]));
    const data = rows.map((r: any) => ({
      aid: r.aid,
      zone_id: r.zone_id,
      route: r.route,
      routename: typeNames[r.route] || r.route,
      name: r.primary_name,
      domain_count: Number(r.domain_count),
      domains: String(r.domains || '').split(',').filter(Boolean),
    }));
    return { code: 0, data };
  });

  // 站点配置读取
  app.get('/api/cdn/zones/setting', auth, async (req: any) => {
    const aid = Number(req.query.aid || 0);
    const zoneId = String(req.query.zone_id || '').trim();
    if (!aid || !zoneId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(aid, zoneId);
    if (!provider || typeof provider.getZoneSetting !== 'function') return { code: -1, msg: '该站点不支持站点级配置' };
    const zs = await provider.getZoneSetting(zoneId);
    if (zs === false) return { code: -1, msg: '获取站点配置失败，' + provider.getError() };
    return { code: 0, data: { zoneSetting: zs } };
  });

  // 站点配置保存
  app.post('/api/cdn/zones/setting', auth, async (req: any) => {
    const { aid, zone_id, setting } = req.body || {};
    const zoneId = String(zone_id || '').trim();
    if (!aid || !zoneId) return { code: -1, msg: '参数不完整' };
    const provider: any = await cdnForZone(Number(aid), zoneId);
    if (!provider || typeof provider.getZoneSetting !== 'function' || typeof provider.updateZoneSetting !== 'function') {
      return { code: -1, msg: '该站点不支持站点级配置' };
    }
    if (!setting || typeof setting !== 'object') return { code: -1, msg: '配置数据无效' };
    const current = await provider.getZoneSetting(zoneId);
    if (current === false) return { code: -1, msg: '获取当前站点配置失败，' + provider.getError() };
    const diff = zoneSettingDiff(current, setting);
    if (!Object.keys(diff).length) return { code: 0, msg: '未检测到配置变化' };
    if (!(await provider.updateZoneSetting(zoneId, diff))) return { code: -1, msg: '站点配置更新失败，' + provider.getError() };
    return { code: 0, msg: '站点配置更新成功' };
  });

  // 详情（域名级配置）
  app.get('/api/cdn/domains/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const cacheRules = await query(`SELECT * FROM ${table('cdn_cache_rule')} WHERE did = ? ORDER BY id ASC`, [id]);
    return { code: 0, data: { info: row, cacheRules } };
  });

  // 接入域名 + 联动 DNS + 自动同步
  app.post('/api/cdn/domains', auth, async (req: any) => {
    const { aid, did, name, origin, origin_type, service_area, zone_id, cert_mode, cert_order_id, cert_aid, cert_use_default } = req.body || {};
    if (!aid || !name || !origin) return { code: -1, msg: '必填参数不能为空' };
    const dnsDomain = await queryOne(`SELECT * FROM ${table('domain')} WHERE id = ?`, [did]);
    if (!dnsDomain) return { code: -1, msg: '请选择要联动解析的域名' };
    const suffix = '.' + dnsDomain.name;
    if (name !== dnsDomain.name && !name.endsWith(suffix)) {
      return { code: -1, msg: `加速域名必须属于所选域名 ${dnsDomain.name} 的子域名` };
    }
    if (await queryOne(`SELECT id FROM ${table('cdn_domain')} WHERE name = ?`, [name])) {
      return { code: -1, msg: '该加速域名已接入' };
    }
    const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
    if (!acct) return { code: -1, msg: 'CDN账户不存在' };
    const provider: any = getCdnProvider(acct.type, safeJson(acct.config));
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };
    const certMode = ['freecert', 'certapply', 'certlink'].includes(cert_mode) ? cert_mode : 'none';
    if (certMode === 'freecert' && !cdnConfig[acct.type]?.freecert) return { code: -1, msg: '该 CDN 类型不支持配置平台免费证书' };
    if (certMode === 'certapply' && !cdnConfig[acct.type]?.certapply) return { code: -1, msg: '该 CDN 类型不支持联动证书申请' };
    if (certMode === 'certlink' && !cdnConfig[acct.type]?.certlink) return { code: -1, msg: '该 CDN 类型不支持与项目联动' };
    const cname = await provider.createDomain(name, origin, origin_type || 'ipaddr', service_area || 'mainland_china', zone_id || null);
    if (!cname) return { code: -1, msg: '接入加速域名失败，' + provider.getError() };

    const recordName = calcRecordName(name, dnsDomain.name);
    let dnsRecord: string | null = null;
    let dnsError = '';
    const dnsAcct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
    if (dnsAcct) {
      const dns = getDnsProvider(dnsAcct.type, safeJson(dnsAcct.config), dnsDomain.name, dnsDomain.thirdid);
      if (dns) {
        const recordId = await dns.addDomainRecord(recordName, 'CNAME', cname, 'default', 600);
        if (recordId) dnsRecord = String(recordId);
        else dnsError = dns.getError();
      } else dnsError = 'DNS模块不存在';
    } else dnsError = 'DNS账户不存在';

    const insertRes: any = await query(
      `INSERT INTO ${table('cdn_domain')} (aid, did, name, route, zone_id, origin, origin_type, service_area, cname, dns_record, status, addtime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', NOW())`,
      [aid, did, name, acct.type, zone_id || null, origin, origin_type || 'ipaddr', service_area || 'mainland_china', cname, dnsRecord],
    );
    const newId = Number(insertRes?.insertId || 0);

    let msg = dnsRecord
      ? `接入成功，已自动添加 CNAME 解析记录 ${recordName} → ${cname}`
      : `接入成功，但自动添加解析失败（${dnsError}），请手动添加 CNAME ${recordName} → ${cname}`;

    const sync = await syncFromCloud(aid, did);
    if (sync.code === 0 && sync.added > 0) msg += `；同时从云端同步了 ${sync.added} 个已有加速域名`;

    // 按接入时选择的证书配置处理：平台免费证书 / 联动证书申请 / 与项目联动
    if (newId && certMode === 'freecert') {
      const r: any = (await runFreeCert([newId], false))[0];
      if (r) msg += `；免费证书：${r.message || r.status}`;
    } else if (newId && certMode === 'certapply') {
      const r: any = (await runCertLink([newId], false))[0];
      if (r) msg += `；证书申请：${r.message || r.status}`;
    } else if (newId && certMode === 'certlink') {
      const r = await applyCertLink(newId, provider, { certOrderId: cert_order_id, certAid: cert_aid, useDefault: !!cert_use_default });
      msg += `；证书：${r.message}`;
    }

    return { code: 0, msg };
  });

  // 删除
  app.delete('/api/cdn/domains/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (provider) await provider.deleteDomain(row.name);
    await query(`DELETE FROM ${table('cdn_domain')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功（若已联动解析，请手动删除对应 CNAME 记录）' };
  });

  // 状态
  app.post('/api/cdn/domains/:id/status', auth, async (req: any) => {
    const { id } = req.params as any;
    const { status } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    const target = status === 'offline' ? 'offline' : 'online';
    if (!(await provider.setDomainStatus(row.name, target))) return { code: -1, msg: '状态更新失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_domain')} SET status = ? WHERE id = ?`, [target, id]);
    return { code: 0, msg: '状态更新成功' };
  });

  // 回源
  app.post('/api/cdn/domains/:id/origin', auth, async (req: any) => {
    const { id } = req.params as any;
    const { origin, origin_type, origin_host, origin_protocol, http_port, https_port } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    if (!origin) return { code: -1, msg: '源站不能为空' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.updateOrigin(row.name, origin, origin_type || 'ipaddr', origin_host || '', origin_protocol || 'follow', Number(http_port || 80), Number(https_port || 443)))) {
      return { code: -1, msg: '回源配置更新失败，' + provider.getError() };
    }
    await query(
      `UPDATE ${table('cdn_domain')} SET origin = ?, origin_type = ?, origin_host = ?, origin_protocol = ?, http_port = ?, https_port = ? WHERE id = ?`,
      [origin, origin_type || 'ipaddr', origin_host || '', origin_protocol || 'follow', Number(http_port || 80), Number(https_port || 443), id],
    );
    return { code: 0, msg: '回源配置更新成功' };
  });

  // 缓存规则
  app.post('/api/cdn/domains/:id/cache', auth, async (req: any) => {
    const { id } = req.params as any;
    const { rules } = req.body || {};
    const ruleList = Array.isArray(rules) ? rules : [];
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.setCacheRules(row.name, ruleList))) return { code: -1, msg: '缓存规则更新失败，' + provider.getError() };
    await query(`DELETE FROM ${table('cdn_cache_rule')} WHERE did = ?`, [id]);
    for (const r of ruleList) {
      const path = (r.path || '').trim();
      if (!path) continue;
      await query(`INSERT INTO ${table('cdn_cache_rule')} (did, path, ttl, addtime) VALUES (?, ?, ?, NOW())`, [id, path, Number(r.ttl || 0)]);
    }
    return { code: 0, msg: '缓存规则更新成功' };
  });

  // HTTPS
  app.post('/api/cdn/domains/:id/https', auth, async (req: any) => {
    const { id } = req.params as any;
    const { https_enabled, force_redirect } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider = await cdnForRow(row);
    if (!provider) return { code: -1, msg: 'CDN账户不存在' };
    if (!(await provider.setHttps(row.name, !!https_enabled, !!force_redirect))) return { code: -1, msg: 'HTTPS 配置更新失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_domain')} SET https_enabled = ?, force_redirect = ? WHERE id = ?`, [https_enabled ? 1 : 0, force_redirect ? 1 : 0, id]);
    return { code: 0, msg: 'HTTPS 配置更新成功' };
  });

  // 免费证书 DNS 委派验证：联动域名在本系统内时尝试自动添加验证记录
  async function addVerifyRecord(row: any, rec: any): Promise<string> {
    const dnsDomain = await queryOne(`SELECT * FROM ${table('domain')} WHERE id = ?`, [row.did]);
    if (!dnsDomain) return '未找到联动域名，请手动添加验证记录';
    const dnsAcct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [dnsDomain.aid]);
    if (!dnsAcct) return 'DNS账户不存在，请手动添加验证记录';
    const dns = getDnsProvider(dnsAcct.type, safeJson(dnsAcct.config), dnsDomain.name, dnsDomain.thirdid);
    if (!dns) return 'DNS模块不存在，请手动添加验证记录';
    const rel = calcRecordName(row.name, dnsDomain.name);
    const name = rel === '@' ? rec.name : `${rec.name}.${rel}`;
    const recordId = await dns.addDomainRecord(name, rec.type, rec.value, 'default', 600);
    if (recordId) return `已自动添加验证解析 ${name} ${rec.type} ${rec.value}`;
    return `自动添加验证解析失败（${dns.getError()}），请手动添加 ${name} ${rec.type} ${rec.value}`;
  }

  async function runFreeCert(ids: number[], checkOnly: boolean): Promise<any[]> {
    const results: any[] = [];
    for (const id of ids) {
      const row = await loadCdnDomain(id);
      if (!row) {
        results.push({ id, status: 'failed', message: '加速域名不存在' });
        continue;
      }
      const name = row.name;
      const provider: any = await cdnForRow(row);
      if (!provider) {
        results.push({ id, name, status: 'failed', message: 'CDN账户不存在' });
        continue;
      }
      const fn = checkOnly ? provider.checkFreeCert : provider.applyFreeCert;
      if (typeof fn !== 'function') {
        results.push({ id, name, status: 'failed', message: '该厂商暂不支持配置平台免费证书' });
        continue;
      }
      let r: any;
      try {
        r = await fn.call(provider, row.name);
      } catch (e: any) {
        r = { status: 'failed', message: e?.message || String(e) };
      }
      let message = r?.message || '';
      if (r?.status === 'applied') {
        await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [id]);
        message = checkOnly ? '免费证书已部署' : '免费证书已申请并部署';
      } else if (r?.status === 'pending' && Array.isArray(r.records) && r.records.length) {
        const notes: string[] = [];
        for (const rec of r.records) notes.push(await addVerifyRecord(row, rec));
        message = (message || '需完成域名验证') + '；' + notes.join('；');
      }
      results.push({ id, name, status: r?.status || 'failed', message, records: r?.records || [] });
    }
    return results;
  }

  // 批量为加速域名申请平台免费证书（如腾讯云 EdgeOne 免费证书）
  app.post('/api/cdn/domains/freecert', auth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要配置免费证书的加速域名' };
    const data = await runFreeCert(ids, false);
    return { code: 0, msg: summarizeResults(data, '待验证'), data };
  });

  // 检查免费证书申请结果，通过后部署到加速域名
  app.post('/api/cdn/domains/freecert/check', auth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要检查的加速域名' };
    const data = await runFreeCert(ids, true);
    return { code: 0, msg: summarizeResults(data, '待验证'), data };
  });

  // ===== 联动证书申请：按站点申请一张通配符证书，签发后直传站点并启用 HTTPS =====

  async function runCertLink(ids: number[], checkOnly: boolean): Promise<any[]> {
    const aid = Number(await configGet('cdn_cert_aid', '0')) || 0;
    const account = aid ? await queryOne(`SELECT * FROM ${table('cert_account')} WHERE id = ? AND deploy = 0`, [aid]) : null;
    const results: any[] = [];
    for (const id of ids) {
      const row = await loadCdnDomain(id);
      if (!row) {
        results.push({ id, status: 'failed', message: '加速域名不存在' });
        continue;
      }
      const provider: any = await cdnForRow(row);
      if (!provider || typeof provider.getCertScope !== 'function' || typeof provider.getCertDeployPlan !== 'function') {
        results.push({ id, name: row.name, status: 'failed', message: '该厂商暂不支持联动证书申请' });
        continue;
      }
      const scope = await provider.getCertScope(row.name);
      if (!scope) {
        results.push({ id, name: row.name, status: 'failed', message: '未找到该域名的 ESA 站点，请先在阿里云 ESA 控制台创建站点' });
        continue;
      }
      if (!aid || !account) {
        results.push({ id, name: row.name, status: 'failed', message: '请先在「自动续签设置」中指定用于申请证书的账户' });
        continue;
      }
      if (!certConfig[account.type]?.wildcard) {
        results.push({ id, name: row.name, status: 'failed', message: `证书账户「${account.name}」不支持通配符证书，请更换 ACME 类账户` });
        continue;
      }
      const rootRow = await queryOne(`SELECT id FROM ${table('domain')} WHERE name = ?`, [scope.siteName]);
      if (!rootRow) {
        results.push({ id, name: row.name, status: 'failed', message: `根域名 ${scope.siteName} 未在本系统添加，无法自动完成 DNS 验证` });
        continue;
      }
      const order = await ensureWildcardOrder(aid, scope.domains);
      const deploy: any = await ensureCertDeploy(provider, row, scope, Number(order.id)).catch(() => false);
      const status = Number(order.status);
      if (status !== 3) {
        let message: string;
        if (status < 0) {
          message = `证书订单处理失败：${order.error || '未知错误'}`;
        } else if (deploy) {
          message = '证书尚在申请中，已创建自动部署任务，签发后会自动上传并绑定；也可稍后点击「检查并部署」立即处理';
        } else {
          message = checkOnly ? '证书尚未签发完成，请稍后再检查' : '已提交证书申请，系统将自动完成 DNS 验证与签发，签发后点击「检查并部署」完成上传';
        }
        results.push({ id, name: row.name, status: status < 0 ? 'failed' : 'pending', message, order_id: order.id, domains: scope.domains });
        continue;
      }
      // 已签发：优先执行自动部署任务（与续签同一条链路），无计划时回退直传
      let applied = false;
      let message = '';
      if (deploy?.taskId) {
        let err = '';
        try {
          await new CertDeployService(deploy.taskId).process(true);
        } catch (e: any) {
          err = e?.message || String(e);
        }
        const task = await queryOne(`SELECT status, error FROM ${table('cert_deploy')} WHERE id = ?`, [deploy.taskId]);
        applied = Number(task?.status) === 1;
        message = applied ? '证书已部署，后续续签将自动更新' : task?.error || err || '证书部署失败';
      } else {
        message = '无法创建自动部署任务，请检查该 CDN 类型是否支持证书联动';
      }
      if (applied) {
        await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [id]);
      }
      results.push({ id, name: row.name, status: applied ? 'applied' : 'failed', message, order_id: order.id, domains: scope.domains });
    }
    return results;
  }

  // 按站点申请/复用通配符证书，已签发则直传 ESA 站点
  app.post('/api/cdn/domains/cert', auth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要申请证书的加速域名' };
    const data = await runCertLink(ids, false);
    return { code: 0, msg: summarizeResults(data, '待签发'), data };
  });

  // 检查通配符证书签发结果，已签发则直传 ESA 站点
  app.post('/api/cdn/domains/cert/check', auth, async (req: any) => {
    const ids = parseIds(req.body?.ids);
    if (!ids.length) return { code: -1, msg: '请选择要检查的加速域名' };
    const data = await runCertLink(ids, true);
    return { code: 0, msg: summarizeResults(data, '待签发'), data };
  });

  // ===== 与项目联动：精确子域名证书选择 / 签发 / 自动部署 =====

  const DEFAULT_LE_EMAIL = 'ssdxftx@gmail.com';

  // 查找或创建默认 Let's Encrypt 账户（固定邮箱）
  async function defaultLetsEncryptAid(): Promise<number> {
    const rows = await query(`SELECT id, config FROM ${table('cert_account')} WHERE type = 'letsencrypt' AND deploy = 0`);
    for (const r of rows as any[]) {
      if (safeJson(r.config).email === DEFAULT_LE_EMAIL) return Number(r.id);
    }
    const cfg = JSON.stringify({ email: DEFAULT_LE_EMAIL, mode: 'live', proxy: '0' });
    const res: any = await query(
      `INSERT INTO ${table('cert_account')} (type, name, config, remark, deploy, addtime) VALUES ('letsencrypt', ?, ?, ?, 0, NOW())`,
      ["默认Let's Encrypt", cfg, '由 CDN 证书联动自动创建'],
    );
    return Number(res?.insertId || 0);
  }

  // 为加速域名选择已有证书或新建精确子域名证书，并创建自动部署任务
  async function applyCertLink(domainId: number, provider: any, opts: { certOrderId?: any; certAid?: any; useDefault?: boolean }): Promise<any> {
    const row = await loadCdnDomain(domainId);
    if (!row) return { status: 'failed', message: '加速域名不存在' };
    if (!provider || typeof provider.getCertScope !== 'function' || typeof provider.getCertDeployPlan !== 'function') {
      return { status: 'failed', message: '该厂商不支持与项目联动' };
    }
    const scope = await provider.getCertScope(row.name);
    if (!scope) return { status: 'failed', message: '未找到该域名的加速站点，请先在控制台创建站点' };
    const need = domainToASCII(row.name.toLowerCase());

    const orderId = Number(opts.certOrderId || 0);
    if (orderId) {
      const order = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [orderId]);
      if (!order) return { status: 'failed', message: '所选证书不存在' };
      if (Number(order.status) !== 3 || !order.fullchain || !order.privatekey) return { status: 'failed', message: '所选证书尚未签发完成' };
      const exact = await queryOne(`SELECT id FROM ${table('cert_domain')} WHERE oid = ? AND LOWER(domain) = ?`, [orderId, need]);
      if (!exact) return { status: 'failed', message: `所选证书未精确包含 ${row.name}，不能用于该域名` };
      // 记录联动，续签后仍自动更新
      await query(`UPDATE ${table('cert_order')} SET link = ? WHERE id = ?`, [JSON.stringify({ cdnDomainId: domainId }), orderId]);
      const task: any = await ensureCertDeploy(provider, row, scope, orderId).catch(() => false);
      if (!task) return { status: 'failed', message: '创建自动部署任务失败' };
      try {
        await new CertDeployService(task.taskId).process(true);
      } catch {
        // 具体错误从任务记录读取，确保不静默失败
      }
      const t = await queryOne(`SELECT status, error FROM ${table('cert_deploy')} WHERE id = ?`, [task.taskId]);
      if (Number(t?.status) === 1) {
        await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [domainId]);
        return { status: 'applied', message: `已使用项目证书并部署到 ${row.name}` };
      }
      return { status: 'failed', message: t?.error || '证书部署失败，可在自动部署任务中重试' };
    }

    // 新建精确子域名订单（不含根域/通配符/额外 SAN）
    let aid = Number(opts.certAid || 0);
    if (!aid && opts.useDefault) aid = await defaultLetsEncryptAid();
    if (!aid) return { status: 'failed', message: '请选择证书提供商' };
    const account = await queryOne(`SELECT * FROM ${table('cert_account')} WHERE id = ? AND deploy = 0`, [aid]);
    if (!account) return { status: 'failed', message: '证书提供商不存在' };
    if (!providerReady(account.type, safeJson(account.config))) return { status: 'failed', message: `证书提供商「${account.name}」密钥未配置完整` };
    const order = await ensureExactOrder(aid, row.name, JSON.stringify({ cdnDomainId: domainId }));
    if (Number(order.status) === 3) {
      const task: any = await ensureCertDeploy(provider, row, scope, Number(order.id)).catch(() => false);
      if (task) await new CertDeployService(task.taskId).process(true).catch(() => undefined);
      await query(`UPDATE ${table('cdn_domain')} SET https_enabled = 1 WHERE id = ?`, [domainId]);
      return { status: 'applied', message: `已复用已签发证书并部署到 ${row.name}` };
    }
    return { status: 'pending', message: `已提交证书签发（仅包含 ${row.name}），签发后将自动部署到 CDN`, order_id: order.id };
  }

  // 与项目联动 - 证书候选：精确匹配的已签发证书 + 可用签发提供商（无则默认 Let's Encrypt）
  app.get('/api/cdn/cert/candidates', auth, async (req: any) => {
    const raw = String(req.query?.name || '').trim();
    if (!raw) return { code: -1, msg: '请提供加速域名' };
    const exact = await findExactCertOrders(raw);
    const accts = await query(`SELECT * FROM ${table('cert_account')} WHERE deploy = 0 ORDER BY id ASC`);
    const providers = (accts as any[])
      .filter((a) => providerReady(a.type, safeJson(a.config)))
      .map((a) => ({ aid: Number(a.id), type: a.type, typename: certConfig[a.type]?.name || a.type, name: a.name }));
    let defaultLe: any = null;
    if (!providers.length) {
      const aid = await defaultLetsEncryptAid();
      defaultLe = { aid, email: DEFAULT_LE_EMAIL, typename: certConfig['letsencrypt']?.name || "Let's Encrypt" };
    }
    return { code: 0, data: { name: raw, exact, providers, defaultLe } };
  });

  // 对已接入的加速域名执行「与项目联动」（选择已有证书或新建签发）
  app.post('/api/cdn/domains/:id/certlink', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider: any = await cdnForRow(row);
    const { cert_order_id, cert_aid, cert_use_default } = req.body || {};
    const r = await applyCertLink(Number(id), provider, { certOrderId: cert_order_id, certAid: cert_aid, useDefault: !!cert_use_default });
    return { code: r.status === 'failed' ? -1 : 0, msg: r.message, data: r };
  });

  // 同步云端
  app.post('/api/cdn/sync', auth, async (req: any) => {
    const { aid, did } = req.body || {};
    return syncFromCloud(Number(aid || 0), Number(did || 0));
  });

  // 站点全局配置保存
  app.post('/api/cdn/domains/:id/zone_setting', auth, async (req: any) => {
    const { id } = req.params as any;
    const { setting } = req.body || {};
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    if (!row.zone_id) return { code: -1, msg: '该加速域名无站点信息' };
    const provider: any = await cdnForRow(row);
    if (!provider || typeof provider.getZoneSetting !== 'function' || typeof provider.updateZoneSetting !== 'function') {
      return { code: -1, msg: '该厂商不支持站点级配置' };
    }
    if (!setting || typeof setting !== 'object') return { code: -1, msg: '配置数据无效' };
    const current = await provider.getZoneSetting(row.zone_id);
    if (current === false) return { code: -1, msg: '获取当前站点配置失败，' + provider.getError() };
    const diff = zoneSettingDiff(current, setting);
    if (!Object.keys(diff).length) return { code: 0, msg: '未检测到配置变化' };
    if (!(await provider.updateZoneSetting(row.zone_id, diff))) return { code: -1, msg: '站点配置更新失败，' + provider.getError() };
    return { code: 0, msg: '站点配置更新成功' };
  });

  // CDN 数据统计（加速流量 / 带宽 / 请求数 / 缓存命中 / 状态码）
  app.get('/api/cdn/statistics', auth, async (req: any) => {
    const q = req.query || {};
    const type = ['Resource', 'Visits', 'HttpCodeStatus', 'All'].includes(String(q.type)) ? String(q.type) : 'All';
    const start = parseStatTime(q.startTime);
    const end = parseStatTime(q.endTime);
    if (!start || !end) return { code: -1, msg: '时间参数无效，格式：2026-01-01 00:00:00' };
    if (end.getTime() <= start.getTime()) return { code: -1, msg: '结束时间需大于开始时间' };

    const domainNames = String(q.domains || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const aid = Number(q.aid || 0);

    const where: string[] = [];
    const params: any[] = [];
    if (domainNames.length) {
      where.push(`name IN (${domainNames.map(() => '?').join(',')})`);
      params.push(...domainNames);
    }
    if (aid) {
      where.push('aid = ?');
      params.push(aid);
    }
    const sql = `SELECT * FROM ${table('cdn_domain')}` + (where.length ? ` WHERE ${where.join(' AND ')}` : '');
    const rows = await query(sql, params);
    if (!rows.length) return { code: 0, data: { labels: [] } };

    const accounts: Record<number, any> = {};
    const groups: Record<string, { route: string; config: Record<string, any>; domains: StatisticsDomain[] }> = {};
    for (const row of rows as any[]) {
      if (!hasCdnStatistics(row.route)) continue;
      if (!accounts[row.aid]) accounts[row.aid] = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [row.aid]);
      const acct = accounts[row.aid];
      if (!acct) continue;
      const groupKey = `${row.route}#${row.aid}`;
      if (!groups[groupKey]) groups[groupKey] = { route: row.route, config: safeJson(acct.config), domains: [] };
      groups[groupKey].domains.push({ name: row.name, route: row.route, zoneId: row.zone_id, serviceArea: row.service_area });
    }

    let merged: any = null;
    const errors: string[] = [];
    for (const key of Object.keys(groups)) {
      const group = groups[key];
      try {
        const part = await queryByRoute(group.route, group.config, group.domains, start, end, type);
        if (!part.labels.length) continue;
        merged = merged ? mergeResult(merged, part) : part;
      } catch (e: any) {
        errors.push(`${group.route}: ${e?.message || e}`);
      }
    }
    if (!merged) return { code: 0, data: { labels: [], _errors: errors } };
    ensureSections(merged, type, merged.labels.length);
    if (errors.length) (merged as any)._errors = errors;
    return { code: 0, data: merged };
  });

  // 按域名分组分发刷新/预热操作
  async function dispatchCacheOp(op: 'purge' | 'preheat', type: string, urls: string[]) {
    const grouped: Record<string, { route: string; provider: any; urls: string[] }> = {};
    const failed: { url: string; msg: string }[] = [];
    for (const url of urls) {
      const domain = domainFromUrl(url);
      if (!domain) {
        failed.push({ url, msg: 'URL 格式错误' });
        continue;
      }
      const row = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE name = ?`, [domain]);
      if (!row) {
        failed.push({ url, msg: `未找到加速域名 ${domain}` });
        continue;
      }
      const provider: any = await cdnForRow(row);
      if (!provider) {
        failed.push({ url, msg: 'CDN 账户不存在' });
        continue;
      }
      const key = `${row.route}#${row.aid}`;
      if (!grouped[key]) grouped[key] = { route: row.route, provider, urls: [] };
      grouped[key].urls.push(url);
    }

    const success: { url: string; taskId: string | null }[] = [];
    for (const key of Object.keys(grouped)) {
      const g = grouped[key];
      const fn = g.provider ? g.provider[op] : undefined;
      if (typeof fn !== 'function') {
        for (const u of g.urls) failed.push({ url: u, msg: '该厂商暂不支持此操作' });
        continue;
      }
      const taskId = op === 'purge' ? await fn(g.urls, type) : await fn(g.urls);
      const status = taskId === false ? 1 : 0;
      const errMsg = taskId === false ? g.provider.getError?.() || '提交失败' : null;
      for (const u of g.urls) {
        if (taskId === false) {
          failed.push({ url: u, msg: errMsg || '提交失败' });
        } else {
          success.push({ url: u, taskId: typeof taskId === 'string' ? taskId : null });
        }
        const taskType = type === 'dir' ? 'dir' : op === 'preheat' ? 'preheat' : 'url';
        await query(
          `INSERT INTO ${table('cdn_cache_task')} (url, type, provider, task_id, status, msg, addtime) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [u, taskType, g.route, typeof taskId === 'string' ? taskId : null, status, errMsg],
        );
      }
    }
    return { success, failed };
  }

  // 缓存刷新
  app.post('/api/cdn/purge', auth, async (req: any) => {
    const { type, urls } = req.body || {};
    const list = dedupe(Array.isArray(urls) ? urls : []);
    if (!list.length) return { code: -1, msg: '请填写需要刷新的 URL' };
    const result = await dispatchCacheOp('purge', type === 'dir' ? 'dir' : 'url', list);
    return { code: 0, ...result };
  });

  // 缓存预热
  app.post('/api/cdn/preheat', auth, async (req: any) => {
    const { urls } = req.body || {};
    const list = dedupe(Array.isArray(urls) ? urls : []);
    if (!list.length) return { code: -1, msg: '请填写需要预热的 URL' };
    const result = await dispatchCacheOp('preheat', 'preheat', list);
    return { code: 0, ...result };
  });

  // 刷新/预热历史
  app.get('/api/cdn/cache-tasks', auth, async () => {
    const rows = await query(`SELECT * FROM ${table('cdn_cache_task')} ORDER BY id DESC LIMIT 200`);
    return { code: 0, data: rows };
  });

  // 访问控制 - 查询
  app.get('/api/cdn/domains/:id/access', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const def = { referer_mode: 'off', referer_list: [], ip_mode: 'off', ip_list: [], ua_list: [] };
    const provider: any = await cdnForRow(row);
    if (provider && typeof provider.getAccess === 'function') {
      const cfg = await provider.getAccess(row.name);
      if (cfg) return { code: 0, data: { ...def, ...cfg } };
    }
    return { code: 0, data: def };
  });

  // 访问控制 - 保存
  app.post('/api/cdn/domains/:id/access', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await loadCdnDomain(id);
    if (!row) return { code: -1, msg: '加速域名不存在' };
    const provider: any = await cdnForRow(row);
    if (!provider || typeof provider.setAccess !== 'function') return { code: -1, msg: '该厂商暂不支持访问控制配置' };
    if (!(await provider.setAccess(row.name, req.body || {}))) return { code: -1, msg: '访问控制更新失败，' + (provider.getError?.() || '') };
    return { code: 0, msg: '访问控制更新成功' };
  });
}

async function syncFromCloud(aid: number, did: number): Promise<any> {
  const account = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
  if (!account) return { code: -1, msg: 'CDN账户不存在', added: 0, skipped: 0, updated: 0 };
  const provider: any = getCdnProvider(account.type, safeJson(account.config));
  if (!provider) return { code: -1, msg: 'CDN模块不存在', added: 0, skipped: 0, updated: 0 };

  const list = await provider.listDomains();
  if (list === false) return { code: -1, msg: '获取云端加速域名失败，' + provider.getError(), added: 0, skipped: 0, updated: 0 };

  const dnsRows = await query(`SELECT * FROM ${table('domain')}`);
  const dnsMap: Record<string, any> = {};
  for (const d of dnsRows) dnsMap[d.name] = d;

  let filterDnsName: string | null = null;
  for (const d of dnsRows as any[]) if (d.id == did) filterDnsName = d.name;

  let added = 0;
  let skipped = 0;
  let updated = 0;
  let dnsOk = 0;
  let dnsFail = 0;

  for (const item of list) {
    const name = (item.domain || '').trim();
    if (!name) continue;
    if (filterDnsName !== null) {
      const suffix = '.' + filterDnsName;
      if (name !== filterDnsName && !name.endsWith(suffix)) continue;
    }
    const exists = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE name = ?`, [name]);
    if (exists) {
      const upd: Record<string, any> = {};
      if (!exists.origin && item.origin) {
        upd.origin = item.origin;
        upd.origin_type = item.origin_type || 'ipaddr';
        upd.origin_host = item.origin_host || '';
        upd.origin_protocol = item.origin_protocol || 'follow';
        upd.http_port = Number(item.http_port || 80);
        upd.https_port = Number(item.https_port || 443);
        if (item.cname) upd.cname = item.cname;
      }
      if ('https_enabled' in item) {
        const cloudHttps = !!item.https_enabled;
        const cloudForce = !!item.force_redirect;
        if (cloudHttps !== !!exists.https_enabled || cloudForce !== !!exists.force_redirect) {
          upd.https_enabled = cloudHttps ? 1 : 0;
          upd.force_redirect = cloudForce ? 1 : 0;
        }
      }
      if (Object.keys(upd).length) {
        const fields = Object.keys(upd).map((k) => `${k} = ?`).join(', ');
        await query(`UPDATE ${table('cdn_domain')} SET ${fields} WHERE id = ?`, [...Object.values(upd), exists.id]);
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    let belongDomain: any = null;
    let recordName = '@';
    for (const dnsName of Object.keys(dnsMap)) {
      const d = dnsMap[dnsName];
      if (name === dnsName) {
        belongDomain = d;
        break;
      }
      const suffix = '.' + dnsName;
      if (name.endsWith(suffix)) {
        belongDomain = d;
        recordName = name.slice(0, name.length - suffix.length);
        break;
      }
    }

    const cname = item.cname || '';
    let dnsRecord: string | null = null;
    if (belongDomain && cname) {
      const dnsAcct = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [belongDomain.aid]);
      if (dnsAcct) {
        const dns = getDnsProvider(dnsAcct.type, safeJson(dnsAcct.config), belongDomain.name, belongDomain.thirdid);
        if (dns) {
          const recordId = await dns.addDomainRecord(recordName, 'CNAME', cname, 'default', 600);
          if (recordId) {
            dnsRecord = String(recordId);
            dnsOk++;
          } else dnsFail++;
        } else dnsFail++;
      } else dnsFail++;
    }

    await query(
      `INSERT INTO ${table('cdn_domain')} (aid, did, name, route, zone_id, origin, origin_type, origin_host, origin_protocol, http_port, https_port, service_area, cname, dns_record, status, https_enabled, force_redirect, addtime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        aid,
        belongDomain ? belongDomain.id : 0,
        name,
        account.type,
        item.zoneId || null,
        item.origin || '',
        item.origin_type || 'ipaddr',
        item.origin_host || '',
        item.origin_protocol || 'follow',
        Number(item.http_port || 80),
        Number(item.https_port || 443),
        areaMap[item.area || ''] || 'mainland_china',
        cname || null,
        dnsRecord,
        item.status === 'offline' ? 'offline' : 'online',
        item.https_enabled ? 1 : 0,
        item.force_redirect ? 1 : 0,
      ],
    );
    added++;
  }

  let msg = `同步完成：新增 ${added} 个，已存在 ${skipped} 个`;
  if (updated > 0) msg += `，补全云端配置 ${updated} 个`;
  if (added > 0 && (dnsOk > 0 || dnsFail > 0)) {
    msg += `；自动添加 CNAME 解析成功 ${dnsOk} 个`;
    if (dnsFail > 0) msg += `，失败 ${dnsFail} 个，请手动添加解析`;
  }
  return { code: 0, msg, added, skipped, updated, dnsOk, dnsFail };
}