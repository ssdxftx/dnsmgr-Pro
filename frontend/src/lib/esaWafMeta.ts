// 阿里云 ESA WAF 官方配置元数据（前端可视化用）。
// 依据官方 API：CreateWafRule / UpdateWafRule / BatchCreateWafRules 与 WafRuleConfig 结构。
// 这里只描述「可选值 + 作用 + 套餐门槛」，提交字段由 EsaWafRuleEditor 组装。

import type { EsaBilingual, EsaPlanGate } from './esaRuleMeta';

export type EsaWafPhase =
  | 'http_custom'
  | 'http_ratelimit'
  | 'http_managed'
  | 'http_anti_scan'
  | 'http_whitelist'
  | 'ip_access_rule'
  | 'http_security_level_rule';

export interface EsaWafActionMeta {
  value: string;
  label: EsaBilingual;
  desc: EsaBilingual;
  gate: EsaPlanGate;
}

export interface EsaWafOption<T = string> {
  value: T;
  label: EsaBilingual;
  desc: EsaBilingual;
  gate?: EsaPlanGate;
}

/** WAF 命中后的处置动作 */
export const ESA_WAF_ACTIONS: EsaWafActionMeta[] = [
  {
    value: 'deny',
    label: { zh: '拦截', en: 'Block' },
    desc: { zh: '直接拦截请求，返回 403 或自定义响应页面。', en: 'Block the request with 403 or a custom response page.' },
    gate: 'free',
  },
  {
    value: 'monitor',
    label: { zh: '观察', en: 'Monitor' },
    desc: { zh: '仅记录安全日志，不拦截请求，适合上线前验证规则。', en: 'Log the request without blocking; useful for testing rules.' },
    gate: 'free',
  },
  {
    value: 'js',
    label: { zh: 'JS 挑战', en: 'JS Challenge' },
    desc: { zh: '返回可自动执行的 JavaScript，通过后一段时间内放行。', en: 'Return JavaScript that browsers execute automatically; pass for a period.' },
    gate: 'pro',
  },
  {
    value: 'captcha',
    label: { zh: '滑块挑战', en: 'Slider CAPTCHA' },
    desc: { zh: '返回滑动验证页面，验证通过后一段时间内放行。', en: 'Return a slider CAPTCHA; pass for a period after verification.' },
    gate: 'premium',
  },
];

/** 扫描防护动作（不支持 JS / 滑块） */
export const ESA_WAF_SCAN_ACTIONS = ESA_WAF_ACTIONS.filter((a) => a.value === 'deny' || a.value === 'monitor');

/** 白名单可跳过的 WAF 模块标签 */
export const ESA_WAF_BYPASS_TAGS: EsaWafOption[] = [
  { value: 'http_custom', label: { zh: '自定义规则', en: 'Custom rules' }, desc: { zh: '跳过自定义规则检测。', en: 'Skip custom rule inspection.' } },
  { value: 'http_managed', label: { zh: '托管规则', en: 'Managed rules' }, desc: { zh: '跳过托管规则检测。', en: 'Skip managed rule inspection.' } },
  { value: 'http_anti_scan', label: { zh: '扫描防护', en: 'Scan protection' }, desc: { zh: '跳过扫描防护检测。', en: 'Skip scan protection.' } },
  { value: 'http_ratelimit', label: { zh: '频次控制', en: 'Rate limiting' }, desc: { zh: '跳过频次控制检测。', en: 'Skip rate limiting.' } },
  { value: 'http_auto_ratelimit', label: { zh: '自动频次控制', en: 'Auto rate limiting' }, desc: { zh: '跳过自动频次控制。', en: 'Skip automatic rate limiting.' } },
  { value: 'ip_access_rule', label: { zh: 'IP 访问规则', en: 'IP access rules' }, desc: { zh: '跳过 IP 访问规则检测。', en: 'Skip IP access rules.' } },
];

