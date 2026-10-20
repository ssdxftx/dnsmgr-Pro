import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { query, table } from '../../db.js';
import { getSysKey } from '../../config.js';
import { APP_VERSION } from '../version.js';
import { fmtDateTime } from '../util.js';
import { deriveKek, deriveSysKek, KDF_PARAMS, unwrapDek, wrapDek } from '../vault/keys.js';
import { archiveFileName, backupsDir, ensureDataDirs, writeArchive, type ArchiveStats, type ArchiveTableChunk } from './archive.js';
import { ensureBackupKey, getBackupKey } from './key.js';
import { encodeRow, EXCLUDE_COLUMNS, TABLES, type BackupTable } from './manifest.js';
import { readSnapshot, type SnapshotRead } from './snapshot.js';

export interface ExportOptions {
  scope: 'site' | 'user';
  ownerUid?: number;
  includeLogs?: boolean;
  kind?: 'manual' | 'schedule' | 'pre_restore';
  passphrase?: string;
}

export interface ExportResult {
  jobId: number;
  file: string;
  size: number;
  checksum: string;
  stats: ArchiveStats;
}

interface UserContext {
  uid: number;
  accountIds: Set<number>;
  cdnAccountIds: Set<number>;
  certAccountIds: Set<number>;
  domainIds: Set<number>;
  cdnDomainIds: Set<number>;
  certOrderIds: Set<number>;
  taskIds: Set<number>;
}

const USER_SKIP_TABLES = new Set<string>([
  'config',
  'domain_category',
  'optimizeip',
  'sctask',
  'cdn_preheat_task',
  'cdn_cache_task',
  'reg_code',
  'backup_destination',
  'backup_schedule',
]);

async function buildUserContext(read: SnapshotRead, uid: number): Promise<UserContext> {
  const accounts = await read(`SELECT id FROM ${table('account')} WHERE owner_uid = ?`, [uid]);
  const cdnAccounts = await read(`SELECT id FROM ${table('cdn_account')} WHERE owner_uid = ?`, [uid]);
  const certAccounts = await read(`SELECT id FROM ${table('cert_account')} WHERE owner_uid = ?`, [uid]);
  const perms = await read(`SELECT domain FROM ${table('permission')} WHERE uid = ?`, [uid]);
  const accountIds = new Set<number>(accounts.map((r: any) => Number(r.id)));
  const cdnAccountIds = new Set<number>(cdnAccounts.map((r: any) => Number(r.id)));
  const certAccountIds = new Set<number>(certAccounts.map((r: any) => Number(r.id)));
  const permNames = new Set<string>(perms.map((r: any) => String(r.domain).toLowerCase()));

  const allDomains = await read(`SELECT id, aid, name FROM ${table('domain')}`);
  const domainIds = new Set<number>();
  for (const d of allDomains as any[]) {
    if (accountIds.has(Number(d.aid)) || permNames.has(String(d.name).toLowerCase())) domainIds.add(Number(d.id));
  }

  const allCdn = await read(`SELECT id, aid, did FROM ${table('cdn_domain')}`);
  const cdnDomainIds = new Set<number>();
  for (const d of allCdn as any[]) {
    if (cdnAccountIds.has(Number(d.aid)) || domainIds.has(Number(d.did))) cdnDomainIds.add(Number(d.id));
  }

  const allOrders = await read(`SELECT id, aid FROM ${table('cert_order')}`);
  const certOrderIds = new Set<number>();
  for (const o of allOrders as any[]) {
    if (certAccountIds.has(Number(o.aid))) certOrderIds.add(Number(o.id));
  }

  const tasks = await read(`SELECT id, did FROM ${table('dmtask')}`);
  const taskIds = new Set<number>();
  for (const t of tasks as any[]) {
    if (domainIds.has(Number(t.did))) taskIds.add(Number(t.id));
  }

  return { uid, accountIds, cdnAccountIds, certAccountIds, domainIds, cdnDomainIds, certOrderIds, taskIds };
}

function siteFilter(name: string, excludedUsers: Set<number>) {
  return (row: any): boolean => {
    if (!excludedUsers.size) return true;
    if (name === 'user') return !excludedUsers.has(Number(row.id));
    if (name === 'user_vault') return !excludedUsers.has(Number(row.uid));
    if (name === 'account' || name === 'cdn_account' || name === 'cert_account') {
      return !(row.visibility === 'private' && excludedUsers.has(Number(row.owner_uid)));
    }
    return true;
  };
}

