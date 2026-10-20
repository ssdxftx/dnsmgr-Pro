import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit/context.js';
import {
  autoUnlockConvenient,
  changePassphrase,
  destroyVault,
  downgradeVault,
  initVault,
  recoverVault,
  setExcludeFromSiteBackup,
  setRecovery,
  unlockVault,
  upgradeVault,
  VaultError,
  vaultStatus,
} from '../lib/vault/service.js';
import { clearVaultSession } from '../lib/vault/session.js';

function fail(reply: any, e: any) {
  if (e instanceof VaultError) return reply.code(e.status).send({ code: -1, msg: e.message });
  return reply.code(500).send({ code: -1, msg: e?.message || '操作失败' });
}

export default async function vaultRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).authenticate };
  // 保险库状态与账户列表禁止被代理缓存
  app.addHook('onSend', async (_req: any, reply: any, payload: any) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  const jtiOf = (req: any) => String(req.user?.jti || '');

  app.get('/api/vault/status', auth, async (req: any) => {
    return { code: 0, data: await vaultStatus(Number(req.user.uid), jtiOf(req)) };
  });

  app.post('/api/vault/init', auth, async (req: any, reply: any) => {
    const b = req.body || {};
    try {
      const r = await initVault(Number(req.user.uid), jtiOf(req), {
        mode: b.mode,
        passphrase: b.passphrase,
        recovery: b.recovery,
        acknowledge: b.acknowledge,
        hint: b.hint,
      });
      audit(req, {
        module: 'vault',
        action: 'vault.init',
        summary: b.mode === 'none' ? '启用保险库（便捷模式）' : '启用保险库（口令模式）',
        detail: { mode: b.mode === 'none' ? 'none' : 'passphrase', result: 'ok' },
        scrubBody: true,
      });
      return { code: 0, msg: '保险库已启用', data: r };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/vault/unlock', auth, async (req: any, reply: any) => {
    try {
      const expiresAt = await unlockVault(Number(req.user.uid), jtiOf(req), String(req.body?.passphrase || ''));
      audit(req, {
        module: 'vault',
        action: 'vault.unlock',
        summary: '解锁保险库',
        detail: { mode: 'passphrase', result: 'ok' },
        scrubBody: true,
      });
      return { code: 0, msg: '已解锁', data: { expiresAt } };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/vault/lock', auth, async (req: any) => {
    clearVaultSession(Number(req.user.uid), jtiOf(req));
    return { code: 0, msg: '已锁定' };
  });

  app.post('/api/vault/passphrase', auth, async (req: any, reply: any) => {
    try {
      await changePassphrase(
        Number(req.user.uid),
        jtiOf(req),
        String(req.body?.old_passphrase || ''),
        String(req.body?.new_passphrase || ''),
      );
      audit(req, { module: 'vault', action: 'vault.passphrase', summary: '修改保险库口令', scrubBody: true });
      return { code: 0, msg: '口令已更新' };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/vault/upgrade', auth, async (req: any, reply: any) => {
    try {
      const r = await upgradeVault(
        Number(req.user.uid),
        jtiOf(req),
        String(req.body?.passphrase || ''),
        req.body?.recovery ? String(req.body.recovery) : undefined,
      );
      audit(req, { module: 'vault', action: 'vault.upgrade', summary: '保险库升级为口令模式', scrubBody: true });
      return { code: 0, msg: '已升级为口令模式', data: r };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/vault/downgrade', auth, async (req: any, reply: any) => {
    try {
      await downgradeVault(Number(req.user.uid), jtiOf(req), String(req.body?.passphrase || ''));
      audit(req, { module: 'vault', action: 'vault.downgrade', summary: '保险库降级为便捷模式', scrubBody: true });
      return { code: 0, msg: '已切换为便捷模式' };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/vault/recover', auth, async (req: any, reply: any) => {
    try {
      await recoverVault(
        Number(req.user.uid),
        jtiOf(req),
        String(req.body?.recovery || ''),
        String(req.body?.new_passphrase || ''),
      );
      audit(req, { module: 'vault', action: 'vault.recover', summary: '用恢复码重置保险库口令', scrubBody: true });
      return { code: 0, msg: '口令已重置' };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/vault/recovery', auth, async (req: any, reply: any) => {
    try {
      const r = await setRecovery(Number(req.user.uid), jtiOf(req), String(req.body?.recovery || 'random'));
      audit(req, { module: 'vault', action: 'vault.recovery', summary: '设置保险库恢复码', scrubBody: true });
      return { code: 0, msg: '恢复码已更新', data: r };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/vault/backup-exclude', auth, async (req: any) => {
    await setExcludeFromSiteBackup(Number(req.user.uid), req.body?.exclude === true);
    return { code: 0, msg: '设置已保存' };
  });

  app.post('/api/vault/destroy', auth, async (req: any, reply: any) => {
    try {
      await destroyVault(Number(req.user.uid), String(req.body?.confirm || ''));
      audit(req, { module: 'vault', action: 'vault.destroy', summary: '销毁保险库与全部私有凭证', scrubBody: true });
      return { code: 0, msg: '保险库已销毁' };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // 登录后自动解锁便捷模式（前端也可在状态查询时触发）
  app.post('/api/vault/auto-unlock', auth, async (req: any) => {
    await autoUnlockConvenient(Number(req.user.uid), jtiOf(req));
    return { code: 0, data: await vaultStatus(Number(req.user.uid), jtiOf(req)) };
  });
}
