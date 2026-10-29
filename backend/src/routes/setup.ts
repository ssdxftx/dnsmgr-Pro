import { unlink } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { beginInstall, consumeInstallToken, endInstall, getInstallState, performInstall, testConnection } from '../installer.js';
import { getDbConfig, query, queryOne, table } from '../db.js';
import { dbIdentity, resolveSqliteFile, type DbConfig } from '../config-loader.js';
import { detectDataPersistence } from '../lib/persistence.js';
import { loadConfig } from '../config.js';
import { getSysKey } from '../config.js';
import { setSecretKey } from '../lib/secret.js';
import { importArchive } from '../lib/backup/import.js';
import { setMaintenance } from '../lib/backup/maintenance.js';
import { keyForArchive } from '../lib/backup/key.js';
import { fieldValue, saveUpload, releaseTemp } from '../lib/backup/upload.js';
import { verifySetupToken } from '../lib/setupToken.js';
import { publicError } from '../lib/util.js';

function parseDbConfig(body: any): DbConfig {
  const base = getDbConfig();
  const rawType = String(body?.db_type || base.db_type || '').trim().toLowerCase();
  const dbType = rawType === 'sqlite' ? 'sqlite' : 'mysql';
  const sqliteBase: DbConfig = { ...base, db_type: 'sqlite', db_file: '' };
  const sqlite = dbType === 'sqlite';
  return {
    db_type: dbType,
    db_host: sqlite ? base.db_host : String(body?.db_host || '').trim(),
    db_port: Number(body?.db_port || base.db_port || 3306),
    db_user: sqlite ? base.db_user : String(body?.db_user || '').trim(),
    db_password: String(body?.db_password ?? (sqlite ? base.db_password : '')),
    db_name: sqlite ? base.db_name : String(body?.db_name || '').trim(),
    db_prefix: String(body?.db_prefix || base.db_prefix || 'dnsmgr_').trim(),
    db_file: String(body?.db_file || '').trim() || (sqlite ? resolveSqliteFile(sqliteBase) : base.db_file),
  };
}

function validateDbConfig(cfg: DbConfig): string {
  if (cfg.db_type === 'sqlite') return '';
  if (!cfg.db_host || !cfg.db_user || !cfg.db_name) return '请完整填写数据库主机、用户名和数据库名';
  return '';
}

