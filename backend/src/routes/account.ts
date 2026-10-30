import type { FastifyInstance } from 'fastify';
import { query, queryOne, table, withTransaction } from '../db.js';
import { checkLevel } from '../auth.js';
import { getDnsProvider, dnsProviders, ADMIN_ONLY_DNS_TYPES } from '../lib/dns/factory.js';
import { getCdnProvider, cdnConfig, getCdnConfigList, pickCdnConfig } from '../lib/cdn/factory.js';
import { encryptAccountConfig, isSecretKey, maskConfig, mergeMaskedConfig, readAccountConfig, SECRET_MASK } from '../lib/secret.js';
import { getVisibleAccount, listVisibleAccounts } from '../lib/accounts/visibility.js';
import { getDekForWrite } from '../lib/vault/service.js';
import { bumpCdnAccountEpoch } from '../lib/cdn/cacheEpoch.js';
import { audit } from '../lib/audit/context.js';
import { diffFields } from '../lib/audit/mask.js';
import { asText } from '../lib/util.js';
import { hitRateLimitDistributed } from '../lib/rateLimit.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function isAdmin(user: any): boolean {
  return checkLevel(user, 2);
}

function privateDnsTypeBlocked(user: any, type: string): string | null {
  if (isAdmin(user)) return null;
  if (ADMIN_ONLY_DNS_TYPES.has(String(type || ''))) {
    return '该 DNS 平台支持自定义内网地址，仅管理员可接入';
  }
  return null;
}

