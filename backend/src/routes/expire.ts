import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel, getUserPermissions, matchPermission } from '../auth.js';
import { configGet, configSet } from '../config.js';
import { updateDomainDate } from '../lib/expire/expireNoticeService.js';
import { audit } from '../lib/audit/context.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

const KEYS = ['expire_noticedays', 'expire_notice_mail', 'expire_notice_wxtpl', 'expire_notice_tgbot', 'expire_notice_qqbot', 'expire_notice_webhook', 'expire_notice_custom_webhook'];

export default async function expireRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  app.get('/api/expire/settings', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const data: Record<string, string | null> = {};
    for (const k of KEYS) data[k] = await configGet(k, '');
    return { code: 0, data };
  });

  app.post('/api/expire/settings', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const body = req.body || {};
    const keys = KEYS.filter((k) => k in body);
    for (const k of keys) await configSet(k, String(body[k] ?? ''));
    if (keys.length) audit(req, { summary: `保存到期提醒设置：${keys.join('、')}`, detail: { keys } });
    return { code: 0, msg: '设置保存成功' };
  });

  app.post('/api/domains/:id/update-date', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT id, name FROM ${table('domain')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '域名不存在' };
    // 普通用户仅能更新其有权限访问、且可写的域名到期时间（只读/受限子域名均拒绝）
    if (!checkLevel(req.user, 2)) {
      const perms = await getUserPermissions(req.user.uid);
      const m = matchPermission(perms, row.name, '@');
      if (m < 0) return { code: -1, msg: '无权限' };
      if (m === 1) return { code: -1, msg: '该域名仅查看，禁止修改' };
    }
    const res = await updateDomainDate(id, row.name);
    if (res?.code === 0) {
      audit(req, {
        targetType: 'domain',
        targetId: id,
        targetName: String(row.name),
        summary: `更新域名 ${row.name} 的到期时间`,
        detail: { regTime: res?.regTime, expireTime: res?.expireTime },
      });
    }
    return res;
  });

  app.post('/api/domains/batch-notice', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const b = req.body || {};
    const ids: number[] = Array.isArray(b.ids) ? b.ids.map(Number).filter((n: number) => n > 0) : [];
    const isNotice = b.is_notice == 1 ? 1 : 0;
    if (!ids.length) return { code: -1, msg: '请选择域名' };
    await query(`UPDATE ${table('domain')} SET is_notice = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [isNotice, ...ids]);
    audit(req, {
      targetType: 'domain',
      summary: `批量${isNotice ? '开启' : '关闭'}到期提醒（${ids.length} 个域名）`,
      detail: { ids: ids.slice(0, 50), is_notice: isNotice },
    });
    return { code: 0, msg: isNotice ? '已开启到期提醒' : '已关闭到期提醒' };
  });
}