/**
 * 把模板里的 HOST 匹配值替换为实际加速域名。
 * 官方模板导入时 HOST 已被置空，形如 `${http.request.host} in []`。
 */
const HOST_CONDITION_RE = /(lower\()?\$\{http\.request\.host\}(\))?\s+(not\s+in|in)\s+\[[^\]]*\]/g;

export function fillHostValues(node: any, domain: string): number {
  let replaced = 0;
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n.Condition === 'string') {
      n.Condition = n.Condition.replace(HOST_CONDITION_RE, (_m: string, open: string, close: string, op: string) => {
        replaced++;
        return `${open || ''}\${http.request.host}${close || ''} ${op.trim()} ['${domain}']`;
      });
    }
    for (const key of Object.keys(n)) {
      if (key === 'Condition') continue;
      const v = n[key];
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(node);
  return replaced;
}