function userFilter(name: string, ctx: UserContext, includeLogs: boolean) {
  return (row: any): boolean => {
    switch (name) {
      case 'user':
        return Number(row.id) === ctx.uid;
      case 'user_vault':
        return Number(row.uid) === ctx.uid;
      case 'permission':
        return Number(row.uid) === ctx.uid;
      case 'account':
      case 'cdn_account':
      case 'cert_account':
        return Number(row.owner_uid) === ctx.uid;
      case 'domain':
        return ctx.domainIds.has(Number(row.id));
      case 'domain_alias':
        return ctx.domainIds.has(Number(row.did));
      case 'cdn_domain':
        return ctx.cdnDomainIds.has(Number(row.id));
      case 'cdn_cache_rule':
        return ctx.cdnDomainIds.has(Number(row.did));
      case 'cert_order':
        return ctx.certOrderIds.has(Number(row.id));
      case 'cert_domain':
        return ctx.certOrderIds.has(Number(row.oid));
      case 'cert_deploy':
        return ctx.certOrderIds.has(Number(row.oid));
      case 'cert_cname':
        return ctx.domainIds.has(Number(row.did));
      case 'cert_link_log':
        return ctx.domainIds.has(Number(row.did));
      case 'cf_rule_credential':
        return ctx.cdnAccountIds.has(Number(row.aid));
      case 'dmtask':
        return ctx.domainIds.has(Number(row.did));
      case 'dmlog':
        return ctx.taskIds.has(Number(row.taskid));
      case 'dns_check_task':
        return ctx.domainIds.has(Number(row.did));
      case 'audit_log':
        return includeLogs && Number(row.uid) === ctx.uid;
      default:
        return false;
    }
  };
}

async function tableChunk(
  read: SnapshotRead,
  name: string,
  keep: (row: any) => boolean,
  transform?: (row: any) => void,
): Promise<ArchiveTableChunk> {
  const cols = (await read(`SHOW COLUMNS FROM ${table(name)}`)) as any[];
  const excluded = EXCLUDE_COLUMNS[name] || [];
  const columns = cols.map((c) => String(c.Field)).filter((c) => !excluded.includes(c));
  const raw = (await read(`SELECT * FROM ${table(name)}`)) as any[];
  const kept = raw.filter(keep);
  for (const r of kept) transform?.(r);
  // 导出期附加的合成列（如保险库的 __dek_bk）必须在 encodeRow 之前写进 columns，否则会被丢弃
  for (const r of kept) {
    for (const k of Object.keys(r)) {
      if (k.startsWith('__') && !columns.includes(k)) columns.push(k);
    }
  }
  const rows = kept.map((r) => encodeRow(r, columns));
  return { name, columns, rows };
}

/**
 * 导出备份。
 * - site：整站全量，跳过用户显式排除的保险库与其私有账户
 * - user：仅本人账户 / 授权域名 / 任务 / 审计
 * 归档强制加密：整站与便捷模式用 bk_，口令模式用保险库口令派生（不落库）。
 */
