import type { FastifyInstance } from 'fastify';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, queryOne, table, withTransaction } from '../db.js';
import { checkLevel } from '../auth.js';
import { audit } from '../lib/audit/context.js';
import { diffFields } from '../lib/audit/mask.js';
import { certConfig, certClassConfig } from '../lib/cert/factory.js';
import { getCertProvider } from '../lib/cert/factory.js';
import { getMainDomain } from '../lib/cert/utils.js';
import { CertOrderService, buildPfx, STATUS_LABEL } from '../lib/certService.js';
import { kickOrderProcessing } from '../lib/cert/certTaskService.js';
import { processOrderLink } from '../lib/cdn/certLink.js';
import { deployConfig, deployClassConfig, isDeployImplemented, getDeployProvider } from '../lib/deploy/factory.js';
import { CertDeployService } from '../lib/deployService.js';
import { certOrderSend, certDeploySend } from '../lib/monitor/msgNotice.js';
import { configGet, configSet } from '../config.js';
import { escapeLike, clientMessage, clampLimit, clampOffset, fmtDateTime, safeProcessId } from '../lib/util.js';
import { assertDeployConfigAllowed } from '../lib/netGuard.js';
import { localResolve } from '../lib/dns/localResolve.js';
import { requireLoginPassword } from '../lib/reauth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'runtime', 'log');

// 密钥类型/长度白名单：防止超大 keysize 同步生成 RSA 密钥阻塞事件循环（DoS）
const VALID_KEY_SIZES: Record<string, string[]> = { RSA: ['2048', '3072', '4096'], ECC: ['256', '384', '521'] };
function keySpecError(keytype: any, keysize: any): string | null {
  const kt = String(keytype || '');
  const ks = String(keysize ?? '');
  if (!VALID_KEY_SIZES[kt]) return '密钥类型不合法';
  if (!VALID_KEY_SIZES[kt].includes(ks)) return '密钥长度不合法';
  return null;
}

import { decryptConfig, encryptAccountConfig, encryptConfig, maskConfig, mergeMaskedConfig, readAccountConfig, encryptText, decryptText } from '../lib/secret.js';
import { canAccessCertOrder, getVisibleAccount, listVisibleAccounts } from '../lib/accounts/visibility.js';
import { getDekForWrite } from '../lib/vault/service.js';

