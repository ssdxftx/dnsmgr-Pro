// 阿里云 ESA 官方控制台规则元数据（前端可视化用）。
// 来源：官方控制台 Rules / WAF 页面逐项核对（2026-10）。
// 说明：value 为提交给 ESA 的表达式字段/运算符；label/desc 为控制台可见文案的中英对照。
// 该文件只描述「能选什么、每个选项是什么意思」，具体提交字段仍以 ruleSchema.ts 的官方 API 字段为准。

export type EsaLocale = 'zh' | 'en';
export type EsaPlanGate = 'free' | 'pro' | 'premium' | 'enterprise' | 'unsupported';

export interface EsaBilingual {
  zh: string;
  en: string;
}

export interface EsaMatchField {
  /** 表达式字段名（提交给 ESA） */
  value: string;
  label: EsaBilingual;
  desc: EsaBilingual;
  /** 套餐门槛：free 表示当前 Entrance 可用 */
  gate: EsaPlanGate;
  /** 是否需要额外参数名（Header / Cookie / 查询参数） */
  needName?: boolean;
  /** 值输入形态提示 */
  valueKind?: 'text' | 'ip' | 'country' | 'number' | 'regex' | 'bool';
}

export interface EsaOperator {
  value: string;
  label: EsaBilingual;
  desc: EsaBilingual;
  gate: EsaPlanGate;
}

