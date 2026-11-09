import { query, queryOne, table } from '../../db.js';
import { getDnsProvider } from '../dns/factory.js';
import { configSet } from '../../config.js';
import { fmtDateTime } from '../util.js';
import { enqueueAudit, nowStr } from '../audit/store.js';
import { checkPing, checkTcp, checkCurl, type CheckResult } from './checkUtils.js';
import { sendNotice } from './msgNotice.js';
import { emitEvent } from '../events.js';

function getDnsType(value: string): string {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return 'A';
  if (value.includes(':')) return 'AAAA';
  return 'CNAME';
}

import { decryptConfig } from '../secret.js';
import { loadAccountConfig } from '../accounts/taskConfig.js';

function safeJson(s: string): Record<string, any> {
  return decryptConfig(s) || {};
}

async function insertLog(taskid: number, action: number, errmsg: string | null) {
  await query(`INSERT INTO ${table('dmlog')} (taskid, action, errmsg, date) VALUES (?, ?, ?, ?)`, [
    taskid,
    action,
    errmsg,
    fmtDateTime(),
  ]);
}

export async function runMonitorTask(row: any): Promise<void> {
  try {
    await handle(row);
  } catch (e: any) {
    await configSet('run_error', e.message || String(e));
    console.error('[dmtask] task ' + row.id + ' 失败:', e.message);
  }
}

/**
 * 状态迁移必须带 `AND status = <读到的值>` 的 CAS：
 * 手动「立即执行」与调度器 tick 可能同时处理同一任务，两边都读到 status=0 后会各做一次
 * 厂商 DNS 切换 + 一条 dmlog + 一次通知。CAS 失败说明另一个执行者已经迁移过状态，直接放弃本次。
 */
async function casUpdate(sql: string, params: any[]): Promise<boolean> {
  const res: any = await query(sql, params);
  return Number(res?.affectedRows || 0) > 0;
}

