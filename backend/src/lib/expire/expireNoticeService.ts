import { lookup } from 'whois';
import { query, table } from '../../db.js';
import { configGet, configSet } from '../../config.js';
import { sendExpireNotice } from '../monitor/msgNotice.js';
import { fmtDateTime } from '../util.js';

import { fetchWithProxy } from '../http.js';
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function whoisLookup(domain: string): Promise<string> {
  return new Promise((resolve, reject) => {
    lookup(domain, { follow: 2, timeout: 10000 }, (err: any, data: any) => {
      if (err) reject(new Error(err?.message || 'whois查询失败'));
      else resolve(typeof data === 'string' ? data : String(data));
    });
  });
}

/** RDAP 查询（HTTPS），作为 whois(43端口) 受限时的备用方案 */
type DomainDates = { creationDate: string | null; expirationDate: string | null };

async function fetchRdap(url: string): Promise<DomainDates> {
  const res = await fetchWithProxy(url, {
    headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': 'dnsmgr-pro' },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const hint = res.status === 404 ? '（该后缀无可用 RDAP 服务）' : '';
    throw new Error(`HTTP ${res.status}${hint}`);
  }
  const data: any = await res.json();
  let expiration: string | null = null;
  let creation: string | null = null;
  for (const e of data.events || []) {
    if (e.eventAction === 'expiration' && !expiration) expiration = e.eventDate;
    if (e.eventAction === 'registration' && !creation) creation = e.eventDate;
  }
  if (!expiration) throw new Error('响应未包含到期时间');
  return {
    creationDate: creation ? parseDateValue(String(creation)) : null,
    expirationDate: parseDateValue(String(expiration)),
  };
}

// IANA RDAP 引导表：rdap.org 限流/跳转失败时，直接查注册局 RDAP
let rdapBootstrap: { at: number; services: [string[], string[]][] } | null = null;

async function rdapBootstrapUrl(domain: string): Promise<string | null> {
  const tld = domain.split('.').pop()?.toLowerCase();
  if (!tld) return null;
  if (!rdapBootstrap || Date.now() - rdapBootstrap.at > 12 * 3600_000) {
    try {
      const res = await fetchWithProxy('https://data.iana.org/rdap/dns.json', {
        headers: { Accept: 'application/json', 'User-Agent': 'dnsmgr-pro' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      rdapBootstrap = { at: Date.now(), services: Array.isArray(data.services) ? data.services : [] };
    } catch {
      return null;
    }
  }
  const hit = rdapBootstrap.services.find(([tlds, urls]) => Array.isArray(tlds) && Array.isArray(urls) && tlds.includes(tld));
  if (!hit?.[1]?.[0]) return null;
  const base = hit[1][0].endsWith('/') ? hit[1][0] : hit[1][0] + '/';
  return `${base}domain/${encodeURIComponent(domain)}`;
}

async function rdapLookup(domain: string): Promise<DomainDates> {
  const errors: string[] = [];
  // 优先走 IANA 引导出的注册局 RDAP：rdap.org 经 Cloudflare 限流时经常 403/超时
  const bootstrapUrl = await rdapBootstrapUrl(domain);
  if (bootstrapUrl) {
    try {
      return await fetchRdap(bootstrapUrl);
    } catch (e: any) {
      errors.push(`注册局 RDAP ${e?.message || '查询失败'}`);
    }
  }
  try {
    return await fetchRdap(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  } catch (e: any) {
    errors.push(`rdap.org ${e?.message || '查询失败'}`);
  }
  throw new Error(errors.join('；') || '查询失败');
}

// 最后兜底：.cn 等后缀没有 RDAP 服务，且服务器 43 端口被限制时，
// 从公开 WHOIS 页面提取。主机固定，域名只作为路径参数编码。
const WEB_DATE = String.raw`(\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{1,2}:\d{1,2}Z?)?)`;
const WEB_EXPIRY_RE = new RegExp(
  String.raw`(?:Registry Expiry Date|Registrar Registration Expiration Date|Expiration Date|Expiry Date|Expiration Time|Registry Expiration Date|Registrant Registration Expiration Date|Expires On|Expires|Paid-till|Expiration)\s*:\s*${WEB_DATE}`,
  'i',
);
const WEB_CREATION_RE = new RegExp(
  String.raw`(?:Creation Date|Created Date|Created On|Created|Registration Time|Registration Date|Registered|Creation)\s*:\s*${WEB_DATE}`,
  'i',
);

export function parseWebWhoisHtml(html: string): DomainDates {
  const expiration = html.match(WEB_EXPIRY_RE)?.[1];
  if (!expiration) throw new Error('页面未返回到期时间');
  const creation = html.match(WEB_CREATION_RE)?.[1];
  return {
    creationDate: creation ? parseDateValue(creation) : null,
    expirationDate: parseDateValue(expiration),
  };
}

async function webWhoisLookup(domain: string): Promise<DomainDates> {
  const encoded = encodeURIComponent(domain);
  const sources = [`https://who.is/whois/${encoded}`, `https://www.whois.com/whois/${encoded}`];
  let lastError: any = null;
  for (const url of sources) {
    try {
      const res = await fetchWithProxy(url, {
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; dnsmgr-pro)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseWebWhoisHtml(await res.text());
    } catch (e: any) {
      lastError = e;
    }
  }
  throw lastError || new Error('备用 WHOIS 查询失败');
}

function parseDateValue(raw: string): string | null {
  let s = (raw || '').trim();
  if (!s) return null;
  s = s.split(/\s+/)[0];
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);
  if (iso) {
    const [y, mo, d, h = '00', mi = '00', se = '00'] = iso.slice(1);
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')} ${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${se.padStart(2, '0')}`;
  }
  const beta = s.match(/^(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{4})$/i);
  if (beta) {
    const [, d, m, y] = beta;
    return `${y}-${MONTHS[m.toLowerCase()]}-${d.padStart(2, '0')} 00:00:00`;
  }
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} 00:00:00`;
  }
  const plain = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (plain) {
    const [, y, mo, d] = plain;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')} 00:00:00`;
  }
  return null;
}

const EXPIRY_RE =
  /(?:Registry Expiry Date|Registrar Registration Expiration Date|Expiration Date|Expiry Date|Expiration Time|Registry Expiration Date|Registrant Registration Expiration Date|Expires On|Expires|Paid-till|Expiration|到期时间)\s*:\s*(.+)$/i;
const CREATION_RE =
  /(?:Creation Date|Created Date|Created On|Created|Registration Time|Registration Date|Registered|Creation|创建时间|注册时间)\s*:\s*(.+)$/i;

function parseWhoisData(raw: string): { creationDate: string | null; expirationDate: string | null } {
  const lines = raw.split(/\r?\n/);
  let expiration: string | null = null;
  let creation: string | null = null;
  for (const line of lines) {
    const e = line.match(EXPIRY_RE);
    if (e && !expiration) expiration = parseDateValue(e[1]);
    const c = line.match(CREATION_RE);
    if (c && !creation) creation = parseDateValue(c[1]);
    if (expiration && creation) break;
  }
  return { creationDate: creation, expirationDate: expiration };
}

export async function getDomainDate(domain: string): Promise<{ regTime: string | null; expireTime: string }> {
  let whoisError = '';
  try {
    const raw = await whoisLookup(domain);
    const { creationDate, expirationDate } = parseWhoisData(raw);
    if (expirationDate) return { regTime: creationDate, expireTime: expirationDate };
    whoisError = 'WHOIS 响应未包含到期时间';
  } catch (e: any) {
    // whois(43端口) 受限，改用 RDAP
    whoisError = e?.message || 'WHOIS 查询失败';
  }

  let rdapError = '';
  try {
    const { creationDate, expirationDate } = await rdapLookup(domain);
    if (expirationDate) return { regTime: creationDate, expireTime: expirationDate };
    rdapError = 'RDAP 响应未包含到期时间';
  } catch (e: any) {
    rdapError = e?.message || 'RDAP 查询失败';
  }

  let webError = '';
  try {
    const { creationDate, expirationDate } = await webWhoisLookup(domain);
    if (expirationDate) return { regTime: creationDate, expireTime: expirationDate };
    webError = '备用 WHOIS 响应未包含到期时间';
  } catch (e: any) {
    webError = e?.message || '备用 WHOIS 查询失败';
  }

  throw new Error(`无法获取到期时间：WHOIS ${whoisError}；RDAP ${rdapError}；备用 WHOIS ${webError}`);
}

export async function updateDomainDate(id: number, domain: string) {
  try {
    const { regTime, expireTime } = await getDomainDate(domain);
    await query(
      `UPDATE ${table('domain')} SET regtime = ?, expiretime = ?, checktime = ?, checkstatus = 1 WHERE id = ?`,
      [regTime, expireTime, fmtDateTime(), id],
    );
    return { code: 0, regTime, expireTime, msg: 'Success' };
  } catch (e: any) {
    await query(`UPDATE ${table('domain')} SET checktime = ?, checkstatus = 2 WHERE id = ?`, [fmtDateTime(), id]);
    return { code: -1, msg: e?.message || '查询失败' };
  }
}

// 单轮最多查询的域名数：whois 逐条查询且限速，批量过大会挤占本轮调度时间
const REFRESH_BATCH = 10;
// 同一域名的自动刷新间隔：续费后最迟 1 小时即可反映到域名列表
const REFRESH_STALE_HOURS = 1;
// 近到期域名的刷新范围（天）：与提醒天数解耦，避免提醒配置过小时漏刷
const REFRESH_HORIZON_DAYS = 30;

async function refreshRows(rows: any[]): Promise<number> {
  let success = 0;
  for (let i = 0; i < rows.length && i < REFRESH_BATCH; i++) {
    const row = rows[i];
    const res = await updateDomainDate(row.id, row.name);
    if (res.code === 0) {
      success++;
      console.log(`[expire] 域名: ${row.name} 注册时间: ${res.regTime ?? '-'} 到期时间: ${res.expireTime}`);
    } else console.log(`[expire] 域名: ${row.name} 更新失败，${res.msg}`);
    if (i + 1 < rows.length && i + 1 < REFRESH_BATCH) await sleep(1000);
  }
  return success;
}

export async function refreshDomainList(): Promise<number> {
  // 未查询过（0）与查询失败（2）的域名都要重试：
  // 失败状态若永久排除，whois 偶发超时会让该域名一直停留在旧到期时间。
  const rows: any[] = await query(
    `SELECT id, name FROM ${table('domain')}
      WHERE checkstatus = 0
         OR (checkstatus = 2 AND (checktime IS NULL OR checktime <= NOW() - INTERVAL ${REFRESH_STALE_HOURS} HOUR))
      ORDER BY (checktime IS NULL) DESC, checktime ASC, id ASC
      LIMIT ${REFRESH_BATCH}`,
  );
  return refreshRows(rows);
}

export async function refreshExpiringDomainList(maxDay: number): Promise<number> {
  // 不再限制“已过期 5 天内”：域名过期后过一段时间才续费的情况同样需要刷新到期时间。
  // 按 checktime 轮转，避免 LIMIT 固定命中同一批域名导致其余域名长期得不到刷新。
  const horizon = Math.max(maxDay, REFRESH_HORIZON_DAYS);
  const rows: any[] = await query(
    `SELECT id, name FROM ${table('domain')}
      WHERE expiretime IS NOT NULL
        AND expiretime <= NOW() + INTERVAL ${horizon} DAY
        AND (checktime IS NULL OR checktime <= NOW() - INTERVAL ${REFRESH_STALE_HOURS} HOUR)
      ORDER BY (checktime IS NULL) DESC, checktime ASC, id ASC
      LIMIT ${REFRESH_BATCH}`,
  );
  return refreshRows(rows);
}

async function noticeExpiringDomainList(maxDay: number, days: number[]): Promise<void> {
  const rows: any[] = await query(
    `SELECT id, name, expiretime FROM ${table('domain')} WHERE expiretime >= NOW() AND expiretime <= (NOW() + INTERVAL ${maxDay} DAY) AND is_notice = 1 AND (noticetime IS NULL OR noticetime <= (NOW() - INTERVAL 20 HOUR)) ORDER BY expiretime ASC`,
  );
  const noticeMap: Record<number, { id: number; name: string; expiretime: string }[]> = {};
  for (const row of rows) {
    const expireDay = Math.floor((new Date(row.expiretime).getTime() - Date.now()) / 86400000);
    if (days.includes(expireDay)) {
      (noticeMap[expireDay] ||= []).push({ id: row.id, name: row.name, expiretime: fmtDateTime(new Date(row.expiretime)) });
    }
  }
  for (const [day, list] of Object.entries(noticeMap)) {
    const ids = list.map((x) => x.id);
    // 先发送、成功后（至少一个渠道成功）再写 noticetime；全渠道失败则不写，下一轮重试
    try {
      const okCount = await sendExpireNotice(Number(day), list);
      if (okCount > 0) {
        await query(`UPDATE ${table('domain')} SET noticetime = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [fmtDateTime(), ...ids]);
        console.log(`[expire] 域名到期提醒: ${day}天内到期的${ids.length}个域名已发送（${okCount} 个渠道成功）`);
      } else {
        console.log(`[expire] 域名到期提醒: ${day}天内 ${ids.length} 个域名无可用渠道发送成功，将在下次重试`);
      }
    } catch (e: any) {
      console.log(`[expire] 域名到期提醒发送失败（${day}天内 ${ids.length} 个域名），将在下次重试：${e?.message || e}`);
    }
  }
}

export async function expireNoticeTask(): Promise<void> {
  console.log('[expire] 开始执行域名到期提醒任务...');
  await configSet('domain_expire_time', fmtDateTime());

  let daysStr = (await configGet('expire_noticedays', '')) || '';
  let maxDay = 30;
  let days: number[] = [];
  if (daysStr) {
    days = daysStr.split(',').map((s) => parseInt(s)).filter((n) => !isNaN(n));
    maxDay = (days.length ? Math.max(...days) : 30) + 1;
  }

  // whois 刷新与到期通知解耦：刷新有单轮批量上限，
  // 但不得据此跳过通知——否则只要存在待刷新域名，到期提醒会长期不发。
  // 刷新失败的域名在下一轮重试，不影响本轮已就绪域名的通知。
  await refreshDomainList();
  await refreshExpiringDomainList(maxDay);

  const nowHour = new Date().getHours();
  const anyOn = ['expire_notice_mail', 'expire_notice_wxtpl', 'expire_notice_tgbot', 'expire_notice_qqbot', 'expire_notice_webhook', 'expire_notice_custom_webhook'];
  let enabled = false;
  for (const k of anyOn) {
    const v = await configGet(k);
    // 与发送逻辑（msgNotice）保持一致：1 与 2 均视为开启（2 表示「始终发送」）
    if (v === '1' || v === '2') { enabled = true; break; }
  }
  if (daysStr && enabled && nowHour >= 9) {
    await noticeExpiringDomainList(maxDay, days);
  }
}