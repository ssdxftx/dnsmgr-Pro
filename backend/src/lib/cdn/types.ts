export interface CdnDomainItem {
  domain: string;
  cname: string;
  status: string;
  area?: string;
  zoneId?: string;
  origin?: string;
  origin_type?: string;
  origin_host?: string;
  origin_protocol?: string;
  http_port?: number;
  https_port?: number;
  https_enabled?: boolean;
  force_redirect?: boolean;
}

// 平台免费证书：pending 表示还需完成域名验证后才能部署
export interface FreeCertRecord {
  name: string;
  type: string;
  value: string;
}

export interface FreeCertResult {
  status: 'applied' | 'pending' | 'failed';
  message?: string;
  records?: FreeCertRecord[];
}

// 站点级证书作用域：一张证书覆盖站点根域及其一级通配符
export interface CertScope {
  siteId: string;
  siteName: string;
  domains: string[];
}

// 自动部署任务计划：复用 CDN 账户密钥，供证书续签后自动更新
export interface CertDeployPlan {
  accountType: string;
  accountConfig: Record<string, any>;
  accountName?: string;
  product: string;
  config: Record<string, any>;
}

// 云端加速域名当前证书项（用于证书管理弹窗展示）
export interface CloudCertItem {
  id: string;
  name?: string;
  commonName?: string;
  san?: string[];
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
  createdAt?: string;
  source?: 'platform' | 'custom' | 'unknown';
}

// 云端加速域名当前证书信息
export interface DomainCertInfo {
  httpsEnabled?: boolean;
  mode?: string;
  source: 'platform' | 'custom' | 'none' | 'unknown';
  sourceLabel: string;
  certs: CloudCertItem[];
}

// ===== 站点生命周期 / 源站组 / 负载均衡 / 规则 / 安全 / 四层 通用返回结构 =====
export interface ZoneSummary {
  zoneId: string;
  zoneName: string;
  status?: string;
  area?: string;
  type?: string;
  paused?: boolean;
  nameServers?: string[];
  [k: string]: any;
}

export interface PagedResult<T> {
  total: number;
  list: T[];
}

export interface OriginGroupItem {
  groupId: string;
  name: string;
  type?: string;
  records?: any[];
  hostHeader?: string;
  [k: string]: any;
}

export interface LoadBalancerItem {
  instanceId: string;
  name: string;
  type?: string;
  originGroups?: any[];
  [k: string]: any;
}

export interface RuleItem {
  ruleId?: string;
  configId?: string;
  ruleName: string;
  status?: string;
  enabled?: boolean;
  rules?: any[];
  [k: string]: any;
}

export interface SecurityIpGroupItem {
  groupId: number;
  name: string;
  content?: string[];
  [k: string]: any;
}

export interface L4ProxyItem {
  proxyId: string;
  name: string;
  area?: string;
  [k: string]: any;
}

export interface CdnProvider {
  getError(): string;
  check(): Promise<boolean>;
  createDomain(domain: string, origin: string, originType: string, serviceArea: string, zoneId?: string | null): Promise<string | false>;
  getDomainCname(domain: string): Promise<string | false>;
  listDomains(): Promise<CdnDomainItem[] | false>;
  deleteDomain(domain: string): Promise<boolean>;
  setDomainStatus(domain: string, status: string): Promise<boolean>;
  updateOrigin(domain: string, origin: string, originType: string, originHost: string, originProtocol: string, httpPort: number, httpsPort: number): Promise<boolean>;
  setCacheRules(domain: string, rules: any[]): Promise<boolean>;
  setHttps(domain: string, enabled: boolean, forceRedirect: boolean): Promise<boolean>;
  getZoneSetting?(zoneId: string): Promise<Record<string, any> | false>;
  updateZoneSetting?(zoneId: string, zoneConfig: Record<string, any>): Promise<boolean>;
  getZones?(): Promise<any[]>;
  setZoneId?(zoneId: string): void;
  purge?(urls: string[], type: 'url' | 'dir'): Promise<string | false>;
  preheat?(urls: string[]): Promise<string | false>;
  getAccess?(domain: string): Promise<Record<string, any> | false>;
  setAccess?(domain: string, config: Record<string, any>): Promise<boolean>;
  // 是否支持使用厂商提供的免费证书（如腾讯云 EdgeOne）
  supportsFreeCert?(): boolean;
  // 为加速域名申请并部署平台免费证书
  applyFreeCert?(domain: string): Promise<FreeCertResult>;
  // 检查免费证书申请结果，通过后完成部署
  checkFreeCert?(domain: string): Promise<FreeCertResult>;
  // 返回站点级证书作用域（站点根域 + 通配符域名集），用于按站点申请一张通配符证书
  getCertScope?(domain: string): Promise<CertScope | false>;
  // 生成自动部署任务计划（复用 CDN 账户密钥），证书签发/续签后由部署任务自动上传
  getCertDeployPlan?(domain: string, scope: CertScope): Promise<CertDeployPlan | false>;
  // 查询加速域名在云端的当前证书配置（用于证书管理弹窗展示云端真实状态）
  getDomainCertInfo?(domain: string): Promise<DomainCertInfo | false>;

