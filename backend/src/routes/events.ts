import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { audit } from '../lib/audit/context.js';
import { assertUrlAllowed } from '../lib/netGuard.js';
import { encryptText } from '../lib/secret.js';
import { deliverToSubscription, newEventSecret, normalizeEventNames, type EventSubscription } from '../lib/events.js';
import { clampLimit, clampOffset } from '../lib/util.js';

function parseNames(value: any): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function shape(row: any): any {
  const out = { ...row, events: parseNames(row.events) };
  delete out.secret;
  out.secret_set = !!row.secret;
  return out;
}

async function validateUrl(value: any): Promise<string> {
  const url = String(value || '').trim();
  if (!url) throw new Error('回调地址不能为空');
  await assertUrlAllowed(url);
  return url;
}

export default async function eventRoutes(app: FastifyInstance): Promise<void> {
  const auth = {
    preHandler: async (req: any, reply: any) => {
      await (app as any).authenticate(req, reply);
      if (!req.user) return;
      if (!checkLevel(req.user, 2)) return reply.code(403).send({ code: -1, msg: '无权限' });
    },
  };

  app.get('/api/events/subscriptions', auth, async () => {
    const rows = await query(`SELECT * FROM ${table('event_subscription')} ORDER BY id DESC`);
    return { code: 0, data: rows.map(shape) };
  });

  app.post('/api/events/subscriptions', auth, async (req: any) => {
    let url: string;
    let events: string[];
    try {
      url = await validateUrl(req.body?.url);
      events = normalizeEventNames(req.body?.events);
    } catch (e: any) {
      return { code: -1, msg: e.message || '参数错误' };
    }
    const name = String(req.body?.name || 'Webhook').trim().slice(0, 100) || 'Webhook';
    const secret = String(req.body?.secret || '').trim().slice(0, 128) || newEventSecret();
    const active = req.body?.active === false || Number(req.body?.active) === 0 ? 0 : 1;
    const res: any = await query(
      `INSERT INTO ${table('event_subscription')}
        (name, url, secret, events, active, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
      [name, url, encryptText(secret), JSON.stringify(events), active],
    );
    audit(req, {
      targetType: 'event_subscription',
      targetId: Number(res?.insertId || 0),
      targetName: name,
      summary: `创建事件回调「${name}」`,
      detail: { url, events, active },
      scrubBody: true,
    });
    return {
      code: 0,
      msg: '已创建',
      data: { id: Number(res?.insertId || 0), name, url, secret, events, active },
    };
  });

  app.put('/api/events/subscriptions/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT * FROM ${table('event_subscription')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '订阅不存在' };
    const sets: string[] = [];
    const params: any[] = [];
    try {
      if (req.body?.name !== undefined) {
        const name = String(req.body.name || '').trim().slice(0, 100);
        if (!name) return { code: -1, msg: '名称不能为空' };
        sets.push('name = ?');
        params.push(name);
      }
      if (req.body?.url !== undefined) {
        sets.push('url = ?');
        params.push(await validateUrl(req.body.url));
      }
      if (req.body?.events !== undefined) {
        sets.push('events = ?');
        params.push(JSON.stringify(normalizeEventNames(req.body.events)));
      }
      if (req.body?.secret !== undefined) {
        sets.push('secret = ?');
        params.push(encryptText(String(req.body.secret || '').trim().slice(0, 128) || newEventSecret()));
      }
      if (req.body?.active !== undefined) {
        sets.push('active = ?');
        params.push(req.body.active === false || Number(req.body.active) === 0 ? 0 : 1);
      }
    } catch (e: any) {
      return { code: -1, msg: e.message || '参数错误' };
    }
    if (!sets.length) return { code: -1, msg: '没有可更新的字段' };
    sets.push('updated_at = NOW()');
    params.push(id);
    await query(`UPDATE ${table('event_subscription')} SET ${sets.join(', ')} WHERE id = ?`, params);
    audit(req, {
      targetType: 'event_subscription',
      targetId: id,
      targetName: String(row.name || ''),
      summary: `更新事件回调「${row.name || id}」`,
      scrubBody: true,
    });
    return { code: 0, msg: '已更新' };
  });

  app.delete('/api/events/subscriptions/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT * FROM ${table('event_subscription')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '订阅不存在' };
    await query(`DELETE FROM ${table('event_delivery')} WHERE sub_id = ?`, [id]);
    await query(`DELETE FROM ${table('event_subscription')} WHERE id = ?`, [id]);
    audit(req, {
      targetType: 'event_subscription',
      targetId: id,
      targetName: String(row.name || ''),
      summary: `删除事件回调「${row.name || id}」`,
    });
    return { code: 0, msg: '已删除' };
  });

  app.post('/api/events/subscriptions/:id/test', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT * FROM ${table('event_subscription')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '订阅不存在' };
    const sub: EventSubscription = { ...row, secret: String(row.secret || '') };
    await deliverToSubscription(sub, 'event.test', { message: 'dnsmgr-pro test event', subscription: id });
    const after: any = await queryOne(`SELECT last_status, last_error, last_sent_at FROM ${table('event_subscription')} WHERE id = ?`, [id]);
    return {
      code: after?.last_status === 1 ? 0 : -1,
      msg: after?.last_status === 1 ? '测试成功' : after?.last_error || '测试失败',
      data: after,
    };
  });

  app.get('/api/events/deliveries', auth, async (req: any) => {
    const limit = clampLimit(req.query?.limit, 20, 200);
    const offset = clampOffset(req.query?.offset);
    const subId = Number(req.query?.sub_id || 0);
    const event = String(req.query?.event || '').trim();
    const where: string[] = [];
    const params: any[] = [];
    if (subId > 0) {
      where.push('sub_id = ?');
      params.push(subId);
    }
    if (event) {
      where.push('event = ?');
      params.push(event);
    }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const total = Number((await queryOne(`SELECT COUNT(*) AS c FROM ${table('event_delivery')}${whereSql}`, params))?.c || 0);
    const rows = await query(
      `SELECT * FROM ${table('event_delivery')}${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { code: 0, data: { total, list: rows } };
  });
}
