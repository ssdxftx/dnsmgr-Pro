import type { DnsProvider, RecordInfo } from './types.js';

export async function findRecordById(provider: DnsProvider, RecordId: string): Promise<RecordInfo | false> {
  const res = await provider.getDomainRecords(1, 1000);
  if (res === false) return false;
  const target = String(RecordId);
  const found = res.list.find((r) => String(r.RecordId) === target);
  return found || false;
}
