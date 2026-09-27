import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';

const TOKEN_URL = 'https://api.bot.qq.com/app/getAppAccessToken';
const API_BASE = 'https://api.bot.qq.com';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const REQUEST_TIMEOUT = 15_000;

interface TokenEntry {
  token: string;
  expireAt: number;
}

const tokenCache = new Map<string, TokenEntry>();

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function seedFromSecret(secret: string): Buffer {
  const base = Buffer.from(secret, 'utf8');
  let seed = base;
  while (seed.length < 32) seed = Buffer.concat([seed, base]);
  return seed.subarray(0, 32);
}

/**
 * QQ 机器人（开放平台 API v2）
 * 用于 Webhook 验签/回调校验、单聊绑定与 Markdown 消息发送。
 * 使用 Node 原生 Ed25519（crypto）实现，不依赖外部命令。
 */
export class QqBot {
  private appId: string;
  private appSecret: string;
  private privateKey: ReturnType<typeof createPrivateKey>;
  private publicKey: ReturnType<typeof createPublicKey>;

  constructor(appId: string, appSecret: string) {
    this.appId = String(appId || '').trim();
    this.appSecret = String(appSecret || '').trim();
    if (this.appId === '' || this.appSecret === '') {
      throw new Error('未配置QQ机器人AppID或AppSecret');
    }
    const seed = seedFromSecret(this.appSecret);
    this.privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
    this.publicKey = createPublicKey(this.privateKey);
  }

  /** 将站内通知模板转为 QQ Markdown */
  static toMarkdown(title: string, content: string): string {
    let c = String(content || '')
      .replace(/<br\/>/g, '\n')
      .replace(/<b>/g, '**')
      .replace(/<\/b>/g, '**');
    c = decodeEntities(c.replace(/<[^>]*>/g, '')).trim();
    return '# ' + title + '\n\n' + c;
  }

  /** 回调地址验证（op=13）：对 event_ts + plain_token 签名 */
  signValidation(eventTs: string, plainToken: string): { plain_token: string; signature: string } {
    if (!eventTs || !plainToken) throw new Error('回调校验参数不完整');
    const signature = edSign(null, Buffer.from(eventTs + plainToken, 'utf8'), this.privateKey).toString('hex');
    return { plain_token: plainToken, signature };
  }

  /** 校验 HTTP 回调签名 */
  verifySignature(timestamp: string, signatureHex: string, body: string): boolean {
    const hex = String(signatureHex || '').trim().toLowerCase();
    if (!timestamp || !hex) return false;
    let signature: Buffer;
    try {
      signature = Buffer.from(hex, 'hex');
    } catch {
      return false;
    }
    if (signature.length !== 64) return false;
    try {
      return edVerify(null, Buffer.from(timestamp + body, 'utf8'), this.publicKey, signature);
    } catch {
      return false;
    }
  }

  /** 发送 Markdown 单聊消息 */
  async sendMarkdown(userOpenid: string, markdown: string, msgId?: string | null): Promise<boolean> {
    const openid = String(userOpenid || '').trim();
    if (openid === '' || markdown === '') throw new Error('QQ机器人消息参数不完整');
    const post: Record<string, any> = { msg_type: 2, markdown: { content: markdown } };
    if (msgId !== null && msgId !== undefined && msgId !== '') {
      post.msg_id = msgId;
      post.msg_seq = 1;
    }
    const result = await this.apiRequest('POST', '/v2/users/' + encodeURIComponent(openid) + '/messages', post);
    if (result?.id) return true;
    const message = result?.message || result?.msg || '发送失败';
    throw new Error('QQ机器人发送失败：' + message);
  }

  /** 获取 access_token（带缓存） */
  async getAccessToken(): Promise<string> {
    const cacheKey = createHash('sha256').update(this.appId + ':' + this.appSecret).digest('hex');
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expireAt > Date.now()) return cached.token;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const text = await res.text();
    let arr: any;
    try {
      arr = JSON.parse(text);
    } catch {
      throw new Error('获取QQ机器人凭证失败，响应解析失败');
    }
    if (!arr || !arr.access_token) {
      const message = arr?.message || '未知错误';
      const code = arr?.code ?? '';
      throw new Error('获取QQ机器人凭证失败' + (code !== '' ? '[' + code + ']' : '') + '：' + message);
    }
    const token = String(arr.access_token);
    const ttl = Math.max(60, Number(arr.expires_in || 7200) - 120);
    tokenCache.set(cacheKey, { token, expireAt: Date.now() + ttl * 1000 });
    return token;
  }

  private async apiRequest(method: string, path: string, body: Record<string, any>): Promise<any> {
    const token = await this.getAccessToken();
    const upper = method.toUpperCase();
    const res = await fetch(API_BASE + path, {
      method: upper,
      headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
      body: upper === 'GET' ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const text = await res.text();
    let arr: any;
    try {
      arr = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('QQ机器人接口响应解析失败');
    }
    if (arr && typeof arr.code !== 'undefined' && Number(arr.code) !== 0 && !arr.id) {
      throw new Error('QQ机器人接口错误[' + arr.code + ']：' + (arr.message || '未知错误'));
    }
    return arr;
  }
}