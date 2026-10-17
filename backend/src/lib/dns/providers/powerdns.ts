import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';
import { findRecordById } from '../recordLookup.js';
import { safeFetchDeploy } from '../../netGuard.js';

interface PdnsRecord {
  id: number;
  content: string;
  disabled: boolean;
}
interface PdnsRrset {
  id: number;
  host: string;
  name: string;
  type: string;
  ttl: number;
  records: PdnsRecord[];
}

export class PowerDns implements DnsProvider {
  private baseUrl: string;
  private apikey: string;
  private error = '';
  private domain: string;
  private domainid: string;
  private serverId = 'localhost';
  private rrsetsCache: PdnsRrset[] | null = null;

  constructor(config: Record<string, any>) {
    this.baseUrl = `http://${config.ip}:${config.port}/api/v1`;
    this.apikey = config.apikey;
    this.domain = config.domain || '';
    this.domainid = config.domainid || '';
  }

  getError() {
    return this.error;
  }

  private async send(method: string, path: string, params?: any): Promise<any> {
    const headers: Record<string, string> = { 'X-API-Key': this.apikey };
    let url = this.baseUrl + path;
    let body: string | undefined;
    if (method === 'GET' || method === 'DELETE') {
      if (params) url += '?' + new URLSearchParams(params).toString();
    } else if (params) {
      body = JSON.stringify(params);
      headers['Content-Type'] = 'application/json';
    }
    try {
      const res = await safeFetchDeploy(url, { method, headers, body });
      const text = await res.text();
      let arr: any = null;
      if (text) {
        try {
          arr = JSON.parse(text);
        } catch {
          arr = null;
        }
      }
      if (res.status < 400) return arr ?? true;
      if (arr?.error) {
        this.error = arr.error;
        return false;
      }
      if (arr?.errors) {
        this.error = arr.errors.join(',');
        return false;
      }
      this.error = '请求失败';
      return false;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList(null, 1, 20)) !== false;
  }

  async getDomainList(_KeyWord: string | null = null, _PageNumber = 1, _PageSize = 20): Promise<DomainListResult | false> {
    const data = await this.send('GET', `/servers/${this.serverId}/zones`);
    if (!data) return false;
    const list = (Array.isArray(data) ? data : []).map((row: any) => ({
      DomainId: row.id,
      Domain: (row.name || '').replace(/\.$/, ''),
      RecordCount: 0,
    }));
    return { total: list.length, list };
  }

  async getDomainRecords(
    _PageNumber = 1,
    _PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
    _Line: string | null = null,
    Status: string | null = null,
  ): Promise<RecordListResult | false> {
    const data = await this.send('GET', `/servers/${this.serverId}/zones/${this.domainid}`);
    if (!data) return false;
    const rrsets: PdnsRrset[] = [];
    const list: any[] = [];
    let rrsetId = 0;
    for (const row of data.rrsets || []) {
      rrsetId++;
      const name = row.name === this.domainid ? '@' : String(row.name).replace('.' + this.domainid, '');
      const records: PdnsRecord[] = [];
      const rrset: PdnsRrset = { id: rrsetId, host: name, name: row.name, type: row.type, ttl: row.ttl, records };
      const remark = row.comments?.length ? row.comments[0].content : null;
      let recordId = 0;
      for (const record of row.records || []) {
        recordId++;
        records.push({ id: recordId, content: record.content, disabled: !!record.disabled });
        let value = record.content;
        let mx: number | null = null;
        if (row.type === 'MX') {
          const idx = value.indexOf(' ');
          if (idx >= 0) {
            mx = Number(value.slice(0, idx));
            value = value.slice(idx + 1).replace(/\.$/, '');
          }
        }
        list.push({
          RecordId: `${rrsetId}_${recordId}`,
          Domain: this.domain,
          Name: name,
          Type: row.type,
          Value: value,
          Line: 'default',
          TTL: row.ttl,
          MX: mx,
          Status: record.disabled ? '0' : '1',
          Weight: null,
          Remark: remark,
          UpdateTime: null,
        });
      }
      rrsets.push(rrset);
    }
    this.rrsetsCache = rrsets;
    let filtered = list;
    if (SubDomain) filtered = filtered.filter((v) => v.Name.toLowerCase() === SubDomain.toLowerCase());
    else {
      if (KeyWord) filtered = filtered.filter((v) => v.Name.includes(KeyWord) || v.Value.includes(KeyWord));
      if (Value) filtered = filtered.filter((v) => v.Value === Value);
      if (Type) filtered = filtered.filter((v) => v.Type === Type);
      if (Status) filtered = filtered.filter((v) => v.Status === Status);
    }
    return { total: filtered.length, list: filtered };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    return findRecordById(this, RecordId);
  }

  private normalizeValue(Type: string, Value: string, MX: number): string {
    let v = Value;
    if (Type === 'TXT' && !v.startsWith('"')) v = '"' + v + '"';
    if ((Type === 'CNAME' || Type === 'MX') && !v.endsWith('.')) v += '.';
    if (Type === 'MX') v = `${Number(MX)} ${v}`;
    return v;
  }