/** 官方控制台「If requests match」可选的匹配字段（Security / WAF 全集，36 项） */
export const ESA_MATCH_FIELDS: EsaMatchField[] = [
  { value: 'http.host', label: { zh: '主机名', en: 'Hostname' }, desc: { zh: '匹配请求访问的域名（Host）。', en: 'Match the requested hostname.' }, gate: 'free' },
  { value: 'ip.src', label: { zh: '客户端 IP', en: 'Client IP' }, desc: { zh: '匹配发起请求的客户端 IP 地址，支持 IPv4 / IPv6。', en: 'Match the client IP address (IPv4 or IPv6).' }, gate: 'free', valueKind: 'ip' },
  { value: 'http.request.headers', label: { zh: '请求头', en: 'Header' }, desc: { zh: '按指定请求头的值匹配。', en: 'Match the value of a request header.' }, gate: 'premium', needName: true },
  { value: 'http.x_forwarded_for', label: { zh: 'X-Forwarded-For', en: 'X-Forwarded-For' }, desc: { zh: '匹配 X-Forwarded-For 请求头中的客户端 IP。', en: 'Match the client IP in X-Forwarded-For.' }, gate: 'premium', valueKind: 'ip' },
  { value: 'http.user_agent', label: { zh: 'User-Agent', en: 'User Agent' }, desc: { zh: '匹配请求的 User-Agent。', en: 'Match the request User-Agent.' }, gate: 'free' },
  { value: 'http.referer', label: { zh: 'Referer', en: 'Referer' }, desc: { zh: '匹配请求的来源页面（Referer）。', en: 'Match the request Referer.' }, gate: 'free' },
  { value: 'http.request.uri', label: { zh: 'URI', en: 'URI' }, desc: { zh: '匹配请求的 URI（不含域名）。', en: 'Match the request URI.' }, gate: 'free' },
  { value: 'http.request.full_uri', label: { zh: '完整 URI', en: 'URI Full' }, desc: { zh: '匹配包含协议与域名的完整 URI。', en: 'Match the full URI including scheme and host.' }, gate: 'enterprise' },
  { value: 'http.request.uri.path', label: { zh: 'URI 路径', en: 'URI Path' }, desc: { zh: '匹配 URI 的路径部分。', en: 'Match the URI path.' }, gate: 'pro' },
  { value: 'http.request.uri.query', label: { zh: 'URI 查询字符串', en: 'URI Query String' }, desc: { zh: '匹配 URI 的查询字符串。', en: 'Match the URI query string.' }, gate: 'pro' },
  { value: 'http.request.uri.args', label: { zh: 'URI 查询参数', en: 'URI Query String Parameter' }, desc: { zh: '按指定查询参数的值匹配。', en: 'Match the value of a query string parameter.' }, gate: 'pro', needName: true },
  { value: 'ip.geoip.continent', label: { zh: '大洲', en: 'Continent' }, desc: { zh: '按客户端 IP 所属大洲匹配。', en: 'Match the continent of the client IP.' }, gate: 'premium' },
  { value: 'ip.geoip.country', label: { zh: '国家/地区', en: 'Country/Region' }, desc: { zh: '按客户端 IP 所属国家/地区匹配（ISO 两位代码）。', en: 'Match the country/region of the client IP.' }, gate: 'free', valueKind: 'country' },
  { value: 'ip.geoip.subdivision_1_iso_code', label: { zh: '省/州', en: 'Subdivision' }, desc: { zh: '按客户端 IP 所属省/州匹配。', en: 'Match the subdivision of the client IP.' }, gate: 'free' },
  { value: 'http.request.uri.path', label: { zh: '完整文件名', en: 'Full File Name' }, desc: { zh: '按完整文件名匹配路径末段。', en: 'Match the full file name in the path.' }, gate: 'free' },
  { value: 'http.request.uri.path.extension', label: { zh: '文件扩展名', en: 'File Extension' }, desc: { zh: '按文件扩展名匹配（不含点）。', en: 'Match the file extension.' }, gate: 'free' },
  { value: 'http.cookie', label: { zh: 'Cookie', en: 'Cookie' }, desc: { zh: '按 Cookie 值匹配。', en: 'Match a cookie value.' }, gate: 'premium', needName: true },
  { value: 'http.cookie', label: { zh: '指定 Cookie 值', en: 'Cookie Value Of' }, desc: { zh: '按指定名称的 Cookie 值匹配。', en: 'Match the value of a named cookie.' }, gate: 'premium', needName: true },
  { value: 'http.tls_fingerprint', label: { zh: 'TLS 指纹', en: 'TLS Fingerprint' }, desc: { zh: '匹配客户端 TLS 指纹。', en: 'Match the client TLS fingerprint.' }, gate: 'enterprise' },
  { value: 'ip.geoip.asnum', label: { zh: 'ASN', en: 'ASN' }, desc: { zh: '按客户端 IP 所属自治系统号匹配。', en: 'Match the client ASN.' }, gate: 'free', valueKind: 'number' },
  { value: 'ip.geoip.isp', label: { zh: 'ISP', en: 'ISP' }, desc: { zh: '按客户端 IP 所属运营商匹配。', en: 'Match the client ISP.' }, gate: 'free' },
  { value: 'http.request.body', label: { zh: 'HTTP 请求体', en: 'HTTP Request Body' }, desc: { zh: '匹配 HTTP 请求体内容。', en: 'Match the HTTP request body.' }, gate: 'enterprise' },
  { value: 'http.request.body.args', label: { zh: '请求体查询字符串', en: 'Body Query String' }, desc: { zh: '匹配请求体中的表单参数。', en: 'Match form arguments in the request body.' }, gate: 'enterprise', needName: true },
  { value: 'http.client_certificate.verified', label: { zh: '客户端证书已验证', en: 'Client Certificate Verified' }, desc: { zh: '匹配客户端证书是否通过校验。', en: 'Match whether the client certificate is verified.' }, gate: 'free', valueKind: 'bool' },
  { value: 'http.ssl', label: { zh: 'SSL/HTTPS', en: 'SSL/HTTPS' }, desc: { zh: '匹配请求是否通过 HTTPS。', en: 'Match whether the request uses HTTPS.' }, gate: 'premium', valueKind: 'bool' },
  { value: 'http.request.version', label: { zh: 'HTTP 版本', en: 'HTTP Version' }, desc: { zh: '匹配 HTTP 协议版本。', en: 'Match the HTTP protocol version.' }, gate: 'premium' },
  { value: 'ip.version', label: { zh: 'IP 协议版本', en: 'IP Protocol Version' }, desc: { zh: '匹配客户端 IP 是 IPv4 还是 IPv6。', en: 'Match IPv4 or IPv6.' }, gate: 'free', valueKind: 'number' },
  { value: 'http.js_verified', label: { zh: 'JavaScript 已验证', en: 'JavaScript Verified' }, desc: { zh: '匹配客户端是否通过 JavaScript 校验。', en: 'Match whether the client passed JavaScript verification.' }, gate: 'enterprise', valueKind: 'bool' },
  { value: 'http.response.content_type', label: { zh: 'MIME 类型', en: 'MIME Type' }, desc: { zh: '按响应 MIME 类型匹配。', en: 'Match the response MIME type.' }, gate: 'premium' },
  { value: 'http.request.method', label: { zh: '请求方法', en: 'Request Method' }, desc: { zh: '匹配 GET / POST 等请求方法。', en: 'Match the request method.' }, gate: 'premium' },
  { value: 'http.request.serves_static', label: { zh: '是否静态资源', en: 'Serves Static Resources' }, desc: { zh: '匹配请求是否指向静态资源。', en: 'Match whether the request targets a static resource.' }, gate: 'enterprise', valueKind: 'bool' },
  { value: 'http.request.timestamp', label: { zh: '请求时间戳', en: 'Request Timestamp' }, desc: { zh: '按请求时间戳匹配。', en: 'Match the request timestamp.' }, gate: 'free', valueKind: 'number' },
  { value: 'http.ja3_fingerprint', label: { zh: 'JA3 指纹', en: 'JA3 Fingerprint' }, desc: { zh: '匹配客户端 JA3 TLS 指纹。', en: 'Match the client JA3 fingerprint.' }, gate: 'enterprise' },
  { value: 'http.ja4_fingerprint', label: { zh: 'JA4 指纹', en: 'JA4 Fingerprint' }, desc: { zh: '匹配客户端 JA4 TLS 指纹。', en: 'Match the client JA4 fingerprint.' }, gate: 'enterprise' },
  { value: 'http.request.headers.order', label: { zh: '请求头顺序', en: 'Header Order' }, desc: { zh: '官方暂不支持该匹配项。', en: 'Not supported by the official console.' }, gate: 'unsupported' },
];

