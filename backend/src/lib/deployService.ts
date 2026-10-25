import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, queryOne, table } from '../db.js';
import { getDeployProvider } from './deploy/factory.js';
import type { DeployProvider } from './deploy/types.js';
import { genSid } from './certService.js';
import { appendLog, safeProcessId } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'runtime', 'log');

import { ConfigDecryptError, decryptConfig, encryptConfig, decryptText } from './secret.js';
import { assertDeployConfigAllowed } from './netGuard.js';

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
    const cfg = safeJson(account.config) || {};
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

  private async saveResult(status: number, error: string | null = null, retrytime: string | null = null) {
    this.task.status = status;
    let err = error;
    if (err && err.length > 300) err = err.slice(0, 300);
    // 单点保证：失败态必须带 retrytime，否则 findDeployTasks 不会再调度该任务，也永远没有终态
    if (status < 0 && !retrytime) {
      const iv = [60, 300, 600, 1800, 3600][this.task.retry] ?? 3600;
      retrytime = new Date(Date.now() + iv * 1000).toISOString().slice(0, 19).replace('T', ' ');
    }
    const update: any = { status, error: err ? err.replace(/[\r\n]/g, '') : null, retrytime: retrytime ? new Date(retrytime) : null };
    if (status === 1) {
      update.retry = 0;
      update.lasttime = new Date();
    }
    if (status < 0 || retrytime) {
      this.task.retry = (this.task.retry || 0) + 1;
      update.retry = this.task.retry;
    }
    await query(`UPDATE ${table('cert_deploy')} SET ? WHERE id = ?`, [update, this.tid]);
    if (err) this.saveLog('[Error] ' + err);
  }

  private async lockTask() {
    if (!safeProcessId(this.task.processid)) this.task.processid = genSid();
    // 原子加锁：仅当未锁或锁已超时（1 小时）时才成功，避免并发重复部署
    const res: any = await query(
      `UPDATE ${table('cert_deploy')} SET islock = 1, locktime = NOW(), processid = ? WHERE id = ? AND (islock = 0 OR islock IS NULL OR locktime IS NULL OR locktime < DATE_SUB(NOW(), INTERVAL 1 HOUR))`,
      [this.task.processid, this.tid],
    );
    if (!res || !res.affectedRows) throw new Error('该部署任务正在处理中，请稍后再试');
  }

  private async unlockTask() {
    // 仅释放自己持有的锁：锁超时被他人抢占后，避免误释放他人的锁导致重复部署
    await query(`UPDATE ${table('cert_deploy')} SET islock = 0 WHERE id = ? AND processid = ?`, [this.tid, this.task.processid]);
  }

  async process(isManual = false): Promise<void> {
    await this.load();
    if (this.task.status >= 1) return;
    if (this.task.retry >= 6 && !isManual) throw new Error('已超出最大重试次数(' + this.task.error + ')');

    const order = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [this.task.oid]);
    if (!order) throw new Error('SSL证书订单不存在');
    if (order.status === 4) throw new Error('SSL证书订单已吊销');
    if (order.status !== 3) throw new Error('SSL证书订单未完成签发');
    if (!order.fullchain || !order.privatekey) throw new Error('SSL证书或私钥内容不存在');
    // 私钥为加密存储，部署前解密（兼容历史明文）；密文解密失败时禁止把密文当私钥部署
    const decryptedKey = decryptText(order.privatekey);
    if (decryptedKey === null && String(order.privatekey).startsWith('enc:')) {
      throw new ConfigDecryptError('证书私钥无法解密（系统密钥可能已变更），请重新签发或导入证书');
    }
    const privateKey = decryptedKey ?? order.privatekey;

    await this.lockTask();
    try {
      await this.deploy(order.fullchain, privateKey);
    } finally {
      await this.unlockTask();
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
      await this.saveResult(-1, e.message, new Date(Date.now() + iv * 1000).toISOString().slice(0, 19).replace('T', ' '));
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
    await query(`UPDATE ${table('cert_deploy')} SET status = 0, retry = 0, retrytime = NULL, issend = 0, islock = 0 WHERE id = ?`, [this.tid]);
  }
}