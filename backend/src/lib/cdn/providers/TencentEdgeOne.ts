import { TencentCloud } from '../../clients/TencentCloud.js';
import type { CdnProvider, CdnDomainItem, CertScope, CertDeployPlan, FreeCertResult, DomainCertInfo, ZoneSummary, PagedResult, OriginGroupItem, LoadBalancerItem, RuleItem, SecurityIpGroupItem, L4ProxyItem } from '../types.js';
import { catalogPath, fileExtensions, normalizeValue, parsePathRule, splitRuleValues, wildcardToRegex } from '../pathRule.js';
import type { PathRuleType } from '../pathRule.js';

export class TencentEdgeOne implements CdnProvider {
  private client: TencentCloud;
  private secretId: string;
  private secretKey: string;
  private error = '';
  private zoneId: string | null = null;
  private zoneErrors: string[] = [];

  constructor(config: Record<string, any>) {
    this.secretId = config.SecretId || '';
    this.secretKey = config.SecretKey || '';
    this.client = new TencentCloud(this.secretId, this.secretKey, 'teo.tencentcloudapi.com', 'teo', '2022-09-01');
  }

  getError() {
    return this.error;
  }

  setZoneId(zoneId: string) {
    this.zoneId = zoneId;
  }

  getZoneErrors() {
    return this.zoneErrors;
  }

  private async send(action: string, param: Record<string, any>): Promise<any> {
    try {
      return await this.client.request(action, param);
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async getZones() {
    const list: any[] = [];
    const limit = 100;
    for (let offset = 0; offset < limit * 50; offset += limit) {
      const data = await this.send('DescribeZones', { Offset: offset, Limit: limit });
      if (!data) break;
      const zones = data.Zones || [];
      for (const z of zones) {
        list.push({ zoneId: z.ZoneId, zoneName: z.ZoneName, status: z.Status, area: z.Area });
      }
      if (zones.length < limit) break;
    }
    return list;
  }

  async check() {
    return (await this.send('DescribeZones', { Limit: 1 })) !== false;
  }

  private getRootDomain(domain: string): string {
    const parts = domain.split('.');
    return parts.length <= 2 ? domain : parts.slice(-2).join('.');
  }

  private async findZone(domain: string): Promise<string | false> {
    if (this.zoneId) return this.zoneId;
    const root = this.getRootDomain(domain);
    const limit = 100;
    for (let offset = 0; offset < limit * 50; offset += limit) {
      const data = await this.send('DescribeZones', { Offset: offset, Limit: limit });
      if (!data) return false;
      const zones = data.Zones || [];
      for (const zone of zones) {
        if (zone.ZoneName === root && zone.ZoneId) return zone.ZoneId;
      }
      if (zones.length < limit) break;
    }
    return false;
  }

  async createDomain(domain: string, origin: string, originType: string, serviceArea: string, specifiedZoneId?: string | null): Promise<string | false> {
    if (specifiedZoneId) this.zoneId = specifiedZoneId;
    const zoneId = await this.findZone(domain);
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点（Zone），请先在腾讯云 EdgeOne 控制台创建站点后再接入';
      return false;
    }
    const param = {
      ZoneId: zoneId,
      DomainName: domain,
      OriginInfo: { OriginType: 'IP_DOMAIN', Origin: origin.trim() },
      OriginProtocol: 'FOLLOW',
    };
    if (!(await this.send('CreateAccelerationDomain', param))) return false;
    for (let i = 0; i < 10; i++) {
      const cname = await this.getDomainCname(domain);
      if (cname) return cname;
      await new Promise((r) => setTimeout(r, 1000));
    }
    this.error = '未获取到 CNAME，请稍后在列表刷新重试';
    return false;
  }

  async getDomainCname(domain: string): Promise<string | false> {
    const zoneId = await this.findZone(domain);
    if (!zoneId) return false;
    const data = await this.send('DescribeAccelerationDomains', { ZoneId: zoneId, Limit: 100 });
    if (!data) return false;
    for (const d of data.AccelerationDomains || []) {
      if (d.DomainName === domain && d.Cname) return d.Cname;
    }
    return false;
  }

  async listDomains(): Promise<CdnDomainItem[] | false> {
    const list: CdnDomainItem[] = [];
    this.zoneErrors = [];
    const zonesData = await this.send('DescribeZones', { Limit: 100, Offset: 0 });
    if (!zonesData) return false;
    for (const z of zonesData.Zones || []) {
      const zoneId = z.ZoneId || '';
      if (!zoneId) continue;
      let zoneForceRedirect = false;
      const zs = await this.send('DescribeL7AccSetting', { ZoneId: zoneId });
      if (zs) zoneForceRedirect = zs.ZoneSetting?.ZoneConfig?.ForceRedirectHTTPS?.Switch === 'on';
      const dr = await this.send('DescribeAccelerationDomains', { ZoneId: zoneId, Offset: 0, Limit: 100 });
      if (!dr) {
        this.zoneErrors.push(z.ZoneName + ': ' + this.error);
        continue;
      }
      for (const d of dr.AccelerationDomains || []) {
        const originDetail = d.OriginDetail || {};
        const originVal = originDetail.Origin || '';
        const originType = originVal && /^\d+\.\d+\.\d+\.\d+/.test(originVal) ? 'ipaddr' : 'domain';
        const protoMap: Record<string, string> = { HTTP: 'http', HTTPS: 'https', FOLLOW: 'follow' };
        const cert = d.Certificate || {};
        const mode = cert.Mode || '';
        const httpsEnabled = (mode && mode !== 'disable') || cert.ClientCertInfo?.Switch === 'on';
        list.push({
          domain: d.DomainName,
          cname: d.Cname || '',
          status: d.DomainStatus === 'offline' ? 'offline' : 'online',
          zoneId,
          origin: originVal,
          origin_type: originType,
          origin_host: originDetail.HostHeader || '',
          origin_protocol: protoMap[d.OriginProtocol] ?? 'follow',
          http_port: d.HttpOriginPort || 80,
          https_port: d.HttpsOriginPort || 443,
          https_enabled: httpsEnabled,
          force_redirect: zoneForceRedirect,
        });
      }
    }
    return list;
  }

  async deleteDomain(domain: string) {
    const zoneId = await this.findZone(domain);
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点';
      return false;
    }
    // EdgeOne 要求域名处于停用状态才能删除：在线时先停用再删除
    const list = await this.send('DescribeAccelerationDomains', { ZoneId: zoneId, Offset: 0, Limit: 200 });
    if (list !== false) {
      const cur = (list.AccelerationDomains || []).find((d: any) => d.DomainName === domain);
      if (cur && cur.DomainStatus === 'online') {
        const stopped = await this.send('ModifyAccelerationDomainStatuses', { ZoneId: zoneId, DomainNames: [domain], Status: 'offline' });
        if (stopped === false) return false;
      }
    }
    return (await this.send('DeleteAccelerationDomains', { ZoneId: zoneId, DomainNames: [domain] })) !== false;
  }