  // 写操作依赖 rrsetsCache 才能定位/保留同组记录。缓存仅由 getDomainRecords 填充，
  // 而写操作多为新建实例直接调用，故此处按需先拉取一次，避免：
  // 1) 新增时以 REPLACE 静默覆盖同名同类型已有记录；2) 改/删时误判「记录不存在」。
  private async ensureRrsets(): Promise<boolean> {
    if (this.rrsetsCache !== null) return true;
    const res = await this.getDomainRecords(1, 1000);
    if (res === false) {
      if (!this.error) this.error = '获取域名记录失败，请刷新页面重试';
      return false;
    }
    return true;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, _Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const value = this.normalizeValue(Type, Value, MX);
    // 未预热时先拉取同域名记录，否则 existing 恒为 undefined，REPLACE 会删除已有同名记录
    if (!(await this.ensureRrsets())) return false;
    const rrsets = this.rrsetsCache || [];
    const existing = rrsets.find((r) => r.host === Name && r.type === Type);
    let records: PdnsRecord[] = [];
    if (existing) {
      if (existing.records.some((r) => r.content === value)) {
        this.error = '已存在相同记录';
        return false;
      }
      records = [...existing.records];
    }
    records.push({ id: records.length + 1, content: value, disabled: false });
    return this.rrsetReplace(Name, Type, TTL, records, Remark);
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, _Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const value = this.normalizeValue(Type, Value, MX);
    if (!(await this.ensureRrsets())) return false;
    const rrsets = this.rrsetsCache || [];
    if (!rrsets.length) {
      this.error = '记录不存在，请刷新页面重试';
      return false;
    }
    const [rrsetIdStr, recordIdStr] = RecordId.split('_');
    const rrsetId = Number(rrsetIdStr);
    const recordId = Number(recordIdStr);
    let result = false;
    let needAdd = false;
    for (const rrset of rrsets) {
      if (rrset.id !== rrsetId) continue;
      const idx = rrset.records.findIndex((r) => r.id === recordId);
      if (idx < 0) break;
      if (rrset.records.some((r, i) => i !== idx && r.content === value)) {
        this.error = '已存在相同记录';
        return false;
      }
      if (rrset.host === Name && rrset.type === Type) {
        rrset.records[idx].content = value;
      } else {
        rrset.records.splice(idx, 1);
        needAdd = true;
      }
      if (rrset.records.length) result = await this.rrsetReplace(rrset.host, rrset.type, TTL, rrset.records, Remark);
      else result = await this.rrsetDelete(rrset.host, rrset.type);
      break;
    }
    if (needAdd && result) result = (await this.addDomainRecord(Name, Type, Value, _Line, TTL, MX, _Weight, Remark)) !== false;
    return result !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    if (!(await this.ensureRrsets())) return false;
    const rrsets = this.rrsetsCache || [];
    if (!rrsets.length) {
      this.error = '记录不存在，请刷新页面重试';
      return false;
    }
    const [rrsetIdStr, recordIdStr] = RecordId.split('_');
    const rrsetId = Number(rrsetIdStr);
    const recordId = Number(recordIdStr);
    let result = false;
    for (const rrset of rrsets) {
      if (rrset.id !== rrsetId) continue;
      const idx = rrset.records.findIndex((r) => r.id === recordId);
      if (idx < 0) break;
      rrset.records.splice(idx, 1);
      if (rrset.records.length) result = await this.rrsetReplace(rrset.host, rrset.type, rrset.ttl, rrset.records);
      else result = await this.rrsetDelete(rrset.host, rrset.type);
      break;
    }
    return result !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    if (!(await this.ensureRrsets())) return false;
    const rrsets = this.rrsetsCache || [];
    const [rrsetIdStr, recordIdStr] = RecordId.split('_');
    const rrsetId = Number(rrsetIdStr);
    const recordId = Number(recordIdStr);
    let result = false;
    for (const rrset of rrsets) {
      if (rrset.id !== rrsetId) continue;
      const rec = rrset.records.find((r) => r.id === recordId);
      if (!rec) break;
      rec.disabled = Status === '0';
      result = await this.rrsetReplace(rrset.host, rrset.type, rrset.ttl, rrset.records);
      break;
    }
    return result !== false;
  }

  async getRecordLine() {
    return { 默认: 'default' };
  }

  async addDomain(Domain: string) {
    let name = Domain;
    if (!name.endsWith('.')) name += '.';
    const result = await this.send('POST', `/servers/${this.serverId}/zones`, { name, kind: 'Native', soa_edit_api: 'INCREASE' });
    return result !== false;
  }

  private rrsetReplace(host: string, type: string, ttl: number, records: PdnsRecord[], remark: string | null = null) {
    const name = host === '@' ? this.domainid : host + '.' + this.domainid;
    const rrset: any = { name, type, ttl: Number(ttl), changetype: 'REPLACE', records, comments: [] };
    if (remark) rrset.comments = [{ account: '', content: remark }];
    return this.send('PATCH', `/servers/${this.serverId}/zones/${this.domainid}`, { rrsets: [rrset] });
  }

  private rrsetDelete(host: string, type: string) {
    const name = host === '@' ? this.domainid : host + '.' + this.domainid;
    return this.send('PATCH', `/servers/${this.serverId}/zones/${this.domainid}`, {
      rrsets: [{ name, type, changetype: 'DELETE' }],
    });
  }
}