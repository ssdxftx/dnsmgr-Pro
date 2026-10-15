// 腾讯云 EdgeOne 规则引擎官方元数据（中英双语）。
// 名称与分组均取自官方控制台「规则引擎」编辑页及官方文档（API 2022-09-01）：
//  - 匹配类型/运算符：RuleCondition 数据结构（CreateRule/ModifyRule）
//  - 操作名称：DescribeRulesSetting 返回的 Action 名 + 官方控制台中文
// 未收录的名称（如新套餐新增动作）运行时回退显示原始英文名，不影响功能。
export type EoLocale = 'zh' | 'en';

interface Bi {
  zh: string;
  en: string;
}

export interface EoTargetMeta {
  value: string;
  label: Bi;
  /** 需要填写参数名（query_string / request_header 的参数名） */
  needName?: boolean;
  /** 支持忽略大小写（官方：URL path/URL full/查询字符串/文件后缀/文件名称/HTTP 请求头） */
  ignoreCase?: boolean;
  /** 支持「存在/不存在」运算符（官方仅 query_string / request_header） */
  existable?: boolean;
  /** 固定取值（all：站点任意请求） */
  fixedValues?: string[];
}

/** 官方运算符（注意 notEquals 为官方拼写，非 notequal） */
export const EO_OPERATORS: { value: string; label: Bi }[] = [
  { value: 'equal', label: { zh: '等于', en: 'Equal' } },
  { value: 'notEquals', label: { zh: '不等于', en: 'Does not equal' } },
  { value: 'exist', label: { zh: '存在', en: 'Exists' } },
  { value: 'notexist', label: { zh: '不存在', en: 'Does not exist' } },
];

/** 官方匹配类型（客户端请求） */
export const EO_TARGETS: EoTargetMeta[] = [
  { value: 'host', label: { zh: 'HOST', en: 'HOST' } },
  { value: 'url', label: { zh: 'URL path', en: 'URL Path' }, ignoreCase: true },
  { value: 'full_url', label: { zh: 'URL full', en: 'URL Full' }, ignoreCase: true },
  { value: 'query_string', label: { zh: '查询字符串', en: 'Query String' }, needName: true, ignoreCase: true, existable: true },
  { value: 'extension', label: { zh: '文件后缀', en: 'File Extension' }, ignoreCase: true },
  { value: 'filename', label: { zh: '文件名称', en: 'File Name' }, ignoreCase: true },
  { value: 'request_header', label: { zh: 'HTTP 请求头', en: 'HTTP Request Header' }, needName: true, ignoreCase: true, existable: true },
  { value: 'client_country', label: { zh: '客户端地理位置', en: 'Client Geo Location' } },
  { value: 'request_protocol', label: { zh: '请求协议', en: 'Request Protocol' } },
  { value: 'client_ip', label: { zh: '客户端 IP', en: 'Client IP' } },
  { value: 'request_method', label: { zh: '请求方法', en: 'Request Method' } },
  { value: 'all', label: { zh: '全部（站点任意请求）', en: 'All (any request)' }, fixedValues: ['all'] },
];

/** 官方操作分组（控制台顺序） */
export const EO_ACTION_GROUPS: { key: string; label: Bi }[] = [
  { key: 'cache', label: { zh: '缓存配置', en: 'Cache Configuration' } },
  { key: 'network', label: { zh: '网络优化', en: 'Network Optimization' } },
  { key: 'https', label: { zh: 'HTTPS 优化', en: 'HTTPS Optimization' } },
  { key: 'header', label: { zh: '修改 HTTP 头', en: 'Modifying HTTP Header' } },
  { key: 'advanced', label: { zh: '高级配置', en: 'Advanced Configuration' } },
];

