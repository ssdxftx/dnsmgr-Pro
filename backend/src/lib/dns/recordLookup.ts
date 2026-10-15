import type { DnsProvider, RecordInfo } from './types.js';

export async function findRecordById(provider: DnsProvider, RecordId: string): Promise<RecordInfo | false> {
  const target = String(RecordId);
  const pageSize = 100;
  // 分页查找，避免记录数超过单页上限（原为固定取前 1000 条）时合法记录被误判为不存在
  for (let page = 1; page <= 50; page++) {
    const res = await provider.getDomainRecords(page, pageSize);
    if (res === false) return false;
    const found = res.list.find((r) => String(r.RecordId) === target);
    if (found) return found;
    if (!res.list.length || res.list.length < pageSize) break;
    if (typeof res.total === 'number' && page * pageSize >= res.total) break;
  }
  return false;
}
