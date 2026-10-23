// ESA 规则表达式：可视化条件 ↔ 官方表达式字符串。
// 官方示例：(http.host eq "video.example.com")
// 本模块只处理可视化编辑器能生成的常见形态；无法解析时由调用方回退到原始表达式模式。

import { ESA_MATCH_FIELDS, type EsaMatchField } from './esaRuleMeta';

export interface EsaCondItem {
  /** 字段表达式名，如 http.host */
  field: string;
  /** 运算符，如 eq / in / starts_with */
  operator: string;
  /** 额外参数名（Header / Cookie / 查询参数） */
  name?: string;
  /** 取值列表；长度类运算符存单个数字字符串 */
  values: string[];
}

/** OR 分组：组内 AND，组间 OR */
export interface EsaOrGroup {
  items: EsaCondItem[];
}

export function newEsaCondItem(): EsaCondItem {
  return { field: 'http.host', operator: 'in', name: '', values: [] };
}

export function newEsaOrGroup(): EsaOrGroup {
  return { items: [newEsaCondItem()] };
}

function escapeValue(v: string): string {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function quote(v: string): string {
  return `"${escapeValue(v)}"`;
}

/** 字段 token：Header / Cookie / 查询参数需要带参数名 */
export function esaFieldToken(item: EsaCondItem): string {
  const meta = ESA_MATCH_FIELDS.find((f) => f.value === item.field);
  if (meta?.needName && item.name) {
    if (item.field === 'http.cookie') return `http.cookie[${quote(item.name)}]`;
    if (item.field === 'http.request.uri.args') return `http.request.uri.args[${quote(item.name)}]`;
    return `${item.field}[${quote(item.name)}]`;
  }
  return item.field;
}

/** 单个条件 → 表达式片段 */
export function buildEsaConditionItem(item: EsaCondItem): string {
  const field = esaFieldToken(item);
  const vals = (item.values || []).map((v) => String(v ?? '').trim()).filter((v) => v !== '');
  const first = vals[0] ?? '';
  switch (item.operator) {
    case 'in':
    case 'in_list':
      return vals.length ? `${field} in {${vals.map(quote).join(' ')}}` : '';
    case 'not_in':
    case 'not_in_list':
      return vals.length ? `not ${field} in {${vals.map(quote).join(' ')}}` : '';
    case 'eq':
      return first ? `${field} eq ${quote(first)}` : '';
    case 'ne':
      return first ? `${field} ne ${quote(first)}` : '';
    case 'contains':
      return first ? `${field} contains ${quote(first)}` : '';
    case 'not_contains':
      return first ? `not ${field} contains ${quote(first)}` : '';
    case 'starts_with':
      return first ? `starts_with(${field}, ${quote(first)})` : '';
    case 'not_starts_with':
      return first ? `not starts_with(${field}, ${quote(first)})` : '';
    case 'ends_with':
      return first ? `ends_with(${field}, ${quote(first)})` : '';
    case 'not_ends_with':
      return first ? `not ends_with(${field}, ${quote(first)})` : '';
    case 'matches':
      return first ? `${field} matches ${quote(first)}` : '';
    case 'not_matches':
      return first ? `not ${field} matches ${quote(first)}` : '';
    case 'len_eq':
      return first ? `len(${field}) eq ${Number(first)}` : '';
    case 'len_gt':
      return first ? `len(${field}) gt ${Number(first)}` : '';
    case 'len_lt':
      return first ? `len(${field}) lt ${Number(first)}` : '';
    default:
      return first ? `${field} eq ${quote(first)}` : '';
  }
}

/** 可视化分组 → 表达式；无有效条件返回 true（匹配全部请求） */
export function buildEsaExpression(groups: EsaOrGroup[]): string {
  const ors = (groups || [])
    .map((g) => (g.items || []).map(buildEsaConditionItem).filter(Boolean))
    .filter((items) => items.length)
    .map((items) => `(${items.join(' and ')})`);
  return ors.length ? ors.join(' or ') : 'true';
}

// ---------- 解析（尽力而为，失败返回 null） ----------
function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && input[i - 1] !== '\\') inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    else if (depth === 0 && input.slice(i, i + sep.length) === sep) {
      out.push(input.slice(start, i).trim());
      i += sep.length - 1;
      start = i + 1;
    }
  }
  out.push(input.slice(start).trim());
  return out.filter(Boolean);
}