/** 官方操作中文名（键为 DescribeRulesSetting 返回的 Action 名，匹配时大小写不敏感） */
export const EO_ACTION_LABELS: Record<string, { label: Bi; group: string }> = {
  // 缓存配置
  cache: { label: { zh: '节点缓存 TTL', en: 'Node Cache TTL' }, group: 'cache' },
  maxage: { label: { zh: '浏览器缓存 TTL', en: 'Browser Cache TTL' }, group: 'cache' },
  cachekey: { label: { zh: '自定义 Cache Key', en: 'Custom Cache Key' }, group: 'cache' },
  StatusCodeCache: { label: { zh: '状态码缓存 TTL', en: 'Status Code Cache TTL' }, group: 'cache' },
  CachePrefresh: { label: { zh: '缓存预刷新', en: 'Cache Prefresh' }, group: 'cache' },
  OfflineCache: { label: { zh: '离线缓存', en: 'Offline Cache' }, group: 'cache' },
  // 网络优化
  http2: { label: { zh: 'HTTP/2', en: 'HTTP/2' }, group: 'network' },
  quic: { label: { zh: 'HTTP/3（QUIC）', en: 'HTTP/3 (QUIC)' }, group: 'network' },
  websocket: { label: { zh: 'WebSocket', en: 'WebSocket' }, group: 'network' },
  ResponseSpeedLimit: { label: { zh: '单连接下载限速', en: 'Response Speed Limit' }, group: 'network' },
  SmartRouting: { label: { zh: '智能加速', en: 'Smart Acceleration' }, group: 'network' },
  Compression: { label: { zh: '智能压缩', en: 'Smart Compression' }, group: 'network' },
  // HTTPS 优化
  forceredirect: { label: { zh: '强制 HTTPS', en: 'Forced HTTPS' }, group: 'https' },
  Hsts: { label: { zh: 'HSTS 配置', en: 'HSTS Configuration' }, group: 'https' },
  ssltlssecureconf: { label: { zh: 'SSL/TLS 安全配置', en: 'SSL/TLS Security Configuration' }, group: 'https' },
  OCSPStapling: { label: { zh: 'OCSP 装订', en: 'OCSP Stapling' }, group: 'https' },
  originpullprotocol: { label: { zh: '回源 HTTPS 协议', en: 'Origin-Pull HTTPS' }, group: 'https' },
  // 修改 HTTP 头
  ResponseHeader: { label: { zh: '修改 HTTP 节点响应头', en: 'Modifying HTTP Response Headers' }, group: 'header' },
  RequestHeader: { label: { zh: '修改 HTTP 回源请求头', en: 'Modifying HTTP Origin-Pull Request Headers' }, group: 'header' },
  ClientIpHeader: { label: { zh: '客户端 IP 头部', en: 'Client IP Header' }, group: 'header' },
  ClientIpLocation: { label: { zh: '客户端 IP 地理位置头部', en: 'Client IP Geographical Location Header' }, group: 'header' },
  // 高级配置
  accessurlredirect: { label: { zh: '访问 URL 重定向', en: 'Access URL Redirect' }, group: 'advanced' },
  upstreamurlredirect: { label: { zh: '回源 URL 重写', en: 'Origin URL Rewrite' }, group: 'advanced' },
  authentication: { label: { zh: 'Token 鉴权', en: 'Token Authentication' }, group: 'advanced' },
  httpresponse: { label: { zh: 'HTTP 应答', en: 'HTTP Response' }, group: 'advanced' },
  videoseek: { label: { zh: '视频拖拽', en: 'Video Seek' }, group: 'advanced' },
  upstreamhttp2: { label: { zh: 'HTTP/2 回源', en: 'HTTP/2 Origin-Pull' }, group: 'advanced' },
  httpupstreamtimeout: { label: { zh: '回源超时时间', en: 'Origin-Pull Timeout' }, group: 'advanced' },
  hostheader: { label: { zh: 'Host Header 重写', en: 'Host Header Rewrite' }, group: 'advanced' },
  origin: { label: { zh: '修改源站', en: 'Modifying Origin Server' }, group: 'advanced' },
  upstreamfollowredirect: { label: { zh: '回源跟随重定向', en: 'Origin-Pull Follow Redirect' }, group: 'advanced' },
  ErrorPage: { label: { zh: '自定义错误页面', en: 'Custom Error Page' }, group: 'advanced' },
  rangeoriginpull: { label: { zh: '分片回源', en: 'Range Origin-Pull' }, group: 'advanced' },
};

