// 腾讯云 EdgeOne 规则语言条件表达式 解析 / 生成。
// 官方 L7Acc 规则以字符串表达匹配条件，例如：
//   ${http.request.host} in ['static.06162636.xyz']
//   lower(${http.request.file_extension}) in ['jpg', 'png']
//   ${http.request.uri.path} matches '^/img'
// 可视化编辑器将「组间 Or、组内 And」的结构与表达式互转，无法结构化的表达式原样保留。

export interface EoCondItem {
  target: string;
  operator: string;
  name?: string;
  values: string[];
  ignoreCase?: boolean;
}

export interface EoOrGroup {
  items: EoCondItem[];
}

/** 匹配类型 → 规则语言变量（{name} 为 query_string / request_header 的参数名占位） */
const TARGET_VARS: Record<string, string> = {
  host: 'http.request.host',
  url: 'http.request.uri.path',
  full_url: 'http.request.full_uri',
  query_string: "http.request.uri.args['{name}']",
  extension: 'http.request.file_extension',
  filename: 'http.request.filename',
  request_header: "http.request.headers['{name}']",
  client_country: 'http.request.ip.country',
  request_protocol: 'http.request.scheme',
  client_ip: 'http.request.ip',
  request_method: 'http.request.method',
};

/** 变量名（去掉 ${} 与 lower() 包裹）→ 匹配类型 / 参数名 */
function varToTarget(varName: string): { target: string; name?: string } | null {
  const v = varName.trim();
  if (/^http\.request\.uri\.args\['(.*)'\]$/.test(v)) {
    const m = v.match(/^http\.request\.uri\.args\['(.*)'\]$/);
    return { target: 'query_string', name: m ? m[1] : '' };
  }
  if (/^http\.request\.headers\['(.*)'\]$/.test(v)) {
    const m = v.match(/^http\.request\.headers\['(.*)'\]$/);
    return { target: 'request_header', name: m ? m[1] : '' };
  }
  for (const [target, tpl] of Object.entries(TARGET_VARS)) {
    if (tpl.includes('{name}')) continue;
    if (tpl === v) return { target };
  }
  return null;
}

function escapeValue(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function varExpr(target: string, name?: string): string {
  const tpl = TARGET_VARS[target] || 'http.request.host';
  return '${' + tpl.replace('{name}', escapeValue(name || '')) + '}';
}

/** 单条匹配条件 → 表达式片段 */
export function buildConditionItem(it: EoCondItem): string {
  const base = varExpr(it.target, it.name);
  const lhs = it.ignoreCase ? `lower(${base})` : base;
  const values = (it.values || []).map((v) => `'${escapeValue(v)}'`).join(', ');
  switch (it.operator) {
    case 'notEquals':
      return `${lhs} not in [${values}]`;
    case 'exist':
      return `exists(${base})`;
    case 'notexist':
      return `not exists(${base})`;
    case 'equal':
    default:
      return `${lhs} in [${values}]`;
  }
}

/** 分支条件（组间 Or、组内 And）→ 表达式；无有效条件返回空串（ELSE） */
export function buildCondition(groups: EoOrGroup[]): string {
  const mapped = groups
    .map((g) => g.items.filter((it) => it && it.target && it.operator).map(buildConditionItem))
    .filter((arr) => arr.length);
  if (!mapped.length) return '';
  // 仅一个条件组时直接以 and 连接，避免多余括号
  if (mapped.length === 1) return mapped[0].join(' and ');
  return mapped.map((arr) => (arr.length > 1 ? '(' + arr.join(' and ') + ')' : arr[0])).join(' or ');
}

// ---------- 解析 ----------

/** 在括号深度为 0 处按 ` <kw> ` 切分 */
function splitTop(expr: string, kw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  const token = ` ${kw} `;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0 && expr.startsWith(token, i)) {
      parts.push(cur);
      cur = '';
      i += token.length - 1;
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter((s) => s.length);
}

function stripParens(expr: string): string {
  let s = expr.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    // 仅当这对括号真正包住整体时才剥离
    let depth = 0;
    let enclosed = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0 && i < s.length - 1) {
          enclosed = false;
          break;
        }
      }
    }
    if (!enclosed) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

function parseValues(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  const out: string[] = [];
  let cur = '';
  let quote = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\\' && i + 1 < inner.length) {
      cur += inner[i + 1];
      i++;
      continue;
    }
    if (c === "'") {
      quote = !quote;
      continue;
    }
    if (c === ',' && !quote) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim() || out.length === 0) out.push(cur.trim());
  return out.map((s) => s.trim()).filter((s) => s.length);
}

/** 单条表达式片段 → 结构化匹配条件；无法识别返回 null */
function parseAtom(expr: string): EoCondItem | null {
  const s = stripParens(expr);
  // exist / not exist
  let m = s.match(/^exists\((\$\{[^}]+\})\)$/);
  if (m) {
    const t = varToTarget(m[1].slice(2, -1));
    return t ? { target: t.target, operator: 'exist', name: t.name, values: [] } : null;
  }
  m = s.match(/^not\s+exists\((\$\{[^}]+\})\)$/);
  if (m) {
    const t = varToTarget(m[1].slice(2, -1));
    return t ? { target: t.target, operator: 'notexist', name: t.name, values: [] } : null;
  }
  // lower(${var}) in [...] / ${var} in [...]
  m = s.match(/^(lower\()?(\$\{[^}]+\})(\))?\s+(not\s+in|in)\s+\[([\s\S]*)\]$/);
  if (m) {
    const ignoreCase = !!m[1];
    const t = varToTarget(m[2].slice(2, -1));
    if (!t) return null;
    return { target: t.target, operator: m[4].replace(/\s+/g, '') === 'notin' ? 'notEquals' : 'equal', name: t.name, values: parseValues('[' + m[5] + ']'), ignoreCase };
  }
  // ${var} matches '...'
  m = s.match(/^(\$\{[^}]+\})\s+matches\s+'(.*)'$/);
  if (m) {
    const t = varToTarget(m[1].slice(2, -1));
    return t ? { target: t.target, operator: 'matches', name: t.name, values: [m[2]] } : null;
  }
  return null;
}

function parseAndItems(expr: string): EoCondItem[] | null {
  const s = stripParens(expr);
  const parts = splitTop(s, 'and');
  const items: EoCondItem[] = [];
  for (const p of parts) {
    const it = parseAtom(p);
    if (!it) return null;
    items.push(it);
  }
  return items.length ? items : null;
}

/** 表达式 → 结构化 Or 组；无法完全结构化返回 null（调用方应保留原始表达式） */
export function parseCondition(expr: string): EoOrGroup[] | null {
  const s = (expr || '').trim();
  if (!s) return [];
  const orParts = splitTop(s, 'or');
  const groups: EoOrGroup[] = [];
  for (const p of orParts) {
    const items = parseAndItems(p);
    if (!items) return null;
    groups.push({ items });
  }
  return groups;
}
