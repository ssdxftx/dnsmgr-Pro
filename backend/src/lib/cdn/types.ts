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
}