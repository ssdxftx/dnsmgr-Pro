// 部署任务中的自定义命令（cmd/cmd_pre）默认禁用，避免后台主机被配置项直接执行任意命令。
// 确需执行时显式设置 DNSMGR_ALLOW_DEPLOY_CMD=1。
export function commandExecAllowed(): boolean {
  return process.env.DNSMGR_ALLOW_DEPLOY_CMD === '1';
}

/**
 * 可选命令前缀白名单（DNSMGR_DEPLOY_CMD_ALLOWLIST，逗号分隔）。
 * 仅打开总开关而不限制命令内容时，任何能创建部署任务的管理员都能在主机/远端执行任意 shell；
 * 配置白名单后只允许以指定前缀开头的命令。
 */
export function commandAllowlist(): string[] {
  return (process.env.DNSMGR_DEPLOY_CMD_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function assertCommandAllowed(cmd?: string): void {
  if (!commandExecAllowed()) {
    throw new Error('出于安全考虑已禁用部署自定义命令（cmd）。如确需执行，请设置环境变量 DNSMGR_ALLOW_DEPLOY_CMD=1 后重启服务');
  }
  const list = commandAllowlist();
  if (!list.length) return;
  const c = String(cmd || '').trim();
  if (!c) return;
  if (!list.some((p) => c === p || c.startsWith(p))) {
    throw new Error('命令不在允许列表内（DNSMGR_DEPLOY_CMD_ALLOWLIST）：' + c.slice(0, 120));
  }
}