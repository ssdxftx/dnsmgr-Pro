import type { FastifyInstance } from 'fastify';
import { configGet, configSet } from '../config.js';
import { QqBot } from '../lib/monitor/qqbot.js';

const BIND_REPLY = '# 绑定成功\n\n您已成功绑定QQ机器人消息通知，聚合DNS管理系统通知将通过本机器人发送。';

/**
 * QQ 机器人开放平台 Webhook：
 * - op=13 回调地址验证（对 event_ts + plain_token 签名）
 * - 其他事件校验 Ed25519 签名；收到 C2C 消息时记录 openid 完成绑定
 * 该路由公开访问（无登录），但仅对签名合法的事件生效。
 */
export default async function qqbotRoutes(app: FastifyInstance) {
  app.post('/api/qqbot/webhook', async (req: any, reply: any) => {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') return reply.code(400).send('bad request');

    const appId = String((await configGet('qqbot_appid', '')) || '').trim();
    const appSecret = String((await configGet('qqbot_appsecret', '')) || '').trim();
    if (appId === '' || appSecret === '') return reply.code(400).send('not configured');

    const headerAppId = String(req.headers['x-bot-appid'] || '');
    if (headerAppId !== '' && headerAppId !== appId) return reply.code(403).send('appid mismatch');

    try {
      const bot = new QqBot(appId, appSecret);
      const op = Number(payload.op || 0);
      if (op === 13) {
        const d = payload.d && typeof payload.d === 'object' ? payload.d : {};
        return reply.send(bot.signValidation(String(d.event_ts || ''), String(d.plain_token || '')));
      }

      const timestamp = String(req.headers['x-signature-timestamp'] || '');
      const signature = String(req.headers['x-signature-ed25519'] || '');
      const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
      if (!bot.verifySignature(timestamp, signature, rawBody)) {
        return reply.code(401).send('invalid signature');
      }

      if (String(payload.t || '').toUpperCase() === 'C2C_MESSAGE_CREATE') {
        const d = payload.d && typeof payload.d === 'object' ? payload.d : {};
        const openid = String(d.author?.user_openid || '');
        const old = String((await configGet('qqbot_openid', '')) || '');
        if (openid !== '' && old !== openid) {
          await configSet('qqbot_openid', openid);
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