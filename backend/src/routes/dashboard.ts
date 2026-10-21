import type { FastifyInstance } from 'fastify';
import { queryOne, table } from '../db.js';
import { checkLevel, getUserPermissions } from '../auth.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function domainKey(v: any): string {
  return String(v ?? '').trim().toLowerCase().replace(/\.$/, '');
}

/** 仪表盘只返回计数，避免首页为了三个数字拉取全部域名/CDN 域名 */
export default async function dashboardRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  app.get('/api/dashboard/summary', auth, async (req: any) => {
    if (checkLevel(req.user, 2)) {
      const [d, a, c] = await Promise.all([
        queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('domain')}`),
        queryOne<{ c: number }>(
          `SELECT COUNT(*) AS c FROM ${table('account')} WHERE visibility = 'shared' OR (visibility = 'private' AND owner_uid = ?)`,
          [req.user.uid],
        ),
        queryOne<{ c: number }>(
          `SELECT COUNT(*) AS c FROM ${table('cdn_domain')}
           WHERE aid IN (SELECT id FROM ${table('cdn_account')}
                         WHERE visibility = 'shared' OR (visibility = 'private' AND owner_uid = ?))`,
          [req.user.uid],
        ),
      ]);
      return {
        code: 0,
        data: {
          domains: Number(d?.c || 0),
          accounts: Number(a?.c || 0),
          cdnDomains: Number(c?.c || 0),
        },
      };
    }

    const perms = await getUserPermissions(req.user.uid);
    const names = [...new Set(perms.map((p: any) => domainKey(p.domain)).filter(Boolean))];
    let domains = 0;
    // 分批 IN，避免授权域名很多时拼出超长 SQL
    for (let i = 0; i < names.length; i += 500) {
      const chunk = names.slice(i, i + 500);
      const row = await queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('domain')}
         WHERE LOWER(TRIM(TRAILING '.' FROM name)) IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
      domains += Number(row?.c || 0);
    }
    const [accounts, cdnDomains] = await Promise.all([
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('account')} WHERE visibility = 'private' AND owner_uid = ?`,
        [req.user.uid],
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('cdn_domain')}
         WHERE aid IN (SELECT id FROM ${table('cdn_account')} WHERE visibility = 'private' AND owner_uid = ?)`,
        [req.user.uid],
      ),
    ]);
    return {
      code: 0,
      data: {
        domains,
        accounts: Number(accounts?.c || 0),
        cdnDomains: Number(cdnDomains?.c || 0),
      },
    };
  });
}
