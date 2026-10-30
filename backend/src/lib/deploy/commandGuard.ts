// 部署任务中的自定义命令（cmd/cmd_pre）默认禁用，避免后台主机被配置项直接执行任意命令。
// 确需执行时显式设置 DNSMGR_ALLOW_DEPLOY_CMD=1。
export function commandExecAllowed(): boolean {
  return process.env.DNSMGR_ALLOW_DEPLOY_CMD === '1';
}

/**
 * 命令前缀白名单（DNSMGR_DEPLOY_CMD_ALLOWLIST，逗号分隔）。
 * 打开总开关时必须配置白名单，只允许以指定前缀开头且不含 shell 控制符的单条命令。
 */
export function commandAllowlist(): string[] {
  return (process.env.DNSMGR_DEPLOY_CMD_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertCommandAllowedInner(cmd?: string): string {
  if (!commandExecAllowed()) {
    throw new Error('出于安全考虑已禁用部署自定义命令（cmd）。如确需执行，请设置环境变量 DNSMGR_ALLOW_DEPLOY_CMD=1 后重启服务');
  }
  const list = commandAllowlist();
  // 打开总开关但未配置白名单时拒绝执行，避免等同于任意命令执行。
  if (!list.length) {
    throw new Error('已开启部署自定义命令，但未配置 DNSMGR_DEPLOY_CMD_ALLOWLIST；请配置允许的命令前缀后重启服务');
  }
  const c = String(cmd || '').trim();
  if (!c) throw new Error('部署命令不能为空');
  // 白名单只允许“单条命令 + 普通参数”：出现 shell 控制符即拒绝，
  // 否则 `systemctl reload nginx; curl ...` 之类可直接绕过前缀匹配。
  if (/[;&|`$(){}<>\r\n\\]/.test(c)) {
    throw new Error('命令包含不允许的 shell 控制字符：' + c.slice(0, 120));
  }
  // 前缀必须按完整命令名匹配：允许 "p" 或 "p 参数"，禁止 "pXxx"
  if (!list.some((p) => c === p || c.startsWith(p + ' '))) {
    throw new Error('命令不在允许列表内（DNSMGR_DEPLOY_CMD_ALLOWLIST）：' + c.slice(0, 120));
  }
  return c;
}

export function assertCommandAllowed(cmd?: string): void {
  assertCommandAllowedInner(cmd);
}

/** 将已通过白名单校验的命令拆成 argv，供 execFile 使用，避免再经过 shell */
export function commandArgv(cmd?: string): string[] {
  const c = assertCommandAllowedInner(cmd);
  const argv: string[] = [];
  let current = '';
  let quote = '';
  for (const ch of c) {
    if (quote) {
      if (ch === quote) quote = '';
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        argv.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (quote) throw new Error('部署命令引号未闭合：' + c.slice(0, 120));
  if (current) argv.push(current);
  if (!argv.length) throw new Error('部署命令不能为空');
  return argv;
}
