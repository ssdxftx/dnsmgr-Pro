// 腾讯云 EdgeOne 七层加速规则（L7Acc）操作字段表。
// 字段与官方 SDK（teo v20220901）RuleEngineAction 各 <Name>Parameters 结构一一对应，
// 中文名取自官方控制台「规则引擎」编辑页。前端据此为每个操作渲染与官方一致的专用表单。
// 数据来源：tencentcloud-sdk-nodejs-teo teo_models.d.ts（CreateL7AccRules/DescribeL7AccRules）。
import type { EoLocale } from './eoRuleMeta';

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
    group: 'cache',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },

  {
    name: 'QUIC',
    paramKey: 'QUICParameters',
    label: { zh: 'HTTP/3（QUIC）', en: 'HTTP/3 (QUIC)' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'WebSocket',
    paramKey: 'WebSocketParameters',
    label: { zh: 'WebSocket', en: 'WebSocket' },
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
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'AdvancedOriginRouting',
    paramKey: 'AdvancedOriginRoutingParameters',
    label: { zh: '高级回源优化', en: 'Advanced Origin Routing' },
    group: 'network',
    fields: [{ name: 'Direction', label: { zh: '方向', en: 'Direction' }, type: 'text' }],
  },
  {
    name: 'RangeOriginPull',
    paramKey: 'RangeOriginPullParameters',
    label: { zh: '分片回源', en: 'Range Origin-Pull' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'UpstreamHTTP2',
    paramKey: 'UpstreamHTTP2Parameters',
    label: { zh: 'HTTP/2 回源', en: 'HTTP/2 Origin-Pull' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'HTTP2',
    paramKey: 'HTTP2Parameters',
    label: { zh: 'HTTP/2 接入', en: 'HTTP/2 Access' },
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'Compression',
    paramKey: 'CompressionParameters',
    label: { zh: '智能压缩', en: 'Smart Compression' },
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
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'PostMaxSize',
    paramKey: 'PostMaxSizeParameters',
    label: { zh: 'POST 上传大小限制', en: 'POST Max Size' },
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
    group: 'network',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },

  {
    name: 'ForceRedirectHTTPS',
    paramKey: 'ForceRedirectHTTPSParameters',
    label: { zh: '强制 HTTPS', en: 'Forced HTTPS' },
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
    group: 'https',
    fields: [{ name: 'Protocol', label: { zh: '回源协议', en: 'Origin-Pull Protocol' }, type: 'select', options: protocol }],
  },
  {
    name: 'HSTS',
    paramKey: 'HSTSParameters',
    label: { zh: 'HSTS 配置', en: 'HSTS' },
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
    group: 'https',
    fields: [switchField('Switch', { zh: '开关', en: 'Switch' })],
  },
  {
    name: 'TLSConfig',
    paramKey: 'TLSConfigParameters',
    label: { zh: 'SSL/TLS 安全配置', en: 'SSL/TLS Security' },
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
    group: 'advanced',
    fields: [numField('ResponseTimeout', { zh: '回源响应超时时间（秒）', en: 'Response Timeout (s)' }, { min: 1 })],
  },
  {
    name: 'HttpResponse',
    paramKey: 'HTTPResponseParameters',
    label: { zh: 'HTTP 应答', en: 'HTTP Response' },
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
    group: 'advanced',
    fields: [{ name: 'ShieldSpaceId', label: { zh: '源站卸载空间 ID', en: 'Shield Space ID' }, type: 'text' }],
  },
  {
    name: 'SetContentIdentifier',
    paramKey: 'SetContentIdentifierParameters',
    label: { zh: '设置内容标识符', en: 'Set Content Identifier' },
    group: 'advanced',
    fields: [{ name: 'ContentIdentifier', label: { zh: '内容标识符', en: 'Content Identifier' }, type: 'text' }],
  },
  {
    name: 'OriginAuthentication',
    paramKey: 'OriginAuthenticationParameters',
    label: { zh: '回源鉴权', en: 'Origin Authentication' },
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

export function eoFieldLabel(f: EoField, locale: EoLocale): string {
  return locale === 'zh' ? f.label.zh : f.label.en;
}

export function eoOptionLabel(o: EoFieldOption, locale: EoLocale): string {
  return locale === 'zh' ? o.label.zh : o.label.en;
}