export default async function setupRoutes(app: FastifyInstance) {
  // 安装状态（前端据此决定展示安装页还是登录页）
  app.get('/api/setup/status', async () => {
    const state = await getInstallState();
    const cfg = getDbConfig();
    const persistence = detectDataPersistence();
    const sqliteCfg: DbConfig = { ...cfg, db_type: 'sqlite', db_file: '' };
    const sqlitePathCfg = cfg.db_type === 'sqlite' && cfg.db_file ? cfg : sqliteCfg;
    const installed = state === 'installed';
    // 仅未安装状态才需要向安装向导展示容器内路径；unknown（数据库不可用）同样是匿名可访问，
    // 绝不能借该状态泄露数据目录与 SQLite 绝对路径。
    const fresh = state === 'not_installed';
    return {
      code: 0,
      data: {
        installed,
        db_type: cfg.db_type,
        data_persistent: persistence.persistent,
        data_dir: fresh ? persistence.dataDir : '',
        sqlite_available: persistence.persistent,
        sqlite_path: fresh ? resolveSqliteFile(sqlitePathCfg) : '',
        sqlite_reason: fresh ? persistence.reason : '',
        default_db_type: fresh ? (persistence.persistent ? 'sqlite' : 'mysql') : cfg.db_type,
      },
    };
  });

  // 测试数据库连接，并返回是否已初始化（已存在彩虹 DNS 数据表）；仅未安装时可用，避免已部署实例被用作连接探测
  app.post('/api/setup/check', async (req: any) => {
    const state = await getInstallState();
    if (state !== 'not_installed') {
      return { code: -1, msg: state === 'unknown' ? '系统状态未知（数据库暂不可用），请稍后重试' : '系统已安装' };
    }
    const b = req.body || {};
    if (!verifySetupToken(b.setup_token ?? req.headers['x-setup-token'])) {
      return { code: -1, msg: '安装令牌不正确，请查看服务端启动日志或配置 DNSMGR_SETUP_TOKEN' };
    }
    const cfg = parseDbConfig(b);
    const cfgErr = validateDbConfig(cfg);
    if (cfgErr) return { code: -1, msg: cfgErr };
    const result = await testConnection(cfg);
    if (!result.ok) return { code: -1, msg: result.message };
    return {
      code: 0,
      data: { initialized: result.initialized, db_type: cfg.db_type },
      msg: result.initialized ? '连接成功，检测到已有数据' : cfg.db_type === 'sqlite' ? 'SQLite 数据库可创建' : '连接成功',
    };
  });

  // 执行安装：全新空库建表+创建管理员；已有表则绑定现有数据
  app.post('/api/setup/install', async (req: any) => {
    const state = await getInstallState();
    if (state !== 'not_installed') {
      return { code: -1, msg: state === 'unknown' ? '系统状态未知（数据库暂不可用），请稍后重试' : '系统已安装' };
    }
    const b = req.body || {};
    if (!verifySetupToken(b.setup_token ?? req.headers['x-setup-token'])) {
      return { code: -1, msg: '安装令牌不正确，请查看服务端启动日志或配置 DNSMGR_SETUP_TOKEN' };
    }
    const cfg = parseDbConfig(b);
    const adminUsername = String(b.admin_username || '').trim();
    const adminPassword = String(b.admin_password || '');

    const cfgErr = validateDbConfig(cfg);
    if (cfgErr) return { code: -1, msg: cfgErr };
    // 并发保护：避免多个安装请求同时初始化
    if (!beginInstall()) return { code: -1, msg: '安装正在进行，请稍候' };
    let result;
    try {
      result = await performInstall(cfg, adminUsername, adminPassword);
    } finally {
      endInstall();
    }
    if (!result.ok) return { code: -1, msg: result.message };

    // 安装完成：保存配置后优雅退出，由容器编排/守护进程重启加载完整业务路由与调度器。
    // 返回一次性令牌，允许在重启前导入已有备份；令牌 10 分钟未使用则自动重启。
    const message = result.bound
      ? '已绑定现有数据库（彩虹 DNS 数据），应用即将重启，请稍候…'
      : '安装完成，应用即将重启，请稍候…';
    if (result.installToken) {
      setTimeout(() => process.exit(0), 10 * 60_000).unref?.();
    } else {
      setTimeout(() => process.exit(0), 500);
    }
    return {
      code: 0,
      msg: message,
      data: { bound: result.bound, install_token: result.installToken || null },
    };
  });

  // 跳过后立即重启，避免等待令牌过期
  app.post('/api/setup/skip', async (req: any) => {
    const cfg = getDbConfig();
    const token = String(req.body?.install_token || '');
    if (!consumeInstallToken(token, dbIdentity(cfg))) {
      return { code: -1, msg: '安装令牌已失效' };
    }
    setTimeout(() => process.exit(0), 300);
    return { code: 0, msg: '即将重启' };
  });

  // 安装向导导入已有备份（仅安装后 10 分钟内、持有一次性令牌时可用）
  app.post('/api/setup/import', async (req: any, reply: any) => {
    const cfg = getDbConfig();
    let tmp = '';
    try {
      // 令牌必须在落盘前校验：saveUpload 会把最多 200MB 的请求体写入数据卷，
      // 若先落盘再验令牌，未认证请求可用 15 次/分钟的配额持续写入临时文件耗尽磁盘。
      // 令牌只从请求头读取（multipart 字段必须等文件流消费完才可读）。
      const token = String(req.headers['x-install-token'] || req.headers['install-token'] || '');
      if (!token) return { code: -1, msg: '缺少安装令牌' };
      if (!consumeInstallToken(token, dbIdentity(cfg))) {
        return { code: -1, msg: '导入令牌无效或已过期，请跳过此步' };
      }
      const up = await saveUpload(req);
      tmp = up.file;
      // 安装后 sys_key 才写入数据库，必须刷新缓存并重置进程内密钥，否则导入时写入的密文重启后无法解密
      await loadConfig(true);
      setSecretKey(await getSysKey());
      const pass = fieldValue(up.fields, 'passphrase');
      const rawKey = fieldValue(up.fields, 'backup_key');
      let key: Buffer;
      if (rawKey) {
        key = Buffer.from(String(rawKey), 'base64url');
        if (key.length !== 32) return { code: -1, msg: '备份密钥格式不正确（需为 32 字节 Base64URL）' };
      } else {
        key = await keyForArchive(tmp, pass ? String(pass) : undefined);
      }
      const report = await importArchive(tmp, { key, mode: 'install', trusted: true });
      // 旧归档可能带 maintenance=1，安装完成后必须归零
      await setMaintenance(false);

      // 导入过程已在事务内处理临时管理员：归档含管理员时会删除临时超管。
      // 这里只负责补齐超管标记，不能按导入前捕获的 id 删除用户，否则会误删刚恢复的原管理员。
      // 保证恰好一个超级管理员（归档用户的 is_super 可能为 0）
      const superRow: any = await queryOne(`SELECT id FROM ${table('user')} WHERE is_super = 1 LIMIT 1`);
      if (!superRow) {
        const admin: any = await queryOne(`SELECT id FROM ${table('user')} WHERE level >= 2 ORDER BY id LIMIT 1`);
        if (admin?.id) await query(`UPDATE ${table('user')} SET is_super = 1 WHERE id = ?`, [admin.id]);
      }

      setTimeout(() => process.exit(0), 800);
      return { code: 0, msg: '导入完成，应用即将重启', data: report };
    } catch (e: any) {
      return reply.send({ code: -1, msg: publicError(e) });
    } finally {
      if (tmp) {
        releaseTemp(tmp);
        await unlink(tmp).catch(() => undefined);
      }
    }
  });
}