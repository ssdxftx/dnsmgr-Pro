import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { audit } from '../lib/audit/context.js';
import { decryptConfig, encryptConfig, maskConfig, mergeMaskedConfig } from '../lib/secret.js';
import {
  backupsDir,
  ensureDataDirs,
  readArchiveHeader,
  resolveArchivePath,
} from '../lib/backup/archive.js';
import { exportBackup } from '../lib/backup/export.js';
import { importArchive } from '../lib/backup/import.js';
import { applyBackupRetention, applyScheduleRetention } from '../lib/backup/retention.js';
import { hasBackupKey, rotateBackupKey, keyForArchive } from '../lib/backup/key.js';
import { getRestoreStatus, isMaintenance, setMaintenance } from '../lib/backup/maintenance.js';
import { restoreBackup, restoreFromArchive } from '../lib/backup/restore.js';
import { withDistributedLockResult } from '../lib/scheduler/distLock.js';
import {
  deleteRemote,
  downloadRemote,
  getDestination,
  listRemote,
  testDestination,
  uploadToDestination,
} from '../lib/backup/destinations.js';
import { saveUpload, releaseTemp } from '../lib/backup/upload.js';
import { contentDisposition } from '../lib/util.js';
import { hitRateLimit } from '../lib/rateLimit.js';
import { requireLoginPassword } from '../lib/reauth.js';
import { publicError } from '../lib/util.js';

function isAdmin(user: any): boolean {
  return checkLevel(user, 2);
}

function archiveMeta(name: string) {
  const scope = name.startsWith('user-') ? 'user' : 'site';
  const m = /^(?:site|user)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(name);
  return {
    scope,
    createdAt: m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : '',
    restorable: scope === 'site',
  };
}

function computeNextRun(row: any, from = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(Number(row.hour || 3), Number(row.minute || 0));
  if (String(row.freq) === 'weekly') {
    const target = Math.max(1, Math.min(7, Number(row.weekday || 1)));
    const cur = next.getDay() === 0 ? 7 : next.getDay();
    let delta = target - cur;
    if (delta < 0 || (delta === 0 && next <= from)) delta += 7;
    next.setDate(next.getDate() + delta);
    return fmt(next);
  }
  if (next <= from) next.setDate(next.getDate() + 1);
  return fmt(next);
}

