import type { FastifyInstance } from 'fastify';
import { configGet, configSet } from '../config.js';
import { QqBot } from '../lib/monitor/qqbot.js';
import { audit } from '../lib/audit/context.js';
import { hitRateLimitDistributed } from '../lib/rateLimit.js';
import { consumeOneTimeTicket } from '../lib/legacyApi.js';

const BIND_REPLY = '# 绑定成功\n\n您已成功绑定QQ机器人消息通知，聚合DNS管理系统通知将通过本机器人发送。';
const UNBIND_NOTICE = '# 绑定已变更\n\n您的QQ机器人消息通知绑定已被其他账号替换。若非本人操作，请立即检查系统账号安全。';

/**
 * QQ 机器人开放平台 Webhook：
 * - op=13 回调地址验证（对 event_ts + plain_token 签名）
 * - 其他事件校验 Ed25519 签名；收到 C2C 消息时记录 openid 完成绑定
 * 该路由公开访问（无登录），但仅对签名合法的事件生效。
 *
 * 安全要点：op=13 分支同样必须先校验请求自带的 Ed25519 签名，
 * 否则公开的 op=13 会退化为「对任意 event_ts+plain_token 签名」的预言机，
 * 攻击者可借此伪造任意 Webhook 事件（如改写 qqbot_openid 劫持通知）。
 */
// 回调消息去重必须跨副本/跨重启生效：使用数据库一次性 nonce 表（legacy_nonce），
// 同一消息 ID 只能成功消费一次。数据库不可用时 fail-closed（外层返回 500）。
async function qqMessageFresh(id: string): Promise<boolean> {
  if (!id) return false;
  return consumeOneTimeTicket(`qq:${id}`, 0);
}

export default async function qqbotRoutes(app: FastifyInstance) {
  app.post('/api/qqbot/webhook', async (req: any, reply: any) => {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') return reply.code(400).send('bad request');

    const appId = String((await configGet('qqbot_appid', '')) || '').trim();
    const appSecret = String((await configGet('qqbot_appsecret', '')) || '').trim();
    if (appId === '' || appSecret === '') return reply.code(400).send('not configured');

    // 强制校验来源 AppID（去掉「省略该头即通过」的豁免）
    const headerAppId = String(req.headers['x-bot-appid'] || '').trim();
    if (headerAppId !== appId) return reply.code(403).send('appid mismatch');

    // 官方回调请求的 User-Agent 固定为 QQBot-Callback，作为额外来源约束
    const userAgent = String(req.headers['user-agent'] || '');
    if (!userAgent.includes('QQBot')) return reply.code(403).send('bad user-agent');

    try {
      const bot = new QqBot(appId, appSecret);

      // 所有回调请求（含 op=13）都必须先通过 Ed25519 验签
      const timestamp = String(req.headers['x-signature-timestamp'] || '');
      const signature = String(req.headers['x-signature-ed25519'] || '');
      const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
      if (!bot.verifySignature(timestamp, signature, rawBody)) {
        return reply.code(401).send('invalid signature');
      }
      // 签名覆盖 timestamp，但若不校验时效，截获的合法回调可被无限重放（例如把通知绑定改回旧 openid）
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
        return reply.code(401).send('stale signature timestamp');
      }

      const op = Number(payload.op || 0);
      // op=13 是无状态签名验证，无需去重；业务回调必须带消息 ID 且只能消费一次。
      if (op !== 13) {
        const messageId = String(payload?.d?.id || payload?.id || '').trim();
        if (!messageId) return reply.code(400).send('missing message id');
        if (!(await qqMessageFresh(messageId))) return reply.send('');
      }
      if (op === 13) {
        const d = payload.d && typeof payload.d === 'object' ? payload.d : {};
        return reply.send(bot.signValidation(String(d.event_ts || ''), String(d.plain_token || '')));
      }

      if (String(payload.t || '').toUpperCase() === 'C2C_MESSAGE_CREATE') {
        const d = payload.d && typeof payload.d === 'object' ? payload.d : {};
        const openid = String(d.author?.user_openid || '');
        const old = String((await configGet('qqbot_openid', '')) || '');
        // 绑定必须携带管理员在系统设置中配置的口令，避免任意 QQ 用户发消息抢占通知绑定
        const bindCode = String((await configGet('qqbot_bind_code', '')) || '').trim();
        const content = String(d.content || '').trim();
        if (bindCode === '' || content !== bindCode) {
          // 绑定口令不允许弱口令；尝试次数按全局桶限流，避免攻击者用不同 QQ 号分摊爆破。
          if (bindCode.length > 0 && bindCode.length < 8) return reply.send('');
          if (bindCode !== '') {
            const ok = await hitRateLimitDistributed('qqbot:bind-attempt', 20, 10 * 60_000);
            if (!ok) return reply.send('');
          }
          return reply.send('');
        }
        // 口令一次性使用：绑定成功后立即清空，换绑必须由管理员重新生成。
        await configSet('qqbot_bind_code', '');
        if (openid !== '' && old !== openid) {
          await configSet('qqbot_openid', openid);
          console.warn('[qqbot] 通知绑定 openid 变更：' + (old || '(空)') + ' -> ' + openid);
          // 绑定变更是安全敏感配置：必须留痕（来源 IP、旧值掩码），否则被换绑后无从追溯
          const mask = (v: string) => (v ? v.slice(0, 4) + '***' + v.slice(-2) : '(空)');
          audit(req, {
            module: 'system',
            action: 'qqbot.bind',
            targetType: 'config',
            targetName: 'qqbot_openid',
            summary: `QQ 机器人通知绑定变更：${mask(old)} → ${mask(openid)}`,
            detail: { old: mask(old), next: mask(openid), messageId: String(d.id || '') },
            scrubBody: true,
          });
          if (old !== '') {
            try {
              await bot.sendMarkdown(old, UNBIND_NOTICE);
            } catch (e: any) {
              console.error('[qqbot] 绑定变更通知发送失败:', e?.message || e);
            }
          }
          try {
            await bot.sendMarkdown(openid, BIND_REPLY, String(d.id || ''));
          } catch (e: any) {
            console.error('[qqbot] 绑定回复失败:', e?.message || e);
          }
        }
      }
      return reply.send('');
    } catch (e: any) {
      console.error('[QqBot]', e?.message || e);
      return reply.code(500).send('error');
    }
  });
}
