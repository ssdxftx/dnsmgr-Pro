/**
 * Mock 数据层 —— 仅用于「静态预览构建」。
 *
 * 通过环境变量 VITE_MOCK=true 开启（见 .env.mock）。
 * 正式构建不设置该变量，installMock() 直接返回，不拦截任何请求、不写入任何数据，
 * 因此绝不会污染生产环境。
 */

const MOCK_USER = {
  id: 1,
  username: 'admin',
  level: 2, // >=2 视为管理员，展示全部菜单
  stat_cache: 1,
  lang: 'zh-CN',
};

const CATEGORIES = [
  { id: 1, name: '生产环境' },
  { id: 2, name: 'CDN 加速' },
  { id: 3, name: '测试' },
];

const DNS_ACCOUNTS = [
  { id: 1, type: 'aliyun', name: '阿里云主账号' },
  { id: 2, type: 'tencent', name: '腾讯云 DNSPod' },
  { id: 3, type: 'cloudflare', name: 'Cloudflare' },
];

// 字段对齐 DomainList.vue 所需：id/name/category_name/remark/recordcount/expiretime/checkstatus/is_notice/addtime/cid/is_hide/is_sso
const DOMAINS = [
  { id: 101, name: 'example.com', category_name: '生产环境', remark: '主站', recordcount: 42, expiretime: '2027-03-18 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-06-01 10:24:00', cid: 1, is_hide: 0, is_sso: 0 },
  { id: 102, name: 'api.example.com', category_name: '生产环境', remark: 'API 网关', recordcount: 12, expiretime: '2027-03-18 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-06-01 10:25:00', cid: 1, is_hide: 0, is_sso: 0 },
  { id: 103, name: 'cdn-static.com', category_name: 'CDN 加速', remark: '静态资源', recordcount: 8, expiretime: '2026-11-02 00:00:00', checkstatus: 1, is_notice: 0, addtime: '2024-07-12 09:10:00', cid: 2, is_hide: 0, is_sso: 0 },
  { id: 104, name: 'img-cdn.com', category_name: 'CDN 加速', remark: '图片加速', recordcount: 5, expiretime: '2026-08-21 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-07-15 14:02:00', cid: 2, is_hide: 0, is_sso: 0 },
  { id: 105, name: 'shop-example.cn', category_name: '生产环境', remark: '电商', recordcount: 23, expiretime: '2024-01-01 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-05-20 08:00:00', cid: 1, is_hide: 0, is_sso: 0 },
  { id: 106, name: 'blog.example.net', category_name: '测试', remark: '', recordcount: 6, expiretime: '', checkstatus: 2, is_notice: 0, addtime: '2024-09-03 16:40:00', cid: 3, is_hide: 0, is_sso: 0 },
  { id: 107, name: 'mail-gateway.com', category_name: '生产环境', remark: '邮件', recordcount: 9, expiretime: '2028-01-15 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-04-11 11:11:00', cid: 1, is_hide: 0, is_sso: 0 },
  { id: 108, name: 'dev-internal.local', category_name: '测试', remark: '内网', recordcount: 3, expiretime: '2030-12-31 00:00:00', checkstatus: 0, is_notice: 0, addtime: '2024-10-01 09:00:00', cid: 3, is_hide: 1, is_sso: 0 },
];

// 仅用于 Dashboard 计数（取 length）
// cert_mode：none=从未配置；''=用户主动关闭证书管理（不算待配置）；其余为已托管
const CDN_CERT_MODES = ['none', 'none', 'none', 'none', 'certlink', 'certlink', 'certlink', 'freecert', 'freecert', '', ''];
const CDN_DOMAINS = CDN_CERT_MODES.map((mode, i) => ({
  id: 200 + i,
  name: `cdn-${i + 1}.example.com`,
  cert_mode: mode,
  https_enabled: mode === 'none' ? 0 : 1,
}));