/** 官方控制台可选的运算符（17 项） */
export const ESA_OPERATORS: EsaOperator[] = [
  { value: 'in', label: { zh: '属于（is in）', en: 'is in' }, desc: { zh: '字段值等于列表中的任意一个。', en: 'Field value is one of the listed values.' }, gate: 'free' },
  { value: 'not_in', label: { zh: '不属于（is not in）', en: 'is not in' }, desc: { zh: '字段值不等于列表中的任意一个。', en: 'Field value is none of the listed values.' }, gate: 'free' },
  { value: 'eq', label: { zh: '等于（equals）', en: 'equals' }, desc: { zh: '字段值与给定值完全相等。', en: 'Field value equals the given value.' }, gate: 'free' },
  { value: 'ne', label: { zh: '不等于（does not equal）', en: 'does not equal' }, desc: { zh: '字段值与给定值不相等。', en: 'Field value does not equal the given value.' }, gate: 'free' },
  { value: 'contains', label: { zh: '包含（contains）', en: 'contains' }, desc: { zh: '字段值包含给定子串。', en: 'Field value contains the given substring.' }, gate: 'free' },
  { value: 'not_contains', label: { zh: '不包含（does not contain）', en: 'does not contain' }, desc: { zh: '字段值不包含给定子串。', en: 'Field value does not contain the given substring.' }, gate: 'free' },
  { value: 'starts_with', label: { zh: '开头是（starts with）', en: 'starts with' }, desc: { zh: '字段值以给定内容开头。', en: 'Field value starts with the given text.' }, gate: 'free' },
  { value: 'not_starts_with', label: { zh: '开头不是（does not start with）', en: 'does not start with' }, desc: { zh: '字段值不以给定内容开头。', en: 'Field value does not start with the given text.' }, gate: 'free' },
  { value: 'ends_with', label: { zh: '结尾是（ends with）', en: 'ends with' }, desc: { zh: '字段值以给定内容结尾。', en: 'Field value ends with the given text.' }, gate: 'free' },
  { value: 'not_ends_with', label: { zh: '结尾不是（does not end with）', en: 'does not end with' }, desc: { zh: '字段值不以给定内容结尾。', en: 'Field value does not end with the given text.' }, gate: 'free' },
  { value: 'matches', label: { zh: '匹配正则（matches regex）', en: 'matches regex' }, desc: { zh: '字段值匹配正则表达式（Premium）。', en: 'Field value matches a regular expression (Premium).' }, gate: 'premium' },
  { value: 'not_matches', label: { zh: '不匹配正则（does not match regex）', en: 'does not match regex' }, desc: { zh: '字段值不匹配正则表达式（Premium）。', en: 'Field value does not match a regular expression (Premium).' }, gate: 'premium' },
  { value: 'len_eq', label: { zh: '长度等于', en: 'length equals' }, desc: { zh: '字段值长度等于给定数字。', en: 'Field value length equals the given number.' }, gate: 'free' },
  { value: 'len_gt', label: { zh: '长度大于', en: 'length greater than' }, desc: { zh: '字段值长度大于给定数字。', en: 'Field value length is greater than the given number.' }, gate: 'free' },
  { value: 'len_lt', label: { zh: '长度小于', en: 'length less than' }, desc: { zh: '字段值长度小于给定数字。', en: 'Field value length is less than the given number.' }, gate: 'free' },
  { value: 'in_list', label: { zh: '属于列表（is in list）', en: 'is in list' }, desc: { zh: '字段值命中引用列表中的任意一项。', en: 'Field value matches any entry in a referenced list.' }, gate: 'free' },
  { value: 'not_in_list', label: { zh: '不属于列表（is not in list）', en: 'is not in list' }, desc: { zh: '字段值未命中引用列表中的任意一项。', en: 'Field value matches no entry in a referenced list.' }, gate: 'free' },
];