export async function exportBackup(opts: ExportOptions): Promise<ExportResult> {
  const scope = opts.scope;
  const ownerUid = Number(opts.ownerUid || 0);
  const includeLogs = opts.includeLogs !== false;
  if (scope === 'user' && !ownerUid) throw new Error('个人备份缺少用户标识');

  const jobRows: any = await query(
    `INSERT INTO ${table('backup_job')} (kind, scope, owner_uid, status, include_logs, dest, created_at)
     VALUES (?, ?, ?, 'running', ?, 'local', NOW())`,
    [opts.kind || 'manual', scope, ownerUid, includeLogs ? 1 : 0],
  );
  const jobId = Number(jobRows?.insertId || 0);

  try {
    let key: Buffer;
    let kdf: { algo: string; salt: string | null };
    let vaultStats: Record<string, any> | undefined;
    let userDek: Buffer | null = null;

    if (scope === 'user') {
      const vault = await query<any>(
        `SELECT mode, exclude_from_site_backup, salt, wrapped_dek, kdf_params FROM ${table('user_vault')} WHERE uid = ?`,
        [ownerUid],
      );
      const mode = String(vault[0]?.mode || 'none');
      if (mode === 'passphrase') {
        if (!opts.passphrase) throw new Error('该账户使用口令模式，导出需要输入保险库口令');
        const v = vault[0] || {};
        let params: any = KDF_PARAMS;
        try {
          params = { ...KDF_PARAMS, ...(JSON.parse(String(v.kdf_params || '{}')) || {}) };
        } catch {
          params = KDF_PARAMS;
        }
        if (!v.salt || !v.wrapped_dek) throw new Error('保险库密钥缺失，无法导出私有凭证');
        userDek = unwrapDek(
          await deriveKek(String(opts.passphrase), Buffer.from(v.salt), params),
          Buffer.from(v.wrapped_dek),
          ownerUid,
        );
        if (!userDek) throw new Error('保险库口令错误，无法导出私有凭证');
        const salt = randomBytes(16);
        key = await deriveKek(opts.passphrase, salt, KDF_PARAMS);
        kdf = { algo: 'scrypt', salt: salt.toString('base64') };
      } else {
        key = await ensureBackupKey();
        kdf = { algo: 'raw', salt: null };
      }
      const privateCount = await query<any>(
        `SELECT
           (SELECT COUNT(*) FROM ${table('account')} WHERE owner_uid = ? AND visibility = 'private') +
           (SELECT COUNT(*) FROM ${table('cdn_account')} WHERE owner_uid = ? AND visibility = 'private') +
           (SELECT COUNT(*) FROM ${table('cert_account')} WHERE owner_uid = ? AND visibility = 'private') AS c`,
        [ownerUid, ownerUid, ownerUid],
      );
      vaultStats = { privateAccounts: Number(privateCount[0]?.c || 0), mode };
    } else {
      key = (await getBackupKey()) || (await ensureBackupKey());
      kdf = { algo: 'raw', salt: null };
    }

    await ensureDataDirs();
    const fileName = archiveFileName(scope);
    const outPath = path.join(backupsDir(), fileName);

    const result = await readSnapshot(async (read) => {
      const excludedUsers = new Set<number>();
      if (scope === 'site') {
        const rows = await read(`SELECT uid FROM ${table('user_vault')} WHERE exclude_from_site_backup = 1`);
        for (const r of rows as any[]) excludedUsers.add(Number(r.uid));
      }
      const ctx = scope === 'user' ? await buildUserContext(read, ownerUid) : null;
      if (scope === 'site') {
        const vaultRows = await read(`SELECT mode FROM ${table('user_vault')}`);
        const convenient = (vaultRows as any[]).filter((r) => String(r.mode) === 'none').length;
        const excludeList = [...excludedUsers];
        const notExcluded = excludeList.length ? ` AND owner_uid NOT IN (${excludeList.map(() => '?').join(',')})` : '';
        const privateCount = await read(
          `SELECT
             (SELECT COUNT(*) FROM ${table('account')} WHERE visibility = 'private'${notExcluded}) +
             (SELECT COUNT(*) FROM ${table('cdn_account')} WHERE visibility = 'private'${notExcluded}) +
             (SELECT COUNT(*) FROM ${table('cert_account')} WHERE visibility = 'private'${notExcluded}) AS c`,
          [...excludeList, ...excludeList, ...excludeList],
        );
        vaultStats = {
          privateAccounts: Number((privateCount as any[])[0]?.c || 0),
          convenient,
          excludedUsers: excludedUsers.size,
        };
      }

      const draft = {
        header: {
          formatVersion: 1,
          appVersion: APP_VERSION,
          createdAt: fmtDateTime(),
          scope,
          ownerUid: scope === 'user' ? ownerUid : 0,
          kdf,
          vault: vaultStats,
        },
        tables: async function* () {
          const sysKey = await getSysKey();
          for (const name of TABLES) {
            if (scope === 'user' && USER_SKIP_TABLES.has(name)) continue;
            if (name === 'audit_log' && !includeLogs) continue;
            const keep =
              scope === 'site'
                ? siteFilter(name, excludedUsers)
                : userFilter(name, ctx as UserContext, includeLogs);
            const chunk = await tableChunk(
              read,
              name,
              keep,
              name === 'user_vault'
                ? (row: any) => {
                    const uid = Number(row.uid);
                    // 便捷模式的 DEK 由源站 sys_key 包裹，换站后需要重包，故用归档密钥再包一层
                    if (String(row.mode) === 'none' && row.wrapped_dek_sys) {
                      const dek = unwrapDek(deriveSysKek(sysKey), Buffer.from(row.wrapped_dek_sys), uid);
                      if (dek) row.__dek_bk = wrapDek(key, dek, uid).toString('base64');
                    }
                    // 口令模式个人归档：导出前已用保险库 salt 解出 DEK，换 uid 后重包
                    if (scope === 'user' && String(row.mode) === 'passphrase' && userDek) {
                      row.__dek_bk = wrapDek(key, userDek, uid).toString('base64');
                    }
                  }
                : undefined,
            );
            if (!chunk.columns.length) continue;
            yield chunk;
          }
        },
      };

      const written = await writeArchive(draft, key, outPath);
      return { ...written, fileName };
    });

    await query(
      `UPDATE ${table('backup_job')}
       SET status = 'success', file_name = ?, file_size = ?, checksum = ?, meta = ?, finished_at = NOW()
       WHERE id = ?`,
      [
        result.fileName,
        result.size,
        result.checksum,
        JSON.stringify({ tables: result.stats.tables, vault: vaultStats || null }),
        jobId,
      ],
    );

    return {
      jobId,
      file: result.fileName,
      size: result.size,
      checksum: result.checksum,
      stats: result.stats,
    };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500);
    await query(`UPDATE ${table('backup_job')} SET status = 'failed', error = ?, finished_at = NOW() WHERE id = ?`, [
      msg,
      jobId,
    ]).catch(() => undefined);
    throw e;
  }
}

/** 启动时清理 1 小时前的上传/导出中间文件 */
export async function cleanTmpFiles(): Promise<void> {
  const { readdir, stat, unlink } = await import('node:fs/promises');
  const dir = path.join(process.env.DNSMGR_DATA_DIR || path.resolve(process.cwd(), 'data'), 'tmp');
  const files = await readdir(dir).catch(() => [] as string[]);
  const now = Date.now();
  for (const f of files) {
    const p = path.join(dir, f);
    const st = await stat(p).catch(() => null);
    if (st && now - st.mtimeMs > 3600_000) await unlink(p).catch(() => undefined);
  }
}

export type { BackupTable };