// 解析记录（RecordTable 展示：类型徽章 / 状态 / 等宽值）
const RECORDS = [
  { RecordId: 'r1', Name: '@', Type: 'A', Value: '203.0.113.10', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: '主站', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r2', Name: 'www', Type: 'CNAME', Value: 'example.com.', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: '', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r3', Name: 'api', Type: 'A', Value: '203.0.113.21', Line: '默认', TTL: 300, MX: 0, Status: '1', Remark: 'API 网关', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r4', Name: 'v6', Type: 'AAAA', Value: '2001:db8::a1', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: '', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r5', Name: '@', Type: 'MX', Value: 'mail.example.com.', Line: '默认', TTL: 3600, MX: 10, Status: '1', Remark: '邮件', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r6', Name: '@', Type: 'TXT', Value: 'v=spf1 include:spf.example.com ~all', Line: '默认', TTL: 3600, MX: 0, Status: '1', Remark: 'SPF', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r7', Name: 'cdn', Type: 'CNAME', Value: 'edge.tencent.com.', Line: '境外', TTL: 300, MX: 0, Status: '0', Remark: 'CDN 回源', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r8', Name: 'ns1', Type: 'A', Value: '198.51.100.7', Line: '境内', TTL: 600, MX: 0, Status: '1', Remark: '', did: 101, Domain: 'example.com', Weight: 0 },
];

// 用户列表（UserList：{ list, total }）
const USERS = [
  { id: 1, username: 'admin', level: 2, is_super: 1, is_api: 1, stat_cache: 0, regtime: '2024-01-01 10:00:00', lasttime: '2026-10-10 09:12:00', status: 1 },
  { id: 2, username: 'ops', level: 2, is_super: 0, is_api: 1, stat_cache: 0, regtime: '2024-03-15 11:00:00', lasttime: '2026-10-09 18:40:00', status: 1 },
  { id: 3, username: 'viewer', level: 1, is_super: 0, is_api: 0, stat_cache: 1, regtime: '2024-06-20 14:00:00', lasttime: '2026-10-08 08:20:00', status: 1 },
  { id: 4, username: 'test', level: 1, is_super: 0, is_api: 0, stat_cache: 0, regtime: '2024-09-02 16:00:00', lasttime: '2026-09-30 12:00:00', status: 0 },
];

// 证书订单（CertOrder：status 3=已签发, 1/2=进行中, end_day=剩余天数）
const CERT_ORDERS = [
  { id: 1, typename: "Let's Encrypt", domains: ['example.com', 'www.example.com'], status: 3, expiretime: '2026-11-20', end_day: 41, isauto: 1 },
  { id: 2, typename: "Let's Encrypt", domains: ['api.example.com'], status: 3, expiretime: '2026-10-28', end_day: 18, isauto: 1 },
  { id: 3, typename: 'ZeroSSL', domains: ['cdn-static.com'], status: 1, expiretime: '', end_day: null, isauto: 0 },
  { id: 4, typename: 'Google Trust', domains: ['shop-example.cn'], status: 3, expiretime: '2027-01-05', end_day: 87, isauto: 0 },
  { id: 5, typename: '手动导入', domains: ['img-cdn.com'], status: 3, expiretime: '2026-10-25', end_day: 15, isauto: 0 },
  { id: 6, typename: "Let's Encrypt", domains: ['blog.example.net'], status: 2, expiretime: '', end_day: null, isauto: 0 },
];

// 容灾概览（DmOverview）
const DM_OVERVIEW = { run_count: 1286, run_time: '2026-10-10 12:00:00', run_state: 1, run_error: null, switch_count: 6, fail_count: 1 };

const DM_TASKS = [
  { id: 101, rr: 'www', domain: 'example.com', main_value: '1.1.1.1', backup_value: '2.2.2.2', type: 2, checktype: 1, frequency: 60, status: 0, active: 1, fail_count: 0, switch_count: 2, checktimestr: '2026-10-17 04:00:12', domain_id: 101 },
  { id: 102, rr: 'api', domain: 'example.com', main_value: '3.3.3.3', backup_value: '4.4.4.4', type: 1, checktype: 2, frequency: 120, status: 1, active: 1, fail_count: 3, switch_count: 1, checktimestr: '2026-10-17 03:40:05', domain_id: 101 },
  { id: 103, rr: 'img', domain: 'demo.org', main_value: '5.5.5.5', backup_value: '6.6.6.6', type: 3, checktype: 1, frequency: 300, status: 0, active: 0, fail_count: 0, switch_count: 0, checktimestr: '2026-10-16 22:10:00', domain_id: 102 },
];

// CDN 账户（CdnAccount）
const CDN_ACCOUNTS = [
  { id: 1, type: 'tencent', name: '腾讯云 CDN' },
  { id: 2, type: 'aliyun', name: '阿里云 CDN' },
  { id: 3, type: 'cloudflare', name: 'Cloudflare' },
  { id: 4, type: 'baidu', name: '百度云加速' },
];

// 部署任务（DeployTask）：status 1=已完成，其余=待处理；active=是否启用
const DEPLOY_TASKS = [
  { id: 1, active: true, status: 1, lasttime: '2026-10-17 09:12:00' },
  { id: 2, active: true, status: 1, lasttime: '2026-10-16 22:40:00' },
  { id: 3, active: false, status: 0, lasttime: null },
  { id: 4, active: true, status: 1, lasttime: '2026-10-15 08:05:00' },
  { id: 5, active: false, status: 0, lasttime: null },
];

// 调度策略（ScheduleList）
const SCHEDULE_TASKS = [
  { id: 1, active: true }, { id: 2, active: false }, { id: 3, active: true },
  { id: 4, active: true }, { id: 5, active: false }, { id: 6, active: true },
];

// 优选 IP 任务（OptimizeList）
const OPTIMIZE_TASKS = [
  { id: 1, active: true, status: 1 }, { id: 2, active: true, status: 1 },
  { id: 3, active: false, status: 1 }, { id: 4, active: true, status: 2 },
];

// DNS 检测任务（DnsCheckTask）：status 'ok' / 'not_found' / 'mismatch'
const DNS_CHECK_TASKS = [
  { id: 1, name: '主站解析', did: 101, domain_name: 'example.com', sub: null, types: 'A,CNAME', cycle: 'daily', interval_min: 0, run_time: '04:00', notice_email: 'ops@example.com', active: 1, last_run: '2026-10-17 04:00:12', next_run: '2026-10-18 04:00:00', last_status: 0, issue_count: 0 },
  { id: 2, name: 'API 网关', did: 101, domain_name: 'example.com', sub: 'api', types: 'A', cycle: 'interval', interval_min: 30, run_time: null, notice_email: '', active: 1, last_run: '2026-10-17 12:30:05', next_run: '2026-10-17 13:00:00', last_status: 1, issue_count: 2 },
  { id: 3, name: '静态资源', did: 103, domain_name: 'cdn-static.com', sub: null, types: '', cycle: 'daily', interval_min: 0, run_time: '02:00', notice_email: '', active: 0, last_run: null, next_run: null, last_status: 0, issue_count: 0 },
  { id: 4, name: '图片域名', did: 104, domain_name: 'img-cdn.com', sub: null, types: 'CNAME', cycle: 'interval', interval_min: 60, run_time: null, notice_email: 'ops@example.com', active: 1, last_run: '2026-10-17 12:00:03', next_run: '2026-10-17 13:00:00', last_status: 1, issue_count: 1 },
];

// 操作日志（UserLog）：uid<=0 视为系统事件
const USER_LOGS = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, uid: i % 5 }));