  // ===== 站点生命周期（EO Zone / ESA Site）=====
  // 创建站点/区域；EO: {name,type,area,planId}，ESA: {name,area(coverage),accessType,instanceId}
  createZone?(params: Record<string, any>): Promise<ZoneSummary | false>;
  deleteZone?(zoneId: string): Promise<boolean>;
  setZonePaused?(zoneId: string, paused: boolean): Promise<boolean>;
  getZonePaused?(zoneId: string): Promise<boolean | false>;
  // 归属识别（EO IdentifyZone）：返回 Ascription 等
  identifyZone?(zoneName: string): Promise<Record<string, any> | false>;
  // 归属/所有权验证（EO VerifyOwnership 用域名 / ESA VerifySite 用 SiteId）
  verifyOwnership?(zoneId: string, domain?: string): Promise<Record<string, any> | false>;
  // 校验 CNAME 生效状态（EO CheckCnameStatus）
  checkCnameStatus?(zoneId: string, recordNames: string[]): Promise<any[] | false>;
  // 站点 NS 列表（ESA GetSiteCurrentNS）
  getSiteNs?(zoneId: string): Promise<string[] | false>;
  // 站点完整属性（ESA GetSite + 名称独占 + 自定义 NS）
  getSiteProperties?(zoneId: string): Promise<Record<string, any> | false>;
  // 自定义 NS（ESA UpdateSiteVanityNS）
  updateSiteVanityNS?(zoneId: string, nsList: string[] | string): Promise<boolean>;
  // 通用官方 API 执行器（阿里云 ESA 全量 OpenAPI）
  runEsaApi?(action: string, params: Record<string, any>): Promise<Record<string, any> | false>;
  // 站点名校验（ESA CheckSiteName）
  checkSiteName?(siteName: string): Promise<{ passed: boolean; reason?: string } | false>;
  // 接入类型 / 覆盖范围 / 站点名独占（ESA）
  updateSiteAccessType?(zoneId: string, accessType: string): Promise<boolean>;
  updateSiteCoverage?(zoneId: string, coverage: string): Promise<boolean>;
  updateSiteNameExclusive?(zoneId: string, enable: boolean): Promise<boolean>;
  getSiteNameExclusive?(zoneId: string): Promise<boolean | false>;
  // 套餐实例列表（ESA ListUserRatePlanInstances），供创建站点选择
  listPlanInstances?(): Promise<any[] | false>;

  // ===== 源站组 / 负载均衡 =====
  listOriginGroups?(zoneId: string, page?: number, size?: number): Promise<PagedResult<OriginGroupItem> | false>;
  createOriginGroup?(zoneId: string, params: Record<string, any>): Promise<string | false>;
  updateOriginGroup?(zoneId: string, groupId: string, params: Record<string, any>): Promise<boolean>;
  deleteOriginGroup?(zoneId: string, groupId: string): Promise<boolean>;
  listLoadBalancers?(zoneId: string, page?: number, size?: number): Promise<PagedResult<LoadBalancerItem> | false>;
  createLoadBalancer?(zoneId: string, params: Record<string, any>): Promise<string | false>;
  updateLoadBalancer?(zoneId: string, instanceId: string, params: Record<string, any>): Promise<boolean>;
  deleteLoadBalancer?(zoneId: string, instanceId: string): Promise<boolean>;

