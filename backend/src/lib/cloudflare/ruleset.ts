import { EnhanceError, type CloudflareEnhanceService } from './enhance.js';

export interface RulesetScope {
  kind: 'zone' | 'account';
  zoneId?: string;
  accountId?: string;
}

export interface GenericRuleInput {
  description?: string;
  expression: string;
  action: string;
  action_parameters?: Record<string, any>;
  enabled?: boolean;
}

export interface PhaseMeta {
  scope: 'zone' | 'account';
  label: string;
  permission: string;
}

// 8 类规则的 phase → 作用域 / 展示名 / 所需 Cloudflare 令牌权限
export const PHASE_META: Record<string, PhaseMeta> = {
  http_request_origin: { scope: 'zone', label: '回源', permission: 'Origin Rules Write' },
  http_request_dynamic_redirect: { scope: 'zone', label: '重定向', permission: 'Dynamic URL Redirects Write' },
  http_request_transform: { scope: 'zone', label: 'URL 重写', permission: 'Zone Transform Rules Write' },
  http_request_late_transform: { scope: 'zone', label: '请求头转换', permission: 'Zone Transform Rules Write' },
  http_response_headers_transform: { scope: 'zone', label: '响应头转换', permission: 'Zone Transform Rules Write' },
  http_request_cache_settings: { scope: 'zone', label: '缓存设置', permission: 'Cache Settings Write' },
  http_request_firewall_custom: { scope: 'zone', label: '防火墙', permission: 'Zone WAF Write' },
  http_ratelimit: { scope: 'zone', label: '速率限制', permission: 'Zone WAF Write' },
};

export function isSupportedPhase(phase: string): boolean {
  return Object.prototype.hasOwnProperty.call(PHASE_META, phase);
}

export function phaseScope(phase: string): 'zone' | 'account' {
  return PHASE_META[phase]?.scope === 'account' ? 'account' : 'zone';
}

export function phasePermission(phase: string): string {
  return PHASE_META[phase]?.permission || '';
}

/** 按 phase 管理 Cloudflare Ruleset 与规则 */
export class CloudflareRulesetService {
  constructor(private cf: CloudflareEnhanceService, private scope: RulesetScope) {}

  private basePath(): string {
    if (this.scope.kind === 'account') return `/accounts/${this.scope.accountId}/rulesets`;
    return `/zones/${this.scope.zoneId}/rulesets`;
  }

  private rulesetKind(): string {
    return this.scope.kind === 'account' ? 'root' : 'zone';
  }

  private async listRulesets(): Promise<any[]> {
    const result = await this.cf.apiResult('GET', this.basePath(), { per_page: 100 });
    return Array.isArray(result) ? result : [];
  }

  /** 定位指定 phase 的 ruleset id；create 为真时不存在则创建空 ruleset */
  private async resolveRulesetId(phase: string, create: boolean): Promise<string | null> {
    const list = await this.listRulesets();
    const existing = list.find((r) => r && r.phase === phase);
    if (existing?.id) return String(existing.id);
    if (!create) return null;
    const created = await this.cf.apiResult('POST', this.basePath(), {}, {
      kind: this.rulesetKind(),
      phase,
      name: `${phase} rules`,
      rules: [],
    });
    return created?.id ? String(created.id) : null;
  }

  /** 读取规则；ruleset 不存在时返回空数组，读取不产生写入 */
  async listRules(phase: string): Promise<any[]> {
    const rsId = await this.resolveRulesetId(phase, false);
    if (!rsId) return [];
    const result = await this.cf.apiResult('GET', `${this.basePath()}/${rsId}`);
    return Array.isArray(result?.rules) ? result.rules : [];
  }

  async createRule(phase: string, input: GenericRuleInput): Promise<any> {
    const rsId = await this.resolveRulesetId(phase, true);
    if (!rsId) throw new EnhanceError('无法定位或创建规则集', 400);
    const result = await this.cf.apiResult('POST', `${this.basePath()}/${rsId}/rules`, {}, {
      description: input.description,
      expression: input.expression,
      action: input.action,
      action_parameters: input.action_parameters ?? {},
      enabled: input.enabled ?? true,
    });
    return result ?? {};
  }

  async updateRule(phase: string, ruleId: string, input: GenericRuleInput): Promise<any> {
    const rsId = await this.resolveRulesetId(phase, true);
    if (!rsId) throw new EnhanceError('无法定位或创建规则集', 400);
    const result = await this.cf.apiResult('PATCH', `${this.basePath()}/${rsId}/rules/${ruleId}`, {}, {
      description: input.description,
      expression: input.expression,
      action: input.action,
      action_parameters: input.action_parameters ?? {},
      enabled: input.enabled ?? true,
    });
    return result ?? {};
  }

  async deleteRule(phase: string, ruleId: string): Promise<boolean> {
    const rsId = await this.resolveRulesetId(phase, false);
    if (!rsId) return false;
    await this.cf.apiResult('DELETE', `${this.basePath()}/${rsId}/rules/${ruleId}`);
    return true;
  }
}