export interface EsaActionMeta {
  key: string;
  label: EsaBilingual;
  desc: EsaBilingual;
  /** 开关字段（on/off）；为空表示该动作始终存在 */
  toggleField?: string;
  /** 该动作包含的官方 API 字段名（来自 ruleSchema.ts） */
  fields: string[];
  /** 开关为「关闭即生效」的反向语义（如 BypassCache） */
  invertToggle?: boolean;
}

export interface EsaRuleKindMeta {
  kind: string;
  category: string;
  label: EsaBilingual;
  desc: EsaBilingual;
  actions: EsaActionMeta[];
}

export interface EsaRuleCategory {
  key: string;
  label: EsaBilingual;
  desc: EsaBilingual;
}

/** 官方 Rules 菜单的分类顺序 */
export const ESA_RULE_CATEGORIES: EsaRuleCategory[] = [
  { key: 'https', label: { zh: 'HTTPS 规则', en: 'HTTPS Rules' }, desc: { zh: '按条件启用 SSL/TLS、强制 HTTPS、HSTS 等 HTTPS 能力。', en: 'Apply SSL/TLS, Always Use HTTPS, HSTS and related HTTPS settings by condition.' } },
  { key: 'transform', label: { zh: '转换规则', en: 'Transform Rules' }, desc: { zh: '改写 URL、增删改请求/响应头、自定义响应码。', en: 'Rewrite URLs, modify request/response headers, and customize response codes.' } },
  { key: 'redirect', label: { zh: '重定向规则', en: 'Redirect Rules' }, desc: { zh: '把请求 301/302 等重定向到目标地址，或按错误码重定向。', en: 'Redirect requests to a target URL or by error code.' } },
  { key: 'cache', label: { zh: '缓存规则', en: 'Cache Rules' }, desc: { zh: '按条件控制缓存资格、TTL、缓存键与 Cache POST 等。', en: 'Control cache eligibility, TTL, cache keys and Cache POST by condition.' } },
  { key: 'network', label: { zh: '网络优化', en: 'Network Optimization' }, desc: { zh: '智能路由、WebSocket、gRPC 与最大上传大小。', en: 'Smart routing, WebSocket, gRPC and maximum upload size.' } },
  { key: 'content', label: { zh: '内容优化', en: 'Content Optimization' }, desc: { zh: 'Gzip/Brotli/Zstd 压缩、图片变换与视频拖动。', en: 'Gzip/Brotli/Zstd compression, image transform and video seeking.' } },
  { key: 'origin', label: { zh: '回源规则', en: 'Origin Rules' }, desc: { zh: '改写回源 Host/SNI/协议端口、DNS Override、Range 与回源超时。', en: 'Rewrite origin host/SNI/protocol/port, DNS override, range and origin timeout.' } },
];