  async setDomainStatus(domain: string, status: string) {
    const zoneId = await this.findZone(domain);
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点';
      return false;
    }
    return (
      (await this.send('ModifyAccelerationDomainStatuses', {
        ZoneId: zoneId,
        DomainNames: [domain],
        Status: status === 'offline' ? 'offline' : 'online',
      })) !== false
    );
  }

  async updateOrigin(domain: string, origin: string, originType: string, originHost: string, originProtocol: string, httpPort: number, httpsPort: number) {
    const zoneId = await this.findZone(domain);
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点';
      return false;
    }
    const protoMap: Record<string, string> = { http: 'HTTP', https: 'HTTPS', follow: 'FOLLOW' };
    const OriginInfo: Record<string, any> = { OriginType: 'IP_DOMAIN', Origin: origin.trim() };
    if (originHost) OriginInfo.HostHeader = originHost;
    const param: Record<string, any> = {
      ZoneId: zoneId,
      DomainName: domain,
      OriginInfo,
      OriginProtocol: protoMap[originProtocol] ?? 'FOLLOW',
    };
    if (httpPort) param.HttpOriginPort = Number(httpPort);
    if (httpsPort) param.HttpsOriginPort = Number(httpsPort);
    return (await this.send('ModifyAccelerationDomain', param)) !== false;
  }

  async setCacheRules(domain: string, rules: any[]) {
    const zoneId = await this.findZone(domain);
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点';
      return false;
    }
    try {
      const list = Array.isArray(rules) ? rules : [];
      // 全局规则（path 为 * 或空）：站点级全局缓存配置（移植自 saveCacheRules 的 globalRule 分支）
      const globalRule = list.find((r) => parsePathRule(r?.path).type === 'global');
      if (globalRule) {
        const ttl = Math.max(0, Number(globalRule.ttl) || 0);
        const followOrigin = { Switch: 'off', DefaultCache: 'off', DefaultCacheStrategy: 'off', DefaultCacheTime: 0 };
        const cache =
          ttl > 0
            ? { FollowOrigin: followOrigin, CustomTime: { Switch: 'on', IgnoreCacheControl: 'on', CacheTime: ttl }, NoCache: { Switch: 'off' } }
            : { FollowOrigin: followOrigin, CustomTime: { Switch: 'off' }, NoCache: { Switch: 'on' } };
        await this.client.request('ModifyL7AccSetting', { ZoneId: zoneId, ZoneConfig: { Cache: cache } });
      }
      // 非全局规则：通过 L7 加速规则（规则引擎）下发（移植自 saveEdgeOneCacheRule）
      const specific = list
        .map((r) => ({ path: normalizeValue(r?.path), ttl: Math.max(0, Number(r?.ttl) || 0) }))
        .filter((r) => r.path !== '' && r.path !== '*');
      const ruleName = this.edgeOneCacheRuleName(domain);
      const existing = await this.findEdgeOneL7Rule(zoneId, ruleName);
      if (!specific.length) {
        if (existing?.RuleId) {
          await this.client.request('DeleteL7AccRules', { ZoneId: zoneId, RuleIds: [existing.RuleId] });
        }
        return true;
      }
      const item = this.buildCacheRuleEngineItem(domain, specific);
      if (existing?.RuleId) {
        // RulePriority 由 DescribeL7AccRules 返回但对 ModifyL7AccRule 只读
        await this.client.request('ModifyL7AccRule', { ZoneId: zoneId, Rule: { ...item, RuleId: existing.RuleId } });
      } else {
        await this.client.request('CreateL7AccRules', { ZoneId: zoneId, Rules: [item] });
      }
      return true;
    } catch (e: any) {
      this.error = '修改腾讯云 EdgeOne 缓存规则失败：' + (e.message || String(e));
      return false;
    }
  }

  // ===== EdgeOne 规则引擎（移植自 multi-cloud-cdn TencentEdgeOneDomainServiceImpl）=====

  private normalize(value: any): string {
    return normalizeValue(value);
  }

  private edgeOneCacheRuleName(domain: string): string {
    return 'dnsmgr_cache_' + this.normalize(domain).replace(/[^A-Za-z0-9_-]/g, '_');
  }

  private async findEdgeOneL7Rule(zoneId: string, ruleName: string): Promise<any | null> {
    let offset = 0;
    const limit = 200;
    for (;;) {
      const resp = await this.client.request('DescribeL7AccRules', { ZoneId: zoneId, Offset: offset, Limit: limit });
      const rules = resp.Rules || [];
      if (!rules.length) return null;
      for (const rule of rules) {
        if (rule?.RuleName === ruleName) return rule;
      }
      if (rules.length < limit || (resp.TotalCount != null && offset + rules.length >= resp.TotalCount)) return null;
      offset += rules.length;
    }
  }

  private escapeConditionValue(value: string): string {
    return this.normalize(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private toConditionList(values: string[]): string {
    return '[' + values.map((v) => `'${this.escapeConditionValue(v)}'`).join(', ') + ']';
  }

  private regexQuotePath(path: string): string {
    let out = '';
    for (const c of this.normalize(path)) {
      if ('\\.^$|()[]{}+*?'.includes(c)) out += '\\';
      out += c;
    }
    return out;
  }

  private buildPathMatchesCondition(regex: string): string {
    return "${http.request.uri.path} matches '" + this.escapeConditionValue(regex) + "'";
  }

  private buildCacheRuleCondition(rule: { type: PathRuleType; value: string }): string {
    if (rule.type === 'file_extension') {
      const extensions = fileExtensions(rule.value);
      if (!extensions.length) throw new Error('文件后缀缓存规则内容不能为空');
      return '${http.request.file_extension} in ' + this.toConditionList(extensions);
    }
    if (rule.type === 'catalog') {
      const expressions = splitRuleValues(rule.value).map((value) => {
        const path = catalogPath(value);
        if (path === '/') return this.buildPathMatchesCondition('^/.*$');
        return this.buildPathMatchesCondition('^' + this.regexQuotePath(path) + '(/.*)?$');
      });
      if (!expressions.length) throw new Error('目录路径缓存规则内容不能为空');
      return expressions.length === 1 ? expressions[0] : '(' + expressions.join(' or ') + ')';
    }
    if (rule.type === 'global') {
      return '${http.request.host} in [\'\']';
    }
    const values = splitRuleValues(rule.value);
    if (!values.length) throw new Error('全路径缓存规则内容不能为空');
    const exactValues: string[] = [];
    const wildcardValues: string[] = [];
    for (const value of values) {
      if (value.includes('*') || value.includes('?')) wildcardValues.push(value);
      else exactValues.push(value);
    }
    const expressions: string[] = [];
    if (exactValues.length) expressions.push('${http.request.uri.path} in ' + this.toConditionList(exactValues));
    for (const w of wildcardValues) expressions.push(this.buildPathMatchesCondition(wildcardToRegex(w)));
    return expressions.length === 1 ? expressions[0] : '(' + expressions.join(' or ') + ')';
  }

  private buildRuleCacheParameters(ttl: number): Record<string, any> {
    if (ttl > 0) {
      return { CustomTime: { Switch: 'on', IgnoreCacheControl: 'on', CacheTime: ttl } };
    }
    return { NoCache: { Switch: 'on' } };
  }

  private buildCacheRuleEngineItem(domain: string, rules: { path: string; ttl: number }[]): Record<string, any> {
    const subRules = rules.map((r) => ({
      Branches: [
        {
          Condition: this.buildCacheRuleCondition(parsePathRule(r.path)),
          Actions: [{ Name: 'Cache', CacheParameters: this.buildRuleCacheParameters(r.ttl) }],
        },
      ],
      Description: [JSON.stringify({ path: normalizeValue(r.path), ttl: r.ttl })],
    }));
    return {
      Status: 'enable',
      RuleName: this.edgeOneCacheRuleName(domain),
      Description: ['dnsmgr cache rules for ' + domain],
      Branches: [
        {
          Condition: "${http.request.host} in ['" + this.escapeConditionValue(domain) + "']",
          SubRules: subRules,
        },
      ],
    };
  }

  // 移植自 multi-cloud-cdn TencentEdgeOneDomainServiceImpl.httpsConfiguration / forcedToJump：
  // 关闭 HTTPS 时禁用域名证书（ModifyHostsCertificate Mode=disable，开启需要证书内容，请在控制台配置）；
  // 强制跳转为站点级 ZoneConfig.ForceRedirectHTTPS
  async setHttps(domain: string, enabled: boolean, forceRedirect: boolean) {
    const zoneId = await this.findZone(domain);
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点';
      return false;
    }
    try {
      if (!enabled) {
        await this.client.request('ModifyHostsCertificate', { ZoneId: zoneId, Hosts: [domain], Mode: 'disable' });
      }
      await this.client.request('ModifyL7AccSetting', {
        ZoneId: zoneId,
        ZoneConfig: { ForceRedirectHTTPS: { Switch: forceRedirect ? 'on' : 'off', RedirectStatusCode: 302 } },
      });
      return true;
    } catch (e: any) {
      this.error = '修改腾讯云 EdgeOne HTTPS 配置失败：' + (e.message || String(e));
      return false;
    }
  }

  supportsFreeCert() {
    return true;
  }

  // 托管接入（NS / DNSPod）可直接自动验证申请并部署；
  // CNAME 接入需先申请并通过 DNS 委派验证，返回待配置的解析记录
  async applyFreeCert(domain: string): Promise<FreeCertResult> {
    const zoneId = await this.findZone(domain);
    if (!zoneId) return { status: 'failed', message: '未找到该域名的 EdgeOne 站点' };
    try {
      await this.client.request('ModifyHostsCertificate', { ZoneId: zoneId, Hosts: [domain], Mode: 'eofreecert' });
      return { status: 'applied' };
    } catch (e: any) {
      this.error = e.message || String(e);
    }
    try {
      const data = await this.client.request('ApplyFreeCertificate', { ZoneId: zoneId, Domain: domain, VerificationMethod: 'dns_challenge' });
      const v = data?.DnsVerification || {};
      const records = v.RecordValue && v.Subdomain
        ? [{ name: String(v.RecordValue), type: String(v.RecordType || 'CNAME'), value: String(v.Subdomain) }]
        : [];
      return { status: 'pending', message: '已发起免费证书申请，需完成 DNS 委派验证后再部署', records };
    } catch (e: any) {
      return { status: 'failed', message: e.message || String(e) };
    }
  }

  async checkFreeCert(domain: string): Promise<FreeCertResult> {
    const zoneId = await this.findZone(domain);
    if (!zoneId) return { status: 'failed', message: '未找到该域名的 EdgeOne 站点' };
    try {
      const data = await this.client.request('CheckFreeCertificateVerification', { ZoneId: zoneId, Domain: domain });
      if (!data?.CommonName) return { status: 'pending', message: '免费证书仍在申请中，请稍后再检查' };
    } catch (e: any) {
      // 验证尚未通过（如未检测到验证值），保留为待验证并带上原因
      return { status: 'pending', message: e.message || String(e) };
    }
    try {
      await this.client.request('ModifyHostsCertificate', { ZoneId: zoneId, Hosts: [domain], Mode: 'eofreecert_manual' });
      return { status: 'applied' };
    } catch (e: any) {
      return { status: 'failed', message: e.message || String(e) };
    }
  }

  // ===== 站点证书联动：解析站点作用域，交由证书自动部署任务上传绑定（复用现有部署逻辑）=====

  private async getZoneName(zoneId: string): Promise<string> {
    const data = await this.send('DescribeZones', { Limit: 100 });
    if (!data) return '';
    for (const z of data.Zones || []) {
      if (z.ZoneId === zoneId) return z.ZoneName || '';
    }
    return '';
  }

  // 站点级证书作用域：站点根域 + 一级通配符
  async getCertScope(domain: string): Promise<CertScope | false> {
    const zoneId = await this.findZone(domain);
    if (!zoneId) return false;
    const zoneName = await this.getZoneName(zoneId);
    if (!zoneName) return false;
    return { siteId: String(zoneId), siteName: zoneName, domains: [zoneName, '*.' + zoneName] };
  }

  // 复用 CDN 账户密钥生成自动部署任务计划：由证书调度器在签发/续签后自动上传并绑定
  async getCertDeployPlan(domain: string, scope: CertScope): Promise<CertDeployPlan | false> {
    if (!scope?.siteId) return false;
    return {
      accountType: 'tencent',
      accountConfig: { SecretId: this.secretId, SecretKey: this.secretKey },
      accountName: 'CDN 证书联动（腾讯云）',
      product: 'teo',
      config: { site_id: scope.siteId, domain },
    };
  }

  // 查询加速域名在 EdgeOne 云端的当前证书配置
  async getDomainCertInfo(domain: string): Promise<DomainCertInfo | false> {
    const zoneId = await this.findZone(domain);
    if (!zoneId) return false;
    const data = await this.send('DescribeAccelerationDomains', { ZoneId: zoneId, Offset: 0, Limit: 200 });
    if (!data) return false;
    const item = (data.AccelerationDomains || []).find((d: any) => d.DomainName === domain);
    if (!item) return false;
    const cert = item.Certificate || {};
    const mode = String(cert.Mode || 'disable');
    const ids: string[] = (cert.List || []).map((c: any) => String(c?.CertId || '')).filter(Boolean);
    const mutual = cert.ClientCertInfo?.Switch === 'on';
    const httpsEnabled = (mode && mode !== 'disable') || mutual;
    let source: DomainCertInfo['source'] = 'unknown';
    if (mode === 'disable') source = 'none';
    else if (mode.startsWith('eofreecert')) source = 'platform';
    else if (mode === 'sslcert') source = 'custom';
    const sourceLabel =
      source === 'platform'
        ? '平台免费证书（EdgeOne 自动签发）'
        : source === 'custom'
          ? '由本项目管理上传'
          : source === 'none'
            ? '未配置证书'
            : `未知（${mode}）`;
    const certs: any[] = ids.map((id) => ({ id, source: source === 'platform' ? 'platform' : 'custom' }));
    // sslcert：用腾讯云 SSL 接口补全证书名称 / 覆盖域名 / 有效期
    if (mode === 'sslcert' && ids.length) {
      const ssl = new TencentCloud(this.secretId, this.secretKey, 'ssl.tencentcloudapi.com', 'ssl', '2019-12-05');
      try {
        const res: any = await ssl.request('DescribeCertificates', { CertificateIds: ids });
        const map = new Map<string, any>();
        for (const c of res?.Certificates || []) map.set(String(c.CertificateId || ''), c);
        for (const it of certs) {
          const c = map.get(it.id);
          if (!c) continue;
          it.name = c.Alias || c.Domain || undefined;
          it.commonName = c.Domain || c.CommonName || undefined;
          it.san = String(c.SubjectAltName || c.Domain || '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
          it.issuer = c.Issuer || undefined;
          it.notBefore = c.CertBeginTime || c.NotBefore || undefined;
          it.notAfter = c.CertEndTime || c.NotAfter || undefined;
        }
      } catch {
        // 补全失败时仅展示证书 ID
      }
    }
    return { httpsEnabled, mode, source, sourceLabel, certs };
  }

  async getZoneSetting(zoneId: string) {
    const data = await this.send('DescribeL7AccSetting', { ZoneId: zoneId });
    if (!data) return false;
    return data.ZoneSetting?.ZoneConfig || {};
  }

  async updateZoneSetting(zoneId: string, zoneConfig: Record<string, any>) {
    return (await this.send('ModifyL7AccSetting', { ZoneId: zoneId, ZoneConfig: zoneConfig })) !== false;
  }

  async purge(urls: string[], type: 'url' | 'dir'): Promise<string | false> {
    const zoneId = await this.findZone(urls[0] || '');
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点';
      return false;
    }
    const data = await this.send('CreatePurgeTask', {
      ZoneId: zoneId,
      Type: type === 'dir' ? 'purge_prefix' : 'purge_url',
      Targets: urls,
      EncodeUrl: false,
    });
    if (!data) return false;
    return data.TaskId || data.JobId || 'ok';
  }

  async preheat(urls: string[]): Promise<string | false> {
    const zoneId = await this.findZone(urls[0] || '');
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点';
      return false;
    }
    const data = await this.send('CreatePrefetchTask', { ZoneId: zoneId, Targets: urls, EncodeUrl: false });
    if (!data) return false;
    return data.TaskId || data.JobId || 'ok';
  }

  private async describeSecurityPolicy(domain: string): Promise<any[] | false> {
    const zoneId = await this.findZone(domain);
    if (!zoneId) return false;
    const data = await this.send('DescribeSecurityPolicy', { ZoneId: zoneId, Entity: 'ZoneDefaultPolicy' });
    if (!data) return false;
    return data.SecurityPolicy?.CustomRules?.Rules || [];
  }

  async getAccess(domain: string): Promise<Record<string, any> | false> {
    const rules = await this.describeSecurityPolicy(domain);
    if (rules === false) return false;
    const out: Record<string, any> = { referer_mode: 'off', referer_list: [], ip_mode: 'off', ip_list: [], ua_list: [] };
    for (const r of rules) {
      const name = r?.Name;
      const condition = String(r?.Condition || '');
      if (name === 'dnsmgr_ip_acl') {
        out.ip_mode = condition.includes('not') ? 'whitelist' : 'blacklist';
        out.ip_list = this.parseConditionList(condition);
      } else if (name === 'dnsmgr_referer') {
        out.referer_mode = condition.includes('not') ? 'whitelist' : 'blacklist';
        out.referer_list = this.parseConditionList(condition);
      } else if (name === 'dnsmgr_user_agent') {
        out.ua_list = this.parseConditionList(condition);
      }
    }
    return out;
  }

  async setAccess(domain: string, config: Record<string, any>): Promise<boolean> {
    const zoneId = await this.findZone(domain);
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点';
      return false;
    }
    const data = await this.send('DescribeSecurityPolicy', { ZoneId: zoneId, Entity: 'ZoneDefaultPolicy' });
    if (data === false) return false;
    const existing = data?.SecurityPolicy?.CustomRules?.Rules || [];
    const keep = existing
      .filter((r: any) => !String(r?.Name || '').startsWith('dnsmgr_'))
      .map((r: any) => this.copyCustomRule(r));
    const additions = this.buildAccessRules(config);
    const ok = await this.send('ModifySecurityPolicy', {
      ZoneId: zoneId,
      Entity: 'ZoneDefaultPolicy',
      SecurityConfig: {},
      SecurityPolicy: { CustomRules: { Rules: [...keep, ...additions] } },
    });
    return ok !== false;
  }

  private copyCustomRule(r: any): any {
    return {
      Id: r?.Id,
      Name: r?.Name,
      Condition: r?.Condition,
      Enabled: r?.Enabled ?? 'on',
      RuleType: r?.RuleType,
      Priority: r?.Priority,
      Action: r?.Action ? { Name: r.Action.Name } : undefined,
    };
  }

  private buildAccessRules(config: Record<string, any>): any[] {
    const rules: any[] = [];
    const refererMode = config.referer_mode || 'off';
    if (refererMode === 'whitelist' || refererMode === 'blacklist') {
      const cond = `\${http.request.headers['referer']} like ${this.conditionList(config.referer_list || [])}`;
      rules.push({
        Name: 'dnsmgr_referer',
        Condition: refererMode === 'whitelist' ? `not (${cond})` : cond,
        Enabled: 'on',
        RuleType: 'PreciseMatchRule',
        Priority: 10,
        Action: { Name: 'Deny' },
      });
    }
    const ipMode = config.ip_mode || 'off';
    if (ipMode === 'whitelist' || ipMode === 'blacklist') {
      const cond = `\${http.request.ip} in ${this.conditionList(config.ip_list || [])}`;
      rules.push({
        Name: 'dnsmgr_ip_acl',
        Condition: ipMode === 'whitelist' ? `not (${cond})` : cond,
        Enabled: 'on',
        RuleType: 'BasicAccessRule',
        Action: { Name: 'Deny' },
      });
    }
    if ((config.ua_list || []).length) {
      rules.push({
        Name: 'dnsmgr_user_agent',
        Condition: `\${http.request.headers['user-agent']} like ${this.conditionList(config.ua_list || [])}`,
        Enabled: 'on',
        RuleType: 'PreciseMatchRule',
        Priority: 12,
        Action: { Name: 'Deny' },
      });
    }
    return rules;
  }

  private conditionList(values: string[]): string {
    const escaped = values.map((v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'");
    return `[${escaped.join(', ')}]`;
  }

  private parseConditionList(condition: string): string[] {
    const m = condition.match(/\[([^\]]*)\]/);
    if (!m) return [];
    return m[1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, '').replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
      .filter(Boolean);
  }

  // ===== Phase 1：站点（Zone）生命周期 =====

  async createZone(params: Record<string, any>): Promise<ZoneSummary | false> {
    const name = String(params?.name || '').trim();
    if (!name) {
      this.error = '站点名称不能为空';
      return false;
    }
    const type = String(params?.type || 'partial');
    const area = String(params?.area || 'overseas');
    const param: Record<string, any> = { ZoneName: name, Type: type, Area: area };
    if (params?.planId) param.PlanId = String(params.planId);
    const d = await this.send('CreateZone', param);
    if (!d) return false;
    const ov = d.OwnershipVerification || {};
    return {
      zoneId: String(d.ZoneId || ''),
      zoneName: name,
      type,
      area,
      ownershipVerification: ov,
      verifyCode: ov.DnsVerification?.RecordValue ?? ov.FileVerification?.Content ?? '',
      nameServers: ov.NsVerification?.NameServers ?? [],
    };
  }

  async deleteZone(zoneId: string): Promise<boolean> {
    return (await this.send('DeleteZone', { ZoneId: zoneId })) !== false;
  }

  async setZonePaused(zoneId: string, paused: boolean): Promise<boolean> {
    return (await this.send('ModifyZoneStatus', { ZoneId: zoneId, Paused: paused })) !== false;
  }

  // 分页遍历站点，规避 DescribeZones 单页 100 条上限
  private async findZoneById(zoneId: string): Promise<any | null> {
    const limit = 100;
    for (let offset = 0; offset < limit * 50; offset += limit) {
      const data = await this.send('DescribeZones', { Offset: offset, Limit: limit });
      if (!data) return null;
      const zones = data.Zones || [];
      const z = zones.find((x: any) => String(x.ZoneId) === String(zoneId));
      if (z) return z;
      if (zones.length < limit) break;
    }
    return null;
  }

  async getZonePaused(zoneId: string): Promise<boolean | false> {
    const z = await this.findZoneById(zoneId);
    if (!z) return false;
    return z.Paused === true || String(z.Status || '').toLowerCase() === 'paused';
  }

  async identifyZone(zoneName: string): Promise<Record<string, any> | false> {
    return this.send('IdentifyZone', { ZoneName: zoneName });
  }

  async verifyOwnership(zoneId: string, domain?: string): Promise<Record<string, any> | false> {
    let target = domain;
    if (!target) {
      const z = await this.findZoneById(zoneId);
      target = z?.ZoneName;
    }
    if (!target) {
      this.error = '未找到站点名称，无法验证归属';
      return false;
    }
    return this.send('VerifyOwnership', { Domain: target });
  }

  async checkCnameStatus(zoneId: string, recordNames: string[]): Promise<any[] | false> {
    const d = await this.send('CheckCnameStatus', { ZoneId: zoneId, RecordNames: recordNames });
    if (!d) return false;
    return d.CnameStatus || d.Records || d.Status || [];
  }

  // ===== Phase 2：源站组 / 负载均衡 =====

  async listOriginGroups(zoneId: string, page = 1, size = 20): Promise<PagedResult<OriginGroupItem> | false> {
    const data = await this.send('DescribeOriginGroup', { ZoneId: zoneId, Offset: (page - 1) * size, Limit: size });
    if (!data) return false;
    const list: OriginGroupItem[] = (data.OriginGroups || []).map((g: any) => ({
      groupId: String(g.GroupId || ''),
      name: g.Name || '',
      type: g.Type,
      records: g.Records || [],
      hostHeader: g.HostHeader,
      ...g,
    }));
    return { total: Number(data.TotalCount || list.length), list };
  }

  async createOriginGroup(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const param: Record<string, any> = { ZoneId: zoneId, Name: params.name, Type: params.type, Records: params.records || [] };
    if (params.hostHeader) param.HostHeader = params.hostHeader;
    const d = await this.send('CreateOriginGroup', param);
    return d && d.OriginGroupId ? String(d.OriginGroupId) : false;
  }

  async updateOriginGroup(zoneId: string, groupId: string, params: Record<string, any>): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId, GroupId: groupId };
    if (params.name !== undefined) param.Name = params.name;
    if (params.type !== undefined) param.Type = params.type;
    if (params.records !== undefined) param.Records = params.records;
    if (params.hostHeader !== undefined) param.HostHeader = params.hostHeader;
    return (await this.send('ModifyOriginGroup', param)) !== false;
  }

  async deleteOriginGroup(zoneId: string, groupId: string): Promise<boolean> {
    return (await this.send('DeleteOriginGroup', { ZoneId: zoneId, GroupId: groupId })) !== false;
  }

  async listLoadBalancers(zoneId: string, page = 1, size = 20): Promise<PagedResult<LoadBalancerItem> | false> {
    const data = await this.send('DescribeLoadBalancerList', { ZoneId: zoneId, Offset: (page - 1) * size, Limit: size });
    if (!data) return false;
    const list: LoadBalancerItem[] = (data.LoadBalancerList || []).map((l: any) => ({
      instanceId: String(l.InstanceId || ''),
      name: l.Name || '',
      type: l.Type,
      originGroups: (l.OriginGroupHealthStatus || []).map((g: any) => g.OriginGroupID ?? g.OriginGroupId ?? ''),
      ...l,
    }));
    return { total: Number(data.TotalCount || list.length), list };
  }

  async createLoadBalancer(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const param: Record<string, any> = { ZoneId: zoneId, Name: params.name, Type: params.type, OriginGroups: params.originGroups || [] };
    if (params.healthChecker) param.HealthChecker = params.healthChecker;
    if (params.steeringPolicy) param.SteeringPolicy = params.steeringPolicy;
    if (params.failoverPolicy) param.FailoverPolicy = params.failoverPolicy;
    const d = await this.send('CreateLoadBalancer', param);
    return d && d.InstanceId ? String(d.InstanceId) : false;
  }

  async updateLoadBalancer(zoneId: string, instanceId: string, params: Record<string, any>): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId, InstanceId: instanceId };
    if (params.name !== undefined) param.Name = params.name;
    if (params.originGroups !== undefined) param.OriginGroups = params.originGroups;
    if (params.healthChecker !== undefined) param.HealthChecker = params.healthChecker;
    if (params.steeringPolicy !== undefined) param.SteeringPolicy = params.steeringPolicy;
    if (params.failoverPolicy !== undefined) param.FailoverPolicy = params.failoverPolicy;
    return (await this.send('ModifyLoadBalancer', param)) !== false;
  }

  async deleteLoadBalancer(zoneId: string, instanceId: string): Promise<boolean> {
    return (await this.send('DeleteLoadBalancer', { ZoneId: zoneId, InstanceId: instanceId })) !== false;
  }

  // ===== Phase 3：L7 规则引擎 =====

  async getRulesSetting(): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeRulesSetting', {});
    return d || false;
  }

  async listRules(zoneId: string): Promise<RuleItem[] | false> {
    const data = await this.send('DescribeRules', { ZoneId: zoneId });
    if (!data) return false;
    return (data.RuleItems || []).map((r: any) => ({
      ruleId: String(r.RuleId || ''),
      ruleName: r.RuleName || '',
      status: r.Status,
      enabled: r.Status,
      rules: r.Rules || [],
      ...r,
    }));
  }

  async createRule(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const param: Record<string, any> = {
      ZoneId: zoneId,
      RuleName: params.ruleName,
      Status: params.status || 'enable',
      Rules: params.rules || [],
    };
    if (params.tags) param.Tags = params.tags;
    const d = await this.send('CreateRule', param);
    return d && d.RuleId ? String(d.RuleId) : false;
  }

  async updateRule(zoneId: string, ruleId: string, params: Record<string, any>): Promise<boolean> {
    const param: Record<string, any> = {
      ZoneId: zoneId,
      RuleId: ruleId,
      RuleName: params.ruleName,
      Status: params.status || 'enable',
      Rules: params.rules || [],
    };
    if (params.tags) param.Tags = params.tags;
    return (await this.send('ModifyRule', param)) !== false;
  }

  async deleteRules(zoneId: string, ruleIds: string[]): Promise<boolean> {
    return (await this.send('DeleteRules', { ZoneId: zoneId, RuleIds: ruleIds })) !== false;
  }

  async setRulePriority(zoneId: string, ruleIds: string[]): Promise<boolean> {
    return (await this.send('ModifyL7AccRulePriority', { ZoneId: zoneId, RuleIds: ruleIds })) !== false;
  }

  // ===== Phase 4：安全 =====

  async listSecurityIpGroups(zoneId: string): Promise<SecurityIpGroupItem[] | false> {
    const data = await this.send('DescribeSecurityIPGroup', { ZoneId: zoneId });
    if (!data) return false;
    return (data.IPGroups || []).map((g: any) => ({ groupId: Number(g.GroupId || 0), name: g.Name || '', content: g.Content || [], ...g }));
  }

  async createSecurityIpGroup(zoneId: string, name: string, content: string[]): Promise<number | false> {
    const d = await this.send('CreateSecurityIPGroup', { ZoneId: zoneId, IPGroup: { GroupId: 0, Name: name, Content: content } });
    return d && d.GroupId !== undefined ? Number(d.GroupId) : false;
  }

  async updateSecurityIpGroup(zoneId: string, groupId: number, name: string, content: string[], mode = 'update'): Promise<boolean> {
    return (await this.send('ModifySecurityIPGroup', { ZoneId: zoneId, IPGroup: { GroupId: groupId, Name: name, Content: content }, Mode: mode })) !== false;
  }

  async deleteSecurityIpGroup(zoneId: string, groupId: number): Promise<boolean> {
    return (await this.send('DeleteSecurityIPGroup', { ZoneId: zoneId, GroupId: groupId })) !== false;
  }

  async getSecurityIpGroupContent(zoneId: string, groupId: number): Promise<string[] | false> {
    const d = await this.send('DescribeSecurityIPGroupContent', { ZoneId: zoneId, GroupId: groupId, Limit: 1000, Offset: 0 });
    if (!d) return false;
    return d.IPList || [];
  }

  async getDdosProtection(zoneId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeDDoSProtection', { ZoneId: zoneId });
    if (!d) return false;
    return d.DDoSProtection || d;
  }

  async setDdosProtection(zoneId: string, config: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyDDoSProtection', { ZoneId: zoneId, DDoSProtection: config })) !== false;
  }

  async getWafInfo(zoneId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeWebSecurityTemplates', { ZoneIds: [zoneId] });
    if (!d) return false;
    return { templates: d.SecurityPolicyTemplates || [] };
  }

  async setWafInfo(zoneId: string, config: Record<string, any>): Promise<boolean> {
    if (config && config.TemplateId) {
      const { TemplateId, ...rest } = config;
      return (await this.send('ModifyWebSecurityTemplate', { ...rest, ZoneId: zoneId, TemplateId })) !== false;
    }
    return (await this.send('CreateWebSecurityTemplate', { ...config, ZoneId: zoneId })) !== false;
  }

  // ===== Phase 5：四层代理 =====

  async listL4Proxies(zoneId: string, page = 1, size = 20): Promise<PagedResult<L4ProxyItem> | false> {
    const data = await this.send('DescribeL4Proxy', { ZoneId: zoneId, Offset: (page - 1) * size, Limit: size });
    if (!data) return false;
    const list: L4ProxyItem[] = (data.L4Proxies || []).map((p: any) => ({ proxyId: String(p.ProxyId || ''), name: p.ProxyName || p.Name || '', area: p.Area, ...p }));
    return { total: Number(data.TotalCount || list.length), list };
  }

  async createL4Proxy(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const param: Record<string, any> = { ZoneId: zoneId, ProxyName: params.name, Area: params.area };
    if (params.ipv6 !== undefined) param.Ipv6 = params.ipv6;
    if (params.staticIp !== undefined) param.StaticIp = params.staticIp;
    if (params.accelerateMainland !== undefined) param.AccelerateMainland = params.accelerateMainland;
    if (params.ddosProtectionConfig) param.DDosProtectionConfig = params.ddosProtectionConfig;
    const d = await this.send('CreateL4Proxy', param);
    return d && d.ProxyId ? String(d.ProxyId) : false;
  }

  async updateL4Proxy(zoneId: string, proxyId: string, params: Record<string, any>): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId, ProxyId: proxyId };
    if (params.ipv6 !== undefined) param.Ipv6 = params.ipv6;
    if (params.accelerateMainland !== undefined) param.AccelerateMainland = params.accelerateMainland;
    return (await this.send('ModifyL4Proxy', param)) !== false;
  }

  async deleteL4Proxy(zoneId: string, proxyId: string): Promise<boolean> {
    return (await this.send('DeleteL4Proxy', { ZoneId: zoneId, ProxyId: proxyId })) !== false;
  }

  async listL4ProxyRules(zoneId: string, proxyId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const data = await this.send('DescribeL4ProxyRules', { ZoneId: zoneId, ProxyId: proxyId, Offset: (page - 1) * size, Limit: size });
    if (!data) return false;
    const list = data.L4ProxyRules || [];
    return { total: Number(data.TotalCount || list.length), list };
  }

  async createL4ProxyRules(zoneId: string, proxyId: string, rules: any[]): Promise<boolean> {
    return (await this.send('CreateL4ProxyRules', { ZoneId: zoneId, ProxyId: proxyId, L4ProxyRules: rules })) !== false;
  }

  async deleteL4ProxyRules(zoneId: string, proxyId: string, ruleIds: string[]): Promise<boolean> {
    return (await this.send('DeleteL4ProxyRules', { ZoneId: zoneId, ProxyId: proxyId, RuleIds: ruleIds })) !== false;
  }

  // ===== Phase 5：任务 / 配额 / 统计 =====

  async listPurgeTasks(zoneId: string | null, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const data = await this.send('DescribePurgeTasks', { ZoneId: zoneId || undefined, Offset: (page - 1) * size, Limit: size });
    if (!data) return false;
    const list = data.Tasks || [];
    return { total: Number(data.TotalCount || list.length), list };
  }

  async listPrefetchTasks(zoneId: string | null, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const data = await this.send('DescribePrefetchTasks', { ZoneId: zoneId || undefined, Offset: (page - 1) * size, Limit: size });
    if (!data) return false;
    const list = data.Tasks || [];
    return { total: Number(data.TotalCount || list.length), list };
  }

  async getContentQuota(zoneId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeContentQuota', { ZoneId: zoneId });
    return d || false;
  }

  async topAnalysis(zoneIds: string[], startTime: string, endTime: string, metricName: string, limit = 10): Promise<any[] | false> {
    const d = await this.send('DescribeTopL7AnalysisData', { ZoneIds: zoneIds, StartTime: startTime, EndTime: endTime, MetricName: metricName, Limit: limit, Interval: 'hour' });
    if (!d) return false;
    return d.Data || d.TopData || [];
  }

  async timingCacheData(zoneIds: string[], startTime: string, endTime: string, metricNames: string[]): Promise<any[] | false> {
    const d = await this.send('DescribeTimingL7CacheData', { ZoneIds: zoneIds, StartTime: startTime, EndTime: endTime, MetricNames: metricNames, Interval: 'hour' });
    if (!d) return false;
    return d.Data || [];
  }
}