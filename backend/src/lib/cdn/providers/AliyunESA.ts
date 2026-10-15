import { Aliyun } from '../../clients/Aliyun.js';
import type { CdnProvider, CdnDomainItem, CertScope, CertDeployPlan, DomainCertInfo, ZoneSummary, PagedResult, OriginGroupItem, LoadBalancerItem, RuleItem, L4ProxyItem } from '../types.js';
import { catalogPath, fileExtensions, normalizeValue, parsePathRule, wildcardToRegex } from '../pathRule.js';
import type { PathRuleType } from '../pathRule.js';

// params 透传时禁止覆盖的服务端控制键（由 provider 依业务语义设定）
const ESA_RESERVED_PARAM_KEYS = new Set(['Action', 'SiteId', 'Id', 'ApplicationId', 'ConfigId', 'SiteVersion']);

export class AliyunESA implements CdnProvider {
  private client: Aliyun;
  private accessKeyId: string;
  private accessKeySecret: string;
  private error = '';
  private siteId: string | null = null;

  constructor(config: Record<string, any>) {
    this.accessKeyId = config.AccessKeyId || '';
    this.accessKeySecret = config.AccessKeySecret || '';
    // ESA 端点必须带 Region（如 esa.cn-hangzhou.aliyuncs.com）；region 拼入主机名，做白名单校验避免注入
    const region = String(config.region || '').trim();
    const validRegion = /^[a-z0-9-]+$/i.test(region) ? region : 'cn-hangzhou';
    this.client = new Aliyun(this.accessKeyId, this.accessKeySecret, `esa.${validRegion}.aliyuncs.com`, '2024-09-10');
  }

  getError() {
    return this.error;
  }

  setSiteId(siteId: string) {
    this.siteId = siteId;
  }

