// 腾讯云 EdgeOne 规则引擎「新建规则」本项目预制模板。
//
// 结构与官方预制规则（eoPresetRules.ts）保持一致：
//   最外层 IF 只做 HOST（站点域名）匹配且匹配值留空 —— 用户选中模板后进入编辑页，
//   在最上方选择自己的站点域名；真正的匹配条件与操作作为 ELSE IF 子分支。
// 规则描述（Description）写入模板介绍，子分支注释说明该分支做什么，编辑页与控制台均可读。
// 注意：模板不启用智能加速（SmartRouting）与 HTTP/3（QUIC）等后付费功能。
import type { Bi } from './eoRuleSchema';
import type { EoLocale } from './eoRuleMeta';

export interface EoRuleTemplate {
  id: string;
  label: Bi;
  desc: Bi;
  /** 生成官方 RuleEngineItem（时间字段一律以秒表达，域名留空待用户选择） */
  build: (locale: EoLocale) => Record<string, any>;
}

/** 最外层 HOST 匹配值留空：由用户填入自己的站点域名（与官方预制规则一致） */
const HOST_BLANK = '${http.request.host} in []';

const DAY = 86400;

// ---------- 条件表达式片段 ----------
const extIn = (exts: string[]) => `lower(\${http.request.file_extension}) in [${exts.map((e) => `'${e}'`).join(', ')}]`;
const methodIn = (methods: string[]) => `\${http.request.method} in [${methods.map((m) => `'${m}'`).join(', ')}]`;
const pathMatches = (re: string) => `\${http.request.uri.path} matches '${re}'`;

// ---------- 操作片段（官方 RuleEngineAction） ----------
const cacheCustom = (seconds: number, ignoreCacheControl = true) => ({
  Name: 'Cache',
  CacheParameters: { CustomTime: { Switch: 'on', IgnoreCacheControl: ignoreCacheControl ? 'on' : 'off', CacheTime: seconds } },
});
const cacheNoCache = () => ({ Name: 'Cache', CacheParameters: { NoCache: { Switch: 'on' } } });
const cacheKeyIgnoreQuery = () => ({ Name: 'CacheKey', CacheKeyParameters: { QueryString: { Switch: 'off' } } });
const maxAge = (seconds: number) => ({ Name: 'MaxAge', MaxAgeParameters: { FollowOrigin: 'off', CacheTime: seconds } });
const rangeOriginPull = () => ({ Name: 'RangeOriginPull', RangeOriginPullParameters: { Switch: 'on' } });
const compression = () => ({ Name: 'Compression', CompressionParameters: { Switch: 'on', Algorithms: ['gzip', 'brotli'] } });
const http2 = () => ({ Name: 'HTTP2', HTTP2Parameters: { Switch: 'on' } });
const upstreamTimeout = (seconds: number) => ({ Name: 'HTTPUpstreamTimeout', HTTPUpstreamTimeoutParameters: { ResponseTimeout: seconds } });

const STATIC_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'css', 'js', 'mjs', 'woff', 'woff2', 'ttf', 'otf', 'eot'];
const MEDIA_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'mp4', 'webm', 'mov', 'm4v', 'ts', 'mp3', 'aac', 'flac', 'wav'];

/** 组装官方 RuleEngineItem：IF = 站点域名（留空待选），ELSE IF = 模板条件与操作 */
function item(opts: {
  locale: EoLocale;
  name: Bi;
  intro: Bi;
  step: Bi;
  condition: string;
  actions: Record<string, any>[];
}): Record<string, any> {
  const pick = (b: Bi) => (opts.locale === 'zh' ? b.zh : b.en);
  return {
    RuleName: pick(opts.name),
    Status: 'enable',
    Branches: [
      {
        Condition: HOST_BLANK,
        SubRules: [
          {
            Branches: [{ Condition: opts.condition, Actions: opts.actions }],
            Description: [pick(opts.step)],
          },
        ],
      },
    ],
    // 规则描述即模板介绍：编辑页显示为 IF 分支注释，控制台可见
    Description: [pick(opts.intro)],
  };
}

