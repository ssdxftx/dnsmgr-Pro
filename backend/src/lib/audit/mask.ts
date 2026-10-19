import { SECRET_MASK, isSecretKey } from '../secret.js';
import type { AuditChange } from './types.js';

// 字段名命中即整值替换为掩码；isSecretKey 覆盖 password/token/apikey/appsecret 等，
// 这里再补验证码与一次性令牌这类短字段。
const EXTRA_SECRET = /^(code|vcode|pre_token)$/i;

const MAX_STR = 500;
const MAX_ITEMS = 20;
const MAX_DETAIL_BYTES = 4000;

export function maskValue(key: string, value: any): any {
  if (EXTRA_SECRET.test(String(key)) || isSecretKey(String(key))) {
    return value === '' || value == null ? value : SECRET_MASK;
  }
  return truncate(value, 0);
}

function truncate(v: any, depth: number): any {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    return v.length > MAX_STR ? v.slice(0, MAX_STR) + `…(共${v.length}字)` : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth >= 4) return '[深层对象已省略]';
  if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => truncate(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) out[k] = maskValue(k, val);
    return out;
  }
  return String(v);
}

/** 脱敏整个请求体；超过 4KB 时只保留顶层字段名，避免把证书 PEM 写进日志 */
export function maskBody(body: any): any {
  if (body === null || body === undefined) return null;
  const masked = truncate(body, 0);
  const size = Buffer.byteLength(JSON.stringify(masked));
  if (size <= MAX_DETAIL_BYTES) return masked;
  const keys = masked && typeof masked === 'object' ? Object.keys(masked) : [];
  return { _tooLarge: size, _keys: keys.slice(0, 50) };
}

/** 生成前后值差异（值同样脱敏），最多 20 个字段 */
export function diffFields(
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined,
  label: Record<string, string> = {},
): AuditChange[] {
  if (!before || !after) return [];
  const out: AuditChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (String(a ?? '') === String(b ?? '')) continue;
    out.push({
      field: label[k] || k,
      from: stringify(maskValue(k, a)),
      to: stringify(maskValue(k, b)),
    });
    if (out.length >= 20) break;
  }
  return out;
}

function stringify(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 300);
  return String(v).slice(0, 300);
}
