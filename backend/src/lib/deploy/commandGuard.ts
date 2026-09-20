// 部署任务中的自定义命令（cmd/cmd_pre）默认禁用，避免后台主机被配置项直接执行任意命令。
// 确需执行时显式设置 DNSMGR_ALLOW_DEPLOY_CMD=1。
export function commandExecAllowed(): boolean {
  return process.env.DNSMGR_ALLOW_DEPLOY_CMD === '1';
}

export function assertCommandAllowed(): void {
  if (commandExecAllowed()) return;
  throw new Error('出于安全考虑已禁用部署自定义命令（cmd）。如确需执行，请设置环境变量 DNSMGR_ALLOW_DEPLOY_CMD=1 后重启服务');
}