// 证书账户（CertAccount / DeployAccount 共用 /cert/accounts）
const CERT_ACCOUNTS = [
  { id: 1, type: 'letsencrypt', name: "Let's Encrypt" },
  { id: 2, type: 'zerossl', name: 'ZeroSSL' },
  { id: 3, type: 'manual', name: '手动导入' },
];


// ---- CDN 统计（/cdn/statistics/overview & /detail）----
const STAT_LABELS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

function statValues(base: number, amp: number, len = 24): number[] {
  return Array.from({ length: len }, (_, i) => Math.max(0, Math.round(base + Math.sin(i / 3) * amp + (i % 5) * amp * 0.12)));
}

const STAT_METRIC_UNITS: Record<string, string> = {
  flux: 'byte', flux_out: 'byte', flux_in: 'byte', bs_flux: 'byte', origin_flux: 'byte', origin_flux_out: 'byte',
  hit_flux: 'byte', cache_flux_hit: 'byte', cache_flux_miss: 'byte', cache_flux_dynamic: 'byte',
  bw: 'bps', bw_out: 'bps', bw_in: 'bps', origin_bw: 'bps', origin_bw_in: 'bps', origin_bw_out: 'bps',
  req: 'count', req_rate: 'qps', qps: 'qps', hit_req: 'count', cache_req_hit: 'count', cache_req_miss: 'count', origin_req: 'count',
  hit_rate: 'percent', hit_rate_flux: 'percent', hit_rate_req: 'percent',
  resp_time: 'ms', ttfb: 'ms',
  sc_2xx: 'count', sc_3xx: 'count', sc_4xx: 'count', sc_5xx: 'count',
  origin_sc_2xx: 'count', origin_sc_3xx: 'count', origin_sc_4xx: 'count', origin_sc_5xx: 'count',
};

