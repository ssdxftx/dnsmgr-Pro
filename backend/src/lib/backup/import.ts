import { randomBytes } from 'node:crypto';
import { query, table, withTransaction } from '../../db.js';
import { getSysKey } from '../../config.js';
import { deriveKek, deriveSysKek, KDF_PARAMS, KDF_PARAMS_JSON, unwrapDek, wrapDek } from '../vault/keys.js';
import { decodeStoredValue, TABLES } from './manifest.js';
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

const DELETE_SKIP = new Set(['config', 'backup_destination', 'backup_schedule']);

function emptyReport(): TableReport {
  return { inserted: 0, reused: 0, skipped: 0, dropped: 0 };
}

function rowsOf(v: any): any[] {
  return Array.isArray(v?.data) ? v.data : [];
}

/** 目标表实际列，避免归档里版本较新的列导致 INSERT 失败 */
async function targetColumns(q: Q, name: string): Promise<Set<string>> {
  const rows = await q(`SHOW COLUMNS FROM ${table(name)}`);
  return new Set((rows as any[]).map((r) => String(r.Field)));
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
  const scope = String(header.scope || 'site');
  const mode = opts.mode;
  const report: ImportReport = {
    scope,
    mode,
    dryRun: opts.dryRun === true,
    tables: {},
    config: { updated: 0, skipped: 0 },
    warnings: [],
  };

  try {
    const names = TABLES.filter((t) => archive.tableNames.includes(t));

    if (opts.dryRun) {
      for (const name of names) {
        const data = archive.readTable(name);
        const r = emptyReport();
        r.inserted = rowsOf(data).length;
        report.tables[name] = r;
      }
      return report;
    }

    await withTransaction(async (q) => {
      if (mode === 'replace') {
        for (const name of [...TABLES].reverse()) {
          if (DELETE_SKIP.has(name)) continue;
          await q(`DELETE FROM ${table(name)}`);
        }
      }

      // 安装向导导入：归档内存在管理员时，先删除临时管理员，让用户名与 ID 可被归档用户复用；
      // 删除与导入在同一事务内，导入失败会整体回滚，临时管理员仍在，不会出现无法登录
      if (mode === 'install') {
        const userTable = archive.readTable('user');
        const hasAdmin = rowsOf(userTable).some((r) => Number(r.level) >= 2);
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
      const sysKey = await getSysKey();
      const ownerUid = Number(header.ownerUid || 0);
      const actorUid = Number(opts.actor?.uid || 0);
      const actorIsAdmin = opts.actorIsAdmin === true;
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
        const data = archive.readTable(name);
        const rows = rowsOf(data);
        const rep = emptyReport();
        report.tables[name] = rep;
        const columns = await cols(name);

        for (const raw of rows) {
          const row = { ...raw };

          switch (name) {
            case 'config': {
              const key = String(row.key || '');
              if (!key || key === 'sys_key' || key === 'backup_key') {
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
              const mapped = await mapUser(q, row, {
                scope,
                mode,
                isEmptySite,
                ownerUid,
                actorUid,
                actorIsAdmin,
                uniqueName,
                cols: columns,
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
              const origAid = Number(row.id);
              if (privateBlocked && row.visibility === 'private') {
                rep.dropped++;
                continue;
              }
              const owner = Number(row.owner_uid || 0);
              row.owner_uid = uidMap.get(owner) ?? 0;
              const hit = await q(
                `SELECT id FROM ${table(name)} WHERE type = ? AND name = ? AND visibility = ? AND owner_uid = ? LIMIT 1`,
                [row.type, row.name, row.visibility || 'shared', row.owner_uid],
              );
              if (hit.length) {
                const id = Number((hit as any[])[0].id);
                (name === 'account' ? aidMap : name === 'cdn_account' ? caidMap : xaidMap).set(origAid, id);
                const existing: any = (await q(`SELECT * FROM ${table(name)} WHERE id = ?`, [id]))[0];
                if (existing && credentialsDiffer(existing, row)) {
                  report.warnings.push(`账户「${row.name}」已存在但配置不同，已复用原账户（未覆盖凭证）`);
                }
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
              const origAid = Number(row.aid);
              row.aid = aidMap.get(origAid) ?? 0;
              if (origAid && !row.aid) {
                rep.skipped++;
                report.warnings.push(`域名「${row.name}」的云账户未导入，域名已跳过`);
                continue;
              }
              row.cid = cidMap.get(Number(row.cid)) ?? 0;
              const hit = await q(`SELECT id FROM ${table('domain')} WHERE name = ? LIMIT 1`, [row.name]);
              if (hit.length) {
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
            case 'cdn_cache_rule':
            case 'cert_cname':
            case 'cert_link_log':
            case 'dns_check_task':
            case 'dmtask': {
              const did = didMap.get(Number(row.did));
              if (!did) {
                rep.skipped++;
                continue;
              }
              row.did = did;
              const orig = Number(row.id);
              delete row.id;
              const id = await insertRow(q, name, row, columns);
              if (name === 'dmtask') taskMap.set(orig, id);
              rep.inserted++;
              continue;
            }
            case 'cdn_domain': {
              const orig = Number(row.id);
              row.aid = caidMap.get(Number(row.aid)) ?? 0;
              row.did = didMap.get(Number(row.did)) ?? 0;
              const hit = await q(`SELECT id FROM ${table('cdn_domain')} WHERE name = ? LIMIT 1`, [row.name]);
              if (hit.length) {
                cdidMap.set(orig, Number((hit as any[])[0].id));
                rep.reused++;
                continue;
              }
              const id = await insertRow(q, name, row, columns);
              cdidMap.set(orig, id);
              rep.inserted++;
              continue;
            }
            case 'cert_order': {
              const orig = Number(row.id);
              row.aid = xaidMap.get(Number(row.aid)) ?? 0;
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
            case 'backup_schedule': {
              delete row.id;
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
  },
): Promise<number> {
  const origId = Number(row.id);
  const isOwner = ctx.scope === 'user' && origId === ctx.ownerUid;
  let level = Number(row.level || 1);
  let isSuper = Number(row.is_super || 0);
  // 只有「安装向导 + 空站 + 个人备份」才允许所有者成为管理员；
  // 已运行站点导入个人备份必须保持普通用户，避免自助提权
  if (isOwner && ctx.mode === 'install' && ctx.isEmptySite) {
    level = 2;
    isSuper = 1;
  } else if (ctx.scope === 'user' && ctx.actorUid > 0 && !ctx.actorIsAdmin) {
    throw new Error('该备份不属于当前账号，无法导入');
  } else if (ctx.mode === 'merge' && ctx.scope === 'site') {
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
  const data = {
    ...row,
    id: undefined,
    username,
    level,
    is_super: isSuper,
  };
  delete (data as any).id;

  // 尽量保留原 ID：保险库包裹层 AAD 绑定 uid，ID 不变才能继续解包
  const canKeepId = origId > 0 && ctx.cols.has('id');
  if (canKeepId) {
    try {
      const id = await insertRow(q, 'user', { ...data, id: origId }, ctx.cols);
      if (id) return origId;
    } catch (e: any) {
      if (e?.code !== 'ER_DUP_ENTRY') throw e;
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

const ACCOUNT_COMPARE_SKIP = new Set(['id', 'addtime', 'updatetime', 'created_at', 'updated_at']);

/** 只比较非密文配置项：密文每次加密 IV 不同，且导入会重新加密，不能直接比对 */
function comparable(v: any): any {
  if (v && typeof v === 'object' && ('__encv1' in v || '__b64' in v)) return null;
  if (typeof v === 'string' && (v.startsWith('enc:v1:') || v.startsWith('enc:u1:'))) return null;
  if (Buffer.isBuffer(v)) return null;
  return v;
}

function credentialsDiffer(existing: any, incoming: any): boolean {
  for (const [k, v] of Object.entries(incoming)) {
    if (k.startsWith('__') || ACCOUNT_COMPARE_SKIP.has(k)) continue;
    const b = comparable(v);
    if (b === null || b === undefined) continue;
    const a = comparable(existing[k]);
    if (a === null || a === undefined) continue;
    if (typeof a === 'object' || typeof b === 'object') {
      if (JSON.stringify(a) !== JSON.stringify(b)) return true;
    } else if (String(a) !== String(b)) {
      return true;
    }
  }
  return false;
}