export default async function accountRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // ============ DNS 账户 ============
  app.get('/api/dns/providers', auth, async () => {
    return { code: 0, data: dnsProviders };
  });

  app.get('/api/dns/accounts', auth, async (req: any) => {
    const rows = await listVisibleAccounts('account', req.user);
    const dek = await getDekForWrite(Number(req.user.uid), String(req.user.jti || ''));
    return {
      code: 0,
      data: rows.map((r: any) => {
        const { config, state } = readAccountConfig(r.config, dek);
        return {
          ...r,
          config: maskConfig(config),
          config_error: state === 'error',
          config_state: state,
          is_owner: Number(r.owner_uid) === Number(req.user.uid),
        };
      }),
    };
  });

  app.post('/api/dns/accounts', auth, async (req: any) => {
    const b = req.body || {};
    const type = asText(b.type, 64);
    const name = asText(b.name, 128);
    const config = b.config;
    const remark = asText(b.remark, 255);
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    if (typeof config !== 'object' || config === null || Array.isArray(config)) return { code: -1, msg: '账户配置格式不正确' };
    if (!(await hitRateLimitDistributed(`cloud:account-check:${req.user.uid}`, 20, 60_000))) {
      return { code: -1, msg: '账户校验过于频繁，请稍后再试' };
    }
    const isPrivate = !isAdmin(req.user);
    const typeBlocked = privateDnsTypeBlocked(req.user, String(type));
    if (typeBlocked) return { code: -1, msg: typeBlocked };
    const dek = isPrivate ? await getDekForWrite(Number(req.user.uid), String(req.user.jti || '')) : null;
    if (isPrivate && !dek) return { code: -1, msg: '保险库已锁定，请先解锁' };
    const exists = await queryOne(
      `SELECT id FROM ${table('account')} WHERE type = ? AND name = ? AND visibility = ? AND owner_uid = ?`,
      [type, name, isPrivate ? 'private' : 'shared', isPrivate ? req.user.uid : 0],
    );
    if (exists) return { code: -1, msg: '账户已存在' };
    const missing = missingRequiredSecret(type, config);
    if (missing.length) return { code: -1, msg: `请填写：${missing.join('、')}` };
    const provider = getDnsProvider(type, config, '', null);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证账户失败，' + provider.getError() };
    const id = await insertAndGetId(
      `INSERT INTO ${table('account')} (type, name, config, remark, owner_uid, visibility, addtime) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        type,
        name,
        encryptAccountConfig(config, isPrivate, dek),
        remark || '',
        isPrivate ? req.user.uid : 0,
        isPrivate ? 'private' : 'shared',
      ],
    );
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: isPrivate ? '私有账户' : String(name),
      summary: isPrivate ? '新增私有 DNS 账户' : `新增 ${type} 账户「${name}」`,
      detail: { type, name },
      scrubBody: isPrivate,
    });
    return { code: 0, msg: '添加账户成功', data: id };
  });

  app.put('/api/dns/accounts/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const b = req.body || {};
    const type = asText(b.type, 64);
    const name = asText(b.name, 128);
    const config = b.config;
    const remark = asText(b.remark, 255);
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    if (typeof config !== 'object' || config === null || Array.isArray(config)) return { code: -1, msg: '账户配置格式不正确' };
    if (!(await hitRateLimitDistributed(`cloud:account-check:${req.user.uid}`, 20, 60_000))) {
      return { code: -1, msg: '账户校验过于频繁，请稍后再试' };
    }
    const row: any = await getVisibleAccount('account', Number(id), req.user);
    if (!row) return reply.code(404).send({ code: -1, msg: '账户不存在' });
    const isPrivate = row.visibility === 'private';
    if (isPrivate) {
      const typeBlocked = privateDnsTypeBlocked(req.user, String(type));
      if (typeBlocked) return { code: -1, msg: typeBlocked };
    }
    const dek = isPrivate ? await getDekForWrite(Number(req.user.uid), String(req.user.jti || '')) : null;
    const base = readAccountConfig(row.config, dek);
    if (base.state === 'locked') return reply.code(423).send({ code: -1, msg: '保险库已锁定，请先解锁' });
    // 前端回显的是掩码，敏感字段保持不变
    const merged = mergeMaskedConfig(config, base.config);
    const missing = missingRequiredSecret(type, merged);
    if (missing.length) return { code: -1, msg: `请填写：${missing.join('、')}` };
    const provider = getDnsProvider(type, merged, '', null);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证账户失败，' + provider.getError() };
    await query(`UPDATE ${table('account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [
      type, name, encryptAccountConfig(merged, isPrivate, dek), remark || '', id,
    ]);
    const beforeCfg = base.config || {};
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: isPrivate ? '私有账户' : String(name),
      summary: isPrivate ? '修改私有 DNS 账户' : `修改 ${type} 账户「${name}」`,
      scrubBody: isPrivate,
      changes: [
        ...diffFields({ name: row.name, remark: row.remark }, { name, remark }, { name: '名称', remark: '备注' }),
        ...(secretChanged(beforeCfg, merged) ? [{ field: '凭证', to: '已更新' }] : []),
      ],
      detail: { type, name },
    });
    return { code: 0, msg: '修改账户成功' };
  });

  app.delete('/api/dns/accounts/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const row: any = await getVisibleAccount('account', Number(id), req.user);
    if (!row) return reply.code(404).send({ code: -1, msg: '账户不存在' });
    const dcount = await queryOne(`SELECT COUNT(*) c FROM ${table('domain')} WHERE aid = ?`, [id]);
    if (dcount && dcount.c > 0) return { code: -1, msg: '该账户下存在域名，无法删除' };
    await query(`DELETE FROM ${table('account')} WHERE id = ?`, [id]);
    const isPrivate = row.visibility === 'private';
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: isPrivate ? '私有账户' : String(row?.name || ''),
      summary: isPrivate ? '删除私有 DNS 账户' : `删除账户「${row?.name || '#' + id}」`,
    });
    return { code: 0, msg: '删除成功' };
  });

  // ============ CDN 账户 ============
  app.get('/api/cdn/providers', auth, async () => {
    return { code: 0, data: getCdnConfigList() };
  });

  app.get('/api/cdn/accounts', auth, async (req: any) => {
    const rows = await listVisibleAccounts('cdn_account', req.user);
    const dek = await getDekForWrite(Number(req.user.uid), String(req.user.jti || ''));
    const typeNames = Object.fromEntries(Object.entries(cdnConfig).map(([k, v]) => [k, v.name]));
    const data = rows.map((r: any) => {
      const { config, state } = readAccountConfig(r.config, dek);
      return {
        ...r,
        config: maskConfig(config),
        config_state: state,
        is_owner: Number(r.owner_uid) === Number(req.user.uid),
        typename: typeNames[r.type] || r.type,
      };
    });
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts', auth, async (req: any) => {
    const b = req.body || {};
    const type = asText(b.type, 64);
    const name = asText(b.name, 128);
    const config = b.config;
    const remark = asText(b.remark, 255);
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    if (typeof config !== 'object' || config === null || Array.isArray(config)) return { code: -1, msg: '账户配置格式不正确' };
    if (!(await hitRateLimitDistributed(`cloud:cdn-account-check:${req.user.uid}`, 20, 60_000))) {
      return { code: -1, msg: 'CDN 账户校验过于频繁，请稍后再试' };
    }
    const isPrivate = !isAdmin(req.user);
    const dek = isPrivate ? await getDekForWrite(Number(req.user.uid), String(req.user.jti || '')) : null;
    if (isPrivate && !dek) return { code: -1, msg: '保险库已锁定，请先解锁' };
    const exists = await queryOne(
      `SELECT id FROM ${table('cdn_account')} WHERE type = ? AND name = ? AND visibility = ? AND owner_uid = ?`,
      [type, name, isPrivate ? 'private' : 'shared', isPrivate ? req.user.uid : 0],
    );
    if (exists) return { code: -1, msg: 'CDN账户已存在' };
    const safeConfig = pickCdnConfig(type, config);
    const provider = getCdnProvider(type, safeConfig);
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证CDN账户失败，' + provider.getError() };
    const id = await insertAndGetId(
      `INSERT INTO ${table('cdn_account')} (type, name, config, remark, owner_uid, visibility, addtime) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        type,
        name,
        encryptAccountConfig(safeConfig, isPrivate, dek),
        remark || '',
        isPrivate ? req.user.uid : 0,
        isPrivate ? 'private' : 'shared',
      ],
    );
    bumpCdnAccountEpoch();
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: isPrivate ? '私有账户' : String(name),
      summary: isPrivate ? '新增私有 CDN 账户' : `新增 CDN 账户「${name}」`,
      detail: { type, name },
      scrubBody: isPrivate,
    });
    return { code: 0, msg: '添加CDN账户成功', data: id };
  });

  app.put('/api/cdn/accounts/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const b = req.body || {};
    const type = asText(b.type, 64);
    const name = asText(b.name, 128);
    const config = b.config;
    const remark = asText(b.remark, 255);
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    if (typeof config !== 'object' || config === null || Array.isArray(config)) return { code: -1, msg: '账户配置格式不正确' };
    if (!(await hitRateLimitDistributed(`cloud:cdn-account-check:${req.user.uid}`, 20, 60_000))) {
      return { code: -1, msg: 'CDN 账户校验过于频繁，请稍后再试' };
    }
    const row: any = await getVisibleAccount('cdn_account', Number(id), req.user);
    if (!row) return reply.code(404).send({ code: -1, msg: 'CDN账户不存在' });
    const isPrivate = row.visibility === 'private';
    const dek = isPrivate ? await getDekForWrite(Number(req.user.uid), String(req.user.jti || '')) : null;
    const base = readAccountConfig(row.config, dek);
    if (base.state === 'locked') return reply.code(423).send({ code: -1, msg: '保险库已锁定，请先解锁' });
    const merged = pickCdnConfig(type, mergeMaskedConfig(config, base.config));
    const provider = getCdnProvider(type, merged);
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证CDN账户失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [
      type, name, encryptAccountConfig(merged, isPrivate, dek), remark || '', id,
    ]);
    bumpCdnAccountEpoch();
    const beforeCfg = base.config || {};
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: isPrivate ? '私有账户' : String(name),
      summary: isPrivate ? '修改私有 CDN 账户' : `修改 CDN 账户「${name}」`,
      scrubBody: isPrivate,
      changes: [
        ...diffFields({ name: row.name, remark: row.remark }, { name, remark }, { name: '名称', remark: '备注' }),
        ...(secretChanged(beforeCfg, merged) ? [{ field: '凭证', to: '已更新' }] : []),
      ],
      detail: { type, name },
    });
    return { code: 0, msg: '修改CDN账户成功' };
  });

  app.delete('/api/cdn/accounts/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const row: any = await getVisibleAccount('cdn_account', Number(id), req.user);
    if (!row) return reply.code(404).send({ code: -1, msg: 'CDN账户不存在' });
    const dcount = await queryOne(`SELECT COUNT(*) c FROM ${table('cdn_domain')} WHERE aid = ?`, [id]);
    // 级联清理关联数据并置于同一事务，避免遗留缓存规则/统计数据等孤儿记录
    await withTransaction(async (q) => {
      await q(`DELETE FROM ${table('cdn_cache_rule')} WHERE did IN (SELECT id FROM ${table('cdn_domain')} WHERE aid = ?)`, [id]);
      await q(`DELETE FROM ${table('cdn_stat_data')} WHERE aid = ?`, [id]);
      await q(`DELETE FROM ${table('cdn_domain')} WHERE aid = ?`, [id]);
      await q(`DELETE FROM ${table('cdn_account')} WHERE id = ?`, [id]);
    });
    bumpCdnAccountEpoch();
    const isPrivate = row.visibility === 'private';
    audit(req, {
      targetType: 'account',
      targetId: id,
      targetName: isPrivate ? '私有账户' : String(row?.name || ''),
      summary: isPrivate ? '删除私有 CDN 账户' : `删除 CDN 账户「${row?.name || '#' + id}」`,
    });
    return { code: 0, msg: '删除成功' + (dcount && dcount.c > 0 ? '，已一并删除 ' + dcount.c + ' 个加速域名' : '') };
  });

  app.get('/api/cdn/accounts/:id/zones', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const acct: any = await getVisibleAccount('cdn_account', Number(id), req.user);
    if (!acct) return reply.code(404).send({ code: -1, msg: 'CDN账户不存在' });
    const dek = acct.visibility === 'private' ? await getDekForWrite(Number(req.user.uid), String(req.user.jti || '')) : null;
    const { config, state } = readAccountConfig(acct.config, dek);
    if (state === 'locked') return reply.code(423).send({ code: -1, msg: '保险库已锁定，请先解锁' });
    const provider = getCdnProvider(acct.type, config);
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
