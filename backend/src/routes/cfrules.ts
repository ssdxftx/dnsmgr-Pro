import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { fmtDateTime } from '../lib/util.js';
import { EnhanceError, CloudflareEnhanceService } from '../lib/cloudflare/enhance.js';
import { maskConfig } from '../lib/secret.js';
import {
  CloudflareRulesetService,
  PHASE_META,
  isSupportedPhase,
  phaseScope,
  phasePermission,
  type RulesetScope,
} from '../lib/cloudflare/ruleset.js';
import {
  getDedicatedCredential,
  saveDedicatedCredential,
  removeDedicatedCredential,
  hasDedicatedCredential,
  resolveCredential,
} from '../lib/cloudflare/rulesCredential.js';

function unwrap(e: any): { code: number; msg: string } {
  if (e instanceof EnhanceError) return { code: -1, msg: e.message };
  return { code: -1, msg: e?.message || '操作失败' };
}

async function addLog(uid: number, domain: string, action: string, data: string): Promise<void> {
  if (data.length > 500) data = data.slice(0, 500);
  await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (?, ?, ?, ?, ?)`, [
    uid,
    domain,
    action,
    data,
    fmtDateTime(new Date()),
  ]);
}

/** 统一的规则引擎错误映射：403 标记为需要专用凭证 */
function rulesError(e: any, phase: string, aid: number): { code: number; msg: string; data?: any } {
  const status = Number(e?.status ?? 0);
  const raw = String(e?.message || '');
  const permission = phasePermission(phase);
  // Cloudflare 对无效令牌返回 HTTP 400（code 9106），message 含 Authentication failed
  if (status === 401 || /authentication failed|invalid api token|invalid token/i.test(raw)) {
    return { code: -1, msg: `Cloudflare 凭证无效或已过期：${raw || '请更新凭证'}` };
  }
  if (status === 403) {
    return {
      code: -1,
      msg: `Cloudflare 权限不足：${raw || '当前凭证不具备规则引擎权限'}。请为该账户配置具备「${permission || '规则'}」权限的专用 API 令牌`,
      data: { needCredential: true, aid, phase, permission },
    };
  }
  if (status === 429) return { code: -1, msg: 'Cloudflare API 请求过于频繁，请稍后重试' };
  if (status >= 500) return { code: -1, msg: 'Cloudflare 服务暂时不可用，请稍后重试' };
  return { code: -1, msg: raw || '操作失败' };
}

interface RulesContext {
  domain: any;
  account: any;
  aid: number;
  service: CloudflareRulesetService;
}

/** 组装某域名在指定 phase 下的规则引擎上下文（含凭证解析） */
async function buildContext(domainId: number, phase: string): Promise<RulesContext> {
  const domain: any = await queryOne(`SELECT * FROM ${table('domain')} WHERE id = ?`, [domainId]);
  if (!domain) throw new EnhanceError('域名不存在', 404);
  const account: any = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [domain.aid]);
  if (!account || account.type !== 'cloudflare') throw new EnhanceError('仅支持 Cloudflare 域名');
  const zoneId = String(domain.thirdid || '').trim();
  if (!zoneId) throw new EnhanceError('当前域名缺少 Cloudflare Zone ID');

  const { config } = await resolveCredential(Number(domain.aid));
  const cf = new CloudflareEnhanceService(config);
  let scope: RulesetScope;
  if (phaseScope(phase) === 'account') {
    const accountId = String(config.account_id || '').trim() || (await cf.getDefaultAccountId());
    if (!accountId) throw new EnhanceError('缺少 Cloudflare Account ID，无法处理账户级规则');
    scope = { kind: 'account', accountId };
  } else {
    scope = { kind: 'zone', zoneId };
  }
  return { domain, account, aid: Number(domain.aid), service: new CloudflareRulesetService(cf, scope) };
}

function parseRuleBody(body: any): { domainId: number; phase: string; expression: string; action: string; actionParameters: Record<string, any>; description?: string; enabled: boolean } {
  const b = body || {};
  return {
    domainId: Number(b.domain_id || 0),
    phase: String(b.phase || '').trim(),
    expression: String(b.expression || '').trim(),
    action: String(b.action || '').trim(),
    actionParameters: b.action_parameters && typeof b.action_parameters === 'object' ? b.action_parameters : {},
    description: b.description ? String(b.description) : undefined,
    enabled: b.enabled === undefined ? true : !!b.enabled,
  };
}

export default async function cfRulesRoutes(app: FastifyInstance) {
  // 规则引擎接口仅管理员可用
  const auth = {
    preHandler: async (req: any, reply: any) => {
      await (app as any).authenticate(req, reply);
      if (!req.user) return;
      if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
    },
  };

  // 规则类型元数据（供前端渲染一致）
  app.get('/api/cf-rules/phases', auth, async () => {
    const data = Object.entries(PHASE_META).map(([value, meta]) => ({
      value,
      label: meta.label,
      scope: meta.scope,
      permission: meta.permission,
    }));
    return { code: 0, data };
  });

  // 可管理的 Cloudflare 域名
  app.get('/api/cf-rules/domains', auth, async () => {
    const rows: any[] = await query(
      `SELECT A.id, A.name, A.thirdid AS zone_id, A.aid, B.name AS account_name
       FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id
       WHERE B.type = 'cloudflare' ORDER BY A.id DESC`,
    );
    const data = rows
      .filter((r) => String(r.zone_id || '').trim())
      .map((r) => ({ id: Number(r.id), name: r.name, zone_id: r.zone_id, aid: Number(r.aid), account_name: r.account_name }));
    return { code: 0, data };
  });

  // 查询某账户凭证状态
  app.get('/api/cf-rules/credential', auth, async (req: any) => {
    const aid = Number(req.query?.aid || 0);
    if (!aid) return { code: -1, msg: '缺少账户参数' };
    const dedicated = await getDedicatedCredential(aid);
    return { code: 0, data: { has_dedicated: !!dedicated, config: dedicated ? maskConfig(dedicated) : null } };
  });

  // 保存并校验专用凭证（按 Cloudflare 账户绑定）
  app.post('/api/cf-rules/credential', auth, async (req: any) => {
    const b = req.body || {};
    const aid = Number(b.aid || 0);
    if (!aid) return { code: -1, msg: '缺少账户参数' };
    const account = await queryOne(`SELECT id FROM ${table('account')} WHERE id = ? AND type = 'cloudflare'`, [aid]);
    if (!account) return { code: -1, msg: 'Cloudflare 账户不存在' };

    const authType = Number(b.auth) === 0 ? 0 : 1;
    const email = String(b.email || '').trim();
    const apikey = String(b.apikey || '').trim();
    const accountId = String(b.account_id || '').trim();
    if (!apikey) return { code: -1, msg: '请填写 API 令牌或全局 API Key' };
    if (authType === 0 && !email) return { code: -1, msg: '全局 API Key 认证需要填写账户邮箱' };

    const config: Record<string, any> = { auth: authType, email, apikey };
    if (accountId) config.account_id = accountId;

    const cf = new CloudflareEnhanceService(config);
    try {
      const domainId = Number(b.domain_id || 0);
      if (domainId) {
        const d: any = await queryOne(`SELECT thirdid FROM ${table('domain')} WHERE id = ?`, [domainId]);
        const zoneId = String(d?.thirdid || '').trim();
        if (!zoneId) throw new EnhanceError('该域名缺少 Cloudflare Zone ID', 400);
        await cf.apiRequest('GET', `/zones/${zoneId}/rulesets`, { per_page: 1 });
      } else {
        await cf.apiRequest('GET', '/zones', { page: 1, per_page: 1 });
      }
    } catch (e: any) {
      const status = Number(e?.status ?? 0);
      const raw = String(e?.message || '');
      if (status === 401 || /authentication failed|invalid api token|invalid token/i.test(raw)) {
        return { code: -1, msg: '凭证校验失败：Cloudflare 认证失败，请检查令牌或邮箱/Key' };
      }
      if (status === 403) return { code: -1, msg: '凭证校验失败：该凭证不具备规则引擎读取权限，请确认令牌包含 Zone WAF / 规则集相关权限' };
      return { code: -1, msg: '凭证校验失败：' + (raw || '无法访问 Cloudflare API') };
    }

    await saveDedicatedCredential(aid, config);
    return { code: 0, msg: '专用凭证已保存并校验通过' };
  });

  // 移除专用凭证，回退 DNS 账户密钥
  app.delete('/api/cf-rules/credential', auth, async (req: any) => {
    const aid = Number(req.query?.aid || 0);
    if (!aid) return { code: -1, msg: '缺少账户参数' };
    await removeDedicatedCredential(aid);
    return { code: 0, msg: '已移除专用凭证，将回退使用 DNS 账户密钥' };
  });

  // 规则列表
  app.get('/api/cf-rules/rules', auth, async (req: any) => {
    const domainId = Number(req.query?.domainId || 0);
    const phase = String(req.query?.phase || '').trim();
    if (!domainId || !phase) return { code: -1, msg: '参数不完整' };
    if (!isSupportedPhase(phase)) return { code: -1, msg: '不支持的规则类型' };

    let ctx: RulesContext;
    try {
      ctx = await buildContext(domainId, phase);
    } catch (e: any) {
      return unwrap(e);
    }
    try {
      const rules = await ctx.service.listRules(phase);
      const credentialSource = (await hasDedicatedCredential(ctx.aid)) ? 'dedicated' : 'dns';
      return {
        code: 0,
        data: { rules, scope: phaseScope(phase), permission: phasePermission(phase), credential_source: credentialSource, needCredential: false },
      };
    } catch (e: any) {
      return rulesError(e, phase, ctx.aid);
    }
  });

  // 新增规则
  app.post('/api/cf-rules/rules', auth, async (req: any) => {
    const p = parseRuleBody(req.body);
    if (!p.domainId || !p.phase) return { code: -1, msg: '参数不完整' };
    if (!isSupportedPhase(p.phase)) return { code: -1, msg: '不支持的规则类型' };
    if (!p.expression) return { code: -1, msg: '表达式不能为空' };
    if (!p.action) return { code: -1, msg: 'action 不能为空' };

    let ctx: RulesContext;
    try {
      ctx = await buildContext(p.domainId, p.phase);
    } catch (e: any) {
      return unwrap(e);
    }
    try {
      const rule = await ctx.service.createRule(p.phase, {
        expression: p.expression,
        action: p.action,
        action_parameters: p.actionParameters,
        description: p.description,
        enabled: p.enabled,
      });
      await addLog(req.user.uid, ctx.domain.name, '创建 CF 规则', `${p.phase} ${p.description || ''} ${p.expression}`);
      return { code: 0, msg: '规则创建成功', data: rule };
    } catch (e: any) {
      return rulesError(e, p.phase, ctx.aid);
    }
  });

  // 更新规则
  app.put('/api/cf-rules/rules/:ruleId', auth, async (req: any) => {
    const ruleId = String(req.params.ruleId || '').trim();
    if (!ruleId) return { code: -1, msg: '缺少规则 ID' };
    const p = parseRuleBody(req.body);
    if (!p.domainId || !p.phase) return { code: -1, msg: '参数不完整' };
    if (!isSupportedPhase(p.phase)) return { code: -1, msg: '不支持的规则类型' };
    if (!p.expression) return { code: -1, msg: '表达式不能为空' };
    if (!p.action) return { code: -1, msg: 'action 不能为空' };

    let ctx: RulesContext;
    try {
      ctx = await buildContext(p.domainId, p.phase);
    } catch (e: any) {
      return unwrap(e);
    }
    try {
      const rule = await ctx.service.updateRule(p.phase, ruleId, {
        expression: p.expression,
        action: p.action,
        action_parameters: p.actionParameters,
        description: p.description,
        enabled: p.enabled,
      });
      await addLog(req.user.uid, ctx.domain.name, '更新 CF 规则', `${p.phase} ${ruleId} ${p.expression}`);
      return { code: 0, msg: '规则更新成功', data: rule };
    } catch (e: any) {
      return rulesError(e, p.phase, ctx.aid);
    }
  });

  // 删除规则
  app.delete('/api/cf-rules/rules/:ruleId', auth, async (req: any) => {
    const ruleId = String(req.params.ruleId || '').trim();
    const domainId = Number(req.query?.domainId || 0);
    const phase = String(req.query?.phase || '').trim();
    if (!ruleId || !domainId || !phase) return { code: -1, msg: '参数不完整' };
    if (!isSupportedPhase(phase)) return { code: -1, msg: '不支持的规则类型' };

    let ctx: RulesContext;
    try {
      ctx = await buildContext(domainId, phase);
    } catch (e: any) {
      return unwrap(e);
    }
    try {
      await ctx.service.deleteRule(phase, ruleId);
      await addLog(req.user.uid, ctx.domain.name, '删除 CF 规则', `${phase} ${ruleId}`);
      return { code: 0, msg: '规则删除成功' };
    } catch (e: any) {
      return rulesError(e, phase, ctx.aid);
    }
  });
}