const STAT_KEYS: Record<string, string[]> = {
  tencent_edgeone: ['flux', 'flux_out', 'flux_in', 'bw', 'bw_out', 'bw_in', 'req', 'req_rate', 'hit_rate', 'hit_rate_flux', 'hit_rate_req', 'cache_flux_hit', 'cache_flux_miss', 'cache_flux_dynamic', 'cache_req_hit', 'cache_req_miss', 'bs_flux', 'origin_flux_out', 'origin_bw_in', 'origin_bw_out', 'origin_req', 'sc_2xx', 'sc_3xx', 'sc_4xx', 'sc_5xx', 'origin_sc_2xx', 'origin_sc_3xx', 'origin_sc_4xx', 'origin_sc_5xx', 'resp_time', 'ttfb'],
  tencent_cdn: ['flux', 'bw', 'bs_flux', 'req', 'hit_rate', 'hit_rate_req', 'hit_flux', 'hit_req', 'origin_bw', 'origin_req', 'sc_2xx', 'sc_3xx', 'sc_4xx', 'sc_5xx', 'origin_sc_2xx', 'origin_sc_3xx', 'origin_sc_4xx', 'origin_sc_5xx'],
  aliyun_cdn: ['flux', 'bw', 'req', 'qps', 'hit_rate', 'hit_flux', 'origin_flux', 'origin_bw', 'sc_2xx', 'sc_3xx', 'sc_4xx', 'sc_5xx'],
  aliyun_esa: ['flux', 'bw', 'req', 'qps', 'hit_rate', 'hit_flux', 'bs_flux', 'origin_bw'],
};

const STAT_GROUPS: Record<string, string[]> = {
  tencent_edgeone: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin', 'status', 'performance', 'top'],
  tencent_cdn: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin', 'status'],
  aliyun_cdn: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin', 'status', 'top'],
  aliyun_esa: ['overview', 'traffic', 'bandwidth', 'request', 'cache', 'origin'],
};

const STAT_GROUP_OF: Record<string, string> = {
  flux: 'traffic', flux_out: 'traffic', flux_in: 'traffic',
  bw: 'bandwidth', bw_out: 'bandwidth', bw_in: 'bandwidth',
  req: 'request', req_rate: 'request', qps: 'request',
  hit_rate: 'cache', hit_rate_flux: 'cache', hit_rate_req: 'cache', hit_flux: 'cache', hit_req: 'cache',
  cache_flux_hit: 'cache', cache_flux_miss: 'cache', cache_flux_dynamic: 'cache', cache_req_hit: 'cache', cache_req_miss: 'cache',
  bs_flux: 'origin', origin_flux: 'origin', origin_flux_out: 'origin', origin_bw: 'origin', origin_bw_in: 'origin', origin_bw_out: 'origin', origin_req: 'origin',
  resp_time: 'performance', ttfb: 'performance',
};

function statSeries(key: string): { key: string; group: string; unit: string; agg: string; chart: string; values: (number | null)[]; summary: number; stack?: string } {
  const unit = STAT_METRIC_UNITS[key] || 'count';
  const group = STAT_GROUP_OF[key] || 'status';
  const rate = unit === 'percent';
  const base = rate ? 88 : unit === 'byte' ? 3.2e9 : unit === 'bps' ? 5.2e7 : unit === 'ms' ? 120 : 120000;
  const values = statValues(base, rate ? 4 : base * 0.18).map((v) => (key === 'cache_flux_dynamic' ? Math.round(v * 0.2) : v));
  const summary = rate ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : values.reduce((a, b) => a + b, 0);
  return {
    key,
    group,
    unit,
    agg: unit === 'bps' ? 'max' : rate ? 'rate' : unit === 'ms' ? 'avg' : 'sum',
    chart: key.startsWith('sc_') || key.startsWith('cache_flux') || key === 'hit_flux' ? 'bar' : key === 'flux' || key === 'bs_flux' || key === 'origin_flux' ? 'area' : 'line',
    values,
    summary,
    ...(key.startsWith('sc_') ? { stack: key.startsWith('origin_') ? 'origin' : 'edge' } : key.startsWith('cache_flux') ? { stack: 'cache' } : {}),
  };
}

