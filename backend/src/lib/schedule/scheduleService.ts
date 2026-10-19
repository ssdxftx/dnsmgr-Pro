import { query, queryOne, table } from '../../db.js';
import { configSet } from '../../config.js';
import { getDnsProvider } from '../dns/factory.js';
import { fmtDateTime } from '../util.js';
import { enqueueAudit, nowStr } from '../audit/store.js';

function getDnsType(value: string): string {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return 'A';
  if (value.includes(':')) return 'AAAA';
  return 'CNAME';
}

import { decryptConfig } from '../secret.js';

function safeJson(s: string): Record<string, any> {
  return decryptConfig(s) || {};
}

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

async function addLog(domain: string, action: string, data: string) {
  if (data.length > 500) data = data.substring(0, 500);
  await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (0, ?, ?, ?, ?)`, [
    domain, action, data, fmtDateTime(),
  ]);
}

export async function executeAll(): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const list = await query(
    `SELECT * FROM ${table('sctask')} WHERE nexttime > 0 AND nexttime <= ? AND active = 1`,
    [now]
  );
  if (list.length === 0) return false;
  console.log('开始执行定时切换解析任务，共获取到' + list.length + '个待执行任务');
  for (const row of list) {
    // 原子认领：仅当任务仍到期时才置 nexttime=0，避免并发/多实例重复执行同一任务
    const claim: any = await query(
      `UPDATE ${table('sctask')} SET nexttime = 0 WHERE id = ? AND nexttime > 0 AND nexttime <= ? AND active = 1`,
      [row.id, now]
    );
    if (!claim || !claim.affectedRows) continue;
    try {
      await executeOne(row);
      console.log('定时切换任务' + row.id + '执行成功');
    } catch (e: any) {
      console.log('定时切换任务' + row.id + '执行失败,' + e.message);
      // 失败后恢复为立即到期，下一轮重试
      await query(`UPDATE ${table('sctask')} SET nexttime = ? WHERE id = ?`, [now, row.id]).catch(() => undefined);
    }
  }
  await configSet('schedule_time', fmtDateTime());
  return true;
}

export async function executeOne(row: any): Promise<void> {
  const drow = await queryOne(
    `SELECT A.*, B.type AS account_type, B.config AS account_config FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.id = ?`,
    [row.did]
  );
  if (!drow) throw new Error('域名不存在');

  await query(`UPDATE ${table('sctask')} SET updatetime = ? WHERE id = ?`, [Math.floor(Date.now() / 1000), row.id]);

  const domain = row.rr + '.' + drow.name;
  const dns = getDnsProvider(drow.account_type, safeJson(drow.account_config), drow.name, drow.thirdid);
  if (!dns) throw new Error('DNS模块不存在');

  let opOk = true;
  let opErr = '';
  if (row.switchtype === 1) {
    const res = await dns.setDomainRecordStatus(row.recordid, '1');
    if (res) await addLog(domain, '启用解析', '定时启用解析成功');
    else {
      opOk = false;
      opErr = dns.getError();
      await addLog(domain, '启用解析失败', opErr);
    }
  } else if (row.switchtype === 2) {
    const res = await dns.setDomainRecordStatus(row.recordid, '0');
    if (res) await addLog(domain, '暂停解析', '定时暂停解析成功');
    else {
      opOk = false;
      opErr = dns.getError();
      await addLog(domain, '暂停解析失败', opErr);
    }
  } else if (row.switchtype === 3) {
    const res = await dns.deleteDomainRecord(row.recordid);
    if (res) await addLog(domain, '删除解析', '定时删除解析成功');
    else {
      opOk = false;
      opErr = dns.getError();
      await addLog(domain, '删除解析失败', opErr);
    }
  } else {
    const recordinfo = safeJson(row.recordinfo);
    if (!recordinfo.Line || !recordinfo.TTL) {
      throw new Error('解析记录信息不完整，无法执行切换');
    }
    if (drow.account_type === 'cloudflare' && !isNullOrEmpty(row.line)) {
      recordinfo.Line = row.line;
    }
    const res = await dns.updateDomainRecord(row.recordid, row.rr, getDnsType(row.value), row.value, recordinfo.Line, recordinfo.TTL);
    if (res) {
      await addLog(domain, '修改解析', row.rr + ' [' + getDnsType(row.value) + '] ' + row.value + ' (线路:' + recordinfo.Line + ' TTL:' + recordinfo.TTL + ')');
    } else {
      opOk = false;
      opErr = dns.getError();
      await addLog(domain, '修改解析失败', opErr);
    }
  }

  const opText: Record<number, string> = { 1: '启用解析', 2: '暂停解析', 3: '删除解析' };
  enqueueAudit({
    uid: 0,
    username: 'system',
    module: 'schedule',
    action: 'schedule.record.switch',
    method: 'SYSTEM',
    path: '',
    route: '',
    target_type: 'record',
    target_id: String(row.recordid || ''),
    target_name: domain,
    summary: `定时任务${opText[Number(row.switchtype)] || '切换解析'} ${domain}`,
    detail: null,
    changes: JSON.stringify([
      { field: '操作', to: opText[Number(row.switchtype)] || '修改解析' },
      ...(row.switchtype >= 4 && row.value ? [{ field: '记录值', to: String(row.value) }] : []),
    ]),
    result: opOk ? 1 : 0,
    errmsg: opOk ? '' : String(opErr || '').slice(0, 500),
    status: 0,
    ip: '',
    ua: '',
    cost_ms: 0,
    addtime: nowStr(),
  });

  await updateNexttime(row);
}

export async function updateNexttime(row: any): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  let nexttime = 0;

  if (row.type === 1) {
    const switchtime = String(row.switchtime || '').trim();
    const today = new Date();
    if (row.cycle === 2) {
      const date = parseInt(row.switchdate);
      if (isNaN(date)) throw new Error('每月日期配置错误');
      const daysIn = (y: number, mIdx: number) => new Date(y, mIdx + 1, 0).getDate();
      const y = today.getFullYear();
      let d = new Date(y, today.getMonth(), Math.min(date, daysIn(y, today.getMonth())), 0, 0, 0);
      applyHms(d, switchtime);
      if (d.getTime() / 1000 <= now) {
        const ny = d.getFullYear();
        const nm = d.getMonth() + 1;
        d = new Date(ny, nm, Math.min(date, daysIn(ny, nm)), 0, 0, 0);
        applyHms(d, switchtime);
      }
      nexttime = Math.floor(d.getTime() / 1000);
    } else if (row.cycle === 1) {
      const weekday = parseInt(row.switchdate);
      const todayDow = today.getDay();
      const daysAhead = ((weekday - todayDow + 7) % 7);
      let d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      applyHms(d, switchtime);
      if (daysAhead > 0) {
        d = new Date(d.getTime() + daysAhead * 86400 * 1000);
      } else if (d.getTime() / 1000 <= now) {
        d = new Date(d.getTime() + 7 * 86400 * 1000);
      }
      nexttime = Math.floor(d.getTime() / 1000);
    } else {
      let d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      applyHms(d, switchtime);
      if (d.getTime() / 1000 <= now) {
        d = new Date(d.getTime() + 86400 * 1000);
      }
      nexttime = Math.floor(d.getTime() / 1000);
    }
  } else {
    // 单次执行，switchtime 为 datetime-local 值（YYYY-MM-DDTHH:mm）
    const t = new Date(String(row.switchtime).replace(' ', 'T'));
    if (isNaN(t.getTime())) {
      nexttime = 0;
    } else {
      nexttime = Math.floor(t.getTime() / 1000);
      if (nexttime <= now) nexttime = 0;
    }
  }

  await query(`UPDATE ${table('sctask')} SET nexttime = ? WHERE id = ?`, [nexttime, row.id]);
}

function applyHms(d: Date, switchtime: string): void {
  const m = String(switchtime).match(/^(\d{1,2}):(\d{1,2})/);
  if (m) {
    d.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
  }
}