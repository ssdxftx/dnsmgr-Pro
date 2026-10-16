// 腾讯云 EdgeOne 控制台「预设规则模板」的官方预制规则（5 套，与官方控制台一一对应）。
//
// 数据来源：官方控制台导出件，落在 ./eoPresets/*.json，除下列三处外保持原样：
//  1. 导出件内含导出者的域名（HOST 匹配值），已在文件中置空，交由用户填写自己的站点域名；
//     加载时仍会再清空一次（见 stripHostValues），避免后续替换文件时带出域名。
//  2. 时间数值为控制台默认展示单位「小时」，导入时按官方 API 语义统一换算为秒（见 toSeconds）。
//  3. 官方导出件未带注释：这里补上模板介绍（规则描述）与各分支说明（见 applyDescriptions），
//     编辑页的「注释」与控制台均可见。
// 规则名、条件表达式、操作与参数键均与官方一致，用户选中后可在编辑器中继续调整。
import type { EoLocale } from './eoRuleMeta';
import { eoActionFields, eoParamKey, type Bi } from './eoRuleSchema';
import { scaleTimeFields, timeFactor, type TimeUnit } from './eoTime';
import liveStreaming from './eoPresets/live-streaming.json';
import vod from './eoPresets/vod.json';
import largeFileDownload from './eoPresets/large-file-download.json';
import siteAcceleration from './eoPresets/site-acceleration.json';
import wordpress from './eoPresets/wordpress.json';

/** 官方导出件中的时间数值所用单位（控制台默认按小时展示；官方 API 与本地存储一律为秒） */
const PRESET_TIME_UNIT: TimeUnit = 'h';

export interface EoPresetRule {
  id: string;
  label: Bi;
  desc: Bi;
  /** 生成官方 RuleEngineItem 包裹（{ FormatVersion, Rules: [item] }），时间字段已换算为秒 */
  build: (locale: EoLocale) => Record<string, any>;
}

const pick = (b: Bi, locale: EoLocale) => (locale === 'zh' ? b.zh : b.en);

/** HOST 匹配值列表：官方表达式形如 ${http.request.host} in ['example.com']（可带 lower()） */
const HOST_VALUES_RE = /\$\{http\.request\.host\}\s+(?:not\s+in|in)\s+\[[^\]]*\]/g;

/** 清空 HOST 匹配值：官方导出件带导出者域名，导入后应由用户填写自己的站点域名 */
function stripHostValues(node: any): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const it of node) stripHostValues(it);
    return;
  }
  if (typeof node.Condition === 'string') {
    node.Condition = node.Condition.replace(HOST_VALUES_RE, (m) => m.replace(/\[[^\]]*\]$/, '[]'));
  }
  for (const key of Object.keys(node)) {
    if (key === 'Condition') continue;
    const v = node[key];
    if (v && typeof v === 'object') stripHostValues(v);
  }
}

/** 时间字段由展示单位换算为秒（分组 / oneof / 列表结构递归处理） */
function toSeconds(node: any): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const it of node) toSeconds(it);
    return;
  }
  for (const action of Array.isArray(node.Actions) ? node.Actions : []) {
    const name = String(action?.Name || '');
    if (!name) continue;
    const key = eoParamKey(name);
    const params = action[key];
    if (params && typeof params === 'object') scaleTimeFields(eoActionFields(name), params, timeFactor(PRESET_TIME_UNIT));
  }
  for (const key of Object.keys(node)) {
    if (key === 'Actions') continue;
    const v = node[key];
    if (v && typeof v === 'object') toSeconds(v);
  }
}

/** 补上介绍：规则描述写模板介绍（编辑页显示为 IF 分支注释），ELSE IF 子分支写该分支做什么 */
function applyDescriptions(rule: any, locale: EoLocale, intro: Bi, branchComments: Bi[]): void {
  rule.Description = [pick(intro, locale)];
  const subs: any[] = Array.isArray(rule.Branches?.[0]?.SubRules) ? rule.Branches[0].SubRules : [];
  subs.forEach((sub: any, i: number) => {
    const comment = branchComments[i];
    if (sub && typeof sub === 'object' && comment) sub.Description = [pick(comment, locale)];
  });
}

function prepare(raw: any, locale: EoLocale, name: Bi, intro: Bi, branchComments: Bi[]): Record<string, any> {
  const doc = JSON.parse(JSON.stringify(raw));
  const list: any[] = Array.isArray(doc?.Rules) ? doc.Rules : [];
  for (const rule of list) {
    if (!rule || typeof rule !== 'object') continue;
    rule.RuleName = pick(name, locale);
    applyDescriptions(rule, locale, intro, branchComments);
    stripHostValues(rule);
    toSeconds(rule);
  }
  return doc;
}

