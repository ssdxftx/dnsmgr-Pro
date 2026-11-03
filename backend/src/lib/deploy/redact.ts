/**
 * 部署命令日志脱敏。
 * 部署命令里常内嵌口令（--password=、PFX 口令、Token 等），原文写入任务日志
 * 会让凭据长期留在数据库与界面上，这里统一做保守替换。
 */
export function redactCommand(cmd: unknown): string {
  let text = String(cmd ?? '');
  // --password=xxx / password xxx / token=xxx / pfx_pass xxx 之类的键值对
  text = text.replace(
    /((?:^|\s)(?:--?)?(?:password|passwd|pwd|pass|token|secret|apikey|api_key|access_key|secret_key|pfx_pass|passphrase)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,
    '$1***',
  );
  // URL 内嵌凭据：scheme://user:pass@host
  text = text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]+@/gi, '$1***@');
  return text;
}
