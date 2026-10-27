/**
 * Mock 数据层 —— 仅用于「静态预览构建」。
 *
 * 通过环境变量 VITE_MOCK=true 开启（见 .env.mock）。
 * 正式构建不设置该变量，installMock() 直接返回，不拦截任何请求、不写入任何数据，
 * 因此绝不会污染生产环境。
 */

import esaCatalogJson from '../../../backend/src/lib/cdn/esaApiCatalog.json';

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
  { id: 1, type: 'aliyun', name: '阿里云主账号', remark: '生产环境主账号', config_error: 0, addtime: '2024-05-12 09:20:00' },
  { id: 2, type: 'tencent', name: '腾讯云 DNSPod', remark: '主站解析', config_error: 0, addtime: '2024-05-12 09:24:00' },
  { id: 3, type: 'cloudflare', name: 'Cloudflare Global', remark: '海外站点 / 代理开启', config_error: 0, addtime: '2024-06-01 14:10:00' },
  { id: 4, type: 'huawei', name: '华为云 DNS（华东-上海一）', remark: '政务云项目专用', config_error: 0, addtime: '2024-07-08 10:02:00' },
  { id: 5, type: 'volcengine', name: '火山引擎 ByteDance DNS', remark: '', config_error: 1, addtime: '2024-08-19 16:45:00' },
  { id: 6, type: 'aws', name: 'AWS Route 53 · us-east-1', remark: 'Global Accelerator 配套解析', config_error: 0, addtime: '2024-09-02 11:30:00' },
  { id: 7, type: 'namesilo', name: 'NameSilo', remark: '域名注册商默认 DNS', config_error: 0, addtime: '2024-10-11 08:15:00' },
  { id: 8, type: 'goedge', name: 'GoEdge 自建集群', remark: '内部 CDN 节点解析，主备双机 + Anycast 出口，仅内网可达', config_error: 0, addtime: '2024-11-20 19:40:00' },
  { id: 9, type: 'baidu', name: '百度云智能 DNS（已弃用）', remark: '历史账户，仅保留只读，等待迁移完成后删除', config_error: 1, addtime: '2023-12-01 10:00:00' },
];