export default async function backupRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).authenticate };
  app.addHook('onSend', async (_req: any, reply: any, payload: any) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // ===== 导出 / 历史 =====
  app.post('/api/backup/export', auth, async (req: any, reply: any) => {
    const b = req.body || {};
    const scope = b.scope === 'user' ? 'user' : 'site';
    if (scope === 'site' && !isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    // 恢复/维护期间表数据正在被替换，此时导出会得到不一致快照
    if (isMaintenance()) return reply.code(409).send({ code: -1, msg: '系统维护中，暂不能导出备份' });
    if (!hitRateLimit(`backup:export:${req.user.uid}`, 5, 10 * 60_000)) {
      return reply.code(429).send({ code: -1, msg: '备份导出过于频繁，请稍后再试' });
    }
    try {
      const r = await exportBackup({
        scope,
        ownerUid: scope === 'user' ? Number(req.user.uid) : 0,
        includeLogs: b.include_logs !== false,
        passphrase: b.passphrase ? String(b.passphrase) : undefined,
        kind: 'manual',
      });
      // 普通用户只能落本地，避免把个人备份写入管理员配置的远端存储
      const destId = isAdmin(req.user) ? Number(b.dest_id || 0) : 0;
      if (destId > 0) {
        await uploadToDestination(destId, resolveArchivePath(r.file), r.file);
        const dest = await getDestination(destId);
        await query(`UPDATE ${table('backup_job')} SET dest = ?, dest_id = ? WHERE id = ?`, [
          dest?.type || 'local',
          destId,
          r.jobId,
        ]);
      }
      await applyBackupRetention({
        kind: 'manual',
        scope,
        ownerUid: scope === 'user' ? Number(req.user.uid) : 0,
        keepCount: Number(process.env.DNSMGR_BACKUP_KEEP_COUNT || 10),
        keepDays: Number(process.env.DNSMGR_BACKUP_KEEP_DAYS || 30),
      }).catch(() => undefined);
      audit(req, { module: 'backup', action: 'backup.export', targetType: 'backup', targetId: r.jobId, summary: `导出${scope === 'site' ? '整站' : '个人'}备份` });
      return { code: 0, msg: '备份完成', data: r };
    } catch (e: any) {
      return reply.send({ code: -1, msg: publicError(e) });
    }
  });

  app.get('/api/backup/jobs', auth, async (req: any) => {
    const admin = isAdmin(req.user);
    const rows = admin
      ? await query(`SELECT * FROM ${table('backup_job')} ORDER BY id DESC LIMIT 200`)
      : await query(`SELECT * FROM ${table('backup_job')} WHERE owner_uid = ? ORDER BY id DESC LIMIT 200`, [req.user.uid]);
    return { code: 0, data: rows };
  });

  app.get('/api/backup/jobs/:id/download', auth, async (req: any, reply: any) => {
    const job: any = await queryOne(`SELECT * FROM ${table('backup_job')} WHERE id = ?`, [Number(req.params.id)]);
    if (!job || (!isAdmin(req.user) && Number(job.owner_uid) !== Number(req.user.uid))) {
      return reply.code(404).send({ code: -1, msg: '备份不存在' });
    }
    let file: string;
    try {
      file = resolveArchivePath(String(job.file_name || ''));
      await stat(file);
    } catch {
      return reply.code(404).send({ code: -1, msg: '备份文件不存在' });
    }
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', contentDisposition(path.basename(file)));
    return reply.send(createReadStream(file));
  });

  app.delete('/api/backup/jobs/:id', auth, async (req: any, reply: any) => {
    const job: any = await queryOne(`SELECT * FROM ${table('backup_job')} WHERE id = ?`, [Number(req.params.id)]);
    if (!job || (!isAdmin(req.user) && Number(job.owner_uid) !== Number(req.user.uid))) {
      return reply.code(404).send({ code: -1, msg: '备份不存在' });
    }
    if (job.file_name) {
      if (job.dest_id) await deleteRemote(Number(job.dest_id), String(job.file_name));
      await unlink(resolveArchivePath(String(job.file_name))).catch(() => undefined);
    }
    await query(`DELETE FROM ${table('backup_job')} WHERE id = ?`, [job.id]);
    return { code: 0, msg: '已删除' };
  });

  // ===== 导入 =====
  // 导入会把解压后的 JSON 读入内存；全局串行，避免多个用户同时导入造成内存峰值叠加
  let importRunning = false;
  app.post('/api/backup/import', auth, async (req: any, reply: any) => {
    if (importRunning) return reply.code(409).send({ code: -1, msg: '已有导入任务正在执行，请稍后再试' });
    // /api/backup 整体绕过维护模式 503，但导入会写业务表，恢复期间必须拒绝
    if (isMaintenance()) return reply.code(503).send({ code: -1, msg: '系统维护中，暂不可导入备份' });
    // 限流必须在落盘前执行，否则攻击者可反复上传 200MB 文件占满数据卷
    if (!hitRateLimit(`backup:import:${req.user.uid}`, 3, 10 * 60_000)) {
      return reply.code(429).send({ code: -1, msg: '备份导入过于频繁，请稍后再试' });
    }
    importRunning = true;
    let tmp = '';
    try {
      const up = await saveUpload(req);
      tmp = up.file;
      const fields: any = {};
      for (const [k, v] of Object.entries(up.fields)) fields[k] = (v as any)?.value;
      const admin = isAdmin(req.user);
      const superAdmin = Number(req.user.is_super || 0) === 1;
      const mode = fields.mode === 'replace' ? 'replace' : 'merge';
      if (mode === 'replace' && !admin) return reply.code(403).send({ code: -1, msg: '无权限' });
      // 整站替换会删除除 config 外的全部业务表，并可能写入归档中的 is_super 账号。
      // 必须同时满足：超级管理员 + 二次确认 + 重输登录密码，且走与在线恢复相同的
      // 维护模式/快照/会话失效/旧备份清理流程，否则 level 2 管理员可借此完成站点接管。
      if (mode === 'replace') {
        if (!superAdmin) {
          return reply.code(403).send({ code: -1, msg: '整站替换仅允许超级管理员执行' });
        }
        if (String(fields.confirm || '') !== 'REPLACE') {
          return reply.code(400).send({ code: -1, msg: '请输入 REPLACE 确认整站替换' });
        }
        const pwErr = await requireLoginPassword(Number(req.user.uid), fields.password);
        if (pwErr) return reply.code(400).send({ code: -1, msg: pwErr });
      }
      const key = await keyForArchive(tmp, fields.passphrase ? String(fields.passphrase) : undefined);
      const header = (await readArchiveHeader(tmp)).header;
      const archiveScope = String(header.scope || '').trim();
      // scope 必须显式且只允许 site/user；缺失或任意字符串都不能退化成整站导入。
      if (archiveScope !== 'site' && archiveScope !== 'user') {
        return reply.code(400).send({ code: -1, msg: '备份归档范围不合法' });
      }
      if (mode === 'replace' && archiveScope !== 'site') {
        return reply.code(400).send({ code: -1, msg: 'replace 模式仅支持整站备份' });
      }
      if (archiveScope === 'site' && !admin) {
        return reply.code(403).send({ code: -1, msg: '无权限导入整站备份' });
      }
      if (
        archiveScope === 'user' &&
        !admin &&
        Number(header.ownerUid || 0) !== Number(req.user.uid)
      ) {
        return reply.code(403).send({ code: -1, msg: '只能导入自己的备份' });
      }
      if (getRestoreStatus().running) {
        return reply.code(409).send({ code: -1, msg: '恢复任务正在执行，请稍后再试' });
      }
      const dryRun = fields.dry_run === true || fields.dry_run === 'true';
      const importOpts = {
        key,
        mode,
        dryRun,
        actor: { uid: Number(req.user.uid), username: String(req.user.username || '') },
        actorIsAdmin: admin,
        trusted: admin,
        passphrase: fields.passphrase ? String(fields.passphrase) : undefined,
        // overwrite_config 只对管理员开放；multipart 字段是字符串，必须显式兼容 'true'
        overwriteConfig:
          admin && (fields.overwrite_config === true || fields.overwrite_config === 'true'),
      };
      let report: any;
      if (mode === 'replace' && !dryRun) {
        // 与 /api/backup/restore 完全一致的恢复级保护：分布式锁 + 维护模式 + pre_restore 快照 +
        // token_version 自增 + 清理旧 backup_job，杜绝「导入即接管」与误清库。
        const restored = await restoreFromArchive({
          archivePath: tmp,
          key,
          fileName: path.basename(tmp),
          mode: 'replace',
          actor: importOpts.actor,
        });
        report = restored.report;
      } else {
        // 合并导入同样需要跨副本互斥，避免两个实例同时写同一批表
        const outcome = await withDistributedLockResult('dnsmgr:backup:mutate', () =>
          importArchive(tmp, importOpts as any),
        );
        if (!outcome.locked) return reply.code(409).send({ code: -1, msg: '其他实例正在执行导入，请稍后再试' });
        report = outcome.result;
      }
      const autoExit = !report.dryRun && admin && mode !== 'replace';
      if (autoExit) await setMaintenance(false);
      audit(req, {
        module: 'backup',
        action: 'backup.import',
        summary: `导入备份（${mode}）${autoExit ? '，并退出维护模式' : ''}`,
        detail: { mode, scope: header.scope, maintenanceExit: autoExit },
      });
      return { code: 0, msg: report.dryRun ? '预检完成' : '导入完成', data: report };
    } catch (e: any) {
      return reply.send({ code: -1, msg: publicError(e) });
    } finally {
      importRunning = false;
      if (tmp) {
        releaseTemp(tmp);
        await unlink(tmp).catch(() => undefined);
      }
    }
  });

  // ===== 在线恢复 =====
  const restoreHits: number[] = [];
  app.post('/api/backup/restore', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const b = req.body || {};
    if (String(b.confirm || '') !== 'RESTORE') return { code: -1, msg: '请输入 RESTORE 确认恢复' };
    const restoreMode = b.mode === 'merge' ? 'merge' : 'replace';
    // 整站替换与导入的 replace 同级危险：必须超管 + 重输登录密码，否则 level 2 管理员可借恢复接管站点
    if (restoreMode === 'replace') {
      if (Number(req.user.is_super || 0) !== 1) {
        return reply.code(403).send({ code: -1, msg: '整站替换仅允许超级管理员执行' });
      }
      const pwErr = await requireLoginPassword(Number(req.user.uid), b.password);
      if (pwErr) return reply.code(400).send({ code: -1, msg: pwErr });
    }
    const now = Date.now();
    while (restoreHits.length && now - restoreHits[0] > 5 * 60_000) restoreHits.shift();
    if (restoreHits.length >= 3) return reply.code(429).send({ code: -1, msg: '恢复操作过于频繁，请稍后再试' });
    restoreHits.push(now);

    const destId = Number(b.destId || 0);
    const remoteName = path.basename(String(b.fileName || ''));
    let job: any;
    let localFromRemote = '';
    if (!b.jobId && destId > 0) {
      // 云端在线恢复：先拉取到本地，再走统一的恢复流程
      if (!remoteName || remoteName !== String(b.fileName) || !remoteName.endsWith('.dnsmgrbk')) {
        return { code: -1, msg: '文件名不合法' };
      }
      if (remoteName.startsWith('user-')) return { code: -1, msg: '仅支持恢复整站备份' };
      const dest = await getDestination(destId);
      if (!dest) return { code: -1, msg: '备份目的地不存在' };
      await ensureDataDirs();
      localFromRemote = resolveArchivePath(remoteName);
      // 下载失败只清理本次创建的临时产物；本地同名可用备份必须保留
      let localExisted = false;
      try {
        await stat(localFromRemote);
        localExisted = true;
      } catch {
        // 本地不存在
      }
      try {
        await downloadRemote(destId, remoteName, localFromRemote);
      } catch (e: any) {
        if (!localExisted) await unlink(localFromRemote).catch(() => undefined);
        return { code: -1, msg: `云端备份下载失败：${publicError(e, '下载失败')}` };
      }
      let header: any;
      try {
        header = (await readArchiveHeader(localFromRemote)).header;
      } catch (e: any) {
        await unlink(localFromRemote).catch(() => undefined);
        return { code: -1, msg: `备份文件无法识别：${publicError(e, '文件无法识别')}` };
      }
      if (String(header.scope) !== 'site') {
        await unlink(localFromRemote).catch(() => undefined);
        return { code: -1, msg: '仅支持恢复整站备份' };
      }
      const st = await stat(localFromRemote);
      const existed: any = await queryOne(`SELECT * FROM ${table('backup_job')} WHERE file_name = ? LIMIT 1`, [remoteName]);
      if (existed) {
        await query(
          `UPDATE ${table('backup_job')} SET scope = 'site', status = 'success', file_size = ?, dest = ?, dest_id = ?, error = NULL, finished_at = NOW() WHERE id = ?`,
          [st.size, dest.type, destId, existed.id],
        );
        job = { ...existed, scope: 'site' };
      } else {
        const r: any = await query(
          `INSERT INTO ${table('backup_job')} (kind, scope, status, file_name, file_size, dest, dest_id, include_logs, created_at, finished_at)
           VALUES ('manual', 'site', 'success', ?, ?, ?, ?, 1, NOW(), NOW())`,
          [remoteName, st.size, dest.type, destId],
        );
        job = { id: r.insertId, file_name: remoteName, scope: 'site' };
      }
    } else {
      job = b.jobId
        ? await queryOne(`SELECT * FROM ${table('backup_job')} WHERE id = ?`, [Number(b.jobId)])
        : await queryOne(`SELECT * FROM ${table('backup_job')} WHERE file_name = ? LIMIT 1`, [String(b.fileName || '')]);
    }
    if (!job?.file_name) return { code: -1, msg: '请选择要恢复的备份' };
    if (String(job.scope) !== 'site') return { code: -1, msg: '仅支持恢复整站备份' };

    try {
      const r = await restoreBackup({
        fileName: String(job.file_name),
        mode: restoreMode,
        actor: { uid: Number(req.user.uid), username: String(req.user.username || '') },
      });
      audit(req, { module: 'backup', action: 'backup.restore', summary: `在线恢复：${job.file_name}` });
      return { code: 0, msg: '恢复完成', data: r };
    } catch (e: any) {
      return reply.send({ code: -1, msg: publicError(e) });
    }
  });

  app.get('/api/backup/restore/status', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    return { code: 0, data: { ...getRestoreStatus(), maintenance: isMaintenance() } };
  });

  // 恢复失败后的逃生口：维护标志已持久化，重启不再自动解除
  app.post('/api/backup/maintenance/exit', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    if (String(req.body?.confirm || '') !== 'EXIT') {
      return reply.code(400).send({ code: -1, msg: '请输入 EXIT 确认' });
    }
    if (getRestoreStatus().running) {
      return reply.code(409).send({ code: -1, msg: '恢复任务正在执行，无法退出维护模式' });
    }
    await setMaintenance(false);
    audit(req, { module: 'backup', action: 'backup.maintenance.exit', summary: '管理员手动退出维护模式' });
    return { code: 0, msg: '已退出维护模式' };
  });

  // ===== 备份密钥 =====
  app.get('/api/backup/key/status', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    return { code: 0, data: { configured: await hasBackupKey() } };
  });

  app.post('/api/backup/key', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const passwordErr = await requireLoginPassword(Number(req.user.uid), req.body?.password);
    if (passwordErr) return reply.code(400).send({ code: -1, msg: passwordErr });
    const existed = await hasBackupKey();
    // 轮换影响整站所有历史备份的可恢复性，仅超级管理员可执行；首次生成仍允许任意管理员
    if (existed && Number(req.user.is_super || 0) !== 1) {
      return reply.code(403).send({ code: -1, msg: '轮换备份密钥仅允许超级管理员执行' });
    }
    await rotateBackupKey();
    audit(req, { module: 'backup', action: 'backup.key.rotate', summary: existed ? '轮换备份密钥' : '生成备份密钥' });
    return { code: 0, msg: existed ? '备份密钥已轮换，旧密钥保留用于解密历史备份' : '备份密钥已生成' };
  });

  // ===== 目的地 =====
  app.get('/api/backup/destinations', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const rows = await query<any>(`SELECT * FROM ${table('backup_destination')} ORDER BY id DESC`);
    return {
      code: 0,
      data: rows.map((r) => ({ ...r, config: maskConfig(decryptConfig(r.config) || {}) })),
    };
  });

  app.post('/api/backup/destinations', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const b = req.body || {};
    if (!b.name || (b.type !== 'webdav' && b.type !== 's3')) return { code: -1, msg: '请填写名称并选择类型' };
    const r: any = await query(
      `INSERT INTO ${table('backup_destination')} (name, type, config, enabled, addtime) VALUES (?, ?, ?, ?, NOW())`,
      [String(b.name), b.type, encryptConfig(b.config || {}), b.enabled === false ? 0 : 1],
    );
    return { code: 0, msg: '已保存', data: { id: r.insertId } };
  });

  app.put('/api/backup/destinations/:id', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const row: any = await queryOne(`SELECT * FROM ${table('backup_destination')} WHERE id = ?`, [Number(req.params.id)]);
    if (!row) return { code: -1, msg: '目的地不存在' };
    const b = req.body || {};
    const old = decryptConfig(row.config) || {};
    // 前端回显的是掩码，敏感字段沿用原值
    const merged = mergeMaskedConfig(b.config || {}, old);
    await query(`UPDATE ${table('backup_destination')} SET name = ?, config = ?, enabled = ? WHERE id = ?`, [
      String(b.name ?? row.name),
      encryptConfig(merged),
      b.enabled === false ? 0 : 1,
      row.id,
    ]);
    return { code: 0, msg: '已保存' };
  });

  app.delete('/api/backup/destinations/:id', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    await query(`DELETE FROM ${table('backup_destination')} WHERE id = ?`, [Number(req.params.id)]);
    return { code: 0, msg: '已删除' };
  });

  app.post('/api/backup/destinations/:id/test', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const row = await getDestination(Number(req.params.id));
    if (!row) return { code: -1, msg: '目的地不存在' };
    const r = await testDestination(row);
    await query(`UPDATE ${table('backup_destination')} SET last_test_at = NOW(), last_test_ok = ?, last_test_msg = ? WHERE id = ?`, [
      r.ok ? 1 : 0,
      r.message.slice(0, 300),
      row.id,
    ]);
    return { code: r.ok ? 0 : -1, msg: r.message };
  });

  // ===== 计划任务 =====
  app.get('/api/backup/schedules', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    return { code: 0, data: await query(`SELECT * FROM ${table('backup_schedule')} ORDER BY id DESC`) };
  });

  app.post('/api/backup/schedules', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const b = req.body || {};
    const next = computeNextRun(b);
    const r: any = await query(
      `INSERT INTO ${table('backup_schedule')}
        (name, scope, freq, hour, minute, weekday, include_logs, dest_id, keep_count, keep_days, enabled, next_run, addtime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        String(b.name || '自动备份'),
        'site',
        b.freq === 'weekly' ? 'weekly' : 'daily',
        Number(b.hour ?? 3),
        Number(b.minute ?? 0),
        Number(b.weekday ?? 1),
        b.include_logs ? 1 : 0,
        Number(b.dest_id || 0),
        Math.max(1, Number(b.keep_count || 7)),
        Math.max(1, Number(b.keep_days || 30)),
        b.enabled === false ? 0 : 1,
        next,
      ],
    );
    return { code: 0, msg: '已保存', data: { id: r.insertId, next_run: next } };
  });

  app.put('/api/backup/schedules/:id', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT * FROM ${table('backup_schedule')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '计划不存在' };
    const b = { ...row, ...(req.body || {}) };
    await query(
      `UPDATE ${table('backup_schedule')}
       SET name = ?, freq = ?, hour = ?, minute = ?, weekday = ?, include_logs = ?, dest_id = ?,
           keep_count = ?, keep_days = ?, enabled = ?, next_run = ?
       WHERE id = ?`,
      [
        String(b.name),
        b.freq === 'weekly' ? 'weekly' : 'daily',
        Number(b.hour ?? 3),
        Number(b.minute ?? 0),
        Number(b.weekday ?? 1),
        b.include_logs ? 1 : 0,
        Number(b.dest_id || 0),
        Math.max(1, Number(b.keep_count || 7)),
        Math.max(1, Number(b.keep_days || 30)),
        b.enabled === false ? 0 : 1,
        computeNextRun(b),
        id,
      ],
    );
    return { code: 0, msg: '已保存' };
  });

  app.delete('/api/backup/schedules/:id', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    await query(`DELETE FROM ${table('backup_schedule')} WHERE id = ?`, [Number(req.params.id)]);
    return { code: 0, msg: '已删除' };
  });

  app.post('/api/backup/schedules/:id/run', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    if (isMaintenance()) return reply.code(409).send({ code: -1, msg: '系统维护中，暂不能执行备份' });
    const row: any = await queryOne(`SELECT * FROM ${table('backup_schedule')} WHERE id = ?`, [Number(req.params.id)]);
    if (!row) return { code: -1, msg: '计划不存在' };
    try {
      const r = await exportBackup({
        scope: 'site',
        kind: 'schedule',
        includeLogs: Number(row.include_logs) === 1,
        scheduleId: Number(row.id),
      });
      if (Number(row.dest_id) > 0) {
        await uploadToDestination(Number(row.dest_id), resolveArchivePath(r.file), r.file);
        await query(`UPDATE ${table('backup_job')} SET dest_id = ? WHERE id = ?`, [Number(row.dest_id), r.jobId]);
      }
      await query(`UPDATE ${table('backup_schedule')} SET last_run = NOW(), last_result = ?, next_run = ? WHERE id = ?`, [
        '成功',
        computeNextRun(row),
        row.id,
      ]);
      await applyScheduleRetention(row);
      return { code: 0, msg: '备份完成', data: r };
    } catch (e: any) {
      await query(`UPDATE ${table('backup_schedule')} SET last_run = NOW(), last_result = ? WHERE id = ?`, [
        String(e?.message || e).slice(0, 300),
        row.id,
      ]);
      return { code: -1, msg: publicError(e) };
    }
  });

  // ===== 远端浏览 / 拉回 =====
  app.get('/api/backup/remote/:destId', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    try {
      const items = await listRemote(Number(req.params.destId));
      return { code: 0, data: items.map((it) => ({ ...it, ...archiveMeta(it.name) })) };
    } catch (e: any) {
      return { code: -1, msg: publicError(e) };
    }
  });

  app.post('/api/backup/remote/:destId/pull', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const rawName = String(req.body?.name || '');
    const name = path.basename(rawName);
    // 远端对象只允许纯文件名，避免把 ../ 等路径片段传给 WebDAV/S3 客户端
    if (name !== rawName || !name.endsWith('.dnsmgrbk')) return { code: -1, msg: '文件名不合法' };
    await ensureDataDirs();
    const local = path.join(backupsDir(), path.basename(name));
    let localExisted = false;
    try {
      await stat(local);
      localExisted = true;
    } catch {
      // 本地不存在
    }
    try {
      await downloadRemote(Number(req.params.destId), name, local);
      const st = await stat(local);
      const header = (await readArchiveHeader(local)).header;
      const scope = String(header.scope || '') === 'user' ? 'user' : 'site';
      const r: any = await query(
        `INSERT INTO ${table('backup_job')} (kind, scope, status, file_name, file_size, dest, dest_id, include_logs, created_at, finished_at)
         VALUES ('manual', ?, 'success', ?, ?, 'local', 0, 1, NOW(), NOW())`,
        [scope, path.basename(name), st.size],
      );
      return { code: 0, msg: '已拉回本地', data: { id: r.insertId, file: path.basename(name), size: st.size } };
    } catch (e: any) {
      if (!localExisted) await unlink(local).catch(() => undefined);
      return { code: -1, msg: publicError(e) };
    }
  });
}

/** 每分钟检查计划任务（由 index.ts 调度） */
export async function runDueBackupSchedules(): Promise<void> {
  // 在线恢复期间不要创建新的整站备份，避免与恢复事务/维护模式互相干扰
  if (isMaintenance()) return;
  const rows = await query<any>(
    `SELECT * FROM ${table('backup_schedule')} WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= NOW()`,
  );
  for (const row of rows) {
    await query(`UPDATE ${table('backup_schedule')} SET next_run = ? WHERE id = ?`, [computeNextRun(row), row.id]);
    try {
      const r = await exportBackup({
        scope: 'site',
        kind: 'schedule',
        includeLogs: Number(row.include_logs) === 1,
        scheduleId: Number(row.id),
      });
      if (Number(row.dest_id) > 0) {
        await uploadToDestination(Number(row.dest_id), resolveArchivePath(r.file), r.file);
        await query(`UPDATE ${table('backup_job')} SET dest_id = ? WHERE id = ?`, [Number(row.dest_id), r.jobId]);
      }
      await query(`UPDATE ${table('backup_schedule')} SET last_run = NOW(), last_result = ? WHERE id = ?`, ['成功', row.id]);
      await applyScheduleRetention(row);
    } catch (e: any) {
      await query(`UPDATE ${table('backup_schedule')} SET last_run = NOW(), last_result = ? WHERE id = ?`, [
        String(e?.message || e).slice(0, 300),
        row.id,
      ]);
    }
  }
}
