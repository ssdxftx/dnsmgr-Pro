// 腾讯云 EdgeOne 七层加速规则（L7Acc）操作字段表。
// 字段与官方 SDK（teo v20220901）RuleEngineAction 各 <Name>Parameters 结构一一对应，
// 中文名取自官方控制台「规则引擎」编辑页。前端据此为每个操作渲染与官方一致的专用表单。
// 数据来源：tencentcloud-sdk-nodejs-teo teo_models.d.ts（CreateL7AccRules/DescribeL7AccRules）。
export interface Bi {
  zh: string;
  en: string;
}

export type EoFieldType = 'switch' | 'select' | 'number' | 'text' | 'tags' | 'group' | 'list' | 'oneof';

export interface EoFieldOption {
  value: string;
  label: Bi;
}

/** oneof：多选一（选项对应 Parameters 下的不同子对象键，如 Cache 的 FollowOrigin/CustomTime/NoCache） */
export interface EoVariant {
  key: string;
  label: Bi;
  fields: EoField[];
}

export interface EoField {
  name: string;
  label: Bi;
  type: EoFieldType;
  desc?: Bi;
  options?: EoFieldOption[];
  min?: number;
  max?: number;
  unit?: Bi;
  /** 秒级时长字段：可视化编辑器提供 秒/分钟/小时/天/月 换算，JSON 仍按秒写入 */
  time?: boolean;
  placeholder?: Bi;
  /** group：子字段（对应参数中的嵌套对象） */
  fields?: EoField[];
  /** list：元素字段（对应参数中的对象数组） */
  itemFields?: EoField[];
  /** list：新建元素的默认值 */
  newItem?: () => Record<string, any>;
  /** oneof：互斥分支 */
  variants?: EoVariant[];
  /** 条件显示：依赖同一 Parameters 对象内的其它字段 */
  showIf?: (p: Record<string, any>) => boolean;
}

export interface EoActionSchema {
  /** RuleEngineAction.Name（须与官方完全一致） */
  name: string;
  /** 参数键，默认 `${name}Parameters` */
  paramKey: string;
  label: Bi;
  /** 动作作用说明（选择动作时在弹出卡片中展示，中英双语） */
  desc: Bi;
  /** 分组 key，见 EO_ACTION_GROUPS */
  group: string;
  fields: EoField[];
}

const ON = { value: 'on', label: { zh: '开启', en: 'On' } };
const OFF = { value: 'off', label: { zh: '关闭', en: 'Off' } };
const onoff: EoFieldOption[] = [ON, OFF];
const protocol: EoFieldOption[] = [
  { value: 'http', label: { zh: 'HTTP', en: 'HTTP' } },
  { value: 'https', label: { zh: 'HTTPS', en: 'HTTPS' } },
  { value: 'follow', label: { zh: '协议跟随', en: 'Follow' } },
];
const queryMode: EoFieldOption[] = [
  { value: 'includeCustom', label: { zh: '保留部分参数', en: 'Include specified' } },
  { value: 'excludeCustom', label: { zh: '忽略部分参数', en: 'Exclude specified' } },
];
const cacheKeyQueryMode: EoFieldOption[] = [
  { value: 'full', label: { zh: '全部保留', en: 'Keep all' } },
  { value: 'ignore', label: { zh: '全部忽略', en: 'Ignore all' } },
  { value: 'includeCustom', label: { zh: '保留部分参数', en: 'Include specified' } },
  { value: 'excludeCustom', label: { zh: '忽略部分参数', en: 'Exclude specified' } },
];
const switchField = (name: string, label: Bi, desc?: Bi): EoField => ({ name, label, type: 'switch', options: onoff, desc });
const numField = (name: string, label: Bi, extra: Partial<EoField> = {}): EoField => ({ name, label, type: 'number', ...extra });

