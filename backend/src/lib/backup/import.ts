import { randomBytes } from 'node:crypto';
import { table, withTransaction, listColumns, isDuplicateError } from '../../db.js';
import { invalidateAllUserPermissions } from '../../auth.js';
import { invalidateEventSubscriptions } from '../events.js';
import { bumpCdnAccountEpoch } from '../cdn/cacheEpoch.js';
import { isGeneratedColumn, type TransactionFn } from '../../db/types.js';
import { getSysKey } from '../../config.js';
import { deriveKek, deriveSysKek, KDF_PARAMS_JSON, kdfParamsFromStored, unwrapDek, wrapDek } from '../vault/keys.js';
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
  /** replace 恢复时在导入事务内自增全部 token_version，保证数据替换与会话失效原子提交 */
  invalidateSessions?: boolean;
  /** 事务真正开始写库时回调；归档解密/校验失败时不会触发 */
  onWriteStart?: () => void;
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

type Q = TransactionFn;

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
const REPLACE_EXTRA_TABLES = [
  'log',
  'cdn_stat_data',
  'reg_verify',
  'totp_replay',
  'notification_log',
  'event_delivery',
  'domain_subcount',
  'async_job',
  'idempotency_key',
  'token_revocation',
  'rate_limit',
  'legacy_nonce',
  // backup_job 不能在此清理：恢复前的安全快照记录必须保留，恢复结束后由 restore 单独清理旧任务
];

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

