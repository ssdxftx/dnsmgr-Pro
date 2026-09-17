import type { FastifyInstance } from 'fastify';
import { APP_DESCRIPTION, APP_NAME, APP_VERSION, LICENSE, REPO_URL, UPDATE_REPO } from '../lib/version.js';
import { checkUpdate } from '../lib/update/updateCheck.js';

export default async function aboutRoutes(app: FastifyInstance) {
  // 登录用户即可查看项目信息
  const auth = { preHandler: (app as any).authenticate };

  app.get('/api/about', auth, async () => {
    const uptime = Math.floor(process.uptime());
    return {
      code: 0,
      data: {
        name: APP_NAME,
        description: APP_DESCRIPTION,
        version: APP_VERSION,
        repo: REPO_URL,
        license: LICENSE,
        updateRepo: UPDATE_REPO,
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        uptime,
        startedAt: new Date(Date.now() - uptime * 1000).toISOString(),
      },
    };
  });

  app.post('/api/about/check-update', auth, async (req: any) => {
    const force = String(req.body?.force ?? '') === '1' || req.body?.force === true;
    const data = await checkUpdate(force);
    return { code: 0, data, msg: data.error ? data.error : undefined };
  });
}
