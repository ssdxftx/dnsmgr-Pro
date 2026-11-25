import { query, queryOne, table } from '../../db.js';
import { getCdnProvider } from './factory.js';
import { calcDailyNextRun, fmtDateTime } from '../util.js';

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
  return dedupe(
    String(text || '')
      .split(/\r?\n/)
      .flatMap((line) => {
        const value = line.trim();
        if (!value) return [];
        // 含协议的整行默认保留，避免 query 中的逗号被拆开；只有分隔符后紧跟新协议时才拆分
        if (!value.includes('://')) return value.split(/[;,]/);
        const parts = value.split(/\s*[,;]\s*(?=[A-Za-z][A-Za-z0-9+.-]*:\/\/)/);
        return parts.length > 1 ? parts : [value];
      }),
  );
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

interface TaskHistoryRow {
  url: string;
  route: string;
  op: string;
  status: number;
  msg: string | null;
  taskId: string | null;
  ownerUid: number;
}

/** 批量写历史，避免每个 URL 单独一次 INSERT */
async function insertTasks(rows: TaskHistoryRow[]): Promise<void> {
  // 每行 8 个占位符；SQLite 默认变量上限 999，按 100 行分批（800 个参数）
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, NOW(), ?)').join(', ');
    await query(
      `INSERT INTO ${table('cdn_cache_task')} (url, type, provider, task_id, status, msg, addtime, owner_uid) VALUES ${values}`,
      chunk.flatMap((r) => [r.url, r.op, r.route, r.taskId, r.status, r.msg, r.ownerUid]),
    );
  }
}

/** 按加速域名分组分发缓存操作（预热 / 清除缓存） */
async function dispatchCacheOp(op: 'purge' | 'preheat', type: string, urls: string[], ownerUid = 0): Promise<{ success: number; failed: number }> {
  const list = dedupe(urls);
  const grouped: Record<string, { route: string; provider: any; urls: string[] }> = {};
  const providers: Record<string, any> = {};
  const failed: { url: string; msg: string }[] = [];
  const history: TaskHistoryRow[] = [];
  // 同一任务里多个 URL 常属于同一域名，按域名缓存一次查询结果
  const domainCandidates = new Map<string, any[]>();

  for (const url of list) {
    const domain = domainFromUrl(url);
    if (!domain) {
      failed.push({ url, msg: 'URL 格式错误' });
      continue;
    }
    let candidates = domainCandidates.get(domain);
    if (!candidates) {
      candidates = await query(
        `SELECT D.* FROM ${table('cdn_domain')} D
           JOIN ${table('cdn_account')} A ON D.aid = A.id
          WHERE D.name = ?
            AND (A.visibility <> 'private' OR A.owner_uid = ?)
          ORDER BY CASE WHEN A.visibility = 'private' THEN 0 ELSE 1 END, D.id`,
        [domain, ownerUid],
      );
      domainCandidates.set(domain, candidates);
    }
    const row: any = candidates[0];
    if (!row) {
      failed.push({ url, msg: `未找到加速域名 ${domain}` });
      continue;
    }
    // 同名加速域名可能存在于多个账户；没有账户上下文时宁可失败，避免提交到错误站点。
    if (candidates.length > 1) {
      failed.push({ url, msg: `加速域名 ${domain} 存在于多个账户，无法确定刷新目标` });
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
        history.push({ url: u, route: g.route, op: taskType, status: 1, msg: unsupported, taskId: null, ownerUid });
      }
      continue;
    }
    // 必须保留 receiver：provider 的 purge/preheat 是使用 this 的原型方法
    const taskId = op === 'purge' ? await g.provider[op](g.urls, type) : await g.provider[op](g.urls);
    const errMsg = taskId === false ? g.provider.getError?.() || '提交失败' : null;
    for (const u of g.urls) {
      if (taskId === false) {
        failed.push({ url: u, msg: errMsg || '提交失败' });
        history.push({ url: u, route: g.route, op: taskType, status: 1, msg: errMsg, taskId: null, ownerUid });
      } else {
        success++;
        history.push({ url: u, route: g.route, op: taskType, status: 0, msg: null, taskId: typeof taskId === 'string' ? taskId : null, ownerUid });
      }
    }
  }
  await insertTasks(history);
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
  return calcDailyNextRun(runTime, now);
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