  // ===== 规则引擎 =====
  // EO：规则引擎可选匹配项/动作元数据（DescribeRulesSetting）
  getRulesSetting?(): Promise<Record<string, any> | false>;
  listRules?(zoneId: string): Promise<RuleItem[] | false>;
  createRule?(zoneId: string, params: Record<string, any>): Promise<string | false>;
  updateRule?(zoneId: string, ruleId: string, params: Record<string, any>): Promise<boolean>;
  deleteRules?(zoneId: string, ruleIds: string[]): Promise<boolean>;
  // EO：调整 L7 加速规则优先级（ModifyL7AccRulePriority，按数组顺序重排）
  setRulePriority?(zoneId: string, ruleIds: string[]): Promise<boolean>;
  // ESA：按规则类型（kind，如 RedirectRule）统一 List/Update/Create/Delete
  listRuleConfigs?(zoneId: string, kind: string, page?: number, size?: number): Promise<PagedResult<RuleItem> | false>;
  upsertRuleConfig?(zoneId: string, kind: string, params: Record<string, any>): Promise<boolean>;
  deleteRuleConfig?(zoneId: string, kind: string, configId: string): Promise<boolean>;

  // ===== 安全 =====
  listSecurityIpGroups?(zoneId: string): Promise<SecurityIpGroupItem[] | false>;
  createSecurityIpGroup?(zoneId: string, name: string, content: string[]): Promise<number | false>;
  updateSecurityIpGroup?(zoneId: string, groupId: number, name: string, content: string[], mode?: string): Promise<boolean>;
  deleteSecurityIpGroup?(zoneId: string, groupId: number): Promise<boolean>;
  getSecurityIpGroupContent?(zoneId: string, groupId: number): Promise<string[] | false>;
  getDdosProtection?(zoneId: string): Promise<Record<string, any> | false>;
  setDdosProtection?(zoneId: string, config: Record<string, any>): Promise<boolean>;
  getWafInfo?(zoneId: string): Promise<Record<string, any> | false>;
  setWafInfo?(zoneId: string, config: Record<string, any>): Promise<boolean>;
  // ESA 源站防护
  getOriginProtection?(zoneId: string): Promise<Record<string, any> | false>;
  setOriginProtection?(zoneId: string, config: Record<string, any>): Promise<boolean>;

  // ===== 四层代理 =====
  listL4Proxies?(zoneId: string, page?: number, size?: number): Promise<PagedResult<L4ProxyItem> | false>;
  createL4Proxy?(zoneId: string, params: Record<string, any>): Promise<string | false>;
  updateL4Proxy?(zoneId: string, proxyId: string, params: Record<string, any>): Promise<boolean>;
  deleteL4Proxy?(zoneId: string, proxyId: string): Promise<boolean>;
  listL4ProxyRules?(zoneId: string, proxyId: string, page: number, size: number): Promise<PagedResult<any> | false>;
  createL4ProxyRules?(zoneId: string, proxyId: string, rules: any[]): Promise<boolean>;
  deleteL4ProxyRules?(zoneId: string, proxyId: string, ruleIds: string[]): Promise<boolean>;

  // ===== 任务 / 配额 / 统计增强 =====
  listPurgeTasks?(zoneId: string | null, page?: number, size?: number): Promise<PagedResult<any> | false>;
  listPrefetchTasks?(zoneId: string | null, page?: number, size?: number): Promise<PagedResult<any> | false>;
  getContentQuota?(zoneId: string): Promise<Record<string, any> | false>;
  getPurgeQuota?(zoneId: string, type: string): Promise<Record<string, any> | false>;
  uploadFile?(zoneId: string, url: string, type: string, taskName: string): Promise<string | false>;
  listUploadTasks?(zoneId: string | null, type?: string): Promise<any[] | false>;
  listPreloadTasks?(zoneId: string | null, page?: number, size?: number): Promise<PagedResult<any> | false>;
  updateDevelopmentMode?(zoneId: string, enable: boolean): Promise<boolean>;
  updateCacheTag?(zoneId: string, params: Record<string, any>): Promise<boolean>;
  blockObject?(zoneId: string, type: string, content: string[], maxage?: number): Promise<string | false>;
  updateTieredCache?(zoneId: string, mode: string): Promise<boolean>;
  topAnalysis?(zoneIds: string[], startTime: string, endTime: string, metricName: string, limit?: number): Promise<any[] | false>;
  timingCacheData?(zoneIds: string[], startTime: string, endTime: string, metricNames: string[]): Promise<any[] | false>;
}