/** 常见操作参数的官方中文名（未收录回退英文原名） */
export const EO_PARAM_LABELS: Record<string, Bi> = {
  Switch: { zh: '开关', en: 'Switch' },
  Action: { zh: '操作', en: 'Action' },
  Name: { zh: '名称', en: 'Name' },
  HeaderName: { zh: '头部名称', en: 'Header Name' },
  Values: { zh: '值', en: 'Values' },
  Value: { zh: '值', en: 'Value' },
  CacheTime: { zh: '缓存时间', en: 'Cache Time' },
  CacheTimePercent: { zh: '预刷新时间（TTL 的百分比）', en: 'Prefresh Time (percent of TTL)' },
  StatusCode: { zh: '状态码', en: 'Status Code' },
  Timeout: { zh: '超时时间', en: 'Timeout' },
  ResponseTimeout: { zh: '回源响应超时时间', en: 'Origin Response Timeout' },
  IgnoreCacheControl: { zh: '忽略源站 Cache-Control', en: 'Ignore Origin Cache-Control' },
  MaxAge: { zh: '最大时长', en: 'Max Age' },
  MaxAgeType: { zh: '时长类型', en: 'Max Age Type' },
  IncludeSubDomains: { zh: '包含子域名', en: 'Include Subdomains' },
  Preload: { zh: 'Preload', en: 'Preload' },
  FollowOrigin: { zh: '遵循源站', en: 'Follow Origin' },
  NoCacheFollowOrigin: { zh: '无 Cache-Control 时遵循默认缓存策略', en: 'Follow default cache policy without Cache-Control' },
  DefaultCache: { zh: '默认缓存策略', en: 'Default Cache' },
  Version: { zh: 'TLS 版本', en: 'TLS Version' },
  CipherSuite: { zh: '密码套件', en: 'Cipher Suite' },
  Protocol: { zh: '协议', en: 'Protocol' },
  ProtocolType: { zh: '协议类型', en: 'Protocol Type' },
  Mode: { zh: '模式', en: 'Mode' },
  Type: { zh: '类型', en: 'Type' },
  Hostname: { zh: 'Hostname', en: 'Hostname' },
  TargetHostname: { zh: '目标 Hostname', en: 'Target Hostname' },
  TargetPath: { zh: '目标路径', en: 'Target Path' },
  Path: { zh: '路径', en: 'Path' },
  TargetProtocol: { zh: '目标请求协议', en: 'Target Request Protocol' },
  Query: { zh: '查询参数', en: 'Query' },
  QueryString: { zh: '查询字符串', en: 'Query String' },
  Algorithm: { zh: '算法', en: 'Algorithm' },
  Algorithms: { zh: '压缩算法', en: 'Compression Algorithms' },
  Gzip: { zh: 'Gzip 压缩', en: 'Gzip Compression' },
  Brotli: { zh: 'Brotli 压缩', en: 'Brotli Compression' },
  AuthType: { zh: '鉴权方式', en: 'Authentication Type' },
  PrimaryKey: { zh: '主鉴权密钥', en: 'Primary Auth Key' },
  BackupKey: { zh: '备鉴权密钥', en: 'Backup Auth Key' },
  AuthParam: { zh: '鉴权加密串参数名称', en: 'Auth Parameter Name' },
  SignParam: { zh: '鉴权加密串参数名称', en: 'Auth Parameter Name' },
  Time: { zh: '有效时长', en: 'Duration' },
  TimePeriod: { zh: '有效时长', en: 'Duration' },
  Size: { zh: '大小限制', en: 'Size Limit' },
  MaxSize: { zh: '上限值', en: 'Maximum Value' },
  MaxUploadSize: { zh: '最大上传大小', en: 'Maximum Upload Size' },
  Url: { zh: '页面 URL', en: 'Page URL' },
  PageUrl: { zh: '页面 URL', en: 'Page URL' },
  ResponseCode: { zh: '响应状态码', en: 'Response Status Code' },
  ResponsePage: { zh: '响应页面', en: 'Response Page' },
  DomainName: { zh: '源站域名', en: 'Origin Domain' },
  OriginProtocol: { zh: '回源协议', en: 'Origin-Pull Protocol' },
  HttpOriginPort: { zh: 'HTTP 回源端口', en: 'HTTP Origin Port' },
  HttpsOriginPort: { zh: 'HTTPS 回源端口', en: 'HTTPS Origin Port' },
  ServerName: { zh: '回源 SNI', en: 'Origin SNI' },
  IgnoreQueryString: { zh: '携带查询参数', en: 'Include Query String' },
  IgnoreCase: { zh: '忽略大小写', en: 'Ignore Case' },
  KeepQueryString: { zh: '携带查询参数', en: 'Keep Query String' },
  ExecOnce: { zh: '仅执行一次', en: 'Execute Once' },
};