function buildStatOverview() {
  const values: Record<string, Array<[string, string, number | null]>> = {
    tencent_edgeone: [['flux', 'byte', 2.6e12], ['bw', 'bps', 8.4e7], ['bs_flux', 'byte', 2.1e11], ['req', 'count', 2841937], ['hit_rate', 'percent', 92.4]],
    tencent_cdn: [['flux', 'byte', 1.2e12], ['bw', 'bps', 4.1e7], ['bs_flux', 'byte', 9.8e10], ['req', 'count', 1284930], ['hit_rate', 'percent', 88.1]],
    aliyun_cdn: [['flux', 'byte', 6.4e11], ['bw', 'bps', 2.2e7], ['bs_flux', 'byte', 5.2e10], ['req', 'count', null], ['hit_rate', 'percent', 90.7]],
    aliyun_esa: [['flux', 'byte', null], ['bw', 'bps', null], ['bs_flux', 'byte', null], ['req', 'count', null], ['hit_rate', 'percent', null]],
  };
  const names: Record<string, string> = { tencent_edgeone: '腾讯云 EdgeOne', tencent_cdn: '腾讯云 CDN', aliyun_cdn: '阿里云 CDN', aliyun_esa: '阿里云 ESA' };
  const tones: Record<string, string> = { tencent_edgeone: 'primary', tencent_cdn: 'info', aliyun_cdn: 'success', aliyun_esa: 'warning' };
  return {
    dataUntil: '2026-10-18 17:50:00',
    providers: Object.keys(names).map((route) => {
      const basics = values[route];
      const empty = route === 'aliyun_esa';
      return {
        route,
        name: names[route],
        tone: tones[route],
        status: empty ? 'empty' : route === 'tencent_cdn' ? 'partial' : 'ok',
        accountCount: empty ? 0 : route === 'tencent_edgeone' ? 1 : 2,
        domainCount: empty ? 0 : route === 'tencent_edgeone' ? 3 : 5,
        basics: basics.map(([key, unit, value]) => ({ key, unit, value })),
        ...(route === 'tencent_cdn' ? { error: '部分站点查询超时' } : {}),
        dataUntil: '2026-10-18 17:50:00',
        cached: false,
        tookMs: 412,
      };
    }),
  };
}

function buildStatDetail(route: string, groups: string, top: string) {
  const keys = STAT_KEYS[route] || STAT_KEYS.tencent_edgeone;
  const wanted = groups ? groups.split(',') : [];
  const series = keys
    .filter((key) => !wanted.length || wanted.includes('overview') && ['flux', 'bw', 'bs_flux', 'req', 'hit_rate'].includes(key) || wanted.includes(STAT_GROUP_OF[key] || 'status'))
    .map(statSeries);
  const breakdowns: any[] = [];
  const dims = (top ? top.split(',') : []).filter(Boolean);
  const titles: Record<string, string> = { domain: 'statistics.top.domain', url: 'statistics.top.url', referer: 'statistics.top.referer', statusCode: 'statistics.top.statusCode' };
  for (const dim of dims) {
    const rows = dim === 'statusCode'
      ? ['2xx', '3xx', '4xx', '5xx'].map((label, i) => ({ label, value: 1000000 / (i + 1), percent: 0 }))
      : ['cdn-1.example.com', 'cdn-2.example.com', 'img.example.com'].map((label, i) => ({ label, value: 2.6e11 / (i + 1), percent: 0 }));
    const total = rows.reduce((a, b) => a + b.value, 0);
    for (const row of rows) row.percent = (row.value / total) * 100;
    breakdowns.push({ key: dim, titleKey: titles[dim] || 'statistics.top.domain', unit: dim === 'statusCode' ? 'count' : 'byte', rows });
  }
  return {
    route,
    labels: STAT_LABELS,
    interval: 'hour',
    series,
    breakdowns,
    meta: { status: 'ok', dataUntil: '2026-10-18 17:50:00', delayMinutes: route === 'tencent_edgeone' ? 10 : 5, cached: false, tookMs: 838 },
  };
}

