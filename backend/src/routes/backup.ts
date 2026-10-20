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
import { hasBackupKey, rotateBackupKey, keyForArchive } from '../lib/backup/key.js';
import { getRestoreStatus } from '../lib/backup/maintenance.js';
import { restoreBackup } from '../lib/backup/restore.js';
import {
  deleteRemote,
  downloadRemote,
  getDestination,
  listRemote,
  testDestination,
  uploadToDestination,
} from '../lib/backup/destinations.js';
import { saveUpload } from '../lib/backup/upload.js';

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

async function applyRetention(schedule: any): Promise<void> {
  const keepCount = Math.max(1, Number(schedule.keep_count || 7));
  const keepDays = Math.max(1, Number(schedule.keep_days || 30));
  const rows = await query<any>(
    `SELECT * FROM ${table('backup_job')}
     WHERE kind = 'schedule' AND scope = ? AND status = 'success' AND file_name IS NOT NULL
     ORDER BY id DESC`,
    [String(schedule.scope || 'site')],
  );
  const cutoff = Date.now() - keepDays * 86400_000;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const at = new Date(String(r.created_at).replace(' ', 'T')).getTime();
    const expired = i >= keepCount || at < cutoff;
    if (!expired) continue;
    if (r.dest_id) await deleteRemote(Number(r.dest_id), String(r.file_name));
    await unlink(resolveArchivePath(String(r.file_name))).catch(() => undefined);
    await query(`DELETE FROM ${table('backup_job')} WHERE id = ?`, [r.id]);
  }
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
    try {
      const r = await exportBackup({
        scope,
        ownerUid: scope === 'user' ? Number(req.user.uid) : 0,
        includeLogs: b.include_logs !== false,
        passphrase: b.passphrase ? String(b.passphrase) : undefined,
        kind: 'manual',
      });
      const destId = Number(b.dest_id || 0);
      if (destId > 0) {
        await uploadToDestination(destId, resolveArchivePath(r.file), r.file);
        const dest = await getDestination(destId);
        await query(`UPDATE ${table('backup_job')} SET dest = ?, dest_id = ? WHERE id = ?`, [
          dest?.type || 'local',
          destId,
          r.jobId,
        ]);
      }
      audit(req, { module: 'backup', action: 'backup.export', targetType: 'backup', targetId: r.jobId, summary: `导出${scope === 'site' ? '整站' : '个人'}备份` });
      return { code: 0, msg: '备份完成', data: r };
    } catch (e: any) {
      return reply.send({ code: -1, msg: String(e?.message || e) });
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
    reply.header('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
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
  app.post('/api/backup/import', auth, async (req: any, reply: any) => {
    let tmp = '';
    try {
      const up = await saveUpload(req);
      tmp = up.file;
      const fields: any = {};
      for (const [k, v] of Object.entries(up.fields)) fields[k] = (v as any)?.value;
      const mode = fields.mode === 'replace' ? 'replace' : 'merge';
      if (mode === 'replace' && !isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
      const key = await keyForArchive(tmp, fields.passphrase ? String(fields.passphrase) : undefined);
      const header = (await readArchiveHeader(tmp)).header;
      if (String(header.scope) === 'site' && !isAdmin(req.user)) {
        return reply.code(403).send({ code: -1, msg: '无权限导入整站备份' });
      }
      const report = await importArchive(tmp, {
        key,
        mode,
        dryRun: fields.dry_run === true || fields.dry_run === 'true',
        actor: { uid: Number(req.user.uid), username: String(req.user.username || '') },
        overwriteConfig: fields.overwrite_config === true,
      });
      audit(req, { module: 'backup', action: 'backup.import', summary: `导入备份（${mode}）`, detail: { mode, scope: header.scope } });
      return { code: 0, msg: report.dryRun ? '预检完成' : '导入完成', data: report };
    } catch (e: any) {
      return reply.send({ code: -1, msg: String(e?.message || e) });
    } finally {
      if (tmp) await unlink(tmp).catch(() => undefined);
    }
  });

  // ===== 在线恢复 =====
  const restoreHits: number[] = [];
  app.post('/api/backup/restore', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const b = req.body || {};
    if (String(b.confirm || '') !== 'RESTORE') return { code: -1, msg: '请输入 RESTORE 确认恢复' };
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
      try {
        await downloadRemote(destId, remoteName, localFromRemote);
      } catch (e: any) {
        await unlink(localFromRemote).catch(() => undefined);
        return { code: -1, msg: `云端备份下载失败：${String(e?.message || e)}` };
      }
      let header: any;
      try {
        header = (await readArchiveHeader(localFromRemote)).header;
      } catch (e: any) {
        await unlink(localFromRemote).catch(() => undefined);
        return { code: -1, msg: `备份文件无法识别：${String(e?.message || e)}` };
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
        mode: b.mode === 'merge' ? 'merge' : 'replace',
        actor: { uid: Number(req.user.uid), username: String(req.user.username || '') },
      });
      audit(req, { module: 'backup', action: 'backup.restore', summary: `在线恢复：${job.file_name}` });
      return { code: 0, msg: '恢复完成', data: r };
    } catch (e: any) {
      return reply.send({ code: -1, msg: String(e?.message || e) });
    }
  });

  app.get('/api/backup/restore/status', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    return { code: 0, data: getRestoreStatus() };
  });

  // ===== 备份密钥 =====
  app.get('/api/backup/key/status', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    return { code: 0, data: { configured: await hasBackupKey() } };
  });

  app.post('/api/backup/key', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const existed = await hasBackupKey();
    await rotateBackupKey();
    audit(req, { module: 'backup', action: 'backup.key.rotate', summary: existed ? '轮换备份密钥' : '生成备份密钥' });
    return { code: 0, msg: existed ? '备份密钥已轮换，旧备份需要旧密钥才能恢复' : '备份密钥已生成' };
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
    const row: any = await queryOne(`SELECT * FROM ${table('backup_schedule')} WHERE id = ?`, [Number(req.params.id)]);
    if (!row) return { code: -1, msg: '计划不存在' };
    try {
      const r = await exportBackup({
        scope: 'site',
        kind: 'schedule',
        includeLogs: Number(row.include_logs) === 1,
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
      await applyRetention(row);
      return { code: 0, msg: '备份完成', data: r };
    } catch (e: any) {
      await query(`UPDATE ${table('backup_schedule')} SET last_run = NOW(), last_result = ? WHERE id = ?`, [
        String(e?.message || e).slice(0, 300),
        row.id,
      ]);
      return { code: -1, msg: String(e?.message || e) };
    }
  });

  // ===== 远端浏览 / 拉回 =====
  app.get('/api/backup/remote/:destId', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    try {
      const items = await listRemote(Number(req.params.destId));
      return { code: 0, data: items.map((it) => ({ ...it, ...archiveMeta(it.name) })) };
    } catch (e: any) {
      return { code: -1, msg: String(e?.message || e) };
    }
  });

  app.post('/api/backup/remote/:destId/pull', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ code: -1, msg: '无权限' });
    const name = String(req.body?.name || '');
    if (!name.endsWith('.dnsmgrbk')) return { code: -1, msg: '文件名不合法' };
    await ensureDataDirs();
    const local = path.join(backupsDir(), path.basename(name));
    try {
      await downloadRemote(Number(req.params.destId), name, local);
      const st = await stat(local);
      const r: any = await query(
        `INSERT INTO ${table('backup_job')} (kind, scope, status, file_name, file_size, dest, dest_id, include_logs, created_at, finished_at)
         VALUES ('manual', 'site', 'success', ?, ?, 'local', 0, 1, NOW(), NOW())`,
        [path.basename(name), st.size],
      );
      return { code: 0, msg: '已拉回本地', data: { id: r.insertId, file: path.basename(name), size: st.size } };
    } catch (e: any) {
      return { code: -1, msg: String(e?.message || e) };
    }
  });
}

/** 每分钟检查计划任务（由 index.ts 调度） */
export async function runDueBackupSchedules(): Promise<void> {
  const rows = await query<any>(
    `SELECT * FROM ${table('backup_schedule')} WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= NOW()`,
  );
  for (const row of rows) {
    await query(`UPDATE ${table('backup_schedule')} SET next_run = ? WHERE id = ?`, [computeNextRun(row), row.id]);
    try {
      const r = await exportBackup({ scope: 'site', kind: 'schedule', includeLogs: Number(row.include_logs) === 1 });
      if (Number(row.dest_id) > 0) {
        await uploadToDestination(Number(row.dest_id), resolveArchivePath(r.file), r.file);
        await query(`UPDATE ${table('backup_job')} SET dest_id = ? WHERE id = ?`, [Number(row.dest_id), r.jobId]);
      }
      await query(`UPDATE ${table('backup_schedule')} SET last_run = NOW(), last_result = ? WHERE id = ?`, ['成功', row.id]);
      await applyRetention(row);
    } catch (e: any) {
      await query(`UPDATE ${table('backup_schedule')} SET last_run = NOW(), last_result = ? WHERE id = ?`, [
        String(e?.message || e).slice(0, 300),
        row.id,
      ]);
    }
  }
}