// 批量取多个订单绑定的域名，避免证书/部署列表逐条查询（N+1）
async function fetchDomainMap(oids: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  const ids = [...new Set(oids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return map;
  const ph = ids.map(() => '?').join(',');
  const rows = await query<any>(`SELECT oid, domain FROM ${table('cert_domain')} WHERE oid IN (${ph}) ORDER BY sort ASC`, ids);
  for (const r of rows) {
    const arr = map.get(Number(r.oid)) || [];
    arr.push(r.domain);
    map.set(Number(r.oid), arr);
  }
  return map;
}

/** 部署任务越权守卫：任务绑定的证书账户对当前用户不可见时按不存在处理 */
async function canAccessDeployTask(id: any, user: any): Promise<boolean> {
  const row: any = await queryOne(`SELECT aid FROM ${table('cert_deploy')} WHERE id = ?`, [Number(id)]);
  if (!row) return false;
  if (!Number(row.aid)) return checkLevel(user, 2);
  return !!(await getVisibleAccount('cert_account', Number(row.aid), user));
}

function parseCertKey(fullchain: string, privatekey: string) {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(fullchain);
  } catch {
    return { code: -1, msg: '证书内容填写错误' };
  }
  let key;
  try {
    key = createPrivateKey(privatekey);
  } catch {
    return { code: -1, msg: '私钥内容填写错误' };
  }
  try {
    if (!cert.checkPrivateKey(key)) return { code: -1, msg: 'SSL证书与私钥不匹配' };
  } catch {
    return { code: -1, msg: 'SSL证书与私钥不匹配' };
  }
  const san = cert.subjectAltName || '';
  if (!san) return { code: -1, msg: '证书内容解析失败' };

  const pub = cert.publicKey;
  let keytype = 'Unknown';
  let keysize = 0;
  if (pub.asymmetricKeyType === 'rsa') {
    keytype = 'RSA';
    keysize = pub.asymmetricKeyDetails?.modulusLength || 0;
  } else if (pub.asymmetricKeyType === 'ec') {
    keytype = 'ECC';
    const curve = (pub as any).asymmetricKeyDetails?.namedCurve || '';
    keysize = curve.includes('384') ? 384 : curve.includes('521') ? 521 : 256;
  }

  const domains: string[] = [];
  for (const line of san.split(',')) {
    let d = line.trim();
    if (d.startsWith('DNS:')) d = d.slice(4).trim();
    if (d && !domains.includes(d)) domains.push(d);
  }
  if (!domains.length) return { code: -1, msg: '证书绑定域名不能为空' };

  const issuer = cert.issuer.match(/CN\s*=\s*([^,]+)/i)?.[1]?.trim() || '';
  return {
    code: 0,
    keytype,
    keysize,
    issuetime: fmtDateTime(new Date(cert.validFrom)),
    expiretime: fmtDateTime(new Date(cert.validTo)),
    issuer,
    domains,
  };
}

async function checkOrder(order: any, domains: string[]) {
  const account = await queryOne(`SELECT * FROM ${table('cert_account')} WHERE id = ?`, [order.aid]);
  if (!account) return { code: -1, msg: 'SSL证书账户不存在' };
  const meta = certConfig[account.type];
  if (!meta) return { code: -1, msg: 'SSL证书账户类型不存在' };
  const maxDomains = meta.max_domains;
  const wildcard = meta.wildcard;
  const cname = meta.cname;

  if (domains.length > maxDomains) {
    const ok = domains.length === 2 && maxDomains === 1 && domains[0].replace(/^www\./, '') === domains[1].replace(/^www\./, '');
    if (!ok) return { code: -1, msg: '域名数量不能超过' + maxDomains + '个' };
  }

  for (let domain of domains) {
    if (!wildcard && domain.includes('*')) return { code: -1, msg: '该证书账户类型不支持泛域名' };
    const mainDomain = await getMainDomain(domain);
    let drow = await queryOne(`SELECT name FROM ${table('domain')} WHERE name = ?`, [mainDomain]);
    if (!drow) {
      drow = await queryOne(`SELECT B.name FROM ${table('domain_alias')} A JOIN ${table('domain')} B ON A.did = B.id WHERE A.name = ?`, [mainDomain]);
      if (!drow) {
        if (domain.startsWith('*.')) domain = domain.slice(2);
        const cnameRow = !cname ? null : await queryOne(`SELECT id FROM ${table('cert_cname')} WHERE domain = ? AND status = 1`, [domain]);
        if (!cnameRow) return { code: -1, msg: '域名' + domain + '未在本系统添加' };
      }
    }
  }
  return true;
}

export default async function certRoutes(app: FastifyInstance) {
  // 证书与部署管理接口仅管理员可用
  const auth = {
    preHandler: async (req: any, reply: any) => {
      await (app as any).authenticate(req, reply);
      if (!req.user) return;
      if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
    },
  };

  // ============ 元数据 ============
  app.get('/api/cert/providers', auth, async () => {
    return { code: 0, data: certConfig, class_config: certClassConfig };
  });

  // ============ 证书账户 ============
  app.get('/api/cert/accounts', auth, async (req: any) => {
    const { kw, offset = 0, limit = 20, deploy = 0 } = req.query || {};
    const isDeploy = Number(deploy) === 1;
    const admin = checkLevel(req.user, 2);
    // 管理员：共享账户 + 自己的私有；普通用户：仅自己的私有
    let where =
      (isDeploy ? 'deploy = 1' : 'deploy = 0') +
      (admin
        ? " AND (visibility = 'shared' OR (visibility = 'private' AND owner_uid = ?))"
        : " AND visibility = 'private' AND owner_uid = ?");
    const params: any[] = [req.user.uid];
    if (kw) {
      where += " AND (name LIKE ? ESCAPE '!' OR remark LIKE ? ESCAPE '!' OR id = ?)";
      params.push('%' + escapeLike(kw) + '%', '%' + escapeLike(kw) + '%', kw);
    }
    const total = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_account')} WHERE ${where}`, params))?.c || 0;
    const rows = await query(`SELECT * FROM ${table('cert_account')} WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, clampLimit(limit, 20), clampOffset(offset)]);
    const dek = await getDekForWrite(Number(req.user.uid), String(req.user.jti || ''));
    const list = rows.map((r: any) => {
      const { config, state } = readAccountConfig(r.config, dek);
      return {
      id: r.id,
      type: r.type,
      name: r.name,
      config: maskConfig(config),
      config_state: state,
      is_owner: Number(r.owner_uid) === Number(req.user.uid),
      remark: r.remark,
      addtime: r.addtime,
      typename: isDeploy ? (deployConfig[r.type]?.name || '') : (certConfig[r.type]?.name || ''),
      icon: isDeploy ? (deployConfig[r.type]?.icon || '') : (certConfig[r.type]?.icon || ''),
      };
    });
    return { code: 0, total, data: list };
  });

  app.post('/api/cert/accounts', auth, async (req: any) => {
    const { type, name, config, remark, deploy = 0 } = req.body || {};
    if (!name || !config) return { code: -1, msg: '必填参数不能为空' };
    const isDeploy = Number(deploy) === 1;
    const isPrivate = !checkLevel(req.user, 2);
    const dek = isPrivate ? await getDekForWrite(Number(req.user.uid), String(req.user.jti || '')) : null;
    if (isPrivate && !dek) return { code: -1, msg: '保险库已锁定，请先解锁' };
    // 加密使用随机 IV，密文不可直接比较，改为解密后按明文判重（仅在同一归属范围内）
    const same = await query(
      `SELECT id, config FROM ${table('cert_account')} WHERE type = ? AND deploy = ? AND visibility = ? AND owner_uid = ?`,
      [type, deploy, isPrivate ? 'private' : 'shared', isPrivate ? req.user.uid : 0],
    );
    const dup = (same as any[]).find((r: any) => JSON.stringify(readAccountConfig(r.config, dek).config) === JSON.stringify(config));
    if (dup) return { code: -1, msg: isDeploy ? '自动部署账户已存在' : 'SSL证书账户已存在' };

    if (isDeploy) {
      const provider = getDeployProvider(type, config);
      if (!provider) return { code: -1, msg: '该部署类型暂未支持' };
      try {
        await assertDeployConfigAllowed(config);
        await provider.check();
      } catch (e: any) {
        return { code: -1, msg: '验证自动部署账户失败，' + e.message };
      }
      const ins: any = await query(
        `INSERT INTO ${table('cert_account')} (type, name, config, remark, deploy, owner_uid, visibility, addtime)
         VALUES (?, ?, ?, ?, 1, ?, ?, NOW())`,
        [type, name, encryptAccountConfig(config, isPrivate, dek), remark || '', isPrivate ? req.user.uid : 0, isPrivate ? 'private' : 'shared'],
      );
      audit(req, {
        targetType: 'cert_account',
        targetId: ins?.insertId,
        targetName: isPrivate ? '私有账户' : String(name),
        summary: isPrivate ? '新增私有自动部署账户' : `新增自动部署账户「${name}」（${type}）`,
        detail: { type, name },
        scrubBody: isPrivate,
      });
      return { code: 0, msg: '添加自动部署账户成功！' };
    }

    if (!certConfig[type]) return { code: -1, msg: '证书类型不存在' };
    const provider = getCertProvider(type, config, null);
    try {
      const ext = await provider.register();
      const id = await query(
        `INSERT INTO ${table('cert_account')} (type, name, config, remark, deploy, owner_uid, visibility, addtime)
         VALUES (?, ?, ?, ?, 0, ?, ?, NOW())`,
        [type, name, encryptAccountConfig(config, isPrivate, dek), remark || '', isPrivate ? req.user.uid : 0, isPrivate ? 'private' : 'shared'],
      ).then((r: any) => r.insertId || 0);
      if (ext && typeof ext === 'object') {
        await query(`UPDATE ${table('cert_account')} SET ext = ? WHERE id = ?`, [encryptConfig(ext), id]);
      }
      audit(req, {
        targetType: 'cert_account',
        targetId: id,
        targetName: isPrivate ? '私有账户' : String(name),
        summary: isPrivate ? '新增私有证书账户' : `新增证书账户「${name}」（${type}）`,
        detail: { type, name },
        scrubBody: isPrivate,
      });
      return { code: 0, msg: '添加SSL证书账户成功！' };
    } catch (e: any) {
      return { code: -1, msg: '验证SSL证书账户失败，' + e.message };
    }
  });

  app.put('/api/cert/accounts/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const { type, name, config, remark, deploy = 0 } = req.body || {};
    if (!name || !config) return { code: -1, msg: '必填参数不能为空' };
    const isDeploy = Number(deploy) === 1;
    const row: any = await getVisibleAccount('cert_account', Number(id), req.user);
    if (!row) return reply.code(404).send({ code: -1, msg: '账户不存在' });
    const isPrivate = row.visibility === 'private';
    const dek = isPrivate ? await getDekForWrite(Number(req.user.uid), String(req.user.jti || '')) : null;
    const base = readAccountConfig(row.config, dek);
    if (base.state === 'locked') return reply.code(423).send({ code: -1, msg: '保险库已锁定，请先解锁' });
    // 前端回显的是掩码，敏感字段保持不变
    const merged = mergeMaskedConfig(config, base.config);

    if (isDeploy) {
      const provider = getDeployProvider(type, merged);
      if (!provider) return { code: -1, msg: '该部署类型暂未支持' };
      try {
        await assertDeployConfigAllowed(merged);
        await provider.check();
      } catch (e: any) {
        return { code: -1, msg: '验证自动部署账户失败，' + e.message };
      }
      await query(`UPDATE ${table('cert_account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [type, name, encryptAccountConfig(merged, isPrivate, dek), remark || '', id]);
      audit(req, {
        targetType: 'cert_account',
        targetId: id,
        targetName: isPrivate ? '私有账户' : String(name),
        summary: isPrivate ? '修改私有自动部署账户' : `修改自动部署账户「${name}」`,
        scrubBody: isPrivate,
        changes: diffFields({ name: row.name, remark: row.remark }, { name, remark }, { name: '名称', remark: '备注' }),
        detail: { type, name },
      });
      return { code: 0, msg: '修改自动部署账户成功！' };
    }

    if (!certConfig[type]) return { code: -1, msg: '证书类型不存在' };
    const provider = getCertProvider(type, merged, null);
    try {
      const ext = await provider.register();
      await query(`UPDATE ${table('cert_account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [type, name, encryptAccountConfig(merged, isPrivate, dek), remark || '', id]);
      if (ext && typeof ext === 'object') {
        await query(`UPDATE ${table('cert_account')} SET ext = ? WHERE id = ?`, [encryptConfig(ext), id]);
      }
      audit(req, {
        targetType: 'cert_account',
        targetId: id,
        targetName: isPrivate ? '私有账户' : String(name),
        summary: isPrivate ? '修改私有证书账户' : `修改证书账户「${name}」`,
        scrubBody: isPrivate,
        changes: diffFields({ name: row.name, remark: row.remark }, { name, remark }, { name: '名称', remark: '备注' }),
        detail: { type, name },
      });
      return { code: 0, msg: '修改SSL证书账户成功！' };
    } catch (e: any) {
      return { code: -1, msg: '验证SSL证书账户失败，' + e.message };
    }
  });

  app.delete('/api/cert/accounts/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const row: any = await getVisibleAccount('cert_account', Number(id), req.user);
    if (!row) return reply.code(404).send({ code: -1, msg: '账户不存在' });
    // 两项关联检查都必须执行，避免客户端通过 deploy 参数只触发其一而绕过
    const deployCount = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_deploy')} WHERE aid = ?`, [id]))?.c || 0;
    if (deployCount > 0) return { code: -1, msg: '该账户下存在自动部署任务，无法删除' };
    const orderCount = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_order')} WHERE aid = ?`, [id]))?.c || 0;
    if (orderCount > 0) return { code: -1, msg: '该账户下存在证书订单，无法删除' };
    await query(`DELETE FROM ${table('cert_account')} WHERE id = ?`, [id]);
    const isPrivate = row.visibility === 'private';
    audit(req, {
      targetType: 'cert_account',
      targetId: id,
      targetName: isPrivate ? '私有账户' : String(row?.name || ''),
      summary: isPrivate ? '删除私有证书账户' : `删除${Number(row?.deploy) ? '自动部署' : '证书'}账户「${row?.name || '#' + id}」`,
    });
    return { code: 0, msg: '删除成功' };
  });

  // ============ 证书订单 ============
  app.get('/api/cert/orders', auth, async (req: any) => {
    const { domain, id, aid, type, status, offset = 0, limit = 20 } = req.query || {};
    let where = '1=1';
    const params: any[] = [];
    // 与账户列表同口径：管理员看共享 + 自己的私有，普通用户只看自己的私有
    const visibleCertAccounts = await listVisibleAccounts('cert_account', req.user);
    const allowedCertAids = visibleCertAccounts.map((a: any) => Number(a.id));
    const certAidCond = allowedCertAids.length ? `A.aid IN (${allowedCertAids.map(() => '?').join(',')})` : '1=0';
    where += checkLevel(req.user, 2) ? ` AND (A.aid = 0 OR ${certAidCond})` : ` AND ${certAidCond}`;
    params.push(...allowedCertAids);
    if (id) {
      where += ' AND A.id = ?';
      params.push(id);
    } else if (domain) {
      const oids = await query(`SELECT oid FROM ${table('cert_domain')} WHERE domain LIKE ? ESCAPE '!'`, ['%' + escapeLike(String(domain)) + '%']);
      // 用占位符绑定，避免把库中 oid 值直接拼进 SQL 文本（二次注入）
      const oidNums = oids.map((o: any) => Number(o.oid)).filter((n: number) => Number.isInteger(n) && n > 0);
      if (oidNums.length) {
        where += ' AND A.id IN (' + oidNums.map(() => '?').join(',') + ')';
        params.push(...oidNums);
      } else {
        where += ' AND 1=0';
      }
    }
    if (aid) {
      where += ' AND A.aid = ?';
      params.push(aid);
    }
    if (type) {
      where += ' AND B.type = ?';
      params.push(type);
    }
    if (status !== undefined && status !== '') {
      if (status === '5') where += ' AND A.status < 0';
      else if (status === '6') where += ' AND A.expiretime < DATE_ADD(NOW(), INTERVAL 7 DAY) AND A.expiretime >= NOW()';
      else if (status === '7') where += ' AND A.expiretime < NOW()';
      else {
        where += ' AND A.status = ?';
        params.push(status);
      }
    }
    const total = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_order')} A LEFT JOIN ${table('cert_account')} B ON A.aid = B.id WHERE ${where}`, params))?.c || 0;
    const rows = await query(
      // 显式列清单：排除 fullchain / privatekey / info / dns 等大字段，避免每页读回 1–3MB 无用 IO 并把私钥取出到应用内存
      `SELECT A.id, A.aid, A.keytype, A.keysize, A.status, A.error, A.isauto, A.issuetime, A.expiretime, A.issuer, A.addtime, A.updatetime, B.type FROM ${table('cert_order')} A LEFT JOIN ${table('cert_account')} B ON A.aid = B.id WHERE ${where} ORDER BY A.id DESC LIMIT ? OFFSET ?`,
      [...params, clampLimit(limit, 20), clampOffset(offset)],
    );
    const list = [];
    const oidDomains = await fetchDomainMap(rows.map((r: any) => r.id));
    for (const r of rows) {
      list.push({
        id: r.id,
        aid: r.aid,
        type: r.type,
        typename: r.type ? certConfig[r.type]?.name || '' : null,
        keytype: r.keytype,
        keysize: r.keysize,
        domains: oidDomains.get(r.id) || [],
        status: r.status,
        error: r.error,
        isauto: r.isauto,
        issuetime: r.issuetime,
        expiretime: r.expiretime,
        issuer: r.issuer,
        addtime: r.addtime,
        updatetime: r.updatetime,
        end_day: r.expiretime ? Math.ceil((new Date(r.expiretime).getTime() - Date.now()) / 86400000) : null,
      });
    }
    return { code: 0, total, data: list, status_label: STATUS_LABEL };
  });

  app.post('/api/cert/orders', auth, async (req: any) => {
    const { aid, keytype, keysize, fullchain, privatekey, domains } = req.body || {};
    let order: any;
    let domList: string[] = [];

    if (aid == -1) {
      const certInfo = parseCertKey(fullchain, privatekey);
      if (certInfo.code === -1) return certInfo;
      domList = certInfo.domains || [];
      const dupIds = await query(`SELECT id FROM ${table('cert_order')} WHERE issuetime = ?`, [certInfo.issuetime]);
      for (const d of dupIds) {
        const d2 = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ?`, [d.id]);
        const list2 = d2.map((x: any) => x.domain).sort();
        if (JSON.stringify(list2) === JSON.stringify([...domList].sort())) {
          return { code: -1, msg: '该证书已存在，无需重复添加' };
        }
      }
      order = {
        aid: 0,
        keytype: certInfo.keytype,
        keysize: certInfo.keysize,
        addtime: new Date(),
        updatetime: new Date(),
        issuetime: certInfo.issuetime,
        expiretime: certInfo.expiretime,
        issuer: certInfo.issuer,
        status: 3,
        isauto: 1,
        fullchain,
        privatekey: encryptText(privatekey),
      };
    } else {
      if (!(await getVisibleAccount('cert_account', Number(aid), req.user))) return { code: -1, msg: '证书账户不存在' };
      order = { aid, keytype, keysize, addtime: new Date(), issuer: '', status: 0, isauto: 1, retrytime: new Date() };
      const ke = keySpecError(keytype, keysize);
      if (ke) return { code: -1, msg: ke };
      domList = (domains || []).map((d: string) => d.trim()).filter(Boolean);
      domList = [...new Set(domList)];
      if (!domList.length) return { code: -1, msg: '绑定域名不能为空' };
      const res = await checkOrder(order, domList);
      if (typeof res === 'object') return res;
    }
    if (!order.keytype || !order.keysize) return { code: -1, msg: '必填参数不能为空' };

    // 订单与绑定域名必须同时成功：否则会留下无域名的待处理订单，调度器反复失败
    let id = 0;
    await withTransaction(async (q) => {
      const ins: any = await q(`INSERT INTO ${table('cert_order')} SET ?`, [order]);
      id = Number(ins?.insertId || 0);
      if (domList.length) {
        // 多值 INSERT 替代逐条插入
        const values = domList.map(() => '(?, ?, ?)').join(', ');
        const params = domList.flatMap((domain, idx) => [id, domainToASCII(domain), idx + 1]);
        await q(`INSERT INTO ${table('cert_domain')} (oid, domain, sort) VALUES ${values}`, params);
      }
    });
    // 待处理订单立即在后台开始申请，无需用户手动点「处理」
    if (Number(order.status) === 0) kickOrderProcessing(id);
    audit(req, {
      targetType: 'cert_order',
      targetId: id,
      targetName: domList.join(','),
      summary: `申请证书 ${domList.join(',')}`,
      detail: { aid, keytype, keysize, domains: domList },
    });
    return { code: 0, msg: '添加证书订单成功！', data: id };
  });

  app.put('/api/cert/orders/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const { aid, keytype, keysize, fullchain, privatekey, domains } = req.body || {};
    if (!(await canAccessCertOrder(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    const row = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [id]);
    if (!row) return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    let order: any;
    let domList: string[] = [];

    if (aid == -1) {
      const certInfo = parseCertKey(fullchain, privatekey);
      if (certInfo.code === -1) return certInfo;
      domList = certInfo.domains || [];
      order = {
        aid: 0,
        keytype: certInfo.keytype,
        keysize: certInfo.keysize,
        updatetime: new Date(),
        issuetime: certInfo.issuetime,
        expiretime: certInfo.expiretime,
        issuer: certInfo.issuer,
        status: 3,
        issend: 0,
        fullchain,
        privatekey: encryptText(privatekey),
      };
    } else {
      if (!(await getVisibleAccount('cert_account', Number(aid), req.user))) return { code: -1, msg: '证书账户不存在' };
      const ke = keySpecError(keytype, keysize);
      if (ke) return { code: -1, msg: ke };
      domList = (domains || []).map((d: string) => d.trim()).filter(Boolean);
      domList = [...new Set(domList)];
      if (!domList.length) return { code: -1, msg: '绑定域名不能为空' };
      order = { aid, keytype, keysize, updatetime: new Date() };
      const res = await checkOrder(order, domList);
      if (typeof res === 'object') return res;
    }

    await withTransaction(async (q) => {
      await q(`UPDATE ${table('cert_order')} SET ? WHERE id = ?`, [order, id]);
      await q(`DELETE FROM ${table('cert_domain')} WHERE oid = ?`, [id]);
      let i = 1;
      for (const domain of domList) {
        await q(`INSERT INTO ${table('cert_domain')} (oid, domain, sort) VALUES (?, ?, ?)`, [id, domainToASCII(domain), i++]);
      }
    });
    audit(req, {
      targetType: 'cert_order',
      targetId: id,
      targetName: domList.join(','),
      summary: `修改证书订单 #${id}`,
      detail: { aid, keytype, keysize, domains: domList },
    });
    return { code: 0, msg: '修改证书订单成功！' };
  });

  app.delete('/api/cert/orders/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    if (!(await canAccessCertOrder(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    const count = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_deploy')} WHERE oid = ?`, [id]))?.c || 0;
    if (count > 0) return { code: -1, msg: '该证书关联了自动部署任务，无法删除' };
    try {
      await new CertOrderService(id).cancel();
    } catch {
      // ignore
    }
    const doms = (await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ?`, [id])).map((r: any) => r.domain);
    await withTransaction(async (q) => {
      await q(`DELETE FROM ${table('cert_order')} WHERE id = ?`, [id]);
      await q(`DELETE FROM ${table('cert_domain')} WHERE oid = ?`, [id]);
    });
    audit(req, {
      targetType: 'cert_order',
      targetId: id,
      targetName: doms.join(','),
      summary: `删除证书订单 #${id}`,
      detail: { domains: doms },
    });
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/cert/orders/:id/process', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const { reset = 0 } = req.body || {};
    if (!(await canAccessCertOrder(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    try {
      const service = new CertOrderService(id);
      if (reset == 1) await service.reset();
      const code = await service.process(true);
      if (code === 3) {
        // 签发成功后立即创建 CDN 联动部署任务（若订单带联动标记）
        await processOrderLink(Number(id)).catch(() => {});
        certOrderSend(Number(id), true).catch(() => {});
        audit(req, { targetType: 'cert_order', targetId: id, summary: `提交证书签发 #${id}：已签发` });
        return { code: 0, msg: '证书已签发成功！' };
      }
      if (code === 1) {
        audit(req, { targetType: 'cert_order', targetId: id, summary: `提交证书签发 #${id}：等待 DNS 验证` });
        return { code: 0, msg: '添加DNS记录成功！请等待DNS生效后点击验证' };
      }
      audit(req, { targetType: 'cert_order', targetId: id, summary: `提交证书签发 #${id}` });
      return { code: 0, msg: '证书处理完成' };
    } catch (e: any) {
      certOrderSend(Number(id), false).catch(() => {});
      return { code: -1, msg: clientMessage(e, '证书处理失败') };
    }
  });

  app.post('/api/cert/orders/:id/reset', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    if (!(await canAccessCertOrder(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    try {
      const service = new CertOrderService(id);
      await service.cancel();
      await service.reset();
      audit(req, { targetType: 'cert_order', targetId: id, summary: `重置证书订单 #${id}` });
      return { code: 0, msg: '重置成功' };
    } catch (e: any) {
      return { code: -1, msg: clientMessage(e, '重置失败') };
    }
  });

  app.post('/api/cert/orders/:id/revoke', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    if (!(await canAccessCertOrder(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    try {
      await new CertOrderService(id).revoke();
      audit(req, { targetType: 'cert_order', targetId: id, summary: `吊销证书 #${id}` });
      return { code: 0, msg: '吊销成功' };
    } catch (e: any) {
      return { code: -1, msg: clientMessage(e, '吊销失败') };
    }
  });

  app.post('/api/cert/orders/:id/setauto', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const { isauto } = req.body || {};
    if (!(await canAccessCertOrder(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    await query(`UPDATE ${table('cert_order')} SET isauto = ? WHERE id = ?`, [isauto ? 1 : 0, id]);
    audit(req, {
      targetType: 'cert_order',
      targetId: id,
      summary: `${isauto ? '开启' : '关闭'}证书 #${id} 自动续签`,
    });
    return { code: 0, msg: '操作成功' };
  });

  app.get('/api/cert/orders/:id/info', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    if (!(await canAccessCertOrder(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    const passwordErr = await requireLoginPassword(Number(req.user.uid), req.headers['x-confirm-password']);
    if (passwordErr) return reply.code(400).send({ code: -1, msg: passwordErr });
    const row = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [id]);
    if (!row) return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    const domains = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [id]);
    // 私钥为加密存储，读取时解密（兼容历史明文）
    const privateKey = decryptText(row.privatekey) ?? row.privatekey ?? '';
    let pfx = null;
    if (row.fullchain && privateKey) {
      try {
        // PFX 密码由调用方指定，默认不设置密码（不再使用内置弱口令）
        const pfxPass = String(req.query?.pfx_pass || '');
        pfx = (await buildPfx(row.fullchain, privateKey, pfxPass)).toString('base64');
      } catch (e: any) {
        // 记录失败原因（如容器缺少 openssl），避免同类环境问题无声失败难以排查
        console.error('[cert] 生成 PFX 失败 order=' + id + '：', e?.message || e);
        pfx = null;
      }
    }
    return {
      code: 0,
      data: {
        id: row.id,
        crt: row.fullchain,
        key: privateKey,
        pfx,
        issuetime: row.issuetime,
        expiretime: row.expiretime,
        domains: domains.map((d: any) => d.domain),
      },
    };
  });

  app.get('/api/cert/orders/:id/log', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    if (!(await canAccessCertOrder(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    const row = await queryOne(`SELECT processid FROM ${table('cert_order')} WHERE id = ?`, [id]);
    const processid = safeProcessId(row?.processid);
    if (!processid) return { code: -1, msg: '无日志' };
    const file = join(LOG_DIR, processid + '.log');
    if (!existsSync(file)) return { code: -1, msg: '日志文件不存在' };
    return { code: 0, data: readFileSync(file, 'utf8') };
  });

  // ============ CNAME 代理 ============
  app.get('/api/cert/cnames', auth, async () => {
    const rows = await query(`SELECT A.*, B.name AS cnamedomain FROM ${table('cert_cname')} A LEFT JOIN ${table('domain')} B ON A.did = B.id ORDER BY A.id DESC`);
    return { code: 0, data: rows };
  });

  app.post('/api/cert/cnames', auth, async (req: any) => {
    const { domain, did, rr } = req.body || {};
    if (!domain || !did || !rr) return { code: -1, msg: '必填参数不能为空' };
    // 与原项目一致：新建 CNAME 代理默认「待验证」（status=0），需通过检测后才置为 1
    const dup = await queryOne(`SELECT id FROM ${table('cert_cname')} WHERE domain = ?`, [domain]);
    if (dup) return { code: -1, msg: '域名' + domain + '已存在' };
    const dup2 = await queryOne(`SELECT id FROM ${table('cert_cname')} WHERE rr = ? AND did = ?`, [rr, did]);
    if (dup2) return { code: -1, msg: '已存在相同CNAME记录值' };
    await query(`INSERT INTO ${table('cert_cname')} (domain, did, rr, addtime, status) VALUES (?, ?, ?, NOW(), 0)`, [domain, did, rr]);
    return { code: 0, msg: '添加成功' };
  });

  // 检测 CNAME 代理是否已生效（_acme-challenge 是否解析到配置的 CNAME 目标）
  app.post('/api/cert/cnames/:id/check', auth, async (req: any) => {
    const id = Number((req.params as any).id);
    const row: any = await queryOne(
      `SELECT A.*, B.name AS cnamedomain FROM ${table('cert_cname')} A LEFT JOIN ${table('domain')} B ON A.did = B.id WHERE A.id = ?`,
      [id]
    );
    if (!row) return { code: -1, msg: 'CNAME记录不存在' };
    const checkDomain = '_acme-challenge.' + row.domain;
    const expected = String(row.rr + '.' + (row.cnamedomain || '')).replace(/\.+$/, '').toLowerCase();
    const actual = await localResolve(checkDomain, 'CNAME');
    const status = (actual || []).some((v: string) => String(v).replace(/\.+$/, '').toLowerCase() === expected) ? 1 : 0;
    if (status !== Number(row.status)) {
      await query(`UPDATE ${table('cert_cname')} SET status = ? WHERE id = ?`, [status, id]);
    }
    return { code: 0, status };
  });

  app.delete('/api/cert/cnames/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    await query(`DELETE FROM ${table('cert_cname')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  // ============ 自动部署 ============
  app.get('/api/deploy/providers', auth, async () => {
    const data: Record<string, any> = {};
    for (const [k, v] of Object.entries(deployConfig)) {
      data[k] = { ...v, implemented: isDeployImplemented(k) };
    }
    return { code: 0, data, class_config: deployClassConfig };
  });

  app.get('/api/deploy/tasks', auth, async (req: any) => {
    const { offset = 0, limit = 20, status, oid } = req.query || {};
    let where = '1=1';
    const params: any[] = [];
    if (status !== undefined && status !== '') {
      where += ' AND A.status = ?';
      params.push(status);
    }
    if (oid) {
      where += ' AND A.oid = ?';
      params.push(oid);
    }
    const visibleCertAids = (await listVisibleAccounts('cert_account', req.user)).map((a: any) => Number(a.id));
    if (!visibleCertAids.length) return { code: 0, total: 0, data: [] };
    where += ` AND A.aid IN (${visibleCertAids.map(() => '?').join(',')})`;
    params.push(...visibleCertAids);
    const total = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_deploy')} A WHERE ${where}`, params))?.c || 0;
    const rows = await query(
      `SELECT A.*, B.type, B.name AS aname, C.aid AS certaid FROM ${table('cert_deploy')} A LEFT JOIN ${table('cert_account')} B ON A.aid = B.id LEFT JOIN ${table('cert_order')} C ON A.oid = C.id WHERE ${where} ORDER BY A.id DESC LIMIT ? OFFSET ?`,
      [...params, clampLimit(limit, 20), clampOffset(offset)],
    );
    const list = [];
    const oidDomains = await fetchDomainMap(rows.map((r: any) => r.oid));
    for (const r of rows) {
      list.push({
        id: r.id,
        aid: r.aid,
        oid: r.oid,
        type: r.type,
        typename: r.type ? deployConfig[r.type]?.name || '' : '',
        aname: r.aname,
        // 回显掩码，编辑保存时后端按掩码保留原密钥
        config: maskConfig(decryptConfig(r.config)),
        remark: r.remark,
        status: r.status,
        active: r.active,
        error: r.error,
        lasttime: r.lasttime,
        addtime: r.addtime,
        domains: oidDomains.get(r.oid) || [],
      });
    }
    return { code: 0, total, data: list };
  });

  app.post('/api/deploy/tasks', auth, async (req: any, reply: any) => {
    const { aid, oid, config, remark } = req.body || {};
    if (!aid || !oid || !config) return { code: -1, msg: '必填参数不能为空' };
    if (!(await getVisibleAccount('cert_account', Number(aid), req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书账户不存在' });
    }
    if (!(await canAccessCertOrder(oid, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    try {
      await assertDeployConfigAllowed(config);
    } catch (e: any) {
      return { code: -1, msg: '部署配置校验失败，' + e.message };
    }
    const ins: any = await query(
      `INSERT INTO ${table('cert_deploy')} (aid, oid, config, remark, addtime, status, active) VALUES (?, ?, ?, ?, NOW(), 0, 1)`,
      [aid, oid, encryptConfig(config), remark || ''],
    );
    audit(req, {
      targetType: 'deploy_task',
      targetId: ins?.insertId,
      summary: `新建部署任务 #${ins?.insertId || '-'}（证书 #${oid}）`,
      detail: { aid, oid },
    });
    return { code: 0, msg: '添加自动部署任务成功！' };
  });

  app.put('/api/deploy/tasks/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    const { aid, oid, config, remark } = req.body || {};
    if (!aid || !oid || !config) return { code: -1, msg: '必填参数不能为空' };
    if (!(await canAccessDeployTask(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '部署任务不存在' });
    }
    if (!(await getVisibleAccount('cert_account', Number(aid), req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书账户不存在' });
    }
    if (!(await canAccessCertOrder(oid, req.user))) {
      return reply.code(404).send({ code: -1, msg: '证书订单不存在' });
    }
    const row = await queryOne(`SELECT config FROM ${table('cert_deploy')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '任务不存在' };
    // 前端回显的是掩码，敏感字段保持不变
    const merged = mergeMaskedConfig(config, decryptConfig(row.config));
    try {
      await assertDeployConfigAllowed(merged);
    } catch (e: any) {
      return { code: -1, msg: '部署配置校验失败，' + e.message };
    }
    await query(`UPDATE ${table('cert_deploy')} SET aid = ?, oid = ?, config = ?, remark = ? WHERE id = ?`, [aid, oid, encryptConfig(merged), remark || '', id]);
    audit(req, {
      targetType: 'deploy_task',
      targetId: id,
      summary: `修改部署任务 #${id}`,
      detail: { aid, oid },
    });
    return { code: 0, msg: '修改自动部署任务成功！' };
  });

  app.delete('/api/deploy/tasks/:id', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    if (!(await canAccessDeployTask(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '部署任务不存在' });
    }
    await query(`DELETE FROM ${table('cert_deploy')} WHERE id = ?`, [id]);
    audit(req, { targetType: 'deploy_task', targetId: id, summary: `删除部署任务 #${id}` });
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/deploy/tasks/:id/process', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    if (!(await canAccessDeployTask(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '部署任务不存在' });
    }
    try {
      await new CertDeployService(id).process(true);
      certDeploySend(Number(id), true).catch(() => {});
      audit(req, { targetType: 'deploy_task', targetId: id, summary: `执行部署任务 #${id}：成功` });
      return { code: 0, msg: 'SSL证书部署任务执行成功！' };
    } catch (e: any) {
      certDeploySend(Number(id), false).catch(() => {});
      return { code: -1, msg: clientMessage(e, '证书部署失败') };
    }
  });

  app.post('/api/deploy/tasks/:id/reset', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    if (!(await canAccessDeployTask(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '部署任务不存在' });
    }
    try {
      await new CertDeployService(id).reset();
      audit(req, { targetType: 'deploy_task', targetId: id, summary: `重置部署任务 #${id}` });
      return { code: 0, msg: '重置成功' };
    } catch (e: any) {
      return { code: -1, msg: clientMessage(e, '重置失败') };
    }
  });

  app.post('/api/deploy/tasks/:id/setactive', auth, async (req: any, reply: any) => {
    const { id } = req.params as any;
    if (!(await canAccessDeployTask(id, req.user))) {
      return reply.code(404).send({ code: -1, msg: '部署任务不存在' });
    }
    const { active } = req.body || {};
    await query(`UPDATE ${table('cert_deploy')} SET active = ? WHERE id = ?`, [active ? 1 : 0, id]);
    audit(req, {
      targetType: 'deploy_task',
      targetId: id,
      summary: `${active ? '启用' : '停用'}部署任务 #${id}`,
    });
    return { code: 0, msg: '操作成功' };
  });

  const SETTINGS_KEYS = ['cert_renewdays', 'deploy_hour_start', 'deploy_hour_end', 'cdn_cert_aid', 'cert_notice_mail', 'cert_notice_wxtpl', 'cert_notice_tgbot', 'cert_notice_qqbot', 'cert_notice_webhook', 'cert_notice_custom_webhook'];

  app.get('/api/cert/settings', auth, async () => {
    const data: Record<string, string | null> = {};
    for (const k of SETTINGS_KEYS) data[k] = await configGet(k, '');
    return { code: 0, data };
  });

  app.post('/api/cert/settings', auth, async (req: any) => {
    const body = req.body || {};
    for (const k of SETTINGS_KEYS) {
      if (k in body) await configSet(k, String(body[k] ?? ''));
    }
    return { code: 0, msg: '设置保存成功' };
  });
}