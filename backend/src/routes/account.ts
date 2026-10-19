import type { FastifyInstance } from 'fastify';
import { query, queryOne, table, withTransaction } from '../db.js';
import { checkLevel } from '../auth.js';
import { getDnsProvider, dnsProviders } from '../lib/dns/factory.js';
import { getCdnProvider, cdnConfig, getCdnConfigList } from '../lib/cdn/factory.js';
import { ConfigDecryptError, decryptConfig, encryptConfig, isEncryptedConfig, isSecretKey, maskConfig, mergeMaskedConfig, SECRET_MASK } from '../lib/secret.js';
import { bumpCdnAccountEpoch } from '../lib/cdn/cacheEpoch.js';
import { audit } from '../lib/audit/context.js';
import { diffFields } from '../lib/audit/mask.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function isAdmin(user: any): boolean {
  return checkLevel(user, 2);
}

export default async function accountRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // ============ DNS 账户 ============
  app.get('/api/dns/providers', auth, async () => {
    return { code: 0, data: dnsProviders };
  });

  app.get('/api/dns/accounts', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const rows = await query(`SELECT id, type, name, config, remark, addtime FROM ${table('account')} ORDER BY id DESC`);
    return {
      code: 0,
      data: rows.map((r: any) => {
        const cfg = decryptConfig(r.config);
        return { ...r, config: maskConfig(cfg), config_error: !cfg && isEncryptedConfig(r.config) };
      }),
    };
  });

  app.post('/api/dns/accounts', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { type, name, config, remark } = req.body || {};
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    const exists = await queryOne(`SELECT id FROM ${table('account')} WHERE type = ? AND name = ?`, [type, name]);
    if (exists) return { code: -1, msg: '账户已存在' };
    const missing = missingRequiredSecret(type, config);
    if (missing.length) return { code: -1, msg: `请填写：${missing.join('、')}` };
    const provider = getDnsProvider(type, config, '', null);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证账户失败，' + provider.getError() };
    const id = await insertAndGetId(`INSERT INTO ${table('account')} (type, name, config, remark, addtime) VALUES (?, ?, ?, ?, NOW())`, [
      type, name, encryptConfig(config), remark || '',
    ]);
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: String(name),
      summary: `新增 ${type} 账户「${name}」`,
      detail: { type, name },
    });
    return { code: 0, msg: '添加账户成功', data: id };
  });

  app.put('/api/dns/accounts/:id', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const { type, name, config, remark } = req.body || {};
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    const row: any = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '账户不存在' };
    // 前端回显的是掩码，敏感字段保持不变
    const merged = mergeMaskedConfig(config, decryptConfig(row.config));
    const missing = missingRequiredSecret(type, merged);
    if (missing.length) return { code: -1, msg: `请填写：${missing.join('、')}` };
    const provider = getDnsProvider(type, merged, '', null);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证账户失败，' + provider.getError() };
    await query(`UPDATE ${table('account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [
      type, name, encryptConfig(merged), remark || '', id,
    ]);
    const beforeCfg = decryptConfig(row.config) || {};
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: String(name),
      summary: `修改 ${type} 账户「${name}」`,
      changes: [
        ...diffFields({ name: row.name, remark: row.remark }, { name, remark }, { name: '名称', remark: '备注' }),
        ...(secretChanged(beforeCfg, merged) ? [{ field: '凭证', to: '已更新' }] : []),
      ],
      detail: { type, name },
    });
    return { code: 0, msg: '修改账户成功' };
  });

  app.delete('/api/dns/accounts/:id', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const dcount = await queryOne(`SELECT COUNT(*) c FROM ${table('domain')} WHERE aid = ?`, [id]);
    if (dcount && dcount.c > 0) return { code: -1, msg: '该账户下存在域名，无法删除' };
    const row: any = await queryOne(`SELECT name, type FROM ${table('account')} WHERE id = ?`, [id]);
    await query(`DELETE FROM ${table('account')} WHERE id = ?`, [id]);
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: String(row?.name || ''),
      summary: `删除账户「${row?.name || '#' + id}」`,
    });
    return { code: 0, msg: '删除成功' };
  });

  // ============ CDN 账户 ============
  app.get('/api/cdn/providers', auth, async () => {
    return { code: 0, data: getCdnConfigList() };
  });

  app.get('/api/cdn/accounts', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const rows = await query(`SELECT id, type, name, config, remark, addtime FROM ${table('cdn_account')} ORDER BY id DESC`);
    const typeNames = Object.fromEntries(Object.entries(cdnConfig).map(([k, v]) => [k, v.name]));
    const data = rows.map((r: any) => ({ ...r, config: maskConfig(decryptConfig(r.config)), typename: typeNames[r.type] || r.type }));
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { type, name, config, remark } = req.body || {};
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    const exists = await queryOne(`SELECT id FROM ${table('cdn_account')} WHERE type = ? AND name = ?`, [type, name]);
    if (exists) return { code: -1, msg: 'CDN账户已存在' };
    const provider = getCdnProvider(type, config);
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证CDN账户失败，' + provider.getError() };
    const id = await insertAndGetId(`INSERT INTO ${table('cdn_account')} (type, name, config, remark, addtime) VALUES (?, ?, ?, ?, NOW())`, [
      type, name, encryptConfig(config), remark || '',
    ]);
    bumpCdnAccountEpoch();
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: String(name),
      summary: `新增 CDN 账户「${name}」`,
      detail: { type, name },
    });
    return { code: 0, msg: '添加CDN账户成功', data: id };
  });

  app.put('/api/cdn/accounts/:id', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const { type, name, config, remark } = req.body || {};
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    const row: any = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: 'CDN账户不存在' };
    const merged = mergeMaskedConfig(config, decryptConfig(row.config));
    const provider = getCdnProvider(type, merged);
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证CDN账户失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [
      type, name, encryptConfig(merged), remark || '', id,
    ]);
    bumpCdnAccountEpoch();
    const beforeCfg = decryptConfig(row.config) || {};
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: String(name),
      summary: `修改 CDN 账户「${name}」`,
      changes: [
        ...diffFields({ name: row.name, remark: row.remark }, { name, remark }, { name: '名称', remark: '备注' }),
        ...(secretChanged(beforeCfg, merged) ? [{ field: '凭证', to: '已更新' }] : []),
      ],
      detail: { type, name },
    });
    return { code: 0, msg: '修改CDN账户成功' };
  });

  app.delete('/api/cdn/accounts/:id', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const dcount = await queryOne(`SELECT COUNT(*) c FROM ${table('cdn_domain')} WHERE aid = ?`, [id]);
    const row: any = await queryOne(`SELECT name, type FROM ${table('cdn_account')} WHERE id = ?`, [id]);
    // 级联清理关联数据并置于同一事务，避免遗留缓存规则/统计数据等孤儿记录
    await withTransaction(async (q) => {
      await q(`DELETE FROM ${table('cdn_cache_rule')} WHERE did IN (SELECT id FROM ${table('cdn_domain')} WHERE aid = ?)`, [id]);
      await q(`DELETE FROM ${table('cdn_stat_data')} WHERE aid = ?`, [id]);
      await q(`DELETE FROM ${table('cdn_domain')} WHERE aid = ?`, [id]);
      await q(`DELETE FROM ${table('cdn_account')} WHERE id = ?`, [id]);
    });
    bumpCdnAccountEpoch();
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: String(row?.name || ''),
      summary: `删除 CDN 账户「${row?.name || '#' + id}」`,
    });
    return { code: 0, msg: '删除成功' + (dcount && dcount.c > 0 ? '，已一并删除 ' + dcount.c + ' 个加速域名' : '') };
  });

  app.get('/api/cdn/accounts/:id/zones', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [id]);
    if (!acct) return { code: -1, msg: 'CDN账户不存在' };
    const provider = getCdnProvider(acct.type, safeJson(acct.config));
    if (!provider || typeof provider.getZones !== 'function') return { code: -1, msg: '该账户不支持站点查询' };
    const zones = await provider.getZones();
    return { code: 0, data: zones };
  });
}

function secretChanged(before: Record<string, any>, after: Record<string, any>): boolean {
  for (const k of Object.keys(after || {})) {
    if (isSecretKey(k) && String(before?.[k] ?? '') !== String(after?.[k] ?? '')) return true;
  }
  return false;
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

/** 必填敏感字段校验：缺失或仍是掩码时拒绝保存，避免写入残缺配置 */
function missingRequiredSecret(type: string, config: any): string[] {
  const meta = dnsProviders[type];
  if (!meta) return [];
  return Object.entries(meta.config)
    .filter(([k, f]: any) => f.required && isSecretKey(k))
    .filter(([k]: any) => {
      const v = config?.[k];
      return v === undefined || v === null || v === '' || v === SECRET_MASK;
    })
    .map(([, f]: any) => f.name);
}

async function insertAndGetId(sql: string, params: any[]): Promise<number> {
  const r = await query(sql, params);
  return (r as any).insertId || 0;
}