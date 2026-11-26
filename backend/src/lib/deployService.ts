import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { query, queryOne, table } from '../db.js';
import { getDeployProvider } from './deploy/factory.js';
import type { DeployProvider } from './deploy/types.js';
import { genSid } from './certService.js';
import { appendLog, logDir, safeProcessId } from './util.js';

const LOG_DIR = logDir();

import { ConfigDecryptError, decryptConfig, encryptConfig, decryptText } from './secret.js';
import { assertDeployConfigAllowed } from './netGuard.js';
import { loadAccountConfig } from './accounts/taskConfig.js';

function safeJson(s: string | null): any {
  if (!s) return null;
  return decryptConfig(s);
}

export class CertDeployService {
  private client!: DeployProvider;
  private task: any;
  private info: any;

  constructor(private tid: number) {}

  private async load() {
    const task = await queryOne(`SELECT * FROM ${table('cert_deploy')} WHERE id = ?`, [this.tid]);
    if (!task) throw new Error('该自动部署任务不存在');
    this.task = task;

    const account = await queryOne(`SELECT * FROM ${table('cert_account')} WHERE id = ?`, [task.aid]);
    if (!account) throw new Error('该自动部署账户不存在');
    const cfg = await loadAccountConfig(account);
    // 拒绝指向链路本地/云元数据地址的部署目标，避免凭据被诱导窃取
    await assertDeployConfigAllowed(cfg);
    const client = getDeployProvider(account.type, cfg);
    if (!client) throw new Error('该自动部署任务类型不存在');
    this.client = client;
    this.info = safeJson(task.info) || {};
  }

  private saveLog(txt: string) {
    const processid = safeProcessId(this.task.processid);
    if (!processid) return;
    appendLog(join(LOG_DIR, processid + '.log'), txt + '\n');
  }

  private async saveResult(status: number, error: string | null = null, retryAfterSeconds: number | null = null) {
    this.task.status = status;
    let err = error;
    if (err && err.length > 300) err = err.slice(0, 300);
    // 单点保证：失败态必须带 retrytime，否则 findDeployTasks 不会再调度该任务，也永远没有终态
    let retrySeconds = retryAfterSeconds;
    if (status < 0 && retrySeconds === null) {
      retrySeconds = [60, 300, 600, 1800, 3600][this.task.retry] ?? 3600;
    }
    // retrytime 一律用数据库时钟计算，避免应用进程与数据库时区不同导致的重试时间漂移
    const sets = ['status = ?', 'error = ?'];
    const params: any[] = [status, err ? err.replace(/[\r\n]/g, '') : null];
    if (retrySeconds === null) {
      sets.push('retrytime = NULL');
    } else {
      sets.push('retrytime = DATE_ADD(NOW(), INTERVAL ? SECOND)');
      params.push(retrySeconds);
    }
    if (status === 1) {
      sets.push('retry = 0', 'lasttime = NOW()');
    }
    if (status < 0 || retrySeconds !== null) {
      this.task.retry = (this.task.retry || 0) + 1;
      sets.push('retry = ?');
      params.push(this.task.retry);
    }
    const token = safeProcessId(this.task?.processid);
    if (token) {
      const res: any = await query(
        `UPDATE ${table('cert_deploy')} SET ${sets.join(', ')} WHERE id = ? AND processid = ?`,
        [...params, this.tid, token],
      );
      if (!res || !res.affectedRows) {
        if (err) this.saveLog('[Error] ' + err);
        throw new Error('部署任务锁已失效，结果未写入');
      }
    } else {
      await query(`UPDATE ${table('cert_deploy')} SET ${sets.join(', ')} WHERE id = ?`, [...params, this.tid]);
    }
    if (err) this.saveLog('[Error] ' + err);
  }

  private async takeTaskLock(): Promise<string> {
    // 每次加锁生成新租约令牌，超时抢占后旧 worker 无法匹配并释放新锁。
    const token = genSid();
    const res: any = await query(
      `UPDATE ${table('cert_deploy')} SET islock = 1, locktime = NOW(), processid = ? WHERE id = ? AND (islock = 0 OR islock IS NULL OR locktime IS NULL OR locktime < DATE_SUB(NOW(), INTERVAL 1 HOUR))`,
      [token, this.tid],
    );
    if (!res || !res.affectedRows) throw new Error('该部署任务正在处理中，请稍后再试');
    if (this.task) this.task.processid = token;
    return token;
  }

  private async releaseTaskLock(token: string): Promise<void> {
    await query(
      `UPDATE ${table('cert_deploy')} SET islock = 0, processid = NULL, last_processid = ? WHERE id = ? AND processid = ? AND islock = 1`,
      [token, this.tid, token],
    );
  }

