import { decryptText, encryptText } from '../secret.js';
import { U1_PREFIX } from '../vault/keys.js';

/** 参与备份的表，顺序即导入顺序（父表先于子表） */
export const TABLES = [
  'config',
  'user', 'user_vault', 'permission', 'domain_category',
  'account', 'domain', 'domain_alias',
  'cdn_account', 'cdn_domain', 'cdn_cache_rule',
  'cert_account', 'cert_order', 'cert_domain', 'cert_cname', 'cert_deploy', 'cert_link_log',
  'cf_rule_credential',
  'dmtask', 'dmlog', 'optimizeip', 'sctask', 'dns_check_task',
  'cdn_preheat_task', 'cdn_cache_task',
  'reg_code', 'audit_log',
  'backup_destination', 'backup_schedule',
] as const;

export type BackupTable = (typeof TABLES)[number];

/** 永不写入归档的列 */
export const EXCLUDE_COLUMNS: Record<string, string[]> = {
  config: ['sys_key'],
};

/** 不参与导出的表（可再生产物 / 运行态日志 / 备份自身记录） */
export const SKIP_TABLES = ['backup_job', 'log', 'reg_verify', 'cdn_stat_data', 'user_vault_tmp'];

export const ENC_V1_PREFIX = 'enc:v1:';

/** 归档中 Buffer 的传输形态：base64 包装，避免 JSON.stringify 变成 {type:'Buffer'} */
export interface B64Value {
  __b64: string;
}

/** enc:v1: 在归档中改为明文标记（归档本身强制加密），导入时用目标 sys_key 重新加密 */
export interface PlainEncValue {
  __encv1: string;
}

export function isB64Value(v: any): v is B64Value {
  return !!v && typeof v === 'object' && typeof v.__b64 === 'string';
}

export function isPlainEncValue(v: any): v is PlainEncValue {
  return !!v && typeof v === 'object' && typeof v.__encv1 === 'string';
}

/**
 * 导出时序列化单个列值。
 * - Buffer（VARBINARY）转 base64 标记
 * - enc:u1: 原样保留，私有凭证不能落地为明文
 * - enc:v1: 用源 sys_key 解出明文后以标记存放，导入端用目标 sys_key 重新加密
 */
export function encodeStoredValue(v: any): any {
  if (Buffer.isBuffer(v)) return { __b64: v.toString('base64') } as B64Value;
  if (v instanceof Date) return v.toISOString();
  if (typeof v !== 'string') return v;
  if (v.startsWith(U1_PREFIX)) return v;
  if (v.startsWith(ENC_V1_PREFIX)) {
    const plain = decryptText(v);
    if (plain !== null) return { __encv1: plain } as PlainEncValue;
  }
  return v;
}

/** 导入时还原列值；enc:u1: 保持原样（顺序不能反，否则私有凭证会被当成坏密文） */
export function decodeStoredValue(v: any): any {
  if (isB64Value(v)) return Buffer.from(v.__b64, 'base64');
  if (isPlainEncValue(v)) return encryptText(v.__encv1);
  return v;
}

export function encodeRow(row: Record<string, any>, columns: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const col of columns) out[col] = encodeStoredValue(row[col]);
  return out;
}
