import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';
import { findRecordById } from '../recordLookup.js';
import { safeFetchDeploy } from '../../netGuard.js';

export class TechnitiumDns implements DnsProvider {
  private url: string;
  private token: string;
  private error = '';
  private domain: string;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '') + '/api';
    this.token = config.token || '';
    this.domain = config.domain || '';
  }

  getError() {
    return this.error;
  }

  /** 递归排序对象键，保证同一记录每次生成的 ID 完全一致 */
  private stableStringify(value: any): string {
    if (Array.isArray(value)) return '[' + value.map((v) => this.stableStringify(v)).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + this.stableStringify(value[k])).join(',') + '}';
    }
    return JSON.stringify(value ?? null);
  }

  /**
   * Technitium 的 records/get 不返回稳定 RecordId，旧实现用数组下标充当 ID。
   * 列表一旦发生增删（并发写入、批量删除），同一个下标会指向另一条记录，造成越权删改。
   * 这里把记录的身份（name/type/rData）编码进 ID，写操作直接按 ID 还原目标，
   * 不再依赖“当前列表的第 N 行”，列表变化时只会失败，绝不会误删其它记录。
   */
  private recordIdOf(row: any): string {
    const payload = { n: String(row?.name || ''), t: String(row?.type || ''), d: row?.rData ?? {} };
    return 'tn1_' + Buffer.from(this.stableStringify(payload), 'utf8').toString('base64url');
  }

  private parseRecordId(RecordId: string): { name: string; type: string; rData: any } | null {
    const id = String(RecordId || '');
    if (!/^tn1_[A-Za-z0-9_-]+$/.test(id)) return null;
    try {
      const raw = Buffer.from(id.slice(4), 'base64url').toString('utf8');
      const payload = JSON.parse(raw);
      if (!payload || typeof payload.n !== 'string' || typeof payload.t !== 'string') return null;
      if (!payload.d || typeof payload.d !== 'object' || Array.isArray(payload.d)) return null;
      return { name: payload.n, type: payload.t, rData: payload.d };
    } catch {
      return null;
    }
  }

  private async sendRequest(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, any> = {}): Promise<any> {
    try {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...params, token: this.token })) {
        if (v !== null && v !== undefined) body.append(k, String(v));
      }
      let url = this.url + path;
      const init: RequestInit = { method };
      if (method === 'GET' || method === 'DELETE') {
        url += '?' + body.toString();
      } else {
        init.body = body.toString();
        init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      }
      const res = await safeFetchDeploy(url, init);
      const text = await res.text();
      let arr: any;
      try {
        arr = JSON.parse(text);
      } catch {
        arr = null;
      }
      if (arr?.status === 'ok') return arr;
      if (arr?.errorMessage) this.error = arr.errorMessage;
      else this.error = 'API 请求失败';
      return false;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList()) !== false;
  }

  async getDomainList(KeyWord: string | null = null, _PageNumber = 1, _PageSize = 20): Promise<DomainListResult | false> {
    const data = await this.sendRequest('GET', '/zones/list');
    if (data?.response?.zones) {
      let list = data.response.zones.map((zone: any) => ({
        DomainId: zone.name,
        Domain: zone.name,
        RecordCount: 0,
      }));
      if (KeyWord) list = list.filter((v: any) => v.Domain.includes(KeyWord));
      return { total: list.length, list };
    }
    return false;
  }

  private toValue(type: string, rData: any): { value: string; mx: number | null } {
    let value = '';
    let mx: number | null = null;
    if (type === 'A' || type === 'AAAA') value = rData.ipAddress || '';
    else if (type === 'CNAME') value = rData.cname || '';
    else if (type === 'NS') value = rData.nameServer || '';
    else if (type === 'MX') {
      value = rData.exchange || '';
      mx = rData.preference !== undefined ? rData.preference : 1;
    } else if (type === 'TXT') value = rData.text || '';
    else if (type === 'SRV') value = `${rData.priority || 0} ${rData.weight || 0} ${rData.port || 0} ${rData.target || ''}`;
    else if (type === 'PTR') value = rData.ptrName || '';
    else if (type === 'CAA') value = `${rData.flags || 0} ${rData.tag || ''} "${rData.value || ''}"`;
    else if (type === 'ANAME') value = rData.aname || '';
    else if (type === 'DNAME') value = rData.dname || '';
    else if (type === 'APP') {
      value = `${rData.appName || ''} ${rData.classPath || ''}`;
      if (rData.recordData) value += ' ' + rData.recordData;
    }
    return { value, mx };
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
    const data = await this.sendRequest('GET', '/zones/records/get', { domain: this.domain, listZone: 'true' });
    if (data?.response?.records) {
      const records: any[] = data.response.records;
      let list: RecordInfo[] = records.map((row) => {
        const name = row.name === this.domain ? '@' : String(row.name).replace('.' + this.domain, '');
        const { value, mx } = this.toValue(row.type, row.rData);
        return {
          RecordId: this.recordIdOf(row),
          Domain: this.domain,
          Name: name,
          Type: row.type,
          Value: value,
          Line: 'default',
          TTL: row.ttl,
          MX: mx,
          Status: row.disabled ? '0' : '1',
          Weight: null,
          Remark: row.comments ?? null,
          UpdateTime: null,
        };
      });
      if (SubDomain) {
        list = list.filter((v) => v.Name.toLowerCase() === SubDomain.toLowerCase());
      } else {
        if (KeyWord) list = list.filter((v) => v.Name.includes(KeyWord) || v.Value.includes(KeyWord));
        if (Value) list = list.filter((v) => v.Value === Value);
        if (Type) list = list.filter((v) => v.Type === Type);
        if (Status) list = list.filter((v) => v.Status === Status);
      }
      return { total: list.length, list };
    }
    return false;
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    return findRecordById(this, RecordId);
  }

  private buildValueParams(Type: string, Value: string, MX = 1): Record<string, any> {
    if (Type === 'A' || Type === 'AAAA') return { ipAddress: Value };
    if (Type === 'CNAME') return { cname: Value };
    if (Type === 'NS') return { nameServer: Value };
    if (Type === 'MX') return { exchange: Value, preference: Number(MX) };
    if (Type === 'TXT') return { text: Value };
    if (Type === 'SRV') {
      const parts = Value.split(' ');
      if (parts.length === 4) return { priority: parts[0], weight: parts[1], port: parts[2], target: parts[3] };
      return {};
    }
    if (Type === 'PTR') return { ptrName: Value };
    if (Type === 'CAA') {
      const parts = Value.split(' ');
      if (parts.length === 3) return { flags: parts[0], tag: parts[1], value: parts[2].replace(/^"+|"+$/g, '') };
      return {};
    }
    if (Type === 'ANAME') return { aname: Value };
    if (Type === 'DNAME') return { dname: Value };
    if (Type === 'APP') {
      const parts = Value.split(' ', 3);
      if (parts.length >= 2) return { appName: parts[0], classPath: parts[1], recordData: (parts[2] || '').trim() };
      return { appName: Value.trim() };
    }
    return {};
  }

  private getOldValueParams(Type: string, rData: any): Record<string, any> {
    if (Type === 'A' || Type === 'AAAA') return { ipAddress: rData.ipAddress || '' };
    if (Type === 'CNAME') return { cname: rData.cname || '' };
    if (Type === 'NS') return { nameServer: rData.nameServer || '' };
    if (Type === 'MX') return { exchange: rData.exchange || '', preference: rData.preference !== undefined ? rData.preference : 1 };
    if (Type === 'TXT') return { text: rData.text || '' };
    if (Type === 'SRV') return { priority: rData.priority || 0, weight: rData.weight || 0, port: rData.port || 0, target: rData.target || '' };
    if (Type === 'PTR') return { ptrName: rData.ptrName || '' };
    if (Type === 'CAA') return { flags: rData.flags || 0, tag: rData.tag || '', value: rData.value || '' };
    if (Type === 'ANAME') return { aname: rData.aname || '' };
    if (Type === 'DNAME') return { dname: rData.dname || '' };
    if (Type === 'APP') {
      const p: Record<string, any> = { appName: rData.appName || '', classPath: rData.classPath || '' };
      if (rData.recordData) p.recordData = rData.recordData;
      return p;
    }
    return {};
  }

  private getOldRecord(RecordId: string): any | false {
    const oldRecord = this.parseRecordId(RecordId);
    if (!oldRecord) {
      this.error = '记录标识无效或已过期，请刷新页面重试';
      return false;
    }
    return oldRecord;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, _Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const domain = Name === '@' ? this.domain : Name + '.' + this.domain;
    const params: Record<string, any> = { domain, zone: this.domain, type: Type, ttl: Number(TTL) };
    if (Remark) params.comments = Remark;
    const valParams = this.buildValueParams(Type, Value, MX);
    if (Object.keys(valParams).length === 0 && Type !== 'SOA') {
      this.error = '不受支持的记录类型或参数解析失败';
      return false;
    }
    Object.assign(params, valParams);
    const data = await this.sendRequest('POST', '/zones/records/add', params);
    return data === false ? false : 'ok';
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, _Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const oldRecord = this.getOldRecord(RecordId);
    if (!oldRecord) return false;
    const domain = oldRecord.name;
    const newDomain = Name === '@' ? this.domain : Name + '.' + this.domain;
    if (oldRecord.type === 'APP') {
      let oldValue = (oldRecord.rData?.appName ?? '') + ' ' + (oldRecord.rData?.classPath ?? '');
      if (oldRecord.rData?.recordData) oldValue += ' ' + oldRecord.rData.recordData;
      if (oldValue !== Value.trimEnd() || domain !== newDomain) {
        await this.deleteDomainRecord(RecordId);
        return (await this.addDomainRecord(Name, Type, Value, _Line, TTL, MX, _Weight, Remark)) !== false;
      }
    }
    const params: Record<string, any> = { domain, zone: this.domain, type: oldRecord.type, ttl: Number(TTL) };
    if (domain !== newDomain) params.newDomain = newDomain;
    params.comments = Remark || '';
    Object.assign(params, this.getOldValueParams(oldRecord.type, oldRecord.rData));
    Object.assign(params, this.buildValueParams(Type, Value, MX));
    return (await this.sendRequest('POST', '/zones/records/update', params)) !== false;
  }

  async updateDomainRecordRemark(RecordId: string, Remark: string | null): Promise<boolean> {
    const oldRecord = this.getOldRecord(RecordId);
    if (!oldRecord) return false;
    const params: Record<string, any> = { domain: oldRecord.name, zone: this.domain, type: oldRecord.type, comments: Remark ?? '' };
    Object.assign(params, this.getOldValueParams(oldRecord.type, oldRecord.rData));
    return (await this.sendRequest('POST', '/zones/records/update', params)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    const oldRecord = this.getOldRecord(RecordId);
    if (!oldRecord) return false;
    const params: Record<string, any> = { domain: oldRecord.name, zone: this.domain, type: oldRecord.type };
    Object.assign(params, this.getOldValueParams(oldRecord.type, oldRecord.rData));
    return (await this.sendRequest('POST', '/zones/records/delete', params)) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const oldRecord = this.getOldRecord(RecordId);
    if (!oldRecord) return false;
    const params: Record<string, any> = {
      domain: oldRecord.name,
      zone: this.domain,
      type: oldRecord.type,
      disable: Status === '0' ? 'true' : 'false',
    };
    Object.assign(params, this.getOldValueParams(oldRecord.type, oldRecord.rData));
    return (await this.sendRequest('POST', '/zones/records/update', params)) !== false;
  }

  async getRecordLine() {
    return { 默认: 'default' };
  }

  async addDomain(Domain: string) {
    const result = await this.sendRequest('POST', '/zones/create', { zone: Domain, type: 'Primary' });
    return result !== false;
  }
}