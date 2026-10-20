import type { DnsProvider, RecordInfo } from './types.js';

export async function findRecordById(provider: DnsProvider, RecordId: string): Promise<RecordInfo | false> {
  const target = String(RecordId);
  const pageSize = 100;
  // 分页查找，避免记录数超过单页上限（原为固定取前 1000 条）时合法记录被误判为不存在。
  // 注意：部分厂商（如京东云）会把 pageSize 静默钳制到更小值（99），
  // 因此终止条件以「首页实际返回条数」为基准，而不是请求的 pageSize。
  let actualSize = pageSize;
  for (let page = 1; page <= 50; page++) {
    const res = await provider.getDomainRecords(page, pageSize);
    if (res === false) return false;
    const found = res.list.find((r) => String(r.RecordId) === target);
    if (found) return found;
    if (!res.list.length) break;
    if (page === 1) actualSize = res.list.length;
    if (typeof res.total === 'number' && page * actualSize >= res.total) break;
    if (res.list.length < actualSize) break;
  }
  return false;
}