/** 规则类型与动作（严格对齐官方控制台可见项） */
export const ESA_RULE_KIND_META: EsaRuleKindMeta[] = [
  {
    kind: 'HttpsBasicConfiguration',
    category: 'https',
    label: { zh: 'SSL/TLS 规则', en: 'SSL/TLS Rules' },
    desc: { zh: '按主机名启用 SSL/TLS 加密、密码套件、TLS 版本、OCSP Stapling、HTTP/2 与 HTTP/3。', en: 'Enable SSL/TLS encryption, cipher suites, TLS versions, OCSP stapling, HTTP/2 and HTTP/3 by hostname.' },
    actions: [
      { key: 'basic', label: { zh: 'SSL/TLS 基础配置', en: 'SSL/TLS Basic Configuration' }, desc: { zh: '配置 SSL/TLS 加密、密码套件组、TLS 版本、OCSP Stapling、HTTP/2、HTTP/3。', en: 'Configure SSL/TLS encryption, cipher suite group, TLS versions, OCSP stapling, HTTP/2 and HTTP/3.' }, fields: ['Https', 'CiphersuiteGroup', 'Ciphersuite', 'OcspStapling'] },
    ],
  },
  {
    kind: 'HttpsApplicationConfiguration',
    category: 'https',
    label: { zh: 'HTTPS 规则', en: 'HTTPS Rules' },
    desc: { zh: '按条件启用强制 HTTPS、机会性加密与 HSTS。', en: 'Apply Always Use HTTPS, Opportunistic Encryption and HSTS by condition.' },
    actions: [
      { key: 'forceHttps', label: { zh: '始终使用 HTTPS', en: 'Always Use HTTPS' }, desc: { zh: '把客户端的 HTTP 请求在边缘重定向到 HTTPS。', en: 'Redirect client HTTP requests to HTTPS at the edge.' }, toggleField: 'HttpsForce', fields: ['HttpsForce', 'HttpsForceCode'] },
      { key: 'altSvc', label: { zh: '机会性加密', en: 'Opportunistic Encryption' }, desc: { zh: '通过 alt-svc 响应头告知客户端支持 HTTPS 或更安全的协议。', en: 'Inform clients of HTTPS or more secure protocols via the alt-svc header.' }, toggleField: 'AltSvc', fields: ['AltSvc', 'AltSvcClear', 'AltSvcPersist', 'AltSvcMa'] },
      { key: 'hsts', label: { zh: 'HSTS', en: 'HSTS' }, desc: { zh: '通过响应头强制浏览器后续只使用 HTTPS 访问。', en: 'Enforce HTTPS-only access via the HSTS response header.' }, toggleField: 'Hsts', fields: ['Hsts', 'HstsMaxAge', 'HstsIncludeSubdomains', 'HstsPreload'] },
      { key: 'sni', label: { zh: 'SNI 校验', en: 'SNI Validation' }, desc: { zh: '校验或限制客户端访问时携带的 SNI。', en: 'Validate or restrict the SNI presented by clients.' }, fields: ['HttpsSniVerify', 'HttpsNoSniDeny', 'HttpsSniWhitelist'] },
    ],
  },
  {
    kind: 'RewriteUrlRule',
    category: 'transform',
    label: { zh: '重写 URL', en: 'Rewrite URL' },
    desc: { zh: '在不改变客户端地址的前提下，改写回源请求的路径与查询字符串。', en: 'Rewrite the path and query string used for origin requests without changing the client URL.' },
    actions: [
      { key: 'path', label: { zh: '路径', en: 'Path' }, desc: { zh: '保留原路径，或重写为新的目标路径。', en: 'Retain the original path or rewrite it to a new target.' }, fields: ['RewriteUriType', 'Uri'] },
      { key: 'query', label: { zh: '查询字符串', en: 'Query String' }, desc: { zh: '保留原查询字符串，或重写为新的查询字符串。', en: 'Retain the original query string or rewrite it.' }, fields: ['RewriteQueryStringType', 'QueryString'] },
    ],
  },
  {
    kind: 'HttpRequestHeaderModificationRule',
    category: 'transform',
    label: { zh: '修改请求头', en: 'Modify Request Header' },
    desc: { zh: '对回源请求头执行新增、修改或删除。', en: 'Add, modify or delete request headers sent to the origin.' },
    actions: [
      { key: 'requestHeader', label: { zh: '请求头操作', en: 'Request Header Operation' }, desc: { zh: '按静态或动态值新增、修改、删除请求头。', en: 'Add, modify or delete request headers with static or dynamic values.' }, fields: ['RequestHeaderModification'] },
    ],
  },
  {
    kind: 'HttpResponseHeaderModificationRule',
    category: 'transform',
    label: { zh: '修改响应头', en: 'Modify Response Header' },
    desc: { zh: '对返回给客户端的响应头执行新增、修改或删除。', en: 'Add, modify or delete response headers returned to clients.' },
    actions: [
      { key: 'responseHeader', label: { zh: '响应头操作', en: 'Response Header Operation' }, desc: { zh: '按静态或动态值新增、修改、删除响应头。', en: 'Add, modify or delete response headers with static or dynamic values.' }, fields: ['ResponseHeaderModification'] },
    ],
  },
  {
    kind: 'HttpIncomingRequestHeaderModificationRule',
    category: 'transform',
    label: { zh: '修改回源请求头', en: 'Modify Incoming Request Header' },
    desc: { zh: '在回源链路上修改请求头（与「修改请求头」方向不同）。', en: 'Modify request headers on the origin-fetch path.' },
    actions: [
      { key: 'incomingRequestHeader', label: { zh: '回源请求头操作', en: 'Incoming Request Header' }, desc: { zh: '对回源请求头新增、修改或删除。', en: 'Add, modify or delete incoming request headers.' }, fields: ['RequestHeaderModification'] },
    ],
  },
  {
    kind: 'HttpIncomingResponseHeaderModificationRule',
    category: 'transform',
    label: { zh: '修改回源响应头', en: 'Modify Incoming Response Header' },
    desc: { zh: '在回源链路上修改响应头（与「修改响应头」方向不同）。', en: 'Modify response headers on the origin-fetch path.' },
    actions: [
      { key: 'incomingResponseHeader', label: { zh: '回源响应头操作', en: 'Incoming Response Header' }, desc: { zh: '对回源响应头新增、修改或删除。', en: 'Add, modify or delete incoming response headers.' }, fields: ['ResponseHeaderModification'] },
    ],
  },
  {
    kind: 'CustomResponseCodeRule',
    category: 'transform',
    label: { zh: '自定义响应码', en: 'Custom Response Code' },
    desc: { zh: '直接向客户端返回指定状态码与响应页面。', en: 'Return a custom status code and response page to clients.' },
    actions: [
      { key: 'customCode', label: { zh: '自定义响应码', en: 'Custom Response Code' }, desc: { zh: '设置 200–599 的响应码与响应页面。', en: 'Set a response code (200–599) and response page.' }, fields: ['ReturnCode', 'PageId'] },
    ],
  },
  {
    kind: 'RedirectRule',
    category: 'redirect',
    label: { zh: '请求重定向', en: 'Request Redirect' },
    desc: { zh: '把命中的请求重定向到目标 URL，支持 301/302/303/307/308。', en: 'Redirect matched requests to a target URL with 301/302/303/307/308.' },
    actions: [
      { key: 'urlRedirect', label: { zh: 'URL 重定向', en: 'URL Redirect' }, desc: { zh: '设置重定向类型、目标 URL、状态码与是否保留查询字符串。', en: 'Set redirect type, target URL, status code and whether to retain the query string.' }, fields: ['Type', 'TargetUrl', 'StatusCode', 'ReserveQueryString'] },
    ],
  },
  {
    kind: 'CacheRule',
    category: 'cache',
    label: { zh: '缓存规则', en: 'Cache Rules' },
    desc: { zh: '按条件控制缓存资格、浏览器/边缘 TTL、缓存键、Cache POST 等。', en: 'Control cache eligibility, browser/edge TTL, cache keys and Cache POST by condition.' },
    actions: [
      { key: 'eligibility', label: { zh: '缓存资格', en: 'Cache Eligibility' }, desc: { zh: '选择绕过缓存，或让请求有资格进入缓存。', en: 'Bypass the cache or make requests eligible for caching.' }, fields: ['BypassCache'] },
      { key: 'browserTtl', label: { zh: '浏览器缓存 TTL', en: 'Browser Cache TTL' }, desc: { zh: '设置浏览器本地缓存时长：遵循源站、不缓存或自定义。', en: 'Set browser cache TTL: honor origin, do not cache, or custom.' }, fields: ['BrowserCacheMode', 'BrowserCacheTtl'] },
      { key: 'edgeTtl', label: { zh: '边缘缓存 TTL', en: 'Edge Cache TTL' }, desc: { zh: '设置边缘节点缓存时长：遵循源站、不缓存或自定义。', en: 'Set edge cache TTL: honor origin, do not cache, or custom.' }, fields: ['EdgeCacheMode', 'EdgeCacheTtl'] },
      { key: 'statusCodeTtl', label: { zh: '状态码缓存 TTL', en: 'Edge Status Code Cache TTL' }, desc: { zh: '为不同 HTTP 状态码设置边缘缓存时长（最多 8 条）。', en: 'Set edge TTLs for different HTTP status codes (up to 8 rules).' }, fields: ['EdgeStatusCodeCacheTtl'] },
      { key: 'customKeys', label: { zh: '自定义缓存键', en: 'Custom Cache Keys' }, desc: { zh: '指定参与 CacheKey 的查询参数、请求头、Cookie 与用户维度。', en: 'Choose which query parameters, headers, cookies and user dimensions form the CacheKey.' }, fields: ['SortQueryStringForCache', 'QueryStringMode', 'QueryString', 'IncludeHeader', 'IncludeCookie', 'CheckPresenceHeader', 'CheckPresenceCookie', 'UserDeviceType', 'UserGeo', 'UserLanguage'] },
      { key: 'serveStale', label: { zh: '过期内容兜底', en: 'Serve Stale Content' }, desc: { zh: '源站不可用时是否继续返回已过期的缓存内容。', en: 'Serve stale content when the origin is unavailable.' }, toggleField: 'ServeStale', fields: ['ServeStale'] },
      { key: 'cacheReserve', label: { zh: 'Cache Reserve 资格', en: 'Cache Reserve Eligibility' }, desc: { zh: '标记源站响应是否有资格进入 Cache Reserve。', en: 'Mark whether origin responses are eligible for Cache Reserve.' }, fields: ['CacheReserveEligibility'] },
      { key: 'cachePost', label: { zh: '缓存 POST', en: 'Cache POST' }, desc: { zh: '开启后缓存 POST 响应，并设置请求体大小与 CacheKey 处理方式。', en: 'Cache POST responses with body size and CacheKey handling.' }, toggleField: 'PostCache', fields: ['PostCache', 'PostBodySizeLimit', 'PostBodyCacheKey'] },
      { key: 'ports', label: { zh: '端口缓存', en: 'Caching on Ports' }, desc: { zh: '在 80/443/8080 之外的端口启用缓存（Enterprise）。', en: 'Cache on ports other than 80, 443 and 8080 (Enterprise).' }, fields: ['AdditionalCacheablePorts'] },
      { key: 'deceptionArmor', label: { zh: '缓存欺骗防御', en: 'Cache Deception Armor' }, desc: { zh: '防止攻击者利用缓存机制伪造可缓存路径。', en: 'Prevent cache deception attacks that disguise dynamic paths as cacheable.' }, toggleField: 'CacheDeceptionArmor', fields: ['CacheDeceptionArmor'] },
    ],
  },
  {
    kind: 'NetworkOptimization',
    category: 'network',
    label: { zh: '网络优化', en: 'Network Optimization' },
    desc: { zh: '按条件启用智能路由、WebSocket、gRPC 与最大上传大小。', en: 'Enable smart routing, WebSocket, gRPC and maximum upload size by condition.' },
    actions: [
      { key: 'smartRouting', label: { zh: '智能路由', en: 'Smart Routing' }, desc: { zh: '实时探测全球节点网络，选择最优路径传输请求。', en: 'Probe the global POP network in real time and use the best path.' }, toggleField: 'SmartRouting', fields: ['SmartRouting'] },
      { key: 'websocket', label: { zh: 'WebSocket', en: 'WebSocket' }, desc: { zh: '启用 WebSocket 协议的回源与转发。', en: 'Enable WebSocket origin fetch and forwarding.' }, toggleField: 'Websocket', fields: ['Websocket'] },
      { key: 'grpc', label: { zh: 'gRPC', en: 'gRPC' }, desc: { zh: '启用 gRPC 回源与转发。', en: 'Enable gRPC origin fetch and forwarding.' }, toggleField: 'Grpc', fields: ['Grpc'] },
      { key: 'uploadSize', label: { zh: '最大上传大小', en: 'Maximum Upload Size' }, desc: { zh: '单次请求允许客户端上传的最大数据量（100–500 MB）。', en: 'Maximum data a client can upload in one request (100–500 MB).' }, fields: ['UploadMaxFilesize'] },
    ],
  },
  {
    kind: 'CompressionRule',
    category: 'content',
    label: { zh: '文件压缩', en: 'File Compression' },
    desc: { zh: '对静态文件启用 Gzip / Brotli / Zstd 压缩。', en: 'Enable Gzip, Brotli or Zstd compression for static files.' },
    actions: [
      { key: 'gzip', label: { zh: 'Gzip', en: 'Gzip' }, desc: { zh: '使用 Gzip 压缩静态文件以加速传输。', en: 'Compress static files with Gzip.' }, toggleField: 'Gzip', fields: ['Gzip'] },
      { key: 'brotli', label: { zh: 'Brotli', en: 'Brotli' }, desc: { zh: '使用 Brotli 压缩静态文件；与 Gzip 同时开启时优先 Brotli。', en: 'Compress static files with Brotli; takes precedence over Gzip.' }, toggleField: 'Brotli', fields: ['Brotli'] },
      { key: 'zstd', label: { zh: 'Zstd', en: 'Zstd' }, desc: { zh: '使用 Zstd 压缩，压缩/解压性能优于 Gzip 与 Brotli。', en: 'Compress with Zstd for better performance than Gzip and Brotli.' }, toggleField: 'Zstd', fields: ['Zstd'] },
    ],
  },
  {
    kind: 'ImageTransform',
    category: 'content',
    label: { zh: '图片变换', en: 'Image Transform' },
    desc: { zh: '通过在请求 URL 中追加参数实现图片处理。', en: 'Process images by adding parameters to the request URL.' },
    actions: [
      { key: 'imageTransform', label: { zh: '图片变换', en: 'Image Transform' }, desc: { zh: '启用图片变换，并可自动转换为 WebP / AVIF。', en: 'Enable image transform with optional WebP/AVIF conversion.' }, toggleField: 'Enable', fields: ['Enable', 'AutoWebp', 'AutoAvif'] },
    ],
  },
  {
    kind: 'VideoProcessing',
    category: 'content',
    label: { zh: '视频处理', en: 'Video Processing' },
    desc: { zh: '允许播放视频时拖动到指定时间（仅 MP4/FLV）。', en: 'Allow seeking in videos (MP4/FLV only).' },
    actions: [
      { key: 'videoSeeking', label: { zh: '视频拖动', en: 'Video Seeking' }, desc: { zh: '开启后可通过 URL 的 start 参数拖动到指定时间。', en: 'Enable seeking via the start URL parameter.' }, toggleField: 'VideoSeekEnable', fields: ['VideoSeekEnable', 'FlvVideoSeekMode', 'FlvSeekStart', 'FlvSeekEnd'] },
    ],
  },
  {
    kind: 'OriginRule',
    category: 'origin',
    label: { zh: '回源规则', en: 'Origin Rules' },
    desc: { zh: '按条件改写回源 Host、SNI、协议端口、DNS 解析与 Range 行为。', en: 'Rewrite origin host, SNI, protocol/port, DNS resolution and range behavior by condition.' },
    actions: [
      { key: 'originHost', label: { zh: '回源 Host', en: 'Origin Host' }, desc: { zh: '改写回源请求中携带的 HOST。', en: 'Rewrite the HOST carried in origin requests.' }, fields: ['OriginHost'] },
      { key: 'originProtocol', label: { zh: '回源协议与端口', en: 'Origin Protocol and Port' }, desc: { zh: '设置回源协议（跟随客户端/HTTP/HTTPS）与端口。', en: 'Set the origin protocol (match client/HTTP/HTTPS) and ports.' }, fields: ['OriginScheme', 'OriginHttpPort', 'OriginHttpsPort'] },
      { key: 'originSni', label: { zh: '回源 SNI', en: 'Origin SNI' }, desc: { zh: '指定回源请求携带的 SNI。', en: 'Specify the SNI carried in origin requests.' }, fields: ['OriginSni'] },
      { key: 'dnsOverride', label: { zh: 'DNS 记录覆盖', en: 'DNS Record (DNS Override)' }, desc: { zh: '指定主机名覆盖请求的解析结果，效果类似改写回源 URL。', en: 'Override the resolved hostname of incoming requests.' }, fields: ['DnsRecord'] },
      { key: 'range', label: { zh: 'Range 请求', en: 'Range Requests' }, desc: { zh: '设置回源时的 Range 行为与分片大小。', en: 'Set Range behavior and shard size for origin requests.' }, fields: ['Range', 'RangeChunkSize'] },
      { key: 'originMtls', label: { zh: '回源 mTLS', en: 'Origin mTLS' }, desc: { zh: '回源时使用客户端证书进行双向认证。', en: 'Use client certificates for origin mTLS.' }, fields: ['OriginMtls'] },
      { key: 'originVerify', label: { zh: '校验源站证书', en: 'Verify Origin Certificate' }, desc: { zh: '校验源站证书有效性。', en: 'Validate the origin certificate.' }, fields: ['OriginVerify'] },
      { key: 'readTimeout', label: { zh: '回源读超时', en: 'Origin Fetch Timeout' }, desc: { zh: '回源读超时时间（5–300 秒，默认 30 秒）。', en: 'Origin read timeout (5–300 seconds, default 30).' }, fields: ['OriginReadTimeout'] },
    ],
  },
];

export function esaKindMeta(kind: string): EsaRuleKindMeta | undefined {
  return ESA_RULE_KIND_META.find((k) => k.kind === kind);
}

export function esaKindsOfCategory(category: string): EsaRuleKindMeta[] {
  return ESA_RULE_KIND_META.filter((k) => k.category === category);
}

export function esaGateLabel(gate: EsaPlanGate, locale: EsaLocale): string {
  if (gate === 'free') return '';
  const zh: Record<string, string> = { pro: '需 Pro', premium: '需 Premium', enterprise: '需 Enterprise', unsupported: '不支持' };
  const en: Record<string, string> = { pro: 'Pro', premium: 'Premium', enterprise: 'Enterprise', unsupported: 'Not supported' };
  return locale === 'zh' ? zh[gate] || '' : en[gate] || '';
}
