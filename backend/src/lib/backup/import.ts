import { randomBytes } from 'node:crypto';
import { table, withTransaction, listColumns, isDuplicateError } from '../../db.js';
import { isGeneratedColumn } from '../../db/types.js';
import { getSysKey } from '../../config.js';
import { deriveKek, deriveSysKek, KDF_PARAMS, KDF_PARAMS_JSON, unwrapDek, wrapDek } from '../vault/keys.js';
import { decodeStoredValue, TABLES } from './manifest.js';
import { ADMIN_ONLY_DNS_TYPES, dnsProviders } from '../dns/factory.js';
import { cdnConfig } from '../cdn/factory.js';
import { certConfig } from '../cert/factory.js';
import { safeProcessId } from '../util.js';
import { openArchive } from './archive.js';

export type ImportMode = 'install' | 'merge' | 'replace';

export interface ImportOptions {
  key: Buffer;
  mode: ImportMode;
  dryRun?: boolean;
  actor?: { uid: number; username: string };
  actorIsAdmin?: boolean;
  passphrase?: string;
  overwriteConfig?: boolean;
  /** 内部受信任入口（安装向导/在线恢复/自检脚本）才允许导入 site/install 归档 */
  trusted?: boolean;
  /** 调用方显式指定的 scope，用于管理员兼容无 scope 的旧归档 */
  scopeOverride?: string;
}

export interface TableReport {
  inserted: number;
  reused: number;
  skipped: number;
  dropped: number;
}

export interface ImportReport {
  scope: string;
  mode: ImportMode;
  dryRun: boolean;
  tables: Record<string, TableReport>;
  config: { updated: number; skipped: number };
  warnings: string[];
}

type Q = <R = any>(sql: string, params?: any[]) => Promise<R[]>;

// config 中的 sys_key/backup_key/maintenance 不能由归档覆盖；其余表在 replace 模式下全部重建。
const DELETE_SKIP = new Set(['config']);

// 个人备份（包括管理员代为导入）只允许恢复私有资产：
// 账户与保险库可以恢复；权限、域名、全局定时任务、证书订单/部署、备份计划等
// 一律不允许由个人归档写入，否则归档会变成绕过授权与调度器边界的数据通道。
const USER_IMPORT_TABLES = new Set<string>([
  'user',
  'user_vault',
  'api_key',
  'account',
  'cdn_account',
  'cert_account',
]);

// replace 模式除业务表外还必须清理的运行态数据；否则旧站点的日志、统计、
// 验证码和 TOTP 防重放记录会残留到新站点。
const REPLACE_EXTRA_TABLES = ['log', 'cdn_stat_data', 'reg_verify', 'totp_replay'];

function sanitizePlainConfig(raw: any, allowed: Set<string>): any {
  if (raw && typeof raw === 'object') {
    if ('__encv1' in raw && typeof raw.__encv1 === 'string') {
      const inner = sanitizePlainConfig(raw.__encv1, allowed);
      // 原值是整列 enc:v1 密文（导出时解包为 __encv1 标记）。脱敏后必须重新包回标记，
      // 让 decodeStoredValue 用目标 sys_key 重新加密；直接返回对象会退化为明文落库。
      return { __encv1: typeof inner === 'string' ? inner : JSON.stringify(inner) };
    }
    if ('__b64' in raw) return raw;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) if (allowed.has(k)) out[k] = v;
    return out;
  }
  if (typeof raw === 'string' && !raw.startsWith('enc:') && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(parsed)) if (allowed.has(k)) out[k] = v;
        return JSON.stringify(out);
      }
    } catch {
      // 非 JSON 的旧配置保持原样
    }
  }
  return raw;
}

function emptyReport(): TableReport {
  return { inserted: 0, reused: 0, skipped: 0, dropped: 0 };
}

/** 目标表实际列，避免归档里版本较新的列导致 INSERT 失败 */
async function targetColumns(q: Q, name: string): Promise<Set<string>> {
  const rows = await listColumns(table(name), q);
  return new Set(
    rows.filter((r) => !isGeneratedColumn(r.Extra)).map((r) => String(r.Field)),
  );
}

