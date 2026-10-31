import { TencentCloud } from '../../clients/TencentCloud.js';
import type { CdnProvider, CdnDomainItem, CertScope, CertDeployPlan, FreeCertResult, DomainCertInfo, ZoneSummary, PagedResult, OriginGroupItem, LoadBalancerItem, RuleItem, SecurityIpGroupItem, L4ProxyItem } from '../types.js';
import { catalogPath, fileExtensions, normalizeValue, parsePathRule, splitRuleValues, wildcardToRegex } from '../pathRule.js';
import type { PathRuleType } from '../pathRule.js';
import { fromEnabled, toEnabled } from '../vendorSwitch.js';
import { mapPool } from '../../util.js';

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
    const zones = await this.listAllZones();
    if (zones === false) return [];

    // DescribeIdentifications 的 Filters 必填且 Values 上限 20：按站点名分批查询
    const identMap = new Map<string, string>();
    const names = zones.map((z: any) => String(z.ZoneName || '')).filter(Boolean);
    for (let i = 0; i < names.length; i += 20) {
      const batch = names.slice(i, i + 20);
      const resp = await this.send('DescribeIdentifications', {
        Offset: 0,
        Limit: 100,
        Filters: [{ Name: 'zone-name', Values: batch }],
      });
      if (!resp) continue; // 单批失败不影响其他批次
      for (const it of resp.Identifications || []) {
        if (it?.ZoneName) identMap.set(String(it.ZoneName), String(it.Status || '').toLowerCase());
      }
    }

    return zones.map((z: any) => {
      const ident = identMap.get(String(z.ZoneName)) || '';
      const status = String(z.Status || '').toLowerCase();
      const ns = (z.NSDetail?.NameServers ?? z.NameServers ?? []).map((x: any) => String(x).toLowerCase());
      const resources = Array.isArray(z.Resources) ? z.Resources : [];
      const plan = resources.find((r: any) => r?.PlanId || r?.PlanName || r?.PlanType) || {};
      return {
        zoneId: z.ZoneId,
        zoneName: z.ZoneName,
        type: z.Type || z.ZoneType || '',
        status: z.Status,
        area: z.Area,
        // DescribeZones 本身已返回 Paused，这里一并带出，避免调用方逐站再查一次（N+1）
        paused: z.Paused === true,
        identificationStatus: ident,
        planId: String(plan.PlanId || z.PlanId || ''),
        planName: String(plan.PlanName || plan.PlanType || ''),
        planExpireTime: String(plan.ExpireTime || plan.ExpiredTime || ''),
        // 三路判定：识别接口明确完成 / 站点已生效 / NS 已切换到 EdgeOne
        ownershipVerified:
          ident === 'finished' ||
          ident === 'verified' ||
          ident === 'success' ||
          status === 'active' ||
          ns.some((x: string) => x.includes('teodns')),
      };
    });
  }

  // DescribeZones 单页上限 100 条，站点数超过 100 时必须翻页，否则列表截断、按域名定位失败
  private async listAllZones(): Promise<any[] | false> {
    const limit = 100;
    const all: any[] = [];
    for (let offset = 0; offset < limit * 100; offset += limit) {
      const data = await this.send('DescribeZones', { Offset: offset, Limit: limit });
      if (!data) return false;
      const zones: any[] = data.Zones || [];
      all.push(...zones);
      if (zones.length < limit) break;
    }
    return all;
  }

  async check() {
    return (await this.send('DescribeZones', { Limit: 1 })) !== false;
  }

  private async findZone(domain: string): Promise<string | false> {
    if (this.zoneId) return this.zoneId;
    const zones = await this.listAllZones();
    if (zones === false) return false;
    // 按域名后缀匹配 ZoneName（最长匹配优先），避免 example.com.cn / example.co.uk
    // 这类多标签公共后缀被「取末两段」错误解析为 com.cn / co.uk
    let bestId = '';
    let bestLen = -1;
    for (const zone of zones) {
      const zn = String(zone?.ZoneName || '');
      if (!zn || !zone?.ZoneId) continue;
      if (domain === zn || domain.endsWith('.' + zn)) {
        if (zn.length > bestLen) {
          bestLen = zn.length;
          bestId = String(zone.ZoneId);
        }
      }
    }
    if (!bestId) return false;
    this.zoneId = bestId;
    return bestId;
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

  // 站点内加速域名可能超过单页上限，统一翻页拉全量，避免列表/定位/CNAME 查询漏读
  private async listAllAccelerationDomains(zoneId: string): Promise<any[] | false> {
    const limit = 100;
    const all: any[] = [];
    for (let offset = 0; offset < limit * 200; offset += limit) {
      const data = await this.send('DescribeAccelerationDomains', { ZoneId: zoneId, Offset: offset, Limit: limit });
      if (!data) return false;
      const arr = data.AccelerationDomains || [];
      all.push(...arr);
      if (arr.length < limit) break;
      if (data.TotalCount != null && offset + arr.length >= data.TotalCount) break;
    }
    return all;
  }

  async getDomainCname(domain: string): Promise<string | false> {
    const zoneId = await this.findZone(domain);
    if (!zoneId) return false;
    const list = await this.listAllAccelerationDomains(zoneId);
    if (list === false) return false;
    for (const d of list) {
      if (d.DomainName === domain && d.Cname) return d.Cname;
    }
    return false;
  }

  async listDomains(): Promise<CdnDomainItem[] | false> {
    this.zoneErrors = [];
    const zones = await this.listAllZones();
    if (zones === false) return false;
    // 站点间 4 并发：站点多时避免逐站串行拉设置 + 加速域名造成分钟级列表
    const results = await mapPool(zones, 4, async (z: any) => {
      const out: CdnDomainItem[] = [];
      const zoneId = z.ZoneId || '';
      if (!zoneId) return out;
      let zoneForceRedirect = false;
      const zs = await this.send('DescribeL7AccSetting', { ZoneId: zoneId });
      if (zs) zoneForceRedirect = zs.ZoneSetting?.ZoneConfig?.ForceRedirectHTTPS?.Switch === 'on';
      const dr = await this.listAllAccelerationDomains(zoneId);
      if (dr === false) {
        this.zoneErrors.push(z.ZoneName + ': ' + this.error);
        return out;
      }
      for (const d of dr) {
        const originDetail = d.OriginDetail || {};
        const originVal = originDetail.Origin || '';
        const originType = originVal && /^\d+\.\d+\.\d+\.\d+/.test(originVal) ? 'ipaddr' : 'domain';
        const protoMap: Record<string, string> = { HTTP: 'http', HTTPS: 'https', FOLLOW: 'follow' };
        const cert = d.Certificate || {};
        const mode = cert.Mode || '';
        const httpsEnabled = (mode && mode !== 'disable') || cert.ClientCertInfo?.Switch === 'on';
        out.push({
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
      return out;
    });
    return results.flat();
  }

  async listSharedCnames(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeSharedCNAME', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.SharedCNAMEInfo || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createSharedCname(zoneId: string, prefix: string, description?: string): Promise<string | false> {
    const param: Record<string, any> = { ZoneId: zoneId, SharedCNAMEPrefix: prefix };
    if (description) param.Description = description;
    const d = await this.send('CreateSharedCNAME', param);
    return d && d.SharedCNAME ? String(d.SharedCNAME) : false;
  }

  async updateSharedCname(zoneId: string, sharedCname: string, description?: string): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId, SharedCNAME: sharedCname };
    if (description !== undefined) param.Description = description;
    return (await this.send('ModifySharedCNAME', param)) !== false;
  }

  async bindSharedCname(zoneId: string, bindType: string, maps: any[]): Promise<boolean> {
    return (await this.send('BindSharedCNAME', {
      ZoneId: zoneId,
      BindType: bindType === 'unbind' ? 'unbind' : 'bind',
      BindSharedCNAMEMaps: maps,
    })) !== false;
  }

  async deleteSharedCname(zoneId: string, sharedCname: string): Promise<boolean> {
    return (await this.send('DeleteSharedCNAME', { ZoneId: zoneId, SharedCNAME: sharedCname })) !== false;
  }

  async listAliasDomains(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeAliasDomains', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.AliasDomains || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createAliasDomain(zoneId: string, params: Record<string, any>): Promise<boolean> {
    const param: Record<string, any> = {
      ZoneId: zoneId,
      AliasName: String(params.aliasName || ''),
      TargetName: String(params.targetName || ''),
      CertType: String(params.certType || 'none'),
    };
    if (Array.isArray(params.certIds) && params.certIds.length) param.CertId = params.certIds.map((x: any) => String(x));
    return (await this.send('CreateAliasDomain', param)) !== false;
  }

  async updateAliasDomain(zoneId: string, params: Record<string, any>): Promise<boolean> {
    const param: Record<string, any> = {
      ZoneId: zoneId,
      AliasName: String(params.aliasName || ''),
      TargetName: String(params.targetName || ''),
    };
    if (params.certType !== undefined) param.CertType = String(params.certType);
    if (Array.isArray(params.certIds) && params.certIds.length) param.CertId = params.certIds.map((x: any) => String(x));
    return (await this.send('ModifyAliasDomain', param)) !== false;
  }

  async setAliasDomainStatus(zoneId: string, aliasNames: string[], paused: boolean): Promise<boolean> {
    return (await this.send('ModifyAliasDomainStatus', { ZoneId: zoneId, AliasNames: aliasNames, Paused: paused })) !== false;
  }

  async deleteAliasDomain(zoneId: string, aliasName: string): Promise<boolean> {
    return (await this.send('DeleteAliasDomain', { ZoneId: zoneId, AliasNames: [aliasName] })) !== false;
  }

  async listCustomErrorPages(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeCustomErrorPages', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.ErrorPages || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createCustomErrorPage(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const param: Record<string, any> = {
      ZoneId: zoneId,
      Name: String(params.name || ''),
      ContentType: String(params.contentType || 'text/html'),
      Content: String(params.content || ''),
    };
    if (params.description !== undefined) param.Description = String(params.description || '');
    const d = await this.send('CreateCustomizeErrorPage', param);
    return d && d.PageId ? String(d.PageId) : false;
  }

  async updateCustomErrorPage(zoneId: string, pageId: string, params: Record<string, any>): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId, PageId: pageId };
    if (params.name !== undefined) param.Name = String(params.name || '');
    if (params.description !== undefined) param.Description = String(params.description || '');
    if (params.contentType !== undefined) param.ContentType = String(params.contentType || '');
    if (params.content !== undefined) param.Content = String(params.content || '');
    return (await this.send('ModifyCustomErrorPage', param)) !== false;
  }

  async deleteCustomErrorPage(zoneId: string, pageId: string): Promise<boolean> {
    return (await this.send('DeleteCustomErrorPage', { ZoneId: zoneId, PageId: pageId })) !== false;
  }

  async deleteDomain(domain: string) {
    const zoneId = await this.findZone(domain);
    if (!zoneId) {
      this.error = '未找到该域名的 EdgeOne 站点';
      return false;
    }
    // EdgeOne 要求域名处于停用状态才能删除：在线时先停用再删除
    const list = await this.listAllAccelerationDomains(zoneId);
    if (list !== false) {
      const cur = list.find((d: any) => d.DomainName === domain);
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
      // 具体路径规则（优先级高）在前，全局规则（host 命中即生效）最后；
      // 全部通过「域名级」L7 加速规则下发，避免改写站点级 ZoneConfig.Cache 而影响同一 Zone 下的其它域名。
      const entries: { rule: { type: PathRuleType; value: string }; ttl: number; global?: boolean }[] = [];
      const globalRule = list.find((r) => parsePathRule(r?.path).type === 'global');
      for (const r of list) {
        const parsed = parsePathRule(r?.path);
        if (parsed.type === 'global') continue;
        entries.push({ rule: parsed, ttl: Math.max(0, Number(r?.ttl) || 0) });
      }
      if (globalRule) entries.push({ rule: parsePathRule('*'), ttl: Math.max(0, Number(globalRule.ttl) || 0), global: true });

      const ruleName = this.edgeOneCacheRuleName(domain);
      const existing = await this.findEdgeOneL7Rule(zoneId, ruleName);
      if (!entries.length) {
        if (existing?.RuleId) {
          await this.client.request('DeleteL7AccRules', { ZoneId: zoneId, RuleIds: [existing.RuleId] });
        }
        return true;
      }
      const item = this.buildCacheRuleEngineItem(domain, entries);
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

  private buildCacheRuleEngineItem(domain: string, entries: { rule: { type: PathRuleType; value: string }; ttl: number; global?: boolean }[]): Record<string, any> {
    const hostCondition = "${http.request.host} in ['" + this.escapeConditionValue(domain) + "']";
    const subRules = entries.map((e) => ({
      Branches: [
        {
          // 全局规则同样以 host 条件表达（不额外限定路径），置于最后以避免覆盖具体路径规则
          Condition: e.global ? hostCondition : this.buildCacheRuleCondition(e.rule),
          Actions: [{ Name: 'Cache', CacheParameters: this.buildRuleCacheParameters(e.ttl) }],
        },
      ],
      Description: [JSON.stringify({ path: e.global ? '*' : normalizeValue(e.rule.value), ttl: e.ttl })],
    }));
    return {
      Status: 'enable',
      RuleName: this.edgeOneCacheRuleName(domain),
      Description: ['dnsmgr cache rules for ' + domain],
      Branches: [
        {
          Condition: hostCondition,
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
    const list = await this.listAllAccelerationDomains(zoneId);
    if (list === false) return false;
    const item = list.find((d: any) => d.DomainName === domain);
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
    // 注意：SecurityConfig 是 ModifySecurityPolicy 的必填参数（官方文档「必选=是」），
    // 即使只用 SecurityPolicy 下发（SecurityConfig 内的 Acl/IpTable 会被忽略）也必须传空对象，
    // 否则接口直接返回参数缺失错误。历史实现漏传导致 EO 访问控制保存必失败。
    const ok = await this.send('ModifySecurityPolicy', {
      ZoneId: zoneId,
      Entity: 'ZoneDefaultPolicy',
      SecurityConfig: {},
      SecurityPolicy: { CustomRules: { Rules: [...keep, ...additions] } },
    });
    return ok !== false;
  }

  private copyCustomRule(r: any): any {
    // 完整保留 Action（含各 <Name>Parameters），仅改访问控制时不得丢失用户已有规则的参数，
    // 否则保存后其它自定义安全规则会失效（如 Deny 的响应页/跳转等）
    return {
      Id: r?.Id,
      Name: r?.Name,
      Condition: r?.Condition,
      Enabled: r?.Enabled ?? 'on',
      RuleType: r?.RuleType,
      Priority: r?.Priority,
      Action: r?.Action ? JSON.parse(JSON.stringify(r.Action)) : undefined,
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

  // 套餐列表：EO 的 DescribePlans 单页上限 100，站点较多时统一翻页
  async listPlanInstances(): Promise<any[] | false> {
    const limit = 100;
    const all: any[] = [];
    for (let offset = 0; offset < limit * 100; offset += limit) {
      const data = await this.send('DescribePlans', {
        Offset: offset,
        Limit: limit,
        Order: 'enable-time',
        Direction: 'desc',
      });
      if (!data) return false;
      const plans: any[] = data.Plans || [];
      all.push(...plans);
      if (plans.length < limit) break;
      if (data.TotalCount != null && offset + plans.length >= Number(data.TotalCount)) break;
    }
    return all
      .map((p: any) => ({
        ...p,
        InstanceId: String(p.PlanId || ''),
        PlanId: String(p.PlanId || ''),
        PlanName: String(p.PlanName || p.PlanType || p.PlanId || ''),
        ExpireTime: p.ExpireTime || p.ExpiredTime || '',
      }))
      .filter((p: any) => p.InstanceId);
  }

  async bindZoneToPlan(zoneId: string, planId: string): Promise<boolean> {
    return (await this.send('BindZoneToPlan', { ZoneId: zoneId, PlanId: planId })) !== false;
  }

  async modifyZone(zoneId: string, params: Record<string, any>): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId };
    if (params.type !== undefined) param.Type = String(params.type);
    if (params.area !== undefined) param.Area = String(params.area);
    if (params.aliasZoneName !== undefined) param.AliasZoneName = String(params.aliasZoneName || '');
    if (params.vanityNs !== undefined) {
      const servers = (Array.isArray(params.vanityNs) ? params.vanityNs : String(params.vanityNs || '').split(','))
        .map((x: any) => String(x).trim())
        .filter(Boolean);
      param.VanityNameServers = { Switch: servers.length ? 'on' : 'off', Servers: servers };
    }
    if (Object.keys(param).length === 1) {
      this.error = '没有需要修改的站点属性';
      return false;
    }
    return (await this.send('ModifyZone', param)) !== false;
  }

  async getSiteProperties(zoneId: string): Promise<Record<string, any> | false> {
    const z = await this.findZoneById(zoneId);
    if (!z) {
      this.error = '未找到站点';
      return false;
    }
    const vanity = z.VanityNameServers || {};
    return {
      zoneId: z.ZoneId,
      zoneName: z.ZoneName,
      aliasZoneName: z.AliasZoneName || '',
      type: z.Type || z.ZoneType || '',
      area: z.Area || '',
      status: z.Status || '',
      paused: z.Paused === true,
      nameServers: z.NSDetail?.NameServers || z.NameServers || [],
      vanityNameServers: vanity.Servers || [],
      vanityNameServersSwitch: vanity.Switch || 'off',
      resources: z.Resources || [],
      workModeInfos: z.WorkModeInfos || [],
    };
  }

  async exportZoneConfig(zoneId: string, types: string[] = []): Promise<string | false> {
    const param: Record<string, any> = { ZoneId: zoneId };
    if (types.length) param.Types = types;
    const d = await this.send('ExportZoneConfig', param);
    if (!d) return false;
    return d.Content || '';
  }

  async importZoneConfig(zoneId: string, content: string): Promise<string | false> {
    if (!content.trim()) {
      this.error = '配置内容不能为空';
      return false;
    }
    const d = await this.send('ImportZoneConfig', { ZoneId: zoneId, Content: content });
    if (!d) return false;
    return d.TaskId || '';
  }

  async getZoneConfigImportResult(zoneId: string, taskId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeZoneConfigImportResult', { ZoneId: zoneId, TaskId: taskId });
    return d || false;
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

  async getLoadBalancerHealth(zoneId: string, instanceId: string): Promise<any[] | false> {
    const d = await this.send('DescribeOriginGroupHealthStatus', {
      ZoneId: zoneId,
      LBInstanceId: instanceId,
    });
    if (!d) return false;
    return d.OriginGroupHealthStatusList || [];
  }

  // ===== Phase 3：L7 规则引擎（官方 L7Acc 接口，与控制台「规则引擎」完全一致）=====
  // 旧版 CreateRule/DescribeRules/ModifyRule/DeleteRules 已被腾讯云标记为「旧」，
  // 控制台实际使用 CreateL7AccRules/DescribeL7AccRules/ModifyL7AccRule/DeleteL7AccRules，
  // 规则以 { RuleName, Branches:[{ Condition, Actions:[{Name,<Name>Parameters}] }] } 结构表达。

  // 旧版规则元数据接口（保留以兼容 /rules/setting）
  async getRulesSetting(): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeRulesSetting', {});
    return d || false;
  }

  // DescribeL7AccRules 单页上限 200，站点规则较多时必须翻页，否则列表截断
  private async listAllL7Rules(zoneId: string): Promise<any[] | false> {
    const limit = 200;
    const all: any[] = [];
    for (let offset = 0; offset < limit * 100; offset += limit) {
      const data = await this.send('DescribeL7AccRules', { ZoneId: zoneId, Offset: offset, Limit: limit });
      if (!data) return false;
      const rules: any[] = data.Rules || [];
      all.push(...rules);
      if (rules.length < limit) break;
      if (data.TotalCount != null && offset + rules.length >= data.TotalCount) break;
    }
    return all;
  }

  async listRules(zoneId: string): Promise<RuleItem[] | false> {
    const rules = await this.listAllL7Rules(zoneId);
    if (rules === false) return false;
    return rules.map((r: any) => ({
      ...r,
      ruleId: String(r.RuleId || ''),
      ruleName: r.RuleName || '',
      // 统一布尔语义（EO 原生为 enable/disable），与 ESA 侧一致，前端只读该字段
      enabled: toEnabled(r.Status),
      status: r.Status,
      priority: Number(r.RulePriority || 0),
      branches: r.Branches || [],
      description: r.Description || [],
    }));
  }

  // 组装 CreateL7AccRules/ModifyL7AccRule 的 RuleEngineItem（RuleId 由调用方按需追加）
  private buildL7RuleItem(params: Record<string, any>): Record<string, any> {
    const enabled = params?.enabled !== undefined ? toEnabled(params.enabled) : toEnabled(params?.status ?? 'enable');
    const item: Record<string, any> = {
      RuleName: params.ruleName,
      Status: fromEnabled(enabled, 'eo'),
      Branches: params.branches || [],
    };
    if (Array.isArray(params.description) && params.description.length) item.Description = params.description;
    return item;
  }

  async createRule(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateL7AccRules', { ZoneId: zoneId, Rules: [this.buildL7RuleItem(params)] });
    if (!d) return false;
    return String(d.RuleIds?.[0] || 'ok');
  }

  async updateRule(zoneId: string, ruleId: string, params: Record<string, any>): Promise<boolean> {
    const rule = { ...this.buildL7RuleItem(params), RuleId: ruleId };
    return (await this.send('ModifyL7AccRule', { ZoneId: zoneId, Rule: rule })) !== false;
  }

  async deleteRules(zoneId: string, ruleIds: string[]): Promise<boolean> {
    return (await this.send('DeleteL7AccRules', { ZoneId: zoneId, RuleIds: ruleIds })) !== false;
  }

  async setRulePriority(zoneId: string, ruleIds: string[]): Promise<boolean> {
    return (await this.send('ModifyL7AccRulePriority', { ZoneId: zoneId, RuleIds: ruleIds })) !== false;
  }

  async getZoneCustomVariables(zoneId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeZoneCustomVariables', { ZoneId: zoneId });
    if (!d) return false;
    return {
      CustomVariables: d.CustomVariables || [],
      CustomVariableOperations: d.CustomVariableOperations || [],
    };
  }

  async setZoneCustomVariables(zoneId: string, params: Record<string, any>): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId };
    if (params.CustomVariables !== undefined) param.CustomVariables = params.CustomVariables;
    if (params.CustomVariableOperations !== undefined) param.CustomVariableOperations = params.CustomVariableOperations;
    return (await this.send('ModifyZoneCustomVariables', param)) !== false;
  }

  async listFunctions(zoneId: string): Promise<any[] | false> {
    const d = await this.send('DescribeFunctions', { ZoneId: zoneId, Offset: 0, Limit: 100 });
    if (!d) return false;
    return d.Functions || [];
  }

  async createFunction(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateFunction', { ZoneId: zoneId, ...params });
    return d && d.FunctionId ? String(d.FunctionId) : false;
  }

  async updateFunction(zoneId: string, functionId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyFunction', { ZoneId: zoneId, FunctionId: functionId, ...params })) !== false;
  }

  async deleteFunction(zoneId: string, functionId: string): Promise<boolean> {
    return (await this.send('DeleteFunction', { ZoneId: zoneId, FunctionId: functionId })) !== false;
  }

  async getFunctionRuntime(zoneId: string, functionId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeFunctionRuntimeEnvironment', { ZoneId: zoneId, FunctionId: functionId });
    return d || false;
  }

  async handleFunctionRuntime(zoneId: string, functionId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('HandleFunctionRuntimeEnvironment', { ZoneId: zoneId, FunctionId: functionId, ...params })) !== false;
  }

  async listFunctionReplicas(zoneId: string, functionId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeFunctionReplicas', {
      ZoneId: zoneId,
      FunctionId: functionId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.FunctionReplicas || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createFunctionReplica(zoneId: string, functionId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('CreateFunctionReplica', { ZoneId: zoneId, FunctionId: functionId, ...params })) !== false;
  }

  async updateFunctionReplica(zoneId: string, functionId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyFunctionReplica', { ZoneId: zoneId, FunctionId: functionId, ...params })) !== false;
  }

  async deleteFunctionReplicas(zoneId: string, functionId: string, replicaNames: string[]): Promise<boolean> {
    return (await this.send('DeleteFunctionReplica', { ZoneId: zoneId, FunctionId: functionId, ReplicaNames: replicaNames })) !== false;
  }

  async listFunctionBindings(zoneId: string, functionId: string): Promise<any[] | false> {
    const d = await this.send('DescribeFunctionComponentBindings', { ZoneId: zoneId, FunctionId: functionId, Offset: 0, Limit: 1000 });
    if (!d) return false;
    return d.FunctionComponentBindings || [];
  }

  async modifyFunctionBindings(zoneId: string, functionId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyFunctionComponentBindings', { ZoneId: zoneId, FunctionId: functionId, ...params })) !== false;
  }

  async listFunctionRules(zoneId: string): Promise<any[] | false> {
    const d = await this.send('DescribeFunctionRules', { ZoneId: zoneId });
    if (!d) return false;
    return d.FunctionRules || [];
  }

  async createFunctionRule(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateFunctionRule', { ZoneId: zoneId, ...params });
    return d && d.RuleId ? String(d.RuleId) : false;
  }

  async updateFunctionRule(zoneId: string, ruleId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyFunctionRule', { ZoneId: zoneId, RuleId: ruleId, ...params })) !== false;
  }

  async deleteFunctionRules(zoneId: string, ruleIds: string[]): Promise<boolean> {
    return (await this.send('DeleteFunctionRules', { ZoneId: zoneId, RuleIds: ruleIds })) !== false;
  }

  async listKvNamespaces(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeEdgeKVNamespaces', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.Namespaces || d.KVNamespaces || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createKvNamespace(zoneId: string, namespace: string, remark?: string): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId, Namespace: namespace };
    if (remark) param.Remark = remark;
    return (await this.send('CreateEdgeKVNamespace', param)) !== false;
  }

  async updateKvNamespace(zoneId: string, namespace: string, remark?: string): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId, Namespace: namespace };
    if (remark !== undefined) param.Remark = remark;
    return (await this.send('ModifyEdgeKVNamespace', param)) !== false;
  }

  async deleteKvNamespace(zoneId: string, namespace: string): Promise<boolean> {
    return (await this.send('DeleteEdgeKVNamespace', { ZoneId: zoneId, Namespace: namespace })) !== false;
  }

  async kvGet(zoneId: string, namespace: string, keys: string[]): Promise<any[] | false> {
    const d = await this.send('EdgeKVGet', { ZoneId: zoneId, Namespace: namespace, Keys: keys });
    if (!d) return false;
    return d.Data || [];
  }

  async kvPut(zoneId: string, namespace: string, key: string, value: string, expiration?: number, ttl?: number): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId, Namespace: namespace, Key: key, Value: value };
    if (expiration !== undefined) param.Expiration = expiration;
    if (ttl !== undefined) param.ExpirationTTL = ttl;
    return (await this.send('EdgeKVPut', param)) !== false;
  }

  async kvDelete(zoneId: string, namespace: string, keys: string[]): Promise<boolean> {
    return (await this.send('EdgeKVDelete', { ZoneId: zoneId, Namespace: namespace, Keys: keys })) !== false;
  }

  async kvList(zoneId: string, namespace: string, prefix?: string, cursor?: string, limit = 100): Promise<Record<string, any> | false> {
    const param: Record<string, any> = { ZoneId: zoneId, Namespace: namespace, Limit: limit };
    if (prefix) param.Prefix = prefix;
    if (cursor) param.Cursor = cursor;
    const d = await this.send('EdgeKVList', param);
    return d || false;
  }

  async listEnvironments(zoneId: string): Promise<any[] | false> {
    const d = await this.send('DescribeEnvironments', { ZoneId: zoneId });
    if (!d) return false;
    return d.EnvInfos || [];
  }

  async listConfigGroupVersions(zoneId: string, groupId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeConfigGroupVersions', {
      ZoneId: zoneId,
      GroupId: groupId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.ConfigGroupVersionInfos || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async getConfigGroupVersionDetail(zoneId: string, versionId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeConfigGroupVersionDetail', { ZoneId: zoneId, VersionId: versionId });
    return d || false;
  }

  async createConfigGroupVersion(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateConfigGroupVersion', { ...params, ZoneId: zoneId });
    return d && d.VersionId ? String(d.VersionId) : false;
  }

  async deployConfigGroupVersion(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('DeployConfigGroupVersion', { ...params, ZoneId: zoneId });
    return d && d.RecordId ? String(d.RecordId) : false;
  }

  async getDeployHistory(zoneId: string, envId: string): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeDeployHistory', { ZoneId: zoneId, EnvId: envId });
    if (!d) return false;
    const list = d.Records || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async setZoneWorkMode(zoneId: string, infos: any[]): Promise<boolean> {
    return (await this.send('ModifyZoneWorkMode', { ZoneId: zoneId, WorkModeInfos: infos })) !== false;
  }

  async listApiServices(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeSecurityAPIService', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.APIServices || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createApiService(zoneId: string, service: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateSecurityAPIService', { ZoneId: zoneId, APIServices: [service] });
    return d && Array.isArray(d.APIServiceIds) && d.APIServiceIds.length ? String(d.APIServiceIds[0]) : false;
  }

  async updateApiService(zoneId: string, service: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifySecurityAPIService', { ZoneId: zoneId, APIServices: [service] })) !== false;
  }

  async deleteApiService(zoneId: string, id: string): Promise<boolean> {
    return (await this.send('DeleteSecurityAPIService', { ZoneId: zoneId, APIServiceIds: [id] })) !== false;
  }

  async listApiResources(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeSecurityAPIResource', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.APIResources || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createApiResource(zoneId: string, resource: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateSecurityAPIResource', { ZoneId: zoneId, APIResources: [resource] });
    return d && Array.isArray(d.APIResourceIds) && d.APIResourceIds.length ? String(d.APIResourceIds[0]) : false;
  }

  async updateApiResource(zoneId: string, resource: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifySecurityAPIResource', { ZoneId: zoneId, APIResources: [resource] })) !== false;
  }

  async deleteApiResource(zoneId: string, id: string): Promise<boolean> {
    return (await this.send('DeleteSecurityAPIResource', { ZoneId: zoneId, APIResourceIds: [id] })) !== false;
  }

  async getAvailableRuleActions(): Promise<any[] | false> {
    const d = await this.send('DescribeAvailableCustomActionsForRuleEngine', {});
    if (!d) return false;
    return d.CustomActions || d.Actions || [];
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

  async getOriginProtection(zoneId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeOriginACL', { ZoneId: zoneId });
    return d || false;
  }

  async setOriginProtection(zoneId: string, config: Record<string, any>): Promise<boolean> {
    if (config?.enabled === false) {
      return (await this.send('DisableOriginACL', { ZoneId: zoneId })) !== false;
    }
    if (config?.enabled === true) {
      const param: Record<string, any> = { ZoneId: zoneId };
      if (Array.isArray(config.OriginACLEntities)) param.OriginACLEntities = config.OriginACLEntities;
      if (config.OriginACLFamily) param.OriginACLFamily = config.OriginACLFamily;
      return (await this.send('EnableOriginACL', param)) !== false;
    }
    const param: Record<string, any> = { ZoneId: zoneId };
    if (Array.isArray(config?.OriginACLEntities)) param.OriginACLEntities = config.OriginACLEntities;
    if (config?.OriginACLFamily) param.OriginACLFamily = config.OriginACLFamily;
    if (Object.keys(param).length === 1) {
      this.error = '没有需要修改的源站防护配置';
      return false;
    }
    return (await this.send('ModifyOriginACL', param)) !== false;
  }

  async confirmOriginAclUpdate(zoneId: string): Promise<boolean> {
    return (await this.send('ConfirmOriginACLUpdate', { ZoneId: zoneId })) !== false;
  }

  async getOriginAclFamilies(zoneId: string): Promise<any[] | false> {
    const d = await this.send('DescribeAvailableOriginACLFamily', { ZoneId: zoneId });
    if (!d) return false;
    return d.OriginACLFamilyInfos || d.Families || [];
  }

  async listJsInjectionRules(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeSecurityJSInjectionRule', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.JSInjectionRules || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createJsInjectionRule(zoneId: string, rule: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateSecurityJSInjectionRule', { ZoneId: zoneId, JSInjectionRules: [rule] });
    return d && Array.isArray(d.JSInjectionRuleIds) && d.JSInjectionRuleIds.length ? String(d.JSInjectionRuleIds[0]) : false;
  }

  async updateJsInjectionRule(zoneId: string, rule: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifySecurityJSInjectionRule', { ZoneId: zoneId, JSInjectionRules: [rule] })) !== false;
  }

  async deleteJsInjectionRule(zoneId: string, ruleId: string): Promise<boolean> {
    return (await this.send('DeleteSecurityJSInjectionRule', { ZoneId: zoneId, JSInjectionRuleIds: [ruleId] })) !== false;
  }

  async listClientAttesters(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeSecurityClientAttester', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.ClientAttesters || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createClientAttester(zoneId: string, attester: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateSecurityClientAttester', { ZoneId: zoneId, ClientAttesters: [attester] });
    return d && Array.isArray(d.ClientAttesterIds) && d.ClientAttesterIds.length ? String(d.ClientAttesterIds[0]) : false;
  }

  async updateClientAttester(zoneId: string, attester: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifySecurityClientAttester', { ZoneId: zoneId, ClientAttesters: [attester] })) !== false;
  }

  async deleteClientAttester(zoneId: string, attesterId: string): Promise<boolean> {
    return (await this.send('DeleteSecurityClientAttester', { ZoneId: zoneId, ClientAttesterIds: [attesterId] })) !== false;
  }

  async listContentIdentifiers(page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeContentIdentifiers', {
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.ContentIdentifiers || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createContentIdentifier(params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateContentIdentifier', params);
    return d && d.ContentId ? String(d.ContentId) : false;
  }

  async updateContentIdentifier(contentId: string, description: string): Promise<boolean> {
    return (await this.send('ModifyContentIdentifier', { ContentId: contentId, Description: description })) !== false;
  }

  async deleteContentIdentifier(contentId: string): Promise<boolean> {
    return (await this.send('DeleteContentIdentifier', { ContentId: contentId })) !== false;
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
    const templates: any[] = d.SecurityPolicyTemplates || [];
    return { total: Number(d.TotalCount || templates.length), templates };
  }

  async setWafInfo(zoneId: string, config: Record<string, any>): Promise<boolean> {
    if (config && config.TemplateId) {
      const { TemplateId, ...rest } = config;
      return (await this.send('ModifyWebSecurityTemplate', { ...rest, ZoneId: zoneId, TemplateId })) !== false;
    }
    return (await this.send('CreateWebSecurityTemplate', { ...config, ZoneId: zoneId })) !== false;
  }

  async getWafTemplate(zoneId: string, templateId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeWebSecurityTemplate', { ZoneId: zoneId, TemplateId: templateId });
    if (!d) return false;
    return d.SecurityPolicy || d;
  }

  async deleteWafTemplate(zoneId: string, templateId: string): Promise<boolean> {
    return (await this.send('DeleteWebSecurityTemplate', { ZoneId: zoneId, TemplateId: templateId })) !== false;
  }

  async getWafTemplateBindings(zoneId: string, templateIds: string[]): Promise<any[] | false> {
    if (!templateIds.length) return [];
    const d = await this.send('DescribeSecurityTemplateBindings', {
      ZoneId: zoneId,
      TemplateId: templateIds,
    });
    if (!d) return false;
    return d.SecurityTemplate || [];
  }

  async bindWafTemplate(zoneId: string, templateId: string, entities: string[], operate: string, overWrite?: boolean): Promise<boolean> {
    if (!templateId || !entities.length) {
      this.error = '策略模板和域名不能为空';
      return false;
    }
    const param: Record<string, any> = {
      ZoneId: zoneId,
      TemplateId: templateId,
      Entities: entities,
      Operate: operate,
    };
    if (overWrite !== undefined) param.OverWrite = overWrite;
    return (await this.send('BindSecurityTemplateToEntity', param)) !== false;
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

  async setL4ProxyStatus(zoneId: string, proxyId: string, status: string): Promise<boolean> {
    return (await this.send('ModifyL4ProxyStatus', {
      ZoneId: zoneId,
      ProxyId: proxyId,
      Status: status === 'offline' ? 'offline' : 'online',
    })) !== false;
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

  async updateL4ProxyRules(zoneId: string, proxyId: string, rules: any[]): Promise<boolean> {
    return (await this.send('ModifyL4ProxyRules', {
      ZoneId: zoneId,
      ProxyId: proxyId,
      L4ProxyRules: rules,
    })) !== false;
  }

  async setL4ProxyRulesStatus(zoneId: string, proxyId: string, ruleIds: string[], status: string): Promise<boolean> {
    return (await this.send('ModifyL4ProxyRulesStatus', {
      ZoneId: zoneId,
      ProxyId: proxyId,
      RuleIds: ruleIds,
      Status: status === 'offline' ? 'offline' : 'online',
    })) !== false;
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

  async listRealtimeLogTasks(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeRealtimeLogDeliveryTasks', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.RealtimeLogDeliveryTasks || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createRealtimeLogTask(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateRealtimeLogDeliveryTask', { ...params, ZoneId: zoneId });
    return d && d.TaskId ? String(d.TaskId) : false;
  }

  async updateRealtimeLogTask(zoneId: string, taskId: string, params: Record<string, any>): Promise<boolean> {
    // 官方限制：TaskType / LogType / Area 创建后不可修改
    const { TaskType: _taskType, LogType: _logType, Area: _area, ...rest } = params;
    return (await this.send('ModifyRealtimeLogDeliveryTask', { ...rest, ZoneId: zoneId, TaskId: taskId })) !== false;
  }

  async deleteRealtimeLogTask(zoneId: string, taskId: string): Promise<boolean> {
    return (await this.send('DeleteRealtimeLogDeliveryTask', { ZoneId: zoneId, TaskId: taskId })) !== false;
  }

  async downloadL7Logs(
    zoneIds: string[],
    startTime: string,
    endTime: string,
    limit = 20,
    offset = 0,
    domains: string[] = [],
  ): Promise<PagedResult<any> | false> {
    const param: Record<string, any> = { ZoneIds: zoneIds, StartTime: startTime, EndTime: endTime, Limit: limit, Offset: offset };
    if (domains.length) param.Domains = domains;
    const d = await this.send('DownloadL7Logs', param);
    if (!d) return false;
    const list = d.Data || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async downloadL4Logs(
    zoneIds: string[],
    startTime: string,
    endTime: string,
    limit = 20,
    offset = 0,
    proxyIds: string[] = [],
  ): Promise<PagedResult<any> | false> {
    const param: Record<string, any> = { ZoneIds: zoneIds, StartTime: startTime, EndTime: endTime, Limit: limit, Offset: offset };
    if (proxyIds.length) param.ProxyIds = proxyIds;
    const d = await this.send('DownloadL4Logs', param);
    if (!d) return false;
    const list = d.Data || [];
    return { total: Number(d.TotalCount || list.length), list };
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

  async getPrefetchOriginLimit(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribePrefetchOriginLimit', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.Limits || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async setPrefetchOriginLimit(zoneId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyPrefetchOriginLimit', {
      ZoneId: zoneId,
      DomainName: String(params.domainName || ''),
      Area: String(params.area || 'Overseas'),
      Bandwidth: Number(params.bandwidth || 0),
      Enabled: params.enabled === false || params.enabled === 'off' ? 'off' : 'on',
    })) !== false;
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

  async getDdosAttackEvents(zoneIds: string[], startTime: string, endTime: string, limit = 20): Promise<any[] | false> {
    const d = await this.send('DescribeDDoSAttackEvent', {
      ZoneIds: zoneIds,
      StartTime: startTime,
      EndTime: endTime,
      Limit: limit,
      Offset: 0,
      ShowDetail: true,
    });
    if (!d) return false;
    return d.Data || [];
  }

  async getDdosAttackTop(zoneIds: string[], startTime: string, endTime: string, metricName: string, limit = 10): Promise<any[] | false> {
    const d = await this.send('DescribeDDoSAttackTopData', {
      ZoneIds: zoneIds,
      StartTime: startTime,
      EndTime: endTime,
      MetricName: metricName,
      Limit: limit,
    });
    if (!d) return false;
    return d.Data || [];
  }

  async getL4TimingData(zoneIds: string[], startTime: string, endTime: string, metricNames: string[], interval = 'hour'): Promise<any[] | false> {
    const d = await this.send('DescribeTimingL4Data', {
      ZoneIds: zoneIds,
      StartTime: startTime,
      EndTime: endTime,
      MetricNames: metricNames,
      Interval: interval,
    });
    if (!d) return false;
    return d.Data || [];
  }

  async getIpRegion(ips: string[]): Promise<any[] | false> {
    if (!ips.length) return [];
    const d = await this.send('DescribeIPRegion', { IPs: ips });
    if (!d) return false;
    return d.IPRegionInfo || [];
  }

  async listMultiPathGatewayRegions(zoneId: string): Promise<any[] | false> {
    const d = await this.send('DescribeMultiPathGatewayRegions', { ZoneId: zoneId });
    if (!d) return false;
    return d.GatewayRegions || [];
  }

  async listMultiPathGateways(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeMultiPathGateways', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.Gateways || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createMultiPathGateway(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateMultiPathGateway', { ZoneId: zoneId, ...params });
    return d && d.GatewayId ? String(d.GatewayId) : false;
  }

  async getMultiPathGateway(zoneId: string, gatewayId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeMultiPathGateway', { ZoneId: zoneId, GatewayId: gatewayId });
    if (!d) return false;
    return d.GatewayDetail || false;
  }

  async updateMultiPathGateway(zoneId: string, gatewayId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyMultiPathGateway', { ZoneId: zoneId, GatewayId: gatewayId, ...params })) !== false;
  }

  async deleteMultiPathGateway(zoneId: string, gatewayId: string): Promise<boolean> {
    return (await this.send('DeleteMultiPathGateway', { ZoneId: zoneId, GatewayId: gatewayId })) !== false;
  }

  async setMultiPathGatewayStatus(zoneId: string, gatewayId: string, status: string): Promise<boolean> {
    return (await this.send('ModifyMultiPathGatewayStatus', { ZoneId: zoneId, GatewayId: gatewayId, GatewayStatus: status })) !== false;
  }

  async createMultiPathGatewayLine(zoneId: string, gatewayId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateMultiPathGatewayLine', { ZoneId: zoneId, GatewayId: gatewayId, ...params });
    return d && d.LineId ? String(d.LineId) : false;
  }

  async getMultiPathGatewayLine(zoneId: string, gatewayId: string, lineId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeMultiPathGatewayLine', { ZoneId: zoneId, GatewayId: gatewayId, LineId: lineId });
    if (!d) return false;
    return d.Line || false;
  }

  async updateMultiPathGatewayLine(zoneId: string, gatewayId: string, lineId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyMultiPathGatewayLine', { ZoneId: zoneId, GatewayId: gatewayId, LineId: lineId, ...params })) !== false;
  }

  async deleteMultiPathGatewayLine(zoneId: string, gatewayId: string, lineId: string): Promise<boolean> {
    return (await this.send('DeleteMultiPathGatewayLine', { ZoneId: zoneId, GatewayId: gatewayId, LineId: lineId })) !== false;
  }

  async getMultiPathGatewaySecretKey(zoneId: string): Promise<string | false> {
    const d = await this.send('DescribeMultiPathGatewaySecretKey', { ZoneId: zoneId });
    return d && d.SecretKey ? String(d.SecretKey) : false;
  }

  async createMultiPathGatewaySecretKey(zoneId: string, secretKey?: string): Promise<boolean> {
    const param: Record<string, any> = { ZoneId: zoneId };
    if (secretKey) param.SecretKey = secretKey;
    return (await this.send('CreateMultiPathGatewaySecretKey', param)) !== false;
  }

  async updateMultiPathGatewaySecretKey(zoneId: string, secretKey: string): Promise<boolean> {
    return (await this.send('ModifyMultiPathGatewaySecretKey', { ZoneId: zoneId, SecretKey: secretKey })) !== false;
  }

  async refreshMultiPathGatewaySecretKey(zoneId: string): Promise<boolean> {
    return (await this.send('RefreshMultiPathGatewaySecretKey', { ZoneId: zoneId })) !== false;
  }

  async getMultiPathGatewayOriginAcl(zoneId: string, gatewayId: string): Promise<Record<string, any> | false> {
    const d = await this.send('DescribeMultiPathGatewayOriginACL', { ZoneId: zoneId, GatewayId: gatewayId });
    if (!d) return false;
    return d.MultiPathGatewayOriginACLInfo || false;
  }

  async confirmMultiPathGatewayOriginAcl(zoneId: string, gatewayId: string, version: number): Promise<boolean> {
    return (await this.send('ConfirmMultiPathGatewayOriginACL', {
      ZoneId: zoneId,
      GatewayId: gatewayId,
      OriginACLVersion: version,
    })) !== false;
  }

  async listInferenceServices(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeInferenceServices', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.Services || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createInferenceService(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateInferenceService', { ZoneId: zoneId, ...params });
    return d && d.ServiceId ? String(d.ServiceId) : false;
  }

  async updateInferenceService(zoneId: string, serviceId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyInferenceService', { ZoneId: zoneId, ServiceId: serviceId, ...params })) !== false;
  }

  async operateInferenceService(zoneId: string, serviceId: string, operation: string): Promise<boolean> {
    return (await this.send('OperateInferenceService', {
      ZoneId: zoneId,
      ServiceId: serviceId,
      Operation: operation,
    })) !== false;
  }

  async listInferenceDeploymentRecords(zoneId: string, serviceId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeInferenceServiceDeploymentRecords', {
      ZoneId: zoneId,
      ServiceId: serviceId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.RecordSet || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async getInferenceDeploymentLogs(zoneId: string, serviceId: string, recordId: string, page = 1, size = 100): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeInferenceServiceDeploymentLogs', {
      ZoneId: zoneId,
      ServiceId: serviceId,
      RecordId: recordId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.DeploymentLogInfoSet || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async getInferenceMonitorData(zoneId: string, params: Record<string, any>): Promise<any[] | false> {
    const d = await this.send('DescribeInferenceServiceMonitorData', { ZoneId: zoneId, ...params });
    if (!d) return false;
    return d.InferenceServiceMonitorRecords || [];
  }

  async listInferenceApiTokens(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeInferenceAPITokens', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.Tokens || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createInferenceApiToken(zoneId: string, name: string): Promise<Record<string, any> | false> {
    const d = await this.send('CreateInferenceAPIToken', { ZoneId: zoneId, Name: name });
    if (!d) return false;
    return { TokenId: String(d.TokenId || ''), Content: String(d.Content || '') };
  }

  async deleteInferenceApiToken(zoneId: string, tokenId: string): Promise<boolean> {
    return (await this.send('DeleteInferenceAPIToken', { ZoneId: zoneId, TokenId: tokenId })) !== false;
  }

  async listInferenceDomains(zoneId: string, serviceId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeInferenceDomains', {
      ZoneId: zoneId,
      ServiceId: serviceId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.Domains || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createInferenceDomain(zoneId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('CreateInferenceDomain', { ZoneId: zoneId, ...params })) !== false;
  }

  async operateInferenceDomain(zoneId: string, params: Record<string, any>): Promise<boolean> {
    return (await this.send('OperateInferenceDomain', { ZoneId: zoneId, ...params })) !== false;
  }

  async listInferenceHardwareSpecifications(zoneId: string): Promise<any[] | false> {
    const d = await this.send('DescribeInferenceHardwareSpecifications', { ZoneId: zoneId });
    if (!d) return false;
    return d.HardwareSpecifications || [];
  }

  async listJitTranscodeTemplates(zoneId: string, page = 1, size = 20): Promise<PagedResult<any> | false> {
    const d = await this.send('DescribeJustInTimeTranscodeTemplates', {
      ZoneId: zoneId,
      Offset: (page - 1) * size,
      Limit: size,
    });
    if (!d) return false;
    const list = d.TemplateSet || [];
    return { total: Number(d.TotalCount || list.length), list };
  }

  async createJitTranscodeTemplate(zoneId: string, params: Record<string, any>): Promise<string | false> {
    const d = await this.send('CreateJustInTimeTranscodeTemplate', { ZoneId: zoneId, ...params });
    return d && d.TemplateId ? String(d.TemplateId) : false;
  }

  async deleteJitTranscodeTemplates(zoneId: string, templateIds: string[]): Promise<boolean> {
    return (await this.send('DeleteJustInTimeTranscodeTemplates', { ZoneId: zoneId, TemplateIds: templateIds })) !== false;
  }

  async getBillingData(params: Record<string, any>): Promise<any[] | false> {
    const d = await this.send('DescribeBillingData', params);
    if (!d) return false;
    return d.Data || [];
  }

  async listAvailablePlans(): Promise<any[] | false> {
    const d = await this.send('DescribeAvailablePlans', {});
    if (!d) return false;
    return d.PlanInfo || [];
  }

  async createPlan(params: Record<string, any>): Promise<Record<string, any> | false> {
    const param = { ...params };
    if (String(param.PlanType || '') === 'enterprise') {
      delete param.PrepaidPlanParam;
      delete param.AutoUseVoucher;
    }
    const d = await this.send('CreatePlan', param);
    if (!d) return false;
    return { PlanId: String(d.PlanId || ''), DealName: String(d.DealName || '') };
  }

  async createPlanForZone(zoneId: string, planType: string): Promise<Record<string, any> | false> {
    const d = await this.send('CreatePlanForZone', { ZoneId: zoneId, PlanType: planType });
    if (!d) return false;
    return { ResourceNames: d.ResourceNames || [], DealNames: d.DealNames || [] };
  }

  async updatePlan(planId: string, renewFlag: Record<string, any>): Promise<boolean> {
    return (await this.send('ModifyPlan', { PlanId: planId, RenewFlag: renewFlag })) !== false;
  }

  async renewPlan(planId: string, period: number, autoUseVoucher?: string): Promise<boolean> {
    const param: Record<string, any> = { PlanId: planId, Period: period };
    if (autoUseVoucher) param.AutoUseVoucher = autoUseVoucher;
    return (await this.send('RenewPlan', param)) !== false;
  }

  async upgradePlan(planId: string, planType: string, autoUseVoucher?: string): Promise<boolean> {
    const param: Record<string, any> = { PlanId: planId, PlanType: planType };
    if (autoUseVoucher) param.AutoUseVoucher = autoUseVoucher;
    return (await this.send('UpgradePlan', param)) !== false;
  }

  async destroyPlan(planId: string): Promise<boolean> {
    return (await this.send('DestroyPlan', { PlanId: planId })) !== false;
  }

  async increasePlanQuota(planId: string, quotaType: string, quotaNumber: number): Promise<boolean> {
    return (await this.send('IncreasePlanQuota', {
      PlanId: planId,
      QuotaType: quotaType,
      QuotaNumber: quotaNumber,
    })) !== false;
  }
}