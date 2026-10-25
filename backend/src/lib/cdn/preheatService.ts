import { query, queryOne, table } from '../../db.js';
import { getCdnProvider } from './factory.js';
import { fmtDateTime } from '../util.js';

import { loadAccountConfig } from '../accounts/taskConfig.js';

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    const m = String(url).match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/]+)/);
    return m ? m[1].split(':')[0] : '';
  }
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

/** 把任务里保存的 URL 文本解析为数组（支持换行/逗号/分号分隔） */
export function loadUrls(text: string): string[] {
  return dedupe(String(text || '').split(/\r?\n/).flatMap((s) => s.split(/[;,]/)));
}

async function cdnForZone(aid: number, zoneId: string | null) {
  const acct: any = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [aid]);
  if (!acct) return false;
  const provider: any = getCdnProvider(acct.type, await loadAccountConfig(acct));
  if (!provider) return false;
  if (zoneId && typeof provider.setZoneId === 'function') provider.setZoneId(zoneId);
  if (zoneId && typeof provider.setSiteId === 'function') provider.setSiteId(zoneId);
  return provider;
}

async function insertTask(url: string, route: string, op: string, status: number, msg: string | null, taskId?: string | null, ownerUid = 0) {
  await query(
    `INSERT INTO ${table('cdn_cache_task')} (url, type, provider, task_id, status, msg, addtime, owner_uid) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
    [url, op, route, taskId ?? null, status, msg, ownerUid],
  );
}

/** 按加速域名分组分发缓存操作（预热 / 清除缓存） */
async function dispatchCacheOp(op: 'purge' | 'preheat', type: string, urls: string[], ownerUid = 0): Promise<{ success: number; failed: number }> {
  const list = dedupe(urls);
  const grouped: Record<string, { route: string; provider: any; urls: string[] }> = {};
  const providers: Record<string, any> = {};
  const failed: { url: string; msg: string }[] = [];

  for (const url of list) {
    const domain = domainFromUrl(url);
    if (!domain) {
      failed.push({ url, msg: 'URL 格式错误' });
      continue;
    }
    const row: any = await queryOne(`SELECT * FROM ${table('cdn_domain')} WHERE name = ?`, [domain]);
    if (!row) {
      failed.push({ url, msg: `未找到加速域名 ${domain}` });
      continue;
    }
    const key = `${row.route}#${row.aid}#${row.zone_id || ''}`;
    if (!(key in providers)) providers[key] = await cdnForZone(row.aid, row.zone_id);
    const provider = providers[key];
    if (!provider) {
      failed.push({ url, msg: 'CDN 账户不存在' });
      continue;
    }
    if (!grouped[key]) grouped[key] = { route: row.route, provider, urls: [] };
    grouped[key].urls.push(url);
  }

  let success = 0;
  for (const key of Object.keys(grouped)) {
    const g = grouped[key];
    const unsupported = op === 'purge' ? '该厂商暂不支持清除缓存' : '该厂商暂不支持预热';
    const taskType = op === 'purge' ? (type === 'dir' ? 'dir' : 'url') : 'preheat';
    const fn = g.provider ? g.provider[op] : undefined;
    if (typeof fn !== 'function') {
      for (const u of g.urls) {
        failed.push({ url: u, msg: unsupported });
        await insertTask(u, g.route, taskType, 1, unsupported, null, ownerUid);
      }
      continue;
    }
    const taskId = op === 'purge' ? await fn(g.urls, type) : await fn(g.urls);
    const errMsg = taskId === false ? g.provider.getError?.() || '提交失败' : null;
    for (const u of g.urls) {
      if (taskId === false) {
        failed.push({ url: u, msg: errMsg || '提交失败' });
        await insertTask(u, g.route, taskType, 1, errMsg, null, ownerUid);
      } else {
        success++;
        await insertTask(u, g.route, taskType, 0, null, typeof taskId === 'string' ? taskId : null, ownerUid);
      }
    }
  }
  return { success, failed: failed.length };
}

/** 对一批 URL 执行预热 */
export async function preheatUrls(urls: string[], ownerUid = 0): Promise<{ success: number; failed: number }> {
  return dispatchCacheOp('preheat', 'preheat', urls, ownerUid);
}

/** 对一批 URL 执行清除缓存（URL 刷新） */
export async function purgeUrls(urls: string[], ownerUid = 0): Promise<{ success: number; failed: number }> {
  return dispatchCacheOp('purge', 'url', urls, ownerUid);
}

/** 根据任务配置计算下一次执行时间 */
export function calcNextRun(cycle: string, intervalMin: number, runTime: string | null): Date {
  const now = new Date();
  if (cycle === 'interval' && intervalMin > 0) {
    return new Date(now.getTime() + intervalMin * 60000);
  }
  const [h, m] = String(runTime || '00:00').split(':').map((x) => Number(x) || 0);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

/** 调度器入口：执行所有到期的自动预热任务 */
export async function executePreheatTasks(): Promise<number> {
  const rows: any[] = await query(
    `SELECT * FROM ${table('cdn_preheat_task')} WHERE active = 1 AND (next_run IS NULL OR next_run <= NOW())`,
  );
  let run = 0;
  for (const t of rows) {
    const next = calcNextRun(t.cycle, t.interval_min, t.run_time);
    // 原子领取：仅当任务仍处于到期状态时才更新成功，避免并发调度重复执行
    const claim: any = await query(
      `UPDATE ${table('cdn_preheat_task')} SET last_run = NOW(), next_run = ? WHERE id = ? AND active = 1 AND (next_run IS NULL OR next_run <= NOW())`,
      [fmtDateTime(next), t.id],
    );
    if (!claim || !claim.affectedRows) continue;
    const urls = loadUrls(t.urls);
    if (urls.length) {
      try {
        if (t.op === 'purge') await purgeUrls(urls, Number(t.owner_uid) || 0);
        else await preheatUrls(urls, Number(t.owner_uid) || 0);
      } catch (e: any) {
        console.error('[preheat] 自动任务执行异常:', e?.message);
      }
    }
    run++;
  }
  return run;
}