/** 常见取值的官方中文名（CHOICE 值翻译） */
export const EO_VALUE_LABELS: Record<string, Bi> = {
  on: { zh: '开启', en: 'On' },
  off: { zh: '关闭', en: 'Off' },
  set: { zh: '设置', en: 'Set' },
  add: { zh: '添加', en: 'Add' },
  del: { zh: '删除', en: 'Delete' },
  modify: { zh: '修改', en: 'Modify' },
  follow: { zh: '跟随请求', en: 'Follow request' },
  protocol_follow: { zh: '协议跟随', en: 'Follow protocol' },
  http: { zh: 'HTTP', en: 'HTTP' },
  https: { zh: 'HTTPS', en: 'HTTPS' },
  http_to_https: { zh: 'HTTP → HTTPS', en: 'HTTP → HTTPS' },
  gzip: { zh: 'Gzip 压缩', en: 'Gzip' },
  brotli: { zh: 'Brotli 压缩', en: 'Brotli' },
  all: { zh: '全部', en: 'All' },
};

function bi(b: Bi | undefined, locale: EoLocale, fallback: string): string {
  if (!b) return fallback;
  return locale === 'zh' ? b.zh : b.en;
}

export function eoOperatorLabel(op: string, locale: EoLocale): string {
  return bi(EO_OPERATORS.find((o) => o.value === op)?.label, locale, op);
}

export function eoTargetMeta(target: string): EoTargetMeta | undefined {
  return EO_TARGETS.find((t) => t.value === target);
}

export function eoTargetLabel(target: string, locale: EoLocale): string {
  return bi(eoTargetMeta(target)?.label, locale, target);
}

/** 依据运行时 schema 的 Action 名获取官方中文与分组；未收录回退英文名、归入「高级配置」 */
export function eoActionInfo(action: string, locale: EoLocale): { label: string; group: string; groupLabel: string } {
  const hit = EO_ACTION_LABELS[action] || EO_ACTION_LABELS[Object.keys(EO_ACTION_LABELS).find((k) => k.toLowerCase() === action.toLowerCase()) || ''];
  const group = hit?.group || 'advanced';
  return {
    label: bi(hit?.label, locale, action),
    group,
    groupLabel: bi(EO_ACTION_GROUPS.find((g) => g.key === group)?.label, locale, group),
  };
}

export function eoParamLabel(name: string, locale: EoLocale): string {
  const hit = EO_PARAM_LABELS[name] || EO_PARAM_LABELS[Object.keys(EO_PARAM_LABELS).find((k) => k.toLowerCase() === name.toLowerCase()) || ''];
  return bi(hit, locale, name);
}

export function eoValueLabel(value: string, locale: EoLocale): string {
  const hit = EO_VALUE_LABELS[value] || EO_VALUE_LABELS[Object.keys(EO_VALUE_LABELS).find((k) => k.toLowerCase() === value.toLowerCase()) || ''];
  return bi(hit, locale, value);
}