export function installMock() {
  if (import.meta.env.VITE_MOCK !== 'true') return;

  const orig = window.fetch.bind(window);
  window.fetch = async (input: any, init?: any): Promise<Response> => {
    const url: string = typeof input === 'string' ? input : input?.url;
    if (typeof url !== 'string' || !url.includes('/api/')) return orig(input, init);

    const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
    const path = url.slice(url.indexOf('/api')).split('?')[0];
    const json = (data: any, code = 0, msg = 'ok') =>
      new Response(JSON.stringify({ code, data, msg }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (path === '/api/setup/status') return json({ installed: true });

    // 预览用登录：任意账号密码即可进入（展示全新登录页 → 登录 → 控制塔）
    if (method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/totp')) {
      return json({ token: 'mock-token', user: MOCK_USER }, 0, 'ok');
    }

    if (method === 'GET') {
      // 域名下的解析记录
      const recMatch = path.match(/^\/api\/domains\/(\d+)\/records$/);
      if (recMatch) {
        const list = RECORDS.map((r) => ({ ...r, did: Number(recMatch[1]) }));
        return json({ list, total: list.length, _access: { admin: true, readonly: false, writable: true } });
      }
      // 单个域名信息
      const domMatch = path.match(/^\/api\/domains\/(\d+)$/);
      if (domMatch) return json(DOMAINS.find((d) => d.id === Number(domMatch[1])) || DOMAINS[0]);

      if (path === '/api/cdn/statistics/overview') return json(buildStatOverview());
      if (path === '/api/cdn/statistics/detail') {
        const q = new URLSearchParams(url.split('?')[1] || '');
        return json(buildStatDetail(String(q.get('route') || 'tencent_edgeone'), String(q.get('groups') || ''), String(q.get('top') || '')));
      }
      if (path === '/api/domains') return json(DOMAINS);
      if (path === '/api/dns/accounts') return json(DNS_ACCOUNTS);
      const cdnDomMatch = path.match(/^\/api\/cdn\/domains\/(\d+)$/);
      if (cdnDomMatch) {
        const d = CDN_DOMAINS.find((x) => x.id === Number(cdnDomMatch[1])) || CDN_DOMAINS[0];
        return json({
          info: {
            ...d,
            origin: '1.1.1.1',
            origin_type: 'ipaddr',
            origin_host: '',
            origin_protocol: 'follow',
            http_port: 80,
            https_port: 443,
            https_enabled: true,
            force_redirect: false,
          },
          cacheRules: [{ path: '/static', ttl: 86400 }],
        });
      }
      if (path.match(/^\/api\/cdn\/domains\/(\d+)\/access$/)) {
        return json({ referer_mode: 'off', referer_list: [], ip_mode: 'off', ip_list: [], ua_list: [] });
      }
      if (path === '/api/cdn/domains') return json(CDN_DOMAINS);
      if (path === '/api/domains/categories') return json(CATEGORIES);
      if (path === '/api/records/search') return json(RECORDS);
      if (path === '/api/users') return json({ list: USERS, total: USERS.length });
      if (path === '/api/dmonitor/overview') return json(DM_OVERVIEW);
      if (path === '/api/dmonitor/tasks') return json({ list: DM_TASKS, total: DM_TASKS.length });
      {
        const dmMatch = path.match(/^\/api\/dmonitor\/tasks\/(\d+)$/);
        if (dmMatch) return json(DM_TASKS.find((x) => x.id === Number(dmMatch[1])) || DM_TASKS[0]);
        const dmLogs = path.match(/^\/api\/dmonitor\/tasks\/(\d+)\/logs$/);
        if (dmLogs) return json({ list: [], total: 0 });
        const recLog = path.match(/^\/api\/domains\/(\d+)\/recordlog$/);
        if (recLog) return json({ list: [], total: 0 });
      }
      if (path === '/api/cdn/accounts') return json(CDN_ACCOUNTS);
      if (path === '/api/deploy/tasks') return json(DEPLOY_TASKS);
      if (path === '/api/schedule/tasks') return json({ list: SCHEDULE_TASKS, total: SCHEDULE_TASKS.length });
      if (path === '/api/optimize/tasks') return json({ list: OPTIMIZE_TASKS, total: OPTIMIZE_TASKS.length });
      if (path === '/api/dns-check/tasks') return json(DNS_CHECK_TASKS);
      if (path === '/api/logs') return json({ list: USER_LOGS, total: USER_LOGS.length });
      if (path === '/api/cert/accounts') return json(CERT_ACCOUNTS);
      if (path === '/api/cert/orders') {
        return new Response(
          JSON.stringify({
            code: 0,
            data: CERT_ORDERS,
            status_label: { '1': '待验证', '2': '申请中', '3': '已签发', '4': '已过期' },
            msg: 'ok',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // 其余 GET 统一返回空集合，保证未做专项 Mock 的页面不报错
      return json([]);
    }
    // 写操作统一返回成功空对象（预览不可真正修改）
    return json({});
  };
}
