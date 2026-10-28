import path from 'node:path';

/**
 * 正在使用中的备份临时文件登记表。
 * 1 小时清理任务如果只按 mtime 判断，会删掉仍在写入/读取的大备份（导入、导出、恢复快照），
 * 因此长时间操作必须在开始/结束时登记，清理时跳过。
 */
const active = new Set<string>();

function norm(p: string): string {
  return path.resolve(String(p || ''));
}

export function markTempActive(p: string): void {
  if (p) active.add(norm(p));
}

export function markTempDone(p: string): void {
  if (p) active.delete(norm(p));
}

export function isTempActive(p: string): boolean {
  return active.has(norm(p));
}