/** 各操作字段表（顺序即官方表单顺序） */
export const EO_ACTION_SCHEMAS: EoActionSchema[] = [
  {
    name: 'Cache',
    paramKey: 'CacheParameters',
    label: { zh: '节点缓存 TTL', en: 'Node Cache TTL' },
    desc: { zh: '设置边缘节点对源站响应的缓存时长与行为（遵循源站 Cache-Control、自定义时间或不缓存），是静态资源加速的核心配置。', en: 'Set how long edge nodes cache origin responses and how they behave (follow origin Cache-Control, custom TTL, or no cache); the core setting for content acceleration.' },
    group: 'cache',
    fields: [
      {
        name: 'CacheBehavior',
        label: { zh: '行为', en: 'Behavior' },
        type: 'oneof',
        variants: [
          {
            key: 'FollowOrigin',
            label: { zh: '遵循源站 Cache-Control', en: 'Follow origin Cache-Control' },
            fields: [
              { name: 'DefaultCache', label: { zh: '无 Cache-Control 时缓存', en: 'Cache without Cache-Control' }, type: 'select', options: onoff },
              { name: 'DefaultCacheStrategy', label: { zh: '默认缓存策略', en: 'Default cache policy' }, type: 'select', options: onoff, showIf: (p) => p.DefaultCache === 'on' },
              numField('DefaultCacheTime', { zh: '默认缓存时间（秒）', en: 'Default cache time (s)' }, { min: 0, time: true, showIf: (p) => p.DefaultCache === 'on' }),
            ],
          },
          {
            key: 'CustomTime',
            label: { zh: '自定义时间', en: 'Custom time' },
            fields: [
              { name: 'IgnoreCacheControl', label: { zh: '强制缓存', en: 'Ignore origin Cache-Control' }, type: 'select', options: onoff },
              numField('CacheTime', { zh: '时间（秒）', en: 'Cache time (s)' }, { min: 0, time: true }),
            ],
          },
          {
            key: 'NoCache',
            label: { zh: '不缓存', en: 'No cache' },
            fields: [],
          },
        ],
      },
    ],
  },
  {
    name: 'CacheKey',
    paramKey: 'CacheKeyParameters',
    label: { zh: '自定义 Cache Key', en: 'Custom Cache Key' },
    desc: { zh: '自定义缓存键规则：按查询字符串、请求头、Cookie 等维度区分缓存副本，并支持全路径缓存与忽略大小写。', en: 'Customize the cache key: distinguish cached copies by query string, request headers or cookies, with full-URL caching and case-insensitive matching.' },
    group: 'cache',
    fields: [
      { name: 'QueryString', label: { zh: '查询字符串', en: 'Query String' }, type: 'group', fields: [
        switchField('Switch', { zh: '开关', en: 'Switch' }),
        { name: 'Action', label: { zh: '模式', en: 'Mode' }, type: 'select', options: queryMode, showIf: (p) => p.Switch === 'on' },
        { name: 'Values', label: { zh: '参数名', en: 'Parameter Names' }, type: 'tags', showIf: (p) => p.Switch === 'on' },
      ] },
      { name: 'Header', label: { zh: 'HTTP 请求头', en: 'HTTP Request Header' }, type: 'group', fields: [
        switchField('Switch', { zh: '开关', en: 'Switch' }),
        { name: 'Values', label: { zh: '头部名称', en: 'Header Names' }, type: 'tags', showIf: (p) => p.Switch === 'on' },
      ] },
      { name: 'Cookie', label: { zh: 'Cookie', en: 'Cookie' }, type: 'group', fields: [
        switchField('Switch', { zh: '开关', en: 'Switch' }),
        { name: 'Action', label: { zh: '模式', en: 'Mode' }, type: 'select', options: cacheKeyQueryMode, showIf: (p) => p.Switch === 'on' },
        { name: 'Values', label: { zh: 'Cookie 名称', en: 'Cookie Names' }, type: 'tags', showIf: (p) => p.Switch === 'on' && (p.Action === 'includeCustom' || p.Action === 'excludeCustom') },
      ] },
      { name: 'FullURLCache', label: { zh: '全路径缓存', en: 'Full URL Cache' }, type: 'select', options: onoff },
      { name: 'IgnoreCase', label: { zh: '忽略大小写', en: 'Ignore Case' }, type: 'select', options: onoff },
      { name: 'Scheme', label: { zh: '协议', en: 'Scheme' }, type: 'select', options: onoff },
    ],
  },
  {
    name: 'CachePrefresh',
    paramKey: 'CachePrefreshParameters',
    label: { zh: '缓存预刷新', en: 'Cache Prefresh' },
    desc: { zh: '在缓存过期前按 TTL 百分比提前回源刷新，避免过期瞬间的回源尖峰与用户等待。', en: 'Refresh content from origin before the TTL expires (by percentage), avoiding origin spikes and user latency at expiry.' },
    group: 'cache',
    fields: [
      switchField('Switch', { zh: '开关', en: 'Switch' }),
      numField('CacheTimePercent', { zh: '预刷新时间（TTL 的百分比）', en: 'Prefresh Time (% of TTL)' }, { min: 0, max: 99, showIf: (p) => p.Switch === 'on' }),
    ],
  },
  {
    name: 'MaxAge',
    paramKey: 'MaxAgeParameters',
    label: { zh: '浏览器缓存 TTL', en: 'Browser Cache TTL' },
    desc: { zh: '设置响应给浏览器的 Cache-Control 缓存时长，决定客户端本地缓存多久。', en: 'Set the browser-facing Cache-Control max-age, deciding how long clients cache the response locally.' },
    group: 'cache',
    fields: [
      { name: 'FollowOrigin', label: { zh: '行为', en: 'Behavior' }, type: 'select', options: [
        { value: 'on', label: { zh: '遵循源站', en: 'Follow origin' } },
        { value: 'off', label: { zh: '自定义时间', en: 'Custom time' } },
      ] },
      numField('CacheTime', { zh: '缓存时间（秒）', en: 'Cache Time (s)' }, { min: 0, time: true, showIf: (p) => p.FollowOrigin === 'off' }),
    ],
  },
  {
    name: 'StatusCodeCache',
    paramKey: 'StatusCodeCacheParameters',
    label: { zh: '状态码缓存 TTL', en: 'Status Code Cache TTL' },
    desc: { zh: '为指定 HTTP 状态码（如 404、500）设置独立缓存时长，减少异常状态下的回源压力。', en: 'Set a separate cache TTL for specific status codes (e.g. 404, 500) to reduce origin load during errors.' },
    group: 'cache',
    fields: [
      {
        name: 'StatusCodeCacheParams',
        label: { zh: '状态码缓存', en: 'Status Code Cache' },
        type: 'list',
        itemFields: [
          numField('StatusCode', { zh: '状态码', en: 'Status Code' }, { min: 100, max: 599 }),
          numField('CacheTime', { zh: '缓存时间（秒）', en: 'Cache Time (s)' }, { min: 0, time: true }),
        ],
        newItem: () => ({ StatusCode: 404, CacheTime: 0 }),
      },
    ],
  },
  {
    name: 'OfflineCache',
    paramKey: 'OfflineCacheParameters',
    label: { zh: '离线缓存', en: 'Offline Cache' },
    desc: { zh: '源站不可用时由边缘节点继续用已缓存内容响应，提升源站故障期间的可用性。', en: 'Keep serving cached content from the edge when the origin is unavailable, improving availability during origin failures.' },
    group: 'cache',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },

  {
    name: 'QUIC',
    paramKey: 'QUICParameters',
    label: { zh: 'HTTP/3（QUIC）', en: 'HTTP/3 (QUIC)' },
    desc: { zh: '为客户端开启 HTTP/3（QUIC）接入，基于 UDP 降低握手延迟、改善弱网体验（后付费能力，可能产生费用）。', en: 'Enable HTTP/3 (QUIC) access for clients; lower handshake latency over UDP and better weak-network performance (paid capability).' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'WebSocket',
    paramKey: 'WebSocketParameters',
    label: { zh: 'WebSocket', en: 'WebSocket' },
    desc: { zh: '开启 WebSocket 长连接支持并设置连接超时时间，用于即时通信、推送等实时业务。', en: 'Enable WebSocket long connections with a timeout, for real-time workloads such as messaging and push.' },
    group: 'network',
    fields: [
      switchField('Switch', { zh: '开关', en: 'Switch' }),
      numField('Timeout', { zh: '超时时间（秒）', en: 'Timeout (s)' }, { min: 1, showIf: (p) => p.Switch === 'on' }),
    ],
  },
  {
    name: 'SmartRouting',
    paramKey: 'SmartRoutingParameters',
    label: { zh: '智能加速', en: 'Smart Acceleration' },
    desc: { zh: '基于实时网络质量在边缘节点间选择更优回源路径，降低跨境、跨网回源延迟（后付费能力，可能产生费用）。', en: 'Pick better origin paths between edge nodes based on real-time network quality, cutting cross-region latency (paid capability).' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'AdvancedOriginRouting',
    paramKey: 'AdvancedOriginRoutingParameters',
    label: { zh: '高级回源优化', en: 'Advanced Origin Routing' },
    desc: { zh: '按指定方向优化回源链路，进一步精细化控制回源走向。', en: 'Optimize the origin-pull link in a specified direction for finer routing control.' },
    group: 'network',
    fields: [{ name: 'Direction', label: { zh: '方向', en: 'Direction' }, type: 'text' }],
  },
  {
    name: 'RangeOriginPull',
    paramKey: 'RangeOriginPullParameters',
    label: { zh: '分片回源', en: 'Range Origin-Pull' },
    desc: { zh: '按 Range 分片从源站拉取大文件，提升大文件与音视频的分发效率。', en: 'Pull large files from the origin by range, improving large-file and media delivery efficiency.' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'UpstreamHTTP2',
    paramKey: 'UpstreamHTTP2Parameters',
    label: { zh: 'HTTP/2 回源', en: 'HTTP/2 Origin-Pull' },
    desc: { zh: '使用 HTTP/2 协议回源，通过多路复用减少连接开销、提升回源效率。', en: 'Use HTTP/2 for origin-pull; multiplexing cuts connection overhead and improves efficiency.' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'HTTP2',
    paramKey: 'HTTP2Parameters',
    label: { zh: 'HTTP/2 接入', en: 'HTTP/2 Access' },
    desc: { zh: '为客户端开启 HTTP/2 接入，多路复用提升页面并发加载效率。', en: 'Enable HTTP/2 access for clients; multiplexing improves concurrent page loading.' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'Compression',
    paramKey: 'CompressionParameters',
    label: { zh: '智能压缩', en: 'Smart Compression' },
    desc: { zh: '按文件类型对响应内容做 Gzip / Brotli 压缩，减少传输体积、加快首屏呈现。', en: 'Compress responses with Gzip or Brotli to cut transfer size and speed up first paint.' },
    group: 'network',
    fields: [
      switchField('Switch', { zh: '开关', en: 'Switch' }),
      { name: 'Algorithms', label: { zh: '压缩算法', en: 'Algorithms' }, type: 'tags', options: [
        { value: 'brotli', label: { zh: 'Brotli 压缩', en: 'Brotli' } },
        { value: 'gzip', label: { zh: 'Gzip 压缩', en: 'Gzip' } },
      ], showIf: (p) => p.Switch === 'on' },
    ],
  },
  {
    name: 'ContentCompression',
    paramKey: 'ContentCompressionParameters',
    label: { zh: '内容压缩', en: 'Content Compression' },
    desc: { zh: '控制对哪些内容执行压缩传输。', en: 'Control which content types are delivered compressed.' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'PostMaxSize',
    paramKey: 'PostMaxSizeParameters',
    label: { zh: 'POST 上传大小限制', en: 'POST Max Size' },
    desc: { zh: '限制单次 POST 请求体大小，避免超大上传占用资源或被滥用。', en: 'Limit the size of a single POST body to prevent resource abuse from oversized uploads.' },
    group: 'network',
    fields: [
      switchField('Switch', { zh: '开关', en: 'Switch' }),
      numField('MaxSize', { zh: '上限值（MB）', en: 'Max Size (MB)' }, { min: 1, showIf: (p) => p.Switch === 'on' }),
    ],
  },
  {
    name: 'ResponseSpeedLimit',
    paramKey: 'ResponseSpeedLimitParameters',
    label: { zh: '单连接下载限速', en: 'Response Speed Limit' },
    desc: { zh: '对单个连接的下载速度限速，可按全过程、指定字节数或指定时间后生效，用于资源公平分配。', en: 'Throttle per-connection download speed (whole download, after N bytes, or after N seconds) for fair resource sharing.' },
    group: 'network',
    fields: [
      { name: 'Mode', label: { zh: '模式', en: 'Mode' }, type: 'select', options: [
        { value: 'LimitUponDownload', label: { zh: '全过程下载限速', en: 'Limit on whole download' } },
        { value: 'LimitAfterSpecificBytesDownloaded', label: { zh: '全速下载指定大小后限速', en: 'Limit after specified bytes' } },
        { value: 'LimitAfterSpecificSecondsDownloaded', label: { zh: '全速下载指定时间后限速', en: 'Limit after specified seconds' } },
      ] },
      { name: 'MaxSpeed', label: { zh: '最大速度', en: 'Max Speed' }, type: 'text' },
      { name: 'StartAt', label: { zh: '起始值（KB / s）', en: 'Start At (KB / s)' }, type: 'text', showIf: (p) => p.Mode === 'LimitAfterSpecificBytesDownloaded' || p.Mode === 'LimitAfterSpecificSecondsDownloaded' },
    ],
  },
  {
    name: 'Vary',
    paramKey: 'VaryParameters',
    label: { zh: 'Vary 特性', en: 'Vary' },
    desc: { zh: '开启 Vary 特性，按 Vary 请求头区分缓存副本，兼顾多端适配与缓存命中率。', en: 'Enable the Vary feature so cached copies are distinguished by the Vary request header.' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },

  {
    name: 'ForceRedirectHTTPS',
    paramKey: 'ForceRedirectHTTPSParameters',
    label: { zh: '强制 HTTPS', en: 'Forced HTTPS' },
    desc: { zh: '将 HTTP 请求以 301 / 302 强制跳转到 HTTPS，保证全站加密访问。', en: 'Force HTTP requests to HTTPS with a 301/302 redirect for site-wide encrypted access.' },
    group: 'https',
    fields: [
      switchField('Switch', { zh: '开关', en: 'Switch' }),
      { name: 'RedirectStatusCode', label: { zh: '跳转状态码', en: 'Redirect Status Code' }, type: 'select', options: [
        { value: '301', label: { zh: '301 跳转', en: '301' } },
        { value: '302', label: { zh: '302 跳转', en: '302' } },
      ], showIf: (p) => p.Switch === 'on' },
    ],
  },
  {
    name: 'OriginPullProtocol',
    paramKey: 'OriginPullProtocolParameters',
    label: { zh: '回源 HTTPS', en: 'Origin-Pull HTTPS' },
    desc: { zh: '指定回源使用的协议（HTTP / HTTPS / 协议跟随），控制边缘节点到源站的加密方式。', en: 'Choose the origin-pull protocol (HTTP, HTTPS, or follow) to control edge-to-origin encryption.' },
    group: 'https',
    fields: [{ name: 'Protocol', label: { zh: '回源协议', en: 'Origin-Pull Protocol' }, type: 'select', options: protocol }],
  },
  {
    name: 'HSTS',
    paramKey: 'HSTSParameters',
    label: { zh: 'HSTS 配置', en: 'HSTS' },
    desc: { zh: '下发 HSTS 响应头，强制浏览器后续直接使用 HTTPS 访问，支持包含子域名与预加载。', en: 'Send the HSTS header so browsers use HTTPS directly afterwards, with subdomain and preload options.' },
    group: 'https',
    fields: [
      switchField('Switch', { zh: '开关', en: 'Switch' }),
      numField('Timeout', { zh: '有效时长（秒）', en: 'Max Age (s)' }, { min: 1, time: true, showIf: (p) => p.Switch === 'on' }),
      { name: 'IncludeSubDomains', label: { zh: '包含子域名', en: 'Include Subdomains' }, type: 'select', options: onoff, showIf: (p) => p.Switch === 'on' },
      { name: 'Preload', label: { zh: '预加载', en: 'Preload' }, type: 'select', options: onoff, showIf: (p) => p.Switch === 'on' },
    ],
  },
  {
    name: 'OCSPStapling',
    paramKey: 'OCSPStaplingParameters',
    label: { zh: 'OCSP 装订', en: 'OCSP Stapling' },
    desc: { zh: '开启 OCSP 装订，减少客户端校验证书状态的额外请求，加快 TLS 握手。', en: 'Enable OCSP stapling to avoid extra certificate-status requests and speed up TLS handshakes.' },
    group: 'https',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'TLSConfig',
    paramKey: 'TLSConfigParameters',
    label: { zh: 'SSL/TLS 安全配置', en: 'SSL/TLS Security' },
    desc: { zh: '指定允许的 TLS 协议版本与密码套件，按合规要求收紧加密策略。', en: 'Restrict allowed TLS versions and cipher suites to meet compliance requirements.' },
    group: 'https',
    fields: [
      { name: 'Version', label: { zh: 'TLS 版本', en: 'TLS Version' }, type: 'tags', placeholder: { zh: '如 TLSv1.2', en: 'e.g. TLSv1.2' } },
      { name: 'CipherSuite', label: { zh: '密码套件', en: 'Cipher Suite' }, type: 'text' },
    ],
  },

  {
    name: 'ClientIPHeader',
    paramKey: 'ClientIPHeaderParameters',
    label: { zh: '客户端 IP 头部', en: 'Client IP Header' },
    desc: { zh: '在回源请求中新增自定义头，携带客户端真实 IP，便于源站获取访客地址。', en: 'Add a custom header carrying the real client IP to origin requests.' },
    group: 'header',
    fields: [
      switchField('Switch', { zh: '开关', en: 'Switch' }),
      { name: 'HeaderName', label: { zh: '头部名称', en: 'Header Name' }, type: 'text', showIf: (p) => p.Switch === 'on' },
    ],
  },
  {
    name: 'ClientIPCountry',
    paramKey: 'ClientIPCountryParameters',
    label: { zh: '客户端 IP 地理位置头部', en: 'Client IP Country Header' },
    desc: { zh: '在回源请求中新增头部，携带客户端 IP 归属地理位置，便于源站做区域化逻辑。', en: 'Add a header with the client IP geo location so the origin can apply region-aware logic.' },
    group: 'header',
    fields: [
      switchField('Switch', { zh: '开关', en: 'Switch' }),
      { name: 'HeaderName', label: { zh: '头部名称', en: 'Header Name' }, type: 'text', showIf: (p) => p.Switch === 'on' },
    ],
  },
  {
    name: 'ModifyResponseHeader',
    paramKey: 'ModifyResponseHeaderParameters',
    label: { zh: '修改 HTTP 节点响应头', en: 'Modify Response Headers' },
    desc: { zh: '对返回给客户端的响应头做设置、添加或删除，常用于安全响应头、跨域与缓存策略。', en: 'Set, add or delete response headers returned to clients, for security headers, CORS and caching policies.' },
    group: 'header',
    fields: [
      {
        name: 'HeaderActions',
        label: { zh: '响应头操作', en: 'Header Actions' },
        type: 'list',
        itemFields: [
          { name: 'Action', label: { zh: '操作', en: 'Action' }, type: 'select', options: [
            { value: 'set', label: { zh: '设置', en: 'Set' } },
            { value: 'add', label: { zh: '添加', en: 'Add' } },
            { value: 'del', label: { zh: '删除', en: 'Delete' } },
          ] },
          { name: 'Name', label: { zh: '头部名称', en: 'Header Name' }, type: 'text' },
          { name: 'Value', label: { zh: '头部值', en: 'Header Value' }, type: 'text', showIf: (p) => p.Action !== 'del' },
        ],
        newItem: () => ({ Action: 'set', Name: '', Value: '' }),
      },
    ],
  },
  {
    name: 'ModifyRequestHeader',
    paramKey: 'ModifyRequestHeaderParameters',
    label: { zh: '修改 HTTP 回源请求头', en: 'Modify Origin-Pull Request Headers' },
    desc: { zh: '对发往源站的请求头做设置、添加或删除，用于鉴权透传、改写标识等场景。', en: 'Set, add or delete request headers sent to the origin, for auth passthrough and identifier rewriting.' },
    group: 'header',
    fields: [
      {
        name: 'HeaderActions',
        label: { zh: '请求头操作', en: 'Header Actions' },
        type: 'list',
        itemFields: [
          { name: 'Action', label: { zh: '操作', en: 'Action' }, type: 'select', options: [
            { value: 'set', label: { zh: '设置', en: 'Set' } },
            { value: 'add', label: { zh: '添加', en: 'Add' } },
            { value: 'del', label: { zh: '删除', en: 'Delete' } },
          ] },
          { name: 'Name', label: { zh: '头部名称', en: 'Header Name' }, type: 'text' },
          { name: 'Value', label: { zh: '头部值', en: 'Header Value' }, type: 'text', showIf: (p) => p.Action !== 'del' },
        ],
        newItem: () => ({ Action: 'set', Name: '', Value: '' }),
      },
    ],
  },

  {
    name: 'AccessURLRedirect',
    paramKey: 'AccessURLRedirectParameters',
    label: { zh: '访问 URL 重定向', en: 'Access URL Redirect' },
    desc: { zh: '将客户端请求重定向到指定的协议、主机名与路径（路径支持正则替换），用于站点迁移与路径调整。', en: 'Redirect client requests to a specified protocol, hostname and path (regex supported), for migrations and path changes.' },
    group: 'advanced',
    fields: [
      numField('StatusCode', { zh: '状态码', en: 'Status Code' }, { min: 301, max: 308 }),
      { name: 'Protocol', label: { zh: '目标协议', en: 'Target Protocol' }, type: 'select', options: protocol },
      { name: 'HostName', label: { zh: '目标 Hostname', en: 'Target Hostname' }, type: 'group', fields: [
        { name: 'Action', label: { zh: '方式', en: 'Action' }, type: 'select', options: [
          { value: 'follow', label: { zh: '跟随请求', en: 'Follow request' } },
          { value: 'custom', label: { zh: '自定义', en: 'Custom' } },
        ] },
        { name: 'Value', label: { zh: '自定义 Hostname', en: 'Custom Hostname' }, type: 'text', showIf: (p) => p.Action === 'custom' },
      ] },
      { name: 'URLPath', label: { zh: '目标路径', en: 'Target Path' }, type: 'group', fields: [
        { name: 'Action', label: { zh: '方式', en: 'Action' }, type: 'select', options: [
          { value: 'follow', label: { zh: '跟随请求', en: 'Follow request' } },
          { value: 'custom', label: { zh: '自定义', en: 'Custom' } },
          { value: 'regex', label: { zh: '正则匹配', en: 'Regex' } },
        ] },
        { name: 'Value', label: { zh: '自定义路径', en: 'Custom Path' }, type: 'text', showIf: (p) => p.Action === 'custom' },
        { name: 'Regex', label: { zh: '正则表达式', en: 'Regex' }, type: 'text', showIf: (p) => p.Action === 'regex' },
      ] },
      { name: 'QueryString', label: { zh: '查询字符串', en: 'Query String' }, type: 'group', fields: [
        { name: 'Action', label: { zh: '方式', en: 'Action' }, type: 'select', options: [
          { value: 'full', label: { zh: '全部保留', en: 'Keep all' } },
          { value: 'ignore', label: { zh: '全部忽略', en: 'Ignore all' } },
        ] },
      ] },
    ],
  },
  {
    name: 'UpstreamURLRewrite',
    paramKey: 'UpstreamURLRewriteParameters',
    label: { zh: '回源 URL 重写', en: 'Origin URL Rewrite' },
    desc: { zh: '在不改变客户端 URL 的前提下改写回源路径：完整替换、增加/移除前缀或正则替换。', en: 'Rewrite the origin path while keeping the client URL unchanged: replace, add/remove prefix, or regex replace.' },
    group: 'advanced',
    fields: [
      { name: 'Action', label: { zh: '方式', en: 'Action' }, type: 'select', options: [
        { value: 'replace', label: { zh: '替换完整路径', en: 'Replace full path' } },
        { value: 'addPrefix', label: { zh: '增加路径前缀', en: 'Add prefix' } },
        { value: 'rmvPrefix', label: { zh: '移除路径前缀', en: 'Remove prefix' } },
        { value: 'regexReplace', label: { zh: '正则替换', en: 'Regex replace' } },
      ] },
      { name: 'Value', label: { zh: '目标值', en: 'Value' }, type: 'text', showIf: (p) => p.Action !== 'regexReplace' },
      { name: 'Regex', label: { zh: '正则表达式', en: 'Regex' }, type: 'text', showIf: (p) => p.Action === 'regexReplace' },
      { name: 'Type', label: { zh: '类型', en: 'Type' }, type: 'text', showIf: (p) => p.Type !== undefined },
    ],
  },
  {
    name: 'Authentication',
    paramKey: 'AuthenticationParameters',
    label: { zh: 'Token 鉴权', en: 'Token Authentication' },
    desc: { zh: '按 A / B / C / D / V 方式对请求做 Token 签名鉴权，防止资源被盗链。', en: 'Validate request tokens (types A/B/C/D/V) to prevent hotlinking of your resources.' },
    group: 'advanced',
    fields: [
      { name: 'AuthType', label: { zh: '鉴权方式', en: 'Auth Type' }, type: 'select', options: [
        { value: 'TypeA', label: { zh: '鉴权方式 A', en: 'Type A' } },
        { value: 'TypeB', label: { zh: '鉴权方式 B', en: 'Type B' } },
        { value: 'TypeC', label: { zh: '鉴权方式 C', en: 'Type C' } },
        { value: 'TypeD', label: { zh: '鉴权方式 D', en: 'Type D' } },
        { value: 'TypeVOD', label: { zh: '鉴权方式 V', en: 'Type V' } },
      ] },
      { name: 'SecretKey', label: { zh: '主鉴权密钥', en: 'Primary Key' }, type: 'text' },
      numField('Timeout', { zh: '有效时长（秒）', en: 'Timeout (s)' }, { min: 1, time: true }),
      { name: 'BackupSecretKey', label: { zh: '备鉴权密钥', en: 'Backup Key' }, type: 'text' },
      { name: 'AuthParam', label: { zh: '鉴权加密串参数名称', en: 'Auth Parameter Name' }, type: 'text' },
      { name: 'TimeParam', label: { zh: '时间戳参数名称', en: 'Time Parameter Name' }, type: 'text' },
      { name: 'TimeFormat', label: { zh: '时间戳格式', en: 'Time Format' }, type: 'select', options: [
        { value: 'dec', label: { zh: '十进制', en: 'Decimal' } },
        { value: 'hex', label: { zh: '十六进制', en: 'Hexadecimal' } },
      ], showIf: (p) => p.AuthType === 'TypeD' },
    ],
  },
  {
    name: 'HostHeader',
    paramKey: 'HostHeaderParameters',
    label: { zh: 'Host Header 重写', en: 'Host Header Rewrite' },
    desc: { zh: '改写回源请求的 Host 头，可跟随源站域名或指定自定义 Host / SNI。', en: 'Rewrite the Host header sent to the origin, following origins or using a custom host/SNI.' },
    group: 'advanced',
    fields: [
      { name: 'Action', label: { zh: '方式', en: 'Action' }, type: 'select', options: [
        { value: 'followOrigin', label: { zh: '跟随源站域名', en: 'Follow origin' } },
        { value: 'custom', label: { zh: '自定义', en: 'Custom' } },
      ] },
      { name: 'ServerName', label: { zh: '自定义 Host', en: 'Custom Host' }, type: 'text', showIf: (p) => p.Action === 'custom' },
    ],
  },
  {
    name: 'ModifyOrigin',
    paramKey: 'ModifyOriginParameters',
    label: { zh: '修改源站', en: 'Modify Origin' },
    desc: { zh: '为命中的请求切换回源目标：IP / 域名、源站组、负载均衡、COS 或 S3 兼容存储，并可配置私有鉴权。', en: 'Switch the origin for matched requests: IP/domain, origin group, load balancer, COS or S3-compatible storage, with private access auth.' },
    group: 'advanced',
    fields: [
      { name: 'OriginType', label: { zh: '源站类型', en: 'Origin Type' }, type: 'select', options: [
        { value: 'IPDomain', label: { zh: 'IP / 域名源站', en: 'IP / Domain' } },
        { value: 'OriginGroup', label: { zh: '源站组', en: 'Origin Group' } },
        { value: 'LoadBalance', label: { zh: '负载均衡', en: 'Load Balancer' } },
        { value: 'COS', label: { zh: '腾讯云 COS', en: 'Tencent COS' } },
        { value: 'AWSS3', label: { zh: 'AWS S3 兼容', en: 'AWS S3 Compatible' } },
      ] },
      { name: 'Origin', label: { zh: '源站地址', en: 'Origin' }, type: 'text' },
      { name: 'OriginProtocol', label: { zh: '回源协议', en: 'Origin Protocol' }, type: 'select', options: protocol, showIf: (p) => p.OriginType === 'IPDomain' },
      numField('HTTPOriginPort', { zh: 'HTTP 回源端口', en: 'HTTP Origin Port' }, { min: 1, max: 65535, showIf: (p) => p.OriginType === 'IPDomain' }),
      numField('HTTPSOriginPort', { zh: 'HTTPS 回源端口', en: 'HTTPS Origin Port' }, { min: 1, max: 65535, showIf: (p) => p.OriginType === 'IPDomain' }),
      switchField('PrivateAccess', { zh: '私有鉴权', en: 'Private Access' }),
      { name: 'PrivateParameters', label: { zh: '私有鉴权参数', en: 'Private Parameters' }, type: 'group', showIf: (p) => p.PrivateAccess === 'on', fields: [
        { name: 'AccessKeyId', label: { zh: 'AccessKeyId', en: 'AccessKeyId' }, type: 'text' },
        { name: 'SecretAccessKey', label: { zh: 'SecretAccessKey', en: 'SecretAccessKey' }, type: 'text' },
        { name: 'SignatureVersion', label: { zh: '签名版本', en: 'Signature Version' }, type: 'select', options: [
          { value: 'v2', label: { zh: 'v2 版本', en: 'v2' } },
          { value: 'v4', label: { zh: 'v4 版本', en: 'v4' } },
        ] },
        { name: 'Region', label: { zh: '地域', en: 'Region' }, type: 'text' },
      ] },
    ],
  },
  {
    name: 'SiteFailover',
    paramKey: 'SiteFailoverParameters',
    label: { zh: '源站故障转移', en: 'Origin Failover' },
    desc: { zh: '当源站返回指定状态码时自动转移：回源到备用地址、COS / S3、重定向或返回自定义响应页面。', en: 'On specific origin status codes, fail over automatically to a backup host, COS/S3, a redirect, or a custom response page.' },
    group: 'advanced',
    fields: [
      { name: 'SiteFailoverStatusCodes', label: { zh: '触发状态码', en: 'Status Codes' }, type: 'tags', placeholder: { zh: '如 4xx / 5xx', en: 'e.g. 4xx / 5xx' } },
      {
        name: 'SiteFailoverParams',
        label: { zh: '故障转移配置', en: 'Failover Rules' },
        type: 'list',
        itemFields: [
          { name: 'Mode', label: { zh: '转移方式', en: 'Mode' }, type: 'select', options: [
            { value: 'FailoverToHost', label: { zh: '回源到指定 IP/域名', en: 'Failover to host' } },
            { value: 'FailoverToCOS', label: { zh: '回源到腾讯云 COS', en: 'Failover to COS' } },
            { value: 'FailoverToS3CompatibleObjectStorage', label: { zh: '回源到 S3 兼容', en: 'Failover to S3' } },
            { value: 'FailoverRedirectToURL', label: { zh: '重定向至指定 URL', en: 'Redirect to URL' } },
            { value: 'FailoverCustomResponsePage', label: { zh: '使用自定义响应页面', en: 'Custom response page' } },
          ] },
          { name: 'Origin', label: { zh: '源站地址', en: 'Origin' }, type: 'text', showIf: (p) => p.Mode === 'FailoverToHost' || p.Mode === 'FailoverToCOS' || p.Mode === 'FailoverToS3CompatibleObjectStorage' },
          { name: 'OriginProtocol', label: { zh: '回源协议', en: 'Origin Protocol' }, type: 'select', options: protocol, showIf: (p) => p.Mode === 'FailoverToHost' },
          numField('HTTPOriginPort', { zh: 'HTTP 回源端口', en: 'HTTP Origin Port' }, { min: 1, max: 65535, showIf: (p) => p.Mode === 'FailoverToHost' }),
          numField('HTTPSOriginPort', { zh: 'HTTPS 回源端口', en: 'HTTPS Origin Port' }, { min: 1, max: 65535, showIf: (p) => p.Mode === 'FailoverToHost' }),
          { name: 'RedirectURL', label: { zh: '重定向 URL', en: 'Redirect URL' }, type: 'text', showIf: (p) => p.Mode === 'FailoverRedirectToURL' },
          { name: 'ResponsePageId', label: { zh: '响应页面 ID', en: 'Response Page ID' }, type: 'text', showIf: (p) => p.Mode === 'FailoverCustomResponsePage' },
          numField('StatusCode', { zh: '状态码', en: 'Status Code' }, { showIf: (p) => p.Mode === 'FailoverRedirectToURL' || p.Mode === 'FailoverCustomResponsePage' }),
        ],
        newItem: () => ({ Mode: 'FailoverToHost', Origin: '', OriginProtocol: 'http' }),
      },
    ],
  },
  {
    name: 'HTTPUpstreamTimeout',
    paramKey: 'HTTPUpstreamTimeoutParameters',
    label: { zh: '七层回源超时', en: 'Origin-Pull Timeout' },
    desc: { zh: '设置回源响应超时时间，避免慢源站长期占用连接（流式大模型接口建议放宽到 300 秒以上）。', en: 'Set the origin response timeout so slow origins do not hold connections (relax to 300s or more for streaming LLM APIs).' },
    group: 'advanced',
    fields: [numField('ResponseTimeout', { zh: '回源响应超时时间（秒）', en: 'Response Timeout (s)' }, { min: 1 })],
  },
  {
    name: 'HttpResponse',
    paramKey: 'HTTPResponseParameters',
    label: { zh: 'HTTP 应答', en: 'HTTP Response' },
    desc: { zh: '直接由边缘节点返回指定状态码与响应页面，用于维护页、灰度拦截等场景。', en: 'Return a fixed status code and response page directly from the edge, for maintenance pages or blocking.' },
    group: 'advanced',
    fields: [
      numField('StatusCode', { zh: '响应状态码', en: 'Status Code' }, { min: 100, max: 599 }),
      { name: 'ResponsePage', label: { zh: '响应页面', en: 'Response Page' }, type: 'text' },
    ],
  },
  {
    name: 'ErrorPage',
    paramKey: 'ErrorPageParameters',
    label: { zh: '自定义错误页面', en: 'Custom Error Page' },
    desc: { zh: '为指定错误状态码（4xx / 5xx）配置跳转 URL，统一品牌化的错误提示。', en: 'Configure a redirect URL for specific error codes (4xx/5xx) for branded error pages.' },
    group: 'advanced',
    fields: [
      {
        name: 'ErrorPageParams',
        label: { zh: '错误页面配置', en: 'Error Page Rules' },
        type: 'list',
        itemFields: [
          numField('StatusCode', { zh: '状态码', en: 'Status Code' }, { min: 400, max: 599 }),
          { name: 'RedirectURL', label: { zh: '跳转 URL', en: 'Redirect URL' }, type: 'text' },
        ],
        newItem: () => ({ StatusCode: 404, RedirectURL: '' }),
      },
    ],
  },
  {
    name: 'UpstreamFollowRedirect',
    paramKey: 'UpstreamFollowRedirectParameters',
    label: { zh: '回源跟随重定向', en: 'Origin-Pull Follow Redirect' },
    desc: { zh: '源站返回 3xx 时由边缘节点自动跟随跳转，并可设置最大跟随次数。', en: 'Let the edge follow origin 3xx redirects automatically, with a maximum follow count.' },
    group: 'advanced',
    fields: [
      switchField('Switch', { zh: '开关', en: 'Switch' }),
      numField('MaxTimes', { zh: '最大跟随次数', en: 'Max Follow Times' }, { min: 1, showIf: (p) => p.Switch === 'on' }),
    ],
  },
  {
    name: 'UpstreamRequest',
    paramKey: 'UpstreamRequestParameters',
    label: { zh: '回源请求参数', en: 'Origin-Pull Request' },
    desc: { zh: '控制回源时携带哪些查询字符串与 Cookie，避免无意义参数污染回源与缓存。', en: 'Control which query strings and cookies are forwarded to the origin.' },
    group: 'advanced',
    fields: [
      { name: 'QueryString', label: { zh: '查询字符串', en: 'Query String' }, type: 'group', fields: [
        switchField('Switch', { zh: '开关', en: 'Switch' }),
        { name: 'Action', label: { zh: '模式', en: 'Mode' }, type: 'select', options: cacheKeyQueryMode, showIf: (p) => p.Switch === 'on' },
        { name: 'Values', label: { zh: '参数名', en: 'Parameter Names' }, type: 'tags', showIf: (p) => p.Switch === 'on' && (p.Action === 'includeCustom' || p.Action === 'excludeCustom') },
      ] },
      { name: 'Cookie', label: { zh: 'Cookie', en: 'Cookie' }, type: 'group', fields: [
        switchField('Switch', { zh: '开关', en: 'Switch' }),
        { name: 'Action', label: { zh: '模式', en: 'Mode' }, type: 'select', options: cacheKeyQueryMode, showIf: (p) => p.Switch === 'on' },
        { name: 'Values', label: { zh: 'Cookie 名称', en: 'Cookie Names' }, type: 'tags', showIf: (p) => p.Switch === 'on' && (p.Action === 'includeCustom' || p.Action === 'excludeCustom') },
      ] },
    ],
  },
  {
    name: 'Shield',
    paramKey: 'ShieldParameters',
    label: { zh: '源站卸载', en: 'Origin Shield' },
    desc: { zh: '指定源站卸载空间，将回源请求汇聚到中间层，降低源站压力。', en: 'Specify an origin shield space so origin pulls are aggregated through a middle layer, reducing origin load.' },
    group: 'advanced',
    fields: [{ name: 'ShieldSpaceId', label: { zh: '源站卸载空间 ID', en: 'Shield Space ID' }, type: 'text' }],
  },
  {
    name: 'SetContentIdentifier',
    paramKey: 'SetContentIdentifierParameters',
    label: { zh: '设置内容标识符', en: 'Set Content Identifier' },
    desc: { zh: '为响应设置内容标识符，供日志与监控区分内容类型。', en: 'Set a content identifier on responses so logs and monitoring can classify content.' },
    group: 'advanced',
    fields: [{ name: 'ContentIdentifier', label: { zh: '内容标识符', en: 'Content Identifier' }, type: 'text' }],
  },
  {
    name: 'OriginAuthentication',
    paramKey: 'OriginAuthenticationParameters',
    label: { zh: '回源鉴权', en: 'Origin Authentication' },
    desc: { zh: '在回源请求中附加鉴权属性（类型 / 名称 / 值），满足源站自身的鉴权要求。', en: 'Attach authentication properties (type/name/value) to origin requests to satisfy origin-side auth.' },
    group: 'advanced',
    fields: [
      {
        name: 'RequestProperties',
        label: { zh: '鉴权请求属性', en: 'Request Properties' },
        type: 'list',
        itemFields: [
          { name: 'Type', label: { zh: '类型', en: 'Type' }, type: 'text' },
          { name: 'Name', label: { zh: '名称', en: 'Name' }, type: 'text' },
          { name: 'Value', label: { zh: '值', en: 'Value' }, type: 'text' },
        ],
        newItem: () => ({ Type: '', Name: '', Value: '' }),
      },
    ],
  },
];

export function eoActionSchema(name: string): EoActionSchema | undefined {
  return EO_ACTION_SCHEMAS.find((s) => s.name === name);
}

/** 依据操作名取得参数字段表；未收录的操作回退为「通用对象编辑」 */
export function eoActionFields(name: string): EoField[] {
  return eoActionSchema(name)?.fields || [];
}

/** 操作名 → 参数键（默认 `${name}Parameters`） */
export function eoParamKey(name: string): string {
  return eoActionSchema(name)?.paramKey || name + 'Parameters';
}
