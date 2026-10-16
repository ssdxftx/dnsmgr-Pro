// 腾讯云 EdgeOne 规则引擎「新建规则」预制模板。
// 每个模板直接产出官方 RuleEngineItem（{ RuleName, Status, Branches }），
// 由 RuleEditor 解析为可视化结构；参数与 eoRuleSchema.ts 字段表一一对应。
// 用户可在生成后继续编辑，模板本身只提供一份合理的起点。
// 注意：模板不启用智能加速（SmartRouting）与 HTTP/3（QUIC）等后付费功能。
import type { EoLocale } from './eoRuleMeta';

interface Bi {
  zh: string;
  en: string;
}

export interface EoRuleTemplate {
  id: string;
  label: Bi;
  desc: Bi;
  /** 生成官方 RuleEngineItem（时间字段一律以秒表达） */
  build: (locale: EoLocale) => Record<string, any>;
}

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

function item(locale: EoLocale, name: Bi, root: Record<string, any>): Record<string, any> {
  return { RuleName: locale === 'zh' ? name.zh : name.en, Status: 'enable', Branches: [root], Description: [] };
}

export const EO_RULE_TEMPLATES: EoRuleTemplate[] = [
  {
    id: 'ai-api',
    label: { zh: 'AI API 直通回源', en: 'AI API Passthrough' },
    desc: {
      zh: '匹配 /v1/ 等 AI 接口路径：不缓存、开启 HTTP/2 与长回源超时，适配大模型流式响应',
      en: 'Match /v1/ style AI endpoints: no cache, HTTP/2 and a long origin timeout for streaming LLM responses',
    },
    build: (locale) =>
      item(locale, { zh: 'AI API 直通回源', en: 'AI API Passthrough' }, {
        Condition: pathMatches('^/v1/'),
        Actions: [cacheNoCache(), http2(), upstreamTimeout(300)],
      }),
  },
  {
    id: 'static-site',
    label: { zh: '全站静态缓存', en: 'Whole-site Static Cache' },
    desc: {
      zh: 'GET 请求统一缓存 7 天，适合纯静态站点；如站点含动态接口请再补一条不缓存规则',
      en: 'Cache all GET requests for 7 days, for fully static sites; add a no-cache rule if the site has dynamic APIs',
    },
    build: (locale) =>
      item(locale, { zh: '全站静态缓存', en: 'Whole-site Static Cache' }, {
        Condition: methodIn(['GET']),
        Actions: [cacheCustom(7 * DAY, true), maxAge(7 * DAY), compression()],
      }),
  },
  {
    id: 'static-assets',
    label: { zh: '常规静态资源缓存', en: 'Common Static Assets Cache' },
    desc: {
      zh: '按文件后缀（图片 / CSS / JS / 字体）缓存 30 天，忽略查询字符串，长缓存首选',
      en: 'Cache by file extension (images / CSS / JS / fonts) for 30 days, ignoring query strings',
    },
    build: (locale) =>
      item(locale, { zh: '常规静态资源缓存', en: 'Common Static Assets Cache' }, {
        Condition: extIn(STATIC_EXT),
        Actions: [cacheCustom(30 * DAY, true), cacheKeyIgnoreQuery(), maxAge(30 * DAY), compression(), rangeOriginPull()],
      }),
  },
  {
    id: 'media',
    label: { zh: '图片与音视频加速', en: 'Image & Media Acceleration' },
    desc: {
      zh: '图片与音视频文件缓存 30 天并开启分片回源，提升大文件分发体验',
      en: 'Cache images and audio/video for 30 days with range origin-pull for large files',
    },
    build: (locale) =>
      item(locale, { zh: '图片与音视频加速', en: 'Image & Media Acceleration' }, {
        Condition: extIn(MEDIA_EXT),
        Actions: [cacheCustom(30 * DAY, true), maxAge(30 * DAY), rangeOriginPull()],
      }),
  },
  {
    id: 'html-short',
    label: { zh: 'HTML 页面短缓存', en: 'HTML Short Cache' },
    desc: {
      zh: 'HTML 页面缓存 1 小时，兼顾回源压力与内容更新时效',
      en: 'Cache HTML pages for 1 hour, balancing origin load and content freshness',
    },
    build: (locale) =>
      item(locale, { zh: 'HTML 页面短缓存', en: 'HTML Short Cache' }, {
        Condition: extIn(['html', 'htm']),
        Actions: [cacheCustom(60 * 60, false), maxAge(60 * 60), compression()],
      }),
  },
  {
    id: 'api-no-cache',
    label: { zh: 'API 动态内容不缓存', en: 'Dynamic API No Cache' },
    desc: {
      zh: '匹配 /api/ 接口路径：不缓存，开启 HTTP/2',
      en: 'Match /api/ endpoints: no cache, enable HTTP/2',
    },
    build: (locale) =>
      item(locale, { zh: 'API 动态内容不缓存', en: 'Dynamic API No Cache' }, {
        Condition: pathMatches('^/api/'),
        Actions: [cacheNoCache(), http2()],
      }),
  },
];