/** 预设定义：卡片展示用的 label / desc 同时作为规则名与规则介绍写入配置 */
function preset(id: string, label: Bi, desc: Bi, branchComments: Bi[], raw: any): EoPresetRule {
  return { id, label, desc, build: (locale: EoLocale) => prepare(raw, locale, label, desc, branchComments) };
}

export const EO_PRESET_RULES: EoPresetRule[] = [
  preset(
    'official-live-streaming',
    { zh: '音视频直播', en: 'Live Video Streaming' },
    {
      zh: '官方模板：播放列表（m3u8 / mpd）与直播切片（ts / mp4 等）分别缓存 1 小时，其余请求遵循源站 Cache-Control，兼顾直播时延与回源压力',
      en: 'Official template: cache playlists (m3u8 / mpd) and live segments (ts / mp4 etc.) for 1 hour each, follow origin Cache-Control otherwise',
    },
    [
      { zh: '播放列表（m3u8 / mpd）缓存 1 小时', en: 'Cache playlists (m3u8 / mpd) for 1 hour' },
      { zh: '直播切片（ts / mp4 / m4a / m4s）缓存 1 小时', en: 'Cache live segments (ts / mp4 / m4a / m4s) for 1 hour' },
      { zh: '其余请求：遵循源站 Cache-Control', en: 'Other requests: follow origin Cache-Control' },
    ],
    liveStreaming,
  ),
  preset(
    'official-vod',
    { zh: '音视频点播', en: 'Video on Demand' },
    {
      zh: '官方模板：点播音视频缓存 1 小时并开启分片回源，Cache Key 忽略查询字符串；php / jsp 等动态文件不缓存',
      en: 'Official template: cache VOD media for 1 hour with range origin-pull and query-string-free cache key; no cache for dynamic files',
    },
    [{ zh: 'php / jsp / asp / aspx 动态文件不缓存', en: 'No cache for dynamic files (php / jsp / asp / aspx)' }],
    vod,
  ),
  preset(
    'official-large-file-download',
    { zh: '大文件下载', en: 'Large File Download' },
    {
      zh: '官方模板：下载类大文件缓存 1 小时，关闭查询字符串 Cache Key 并开启分片回源，避免下载中断；动态文件不缓存',
      en: 'Official template: cache large downloads for 1 hour with query-string-free cache key and range origin-pull; no cache for dynamic files',
    },
    [{ zh: 'php / jsp / asp / aspx 动态文件不缓存', en: 'No cache for dynamic files (php / jsp / asp / aspx)' }],
    largeFileDownload,
  ),
  preset(
    'official-site-acceleration',
    { zh: '网站加速', en: 'Website Acceleration' },
    {
      zh: '官方模板：全站遵循源站缓存，php / jsp 等动态文件不缓存，图片等静态资源浏览器缓存 1 小时',
      en: 'Official template: follow origin caching site-wide, no cache for dynamic files, browser cache 1 hour for images',
    },
    [
      { zh: 'php / jsp / asp / aspx 动态文件不缓存', en: 'No cache for dynamic files (php / jsp / asp / aspx)' },
      { zh: '图片等静态资源浏览器缓存 1 小时', en: 'Browser cache 1 hour for images and other static assets' },
    ],
    siteAcceleration,
  ),
  preset(
    'official-wordpress',
    { zh: 'WordPress 建站', en: 'WordPress Site' },
    {
      zh: '官方模板：/wp-admin 与动态后缀不缓存，静态资源（图片 / 脚本 / 样式 / 压缩包等）节点缓存 7 小时，其余遵循源站',
      en: 'Official template: no cache for /wp-admin and dynamic files, node cache 7 hours for static assets, follow origin otherwise',
    },
    [
      { zh: '静态资源（图片 / 脚本 / 样式 / 压缩包等）节点缓存 7 小时', en: 'Node cache 7 hours for static assets' },
      { zh: '首页不缓存', en: 'No cache for the home page' },
      { zh: 'asp / jsp / php 等动态后缀不缓存', en: 'No cache for dynamic extensions (asp / jsp / php etc.)' },
      { zh: '/wp-admin 后台目录不缓存', en: 'No cache for the /wp-admin directory' },
      { zh: '其余请求：遵循源站 Cache-Control', en: 'Other requests: follow origin Cache-Control' },
    ],
    wordpress,
  ),
];
