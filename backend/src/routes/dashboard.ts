import type { FastifyInstance } from 'fastify';
import { domainNameNorm } from '../lib/domainNorm.js';
import { queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { getEffectivePermissions } from '../lib/accounts/visibility.js';

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
        queryOne<{ c: number }>(
          `SELECT COUNT(*) AS c FROM ${table('domain')} D
            LEFT JOIN ${table('account')} A ON D.aid = A.id
            WHERE (A.visibility IS NULL OR A.visibility <> 'private' OR A.owner_uid = ?)`,
          [req.user.uid],
        ),
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

    const perms = await getEffectivePermissions(req.user);
    const names = new Set<string>();
    const ids = new Set<number>();
    const aidNames: { aid: number; name: string }[] = [];
    for (const p of perms) {
      const name = domainKey(p.domain);
      if (!name) continue;
      const hasAid = p.aid !== undefined && p.aid !== null;
      const hasDomainId = p.domainId !== undefined && p.domainId !== null;
      if (!hasAid && !hasDomainId) {
        names.add(name);
        continue;
      }
      const did = Number(p.domainId);
      if (hasDomainId && Number.isInteger(did) && did > 0) ids.add(did);
      else if (hasAid) aidNames.push({ aid: Number(p.aid), name });
    }
    const conds: string[] = [];
    const params: any[] = [];
    if (names.size) {
      conds.push(`${domainNameNorm('D')} IN (${[...names].map(() => '?').join(',')})`);
      params.push(...names);
    }
    if (ids.size) {
      conds.push(`D.id IN (${[...ids].map(() => '?').join(',')})`);
      params.push(...ids);
    }
    for (const x of aidNames) {
      conds.push(`(D.aid = ? AND ${domainNameNorm('D')} = ?)`);
      params.push(x.aid, x.name);
    }
    let domains = 0;
    if (conds.length) {
      const row = await queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table('domain')} D
          LEFT JOIN ${table('account')} A ON D.aid = A.id
         WHERE (${conds.join(' OR ')})
           AND (A.visibility IS NULL OR A.visibility <> 'private' OR A.owner_uid = ?)`,
        [...params, Number(req.user.uid)],
      );
      domains = Number(row?.c || 0);
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