async function insertRow(q: Q, name: string, row: Record<string, any>, cols: Set<string>): Promise<number> {
  const keys = Object.keys(row).filter((c) => !c.startsWith('__') && cols.has(c));
  if (!keys.length) return 0;
  const values = keys.map((c) => decodeStoredValue(row[c]));
  const sql = `INSERT INTO ${table(name)} (${keys.map((c) => `\`${c}\``).join(',')})
               VALUES (${keys.map(() => '?').join(',')})`;
  const res: any = await q(sql, values);
  return Number(res?.insertId || 0);
}

async function uniqueName(q: Q, base: string): Promise<string> {
  const name = String(base || 'user').slice(0, 64);
  const exists = async (n: string) => {
    const rows = await q(`SELECT id FROM ${table('user')} WHERE username = ? LIMIT 1`, [n]);
    return rows.length > 0;
  };
  if (!(await exists(name))) return name;
  for (let i = 1; i <= 100; i++) {
    const n = `${name}${i}`;
    if (!(await exists(n))) return n;
  }
  return `${name.slice(0, 55)}_${randomBytes(2).toString('hex')}`;
}

export async function importArchive(file: string, opts: ImportOptions): Promise<ImportReport> {
  const archive = await openArchive(file, opts.key);
  const header = archive.header;
  const scope = String(opts.scopeOverride ?? header.scope ?? '').trim();
  const mode = opts.mode;
  const actorUid = Number(opts.actor?.uid || 0);
  const trusted = opts.trusted === true;
  const actorIsAdmin = opts.actorIsAdmin === true || trusted;
  const ownerUid = Number(header.ownerUid || 0);

  // 归档 scope 是安全边界的一部分，必须 fail-closed 校验；不能在未知 scope 时
  // 退化成 site，否则普通用户可借 scope 缺失/伪造绕过个人备份白名单。
  const reject = async (msg: string): Promise<never> => {
    await archive.dispose();
    throw new Error(msg);
  };
  if (!scope) return await reject('备份归档缺少范围标识，已拒绝导入');
  if (scope !== 'user' && scope !== 'site' && scope !== 'install') {
    return await reject('备份归档范围不合法，已拒绝导入');
  }
  if (scope === 'install' && !trusted) return await reject('安装范围归档仅允许安装向导导入');
  if (!actorIsAdmin && scope !== 'user') return await reject('无权限导入整站备份');
  if (scope === 'user') {
    if (!actorUid) return await reject('个人备份导入缺少用户标识');
    if (!actorIsAdmin && ownerUid !== actorUid) return await reject('只能导入自己的备份');
  }

  const report: ImportReport = {
    scope,
    mode,
    dryRun: opts.dryRun === true,
    tables: {},
    config: { updated: 0, skipped: 0 },
    warnings: [],
  };

  const userSafe = scope === 'user' && actorUid > 0;
  const selfImport = scope === 'user' && !actorIsAdmin && actorUid > 0;
  const names = TABLES.filter((t) => archive.tableNames.includes(t)).filter(
    (t) => scope !== 'user' || USER_IMPORT_TABLES.has(t),
  );
  if (scope === 'user') {
    const ignored = archive.tableNames.filter((t) => (TABLES as readonly string[]).includes(t) && !USER_IMPORT_TABLES.has(t));
    if (ignored.length) {
      report.warnings.push(`个人备份中的全局数据已忽略：${ignored.join('、')}`);
    }
  }

  try {
    if (opts.dryRun) {
      for (const name of names) {
        const r = emptyReport();
        const stream = archive.readTable(name);
        if (stream) for await (const _row of stream) r.inserted++;
        report.tables[name] = r;
      }
      return report;
    }

    // sys_key 必须在事务外确保已落库：SQLite 的事务回滚会撤销事务内新建的 sys_key，
    // 但进程内配置缓存可能已记住它，导致后续密文使用未持久化的密钥。
    const sysKey = await getSysKey();

    await withTransaction(async (q) => {
      if (mode === 'replace') {
        for (const name of [...TABLES].reverse()) {
          if (DELETE_SKIP.has(name)) continue;
          await q(`DELETE FROM ${table(name)}`);
        }
        for (const name of REPLACE_EXTRA_TABLES) {
          await q(`DELETE FROM ${table(name)}`);
        }
      }

      // 安装向导导入：归档内存在管理员时，先删除临时管理员，让用户名与 ID 可被归档用户复用；
      // 删除与导入在同一事务内，导入失败会整体回滚，临时管理员仍在，不会出现无法登录
      if (mode === 'install') {
        let hasAdmin = false;
        const userStream = archive.readTable('user');
        if (userStream) {
          for await (const r of userStream) {
            if (Number(r.level) >= 2) {
              hasAdmin = true;
              break;
            }
          }
        }
        if (hasAdmin) {
          await q(`DELETE FROM ${table('user')} WHERE is_super = 1`);
        }
      }

      const uidMap = new Map<number, number>();
      const aidMap = new Map<number, number>();
      const caidMap = new Map<number, number>();
      const xaidMap = new Map<number, number>();
      const didMap = new Map<number, number>();
      const cdidMap = new Map<number, number>();
      const oidMap = new Map<number, number>();
      const cidMap = new Map<number, number>();
      const taskMap = new Map<number, number>();
      const destMap = new Map<number, number>();
      const userCount = await q(`SELECT COUNT(*) AS c FROM ${table('user')}`);
      const isEmptySite = Number((userCount as any[])[0]?.c || 0) === 0;
      const selfMerge = scope === 'user' && actorUid > 0 && !actorIsAdmin;
      let privateBlocked = false;
      let warnedPrivate = false;

      const colsCache = new Map<string, Set<string>>();
      const cols = async (name: string) => {
        let c = colsCache.get(name);
        if (!c) {
          c = await targetColumns(q, name);
          colsCache.set(name, c);
        }
        return c;
      };

      for (const name of names) {
        const stream = archive.readTable(name);
        if (!stream) continue;
        const rep = emptyReport();
        report.tables[name] = rep;
        const columns = await cols(name);

        for await (const raw of stream) {
          const row = { ...raw };

          switch (name) {
            case 'config': {
              const key = String(row.key || '');
              if (!key || key === 'sys_key' || key === 'backup_key' || key === 'maintenance') {
                report.config.skipped++;
                continue;
              }
              if (mode === 'merge' && !opts.overwriteConfig) {
                report.config.skipped++;
                continue;
              }
              const value = decodeStoredValue(row.value);
              await q(
                `INSERT INTO ${table('config')} (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
                [key, value],
              );
              report.config.updated++;
              continue;
            }
            case 'user': {
              const origId = Number(row.id);
              if (selfMerge) {
                if (origId !== ownerUid) {
                  rep.skipped++;
                  continue;
                }
                uidMap.set(origId, actorUid);
                rep.reused++;
                continue;
              }
              if (scope === 'user' && origId !== ownerUid) {
                // 个人备份只恢复所有者本人，忽略归档里混入的其他用户
                rep.skipped++;
                continue;
              }
              const mapped = await mapUser(q, row, {
                scope,
                mode,
                isEmptySite,
                ownerUid,
                actorUid,
                actorIsAdmin,
                uniqueName,
                cols: columns,
                warn: (msg: string) => report.warnings.push(msg),
              });
              uidMap.set(origId, mapped);
              rep.inserted++;
              continue;
            }
            case 'user_vault': {
              const origUid = Number(row.uid);
              const uid = uidMap.get(origUid);
              if (!uid) {
                rep.skipped++;
                continue;
              }
              const dekBk = typeof row.__dek_bk === 'string' ? Buffer.from(row.__dek_bk, 'base64') : null;
              const dek = dekBk ? unwrapDek(opts.key, dekBk, origUid) : null;
              let wrappedSys: Buffer | null = null;
              let wrappedPass: Buffer | null = null;
              if (userSafe && !selfMerge) {
                // 管理员恢复他人个人备份时，目标用户可能已有保险库；
                // 直接复用，避免 user_vault 主键冲突导致整次导入回滚。
                const target = await q(`SELECT uid FROM ${table('user_vault')} WHERE uid = ?`, [uid]);
                if (target.length) {
                  rep.reused++;
                  continue;
                }
              }
              if (selfMerge) {
                if (!dek) {
                  privateBlocked = true;
                  if (!warnedPrivate) {
                    warnedPrivate = true;
                    report.warnings.push('无法从备份中读取保险库密钥，私有账户未导入');
                  }
                  rep.skipped++;
                  continue;
                }
                const target: any = (await q(`SELECT * FROM ${table('user_vault')} WHERE uid = ?`, [uid]))[0];
                if (target) {
                  const targetDek = await unwrapTargetDek(target, opts.passphrase);
                  if (!targetDek || !targetDek.equals(dek)) {
                    privateBlocked = true;
                    if (!warnedPrivate) {
                      warnedPrivate = true;
                      report.warnings.push('当前保险库与备份密钥不一致，私有账户未导入');
                    }
                    rep.skipped++;
                    continue;
                  }
                  rep.reused++;
                  continue;
                }
              }
              if (dek) {
                if (String(row.mode) === 'none') wrappedSys = wrapDek(deriveSysKek(sysKey), dek, uid);
                else if (scope === 'user') {
                  // 归档密钥 = scrypt(口令, 归档 salt)；把 salt 同步为归档 salt，解锁时才能得到同一 KEK
                  const saltB64 = String(archive.header.kdf?.salt || '');
                  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : null;
                  if (salt && salt.length) {
                    row.salt = salt;
                    row.kdf_params = KDF_PARAMS_JSON;
                    wrappedPass = wrapDek(opts.key, dek, uid);
                  }
                }
              }
              if (uid !== origUid && !wrappedSys && !wrappedPass) {
                rep.dropped++;
                report.warnings.push(`用户 #${origUid} 的保险库因用户 ID 变更未能迁移`);
                continue;
              }
              row.uid = uid;
              if (wrappedSys) row.wrapped_dek_sys = wrappedSys;
              if (wrappedPass) row.wrapped_dek = wrappedPass;
              delete row.__dek_bk;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            case 'account':
            case 'cdn_account':
            case 'cert_account': {
              const accountType = String(row.type || '');
              if (name === 'account') {
                const meta = dnsProviders[accountType];
                if (!meta) {
                  if (!actorIsAdmin) {
                    rep.dropped++;
                    report.warnings.push(`未知 DNS 账户类型「${accountType}」，已跳过`);
                    continue;
                  }
                } else {
                  if (!actorIsAdmin && ADMIN_ONLY_DNS_TYPES.has(accountType)) {
                    rep.dropped++;
                    report.warnings.push(`个人备份中的内网 DNS 账户类型「${accountType}」已跳过`);
                    continue;
                  }
                  if (!actorIsAdmin) row.config = sanitizePlainConfig(row.config, new Set(Object.keys(meta.config || {})));
                }
              } else if (name === 'cdn_account') {
                const meta = cdnConfig[accountType];
                if (!meta) {
                  if (!actorIsAdmin) {
                    rep.dropped++;
                    report.warnings.push(`未知 CDN 账户类型「${accountType}」，已跳过`);
                    continue;
                  }
                } else {
                  if (!actorIsAdmin) row.config = sanitizePlainConfig(row.config, new Set(Object.keys(meta.config || {})));
                }
              } else if (name === 'cert_account') {
                const meta = certConfig[accountType];
                if (!meta && !actorIsAdmin) {
                  rep.dropped++;
                  report.warnings.push(`未知证书账户类型「${accountType}」，已跳过`);
                  continue;
                }
                if (!actorIsAdmin) row.config = sanitizePlainConfig(row.config, new Set(Object.keys(meta?.inputs || {})));
              }
              if (!actorIsAdmin && name === 'cert_account') {
                // 个人备份只允许保留账户记录；证书/部署任务不在白名单内，无法驱动调度器。
                row.deploy = 0;
              }
              const origAid = Number(row.id);
              delete row.id;
              if (selfImport) {
                row.visibility = 'private';
                row.owner_uid = actorUid;
              } else if (userSafe) {
                // 个人备份里的账户一律按私有账户恢复；管理员导入时归属映射到归档中的所有者
                row.visibility = 'private';
              }
              if (privateBlocked && row.visibility === 'private') {
                rep.dropped++;
                continue;
              }
              const owner = Number(row.owner_uid || 0);
              if (!selfImport) row.owner_uid = uidMap.get(owner) ?? 0;
              if (row.visibility === 'private' && !row.owner_uid) {
                rep.dropped++;
                report.warnings.push(`私有账户「${row.name}」的用户未导入，已跳过`);
                continue;
              }
              const hit = await q(
                `SELECT id FROM ${table(name)} WHERE type = ? AND name = ? AND visibility = ? AND owner_uid = ? LIMIT 1`,
                [row.type, row.name, row.visibility || 'shared', row.owner_uid],
              );
              if (hit.length) {
                const id = Number((hit as any[])[0].id);
                (name === 'account' ? aidMap : name === 'cdn_account' ? caidMap : xaidMap).set(origAid, id);
                report.warnings.push(`账户「${row.name}」已存在，已复用原账户且未覆盖凭证`);
                rep.reused++;
                continue;
              }
              const id = await insertRow(q, name, row, columns);
              (name === 'account' ? aidMap : name === 'cdn_account' ? caidMap : xaidMap).set(origAid, id);
              rep.inserted++;
              continue;
            }
            case 'domain_category': {
              const orig = Number(row.id);
              delete row.id;
              const id = await insertRow(q, name, row, columns);
              cidMap.set(orig, id);
              rep.inserted++;
              continue;
            }
            case 'domain': {
              const orig = Number(row.id);
              delete row.id;
              const origAid = Number(row.aid);
              row.aid = aidMap.get(origAid) ?? 0;
              if (origAid && !row.aid) {
                rep.skipped++;
                report.warnings.push(`域名「${row.name}」的云账户未导入，域名已跳过`);
                continue;
              }
              row.cid = cidMap.get(Number(row.cid)) ?? 0;
              const hit = await q(`SELECT id, aid FROM ${table('domain')} WHERE name = ? LIMIT 1`, [row.name]);
              if (hit.length) {
                // 同名域名可能属于另一个云账户；只有账户映射一致时才复用，避免把任务/别名挂到他人域名
                if (Number((hit as any[])[0].aid) !== Number(row.aid)) {
                  rep.skipped++;
                  report.warnings.push(`域名「${row.name}」已存在于其他云账户，已跳过`);
                  continue;
                }
                didMap.set(orig, Number((hit as any[])[0].id));
                rep.reused++;
                continue;
              }
              const id = await insertRow(q, name, row, columns);
              didMap.set(orig, id);
              rep.inserted++;
              continue;
            }
            case 'domain_alias':
            case 'cert_cname':
            case 'cert_link_log':
            case 'dns_check_task':
            case 'dmtask':
            case 'sctask':
            case 'optimizeip': {
              const did = didMap.get(Number(row.did));
              if (!did) {
                rep.skipped++;
                continue;
              }
              row.did = did;
              if (name === 'dns_check_task') {
                const mappedUid = uidMap.get(Number(row.uid));
                if (!mappedUid) {
                  rep.skipped++;
                  continue;
                }
                row.uid = mappedUid;
              }
              if ((name === 'dmtask' || name === 'sctask' || name === 'optimizeip') && 'owner_uid' in row) {
                row.owner_uid = uidMap.get(Number(row.owner_uid)) ?? 0;
              }
              if (name === 'cert_link_log' && Number(row.oid)) {
                const mappedOid = oidMap.get(Number(row.oid));
                if (!mappedOid) {
                  rep.skipped++;
                  continue;
                }
                row.oid = mappedOid;
              }
              const orig = Number(row.id);
              delete row.id;
              const id = await insertRow(q, name, row, columns);
              if (name === 'dmtask') taskMap.set(orig, id);
              rep.inserted++;
              continue;
            }
            case 'cdn_domain': {
              const orig = Number(row.id);
              delete row.id;
              row.aid = caidMap.get(Number(row.aid)) ?? 0;
              row.did = didMap.get(Number(row.did)) ?? 0;
              const hit = await q(`SELECT id, aid FROM ${table('cdn_domain')} WHERE name = ? LIMIT 1`, [row.name]);
              if (hit.length) {
                // 同名加速域名只有归属同一 CDN 账户时才复用，避免挂接他人云端站点
                if (Number((hit as any[])[0].aid) !== Number(row.aid)) {
                  rep.skipped++;
                  report.warnings.push(`加速域名「${row.name}」已存在于其他 CDN 账户，已跳过`);
                  continue;
                }
                cdidMap.set(orig, Number((hit as any[])[0].id));
                rep.reused++;
                continue;
              }
              const id = await insertRow(q, name, row, columns);
              cdidMap.set(orig, id);
              rep.inserted++;
              continue;
            }
            case 'cdn_cache_rule': {
              // did 指向 cdn_domain.id，必须用 CDN 域名映射而不是普通域名映射
              const did = cdidMap.get(Number(row.did));
              if (!did) {
                rep.skipped++;
                continue;
              }
              row.did = did;
              delete row.id;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            case 'cert_order': {
              const orig = Number(row.id);
              row.aid = xaidMap.get(Number(row.aid)) ?? 0;
              // link 中的 cdnDomainId 是旧站点的 CDN 域名 ID，必须重映射；找不到时删除该字段，
              // 避免恢复后把证书联动到同 ID 的另一个站点。
              if (row.link) {
                try {
                  const link = typeof row.link === 'string' ? JSON.parse(row.link) : row.link;
                  if (link && typeof link === 'object' && !Array.isArray(link) && link.cdnDomainId !== undefined) {
                    const mapped = cdidMap.get(Number(link.cdnDomainId));
                    if (mapped) link.cdnDomainId = mapped;
                    else delete link.cdnDomainId;
                    row.link = typeof row.link === 'string' ? JSON.stringify(link) : link;
                  }
                } catch {
                  // 非 JSON 的旧 link 保持原样
                }
              }
              if ('processid' in row) row.processid = safeProcessId(row.processid);
              delete row.id;
              const id = await insertRow(q, name, row, columns);
              oidMap.set(orig, id);
              rep.inserted++;
              continue;
            }
            case 'cert_domain':
            case 'cert_deploy': {
              const oid = oidMap.get(Number(row.oid));
              if (!oid) {
                rep.skipped++;
                continue;
              }
              row.oid = oid;
              if ('aid' in row) row.aid = xaidMap.get(Number(row.aid)) ?? 0;
              if (name === 'cert_deploy' && 'processid' in row) row.processid = safeProcessId(row.processid);
              delete row.id;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            case 'cf_rule_credential': {
              const aid = caidMap.get(Number(row.aid));
              if (!aid) {
                rep.skipped++;
                continue;
              }
              row.aid = aid;
              delete row.id;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            case 'dmlog': {
              const taskid = taskMap.get(Number(row.taskid));
              if (!taskid) {
                rep.skipped++;
                continue;
              }
              row.taskid = taskid;
              delete row.id;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            case 'permission': {
              row.uid = uidMap.get(Number(row.uid)) ?? 0;
              if (!row.uid) {
                rep.skipped++;
                continue;
              }
              const dup = await q(
                `SELECT id FROM ${table('permission')} WHERE uid = ? AND domain = ? AND IFNULL(sub, '') = ? LIMIT 1`,
                [row.uid, row.domain, row.sub || ''],
              );
              if (dup.length) {
                rep.reused++;
                continue;
              }
              delete row.id;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            case 'audit_log': {
              row.uid = uidMap.get(Number(row.uid)) ?? 0;
              delete row.id;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            case 'backup_destination': {
              const orig = Number(row.id);
              delete row.id;
              const id = await insertRow(q, name, row, columns);
              destMap.set(orig, id);
              rep.inserted++;
              continue;
            }
            case 'cdn_preheat_task':
            case 'cdn_cache_task': {
              delete row.id;
              if ('owner_uid' in row) row.owner_uid = uidMap.get(Number(row.owner_uid)) ?? 0;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            case 'backup_schedule': {
              delete row.id;
              // 站点计划目前只支持整站导出；归一化 scope，避免旧归档带 user 值后被当作整站计划执行
              if ('scope' in row) row.scope = 'site';
              row.dest_id = destMap.get(Number(row.dest_id)) ?? 0;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            default: {
              delete row.id;
              await insertRow(q, name, row, columns);
              rep.inserted++;
            }
          }
        }
      }
    });

    return report;
  } finally {
    await archive.dispose();
  }
}

async function mapUser(
  q: Q,
  row: any,
  ctx: {
    scope: string;
    mode: ImportMode;
    isEmptySite: boolean;
    ownerUid: number;
    actorUid: number;
    actorIsAdmin: boolean;
    uniqueName: (q: Q, base: string) => Promise<string>;
    cols: Set<string>;
    warn?: (msg: string) => void;
  },
): Promise<number> {
  const origId = Number(row.id);
  const isOwner = ctx.scope === 'user' && origId === ctx.ownerUid;
  // 管理员导入某个用户的个人备份时，优先复用已存在的用户，避免创建重复账号；
  // 账户/保险库随后会映射到该用户 ID。
  if (ctx.scope === 'user' && ctx.mode === 'merge' && ctx.actorIsAdmin) {
    const existing = await q(`SELECT id FROM ${table('user')} WHERE id = ? OR username = ? LIMIT 1`, [
      origId,
      String(row.username || ''),
    ]);
    if (existing.length) return Number((existing as any[])[0].id);
  }
  let level = Number(row.level || 1);
  let isSuper = Number(row.is_super || 0);
  // 非管理员导入的账号永远只能是普通用户，即使归档中的 scope/level 被伪造。
  if (!ctx.actorIsAdmin) {
    level = 1;
    isSuper = 0;
  }
  // 只有「安装向导 + 空站 + 个人备份」才允许所有者成为管理员；
  // 已运行站点导入个人备份必须保持普通用户，避免自助提权
  if (isOwner && ctx.mode === 'install' && ctx.isEmptySite) {
    level = 2;
    isSuper = 1;
  } else if (ctx.scope === 'user' && ctx.actorUid > 0 && !ctx.actorIsAdmin) {
    throw new Error('该备份不属于当前账号，无法导入');
  } else if (ctx.mode === 'merge' && ctx.scope === 'site' && !ctx.isEmptySite) {
    level = 1;
    isSuper = 0;
  } else if (ctx.mode === 'install' && ctx.scope === 'site') {
    // 整站安装导入：保留原角色，但超管标记只保留第一个管理员
    isSuper = 0;
  } else if (ctx.scope === 'user') {
    level = 1;
    isSuper = 0;
  }
  const username = await ctx.uniqueName(q, String(row.username || 'user'));
  const data: any = {
    ...row,
    id: undefined,
    username,
    level,
    is_super: isSuper,
  };
  delete data.id;

  // 站点 merge 恢复：同一 ID 且用户名一致视为同一用户，直接复用，避免重复账号；
  // ID 被其他用户占用时继续走新用户名 + 新 ID 的路径。
  if (ctx.mode === 'merge' && ctx.scope === 'site') {
    if (origId > 0) {
      const byId: any[] = await q(`SELECT id, username FROM ${table('user')} WHERE id = ? LIMIT 1`, [origId]);
      if (byId.length && String(byId[0].username) === String(row.username || '')) {
        ctx.warn?.(`用户「${row.username}」已存在，已复用原账号`);
        return Number(byId[0].id);
      }
    }
    const email = String(row.email || '').trim();
    if (email) {
      const byEmail: any[] = await q(`SELECT id FROM ${table('user')} WHERE email = ? LIMIT 1`, [email]);
      if (byEmail.length) {
        data.email = null;
        ctx.warn?.(`用户「${row.username}」的邮箱已被占用，恢复时已清空邮箱`);
      }
    }
  }

  // 尽量保留原 ID：保险库包裹层 AAD 绑定 uid，ID 不变才能继续解包
  const canKeepId = origId > 0 && ctx.cols.has('id');
  if (canKeepId) {
    try {
      const id = await insertRow(q, 'user', { ...data, id: origId }, ctx.cols);
      if (id) return origId;
      // MySQL 对显式插入 AUTO_INCREMENT 值的语句可能返回 insertId=0，
      // 不能据此判断失败；回查一次，避免同一用户被重复插入。
      const exists = await q(`SELECT id FROM ${table('user')} WHERE id = ? LIMIT 1`, [origId]);
      if (exists.length) return origId;
    } catch (e: any) {
      // SQLite 下唯一键错误 code 与 MySQL 不同，必须统一判定，否则站点合并导入会整批回滚
      if (!isDuplicateError(e)) throw e;
    }
  }
  return insertRow(q, 'user', data, ctx.cols);
}

/** 便捷模式用 sys_key 解包，口令模式用当前口令解包；失败返回 null */
async function unwrapTargetDek(row: any, passphrase?: string): Promise<Buffer | null> {
  if (String(row.mode) === 'none') {
    if (!row.wrapped_dek_sys) return null;
    return unwrapDek(deriveSysKek(await getSysKey()), Buffer.from(row.wrapped_dek_sys), Number(row.uid));
  }
  if (!passphrase || !row.salt || !row.wrapped_dek) return null;
  let params: any = KDF_PARAMS;
  try {
    params = { ...KDF_PARAMS, ...(JSON.parse(String(row.kdf_params || '{}')) || {}) };
  } catch {
    params = KDF_PARAMS;
  }
  return unwrapDek(await deriveKek(String(passphrase), Buffer.from(row.salt), params), Buffer.from(row.wrapped_dek), Number(row.uid));
}
