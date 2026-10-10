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
const CDN_DOMAINS = Array.from({ length: 11 }, (_, i) => ({ id: 200 + i, name: `cdn-${i + 1}.example.com` }));

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

// CDN 账户（CdnAccount）
const CDN_ACCOUNTS = [
  { id: 1, type: 'tencent', name: '腾讯云 CDN' },
  { id: 2, type: 'aliyun', name: '阿里云 CDN' },
  { id: 3, type: 'cloudflare', name: 'Cloudflare' },
  { id: 4, type: 'baidu', name: '百度云加速' },
];

// 部署任务（DeployTask）：status 1=已完成，其余=待处理；active=是否启用
const DEPLOY_TASKS = [
  { id: 1, active: true, status: 1 },
  { id: 2, active: true, status: 1 },
  { id: 3, active: false, status: 2 },
  { id: 4, active: true, status: 1 },
  { id: 5, active: false, status: 3 },
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
  { id: 1, active: true, status: 'ok' },
  { id: 2, active: true, status: 'not_found' },
  { id: 3, active: false, status: 'ok' },
  { id: 4, active: true, status: 'mismatch' },
];

// 操作日志（UserLog）：uid<=0 视为系统事件
const USER_LOGS = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, uid: i % 5 }));

// 证书账户（CertAccount / DeployAccount 共用 /cert/accounts）
const CERT_ACCOUNTS = [
  { id: 1, type: 'letsencrypt', name: "Let's Encrypt" },
  { id: 2, type: 'zerossl', name: 'ZeroSSL' },
  { id: 3, type: 'manual', name: '手动导入' },
];

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
      if (recMatch) return json(RECORDS.map((r) => ({ ...r, did: Number(recMatch[1]) })));
      // 单个域名信息
      const domMatch = path.match(/^\/api\/domains\/(\d+)$/);
      if (domMatch) return json(DOMAINS.find((d) => d.id === Number(domMatch[1])) || DOMAINS[0]);

      if (path === '/api/domains') return json(DOMAINS);
      if (path === '/api/dns/accounts') return json(DNS_ACCOUNTS);
      if (path === '/api/cdn/domains') return json(CDN_DOMAINS);
      if (path === '/api/domains/categories') return json(CATEGORIES);
      if (path === '/api/records/search') return json(RECORDS);
      if (path === '/api/users') return json({ list: USERS, total: USERS.length });
      if (path === '/api/dmonitor/overview') return json(DM_OVERVIEW);
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
