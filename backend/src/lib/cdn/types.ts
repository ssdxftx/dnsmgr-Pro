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
  // 是否支持联动证书申请：把本系统签发的证书直传到站点并启用 HTTPS
  supportsCertApply?(): boolean;
  // 返回站点级证书作用域（站点根域 + 通配符域名集），用于按站点申请一张通配符证书
  getCertScope?(domain: string): Promise<CertScope | false>;
  // 将已签发的证书（PEM）直传到站点，站点下所有加速域名共用
  uploadCert?(domain: string, fullchain: string, privatekey: string): Promise<FreeCertResult>;
  // 生成自动部署任务计划（复用 CDN 账户密钥），使证书续签后自动更新
  getCertDeployPlan?(domain: string, scope: CertScope): Promise<CertDeployPlan | false>;
}