async function handle(row: any): Promise<void> {
  let action = 0;
  let result: CheckResult = { status: false, errmsg: null, usetime: 0 };
  const now = Math.floor(Date.now() / 1000);
  const prevStatus = Number(row.status || 0);

  if (![1, 2, 3].includes(Number(row.type))) {
    // 非法类型不会命中任何 DNS 操作分支，但旧逻辑仍会把 status 改掉并记录“切换成功”，
    // 实际 DNS 未变。直接停用并记录原因，避免每个 tick 空转。
    await query(`UPDATE ${table('dmtask')} SET active = 0 WHERE id = ?`, [row.id]).catch(() => undefined);
    await insertLog(row.id, 0, '任务类型非法，已自动停用').catch(() => undefined);
    console.warn(`[dmtask] 任务 ${row.id} 类型非法(${row.type})，已自动停用`);
    return;
  }

  if (row.type === 3) {
    // 条件开启解析
    const remain = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${table('dmtask')} WHERE did = ? AND rr = ? AND type = 1 AND status = 0`,
      [row.did, row.rr]
    );
    const cnt = remain?.c ?? 0;
    if (cnt <= row.cycle && row.status === 0) {
      const claimed = await casUpdate(
        `UPDATE ${table('dmtask')} SET status = 1, errcount = 0, switchtime = ? WHERE id = ? AND status = 0`,
        [now, row.id]
      );
      if (!claimed) return;
      action = 2;
    } else if (cnt > row.cycle && row.status === 1) {
      const claimed = await casUpdate(
        `UPDATE ${table('dmtask')} SET status = 0, errcount = 0, switchtime = ? WHERE id = ? AND status = 1`,
        [now, row.id]
      );
      if (!claimed) return;
      action = 1;
    }
  } else {
    if (row.checktype === 2) {
      result = await checkCurl(row.checkurl, row.timeout, row.main_value, row.proxy === 1);
    } else if (row.checktype === 1) {
      result = await checkTcp(row.main_value, row.checkurl, row.tcpport, row.timeout);
    } else {
      result = await checkPing(row.main_value, row.checkurl, row.timeout);
    }

    action = 0;
    // 先计入本次结果再比较，否则 cycle=2 实际要连续 3 次失败才切换
    const confirmCount = Number(row.errcount || 0) + 1;
    const needConfirm = Number(row.cycle || 1);
    if (result.status && row.status === 1) {
      if (needConfirm <= 1 || confirmCount >= needConfirm) {
        const claimed = await casUpdate(
          `UPDATE ${table('dmtask')} SET status = 0, errcount = 0, switchtime = ? WHERE id = ? AND status = 1`,
          [now, row.id]
        );
        if (!claimed) return;
        action = 2;
      } else {
        await query(`UPDATE ${table('dmtask')} SET errcount = ? WHERE id = ? AND status = 1`, [confirmCount, row.id]);
      }
    } else if (!result.status && row.status === 0) {
      if (needConfirm <= 1 || confirmCount >= needConfirm) {
        const claimed = await casUpdate(
          `UPDATE ${table('dmtask')} SET status = 1, errcount = 0, switchtime = ? WHERE id = ? AND status = 0`,
          [now, row.id]
        );
        if (!claimed) return;
        action = 1;
      } else {
        await query(`UPDATE ${table('dmtask')} SET errcount = ? WHERE id = ? AND status = 0`, [confirmCount, row.id]);
      }
    } else if (row.errcount > 0) {
      await query(`UPDATE ${table('dmtask')} SET errcount = 0 WHERE id = ? AND status = ?`, [row.id, Number(row.status || 0)]);
    }
  }

  let opHandled = false;
  let drow: any = null;
  try {
    if (action > 0) {
      drow = await queryOne(
        `SELECT A.*, B.type AS account_type, B.config AS account_config, B.owner_uid AS account_owner FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.id = ?`,
        [row.did]
      );
      if (!drow) {
        console.log('域名不存在（ID：' + row.did + '）');
        return;
      }
      row.domain = row.rr + '.' + drow.name;
    }

  const accountConfig = drow ? await loadAccountConfig({ config: drow.account_config, owner_uid: drow.account_owner }) : {};

  // DNS 操作结果：状态在调用前已写入，若切换失败必须回滚，
  // 否则后续轮询会认为已切换而不再重试，且还会发出「切换成功」通知。
  let opOk = true;
  let opErr = '';
  if (action === 1) {
    if (row.type === 2) {
      const dns = getDnsProvider(drow.account_type, accountConfig, drow.name, drow.thirdid);
      if (!dns) throw new Error('该厂商暂未支持');
      const recordinfo = safeJson(row.recordinfo);
      if (drow.account_type === 'cloudflare' && row.cdn === 1) {
        recordinfo.Line = '1';
      }
      const res = await dns.updateDomainRecord(row.recordid, row.rr, getDnsType(row.backup_value), row.backup_value, recordinfo.Line, recordinfo.TTL);
      if (!res) {
        opOk = false;
        opErr = dns.getError();
        await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (0, ?, '修改解析失败', ?, ?)`, [drow.name, opErr, fmtDateTime()]);
      }
    } else if (row.type === 1 || row.type === 3) {
      const dns = getDnsProvider(drow.account_type, accountConfig, drow.name, drow.thirdid);
      if (!dns) throw new Error('该厂商暂未支持');
      const res = await dns.setDomainRecordStatus(row.recordid, '0');
      if (!res) {
        opOk = false;
        opErr = dns.getError();
        await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (0, ?, '暂停解析失败', ?, ?)`, [drow.name, opErr, fmtDateTime()]);
      }
    }
  } else if (action === 2) {
    if (row.type === 2) {
      const dns = getDnsProvider(drow.account_type, accountConfig, drow.name, drow.thirdid);
      if (!dns) throw new Error('该厂商暂未支持');
      const recordinfo = safeJson(row.recordinfo);
      if (drow.account_type === 'cloudflare' && row.cdn === 1) {
        recordinfo.Line = '0';
      }
      const res = await dns.updateDomainRecord(row.recordid, row.rr, getDnsType(row.main_value), row.main_value, recordinfo.Line, recordinfo.TTL);
      if (!res) {
        opOk = false;
        opErr = dns.getError();
        await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (0, ?, '修改解析失败', ?, ?)`, [drow.name, opErr, fmtDateTime()]);
      }
    } else if (row.type === 1 || row.type === 3) {
      const dns = getDnsProvider(drow.account_type, accountConfig, drow.name, drow.thirdid);
      if (!dns) throw new Error('该厂商暂未支持');
      const res = await dns.setDomainRecordStatus(row.recordid, '1');
      if (!res) {
        opOk = false;
        opErr = dns.getError();
        await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (0, ?, '启用解析失败', ?, ?)`, [drow.name, opErr, fmtDateTime()]);
      }
    }
  } else {
    return;
  }

  if (!opOk) {
    await insertLog(row.id, action, opErr || 'DNS 操作失败');
    console.warn(`[dmtask] 任务 ${row.id} DNS 操作失败，将回滚状态：${opErr || '未知错误'}`);
    return;
  }
    // DNS 已成功变更：此后即使审计/通知失败也不能回滚状态，否则会出现
    //「DNS 已切换但状态仍是旧值」的下一次重复切换。
    opHandled = true;
  } finally {
    if (!opHandled && action > 0) {
      // 域名缺失、配置解密失败、厂商不支持、DNS 操作失败等所有异常路径
      // 都恢复为本次尝试前的状态，避免状态已变而 DNS 未变。
      await query(`UPDATE ${table('dmtask')} SET status = ?, errcount = 0 WHERE id = ?`, [prevStatus, row.id]).catch((e: any) => {
        console.error(`[dmtask] 任务 ${row.id} 状态回滚失败:`, e?.message || e);
      });
    }
  }

  await insertLog(row.id, action, row.type !== 3 && result ? (result.status ? null : result.errmsg) : null);

  if (action > 0 && drow) {
    const toValue = action === 1 ? row.backup_value : row.main_value;
    const opText = action === 1 ? '切换备用解析' : '切回主解析';
    const ok = row.type === 3 ? true : !!result?.status;
    enqueueAudit({
      uid: 0,
      username: 'system',
      auth_type: 'system',
      api_key_id: 0,
      api_key_name: '',
      module: 'monitor',
      action: 'monitor.record.switch',
      method: 'SYSTEM',
      path: '',
      route: '',
      target_type: 'record',
      target_id: String(row.recordid || ''),
      target_name: `${row.rr || '@'}.${drow.name}`,
      summary: `监控自动${opText} ${row.rr || '@'}.${drow.name}${toValue ? ` → ${toValue}` : ''}`,
      detail: null,
      changes: JSON.stringify([{ field: '记录值', to: String(toValue ?? '') }]),
      result: ok ? 1 : 0,
      errmsg: ok ? '' : String(result?.errmsg || '').slice(0, 500),
      status: 0,
      ip: '',
      ua: '',
      cost_ms: 0,
      addtime: nowStr(),
    });
  }

  // 只在状态真正发生迁移时通知：action=0 表示本轮没有切换，
  // 包括稳定运行和 cycle 确认窗口内的首次失败，不能发“恢复正常”通知。
  if (action > 0 && row.type !== 3) {
    await sendNotice(action, row, { status: result.status, errmsg: result.errmsg });
  }
  if (action > 0 && drow) {
    void emitEvent('monitor.record.switched', {
      task_id: row.id,
      domain: `${row.rr || '@'}.${drow.name}`,
      action: action === 1 ? 'backup' : 'main',
      value: action === 1 ? row.backup_value : row.main_value,
    });
  }
}