import type { FastifyInstance } from 'fastify';
import { APP_DESCRIPTION, APP_NAME, APP_VERSION, LICENSE, REPO_URL, UPDATE_REPO } from '../lib/version.js';
import { checkUpdate } from '../lib/update/updateCheck.js';
import { checkLevel } from '../auth.js';

export default async function aboutRoutes(app: FastifyInstance) {
  // 登录用户即可查看项目信息
  const auth = { preHandler: (app as any).authenticate };

  app.get('/api/about', auth, async (req: any) => {
    const uptime = Math.floor(process.uptime());
    const data: any = {
      name: APP_NAME,
      description: APP_DESCRIPTION,
      version: APP_VERSION,
      repo: REPO_URL,
      license: LICENSE,
      updateRepo: UPDATE_REPO,
    };
    // Node 版本/平台/启动时间属于部署侦察信息，仅管理员可见
    if (checkLevel(req.user, 2)) {
      data.node = process.version;
      data.platform = `${process.platform} ${process.arch}`;
      data.uptime = uptime;
      data.startedAt = new Date(Date.now() - uptime * 1000).toISOString();
    }
    return { code: 0, data };
  });

  app.post('/api/about/check-update', auth, async (req: any) => {
    // 会触发对外请求，限管理员
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const force = String(req.body?.force ?? '') === '1' || req.body?.force === true;
    const data = await checkUpdate(force);
    return { code: 0, data, msg: data.error ? data.error : undefined };
  });
}