  async process(isManual = false): Promise<void> {
    // 先加租约锁，再重新加载任务：加载后使用的 aid/oid/config 必须与当前锁对应的最新行一致，
    // 否则编辑接口在加载与加锁之间保存的新目标会被旧配置覆盖。
    const token = await this.takeTaskLock();
    try {
      try {
        await this.load();
      } catch (e: any) {
        // 账户被删除/密钥轮换等加载失败也必须落负状态并带 retrytime。
        if (this.task) await this.saveResult(-1, e?.message || '部署任务初始化失败').catch(() => undefined);
        throw e;
      }
      if (this.task.status >= 1) return;
      if (this.task.retry >= 6 && !isManual) {
        const msg = '已超出最大重试次数(' + (this.task.error || '未知错误') + ')';
        await this.saveResult(-1, msg);
        throw new Error(msg);
      }

      const fail = async (msg: string): Promise<never> => {
        await this.saveResult(-1, msg);
        throw new Error(msg);
      };

      const order = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [this.task.oid]);
      if (!order) return fail('SSL证书订单不存在');
      if (order.status === 4) return fail('SSL证书订单已吊销');
      if (order.status !== 3) return fail('SSL证书订单未完成签发');
      if (!order.fullchain || !order.privatekey) return fail('SSL证书或私钥内容不存在');
      const expRaw = order.expiretime;
      const exp = expRaw instanceof Date ? expRaw.getTime() : new Date(String(expRaw || '').replace(' ', 'T')).getTime();
      if (!Number.isFinite(exp) || exp <= Date.now()) return fail('SSL证书已过期，请先续签后再部署');
      // 私钥为加密存储，部署前解密（兼容历史明文）；密文解密失败时禁止把密文当私钥部署
      const decryptedKey = decryptText(order.privatekey);
      if (decryptedKey === null && String(order.privatekey).startsWith('enc:')) {
        return fail('证书私钥无法解密（系统密钥可能已变更），请重新签发或导入证书');
      }
      const privateKey = decryptedKey ?? order.privatekey;

      // 加锁后重新确认状态，避免等待锁期间其他执行者已经完成部署。
      const current: any = await queryOne(
        `SELECT status FROM ${table('cert_deploy')} WHERE id = ? AND processid = ?`,
        [this.tid, token],
      );
      if (!current) throw new Error('部署任务锁已失效，请稍后重试');
      if (Number(current.status) >= 1) return;
      await this.deploy(order.fullchain, privateKey);
    } finally {
      await this.releaseTaskLock(token).catch(() => undefined);
    }
  }

  private async deploy(fullchain: string, privatekey: string): Promise<void> {
    this.client.setLogger((txt) => this.saveLog(txt));
    this.saveLog(new Date().toISOString());
    const config = safeJson(this.task.config) || {};
    // 纵深防御：任务级 config 也可能携带 URL（如面板地址），执行前再校验一次
    await assertDeployConfigAllowed(config);
    const domains = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [this.task.oid]);
    config.domainList = domains.map((d: any) => d.domain);
    try {
      await this.client.deploy(fullchain, privatekey, config, this.info);
      await this.saveResult(1);
      this.saveLog('[Success] 证书部署成功');
    } catch (e: any) {
      const iv = [60, 300, 600, 1800, 3600][this.task.retry] ?? 3600;
      await this.saveResult(-1, e.message, iv);
      throw e;
    } finally {
      if (this.info && typeof this.info === 'object') {
        if (this.info.config && typeof this.info.config === 'object') {
          const merged = { ...(safeJson(this.task.config) || {}), ...this.info.config };
          await query(`UPDATE ${table('cert_deploy')} SET config = ? WHERE id = ?`, [encryptConfig(merged), this.tid]);
          delete this.info.config;
        }
        if (Object.keys(this.info).length) {
          await query(`UPDATE ${table('cert_deploy')} SET info = ? WHERE id = ?`, [encryptConfig(this.info), this.tid]);
        }
      }
    }
  }

  async reset(): Promise<void> {
    // 重置必须与调度器互斥：运行中的部署不能被管理员清锁后又被调度器/手工再次执行。
    const token = await this.takeTaskLock();
    try {
      const prev: any = await queryOne(`SELECT last_processid FROM ${table('cert_deploy')} WHERE id = ?`, [this.tid]);
      await query(
        `UPDATE ${table('cert_deploy')} SET status = 0, retry = 0, retrytime = NULL, issend = 0, islock = 0, processid = NULL, last_processid = NULL WHERE id = ? AND processid = ?`,
        [this.tid, token],
      );
      for (const pid of [safeProcessId(prev?.last_processid)]) {
        if (!pid) continue;
        const f = join(LOG_DIR, pid + '.log');
        if (existsSync(f)) unlinkSync(f);
      }
    } finally {
      await this.releaseTaskLock(token).catch(() => undefined);
    }
  }
}