/** 托管规则攻击类型 */
export const ESA_WAF_ATTACK_TYPES: EsaWafOption<number>[] = [
  { value: 11, label: { zh: 'SQL 注入', en: 'SQL injection' }, desc: { zh: '识别并拦截 SQL 注入攻击。', en: 'Detect and block SQL injection.' } },
  { value: 12, label: { zh: '跨站脚本（XSS）', en: 'Cross-site scripting' }, desc: { zh: '识别并拦截 XSS 攻击。', en: 'Detect and block XSS.' } },
  { value: 13, label: { zh: '代码执行', en: 'Code execution' }, desc: { zh: '识别并拦截代码执行攻击。', en: 'Detect and block code execution.' } },
  { value: 14, label: { zh: 'CRLF 注入', en: 'CRLF injection' }, desc: { zh: '识别并拦截 CRLF 注入。', en: 'Detect and block CRLF injection.' } },
  { value: 15, label: { zh: '本地文件包含', en: 'Local file inclusion' }, desc: { zh: '识别并拦截本地文件包含。', en: 'Detect and block local file inclusion.' } },
  { value: 16, label: { zh: '远程文件包含', en: 'Remote file inclusion' }, desc: { zh: '识别并拦截远程文件包含。', en: 'Detect and block remote file inclusion.' } },
  { value: 17, label: { zh: 'WebShell', en: 'WebShell' }, desc: { zh: '识别并拦截 WebShell 访问。', en: 'Detect and block WebShell access.' } },
  { value: 18, label: { zh: '跨站请求伪造（CSRF）', en: 'CSRF' }, desc: { zh: '识别并拦截 CSRF 攻击。', en: 'Detect and block CSRF.' } },
  { value: 22, label: { zh: '命令注入', en: 'Command injection' }, desc: { zh: '识别并拦截命令注入。', en: 'Detect and block command injection.' } },
  { value: 26, label: { zh: 'SSRF', en: 'SSRF' }, desc: { zh: '识别并拦截服务端请求伪造。', en: 'Detect and block server-side request forgery.' } },
  { value: 27, label: { zh: '路径穿越', en: 'Path traversal' }, desc: { zh: '识别并拦截路径穿越。', en: 'Detect and block path traversal.' } },
  { value: 28, label: { zh: '协议违规', en: 'Protocol violation' }, desc: { zh: '识别并拦截异常协议请求。', en: 'Detect and block malformed protocol requests.' } },
  { value: 31, label: { zh: '扫描器行为', en: 'Scanner behavior' }, desc: { zh: '识别并拦截常见扫描器。', en: 'Detect and block common scanners.' } },
  { value: 99, label: { zh: '其他', en: 'Other' }, desc: { zh: '其他类型的托管规则。', en: 'Other managed rule types.' } },
];

/** 托管规则防护等级 */
export const ESA_WAF_PROTECTION_LEVELS: EsaWafOption<number>[] = [
  { value: 0, label: { zh: '关闭', en: 'Off' }, desc: { zh: '关闭该攻击类型的托管规则。', en: 'Disable managed rules for this attack type.' } },
  { value: 1, label: { zh: '宽松', en: 'Loose' }, desc: { zh: '仅启用基础规则，误拦截概率最低。', en: 'Enable basic rules with the lowest false-positive risk.' } },
  { value: 2, label: { zh: '中等', en: 'Medium' }, desc: { zh: '平衡防护效果与误拦截概率。', en: 'Balance protection and false positives.' } },
  { value: 3, label: { zh: '严格', en: 'Strict' }, desc: { zh: '启用更完整的规则集，适合高风险站点。', en: 'Enable a fuller rule set for high-risk sites.' } },
  { value: 4, label: { zh: '超严格', en: 'Extra strict' }, desc: { zh: '启用全部规则，可能增加误拦截。', en: 'Enable all rules; may increase false positives.' } },
];

