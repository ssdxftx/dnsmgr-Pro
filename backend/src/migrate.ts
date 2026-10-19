import { query, table } from './db.js';
import { setCdnDomainIdColumnAvailable } from './lib/cert/cdnDomainIdColumn.js';

// 启动时幂等迁移：为多用户注册系统补齐表结构与字段，已存在则跳过。
export async function migrate(): Promise<void> {
  await ensureColumn('user', 'email', 'varchar(128) DEFAULT NULL');
  await ensureColumn('user', 'lang', "varchar(10) NOT NULL DEFAULT ''");
  await ensureColumn('user', 'check_whole', "tinyint(1) NOT NULL DEFAULT '0'");
  await ensureColumn('user', 'stat_cache', "tinyint(1) NOT NULL DEFAULT '0'");
  await ensureColumn('user', 'is_super', "tinyint(1) NOT NULL DEFAULT '0'");
  await ensureColumn('user', 'token_version', "int(11) NOT NULL DEFAULT '0'");
  await ensureColumn('permission', 'readonly', "tinyint(1) NOT NULL DEFAULT '0'");
  await ensureColumn('permission', 'expiretime', 'datetime DEFAULT NULL');
  // 用户名唯一约束：防止并发注册/建号绕过「先查后插」判重产生重复账号
  await ensureUniqueIndex('user', 'username', 'uniq_username');

  await query(
    `CREATE TABLE IF NOT EXISTS ${table('reg_code')} (
      id int(11) unsigned NOT NULL AUTO_INCREMENT,
      code varchar(32) NOT NULL,
      expiretime datetime DEFAULT NULL,
      max_use int(11) NOT NULL DEFAULT '0',
      used int(11) NOT NULL DEFAULT '0',
      status tinyint(1) NOT NULL DEFAULT '1',
      remark varchar(100) DEFAULT NULL,
      addtime datetime NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${table('reg_verify')} (
      id int(11) unsigned NOT NULL AUTO_INCREMENT,
      email varchar(128) NOT NULL,
      code varchar(8) NOT NULL,
      type varchar(20) NOT NULL DEFAULT 'register',
      used tinyint(1) NOT NULL DEFAULT '0',
      expiretime datetime NOT NULL,
      addtime datetime NOT NULL,
      PRIMARY KEY (id),
      KEY email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  // 验证码校验失败次数：超过上限即作废，防止在线爆破
  await ensureColumn('reg_verify', 'attempts', "int(11) NOT NULL DEFAULT '0'");

  await query(
    `CREATE TABLE IF NOT EXISTS ${table('cdn_cache_task')} (
      id int(11) unsigned NOT NULL AUTO_INCREMENT,
      url varchar(500) NOT NULL,
      type varchar(20) NOT NULL,
      provider varchar(20) NOT NULL,
      task_id varchar(255) DEFAULT NULL,
      status tinyint(1) NOT NULL DEFAULT '0',
      msg varchar(255) DEFAULT NULL,
      addtime datetime NOT NULL,
      PRIMARY KEY (id),
      KEY addtime (addtime)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${table('cdn_preheat_task')} (
      id int(11) unsigned NOT NULL AUTO_INCREMENT,
      name varchar(100) DEFAULT NULL,
      urls text NOT NULL,
      op varchar(20) NOT NULL DEFAULT 'preheat',
      cycle varchar(20) NOT NULL DEFAULT 'daily',
      interval_min int(11) NOT NULL DEFAULT '0',
      run_time varchar(5) DEFAULT NULL,
      active tinyint(1) NOT NULL DEFAULT '1',
      last_run datetime DEFAULT NULL,
      next_run datetime DEFAULT NULL,
      addtime datetime NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await ensureColumn('cdn_preheat_task', 'op', "varchar(20) NOT NULL DEFAULT 'preheat'");

  await query(
    `CREATE TABLE IF NOT EXISTS ${table('dns_check_task')} (
      id int(11) unsigned NOT NULL AUTO_INCREMENT,
      name varchar(100) DEFAULT NULL,
      did int(11) unsigned NOT NULL,
      uid int(11) unsigned NOT NULL DEFAULT '0',
      sub varchar(255) DEFAULT NULL,
      types varchar(255) DEFAULT NULL,
      cycle varchar(20) NOT NULL DEFAULT 'daily',
      interval_min int(11) NOT NULL DEFAULT '0',
      run_time varchar(5) DEFAULT NULL,
      notice_email varchar(255) DEFAULT NULL,
      active tinyint(1) NOT NULL DEFAULT '1',
      last_run datetime DEFAULT NULL,
      last_status tinyint(1) NOT NULL DEFAULT '0',
      issue_count int(11) NOT NULL DEFAULT '0',
      next_run datetime DEFAULT NULL,
      addtime datetime NOT NULL,
      PRIMARY KEY (id),
      KEY did (did),
      KEY uid (uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await ensureColumn('dns_check_task', 'uid', "int(11) unsigned NOT NULL DEFAULT '0'");
  await ensureColumn('dns_check_task', 'sub', 'varchar(255) DEFAULT NULL');
  // 检测结果落库：last_status 0 正常 / 1 异常，issue_count 异常记录数（供运维台展示真实异常数）
  await ensureColumn('dns_check_task', 'last_status', "tinyint(1) NOT NULL DEFAULT '0'");
  await ensureColumn('dns_check_task', 'issue_count', "int(11) NOT NULL DEFAULT '0'");

  // 证书联动：签发成功后按 link 记录自动创建 CDN 部署任务
  await ensureColumn('cert_order', 'link', 'text DEFAULT NULL');

  // CDN 加速域名的证书管理方式：freecert（平台免费证书）/ certlink（由本项目管理）/ certapply（项目申请证书）
  await ensureColumn('cdn_domain', 'cert_mode', 'varchar(20) DEFAULT NULL');

  // 证书联动执行阶段日志：让前端实时看到「订单 -> 签发 -> 部署账户 -> 部署任务 -> 部署」进度
  await query(
    `CREATE TABLE IF NOT EXISTS ${table('cert_link_log')} (
      id int(11) unsigned NOT NULL AUTO_INCREMENT,
      did int(11) unsigned NOT NULL,
      oid int(11) unsigned NOT NULL DEFAULT '0',
      node varchar(32) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'doing',
      message varchar(500) DEFAULT NULL,
      addtime datetime NOT NULL,
      PRIMARY KEY (id),
      KEY did (did)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${table('cdn_stat_data')} (
      id int(11) unsigned NOT NULL AUTO_INCREMENT,
      route varchar(20) NOT NULL,
      aid int(11) unsigned NOT NULL,
      granularity varchar(6) NOT NULL,
      ts datetime NOT NULL,
      data text NOT NULL,
      addtime datetime DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY bucket (route, aid, granularity, ts)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  // Cloudflare 规则引擎专用凭证：按 Cloudflare 账户（aid）绑定，DNS 密钥权限不足时使用
  await query(
    `CREATE TABLE IF NOT EXISTS ${table('cf_rule_credential')} (
      id int(11) unsigned NOT NULL AUTO_INCREMENT,
      aid int(11) unsigned NOT NULL,
      config text NOT NULL,
      addtime datetime NOT NULL,
      updatetime datetime DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY aid (aid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  // 唯一超级管理员：全新安装由安装向导标记；旧库无标记时回填
  // （优先 id=1000 的原创始人，否则取最小 id 的管理员），保证恰好一人为超级管理员
  const existingSuper = await query<{ id: number }>(`SELECT id FROM ${table('user')} WHERE is_super = 1 LIMIT 1`);
  if (existingSuper.length === 0) {
    await query(`UPDATE ${table('user')} SET is_super = 1 WHERE id = 1000 AND level >= 2`);
    const after = await query<{ id: number }>(`SELECT id FROM ${table('user')} WHERE is_super = 1 LIMIT 1`);
    if (after.length === 0) {
      await query(`UPDATE ${table('user')} SET is_super = 1 WHERE level >= 2 ORDER BY id ASC LIMIT 1`);
    }
  }

  // 调度热路径索引：为按 active / 时间 / 状态过滤的定时任务补二级索引，避免随数据量增长的全表扫描
  await ensureIndex('dmtask', 'idx_check', '(`active`, `checknexttime`)');
  await ensureIndex('sctask', 'idx_check', '(`active`, `nexttime`)');
  await ensureIndex('optimizeip', 'idx_active', '(`active`)');
  await ensureIndex('dns_check_task', 'idx_check', '(`active`, `next_run`)');
  await ensureIndex('cdn_preheat_task', 'idx_check', '(`active`, `next_run`)');
  await ensureIndex('domain', 'idx_checkstatus', '(`checkstatus`)');
  await ensureIndex('domain', 'idx_expiretime', '(`expiretime`)');
  await ensureIndex('cert_order', 'idx_renew', '(`status`, `isauto`, `expiretime`)');

  // 证书联动查询索引：cdn_domain_id 为 link 中 cdnDomainId 的生成列 + 索引，
  // 替代 link LIKE '%cdnDomainId%' 的前缀通配全表扫描（CDN 列表 / 证书联动轮询热点）
  await ensureCertOrderCdnDomainId();

  // CDN 统计查询/清理索引：查询条件不含唯一索引最左列 route，补 (granularity, ts) 与 (ts)
  await ensureIndex('cdn_stat_data', 'idx_gran_ts', '(`granularity`, `ts`)');
  await ensureIndex('cdn_stat_data', 'idx_ts', '(`ts`)');

  // 操作日志（审计旁路）：独立于旧 log 表，用户/域名删除后仍需留存，故不建外键
  await query(
    `CREATE TABLE IF NOT EXISTS ${table('audit_log')} (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      uid int(11) unsigned NOT NULL DEFAULT '0',
      username varchar(64) NOT NULL DEFAULT '',
      module varchar(32) NOT NULL,
      action varchar(48) NOT NULL,
      method varchar(8) NOT NULL,
      path varchar(255) NOT NULL,
      route varchar(255) NOT NULL DEFAULT '',
      target_type varchar(32) NOT NULL DEFAULT '',
      target_id varchar(64) NOT NULL DEFAULT '',
      target_name varchar(255) NOT NULL DEFAULT '',
      summary varchar(500) NOT NULL DEFAULT '',
      detail json DEFAULT NULL,
      changes json DEFAULT NULL,
      result tinyint(1) NOT NULL DEFAULT '1',
      errmsg varchar(500) NOT NULL DEFAULT '',
      status smallint NOT NULL DEFAULT '200',
      ip varchar(64) NOT NULL DEFAULT '',
      ua varchar(255) NOT NULL DEFAULT '',
      cost_ms int NOT NULL DEFAULT '0',
      addtime datetime NOT NULL,
      PRIMARY KEY (id),
      KEY idx_time (addtime),
      KEY idx_uid_time (uid, addtime),
      KEY idx_module_time (module, addtime),
      KEY idx_result_time (result, addtime),
      KEY idx_target (target_type, target_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  // 高频点查/关联索引：消除按 aid / 域名 / (did,domain) 关联时的全表扫描
  await ensureIndex('cdn_domain', 'idx_aid', '(`aid`)');
  await ensureIndex('cdn_domain', 'idx_aid_zone', '(`aid`, `zone_id`)');
  await ensureIndex('domain', 'idx_aid', '(`aid`)');
  await ensureIndex('cert_deploy', 'idx_aid_oid', '(`aid`, `oid`)');
  // 以下为实际查询条件补索引：cert_deploy 按 oid 查询、cert_cname 按 domain 查询、cdn_stat_data 按 aid 清理
  await ensureIndex('cert_deploy', 'idx_oid', '(`oid`)');
  await ensureIndex('cert_cname', 'idx_domain_only', '(`domain`)');
  await ensureIndex('cdn_stat_data', 'idx_aid', '(`aid`)');
  await ensureIndex('cert_order', 'idx_aid', '(`aid`)');
  await ensureIndex('cert_domain', 'idx_domain', '(`domain`)');
  await ensureIndex('cert_cname', 'idx_did_domain', '(`did`, `domain`)');
}

// cert_order.link 的 cdnDomainId 生成列 + 索引：MySQL 5.7+ 生成列；
// 失败（旧版本或 link 存在非法 JSON）时记录并继续，不影响启动
async function ensureCertOrderCdnDomainId(): Promise<void> {
  const cols = await query<any>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'cdn_domain_id' LIMIT 1`,
    [table('cert_order')]
  );
  if (cols.length === 0) {
    // 生成列基于 JSON_EXTRACT：历史 link 若含非法 JSON，整个 ALTER 会失败。
    // 先清洗非法 JSON（这些行本就无法被应用解析使用），再尝试建列。
    try {
      await query(
        `UPDATE ${table('cert_order')} SET link = NULL WHERE link IS NOT NULL AND JSON_VALID(link) = 0`
      );
    } catch (e: any) {
      console.log(`[migrate] 清洗 cert_order.link 非法 JSON 失败（跳过）：${e?.message || e}`);
    }
    try {
      await query(
        `ALTER TABLE ${table('cert_order')} ADD COLUMN cdn_domain_id INT UNSIGNED GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(link, '$.cdnDomainId')) AS UNSIGNED)) VIRTUAL`
      );
    } catch (e: any) {
      // 建列失败时标记该列不可用，查询方回退到 link LIKE + 解析，保证功能可用而非整块 500
      setCdnDomainIdColumnAvailable(false);
      console.log(`[migrate] 为 cert_order 添加 cdn_domain_id 生成列失败，已降级为 link LIKE 查询：${e?.message || e}`);
      return;
    }
  }
  setCdnDomainIdColumnAvailable(true);
  await ensureIndex('cert_order', 'idx_cdn_domain_id', '(`cdn_domain_id`)');
}

async function ensureIndex(tableName: string, indexName: string, columns: string): Promise<void> {
  try {
    const rows = await query<any>(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [table(tableName), indexName]
    );
    if (rows.length === 0) {
      await query(`ALTER TABLE ${table(tableName)} ADD INDEX ${indexName} ${columns}`);
    }
  } catch (e: any) {
    // 单个索引创建失败（表不存在、列缺失、权限不足等）不应中断后续索引的创建
    console.log(`[migrate] 为 ${tableName} 创建索引 ${indexName} 失败（跳过）：${e?.message || e}`);
  }
}

// 为单列补唯一索引：已存在唯一索引则跳过；存在重复数据导致失败时记录并继续，避免启动中断
async function ensureUniqueIndex(tableName: string, column: string, indexName: string): Promise<void> {
  const rows = await query<any>(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND NON_UNIQUE = 0 LIMIT 1`,
    [table(tableName), column]
  );
  if (rows.length > 0) return;
  try {
    await query(`ALTER TABLE ${table(tableName)} ADD UNIQUE INDEX ${indexName} (${column})`);
  } catch (e: any) {
    console.log(`[migrate] 为 ${tableName}.${column} 添加唯一索引失败（可能存在重复数据）：${e?.message || e}`);
  }
}

async function ensureColumn(tableName: string, column: string, definition: string): Promise<void> {
  const rows = await query<any>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table(tableName), column]
  );
  if (rows.length === 0) {
    await query(`ALTER TABLE ${table(tableName)} ADD COLUMN ${column} ${definition}`);
  }
}