/** 模板定义：卡片展示用的 label / desc 同时作为规则介绍写入配置 */
function tpl(id: string, label: Bi, desc: Bi, step: Bi, condition: string, actions: Record<string, any>[]): EoRuleTemplate {
  return {
    id,
    label,
    desc,
    build: (locale: EoLocale) => item({ locale, name: label, intro: desc, step, condition, actions }),
  };
}

export const EO_RULE_TEMPLATES: EoRuleTemplate[] = [
  tpl(
    'ai-api',
    { zh: 'AI API 直通回源', en: 'AI API Passthrough' },
    {
      zh: '匹配 /v1/ 等 AI 接口路径：不缓存、开启 HTTP/2 与长回源超时，适配大模型流式响应',
      en: 'Match /v1/ style AI endpoints: no cache, HTTP/2 and a long origin timeout for streaming LLM responses',
    },
    { zh: 'AI 接口路径不缓存，并放宽回源超时至 300 秒', en: 'No cache for AI endpoints, origin timeout raised to 300s' },
    pathMatches('^/v1/'),
    [cacheNoCache(), http2(), upstreamTimeout(300)],
  ),
  tpl(
    'static-site',
    { zh: '全站静态缓存', en: 'Whole-site Static Cache' },
    {
      zh: 'GET 请求统一缓存 7 天，适合纯静态站点；如站点含动态接口请再补一条不缓存规则',
      en: 'Cache all GET requests for 7 days, for fully static sites; add a no-cache rule if the site has dynamic APIs',
    },
    { zh: 'GET 请求缓存 7 天并开启 Brotli / Gzip 压缩', en: 'Cache GET requests for 7 days with Brotli / Gzip compression' },
    methodIn(['GET']),
    [cacheCustom(7 * DAY, true), maxAge(7 * DAY), compression()],
  ),
  tpl(
    'static-assets',
    { zh: '常规静态资源缓存', en: 'Common Static Assets Cache' },
    {
      zh: '按文件后缀（图片 / CSS / JS / 字体）缓存 30 天，忽略查询字符串，长缓存首选',
      en: 'Cache by file extension (images / CSS / JS / fonts) for 30 days, ignoring query strings',
    },
    { zh: '静态资源缓存 30 天，Cache Key 忽略查询字符串', en: 'Cache static assets for 30 days, cache key ignores query string' },
    extIn(STATIC_EXT),
    [cacheCustom(30 * DAY, true), cacheKeyIgnoreQuery(), maxAge(30 * DAY), compression(), rangeOriginPull()],
  ),
  tpl(
    'media',
    { zh: '图片与音视频加速', en: 'Image & Media Acceleration' },
    {
      zh: '图片与音视频文件缓存 30 天并开启分片回源，提升大文件分发体验',
      en: 'Cache images and audio/video for 30 days with range origin-pull for large files',
    },
    { zh: '媒体文件缓存 30 天并开启分片回源', en: 'Cache media for 30 days with range origin-pull' },
    extIn(MEDIA_EXT),
    [cacheCustom(30 * DAY, true), maxAge(30 * DAY), rangeOriginPull()],
  ),
  tpl(
    'html-short',
    { zh: 'HTML 页面短缓存', en: 'HTML Short Cache' },
    {
      zh: 'HTML 页面缓存 1 小时，兼顾回源压力与内容更新时效',
      en: 'Cache HTML pages for 1 hour, balancing origin load and content freshness',
    },
    { zh: 'HTML 页面缓存 1 小时', en: 'Cache HTML pages for 1 hour' },
    extIn(['html', 'htm']),
    [cacheCustom(60 * 60, false), maxAge(60 * 60), compression()],
  ),
  tpl(
    'api-no-cache',
    { zh: 'API 动态内容不缓存', en: 'Dynamic API No Cache' },
    {
      zh: '匹配 /api/ 接口路径：不缓存，开启 HTTP/2',
      en: 'Match /api/ endpoints: no cache, enable HTTP/2',
    },
    { zh: '/api/ 接口不缓存并开启 HTTP/2', en: 'No cache for /api/ endpoints, HTTP/2 enabled' },
    pathMatches('^/api/'),
    [cacheNoCache(), http2()],
  ),
];