/** 安全级别（安全规则） */
export const ESA_WAF_SECURITY_LEVELS: EsaWafOption[] = [
  { value: 'off', label: { zh: '关闭', en: 'Off' }, desc: { zh: '不启用安全级别挑战。', en: 'Disable security level challenges.' } },
  { value: 'essentially_off', label: { zh: '基本关闭', en: 'Essentially off' }, desc: { zh: '仅对最可疑的流量发起挑战。', en: 'Challenge only the most suspicious traffic.' } },
  { value: 'low', label: { zh: '低', en: 'Low' }, desc: { zh: '适合无攻击历史的常规站点。', en: 'For sites without a history of attacks.' } },
  { value: 'medium', label: { zh: '中', en: 'Medium' }, desc: { zh: '适合有过攻击或安全要求较高的站点。', en: 'For sites with attacks or higher security needs.' } },
  { value: 'high', label: { zh: '高', en: 'High' }, desc: { zh: '适合正在遭受攻击或处于高安全时段的站点。', en: 'For sites under attack or during high-security periods.' } },
  { value: 'under_attack', label: { zh: '我正在遭受攻击', en: "I'm Under Attack" }, desc: { zh: '紧急模式，对所有可疑请求发起挑战（Enterprise）。', en: 'Emergency mode that challenges suspicious requests (Enterprise).' }, gate: 'enterprise' },
];

/** 频次统计时长（秒） */
export const ESA_WAF_RATE_INTERVALS: EsaWafOption<number>[] = [
  { value: 10, label: { zh: '10 秒', en: '10 seconds' }, desc: { zh: '统计最近 10 秒的请求量。', en: 'Count requests in the last 10 seconds.' } },
  { value: 60, label: { zh: '1 分钟', en: '1 minute' }, desc: { zh: '统计最近 1 分钟的请求量。', en: 'Count requests in the last minute.' } },
  { value: 120, label: { zh: '2 分钟', en: '2 minutes' }, desc: { zh: '统计最近 2 分钟的请求量。', en: 'Count requests in the last 2 minutes.' } },
  { value: 300, label: { zh: '5 分钟', en: '5 minutes' }, desc: { zh: '统计最近 5 分钟的请求量。', en: 'Count requests in the last 5 minutes.' } },
  { value: 600, label: { zh: '10 分钟', en: '10 minutes' }, desc: { zh: '统计最近 10 分钟的请求量。', en: 'Count requests in the last 10 minutes.' } },
  { value: 900, label: { zh: '15 分钟', en: '15 minutes' }, desc: { zh: '统计最近 15 分钟的请求量。', en: 'Count requests in the last 15 minutes.' } },
  { value: 3600, label: { zh: '1 小时', en: '1 hour' }, desc: { zh: '统计最近 1 小时的请求量。', en: 'Count requests in the last hour.' } },
];

/** 频次控制动作持续时间（秒） */
export const ESA_WAF_RATE_TTLS: EsaWafOption<number>[] = [
  { value: 10, label: { zh: '10 秒', en: '10 seconds' }, desc: { zh: '触发后处置持续 10 秒。', en: 'Apply the action for 10 seconds.' } },
  { value: 60, label: { zh: '1 分钟', en: '1 minute' }, desc: { zh: '触发后处置持续 1 分钟。', en: 'Apply the action for 1 minute.' } },
  { value: 120, label: { zh: '2 分钟', en: '2 minutes' }, desc: { zh: '触发后处置持续 2 分钟。', en: 'Apply the action for 2 minutes.' } },
  { value: 300, label: { zh: '5 分钟', en: '5 minutes' }, desc: { zh: '触发后处置持续 5 分钟。', en: 'Apply the action for 5 minutes.' } },
  { value: 600, label: { zh: '10 分钟', en: '10 minutes' }, desc: { zh: '触发后处置持续 10 分钟。', en: 'Apply the action for 10 minutes.' } },
  { value: 900, label: { zh: '15 分钟', en: '15 minutes' }, desc: { zh: '触发后处置持续 15 分钟。', en: 'Apply the action for 15 minutes.' } },
  { value: 3600, label: { zh: '1 小时', en: '1 hour' }, desc: { zh: '触发后处置持续 1 小时。', en: 'Apply the action for 1 hour.' } },
  { value: 86400, label: { zh: '1 天', en: '1 day' }, desc: { zh: '触发后处置持续 1 天。', en: 'Apply the action for 1 day.' } },
];