  private async call(param: Record<string, any>): Promise<any> {
    try {
      const resp = await this.client.request(param);
      if (resp.Code && resp.Code !== 'Success') throw new Error(resp.Message || resp.Code);
      return resp;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async getZones() {
    const list: any[] = [];
    let page = 1;
    const size = 100;
    while (page < 50) {
      const data = await this.call({ Action: 'ListSites', PageNumber: page, PageSize: size });
      if (!data) break;
      for (const s of data.Sites || []) {
        list.push({ zoneId: String(s.SiteId || ''), zoneName: s.SiteName || '', status: s.Status || '', area: s.Coverage || '' });
      }
      const total = Number(data.TotalCount || 0);
      if ((data.Sites || []).length < size || list.length >= total) break;
      page++;
    }
    return list;
  }

  async check() {
    return (await this.call({ Action: 'ListSites', PageNumber: 1, PageSize: 1 })) !== false;
  }

  private getRootDomain(domain: string): string {
    const parts = domain.split('.');
    return parts.length <= 2 ? domain : parts.slice(-2).join('.');
  }

  private async findSite(domain: string): Promise<string | false> {
    if (this.siteId) return this.siteId;
    let page = 1;
    const size = 100;
    let best: any = null;
    while (page < 50) {
      const data = await this.call({ Action: 'ListSites', PageNumber: page, PageSize: size });
      if (!data) break;
      for (const s of data.Sites || []) {
        const siteName = s.SiteName || '';
        if (!siteName) continue;
        if (domain === siteName) {
          this.siteId = String(s.SiteId);
          return this.siteId;
        }
        if (domain.endsWith('.' + siteName)) {
          if (!best || siteName.length > (best.SiteName || '').length) best = s;
        }
      }
      const total = Number(data.TotalCount || 0);
      if ((data.Sites || []).length < size || page * size >= total) break;
      page++;
    }
    if (best) {
      this.siteId = String(best.SiteId);
      return this.siteId;
    }
    return false;
  }

  private async getSiteName(siteId: string): Promise<string> {
    const data = await this.call({ Action: 'GetSite', SiteId: siteId });
    return data?.SiteModel?.SiteName || '';
  }

  private async findRecord(domain: string): Promise<{ siteId: string; siteName: string; record: any } | false> {
    const siteId = await this.findSite(domain);
    if (!siteId) return false;
    const siteName = (await this.getSiteName(siteId)) || this.getRootDomain(domain);
    // ESA 的 ListRecords.RecordName 过滤与返回均为完整域名（FQDN），非主机前缀
    const data = await this.call({ Action: 'ListRecords', SiteId: siteId, PageNumber: 1, PageSize: 100, RecordName: domain });
    if (!data) return false;
    for (const r of data.Records || []) {
      if (r.RecordName === domain) return { siteId, siteName, record: r };
    }
    return false;
  }

  async createDomain(domain: string, origin: string, originType: string, serviceArea: string, zoneId?: string | null): Promise<string | false> {
    if (zoneId) this.siteId = zoneId;
    const siteId = await this.findSite(domain);
    if (!siteId) {
      this.error = '未找到该域名的 ESA 站点，请先在阿里云 ESA 控制台创建站点后再接入';
      return false;
    }
    const originVal = origin.split(';')[0].trim();
    // ESA 对 IPv4/IPv6 统一使用 A/AAAA 记录类型，主机记录为完整域名
    const type = originType === 'ipaddr' ? 'A/AAAA' : 'CNAME';
    const param: Record<string, any> = {
      Action: 'CreateRecord',
      SiteId: siteId,
      RecordName: domain,
      Type: type,
      Ttl: 600,
      Data: JSON.stringify({ value: originVal }),
      Proxied: true,
    };
    if (originType === 'domain') param.SourceType = 'Domain';
    if (!(await this.call(param))) return false;
    for (let i = 0; i < 10; i++) {
      const cname = await this.getDomainCname(domain);
      if (cname) return cname;
      await new Promise((r) => setTimeout(r, 1000));
    }
    this.error = '未获取到 CNAME，请稍后在列表刷新重试';
    return false;
  }

  async getDomainCname(domain: string): Promise<string | false> {
    const found = await this.findRecord(domain);
    if (!found) return false;
    return found.record.RecordCname || false;
  }

  async listDomains(): Promise<CdnDomainItem[] | false> {
    const list: CdnDomainItem[] = [];
    let page = 1;
    const size = 100;
    while (page < 50) {
      const data = await this.call({ Action: 'ListSites', PageNumber: page, PageSize: size });
      if (!data) return false;
      for (const s of data.Sites || []) {
        const siteId = String(s.SiteId || '');
        const siteName = s.SiteName || '';
        if (!siteId || !siteName) continue;
        let rp = 1;
        while (rp < 50) {
          const rr = await this.call({ Action: 'ListRecords', SiteId: siteId, PageNumber: rp, PageSize: size });
          if (!rr) break;
          const records = rr.Records || [];
          for (const r of records) {
            if (!r.Proxied) continue;
            if (r.RecordType !== 'A/AAAA' && r.RecordType !== 'CNAME') continue;
            const recordName = r.RecordName || '';
            const domain = recordName;
            const dataObj = r.Data && typeof r.Data === 'object' ? r.Data : {};
            const origin = dataObj.value ? String(dataObj.value) : '';
            const originType = r.RecordType === 'A/AAAA' ? 'ipaddr' : 'domain';
            list.push({
              domain,
              cname: r.RecordCname || '',
              status: 'online',
              zoneId: siteId,
              origin,
              origin_type: originType,
              origin_host: r.HostPolicy || '',
              origin_protocol: 'follow',
              http_port: 80,
              https_port: 443,
              https_enabled: false,
              force_redirect: false,
            });
          }
          const rtotal = Number(rr.TotalCount || 0);
          if (records.length < size || rp * size >= rtotal) break;
          rp++;
        }
      }
      const stotal = Number(data.TotalCount || 0);
      if ((data.Sites || []).length < size || page * size >= stotal) break;
      page++;
    }
    return list;
  }

  async deleteDomain(domain: string) {
    const found = await this.findRecord(domain);
    if (!found) {
      this.error = '未找到该域名的 ESA 记录';
      return false;
    }
    return (await this.call({ Action: 'DeleteRecord', RecordId: found.record.RecordId })) !== false;
  }

  async setDomainStatus(domain: string, status: string) {
    const found = await this.findRecord(domain);
    if (!found) {
      this.error = '未找到该域名的 ESA 记录';
      return false;
    }
    const proxied = status !== 'offline';
    // UpdateRecord 必填 Data（RecordId 亦必填）；回填原有 Type/Data，避免类型被重置
    const rec = found.record;
    return (await this.call({
      Action: 'UpdateRecord',
      RecordId: rec.RecordId,
      Type: rec.RecordType ?? rec.Type,
      Data: typeof rec.Data === 'string' ? rec.Data : JSON.stringify(rec.Data ?? {}),
      Proxied: proxied,
    })) !== false;
  }

  async updateOrigin(domain: string, origin: string, originType: string, originHost: string, originProtocol: string, httpPort: number, httpsPort: number) {
    const found = await this.findRecord(domain);
    if (!found) {
      this.error = '未找到该域名的 ESA 记录';
      return false;
    }
    const originVal = origin.split(';')[0].trim();
    const type = originType === 'ipaddr' ? 'A/AAAA' : 'CNAME';
    const param: Record<string, any> = {
      Action: 'UpdateRecord',
      RecordId: found.record.RecordId,
      Type: type,
      Data: JSON.stringify({ value: originVal }),
      HttpPorts: String(httpPort),
      HttpsPorts: String(httpsPort),
    };
    if (originType === 'domain') param.SourceType = 'Domain';
    if (originHost) param.HostPolicy = originHost;
    return (await this.call(param)) !== false;
  }

  // ===== ESA 缓存规则 / HTTPS 规则（规则引擎式，参照 multi-cloud-cdn EdgeOne 规则引擎移植思路）=====

  private esaRuleName(domain: string, suffix = ''): string {
    return 'dnsmgr_cache_' + normalizeValue(domain).replace(/[^A-Za-z0-9_-]/g, '_') + suffix;
  }

  private esaHostCondition(domain: string): string {
    return '(http.host eq "' + this.esaEscape(normalizeValue(domain)) + '"';
  }

  // ESA 规则表达式字符串字面量转义：转义反斜杠与双引号，避免值中的 " 关闭字面量造成表达式注入
  private esaEscape(s: string): string {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // dnsmgr 的 path 规则 → ESA 规则表达式的补充条件（不含 host 前缀，返回闭括号结尾的片段）
  private esaPathCondition(parsed: { type: PathRuleType; value: string }): string {
    if (parsed.type === 'file_extension') {
      const exts = fileExtensions(parsed.value);
      if (!exts.length) throw new Error('文件后缀缓存规则内容不能为空');
      return ' and http.request.uri.path matches "\\.(' + exts.map((e) => this.esaEscape(e)).join('|') + ')$")';
    }
    if (parsed.type === 'catalog') {
      const path = catalogPath(parsed.value);
      return ' and starts_with(http.request.uri.path, "' + this.esaEscape(path) + '"))';
    }
    // full_path
    const v = normalizeValue(parsed.value);
    if (v.includes('*') || v.includes('?')) {
      return ' and http.request.uri.path matches "' + this.esaEscape(wildcardToRegex(v)) + '")';
    }
    return ' and http.request.uri.path eq "' + this.esaEscape(v) + '")';
  }

  private async findEsaRule(action: string, siteId: number, ruleName: string): Promise<any | null> {
    const size = 100;
    for (let page = 1; page <= 50; page++) {
      const data = await this.call({ Action: action, SiteId: siteId, RuleName: ruleName, PageNumber: page, PageSize: size });
      if (!data) return undefined;
      const configs = data.Configs || [];
      for (const c of configs) {
        if (c.RuleName === ruleName) return c;
      }
      const total = Number(data.TotalCount || 0);
      if (configs.length < size || page * size >= total) break;
    }
    return null;
  }

  // 缓存规则：每条 dnsmgr 规则对应一条 ESA CacheRule（CacheRule 一条只能承载一个缓存行为）
  async setCacheRules(domain: string, rules: any[]) {
    const siteId = await this.findSite(domain);
    if (!siteId) {
      this.error = '未找到该域名的 ESA 站点';
      return false;
    }
    const sid = Number(siteId);
    const list = Array.isArray(rules) ? rules : [];
    // 全量同步：目标集合 = 全局规则（*）+ 逐条具体规则
    const targets: { ruleName: string; condition: string; mode: string; ttl: number }[] = [];
    const globalRule = list.find((r) => parsePathRule(r?.path).type === 'global');
    if (globalRule) {
      targets.push({
        ruleName: this.esaRuleName(domain),
        condition: this.esaHostCondition(domain) + ')',
        mode: Number(globalRule.ttl) > 0 ? 'override_origin' : 'no_cache',
        ttl: Math.max(0, Number(globalRule.ttl) || 0),
      });
    }
    let idx = 0;
    for (const r of list) {
      if (parsePathRule(r?.path).type === 'global') continue;
      idx++;
      targets.push({
        ruleName: this.esaRuleName(domain, '_' + idx),
        condition: this.esaHostCondition(domain) + this.esaPathCondition(parsePathRule(r?.path)),
        mode: Number(r?.ttl) > 0 ? 'override_origin' : 'no_cache',
        ttl: Math.max(0, Number(r?.ttl) || 0),
      });
    }
    try {
      // 同步目标规则（创建或更新）
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const existing = await this.findEsaRule('ListCacheRules', sid, t.ruleName);
        if (existing === undefined) return false;
        const base: Record<string, any> = {
          RuleName: t.ruleName,
          Rule: t.condition,
          RuleEnable: 'on',
          Sequence: i + 1,
          EdgeCacheMode: t.mode,
        };
        if (t.mode === 'override_origin') base.EdgeCacheTtl = String(t.ttl);
        if (existing?.ConfigId) {
          if (!(await this.call({ Action: 'UpdateCacheRule', SiteId: sid, ConfigId: existing.ConfigId, ...base }))) return false;
        } else {
          if (!(await this.call({ Action: 'CreateCacheRule', SiteId: sid, ...base }))) return false;
        }
      }
      // 清理多余的旧规则（_N+1 起，直到查不到）
      let extra = idx + 1;
      for (let guard = 0; guard < 100; guard++, extra++) {
        const name = this.esaRuleName(domain, '_' + extra);
        const existing = await this.findEsaRule('ListCacheRules', sid, name);
        if (existing === undefined) return false;
        if (!existing) break;
        if (!(await this.call({ Action: 'DeleteCacheRule', SiteId: sid, ConfigId: existing.ConfigId }))) return false;
      }
      return true;
    } catch (e: any) {
      this.error = '修改阿里云 ESA 缓存规则失败：' + (e.message || String(e));
      return false;
    }
  }

  // HTTPS：开关走 HttpsBasicConfiguration，强制跳转走 HttpsApplicationConfiguration（均规则式、按域名）
  async setHttps(domain: string, enabled: boolean, forceRedirect: boolean) {
    const siteId = await this.findSite(domain);
    if (!siteId) {
      this.error = '未找到该域名的 ESA 站点';
      return false;
    }
    const sid = Number(siteId);
    const host = this.esaHostCondition(domain) + ')';
    try {
      // 基础 HTTPS 开关
      const basicName = 'dnsmgr_https_' + normalizeValue(domain).replace(/[^A-Za-z0-9_-]/g, '_');
      const basic = { RuleName: basicName, Rule: host, RuleEnable: 'on', Sequence: 1, Https: enabled ? 'on' : 'off' };
      const existBasic = await this.findEsaRule('ListHttpsBasicConfigurations', sid, basicName);
      if (existBasic === undefined) return false;
      if (existBasic?.ConfigId) {
        if (!(await this.call({ Action: 'UpdateHttpsBasicConfiguration', SiteId: sid, ConfigId: existBasic.ConfigId, ...basic }))) return false;
      } else {
        if (!(await this.call({ Action: 'CreateHttpsBasicConfiguration', SiteId: sid, ...basic }))) return false;
      }
      // 强制 HTTPS 跳转
      const forceName = 'dnsmgr_httpsforce_' + normalizeValue(domain).replace(/[^A-Za-z0-9_-]/g, '_');
      const force = { RuleName: forceName, Rule: host, RuleEnable: 'on', Sequence: 1, HttpsForce: forceRedirect ? 'on' : 'off', HttpsForceCode: '302' };
      const existForce = await this.findEsaRule('ListHttpsApplicationConfigurations', sid, forceName);
      if (existForce === undefined) return false;
      if (existForce?.ConfigId) {
        if (!(await this.call({ Action: 'UpdateHttpsApplicationConfiguration', SiteId: sid, ConfigId: existForce.ConfigId, ...force }))) return false;
      } else {
        if (!(await this.call({ Action: 'CreateHttpsApplicationConfiguration', SiteId: sid, ...force }))) return false;
      }
      return true;
    } catch (e: any) {
      this.error = '修改阿里云 ESA HTTPS 配置失败：' + (e.message || String(e));
      return false;
    }
  }

  // ===== 站点证书联动：解析站点作用域，交由证书自动部署任务上传（复用现有部署逻辑）=====

  // 站点级证书作用域：站点根域 + 一级通配符
  async getCertScope(domain: string): Promise<CertScope | false> {
    const siteId = await this.findSite(domain);
    if (!siteId) return false;
    const siteName = (await this.getSiteName(siteId)) || this.getRootDomain(domain);
    if (!siteName) return false;
    return { siteId: String(siteId), siteName, domains: [siteName, '*.' + siteName] };
  }

  // 复用 CDN 账户密钥生成自动部署任务计划：由证书调度器在签发/续签后自动上传
  async getCertDeployPlan(_domain: string, scope: CertScope): Promise<CertDeployPlan | false> {
    if (!scope?.siteName) return false;
    return {
      accountType: 'aliyun',
      accountConfig: { AccessKeyId: this.accessKeyId, AccessKeySecret: this.accessKeySecret },
      accountName: 'CDN 证书联动（阿里云）',
      product: 'esa',
      config: { esa_sitename: scope.siteName, region: 'cn-hangzhou' },
    };
  }

  // 查询加速域名在 ESA 云端的当前证书配置（站点级证书列表）
  async getDomainCertInfo(domain: string): Promise<DomainCertInfo | false> {
    const siteId = await this.findSite(domain);
    if (!siteId) return false;
    const data = await this.call({ Action: 'ListCertificates', SiteId: siteId });
    if (!data) return false;
    const list: any[] = data.Result || data.Certificates || [];
    const certs = list
      .map((c: any) => {
        const san = String(c.SAN || c.SubjectAltName || '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        const isFree = String(c.Type || '').toLowerCase() === 'free';
        return {
          id: String(c.Id || c.CertificateId || ''),
          name: c.Name || undefined,
          commonName: san[0] || c.Name || undefined,
          san,
          issuer: c.Issuer || undefined,
          notBefore: c.NotBefore || undefined,
          notAfter: c.NotAfter || c.ExpireTime || undefined,
          createdAt: c.CreateTime || undefined,
          source: isFree ? ('platform' as const) : ('custom' as const),
        };
      })
      .filter((c: any) => c.id);
    // 优先展示覆盖目标域名的证书（精确或通配符），否则展示站点全部证书
    const matched = certs.filter((c: any) => c.san.some((s: string) => s === domain || (s.startsWith('*.') && domain.endsWith(s.slice(1)))));
    const use = matched.length ? matched : certs;
    const source: DomainCertInfo['source'] = use.length === 0 ? 'none' : use.some((c: any) => c.source === 'platform') ? 'platform' : 'custom';
    const sourceLabel =
      source === 'platform'
        ? '平台免费证书（ESA 站点证书）'
        : source === 'custom'
          ? '由本项目管理上传（ESA 站点证书）'
          : '未配置证书';
    return { httpsEnabled: use.length > 0, mode: source === 'platform' ? 'free' : source === 'custom' ? 'cas' : 'disable', source, sourceLabel, certs: use };
  }

  async getZoneSetting(_zoneId: string): Promise<false> {
    this.error = 'ESA 站点配置暂未支持';
    return false;
  }

  async updateZoneSetting(_zoneId: string, _zoneConfig: Record<string, any>): Promise<boolean> {
    this.error = 'ESA 站点配置暂未支持';
    return false;
  }

  async purge(urls: string[], type: 'url' | 'dir'): Promise<string | false> {
    if (!this.siteId) {
      this.error = '缺少站点 SiteId';
      return false;
    }
    const data = await this.call({
      Action: 'PurgeCaches',
      SiteId: this.siteId,
      Type: type === 'dir' ? 'directory' : 'file',
      Content: urls.join('\n'),
    });
    if (!data) return false;
    return 'ok';
  }

  async preheat(urls: string[]): Promise<string | false> {
    if (!this.siteId) {
      this.error = '缺少站点 SiteId';
      return false;
    }
    const data = await this.call({ Action: 'PreloadCaches', SiteId: this.siteId, Content: urls.join('\n') });
    if (!data) return false;
    return 'ok';
  }

  // ===== Phase 1：站点（Site）生命周期（注意 SiteId 为 integer）=====

  async checkSiteName(siteName: string): Promise<{ passed: boolean; reason?: string } | false> {
    const d = await this.call({ Action: 'CheckSiteName', SiteName: siteName });
    if (!d) return false;
    return { passed: d.Passed === true };
  }

  async createZone(params: Record<string, any>): Promise<ZoneSummary | false> {
    const name = String(params?.name || '').trim();
    if (!name) {
      this.error = '站点名称不能为空';
      return false;
    }
    const coverage = String(params?.area || params?.coverage || 'domestic');
    const accessType = String(params?.accessType || 'CNAME');
    const instanceId = String(params?.instanceId || '');
    if (!instanceId) {
      this.error = '缺少套餐实例 ID（可从 ListUserRatePlanInstances 获取）';
      return false;
    }
    const d = await this.call({ Action: 'CreateSite', SiteName: name, Coverage: coverage, AccessType: accessType, InstanceId: instanceId });
    if (!d) return false;
    return {
      zoneId: String(d.SiteId || ''),
      zoneName: name,
      area: coverage,
      type: accessType,
      nameServers: d.NameServerList || [],
      verifyCode: d.VerifyCode || '',
    };
  }

  async verifyOwnership(zoneId: string): Promise<Record<string, any> | false> {
    const d = await this.call({ Action: 'VerifySite', SiteId: Number(zoneId) });
    if (!d) return false;
    return { passed: d.Passed === true };
  }

  async getSiteNs(zoneId: string): Promise<string[] | false> {
    const d = await this.call({ Action: 'GetSiteCurrentNS', SiteId: Number(zoneId) });
    if (!d) return false;
    return d.NSList || [];
  }

  async deleteZone(zoneId: string): Promise<boolean> {
    return (await this.call({ Action: 'DeleteSite', SiteId: Number(zoneId) })) !== false;
  }

  async updateSiteAccessType(zoneId: string, accessType: string): Promise<boolean> {
    return (await this.call({ Action: 'UpdateSiteAccessType', SiteId: Number(zoneId), AccessType: accessType })) !== false;
  }

  async updateSiteCoverage(zoneId: string, coverage: string): Promise<boolean> {
    return (await this.call({ Action: 'UpdateSiteCoverage', SiteId: Number(zoneId), Coverage: coverage })) !== false;
  }

  async setZonePaused(zoneId: string, paused: boolean): Promise<boolean> {
    return (await this.call({ Action: 'UpdateSitePause', SiteId: Number(zoneId), Paused: paused })) !== false;
  }

  async getZonePaused(zoneId: string): Promise<boolean | false> {
    const d = await this.call({ Action: 'GetSitePause', SiteId: Number(zoneId) });
    if (!d) return false;
    return d.Paused === true;
  }

  async updateSiteNameExclusive(zoneId: string, enable: boolean): Promise<boolean> {
    return (await this.call({ Action: 'UpdateSiteNameExclusive', SiteId: Number(zoneId), Enable: enable ? 'on' : 'off' })) !== false;
  }

  async getSiteNameExclusive(zoneId: string): Promise<boolean | false> {
    const d = await this.call({ Action: 'GetSiteNameExclusive', SiteId: Number(zoneId) });
    if (!d) return false;
    return d.Enable === 'on';
  }

  async listPlanInstances(): Promise<any[] | false> {
    const d = await this.call({ Action: 'ListUserRatePlanInstances' });
    if (!d) return false;
    return d.InstanceInfo || [];
  }

  // ===== Phase 2：源站池 / 负载均衡 =====

  // 将对象/数组参数 JSON 化后拼入请求（ESA 数组/对象参数需 JSON.stringify）
  private withJson(body: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
      out[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    }
    return out;
  }

  // 过滤用户对象中的保留键，避免对象展开覆盖 Action/SiteId/Id 等
  private sanitizeUser(obj: any): Record<string, any> {
    const out: Record<string, any> = {};
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        if (ESA_RESERVED_PARAM_KEYS.has(k)) continue;
        out[k] = v;
      }
    }
    return out;
  }

  // 合并调用方提供的 ESA 原生字段（PascalCase），用于传入通用参数无法表达的必填项
  private applyRaw(body: Record<string, any>, params: Record<string, any>): Record<string, any> {
    for (const [k, v] of Object.entries(this.sanitizeUser(params?.params))) body[k] = v;
    return body;
  }

  // 源站组/负载均衡选中的源站池 ID → ESA DefaultPools
  private poolIds(originGroups: any): number[] {
    return (Array.isArray(originGroups) ? originGroups : [])
      .map((g: any) => Number(g?.OriginGroupId ?? g?.groupId ?? g?.Id ?? g?.id ?? g))
      .filter((n: number) => Number.isFinite(n));
  }

  // 通用记录 [{Record,Weight}] → ESA Origins[{Address,Weight,Header}]
  private esaOrigins(records: any, hostHeader?: string): any[] {
    return (Array.isArray(records) ? records : []).map((r: any) => {
      const o: Record<string, any> = { Address: r?.Record ?? r?.record ?? r?.Address ?? r?.address ?? r };
      const w = r?.Weight ?? r?.weight;
      if (w !== undefined && w !== null && w !== '') o.Weight = Number(w);
      const h = r?.Header ?? r?.header ?? hostHeader;
      if (h) o.Header = typeof h === 'string' ? { Host: [h] } : h;
      return o;
    });
  }

  async listOriginGroups(zoneId: string, page = 1, size = 20): Promise<PagedResult<OriginGroupItem> | false> {
    const d = await this.call({ Action: 'ListOriginPools', SiteId: Number(zoneId), PageNumber: page, PageSize: size });
    if (!d) return false;
    const arr = d.OriginPools || d.Pools || [];
    const list: OriginGroupItem[] = arr.map((p: any) => ({
      groupId: String(p.Id ?? p.PoolId ?? p.OriginPoolId ?? ''),
      name: p.Name || '',
      type: p.Type,
      records: p.Origins || p.OriginList || [],
      ...p,
    }));
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createOriginGroup(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const name = String(params?.name || '').trim();
    if (!name) {
      this.error = '源站组名称不能为空';
      return false;
    }
    const body: Record<string, any> = {
      Action: 'CreateOriginPool',
      SiteId: Number(zoneId),
      Name: name,
      Origins: this.esaOrigins(params?.records, params?.hostHeader),
    };
    this.applyRaw(body, params);
    const d = await this.call(this.withJson(body));
    if (!d) return false;
    return String(d.Id ?? '') || 'ok';
  }

  async updateOriginGroup(zoneId: string, groupId: string, params: Record<string, any>): Promise<boolean> {
    const body: Record<string, any> = { Action: 'UpdateOriginPool', SiteId: Number(zoneId), Id: /^\d+$/.test(groupId) ? Number(groupId) : groupId };
    // ESA UpdateOriginPool 不支持改名（req 无 Name），仅更新 Origins 等
    if (params.records !== undefined) body.Origins = this.esaOrigins(params.records, params.hostHeader);
    this.applyRaw(body, params);
    return (await this.call(this.withJson(body))) !== false;
  }

  async deleteOriginGroup(zoneId: string, groupId: string): Promise<boolean> {
    return (await this.call({ Action: 'DeleteOriginPool', SiteId: Number(zoneId), Id: /^\d+$/.test(groupId) ? Number(groupId) : groupId })) !== false;
  }

  async listLoadBalancers(zoneId: string, page = 1, size = 20): Promise<PagedResult<LoadBalancerItem> | false> {
    const d = await this.call({ Action: 'ListLoadBalancers', SiteId: Number(zoneId), PageNumber: page, PageSize: size });
    if (!d) return false;
    const arr = d.LoadBalancers || d.Balancers || [];
    const list: LoadBalancerItem[] = arr.map((l: any) => ({
      instanceId: String(l.Id ?? ''),
      name: l.Name || '',
      type: l.Type,
      originGroups: l.DefaultPools || [],
      ...l,
    }));
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createLoadBalancer(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const name = String(params?.name || '').trim();
    if (!name) {
      this.error = '负载均衡名称不能为空';
      return false;
    }
    const body: Record<string, any> = { Action: 'CreateLoadBalancer', SiteId: Number(zoneId), Name: name };
    const pools = this.poolIds(params?.originGroups);
    if (pools.length) body.DefaultPools = pools;
    if (params?.steeringPolicy !== undefined) body.SteeringPolicy = params.steeringPolicy;
    this.applyRaw(body, params);
    const d = await this.call(this.withJson(body));
    if (!d) return false;
    return String(d.Id ?? '') || 'ok';
  }

  async updateLoadBalancer(zoneId: string, instanceId: string, params: Record<string, any>): Promise<boolean> {
    const body: Record<string, any> = { Action: 'UpdateLoadBalancer', SiteId: Number(zoneId), Id: /^\d+$/.test(instanceId) ? Number(instanceId) : instanceId };
    const pools = this.poolIds(params?.originGroups);
    if (pools.length) body.DefaultPools = pools;
    if (params?.steeringPolicy !== undefined) body.SteeringPolicy = params.steeringPolicy;
    this.applyRaw(body, params);
    return (await this.call(this.withJson(body))) !== false;
  }

  async deleteLoadBalancer(zoneId: string, instanceId: string): Promise<boolean> {
    return (await this.call({ Action: 'DeleteLoadBalancer', SiteId: Number(zoneId), Id: /^\d+$/.test(instanceId) ? Number(instanceId) : instanceId })) !== false;
  }

  // ===== Phase 3：规则引擎（12 类统一 upsert；kind 形如 RedirectRule / CacheRule / HttpsBasicConfiguration）=====

  async listRuleConfigs(zoneId: string, kind: string, page = 1, size = 20): Promise<PagedResult<RuleItem> | false> {
    const sid = Number(zoneId);
    const data = await this.call({ Action: `List${kind}s`, SiteId: sid, PageNumber: page, PageSize: size });
    if (!data) return false;
    const arr = data.Configs || data.Rules || [];
    const list: RuleItem[] = arr.map((c: any) => ({
      configId: String(c.ConfigId ?? c.Id ?? ''),
      ruleName: c.RuleName || '',
      enabled: c.RuleEnable,
      status: c.RuleEnable,
      rules: [c],
      ...c,
    }));
    return { total: Number(data.TotalCount || list.length), list };
  }

  // 按 RuleName upsert：命中则 Update（带 ConfigId），否则 Create
  async upsertRuleConfig(zoneId: string, kind: string, params: Record<string, any>): Promise<boolean> {
    const sid = Number(zoneId);
    const ruleName = String(params?.RuleName || params?.ruleName || '').trim();
    if (!ruleName) {
      this.error = '规则名称不能为空';
      return false;
    }
    const body: Record<string, any> = { ...params };
    // 清除回显/透传字段，避免旧 ConfigId/SiteId/Action 覆盖本次请求的关键参数
    delete body.ruleName;
    delete body.RuleName;
    delete body.ConfigId;
    delete body.Id;
    delete body.SiteId;
    delete body.Action;
    delete body.SiteVersion;
    body.RuleName = ruleName;
    const existing = await this.findEsaRule(`List${kind}s`, sid, ruleName);
    if (existing === undefined) return false;
    if (existing?.ConfigId) {
      return (await this.call(this.withJson({ Action: `Update${kind}`, SiteId: sid, ConfigId: existing.ConfigId, ...body }))) !== false;
    }
    return (await this.call(this.withJson({ Action: `Create${kind}`, SiteId: sid, ...body }))) !== false;
  }

  async deleteRuleConfig(zoneId: string, kind: string, configId: string): Promise<boolean> {
    const sid = Number(zoneId);
    return (await this.call({ Action: `Delete${kind}`, SiteId: sid, ConfigId: /^\d+$/.test(configId) ? Number(configId) : configId })) !== false;
  }

  // ===== Phase 4：安全 =====

  async getWafInfo(zoneId: string): Promise<Record<string, any> | false> {
    const d = await this.call({ Action: 'ListWafPhases', SiteId: Number(zoneId) });
    if (!d) return false;
    return { phases: d.Phases || d.WafPhases || [] };
  }

  async setWafInfo(zoneId: string, config: Record<string, any>): Promise<boolean> {
    return (await this.call(this.withJson({ Action: 'CreateWafRule', SiteId: Number(zoneId), ...this.sanitizeUser(config) }))) !== false;
  }

  async getOriginProtection(zoneId: string): Promise<Record<string, any> | false> {
    const d = await this.call({ Action: 'GetOriginProtection', SiteId: Number(zoneId) });
    if (!d) return false;
    return d;
  }

  async setOriginProtection(zoneId: string, config: Record<string, any>): Promise<boolean> {
    return (await this.call(this.withJson({ Action: 'UpdateOriginProtection', SiteId: Number(zoneId), ...this.sanitizeUser(config) }))) !== false;
  }

  async getDdosProtection(zoneId: string): Promise<Record<string, any> | false> {
    const d = await this.call({ Action: 'DescribeHttpDDoSAttackProtection', SiteId: Number(zoneId) });
    if (!d) return false;
    return d;
  }

  async setDdosProtection(zoneId: string, config: Record<string, any>): Promise<boolean> {
    return (await this.call(this.withJson({ Action: 'SetHttpDDoSAttackProtection', SiteId: Number(zoneId), ...this.sanitizeUser(config) }))) !== false;
  }

  // ===== Phase 5：四层代理（TransportLayerApplication）=====

  async listL4Proxies(zoneId: string, page = 1, size = 20): Promise<PagedResult<L4ProxyItem> | false> {
    const d = await this.call({ Action: 'ListTransportLayerApplications', SiteId: Number(zoneId), PageNumber: page, PageSize: size });
    if (!d) return false;
    const arr = d.Applications || d.TransportLayerApplications || [];
    const list: L4ProxyItem[] = arr.map((p: any) => ({ proxyId: String(p.Id ?? p.ApplicationId ?? ''), name: p.RecordName || p.Name || '', ...p }));
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createL4Proxy(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const recordName = String(params?.name || '').trim();
    if (!recordName) {
      this.error = '四层代理名称不能为空';
      return false;
    }
    const body: Record<string, any> = { Action: 'CreateTransportLayerApplication', SiteId: Number(zoneId), RecordName: recordName };
    if (params?.ipv6 !== undefined) body.Ipv6 = String(params.ipv6);
    if (params?.staticIp !== undefined) body.StaticIp = String(params.staticIp);
    if (params?.rules !== undefined) body.Rules = params.rules;
    this.applyRaw(body, params);
    const d = await this.call(this.withJson(body));
    if (!d) return false;
    return String(d.ApplicationId ?? '') || 'ok';
  }

  async updateL4Proxy(zoneId: string, proxyId: string, params: Record<string, any>): Promise<boolean> {
    const body: Record<string, any> = { Action: 'UpdateTransportLayerApplication', SiteId: Number(zoneId), ApplicationId: /^\d+$/.test(proxyId) ? Number(proxyId) : proxyId };
    if (params?.ipv6 !== undefined) body.Ipv6 = String(params.ipv6);
    if (params?.staticIp !== undefined) body.StaticIp = String(params.staticIp);
    if (params?.rules !== undefined) body.Rules = params.rules;
    this.applyRaw(body, params);
    return (await this.call(this.withJson(body))) !== false;
  }

  async deleteL4Proxy(zoneId: string, proxyId: string): Promise<boolean> {
    return (await this.call({ Action: 'DeleteTransportLayerApplication', SiteId: Number(zoneId), ApplicationId: /^\d+$/.test(proxyId) ? Number(proxyId) : proxyId })) !== false;
  }

  // ===== Phase 5：任务 / 配额 / 缓存增强 =====

  async listPurgeTasks(zoneId: string | null, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.call({ Action: 'DescribePurgeTasks', SiteId: zoneId ? Number(zoneId) : undefined, PageNumber: page, PageSize: size });
    if (!d) return false;
    const arr = d.Tasks || [];
    return { total: Number(d.TotalCount || arr.length), list: arr };
  }

  async listPrefetchTasks(zoneId: string | null, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.call({ Action: 'DescribePreloadTasks', SiteId: zoneId ? Number(zoneId) : undefined, PageNumber: page, PageSize: size });
    if (!d) return false;
    const arr = d.Tasks || [];
    return { total: Number(d.TotalCount || arr.length), list: arr };
  }

  async getPurgeQuota(zoneId: string, type: string): Promise<Record<string, any> | false> {
    const d = await this.call({ Action: 'GetPurgeQuota', SiteId: Number(zoneId), Type: type });
    return d || false;
  }

  async uploadFile(zoneId: string, url: string, type: string, taskName: string): Promise<string | false> {
    const d = await this.call({ Action: 'UploadFile', SiteId: Number(zoneId), Url: url, Type: type, UploadTaskName: taskName });
    return d && d.UploadId ? String(d.UploadId) : false;
  }

  async listUploadTasks(zoneId: string | null, type?: string): Promise<any[] | false> {
    const d = await this.call({ Action: 'ListUploadTasks', SiteId: zoneId ? Number(zoneId) : undefined, Type: type });
    if (!d) return false;
    return d.Tasks || d.UploadTasks || [];
  }

  async updateDevelopmentMode(zoneId: string, enable: boolean): Promise<boolean> {
    return (await this.call({ Action: 'UpdateDevelopmentMode', SiteId: Number(zoneId), Enable: enable ? 'on' : 'off' })) !== false;
  }

  async updateCacheTag(zoneId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.call(this.withJson({ Action: 'UpdateCacheTag', SiteId: Number(zoneId), ...this.sanitizeUser(params) }))) !== false;
  }

  async blockObject(zoneId: string, type: string, content: string[], maxage?: number): Promise<string | false> {
    const body: Record<string, any> = { Action: 'BlockObject', SiteId: Number(zoneId), Type: type, Content: content };
    if (maxage !== undefined) body.Maxage = maxage;
    const d = await this.call(this.withJson(body));
    return d && d.TaskId ? String(d.TaskId) : false;
  }

  async updateTieredCache(zoneId: string, mode: string): Promise<boolean> {
    return (await this.call({ Action: 'UpdateTieredCache', SiteId: Number(zoneId), CacheArchitectureMode: mode })) !== false;
  }
}