// API Key 作用域名白名单：只接受模块名或 '*'，其余一律丢弃（fail-closed）
const API_SCOPE_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/** 归档里的 scopes 是任意字符串，导入前必须归一化，避免写出无法解析的作用域 */
function sanitizeApiScopes(raw: any): string[] {
  let list: any = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const v of list) {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) continue;
    if (s === '*') {
      if (!out.includes('*')) out.push('*');
      continue;
    }
    if (API_SCOPE_RE.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
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

async function insertRows(q: Q, name: string, rows: Record<string, any>[], cols: Set<string>): Promise<number> {
  if (!rows.length) return 0;
  // 不同行可能因归档版本缺少列而拥有不同键集合；按键签名分组后使用多行 VALUES，
  // 把大表恢复从「每行一次往返」降为「每批一次往返」。
  const groups = new Map<string, { keys: string[]; rows: Record<string, any>[] }>();
  for (const row of rows) {
    const keys = Object.keys(row).filter((c) => !c.startsWith('__') && cols.has(c));
    if (!keys.length) continue;
    const sig = keys.join('\u0000');
    const group = groups.get(sig) || { keys, rows: [] };
    group.rows.push(row);
    groups.set(sig, group);
  }
  let count = 0;
  for (const group of groups.values()) {
    // SQLite 默认变量上限为 999，按列数动态控制批大小，避免超出参数上限
    const chunkSize = Math.max(1, Math.floor(500 / group.keys.length));
    for (let i = 0; i < group.rows.length; i += chunkSize) {
      const chunk = group.rows.slice(i, i + chunkSize);
      const values = chunk.flatMap((row) => group.keys.map((c) => decodeStoredValue(row[c])));
      const placeholders = chunk.map(() => `(${group.keys.map(() => '?').join(',')})`).join(',');
      await q(
        `INSERT INTO ${table(name)} (${group.keys.map((c) => `\`${c}\``).join(',')}) VALUES ${placeholders}`,
        values,
      );
      count += chunk.length;
    }
  }
  return count;
}

async function insertOrReuse(
  q: Q,
  name: string,
  row: Record<string, any>,
  cols: Set<string>,
  findExisting?: () => Promise<number>,
): Promise<{ id: number; reused: boolean }> {
  if (findExisting) {
    const existing = await findExisting();
    if (existing) return { id: existing, reused: true };
  }
  try {
    return { id: await insertRow(q, name, row, cols), reused: false };
  } catch (e) {
    if (!isDuplicateError(e)) throw e;
    const existing = findExisting ? await findExisting() : 0;
    return { id: existing, reused: true };
  }
}

async function uniqueName(q: Q, base: string): Promise<string> {
  const name = String(base || 'user').slice(0, 64);
  const exists = async (n: string) => {
    const rows = await q(`SELECT id FROM ${table('user')} WHERE username = ? LIMIT 1`, [n]);
    return rows.length > 0;
  };
  if (!(await exists(name))) return name;
  for (let i = 1; i <= 100; i++) {
    const suffix = String(i);
    const n = `${name.slice(0, Math.max(0, 64 - suffix.length))}${suffix}`;
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
    // 个人归档只能导回所有者本人：merge 时不得按归档自声明的 ownerUid 复用其他账号
    // （管理员也一样，否则可映射到超级管理员并注入 api_key 完成提权）。
    // 安装向导是唯一例外：它需要从归档中创建首个管理员账号。
    if (mode !== 'install' && ownerUid !== actorUid) return await reject('个人备份只能由账号本人导入');
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
  // 除安装向导外，个人归档一律视为「本人恢复」：只把归档所有者映射到当前账号，
  // 不创建/复用任何其他用户。管理员导入自己的归档同样走这条路径。
  const selfMerge = scope === 'user' && mode !== 'install' && actorUid > 0;
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
      opts.onWriteStart?.();
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
      // 个人归档的 uid 映射在进入表循环前就固定：仅 owner → 当前账号。
      // 这样即使归档里混入其他 user 行，也无法把账户/Key/保险库挂到别人名下。
      if (selfMerge) uidMap.set(ownerUid, actorUid);
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
      let privateBlocked = false;
      let warnedPrivate = false;
      const blockedPrivateUsers = new Set<number>();

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
        const pendingRows: Record<string, any>[] = [];
        const flushRows = async () => {
          if (!pendingRows.length) return 0;
          const n = await insertRows(q, name, pendingRows, columns);
          pendingRows.length = 0;
          return n;
        };

        for await (const raw of stream) {
          const row = { ...raw };

          switch (name) {
            case 'config': {
              const key = String(row.key || '');
              if (!key || key === 'sys_key' || key === 'backup_key' || key === 'backup_key_prev' || key === 'maintenance') {
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

              // 任何模式下目标已存在保险库都只复用，绝不覆盖：
              // 站点 merge 以前会直接 INSERT，导致重复导入主键冲突，也会让归档预置
              // fail_count/locked_until 或攻击者已知的 DEK 覆盖受害者现有保险库。
              const targetRow: any = (await q(`SELECT * FROM ${table('user_vault')} WHERE uid = ?`, [uid]))[0];
              if (targetRow) {
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
                  const targetDek = await unwrapTargetDek(targetRow, opts.passphrase);
                  if (!targetDek || !targetDek.equals(dek)) {
                    privateBlocked = true;
                    if (!warnedPrivate) {
                      warnedPrivate = true;
                      report.warnings.push('当前保险库与备份密钥不一致，私有账户未导入');
                    }
                    rep.skipped++;
                    continue;
                  }
                } else {
                  // 站点合并：目标已有保险库时不能覆盖，但归档私有账户仍使用源 DEK 的 enc:u1 密文。
                  // DEK 无法证明一致时必须跳过该用户的私有账户，否则会导入一批永远打不开的账户。
                  const targetDek = await unwrapTargetDek(targetRow, opts.passphrase);
                  if (!dek || !targetDek || !targetDek.equals(dek)) {
                    blockedPrivateUsers.add(origUid);
                    report.warnings.push(`用户 #${origUid} 的现有保险库与归档密钥不一致，已跳过其私有账户`);
                  }
                }
                rep.reused++;
                continue;
              }

              // 站点/安装归档中的口令模式保险库没有 __dek_bk（只有个人归档才会附带），
              // 但当 uid 未变化时，salt+wrapped_dek 本身就是可用的包裹层，必须原样保留。
              // 旧逻辑把“没有归档 DEK”当成损坏，导致整站恢复后口令模式保险库和全部私有账户被丢弃。
              if (
                !dek &&
                scope !== 'user' &&
                String(row.mode) === 'passphrase' &&
                Number(uid) === Number(origUid) &&
                row.salt &&
                row.wrapped_dek
              ) {
                // 该快捷分支也会把 kdf_params 原样写库；必须用严格上限校验，避免导入后永远无法解锁。
                if (!kdfParamsFromStored(row.kdf_params, false)) {
                  rep.dropped++;
                  report.warnings.push(`用户 #${origUid} 的保险库 KDF 参数超出导入上限，已跳过`);
                  continue;
                }
                row.fail_count = 0;
                row.locked_until = null;
                delete row.__dek_bk;
                await insertRow(q, name, row, columns);
                rep.inserted++;
                continue;
              }

              // 便捷模式没有 __dek_bk：整站替换/安装时 sys_key 不变，wrapped_dek_sys 仍然有效，
              // 必须原样保留；否则恢复后用户保险库整个丢失（交叉备份测试也依赖该行为）。
              if (
                !dek &&
                scope !== 'user' &&
                String(row.mode) === 'none' &&
                Number(uid) === Number(origUid)
              ) {
                if (!row.wrapped_dek_sys) blockedPrivateUsers.add(origUid);
                row.fail_count = 0;
                row.locked_until = null;
                delete row.__dek_bk;
                await insertRow(q, name, row, columns);
                rep.inserted++;
                continue;
              }

              if (!dek) {
                if (scope === 'site') blockedPrivateUsers.add(origUid);
                // 缺少归档 DEK 时，口令模式无法重建包裹层；直接跳过，绝不落一条打不开的保险库。
                if (String(row.mode) === 'passphrase' || selfMerge) {
                  privateBlocked = true;
                  if (!warnedPrivate) {
                    warnedPrivate = true;
                    report.warnings.push('无法从备份中读取保险库密钥，私有账户未导入');
                  }
                }
                rep.skipped++;
                continue;
              }

              // 运行态字段必须清零；恢复码只在 uid 发生变化时失效（包裹层 AAD 绑定 uid）。
              row.fail_count = 0;
              row.locked_until = null;
              if (uid !== origUid) {
                row.recovery_hash = null;
                row.salt_recovery = null;
                row.wrapped_dek_recovery = null;
              }

              if (String(row.mode) === 'none') {
                wrappedSys = wrapDek(deriveSysKek(sysKey), dek, uid);
                row.kdf = 'scrypt';
                row.kdf_params = KDF_PARAMS_JSON;
                row.salt = null;
                row.wrapped_dek = null;
              } else if (scope === 'user') {
                // 归档密钥 = scrypt(口令, 归档 salt)；把 salt 同步为归档 salt，解锁时才能得到同一 KEK。
                // 缺少 salt 的归档视为损坏（而不是保留归档里可能恶意的 kdf_params）。
                const saltB64 = String(archive.header.kdf?.salt || '');
                const salt = saltB64 ? Buffer.from(saltB64, 'base64') : null;
                if (!salt || !salt.length) {
                  privateBlocked = true;
                  if (!warnedPrivate) {
                    warnedPrivate = true;
                    report.warnings.push('备份缺少保险库 KDF 盐，私有账户未导入');
                  }
                  rep.skipped++;
                  continue;
                }
                row.salt = salt;
                row.kdf = 'scrypt';
                row.kdf_params = KDF_PARAMS_JSON;
                wrappedPass = wrapDek(opts.key, dek, uid);
              } else {
                // 站点/安装归档保留原口令包裹层（uid 变化时下方会因无法迁移而丢弃），
                // 这里只校验参数可解析，不能静默改写成默认参数：wrapped_dek 仍是旧参数。
                const params = kdfParamsFromStored(row.kdf_params, false);
                if (!params || !row.wrapped_dek) {
                  rep.dropped++;
                  report.warnings.push(`用户 #${origUid} 的保险库 KDF 参数或口令包裹层无效，已跳过`);
                  continue;
                }
              }
              if (uid !== origUid && !wrappedSys && !wrappedPass) {
                rep.dropped++;
                report.warnings.push(`用户 #${origUid} 的保险库因用户 ID 变更未能迁移`);
                continue;
              }
              row.uid = uid;
              if (wrappedSys) row.wrapped_dek_sys = wrappedSys;
              if (wrappedPass) {
                row.wrapped_dek = wrappedPass;
                // 口令模式不应保留归档里的 sys 包裹层，避免模式/包裹层不一致
                row.wrapped_dek_sys = null;
              }
              delete row.__dek_bk;
              await insertRow(q, name, row, columns);
              rep.inserted++;
              continue;
            }
            case 'api_key': {
              // 归档中的 uid 是导出站点的用户 ID，必须重映射到本次导入后的用户。
              // 不重映射时，个人归档可以插入一行 uid=1 的 Key，导入者随后用该 Key
              // 认证即可拿到管理员身份（备份导入提权）。
              const mappedUid = uidMap.get(Number(row.uid));
              if (!mappedUid) {
                rep.skipped++;
                report.warnings.push('API Key 所属用户未导入，已跳过');
                continue;
              }
              if (scope === 'user' && mode !== 'install' && mappedUid !== actorUid) {
                // 个人归档里的 Key 只能落回本人：否则导入通道会被用来给其他账号
                // （含超管）写入一把上传者已知明文的 Key。
                rep.skipped++;
                report.warnings.push('API Key 不属于当前账号，已跳过');
                continue;
              }
              const keyHash = String(row.key_hash || '').trim().toLowerCase();
              if (!/^[0-9a-f]{64}$/.test(keyHash)) {
                rep.skipped++;
                report.warnings.push('API Key 哈希格式不合法，已跳过');
                continue;
              }
              row.uid = mappedUid;
              row.key_hash = keyHash;
              // 作用域按模块名白名单归一化：归档里的任意字符串不能变成全权限
              row.scopes = JSON.stringify(sanitizeApiScopes(row.scopes));
              if ('active' in row) row.active = Number(row.active) === 1 ? 1 : 0;
              if (row.expires_at) {
                const exp = new Date(String(row.expires_at).replace(' ', 'T')).getTime();
                if (!Number.isFinite(exp)) row.expires_at = null;
              }
              // key_hash 唯一：同一把 Key 重复导入时复用已有记录，不覆盖其归属
              const dupKey = await q(`SELECT id FROM ${table('api_key')} WHERE key_hash = ? LIMIT 1`, [keyHash]);
              if (dupKey.length) {
                rep.reused++;
                continue;
              }
              delete row.id;
              await insertRow(q, 'api_key', row, columns);
              rep.inserted++;
              continue;
            }
            case 'account':
            case 'cdn_account':
            case 'cert_account': {
              const accountType = String(row.type || '');
              const origOwner = Number(row.owner_uid || 0);
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
              if ((privateBlocked || blockedPrivateUsers.has(origOwner)) && row.visibility === 'private') {
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
              const hit = await q(`SELECT id FROM ${table('domain')} WHERE aid = ? AND name = ? LIMIT 1`, [row.aid, row.name]);
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
            case 'cert_cname':
            case 'cert_link_log':
            case 'dns_check_task':
            case 'dmtask':
            case 'sctask':
            case 'optimizeip': {
              const did = (name === 'cert_link_log' ? cdidMap : didMap).get(Number(row.did));
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
              const findExisting = mode === 'merge' ? async (): Promise<number> => {
                let hit: any[] = [];
                if (name === 'domain_alias') {
                  hit = await q(`SELECT id FROM ${table(name)} WHERE did = ? AND name = ? LIMIT 1`, [row.did, row.name]);
                } else if (name === 'cert_cname') {
                  hit = await q(`SELECT id FROM ${table(name)} WHERE domain = ? OR (did = ? AND rr = ?) LIMIT 1`, [
                    row.domain,
                    row.did,
                    row.rr,
                  ]);
                } else if (name === 'cert_link_log') {
                  hit = await q(
                    `SELECT id FROM ${table(name)} WHERE did = ? AND oid = ? AND node = ? AND status = ? AND IFNULL(message, '') = ? LIMIT 1`,
                    [row.did, row.oid, row.node, row.status, String(row.message || '')],
                  );
                } else if (name === 'dns_check_task') {
                  hit = await q(
                    `SELECT id FROM ${table(name)} WHERE did = ? AND uid = ? AND IFNULL(sub, '') = ? AND name = ? LIMIT 1`,
                    [row.did, row.uid, String(row.sub || ''), String(row.name || '')],
                  );
                } else if (name === 'dmtask') {
                  hit = await q(`SELECT id FROM ${table(name)} WHERE did = ? AND recordid = ? LIMIT 1`, [row.did, row.recordid]);
                } else if (name === 'sctask') {
                  hit = await q(
                    `SELECT id FROM ${table(name)} WHERE did = ? AND recordid = ? AND switchtype = ? AND switchtime = ? LIMIT 1`,
                    [row.did, row.recordid, row.switchtype, row.switchtime],
                  );
                } else if (name === 'optimizeip') {
                  hit = await q(`SELECT id FROM ${table(name)} WHERE did = ? AND rr = ? LIMIT 1`, [row.did, row.rr]);
                }
                return Number((hit as any[])[0]?.id || 0);
              } : undefined;
              const inserted = await insertOrReuse(q, name, row, columns, findExisting);
              if (name === 'dmtask' && inserted.id) taskMap.set(orig, inserted.id);
              if (inserted.reused) rep.reused++;
              else rep.inserted++;
              continue;
            }
            case 'cdn_domain': {
              const orig = Number(row.id);
              const origAid = Number(row.aid);
              const mappedAid = caidMap.get(origAid);
              if (origAid && !mappedAid) {
                rep.dropped++;
                continue;
              }
              delete row.id;
              row.aid = mappedAid ?? 0;
              row.did = didMap.get(Number(row.did)) ?? 0;
              const hit = await q(`SELECT id FROM ${table('cdn_domain')} WHERE aid = ? AND name = ? LIMIT 1`, [row.aid, row.name]);
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
            case 'cdn_cache_rule': {
              // did 指向 cdn_domain.id，必须用 CDN 域名映射而不是普通域名映射
              const did = cdidMap.get(Number(row.did));
              if (!did) {
                rep.skipped++;
                continue;
              }
              row.did = did;
              delete row.id;
              const findExisting = mode === 'merge' ? async (): Promise<number> => {
                const hit = await q(`SELECT id FROM ${table('cdn_cache_rule')} WHERE did = ? AND path = ? LIMIT 1`, [
                  row.did,
                  row.path,
                ]);
                return Number((hit as any[])[0]?.id || 0);
              } : undefined;
              const inserted = await insertOrReuse(q, name, row, columns, findExisting);
              if (inserted.reused) rep.reused++;
              else rep.inserted++;
              continue;
            }
            case 'cert_order': {
              const orig = Number(row.id);
              const origAid = Number(row.aid);
              const mappedAid = xaidMap.get(origAid);
              if (origAid && !mappedAid) {
                rep.dropped++;
                continue;
              }
              row.aid = mappedAid ?? 0;
              // link 中的 cdnDomainId 是旧站点的 CDN 域名 ID，必须重映射；找不到时删除该字段，
              // 避免恢复后把证书联动到同 ID 的另一个站点。
              if (row.link) {
                try {
                  const link = typeof row.link === 'string' ? JSON.parse(row.link) : row.link;
                  if (link && typeof link === 'object' && !Array.isArray(link)) {
                    const mappedIds: number[] = [];
                    if (Array.isArray(link.cdnDomainIds)) {
                      for (const oldId of link.cdnDomainIds) {
                        const mapped = cdidMap.get(Number(oldId));
                        if (mapped && !mappedIds.includes(mapped)) mappedIds.push(mapped);
                      }
                    }
                    const primary = cdidMap.get(Number(link.cdnDomainId));
                    if (primary && !mappedIds.includes(primary)) mappedIds.unshift(primary);
                    if (mappedIds.length) {
                      link.cdnDomainId = mappedIds[0];
                      link.cdnDomainIds = mappedIds;
                    } else {
                      delete link.cdnDomainId;
                      delete link.cdnDomainIds;
                    }
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
              const findExisting = mode === 'merge' && name === 'cert_domain' ? async (): Promise<number> => {
                const hit = await q(`SELECT id FROM ${table('cert_domain')} WHERE oid = ? AND domain = ? LIMIT 1`, [
                  oid,
                  row.domain,
                ]);
                return Number((hit as any[])[0]?.id || 0);
              } : undefined;
              const inserted = await insertOrReuse(q, name, row, columns, findExisting);
              if (inserted.reused) rep.reused++;
              else rep.inserted++;
              continue;
            }
            case 'cf_rule_credential': {
              // cf_rule_credential.aid 指向 DNS 账户（account.id），不是 CDN 账户
              const aid = aidMap.get(Number(row.aid));
              if (!aid) {
                rep.skipped++;
                continue;
              }
              row.aid = aid;
              delete row.id;
              const findExisting = mode === 'merge' ? async (): Promise<number> => {
                const hit = await q(`SELECT id FROM ${table('cf_rule_credential')} WHERE aid = ? LIMIT 1`, [aid]);
                return Number((hit as any[])[0]?.id || 0);
              } : undefined;
              const inserted = await insertOrReuse(q, name, row, columns, findExisting);
              if (inserted.reused) rep.reused++;
              else rep.inserted++;
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
              pendingRows.push(row);
              if (pendingRows.length >= 500) rep.inserted += await flushRows();
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
              pendingRows.push(row);
              if (pendingRows.length >= 500) rep.inserted += await flushRows();
              continue;
            }
            case 'backup_destination': {
              const orig = Number(row.id);
              delete row.id;
              const findExisting = mode === 'merge' ? async (): Promise<number> => {
                const hit = await q(`SELECT id FROM ${table('backup_destination')} WHERE name = ? AND type = ? LIMIT 1`, [
                  row.name,
                  row.type,
                ]);
                return Number((hit as any[])[0]?.id || 0);
              } : undefined;
              const inserted = await insertOrReuse(q, name, row, columns, findExisting);
              if (inserted.id) destMap.set(orig, inserted.id);
              if (inserted.reused) rep.reused++;
              else rep.inserted++;
              continue;
            }
            case 'cdn_preheat_task':
            case 'cdn_cache_task': {
              delete row.id;
              if ('owner_uid' in row) row.owner_uid = uidMap.get(Number(row.owner_uid)) ?? 0;
              const findExisting = mode === 'merge' ? async (): Promise<number> => {
                let hit: any[] = [];
                if (name === 'cdn_preheat_task') {
                  hit = await q(
                    `SELECT id FROM ${table(name)} WHERE name = ? AND op = ? AND urls = ? LIMIT 1`,
                    [row.name, row.op, row.urls],
                  );
                } else {
                  hit = await q(
                    `SELECT id FROM ${table(name)} WHERE url = ? AND type = ? AND provider = ? AND task_id = ? LIMIT 1`,
                    [row.url, row.type, row.provider, row.task_id],
                  );
                }
                return Number((hit as any[])[0]?.id || 0);
              } : undefined;
              const inserted = await insertOrReuse(q, name, row, columns, findExisting);
              if (inserted.reused) rep.reused++;
              else rep.inserted++;
              continue;
            }
            case 'backup_schedule': {
              delete row.id;
              // 站点计划目前只支持整站导出；归一化 scope，避免旧归档带 user 值后被当作整站计划执行
              if ('scope' in row) row.scope = 'site';
              row.dest_id = destMap.get(Number(row.dest_id)) ?? 0;
              const findExisting = mode === 'merge' && row.name ? async (): Promise<number> => {
                const hit = await q(`SELECT id FROM ${table('backup_schedule')} WHERE name = ? LIMIT 1`, [row.name]);
                return Number((hit as any[])[0]?.id || 0);
              } : undefined;
              const inserted = await insertOrReuse(q, name, row, columns, findExisting);
              if (inserted.reused) rep.reused++;
              else rep.inserted++;
              continue;
            }
            case 'reg_code': {
              delete row.id;
              const findExisting = mode === 'merge' && row.code ? async (): Promise<number> => {
                const hit = await q(`SELECT id FROM ${table('reg_code')} WHERE code = ? LIMIT 1`, [row.code]);
                return Number((hit as any[])[0]?.id || 0);
              } : undefined;
              const inserted = await insertOrReuse(q, name, row, columns, findExisting);
              if (inserted.reused) rep.reused++;
              else rep.inserted++;
              continue;
            }
            default: {
              delete row.id;
              const inserted = await insertOrReuse(q, name, row, columns);
              if (inserted.reused) rep.reused++;
              else rep.inserted++;
            }
          }
        }
        if (pendingRows.length) rep.inserted += await flushRows();
      }
      // 整站替换后必须仍有可登录的管理员：归档缺 user 表、被裁剪或只含普通用户时，
      // 提交后既无法登录也无法通过自助接口恢复，只能手工改库。
      if (mode === 'replace' && scope === 'site') {
        const adminRow = await q(`SELECT COUNT(*) AS c FROM ${table('user')} WHERE level >= 2 AND status = 1`);
        if (Number((adminRow as any[])[0]?.c || 0) === 0) {
          throw new Error('归档中没有可用的管理员账号，已取消恢复');
        }
      }
      if (opts.invalidateSessions) {
        // 与数据替换同事务：恢复提交即旧 JWT 失效，不会出现“数据已换、会话未失效”的窗口。
        await q(`UPDATE ${table('user')} SET token_version = token_version + 1`);
      }
    });

    // 恢复可能替换权限与事件订阅：提交后立即丢弃进程内缓存。
    invalidateAllUserPermissions();
    invalidateEventSubscriptions();
    bumpCdnAccountEpoch();
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
  const params = kdfParamsFromStored(row.kdf_params);
  if (!params) return null;
  return unwrapDek(
    await deriveKek(String(passphrase), Buffer.from(row.salt), params),
    Buffer.from(row.wrapped_dek),
    Number(row.uid),
  );
}