/** 频次统计维度 */
export const ESA_WAF_RATE_KEYS: EsaWafOption[] = [
  { value: 'ip.src', label: { zh: '客户端 IP', en: 'Client IP' }, desc: { zh: '按客户端 IP 分别统计请求量。', en: 'Count requests per client IP.' } },
  { value: 'http.host', label: { zh: '主机名', en: 'Hostname' }, desc: { zh: '按访问域名分别统计请求量。', en: 'Count requests per hostname.' } },
  { value: 'http.request.headers', label: { zh: '请求头', en: 'Header' }, desc: { zh: '按指定请求头的值分别统计。', en: 'Count requests per header value.' } },
  { value: 'http.request.uri.args', label: { zh: 'URI 查询参数', en: 'URI query parameter' }, desc: { zh: '按指定查询参数的值分别统计。', en: 'Count requests per query parameter value.' } },
  { value: 'http.cookie', label: { zh: 'Cookie', en: 'Cookie' }, desc: { zh: '按指定 Cookie 的值分别统计。', en: 'Count requests per cookie value.' } },
  { value: 'http.request.uri', label: { zh: 'URI', en: 'URI' }, desc: { zh: '按完整 URI 分别统计。', en: 'Count requests per URI.' } },
  { value: 'http.request.uri.path', label: { zh: 'URI 路径', en: 'URI path' }, desc: { zh: '按 URI 路径分别统计。', en: 'Count requests per URI path.' } },
  { value: 'ip.geoip.asnum', label: { zh: 'ASN', en: 'ASN' }, desc: { zh: '按客户端所属 ASN 分别统计。', en: 'Count requests per client ASN.' } },
  { value: 'http.request.version', label: { zh: 'HTTP 版本', en: 'HTTP version' }, desc: { zh: '按 HTTP 协议版本分别统计。', en: 'Count requests per HTTP version.' } },
  { value: 'http.user_agent', label: { zh: 'User-Agent', en: 'User-Agent' }, desc: { zh: '按 User-Agent 分别统计。', en: 'Count requests per User-Agent.' } },
  { value: 'http.x_forwarded_for', label: { zh: 'X-Forwarded-For', en: 'X-Forwarded-For' }, desc: { zh: '按 X-Forwarded-For 分别统计。', en: 'Count requests per X-Forwarded-For value.' } },
  { value: 'http.response.content_type', label: { zh: 'MIME 类型', en: 'MIME type' }, desc: { zh: '按响应 MIME 类型分别统计。', en: 'Count requests per response MIME type.' } },
];

/** 扫描防护检测类型 */
export const ESA_WAF_SCAN_TYPES: EsaWafOption[] = [
  {
    value: 'http_scan_tools',
    label: { zh: '扫描工具检测', en: 'Scanner detection' },
    desc: { zh: '通过 User-Agent 等特征识别 Nmap、Nikto 等扫描工具，使用内置智能规则库。', en: 'Identify scanners such as Nmap and Nikto by User-Agent and other traits.' },
  },
  {
    value: 'http_directory_traversal',
    label: { zh: '目录遍历检测', en: 'Directory traversal detection' },
    desc: { zh: '分析高频 404 响应识别目录遍历扫描，需要设置响应码阈值。', en: 'Detect traversal scans by high-frequency 404 responses; configure a response threshold.' },
  },
];

export function esaWafActionMeta(value: string): EsaWafActionMeta | undefined {
  return ESA_WAF_ACTIONS.find((a) => a.value === value);
}

export function esaWafActionsForPhase(phase: EsaWafPhase): EsaWafActionMeta[] {
  if (phase === 'http_anti_scan') return ESA_WAF_SCAN_ACTIONS;
  if (phase === 'http_whitelist' || phase === 'http_managed' || phase === 'http_security_level_rule') return [];
  return ESA_WAF_ACTIONS;
}

export function esaWafPhaseLabel(phase: EsaWafPhase, zh: boolean): string {
  const map: Record<EsaWafPhase, EsaBilingual> = {
    http_custom: { zh: '自定义规则', en: 'Custom rules' },
    http_ratelimit: { zh: '频次控制', en: 'Rate limiting' },
    http_managed: { zh: '托管规则', en: 'Managed rules' },
    http_anti_scan: { zh: '扫描防护', en: 'Scan protection' },
    http_whitelist: { zh: '白名单', en: 'Allowlist' },
    ip_access_rule: { zh: 'IP 访问规则', en: 'IP access rules' },
    http_security_level_rule: { zh: '安全级别', en: 'Security level' },
  };
  const item = map[phase];
  return zh ? item.zh : item.en;
}