// 字段对齐 DomainList.vue 所需：id/name/category_name/remark/recordcount/expiretime/checkstatus/is_notice/addtime/cid/is_hide/is_sso
const DOMAINS = [
  { id: 101, name: 'example.com', category_name: '生产环境', remark: '主站', recordcount: 16, expiretime: '2027-03-18 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-06-01 10:24:00', cid: 1, is_hide: 0, is_sso: 0 },
  { id: 102, name: 'api.example.com', category_name: '生产环境', remark: 'API 网关', recordcount: 6, expiretime: '2027-03-18 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-06-01 10:25:00', cid: 1, is_hide: 0, is_sso: 0 },
  { id: 103, name: 'cdn-static.com', category_name: 'CDN 加速', remark: '静态资源', recordcount: 4, expiretime: '2026-11-02 00:00:00', checkstatus: 1, is_notice: 0, addtime: '2024-07-12 09:10:00', cid: 2, is_hide: 0, is_sso: 0 },
  { id: 104, name: 'img-cdn.com', category_name: 'CDN 加速', remark: '图片加速', recordcount: 3, expiretime: '2026-08-21 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-07-15 14:02:00', cid: 2, is_hide: 0, is_sso: 0 },
  { id: 105, name: 'shop-example.cn', category_name: '生产环境', remark: '电商主站（含权重解析）', recordcount: 8, expiretime: '2024-01-01 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-05-20 08:00:00', cid: 1, is_hide: 0, is_sso: 0 },
  { id: 106, name: 'blog.example.net', category_name: '测试', remark: '', recordcount: 2, expiretime: '', checkstatus: 2, is_notice: 0, addtime: '2024-09-03 16:40:00', cid: 3, is_hide: 0, is_sso: 0 },
  { id: 107, name: 'mail-gateway.com', category_name: '生产环境', remark: '邮件', recordcount: 9, expiretime: '2028-01-15 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2024-04-11 11:11:00', cid: 1, is_hide: 0, is_sso: 0 },
  { id: 108, name: 'dev-internal.local', category_name: '测试', remark: '内网', recordcount: 3, expiretime: '2030-12-31 00:00:00', checkstatus: 0, is_notice: 0, addtime: '2024-10-01 09:00:00', cid: 3, is_hide: 1, is_sso: 0 },
  { id: 109, name: 'promo-2026-autumn-shopping-festival.example.com', category_name: 'CDN 加速', remark: '大促活动页，峰值 QPS 30 万，源站为多活架构', recordcount: 37, expiretime: '2026-11-15 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2025-08-01 09:00:00', cid: 2, is_hide: 0, is_sso: 0 },
  { id: 110, name: 'gov-service.example.gov.cn', category_name: '生产环境', remark: '政务门户（SSO 托管）', recordcount: 12, expiretime: '2029-06-30 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2023-11-11 10:00:00', cid: 1, is_hide: 0, is_sso: 1 },
  { id: 111, name: 'legacy-oa.example.cn', category_name: '测试', remark: '旧 OA，待下线', recordcount: 5, expiretime: '2025-12-31 00:00:00', checkstatus: 2, is_notice: 0, addtime: '2022-03-08 15:20:00', cid: 3, is_hide: 0, is_sso: 0 },
  { id: 112, name: 'edge-assets.example.com', category_name: 'CDN 加速', remark: 'EdgeOne 回源', recordcount: 6, expiretime: '2027-09-09 00:00:00', checkstatus: 1, is_notice: 1, addtime: '2025-01-20 11:00:00', cid: 2, is_hide: 0, is_sso: 0 },
  { id: 113, name: 'staging.example.com', category_name: '测试', remark: '预发环境，禁止外网直接访问', recordcount: 4, expiretime: '2026-10-30 00:00:00', checkstatus: 0, is_notice: 1, addtime: '2025-02-14 09:30:00', cid: 3, is_hide: 1, is_sso: 0 },
  { id: 114, name: 'xn--fiqs8s-example.cn', category_name: '生产环境', remark: '中文域名（Punycode）', recordcount: 3, expiretime: '2027-05-05 00:00:00', checkstatus: 1, is_notice: 0, addtime: '2024-12-12 12:12:00', cid: 1, is_hide: 0, is_sso: 0 },
  { id: 115, name: 'very-long-subdomain-for-cdn-origin-testing.example.com', category_name: 'CDN 加速', remark: '', recordcount: 1, expiretime: '2026-11-08 00:00:00', checkstatus: 1, is_notice: 0, addtime: '2025-03-03 03:03:00', cid: 2, is_hide: 0, is_sso: 0 },
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
  { RecordId: 'r9', Name: '_dmarc', Type: 'TXT', Value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@example.com; ruf=mailto:forensic@example.com; fo=1; adkim=s; aspf=s; pct=100', Line: '默认', TTL: 3600, MX: 0, Status: '1', Remark: 'DMARC 策略（长文本测试）', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r10', Name: '_sip._tcp', Type: 'SRV', Value: '10 60 5060 sipserver.example.com.', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: 'SIP 服务', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r11', Name: '@', Type: 'CAA', Value: '0 issue "letsencrypt.org"', Line: '默认', TTL: 3600, MX: 0, Status: '1', Remark: '证书颁发限制', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r12', Name: 'go', Type: 'REDIRECT_URL', Value: 'https://www.example.com/promo?utm_source=dns&utm_medium=redirect', Line: '默认', TTL: 300, MX: 0, Status: '1', Remark: '短链跳转', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r13', Name: 'legacy', Type: 'FORWARD_URL', Value: 'https://legacy.example.org/', Line: '默认', TTL: 300, MX: 0, Status: '0', Remark: '旧站转发（已停用）', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r14', Name: 'ns2', Type: 'NS', Value: 'ns2.example.com.', Line: '默认', TTL: 86400, MX: 0, Status: '1', Remark: '', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r15', Name: 'test-long-remark', Type: 'A', Value: '203.0.113.99', Line: '电信', TTL: 60, MX: 0, Status: '1', Remark: '这条备注特别长，用于验证表格与移动端卡片在超长中文备注下的换行与省略表现，不应撑破容器', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r16', Name: 'www', Type: 'A', Value: '203.0.113.11', Line: '联通', TTL: 600, MX: 0, Status: '1', Remark: '', did: 101, Domain: 'example.com', Weight: 0 },
  { RecordId: 'r101', Name: 'api', Type: 'A', Value: '203.0.113.31', Line: '默认', TTL: 300, MX: 0, Status: '1', Remark: 'API 主节点', did: 102, Domain: 'api.example.com', Weight: 0 },
  { RecordId: 'r102', Name: 'api', Type: 'A', Value: '203.0.113.32', Line: '默认', TTL: 300, MX: 0, Status: '1', Remark: 'API 备节点', did: 102, Domain: 'api.example.com', Weight: 0 },
  { RecordId: 'r103', Name: 'gw', Type: 'CNAME', Value: 'api.example.com.', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: '', did: 102, Domain: 'api.example.com', Weight: 0 },
  { RecordId: 'r104', Name: 'v2', Type: 'A', Value: '203.0.113.33', Line: '境内', TTL: 300, MX: 0, Status: '1', Remark: 'v2 接口', did: 102, Domain: 'api.example.com', Weight: 0 },
  { RecordId: 'r105', Name: 'v2', Type: 'A', Value: '203.0.113.34', Line: '境外', TTL: 300, MX: 0, Status: '1', Remark: 'v2 接口（海外）', did: 102, Domain: 'api.example.com', Weight: 0 },
  { RecordId: 'r106', Name: '_acme-challenge', Type: 'TXT', Value: 'bXlzdXBlcmxvbmdhY21lY2hhbGxlbmdldG9rZW52YWx1ZWZvcnRlc3Rpbmc=', Line: '默认', TTL: 60, MX: 0, Status: '1', Remark: '', did: 102, Domain: 'api.example.com', Weight: 0 },
  { RecordId: 'r201', Name: '@', Type: 'CNAME', Value: 'cdn-static.com.w.cdngslb.com.', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: 'CDN 接入', did: 103, Domain: 'cdn-static.com', Weight: 0 },
  { RecordId: 'r202', Name: 'www', Type: 'CNAME', Value: 'cdn-static.com.w.cdngslb.com.', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: '', did: 103, Domain: 'cdn-static.com', Weight: 0 },
  { RecordId: 'r203', Name: '_acme-challenge', Type: 'TXT', Value: 'certificate-validation-token-placeholder-0001', Line: '默认', TTL: 60, MX: 0, Status: '1', Remark: '证书验证', did: 103, Domain: 'cdn-static.com', Weight: 0 },
  { RecordId: 'r204', Name: 'status', Type: 'CNAME', Value: 'statuspage.example.com.', Line: '默认', TTL: 600, MX: 0, Status: '0', Remark: '状态页（暂停）', did: 103, Domain: 'cdn-static.com', Weight: 0 },
  { RecordId: 'r301', Name: 'img', Type: 'CNAME', Value: 'img-cdn.com.edgekey.net.', Line: '默认', TTL: 300, MX: 0, Status: '1', Remark: '', did: 104, Domain: 'img-cdn.com', Weight: 0 },
  { RecordId: 'r302', Name: 'static', Type: 'CNAME', Value: 'img-cdn.com.edgekey.net.', Line: '默认', TTL: 300, MX: 0, Status: '1', Remark: '', did: 104, Domain: 'img-cdn.com', Weight: 0 },
  { RecordId: 'r303', Name: '@', Type: 'A', Value: '198.51.100.88', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: '', did: 104, Domain: 'img-cdn.com', Weight: 0 },
  { RecordId: 'r401', Name: 'shop', Type: 'A', Value: '203.0.113.40', Line: '默认', TTL: 120, MX: 0, Status: '1', Remark: '权重 30', did: 105, Domain: 'shop-example.cn', Weight: 30 },
  { RecordId: 'r402', Name: 'shop', Type: 'A', Value: '203.0.113.41', Line: '默认', TTL: 120, MX: 0, Status: '1', Remark: '权重 50', did: 105, Domain: 'shop-example.cn', Weight: 50 },
  { RecordId: 'r403', Name: 'shop', Type: 'A', Value: '203.0.113.42', Line: '默认', TTL: 120, MX: 0, Status: '1', Remark: '权重 20', did: 105, Domain: 'shop-example.cn', Weight: 20 },
  { RecordId: 'r404', Name: 'pay', Type: 'A', Value: '203.0.113.50', Line: '默认', TTL: 60, MX: 0, Status: '1', Remark: '支付网关', did: 105, Domain: 'shop-example.cn', Weight: 0 },
  { RecordId: 'r405', Name: 'pay', Type: 'A', Value: '203.0.113.51', Line: '默认', TTL: 60, MX: 0, Status: '1', Remark: '支付网关备', did: 105, Domain: 'shop-example.cn', Weight: 0 },
  { RecordId: 'r406', Name: 'm', Type: 'CNAME', Value: 'shop-example.cn.', Line: '默认', TTL: 300, MX: 0, Status: '1', Remark: '移动端', did: 105, Domain: 'shop-example.cn', Weight: 0 },
  { RecordId: 'r407', Name: '@', Type: 'MX', Value: 'mx1.qiye.aliyun.com.', Line: '默认', TTL: 3600, MX: 5, Status: '1', Remark: '', did: 105, Domain: 'shop-example.cn', Weight: 0 },
  { RecordId: 'r408', Name: '@', Type: 'TXT', Value: 'google-site-verification=abcdefghijklmnopqrstuvwxyz0123456789', Line: '默认', TTL: 3600, MX: 0, Status: '1', Remark: '', did: 105, Domain: 'shop-example.cn', Weight: 0 },
  { RecordId: 'r501', Name: '@', Type: 'A', Value: '198.51.100.120', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: '', did: 106, Domain: 'blog.example.net', Weight: 0 },
  { RecordId: 'r502', Name: 'www', Type: 'CNAME', Value: 'blog.example.net.', Line: '默认', TTL: 600, MX: 0, Status: '1', Remark: '', did: 106, Domain: 'blog.example.net', Weight: 0 },
];


const ESA_RULE_CONFIGS = {
  RedirectRule: [
    { ruleId: 'rr-001', ruleName: '全站 HTTP → HTTPS 强制跳转', kind: 'RedirectRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
    { ruleId: 'rr-002', ruleName: '旧域名 legacy.example.com 永久重定向到主站', kind: 'RedirectRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
    { ruleId: 'rr-003', ruleName: '移动端 UA 跳转 m.example.com', kind: 'RedirectRule', enabled: false, rules: [{ RuleEnable: 'off' }] },
    { ruleId: 'rr-004', ruleName: '大促期间临时跳转（2026-11-01 至 2026-11-15）', kind: 'RedirectRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
  ],
  HttpsRule: [
    { ruleId: 'ht-001', ruleName: '强制 HTTPS 并启用 HSTS（max-age=31536000）', kind: 'HttpsRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
    { ruleId: 'ht-002', ruleName: 'TLS 最低版本 1.2', kind: 'HttpsRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
    { ruleId: 'ht-003', ruleName: '仅允许 TLS 1.3 的严格模式', kind: 'HttpsRule', enabled: false, rules: [{ RuleEnable: 'off' }] },
  ],
  CacheRule: [
    { ruleId: 'ca-001', ruleName: '静态资源（js/css/图片）缓存 30 天', kind: 'CacheRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
    { ruleId: 'ca-002', ruleName: 'HTML 不缓存，回源校验', kind: 'CacheRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
    { ruleId: 'ca-003', ruleName: 'API 接口绕过缓存', kind: 'CacheRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
    { ruleId: 'ca-004', ruleName: '边缘缓存 1 小时（大促页面临时策略）', kind: 'CacheRule', enabled: false, rules: [{ RuleEnable: 'off' }] },
    { ruleId: 'ca-005', ruleName: '忽略源站 no-cache 头', kind: 'CacheRule', enabled: false, rules: [{ RuleEnable: 'off' }] },
  ],
  TransformRule: [
    { ruleId: 'tr-001', ruleName: '移除响应头 X-Powered-By', kind: 'TransformRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
    { ruleId: 'tr-002', ruleName: '追加 CORS 响应头', kind: 'TransformRule', enabled: true, rules: [{ RuleEnable: 'on' }] },
  ],
  NetworkOptimization: [
    { ruleId: 'no-001', ruleName: '开启 Brotli 压缩', kind: 'NetworkOptimization', enabled: true, rules: [{ RuleEnable: 'on' }] },
    { ruleId: 'no-002', ruleName: 'HTTP/3 与 0-RTT', kind: 'NetworkOptimization', enabled: true, rules: [{ RuleEnable: 'on' }] },
  ],
};

const WEIGHT_ROWS = [
  { rr: 'shop', SubDomain: 'shop.shop-example.cn', Open: true, Type: 'A', Line: '默认' },
  { rr: 'pay', SubDomain: 'pay.shop-example.cn', Open: false, Type: 'A', Line: '默认' },
  { rr: 'api', SubDomain: 'api.shop-example.cn', Open: true, Type: 'A', Line: '境内' },
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
  { id: 1, type: 'tencent', typename: '腾讯云 CDN', name: '腾讯云 CDN' },
  { id: 2, type: 'aliyun', typename: '阿里云 CDN', name: '阿里云 CDN' },
  { id: 3, type: 'cloudflare', typename: 'Cloudflare', name: 'Cloudflare' },
  { id: 4, type: 'baidu', typename: '百度云加速', name: '百度云加速' },
  { id: 5, type: 'aliyun_esa', typename: '阿里云 ESA', name: '阿里云 ESA 演示账户', remark: '静态预览用假数据' },
  { id: 6, type: 'tencent_edgeone', typename: '腾讯云 EdgeOne', name: '腾讯云 EdgeOne 演示账户', remark: '静态预览用假数据' },
];

const CDN_PROVIDERS = {
  tencent_edgeone: {
    name: '腾讯云 EdgeOne',
    note: '静态预览演示账户，数据均为假数据',
    vendor: 'eo',
    config: {
      SecretId: { name: 'SecretId', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
    },
    capabilities: {
      zoneManage: true,
      originGroup: true,
      loadBalancer: true,
      rules: true,
      security: true,
      securityIpGroup: true,
      l4: true,
      tasks: true,
      analysis: true,
    },
    addFlow: {
      zone: { needed: true, label: '站点' },
      serviceArea: { needed: false },
      origin: { protocol: true, ports: true, host: true, hostModes: ['accelerate', 'origin', 'custom'] },
      cert: ['freecert', 'certlink'],
      scene: { needed: true },
    },
  },
  aliyun_esa: {
    name: '阿里云 ESA',
    note: '静态预览演示账户，数据均为假数据',
    vendor: 'esa',
    config: {
      AccessKeyId: { name: 'AccessKeyId', type: 'input', required: true },
      AccessKeySecret: { name: 'AccessKeySecret', type: 'input', required: true },
      region: { name: 'Region', type: 'select', options: [{ value: 'cn-hangzhou', label: '中国内地 (cn-hangzhou)' }, { value: 'ap-southeast-1', label: '非中国内地 (ap-southeast-1)' }] },
    },
    capabilities: {
      zoneManage: true,
      originGroup: true,
      loadBalancer: true,
      rules: true,
      security: true,
      securityIpGroup: true,
      waf: true,
      originProtection: true,
      ddos: true,
      l4: true,
      tasks: true,
      analysis: true,
    },
    addFlow: {
      zone: { needed: true, label: '站点' },
      serviceArea: { needed: false },
      origin: { protocol: false, ports: true, host: true, hostModes: ['accelerate', 'origin', 'custom'] },
      cert: ['certapply'],
      scene: { needed: false },
    },
  },
};

const ESA_SITE = {
  zone_id: '1000000001',
  zone_name: 'demo-esa.com',
  status: 'active',
  area: 'domestic',
  accessType: 'NS',
  paused: false,
  domain_count: 2,
  route: 'aliyun_esa',
  cloud: true,
  nameServers: ['ns1.demo-esa.com', 'ns2.demo-esa.com'],
  verifyCode: 'verify_demo_123456',
  versionManagement: true,
  planName: 'ESA 专业版',
  instanceId: 'esa-demo-001',
  createTime: '2026-10-01T10:00:00Z',
  updateTime: '2026-10-22T08:00:00Z',
};

const EO_SITE = {
  zone_id: 'zone-eo-demo',
  zone_name: 'demo-eo.com',
  name: 'demo-eo.com',
  status: 'active',
  type: 'partial',
  area: 'global',
  accessType: 'CNAME',
  paused: false,
  domain_count: 2,
  route: 'tencent_edgeone',
  cloud: true,
  nameServers: ['ns1.demo-eo.com', 'ns2.demo-eo.com'],
  createTime: '2026-09-12T10:00:00Z',
  updateTime: '2026-10-20T08:00:00Z',
};

const EO_DOMAINS = [
  { id: 9101, name: 'www.demo-eo.com', origin: '203.0.113.20', origin_type: 'ipaddr', zone_id: EO_SITE.zone_id, status: 'online', cname: 'www.demo-eo.com.eo.dnsv1.com' },
  { id: 9102, name: 'api.demo-eo.com', origin: 'origin.demo-eo.com', origin_type: 'domain', zone_id: EO_SITE.zone_id, status: 'online', cname: 'api.demo-eo.com.eo.dnsv1.com' },
];

const EO_ORIGIN_GROUPS = {
  total: 2,
  list: [
    { groupId: 'og-primary', name: '主源站', type: 'HTTP', records: ['203.0.113.20'] },
    { groupId: 'og-backup', name: '备用源站', type: 'HTTP', records: ['203.0.113.21'] },
  ],
};

const EO_LOAD_BALANCERS = {
  total: 1,
  list: [{ instanceId: 'lb-demo', name: '默认负载均衡', type: 'HTTP', originGroups: ['og-primary', 'og-backup'], status: 'online' }],
};

const EO_ZONE_SETTING = {
  zoneSetting: {
    ForceRedirectHTTPS: { Switch: 'on', RedirectStatusCode: 301 },
    HTTP2: { Switch: 'on' },
    OCSPStapling: { Switch: 'off' },
    HSTS: { Switch: 'on', IncludeSubDomains: 'on', Preload: 'off', Timeout: 31536000 },
    TLSConfig: { Version: ['TLSv1.2', 'TLSv1.3'], CipherSuite: 'general-v2023' },
    QUIC: { Switch: 'on' },
    UpstreamHTTP2: { Switch: 'off' },
    Grpc: { Switch: 'off' },
    WebSocket: { Switch: 'on', Timeout: 30 },
    Cache: { FollowOrigin: { Switch: 'on' }, CustomTime: { Switch: 'off', CacheTime: 0 }, NoCache: { Switch: 'off' } },
    CachePrefresh: { Switch: 'off', CacheTimePercent: 90 },
    SmartRouting: { Switch: 'on' },
    Compression: { Switch: 'on', Algorithms: ['gzip', 'brotli'] },
    OfflineCache: { Switch: 'off' },
    ClientIPHeader: { Switch: 'off', HeaderName: '' },
    ClientIPCountry: { Switch: 'off' },
    PostMaxSize: { Switch: 'on', MaxSize: 838860800 },
    IPv6: { Switch: 'on' },
    AccelerateMainland: { Switch: 'off' },
  },
};

const ESA_DOMAINS = [
  { id: 9001, name: 'www.demo-esa.com', origin: '203.0.113.10', origin_type: 'ipaddr', zone_id: ESA_SITE.zone_id, status: 'online', cname: 'www.demo-esa.com.demo-esa.com.cname.com' },
  { id: 9002, name: 'api.demo-esa.com', origin: 'origin.demo-esa.com', origin_type: 'domain', zone_id: ESA_SITE.zone_id, status: 'online', cname: 'api.demo-esa.com.demo-esa.com.cname.com' },
];

const ESA_SITE_PROPS = {
  ...ESA_SITE,
  SiteId: ESA_SITE.zone_id,
  SiteName: ESA_SITE.zone_name,
  Coverage: ESA_SITE.area,
  AccessType: ESA_SITE.accessType,
  NameServerList: ESA_SITE.nameServers.join(','),
  nsList: ESA_SITE.nameServers,
  vanityNs: ['ns1.custom-demo.com'],
  nameExclusive: true,
  VersionManagement: true,
  versionManagement: true,
  PlanName: ESA_SITE.planName,
  InstanceId: ESA_SITE.instanceId,
  CnameZone: 'demo-esa.com.cname.com',
  VerifyCode: ESA_SITE.verifyCode,
  CreateTime: ESA_SITE.createTime,
  UpdateTime: ESA_SITE.updateTime,
};

const ESA_PLAN_INSTANCES = [
  { InstanceId: 'esa-demo-001', PlanName: 'ESA 专业版', ExpireTime: '2027-10-01T00:00:00Z', SiteQuota: '10', Status: 'online', Coverages: 'domestic,overseas,global' },
];

const ESA_RULE_COMMON_FIELDS = [
  { name: 'RuleName', type: 'string', label: '规则名称', group: 'common' },
  { name: 'RuleEnable', type: 'switch', label: '规则开关', group: 'common', choices: ['on', 'off'] },
  { name: 'Rule', type: 'expression', label: '规则内容', group: 'common' },
  { name: 'Sequence', type: 'number', label: '规则执行顺序', group: 'common' },
];
const ESA_RULE_SCHEMA = [
  {
    kind: 'RedirectRule',
    fields: [
      ...ESA_RULE_COMMON_FIELDS,
      { name: 'Type', type: 'enum', label: '重定向类型', choices: ['static', 'dynamic'] },
      { name: 'TargetUrl', type: 'string', label: '目标 URL', required: true },
      { name: 'StatusCode', type: 'enum', label: '状态码', choices: ['301', '302', '303', '307', '308'], required: true },
      { name: 'ReserveQueryString', type: 'switch', label: '保留查询字符串', choices: ['on', 'off'], required: true },
    ],
  },
  {
    kind: 'CacheRule',
    fields: [
      ...ESA_RULE_COMMON_FIELDS,
      { name: 'BypassCache', type: 'enum', label: '缓存资格', choices: ['cache_all', 'bypass_all'] },
      { name: 'BrowserCacheMode', type: 'enum', label: '浏览器缓存模式', choices: ['no_cache', 'follow_origin', 'override_origin'] },
      { name: 'BrowserCacheTtl', type: 'string', label: '浏览器缓存过期时间' },
      { name: 'EdgeCacheMode', type: 'enum', label: '节点缓存模式', choices: ['follow_origin', 'no_cache', 'override_origin', 'follow_origin_bypass', 'follow_origin_override'] },
      { name: 'EdgeCacheTtl', type: 'string', label: '节点缓存过期时间' },
      { name: 'EdgeStatusCodeCacheTtl', type: 'string', label: '状态码缓存过期时间' },
      { name: 'SortQueryStringForCache', type: 'switch', label: '查询字符串排序', choices: ['on', 'off'] },
      { name: 'QueryStringMode', type: 'enum', label: '查询字符串处理', choices: ['ignore_all', 'exclude_query_string', 'reserve_all', 'include_query_string'] },
      { name: 'QueryString', type: 'string', label: '查询字符串' },
      { name: 'IncludeHeader', type: 'string', label: '包含请求头' },
      { name: 'IncludeCookie', type: 'string', label: '包含 Cookie' },
      { name: 'CheckPresenceHeader', type: 'string', label: '检查请求头存在' },
      { name: 'CheckPresenceCookie', type: 'string', label: '检查 Cookie 存在' },
      { name: 'UserDeviceType', type: 'switch', label: '用户设备类型', choices: ['on', 'off'] },
      { name: 'UserGeo', type: 'switch', label: '用户地理位置', choices: ['on', 'off'] },
      { name: 'UserLanguage', type: 'switch', label: '用户语言', choices: ['on', 'off'] },
      { name: 'ServeStale', type: 'switch', label: '响应过期缓存', choices: ['on', 'off'] },
      { name: 'CacheReserveEligibility', type: 'enum', label: 'Cache Reserve 资格', choices: ['bypass_cache_reserve', 'eligible_for_cache_reserve'] },
      { name: 'PostCache', type: 'switch', label: 'Post 缓存', choices: ['on', 'off'] },
      { name: 'PostBodySizeLimit', type: 'string', label: 'Post Body 大小限制' },
      { name: 'PostBodyCacheKey', type: 'enum', label: 'Post CacheKey 处理', choices: ['md5', 'ignore'] },
      { name: 'AdditionalCacheablePorts', type: 'string', label: '额外缓存端口' },
      { name: 'CacheDeceptionArmor', type: 'switch', label: '缓存欺骗防御', choices: ['on', 'off'] },
    ],
  },
  {
    kind: 'HttpsBasicConfiguration',
    fields: [
      ...ESA_RULE_COMMON_FIELDS,
      { name: 'Https', type: 'enum', label: 'SSL/TLS 加密', choices: ['on', 'off'] },
      { name: 'CiphersuiteGroup', type: 'enum', label: '密码套件组', choices: ['all', 'strict'] },
      { name: 'Ciphersuite', type: 'string', label: '密码套件' },
      { name: 'OcspStapling', type: 'switch', label: 'OCSP Stapling', choices: ['on', 'off'] },
    ],
  },
  {
    kind: 'HttpsApplicationConfiguration',
    fields: [
      ...ESA_RULE_COMMON_FIELDS,
      { name: 'HttpsForce', type: 'switch', label: '强制 HTTPS', choices: ['on', 'off'] },
      { name: 'HttpsForceCode', type: 'enum', label: '强制 HTTPS 状态码', choices: ['301', '302', '307', '308'] },
      { name: 'AltSvc', type: 'switch', label: '机会性加密', choices: ['on', 'off'] },
      { name: 'AltSvcClear', type: 'switch', label: 'Alt-Svc Clear', choices: ['on', 'off'] },
      { name: 'AltSvcPersist', type: 'switch', label: 'Alt-Svc Persist', choices: ['on', 'off'] },
      { name: 'AltSvcMa', type: 'string', label: 'Alt-Svc 有效时间' },
      { name: 'Hsts', type: 'switch', label: 'HSTS', choices: ['on', 'off'] },
      { name: 'HstsMaxAge', type: 'string', label: 'HSTS 过期时间' },
      { name: 'HstsIncludeSubdomains', type: 'switch', label: '包含子域名', choices: ['on', 'off'] },
      { name: 'HstsPreload', type: 'switch', label: 'Preload', choices: ['on', 'off'] },
      { name: 'HttpsSniVerify', type: 'switch', label: 'SNI 校验', choices: ['on', 'off'] },
      { name: 'HttpsNoSniDeny', type: 'switch', label: '无 SNI 拒绝', choices: ['on', 'off'] },
      { name: 'HttpsSniWhitelist', type: 'string', label: 'SNI 白名单' },
    ],
  },
  {
    kind: 'OriginRule',
    fields: [
      ...ESA_RULE_COMMON_FIELDS,
      { name: 'OriginHost', type: 'string', label: '回源 Host' },
      { name: 'OriginScheme', type: 'enum', label: '回源协议', choices: ['follow_client', 'http', 'https'] },
      { name: 'OriginHttpPort', type: 'string', label: 'HTTP 端口' },
      { name: 'OriginHttpsPort', type: 'string', label: 'HTTPS 端口' },
      { name: 'OriginSni', type: 'string', label: '回源 SNI' },
      { name: 'DnsRecord', type: 'string', label: 'DNS 记录覆盖' },
      { name: 'Range', type: 'enum', label: 'Range 模式', choices: ['on', 'off'] },
      { name: 'RangeChunkSize', type: 'string', label: '分片大小' },
      { name: 'OriginMtls', type: 'switch', label: '回源 mTLS', choices: ['on', 'off'] },
      { name: 'OriginVerify', type: 'switch', label: '校验源站证书', choices: ['on', 'off'] },
      { name: 'OriginReadTimeout', type: 'string', label: '回源读超时' },
    ],
  },
];

const ESA_CATALOG = esaCatalogJson;

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
const AUDIT_MODULES = ['record', 'domain', 'cdn', 'cert', 'system'];
const AUDIT_ACTIONS = ['record.create', 'record.update', 'domain.update', 'cdn.domain.create', 'cert.order.create', 'system.settings.update'];
const USER_LOGS = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  uid: i % 5,
  username: i % 5 ? `user${i % 5}` : '',
  module: AUDIT_MODULES[i % AUDIT_MODULES.length],
  action: AUDIT_ACTIONS[i % AUDIT_ACTIONS.length],
  method: 'POST',
  path: '/api/domains/101/records',
  route: '/api/domains/:id/records',
  target_type: 'record',
  target_id: String(1000 + i),
  target_name: `www${i}.example.com`,
  summary: `新增 A 记录 www${i} → 1.1.1.${i}`,
  detail: { params: { id: 101 }, body: { name: `www${i}`, type: 'A', value: `1.1.1.${i}` } },
  changes: i % 3 ? [] : [{ field: '记录值', from: '1.1.1.1', to: `2.2.2.${i}` }],
  result: i % 6 ? 1 : 0,
  errmsg: i % 6 ? '' : '模拟失败：上游超时',
  status: 200,
  ip: `10.0.0.${i}`,
  ua: 'Mozilla/5.0 (Mock)',
  cost_ms: 12 + i,
  addtime: `2026-10-${String(10 + (i % 9)).padStart(2, '0')} 12:0${i % 10}:00`,
}));

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

let mockWafSeq = 300;
let mockRulesetSeq = 9000;
const mockWafRulesets = new Map<string, number>();
const mockManagedCounts: Record<number, number> = {
  11: 24, 12: 18, 13: 9, 14: 6, 15: 8, 16: 7, 17: 5, 18: 4, 22: 6, 26: 4, 27: 10, 28: 5, 31: 12, 99: 3,
};
const mockWafStore: any[] = [];

function ensureMockRuleset(phase: string): number {
  if (!mockWafRulesets.has(phase)) mockWafRulesets.set(phase, ++mockRulesetSeq);
  return mockWafRulesets.get(phase)!;
}

function mockWafAdd(phase: string, config: any, rulesetId?: number) {
  const row = {
    Id: ++mockWafSeq,
    Name: config?.Name || `${phase}-${mockWafSeq}`,
    Status: config?.Status || 'on',
    Phase: phase,
    RulesetId: rulesetId || ensureMockRuleset(phase),
    Config: config || {},
  };
  mockWafStore.push(row);
  return row;
}

function seedMockWaf() {
  if (mockWafStore.length) return;
  ensureMockRuleset('http_custom');
  ensureMockRuleset('http_ratelimit');
  ensureMockRuleset('http_whitelist');
  ensureMockRuleset('ip_access_rule');
  ensureMockRuleset('http_managed');
  ensureMockRuleset('http_anti_scan');
  ensureMockRuleset('http_security_level_rule');

  mockWafAdd('http_custom', {
    Name: 'block-curl-scanner',
    Status: 'on',
    Type: 'http_custom',
    Expression: '(http.user_agent contains "curl")',
    Action: 'deny',
    Notes: '拦截脚本扫描器',
  });
  mockWafAdd('http_custom', {
    Name: 'protect-admin-path',
    Status: 'on',
    Type: 'http_custom',
    Expression: '(http.request.uri.path starts_with "/admin")',
    Action: 'js',
  });
  mockWafAdd('http_ratelimit', {
    Name: 'api-rate-limit',
    Status: 'on',
    Type: 'http_ratelimit',
    Expression: '(http.request.uri.path starts_with "/api")',
    Action: 'deny',
    RateLimit: {
      Characteristics: { Logic: 'or', Criteria: [{ MatchType: 'ip.src' }] },
      Interval: 60,
      TTL: 60,
      Threshold: { Request: 120 },
      OnHit: false,
    },
  });
  mockWafAdd('http_whitelist', {
    Name: 'office-allowlist',
    Status: 'on',
    Type: 'http_whitelist',
    Expression: '(ip.src in {"203.0.113.0/24"})',
    Actions: { Bypass: { Skip: 'all' } },
  });
  mockWafAdd('ip_access_rule', {
    Name: 'block-datacenter',
    Status: 'on',
    Type: 'ip',
    Value: '198.51.100.0/24',
    Action: 'deny',
    Notes: '机房 IP 段',
  });
  mockWafAdd('ip_access_rule', {
    Name: 'monitor-partner',
    Status: 'on',
    Type: 'ip',
    Value: '192.0.2.10',
    Action: 'monitor',
  });
  for (const [type, level, action] of [
    [11, 2, 'deny'],
    [12, 2, 'deny'],
    [27, 1, 'monitor'],
  ] as Array<[number, number, string]>) {
    mockWafAdd('http_managed', {
      Name: `managed-${type}`,
      Status: 'on',
      Type: 'http_managed',
      Expression: 'true',
      ManagedRulesets: [{ AttackType: type, ProtectionLevel: level, Action: action }],
    });
  }
  mockWafAdd('http_security_level_rule', {
    Name: 'security-level',
    Status: 'on',
    Type: 'http_security_level_rule',
    SecurityLevel: { Value: 'medium' },
  });
  mockWafAdd('http_anti_scan', {
    Name: 'scan-tools',
    Status: 'on',
    Type: 'http_scan_tools',
    ManagedList: 'intelligence_scan_tools',
    Expression: 'true',
    Action: 'deny',
  });
}
seedMockWaf();

let mockPoolSeq = 500;
let mockLbSeq = 600;
let mockWaitingSeq = 700;
let mockWaitingEventSeq = 7100;
let mockWaitingRuleSeq = 7200;
let mockL4Seq = 800;

const mockOriginPools: any[] = [
  {
    Id: 101,
    Name: 'primary',
    Enabled: true,
    Origins: [
      { Name: 'origin-a', Address: '1.2.3.4', Weight: 100, Enabled: true, Type: 'ip_domain', IpVersionPolicy: 'round_robin' },
      { Name: 'origin-b', Address: 'origin.example.com', Weight: 50, Enabled: true, Type: 'ip_domain', IpVersionPolicy: 'round_robin' },
    ],
  },
  {
    Id: 102,
    Name: 'backup',
    Enabled: true,
    Origins: [{ Name: 'origin-c', Address: '5.6.7.8', Weight: 100, Enabled: true, Type: 'ip_domain', IpVersionPolicy: 'ipv4_first' }],
  },
];

const mockLoadBalancers: any[] = [
  {
    Id: 601,
    Name: 'lb.example.com',
    Enabled: true,
    Description: '主站负载均衡',
    DefaultPools: [101],
    FallbackPool: 102,
    SteeringPolicy: 'order',
    SessionAffinity: 'ip',
    Ttl: 30,
    AdaptiveRouting: { FailoverAcrossPools: true, OriginLevelRetry: false },
    Monitor: {
      Type: 'HTTP',
      Method: 'GET',
      Path: '/',
      Port: 80,
      Interval: 60,
      Timeout: 5,
      ExpectedCodes: '200',
      FollowRedirects: false,
      ConsecutiveUp: 3,
      ConsecutiveDown: 5,
      MonitoringRegion: 'Global',
    },
  },
];

const mockWaitingRooms: any[] = [
  {
    WaitingRoomId: 701,
    Name: 'checkout-queue',
    Enable: 'on',
    QueueAllEnable: 'off',
    HostNameAndPath: [{ Subdomain: '', Domain: 'shop.example.com', Path: '/checkout' }],
    CookieName: '__esa_waiting_room',
    TotalActiveUsers: '200',
    NewUsersPerMinute: '20',
    SessionDuration: '10',
    DisableSessionRenewalEnable: 'off',
    QueuingMethod: 'fifo',
    QueuingStatusCode: '429',
    JsonResponseEnable: 'on',
    WaitingRoomType: 'default',
    Language: 'zhcn',
    Description: '大促结算排队',
  },
];

const mockWaitingEvents: any[] = [
  {
    WaitingRoomEventId: 7101,
    WaitingRoomId: 701,
    Name: 'double-11',
    Enable: 'on',
    TotalActiveUsers: '500',
    NewUsersPerMinute: '50',
    SessionDuration: '15',
    StartTime: '2026-11-10T20:00:00Z',
    EndTime: '2026-11-11T02:00:00Z',
    QueuingMethod: 'fifo',
    QueuingStatusCode: '429',
    WaitingRoomType: 'default',
  },
];

const mockWaitingRules: any[] = [
  {
    WaitingRoomRuleId: 7201,
    WaitingRoomId: 701,
    RuleName: 'checkout-path',
    RuleEnable: 'on',
    Rule: '(http.request.uri.path starts_with "/checkout")',
  },
];

const mockL4Apps: any[] = [
  {
    ApplicationId: 801,
    RecordName: 'l4.example.com',
    RulesCount: 2,
    Status: 'online',
    Cname: 'l4.example.com.esa-cn.com',
    Rules: [
      { Protocol: 'TCP', EdgePort: '3306', SourceType: 'ip', Source: '10.0.0.8', SourcePort: '3306', ClientIPPassThroughMode: 'PPv2', Comment: 'MySQL' },
      { Protocol: 'UDP', EdgePort: '53', SourceType: 'domain', Source: 'dns.example.com', SourcePort: '53', ClientIPPassThroughMode: 'SPP', Comment: 'DNS' },
    ],
    IpAccessRule: 'on',
    Ipv6: 'off',
    CrossBorderOptimization: 'on',
    StaticIp: 'off',
    KeepAliveProtection: 'on',
  },
];

let mockRoutineRouteSeq = 100;
const mockRoutineRoutes: any[] = [
  {
    ConfigId: 1,
    RoutineName: 'demo-fn',
    RouteName: 'demo-route',
    RouteEnable: 'on',
    Rule: '(http.host eq "example.com")',
    Bypass: 'off',
    Sequence: 0,
    Fallback: 'on',
    Timeout: '30',
  },
];

let mockRoutineSeq = 1;
const mockUserRoutines: any[] = [
  { Name: 'demo-fn', Description: '演示边缘函数', HasAssets: false, ModifiedTime: '2026-10-20T08:00:00Z' },
];

const mockKvNamespaces: any[] = [
  { Namespace: 'demo-kv', Description: '演示命名空间', CreatedTime: '2026-10-01T10:00:00Z' },
];
const mockKvStore: Record<string, any[]> = {
  'demo-kv': [
    { Key: 'greeting', Value: 'hello esa', Expiration: '', ExpirationTtl: 3600 },
    { Key: 'feature-flag', Value: 'on', Expiration: '', ExpirationTtl: 0 },
  ],
};

let mockSliderSeq = 1;
const mockSliderPages: any[] = [
  { Id: 1, Name: 'default-slider', ForceLanguage: 'auto', SiteIds: ['1000000001'], Configs: {}, CustomContent: '' },
];

let mockListSeq = 1;
const mockGlobalLists: any[] = [
  {
    Id: 1,
    Name: 'trusted-ips',
    Kind: 'ip',
    Description: '可信来源 IP',
    Items: [
      { Value: '203.0.113.10', Description: '办公出口' },
      { Value: '198.51.100.20', Description: '监控节点' },
    ],
  },
];

let mockSceneSeq = 1;
const mockScenePolicies: any[] = [
  {
    PolicyId: 1,
    Name: 'double-11',
    Template: 'major_event',
    StartTime: '2026-11-10T20:00:00Z',
    EndTime: '2026-11-11T02:00:00Z',
    SiteIds: '1000000001',
    Status: 'enabled',
  },
];

let mockPageSeq = 1;
const mockCustomPages: any[] = [
  { Id: 1, Name: 'block-page', Description: '默认拦截页', ContentType: 'text/html', Content: '<html><body>Blocked</body></html>', SiteIds: ['1000000001'] },
];

let mockGlobalWafSeq = 1;
const mockGlobalWafRulesets: any[] = [
  {
    Id: 1,
    Name: 'global-baseline',
    Phase: 'http_custom',
    Status: 'on',
    Expression: '(http.host eq "demo-esa.com")',
    Description: '账户级基础防护',
    Shared: 'on',
    Rules: [{ Name: 'block-bad-bot', Action: 'deny', Expression: '(http.user_agent contains "badbot")' }],
  },
];

let mockDeliverySeq = 1;
const mockUserDeliveryTasks: any[] = [
  { TaskName: 'access-to-sls', BusinessType: 'dcdn_log_access_l1', DeliveryType: 'sls', FieldName: 'requests,bytes', Status: 'online', DiscardRate: 0, Details: {} },
];

const mockResourcePackages: any[] = [
  { PackageId: 'pkg-demo-1', PackageName: 'ESA 流量包', Total: '1000', Used: '120', Unit: 'GB', ExpireTime: '2027-10-01T00:00:00Z' },
];

let mockCacheTag = { TagName: 'edge-tag', CaseInsensitive: 'off' };
let mockDevMode = 'off';
let mockPerfCollection = 'off';

function mockEsaAction(action: string, params: Record<string, any>): any {
  const now = '2026-10-22 10:00:00';
  const records = [
    { RecordId: 1, RecordName: 'www', Type: 'CNAME', Data: { Value: 'origin.example.com' }, Ttl: 1, Proxied: true, Comment: '主站' },
    { RecordId: 2, RecordName: '@', Type: 'A', Data: { Value: '1.2.3.4' }, Ttl: 600, Proxied: true, Comment: '' },
  ];
  const wafRows = (phase: string) => mockWafStore.filter((r) => r.Phase === phase);
  switch (action) {
    case 'GetSite':
      return { SiteModel: { SiteName: '06162636.xyz', PlanName: 'Entrance', Status: 'active' } };
    case 'ListRecords':
      return { Records: records, TotalCount: records.length, PageNumber: 1, PageSize: 100 };
    case 'ListCertificates':
      return {
        Result: [{ Id: 'cert-1', Name: '06162636.xyz', Type: 'free', Status: 'active', NotAfter: '2027-01-01' }],
        TotalCount: 1,
      };
    case 'ListClientCertificates':
    case 'ListSiteOriginClientCertificates':
      return { Result: [], TotalCount: 0 };
    case 'GetCertificateQuota':
      return { Quota: 10, QuotaUsage: 1, Type: params.Type || 'free' };
    case 'ApplyCertificate':
      return { Result: [{ Domain: String(params.Domains || '').split(',')[0], Status: 'pending' }], TotalCount: 1 };
    case 'GetCnameFlattening':
      return { FlattenMode: 'flatten_at_root' };
    case 'GetTieredCache':
      return { CacheArchitectureMode: 'edge' };
    case 'GetCacheReserve':
      return { Enable: 'off', CacheReserveInstanceId: '' };
    case 'GetPurgeQuota':
      return { Quota: '1000', Usage: '12', Quota30Day: '30000', Usage30Day: '120' };
    case 'DescribePurgeTasks':
    case 'DescribePreloadTasks':
      return {
        Tasks: [{ TaskId: 'task-demo', Type: 'file', Status: 'Complete', Progress: 100, CreateTime: now }],
        TotalCount: 1,
      };
    case 'ListOriginPools':
      return { OriginPools: mockOriginPools, TotalCount: mockOriginPools.length, PageNumber: 1, PageSize: 100 };
    case 'GetOriginPool': {
      const row = mockOriginPools.find((p) => Number(p.Id) === Number(params.Id));
      return row ? { ...row, RequestId: 'mock-get-origin-pool' } : { RequestId: 'mock-get-origin-pool' };
    }
    case 'CreateOriginPool': {
      const row = {
        Id: ++mockPoolSeq,
        Name: params.Name,
        Enabled: params.Enabled !== false,
        Origins: Array.isArray(params.Origins) ? params.Origins : [],
      };
      mockOriginPools.push(row);
      return { Id: row.Id, RequestId: 'mock-create-origin-pool' };
    }
    case 'UpdateOriginPool': {
      const row = mockOriginPools.find((p) => Number(p.Id) === Number(params.Id));
      if (row) {
        if (params.Enabled !== undefined) row.Enabled = params.Enabled;
        if (Array.isArray(params.Origins)) row.Origins = params.Origins;
      }
      return { RequestId: 'mock-update-origin-pool' };
    }
    case 'DeleteOriginPool': {
      const i = mockOriginPools.findIndex((p) => Number(p.Id) === Number(params.Id));
      if (i >= 0) mockOriginPools.splice(i, 1);
      return { RequestId: 'mock-delete-origin-pool' };
    }
    case 'ListLoadBalancers':
      return { LoadBalancers: mockLoadBalancers, TotalCount: mockLoadBalancers.length, PageNumber: 1, PageSize: 100 };
    case 'GetLoadBalancer': {
      const row = mockLoadBalancers.find((l) => Number(l.Id) === Number(params.Id));
      return row ? { ...row, RequestId: 'mock-get-load-balancer' } : { RequestId: 'mock-get-load-balancer' };
    }
    case 'CreateLoadBalancer': {
      const row = { ...params, Id: ++mockLbSeq };
      mockLoadBalancers.push(row);
      return { Id: row.Id, RequestId: 'mock-create-load-balancer' };
    }
    case 'UpdateLoadBalancer': {
      const row = mockLoadBalancers.find((l) => Number(l.Id) === Number(params.Id));
      if (row) Object.assign(row, params);
      return { RequestId: 'mock-update-load-balancer' };
    }
    case 'DeleteLoadBalancer': {
      const i = mockLoadBalancers.findIndex((l) => Number(l.Id) === Number(params.Id));
      if (i >= 0) mockLoadBalancers.splice(i, 1);
      return { RequestId: 'mock-delete-load-balancer' };
    }
    case 'ListWafRules': {
      const phase = String(params.Phase || '');
      let rows = wafRows(phase);
      const like = params.QueryArgs?.NameLike || params.QueryArgs?.IdNameLike;
      if (like) rows = rows.filter((r) => String(r.Name || '').toLowerCase().includes(String(like).toLowerCase()));
      return {
        Rules: rows,
        TotalCount: rows.length,
        SiteUsage: rows.length,
        InstanceUsage: rows.length,
        PageNumber: Number(params.PageNumber || 1),
        PageSize: Number(params.PageSize || 20),
      };
    }
    case 'GetWafRule': {
      const row = mockWafStore.find((r) => Number(r.Id) === Number(params.Id));
      return row ? { ...row, RequestId: 'mock-get-waf-rule' } : { RequestId: 'mock-get-waf-rule' };
    }
    case 'CreateWafRule': {
      const phase = String(params.Phase || '');
      const row = mockWafAdd(phase, params.Config || {}, params.RulesetId);
      return { RequestId: 'mock-create-waf-rule', Id: row.Id, RulesetId: row.RulesetId };
    }
    case 'UpdateWafRule': {
      const row = mockWafStore.find((r) => Number(r.Id) === Number(params.Id));
      if (row) {
        if (params.Config && typeof params.Config === 'object') {
          row.Config = { ...(row.Config || {}), ...params.Config };
          if (params.Config.Name) row.Name = params.Config.Name;
        }
        if (params.Status) {
          row.Status = params.Status;
          row.Config = { ...(row.Config || {}), Status: params.Status };
        }
      }
      return { RequestId: 'mock-update-waf-rule' };
    }
    case 'DeleteWafRule': {
      const i = mockWafStore.findIndex((r) => Number(r.Id) === Number(params.Id));
      if (i >= 0) mockWafStore.splice(i, 1);
      return { RequestId: 'mock-delete-waf-rule' };
    }
    case 'ListWafRulesets': {
      const phase = String(params.Phase || 'http_custom');
      const id = ensureMockRuleset(phase);
      return { Rulesets: [{ Id: id, Name: `${phase}-ruleset`, Phase: phase }], TotalCount: 1, RequestId: 'mock-list-waf-rulesets' };
    }
    case 'CreateWafRuleset': {
      const phase = String(params.Phase || 'http_custom');
      const id = ensureMockRuleset(phase);
      return { Id: id, RulesetId: id, RequestId: 'mock-create-waf-ruleset' };
    }
    case 'ListWafManagedRules': {
      const type = Number(params.AttackType || 0);
      const total = mockManagedCounts[type] ?? 0;
      const rows = Array.from({ length: total }).map((_, i) => ({
        Id: 20000000 + type * 100 + i,
        Name: `managed-${type}-${i + 1}`,
        AttackType: type,
        Status: 'on',
        Action: 'deny',
      }));
      return { Rules: rows, TotalCount: total, PageNumber: 1, PageSize: Number(params.PageSize || 20) };
    }
    case 'BatchCreateWafRules': {
      const phase = String(params.Phase || 'http_anti_scan');
      const shared = params.Shared && typeof params.Shared === 'object' ? params.Shared : {};
      const configs = Array.isArray(params.Configs) ? params.Configs : [];
      const ids = configs.map((c: any) => mockWafAdd(phase, { ...shared, ...c }, params.RulesetId).Id);
      return { RequestId: 'mock-batch-create-waf-rules', Ids: ids };
    }
    case 'BatchUpdateWafRules': {
      return { RequestId: 'mock-batch-update-waf-rules' };
    }
    case 'ListWafTemplateRules':
      return {
        Rules: [
          { Id: 1, Name: '目录遍历扫描防护', Type: 'http_directory_traversal', Phase: 'http_anti_scan' },
          { Id: 2, Name: '常见扫描工具防护', Type: 'http_scan_tools', Phase: 'http_anti_scan' },
        ],
        RequestId: 'mock-list-waf-template-rules',
      };
    case 'ListWafPhases':
      return {
        Phases: ['http_custom', 'http_ratelimit', 'http_managed', 'http_anti_scan', 'http_whitelist', 'ip_access_rule', 'http_security_level_rule'].map(
          (p) => ({ Phase: p, RulesetId: ensureMockRuleset(p) }),
        ),
        RequestId: 'mock-list-waf-phases',
      };
    case 'GetWafQuota':
      return { Quota: { CustomRules: 50, RateLimitRules: 3, WhitelistRules: 3, IpAccessRules: 300, ManagedRules: 100 }, RequestId: 'mock-waf-quota' };
    case 'GetSiteWafSettings':
      return { Settings: { SecurityLevel: 'medium', BotProtection: true, ClientIpHeader: '' } };
    case 'GetWafBotAppKey':
      return { AppKey: 'demo-bot-appkey' };
    case 'ListBotInstances':
      return { Instances: [], TotalCount: 0 };
    case 'ListDDoSInstances':
      return { Instances: [], TotalCount: 0 };
    case 'DescribeHttpDDoSAttackProtection':
      return { Mode: 'normal', Level: 'default' };
    case 'ListCustomHostnames':
      return {
        Hostnames: [{ Id: 1, Hostname: 'saas.example.com', Status: 'active', RecordId: 1, SslFlag: 'on', CertType: 'free' }],
        TotalCount: 1,
      };
    case 'ListSiteDeliveryTasks':
      return { Tasks: [], TotalCount: 0 };
    case 'ListVersions':
      return { SiteVersionList: [{ Version: 0, Description: '生产版本', CreateTime: now }] };
    case 'ListUserRatePlanInstances':
      return { Instances: ESA_PLAN_INSTANCES, TotalCount: ESA_PLAN_INSTANCES.length, RequestId: 'mock-rate-plans' };
    case 'ListUserRoutines':
      return { Routines: mockUserRoutines, TotalCount: mockUserRoutines.length, RequestId: 'mock-list-routines' };
    case 'CreateRoutine': {
      const row = { Name: params.Name, Description: params.Description || '', HasAssets: params.HasAssets === true, ModifiedTime: now };
      mockUserRoutines.push(row);
      return { RequestId: 'mock-create-routine' };
    }
    case 'UpdateRoutineConfigDescription': {
      const row = mockUserRoutines.find((r) => r.Name === params.Name);
      if (row) row.Description = params.Description || '';
      return { RequestId: 'mock-update-routine' };
    }
    case 'DeleteRoutine': {
      const i = mockUserRoutines.findIndex((r) => r.Name === params.Name);
      if (i >= 0) mockUserRoutines.splice(i, 1);
      return { RequestId: 'mock-delete-routine' };
    }
    case 'GetKvAccount':
    case 'DescribeKvAccountStatus':
      return { Namespaces: mockKvNamespaces, Enabled: true, RequestId: 'mock-kv-account' };
    case 'CreateKvNamespace': {
      mockKvNamespaces.push({ Namespace: params.Namespace, Description: params.Description || '', CreatedTime: now });
      mockKvStore[params.Namespace] = mockKvStore[params.Namespace] || [];
      return { RequestId: 'mock-create-kv-namespace' };
    }
    case 'DeleteKvNamespace': {
      const i = mockKvNamespaces.findIndex((n) => n.Namespace === params.Namespace);
      if (i >= 0) mockKvNamespaces.splice(i, 1);
      delete mockKvStore[params.Namespace];
      return { RequestId: 'mock-delete-kv-namespace' };
    }
    case 'ListKvs':
      return { Kvs: mockKvStore[params.Namespace] || [], TotalCount: (mockKvStore[params.Namespace] || []).length, RequestId: 'mock-list-kvs' };
    case 'PutKv': {
      const list = (mockKvStore[params.Namespace] = mockKvStore[params.Namespace] || []);
      const row = list.find((k) => k.Key === params.Key);
      const value = { Key: params.Key, Value: params.Value, ExpirationTtl: params.ExpirationTtl || 0 };
      if (row) Object.assign(row, value);
      else list.push(value);
      return { RequestId: 'mock-put-kv' };
    }
    case 'DeleteKv': {
      const list = mockKvStore[params.Namespace] || [];
      const i = list.findIndex((k) => k.Key === params.Key);
      if (i >= 0) list.splice(i, 1);
      return { RequestId: 'mock-delete-kv' };
    }
    case 'ListSliderCaptchaPages':
      return { Pages: mockSliderPages, TotalCount: mockSliderPages.length, RequestId: 'mock-list-slider-pages' };
    case 'CreateSliderCaptchaPage': {
      const row = { ...params, Id: ++mockSliderSeq };
      mockSliderPages.push(row);
      return { Id: row.Id, RequestId: 'mock-create-slider-page' };
    }
    case 'UpdateSliderCaptchaPage': {
      const row = mockSliderPages.find((p) => Number(p.Id) === Number(params.Id));
      if (row) Object.assign(row, params);
      return { RequestId: 'mock-update-slider-page' };
    }
    case 'DeleteSliderCaptchaPage': {
      const i = mockSliderPages.findIndex((p) => Number(p.Id) === Number(params.Id));
      if (i >= 0) mockSliderPages.splice(i, 1);
      return { RequestId: 'mock-delete-slider-page' };
    }
    case 'ListLists':
      return { Lists: mockGlobalLists, TotalCount: mockGlobalLists.length, RequestId: 'mock-list-lists' };
    case 'CreateList': {
      const row = { ...params, Id: ++mockListSeq };
      mockGlobalLists.push(row);
      return { Id: row.Id, RequestId: 'mock-create-list' };
    }
    case 'UpdateList': {
      const row = mockGlobalLists.find((l) => Number(l.Id) === Number(params.Id));
      if (row) Object.assign(row, params);
      return { RequestId: 'mock-update-list' };
    }
    case 'DeleteList': {
      const i = mockGlobalLists.findIndex((l) => Number(l.Id) === Number(params.Id));
      if (i >= 0) mockGlobalLists.splice(i, 1);
      return { RequestId: 'mock-delete-list' };
    }
    case 'ListUserWafRulesets':
      return { Rulesets: mockGlobalWafRulesets, TotalCount: mockGlobalWafRulesets.length, RequestId: 'mock-list-global-waf' };
    case 'CreateUserWafRuleset': {
      const row = { ...params, Id: ++mockGlobalWafSeq };
      mockGlobalWafRulesets.push(row);
      return { Id: row.Id, RequestId: 'mock-create-global-waf' };
    }
    case 'UpdateUserWafRuleset': {
      const row = mockGlobalWafRulesets.find((r) => Number(r.Id) === Number(params.Id));
      if (row) Object.assign(row, params);
      return { RequestId: 'mock-update-global-waf' };
    }
    case 'DeleteUserWafRuleset': {
      const i = mockGlobalWafRulesets.findIndex((r) => Number(r.Id) === Number(params.Id));
      if (i >= 0) mockGlobalWafRulesets.splice(i, 1);
      return { RequestId: 'mock-delete-global-waf' };
    }
    case 'DescribeCustomScenePolicies':
      return { Policies: mockScenePolicies, TotalCount: mockScenePolicies.length, RequestId: 'mock-list-scene-policies' };
    case 'CreateCustomScenePolicy': {
      const row = { ...params, PolicyId: ++mockSceneSeq, Status: 'enabled' };
      mockScenePolicies.push(row);
      return { PolicyId: row.PolicyId, RequestId: 'mock-create-scene-policy' };
    }
    case 'UpdateCustomScenePolicy': {
      const row = mockScenePolicies.find((p) => Number(p.PolicyId) === Number(params.PolicyId));
      if (row) Object.assign(row, params);
      return { RequestId: 'mock-update-scene-policy' };
    }
    case 'DeleteCustomScenePolicy': {
      const i = mockScenePolicies.findIndex((p) => Number(p.PolicyId) === Number(params.PolicyId));
      if (i >= 0) mockScenePolicies.splice(i, 1);
      return { RequestId: 'mock-delete-scene-policy' };
    }
    case 'EnableCustomScenePolicy':
    case 'DisableCustomScenePolicy': {
      const row = mockScenePolicies.find((p) => Number(p.PolicyId) === Number(params.PolicyId));
      if (row) row.Status = action === 'EnableCustomScenePolicy' ? 'enabled' : 'disabled';
      return { RequestId: 'mock-toggle-scene-policy' };
    }
    case 'ListPages':
      return { Pages: mockCustomPages, TotalCount: mockCustomPages.length, RequestId: 'mock-list-pages' };
    case 'CreatePage': {
      const row = { ...params, Id: ++mockPageSeq };
      mockCustomPages.push(row);
      return { Id: row.Id, RequestId: 'mock-create-page' };
    }
    case 'UpdatePage': {
      const row = mockCustomPages.find((p) => Number(p.Id) === Number(params.Id));
      if (row) Object.assign(row, params);
      return { RequestId: 'mock-update-page' };
    }
    case 'DeletePage': {
      const i = mockCustomPages.findIndex((p) => Number(p.Id) === Number(params.Id));
      if (i >= 0) mockCustomPages.splice(i, 1);
      return { RequestId: 'mock-delete-page' };
    }
    case 'ListUserDeliveryTasks':
      return { Tasks: mockUserDeliveryTasks, TotalCount: mockUserDeliveryTasks.length, RequestId: 'mock-list-user-delivery' };
    case 'CreateUserDeliveryTask': {
      const row = { ...params, Status: 'online' };
      mockUserDeliveryTasks.push(row);
      return { RequestId: 'mock-create-user-delivery' };
    }
    case 'UpdateUserDeliveryTask': {
      const row = mockUserDeliveryTasks.find((t) => t.TaskName === params.TaskName);
      if (row) Object.assign(row, params);
      return { RequestId: 'mock-update-user-delivery' };
    }
    case 'DeleteUserDeliveryTask': {
      const i = mockUserDeliveryTasks.findIndex((t) => t.TaskName === params.TaskName);
      if (i >= 0) mockUserDeliveryTasks.splice(i, 1);
      return { RequestId: 'mock-delete-user-delivery' };
    }
    case 'UpdateUserDeliveryTaskStatus': {
      const row = mockUserDeliveryTasks.find((t) => t.TaskName === params.TaskName);
      if (row) row.Status = params.Method === 'off' ? 'offline' : 'online';
      return { RequestId: 'mock-update-user-delivery-status' };
    }
    case 'DescribeUserResourcePackage':
      return { Packages: mockResourcePackages, TotalCount: mockResourcePackages.length, RequestId: 'mock-resource-packages' };
    case 'ListESAIPInfo':
      return { IPInfo: [{ IP: String(params.VipInfo || '').split(',')[0], IsEsa: true }], RequestId: 'mock-esa-ip-info' };
    case 'ListRoutineRoutes':
      return {
        Configs: mockRoutineRoutes.filter((r) => !params.RoutineName || r.RoutineName === params.RoutineName),
        TotalCount: mockRoutineRoutes.length,
      };
    case 'CreateRoutineRoute': {
      const row = { ...params, ConfigId: ++mockRoutineRouteSeq };
      mockRoutineRoutes.push(row);
      return { ConfigId: row.ConfigId, RequestId: 'mock-create-routine-route' };
    }
    case 'UpdateRoutineRoute': {
      const row = mockRoutineRoutes.find((r) => Number(r.ConfigId) === Number(params.ConfigId));
      if (row) Object.assign(row, params);
      return { RequestId: 'mock-update-routine-route' };
    }
    case 'DeleteRoutineRoute': {
      const i = mockRoutineRoutes.findIndex((r) => Number(r.ConfigId) === Number(params.ConfigId));
      if (i >= 0) mockRoutineRoutes.splice(i, 1);
      return { RequestId: 'mock-delete-routine-route' };
    }
    case 'ListCompressionRules':
      return {
        Configs: [{ ConfigId: 1, RuleName: 'default-compress', Gzip: 'on', Brotli: 'on', Zstd: 'off', RuleEnable: 'on', Sequence: 0 }],
        TotalCount: 1,
      };
    case 'ListNetworkOptimizations':
      return {
        Configs: [
          {
            ConfigId: 1,
            RuleName: 'default-network',
            SmartRouting: 'off',
            Http2Origin: 'on',
            Websocket: 'on',
            Grpc: 'off',
            UploadMaxFilesize: '100',
            RuleEnable: 'on',
          },
        ],
        TotalCount: 1,
      };
    case 'ListWaitingRooms':
      return { WaitingRooms: mockWaitingRooms, TotalCount: mockWaitingRooms.length };
    case 'CreateWaitingRoom': {
      const row = { ...params, WaitingRoomId: ++mockWaitingSeq };
      mockWaitingRooms.push(row);
      return { WaitingRoomId: row.WaitingRoomId, RequestId: 'mock-create-waiting-room' };
    }
    case 'UpdateWaitingRoom': {
      const row = mockWaitingRooms.find((r) => Number(r.WaitingRoomId) === Number(params.WaitingRoomId));
      if (row) Object.assign(row, params);
      return { RequestId: 'mock-update-waiting-room' };
    }
    case 'DeleteWaitingRoom': {
      const i = mockWaitingRooms.findIndex((r) => Number(r.WaitingRoomId) === Number(params.WaitingRoomId));
      if (i >= 0) mockWaitingRooms.splice(i, 1);
      return { RequestId: 'mock-delete-waiting-room' };
    }
    case 'ListWaitingRoomEvents':
      return {
        WaitingRoomEvents: mockWaitingEvents.filter((r) => Number(r.WaitingRoomId) === Number(params.WaitingRoomId)),
        TotalCount: mockWaitingEvents.length,
      };
    case 'CreateWaitingRoomEvent': {
      const row = { ...params, WaitingRoomEventId: ++mockWaitingEventSeq };
      mockWaitingEvents.push(row);
      return { WaitingRoomEventId: row.WaitingRoomEventId, RequestId: 'mock-create-waiting-room-event' };
    }
    case 'DeleteWaitingRoomEvent': {
      const i = mockWaitingEvents.findIndex((r) => Number(r.WaitingRoomEventId) === Number(params.WaitingRoomEventId));
      if (i >= 0) mockWaitingEvents.splice(i, 1);
      return { RequestId: 'mock-delete-waiting-room-event' };
    }
    case 'ListWaitingRoomRules':
      return {
        WaitingRoomRules: mockWaitingRules.filter((r) => Number(r.WaitingRoomId) === Number(params.WaitingRoomId)),
        TotalCount: mockWaitingRules.length,
      };
    case 'CreateWaitingRoomRule': {
      const row = { ...params, WaitingRoomRuleId: ++mockWaitingRuleSeq };
      mockWaitingRules.push(row);
      return { WaitingRoomRuleId: row.WaitingRoomRuleId, RequestId: 'mock-create-waiting-room-rule' };
    }
    case 'DeleteWaitingRoomRule': {
      const i = mockWaitingRules.findIndex((r) => Number(r.WaitingRoomRuleId) === Number(params.WaitingRoomRuleId));
      if (i >= 0) mockWaitingRules.splice(i, 1);
      return { RequestId: 'mock-delete-waiting-room-rule' };
    }
    case 'ListTransportLayerApplications':
      return { Applications: mockL4Apps, TotalCount: mockL4Apps.length, PageNumber: 1, PageSize: 100 };
    case 'GetTransportLayerApplication': {
      const row = mockL4Apps.find((a) => Number(a.ApplicationId) === Number(params.ApplicationId));
      return row ? { ...row, Rules: (row.Rules || []).map((r: any) => ({ ...r })), RequestId: 'mock-get-l4-app' } : { RequestId: 'mock-get-l4-app' };
    }
    case 'CreateTransportLayerApplication': {
      const row = {
        ...params,
        ApplicationId: ++mockL4Seq,
        RulesCount: Array.isArray(params.Rules) ? params.Rules.length : 0,
        Status: 'online',
        Cname: `${params.RecordName || 'l4'}.esa-cn.com`,
      };
      mockL4Apps.push(row);
      return { ApplicationId: row.ApplicationId, RequestId: 'mock-create-l4-app' };
    }
    case 'UpdateTransportLayerApplication': {
      const row = mockL4Apps.find((a) => Number(a.ApplicationId) === Number(params.ApplicationId));
      if (row) {
        Object.assign(row, params);
        row.RulesCount = Array.isArray(row.Rules) ? row.Rules.length : 0;
      }
      return { RequestId: 'mock-update-l4-app' };
    }
    case 'DeleteTransportLayerApplication': {
      const i = mockL4Apps.findIndex((a) => Number(a.ApplicationId) === Number(params.ApplicationId));
      if (i >= 0) mockL4Apps.splice(i, 1);
      return { RequestId: 'mock-delete-l4-app' };
    }
    case 'GetCacheTag':
      return { ...mockCacheTag, SiteVersion: 0, RequestId: 'mock-get-cache-tag' };
    case 'UpdateCacheTag':
      mockCacheTag = { TagName: params.TagName || '', CaseInsensitive: params.CaseInsensitive || 'off' };
      return { RequestId: 'mock-update-cache-tag' };
    case 'GetDevelopmentMode':
      return { Enable: mockDevMode, RequestId: 'mock-get-dev-mode' };
    case 'UpdateDevelopmentMode':
      mockDevMode = params.Enable || 'off';
      return { RequestId: 'mock-update-dev-mode' };
    case 'GetPerformanceDataCollection':
      return { Enable: mockPerfCollection, RequestId: 'mock-get-perf' };
    case 'UpdatePerformanceDataCollection':
      mockPerfCollection = params.Enable || 'off';
      return { RequestId: 'mock-update-perf' };
    case 'ListInstanceQuotasWithUsage': {
      const quotas = [
        { QuotaName: 'customHttpCert', QuotaValue: '10', Usage: '2' },
        { QuotaName: 'waiting_room', QuotaValue: '2', Usage: '1' },
        { QuotaName: 'https|rule_quota', QuotaValue: '50', Usage: '8' },
        { QuotaName: 'cache_rules|rule_quota', QuotaValue: '100', Usage: '24' },
        { QuotaName: 'configuration_rules|rule_quota', QuotaValue: '200', Usage: '36' },
        { QuotaName: 'redirect_rules|rule_quota', QuotaValue: '50', Usage: '4' },
        { QuotaName: 'compression_rules|rule_quota', QuotaValue: '20', Usage: '2' },
        { QuotaName: 'origin_rules|rule_quota', QuotaValue: '50', Usage: '6' },
        { QuotaName: 'transition_rule', QuotaValue: '20', Usage: '0' },
      ];
      return { Quotas: quotas, Status: 'online', RequestId: 'mock-quota-usage' };
    }
    case 'DescribeSiteTimeSeriesData':
    case 'DescribeSiteWafTimeSeriesData':
      return {
        Data: [],
        SummarizedData: [{ Field: 'requests', Value: 12345 }],
        StartTime: params.StartTime,
        EndTime: params.EndTime,
        Interval: Number(params.Interval || 3600),
      };
    case 'DescribeSiteTopData':
    case 'DescribeSiteWafTopData':
      return { Data: [{ Name: 'example.com', Value: 1000 }], StartTime: params.StartTime, EndTime: params.EndTime };
    case 'TraceSite':
      return { RequestId: 'trace-demo', Url: params.Url, MatchedRules: [{ RuleName: 'demo-route' }], CacheStatus: 'HIT' };
    case 'PurgeCaches':
    case 'PreloadCaches':
      return { TaskId: 'task-demo' };
    default:
      return { RequestId: 'demo-request', Result: 'ok' };
  }
}

export function installMock() {
  if (import.meta.env.VITE_MOCK !== 'true') return;

  const orig = window.fetch.bind(window);
  window.fetch = async (input: any, init?: any): Promise<Response> => {
    const url: string = typeof input === 'string' ? input : input?.url;
    if (typeof url !== 'string' || !url.includes('/api/')) return orig(input, init);

    const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
    const path = url.slice(url.indexOf('/api')).split('?')[0];
    const q = new URLSearchParams(url.split('?')[1] || '');
    const aid = Number(q.get('aid') || 0);
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
        const did = Number(recMatch[1]);
        const list = RECORDS.filter((r) => r.did === did);
        return json({ list, total: list.length, _access: { admin: true, readonly: false, writable: true } });
      }
      const weightMatch = path.match(/^\/api\/domains\/(\d+)\/weight$/);
      if (weightMatch) {
        const did = Number(weightMatch[1]);
        const pool = did === 105 ? WEIGHT_ROWS : [];
        return json({ list: pool, total: pool.length });
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
      // 仪表盘计数跟随注入的数据规模，避免首页显示 0 而列表里有 15 条
      if (path === '/api/dashboard/summary') {
        return json({
          domains: DOMAINS.length,
          accounts: DNS_ACCOUNTS.length,
          cdnDomains: CDN_DOMAINS.length,
        });
      }

      // ---- 阿里云 ESA 演示站点（静态预览专用假数据）----
      if (path === '/api/cdn/providers') return json(CDN_PROVIDERS);
      if (path === '/api/cdn/zones') {
        if (!aid || aid === 5) {
          return json([
            { ...ESA_SITE, aid: 5, typename: '阿里云 ESA', accountName: '阿里云 ESA 演示账户' },
            {
              ...ESA_SITE,
              zone_id: '1000000009',
              zone_name: 'backup-esa.com',
              status: 'pending',
              paused: true,
              domain_count: 1,
              planName: 'ESA 基础版',
              ownershipVerified: false,
              nameServers: [],
              aid: 5,
              typename: '阿里云 ESA',
              accountName: '阿里云 ESA 演示账户',
            },
          ]);
        }
        if (aid === 6) {
          return json([{ ...EO_SITE, aid: 6, typename: '腾讯云 EdgeOne', accountName: '腾讯云 EdgeOne 演示账户' }]);
        }
        return json([]);
      }
      if (path === '/api/cdn/zones/setting') {
        if (aid === 6) return json(EO_ZONE_SETTING);
        return new Response(JSON.stringify({ code: -1, msg: 'ESA 全局配置请使用规则引擎' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path === '/api/cdn/accounts/6/zones') {
        return json([{ zoneId: EO_SITE.zone_id, zoneName: EO_SITE.zone_name, status: EO_SITE.status, type: EO_SITE.type }]);
      }
      if (path === '/api/cdn/accounts/6/rule-schema') return json({ vendor: 'eo' });
      if (path === '/api/cdn/accounts/6/rules') return json([]);
      if (path === '/api/cdn/accounts/6/origin-groups') return json(EO_ORIGIN_GROUPS);
      if (path === '/api/cdn/accounts/6/load-balancers') return json(EO_LOAD_BALANCERS);
      if (path === '/api/cdn/accounts/5/plan-instances') return json(ESA_PLAN_INSTANCES);
      {
        const propsMatch = path.match(/^\/api\/cdn\/accounts\/5\/sites\/([^/]+)\/properties$/);
        if (propsMatch) return json({ ...ESA_SITE_PROPS, zoneId: propsMatch[1], SiteId: propsMatch[1] });
        const nsMatch = path.match(/^\/api\/cdn\/accounts\/5\/sites\/([^/]+)\/ns$/);
        if (nsMatch) return json(ESA_SITE.nameServers);
      }
      if (path === '/api/cdn/accounts/5/esa/catalog') return json(ESA_CATALOG);
      if (path === '/api/cdn/accounts/5/rule-schema') {
        const kind = String(q.get('kind') || '');
        if (!kind) return json({ vendor: 'esa', kinds: ESA_RULE_SCHEMA });
        return json({ vendor: 'esa', kind, fields: ESA_RULE_SCHEMA.find((k) => k.kind === kind)?.fields || [] });
      }
      if (path === '/api/cdn/accounts/5/rule-configs') {
        const kind = String(q.get('kind') || 'RedirectRule');
        const list = (ESA_RULE_CONFIGS as any)[kind] || [];
        return json({ total: list.length, list });
      }
      if (path === '/api/cdn/accounts/5/origin-groups') return json({ total: 0, list: [] });
      if (path === '/api/cdn/accounts/5/load-balancers') return json({ total: 0, list: [] });
      if (path === '/api/cdn/accounts/5/security/ip-groups') return json([]);
      if (path === '/api/cdn/accounts/5/security/ddos') return json({ Protection: true, Level: 'normal' });
      if (path === '/api/cdn/accounts/5/security/waf') return json({ phases: [] });
      if (path === '/api/cdn/accounts/5/security/origin-protection') return json({ Enabled: true });
      if (path === '/api/cdn/accounts/5/l4-proxies') return json({ total: 0, list: [] });
      if (path === '/api/cdn/accounts/5/tasks/purge') return json({ total: 0, list: [] });
      if (path === '/api/cdn/accounts/5/tasks/prefetch') return json({ total: 0, list: [] });
      if (path === '/api/cdn/accounts/5/quota/purge') return json({ Quota: 1000, Used: 12 });
      if (path === '/api/cdn/accounts/5/analysis/top') return json([]);
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
      if (path === '/api/cdn/domains') {
        if (aid === 5) return json(ESA_DOMAINS);
        if (aid === 6) return json(EO_DOMAINS);
        return json(CDN_DOMAINS);
      }
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
      if (path === '/api/audit/logs') return json({ list: USER_LOGS, total: USER_LOGS.length, truncated: false });
      if (path === '/api/audit/stats') return json({ total: USER_LOGS.length, today: 5, failed7d: 2, users30d: 3 });
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
    if (path === '/api/cdn/accounts/5/sites/check') return json({ passed: true });
    if (path === '/api/cdn/accounts/5/sites') return json({ zoneId: '1000000002', zoneName: 'new-demo-esa.com' });
    if (path === '/api/cdn/accounts/5/esa/actions') {
      let body: any = {};
      try {
        body = init?.body ? JSON.parse(String(init.body)) : {};
      } catch {
        body = {};
      }
      return json(mockEsaAction(String(body.action || ''), body.params || {}));
    }

    // 写操作统一返回成功空对象（预览不可真正修改）
    return json({});
  };
}