function stripParens(s: string): string {
  let t = s.trim();
  while (t.startsWith('(') && t.endsWith(')')) {
    // 只有最外层成对时才剥离
    let depth = 0;
    let ok = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')') depth--;
      if (depth === 0 && i < t.length - 1) {
        ok = false;
        break;
      }
    }
    if (!ok) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return t;
}

function parseFieldToken(token: string): { field: string; name?: string } {
  const m = token.match(/^([A-Za-z0-9_.]+)\[(?:"([^"]*)"|'([^']*)')\]$/);
  if (m) return { field: m[1], name: m[2] ?? m[3] ?? '' };
  return { field: token };
}

function parseItem(raw: string): EsaCondItem | null {
  let s = stripParens(raw);
  if (!s) return null;
  let negate = false;
  if (s.startsWith('not ')) {
    negate = true;
    s = s.slice(4).trim();
  }

  // len(field) op n
  let m = s.match(/^len\(([^)]+)\)\s+(eq|gt|lt)\s+(-?\d+)$/);
  if (m) {
    const { field, name } = parseFieldToken(m[1].trim());
    return { field, name, operator: `len_${m[2]}`, values: [m[3]] };
  }

  // starts_with(field, "v") / ends_with(field, "v")
  m = s.match(/^(starts_with|ends_with)\((.+?),\s*"((?:[^"\\]|\\.)*)"\)$/);
  if (m) {
    const { field, name } = parseFieldToken(m[2].trim());
    const op = m[1] === 'starts_with' ? 'starts_with' : 'ends_with';
    return { field, name, operator: negate ? `not_${op}` : op, values: [unquote(`"${m[3]}"`)] };
  }

  // field in { "a" "b" }
  m = s.match(/^(.+?)\s+in\s+\{(.*)\}$/);
  if (m) {
    const { field, name } = parseFieldToken(m[1].trim());
    const vals = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => unquote(`"${x[1]}"`));
    return { field, name, operator: negate ? 'not_in' : 'in', values: vals };
  }

  // field (eq|ne|contains|matches) "v"
  m = s.match(/^(.+?)\s+(eq|ne|contains|matches)\s+"((?:[^"\\]|\\.)*)"$/);
  if (m) {
    const { field, name } = parseFieldToken(m[1].trim());
    const op = m[2];
    const operator = negate ? `not_${op}` : op;
    return { field, name, operator, values: [unquote(`"${m[3]}"`)] };
  }

  return null;
}

/** 表达式 → 可视化分组；含无法识别的片段时返回 null */
export function parseEsaExpression(expr: string): EsaOrGroup[] | null {
  const src = String(expr || '').trim();
  if (!src || src === 'true') return [];
  const ors = splitTopLevel(stripParens(src), ' or ');
  const groups: EsaOrGroup[] = [];
  for (const orPart of ors) {
    const ands = splitTopLevel(stripParens(orPart), ' and ');
    const items: EsaCondItem[] = [];
    for (const andPart of ands) {
      const item = parseItem(andPart);
      if (!item) return null;
      items.push(item);
    }
    if (items.length) groups.push({ items });
  }
  return groups.length ? groups : null;
}

/** 字段是否需要参数名（Header / Cookie / 查询参数） */
export function esaNeedName(field: EsaMatchField | undefined): boolean {
  return !!field?.needName;
}

/** 字段的值输入是否只允许单个值 */
export function esaSingleValue(operator: string): boolean {
  return !['in', 'not_in', 'in_list', 'not_in_list'].includes(operator);
}
