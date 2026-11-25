import { createHmac } from 'node:crypto';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';
import { findRecordById } from '../recordLookup.js';

import { fetchWithProxy } from '../../http.js';
export class QingcloudDns implements DnsProvider {
  // getDomainRecords 会先拉全部主机再本地切片，调用方不应逐页重复请求上游
  readonly clientPaged = true;
  private access_key_id: string;
  private secret_access_key: string;
  // 注意：上游 routewize 仅提供 HTTP 端点（HTTPS 不可用），签名凭据在传输层存在被中间人窃取/重放的风险。
  // 该服务商签名仅绑定 method/date/path，若厂商后续支持 HTTPS 应立即切换。
  private baseUrl = 'http://api.routewize.com';
  private error = '';
  private domain: string;
  private domainid: string;

  constructor(config: Record<string, any>) {
    this.access_key_id = config.access_key_id || '';
    this.secret_access_key = config.secret_access_key || '';
    this.domain = config.domain || '';
    this.domainid = config.domainid || '';
  }

  getError() {
    return this.error;
  }

  private gmtDate(): string {
    const d = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p = (n: number) => String(n).padStart(2, '0');
    return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT`;
  }

  private async execute(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, params: Record<string, any> | null = null): Promise<any> {
    try {
      const date = this.gmtDate();
      let signPath = path;
      if (method === 'GET' && params && Object.keys(params).length > 0) {
        const qs = new URLSearchParams();
        for (const k of Object.keys(params).sort()) {
          const v = params[k];
          if (v !== null && v !== undefined) qs.append(k, String(v));
        }
        signPath += '?' + qs.toString();
      }
      const stringToSign = `${method}\n${date}\n${signPath}`;
      const signature = createHmac('sha256', this.secret_access_key).update(stringToSign).digest('base64');
      const headers: Record<string, string> = {
        Authorization: `QC-HMAC-SHA256 ${this.access_key_id}:${signature}`,
        Date: date,
      };
      let url = this.baseUrl + path;
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(15000) };
      if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        init.body = JSON.stringify(params ?? {});
      } else if (params && Object.keys(params).length > 0) {
        url += '?' + signPath.split('?')[1];
      }
      const res = await fetchWithProxy(url, init);
      const text = await res.text();
      let arr: any = null;
      try {
        arr = JSON.parse(text);
      } catch {
        arr = null;
      }
      if (arr && ((arr.code !== undefined && arr.code === 0) || arr.domains !== undefined) && res.status === 200) {
        return arr;
      }
      if (method === 'DELETE' && res.status === 204) {
        return arr;
      }
      if (arr?.message) {
        this.error = arr.message;
      } else if (arr?.msg) {
        this.error = arr.msg;
      } else {
        this.error = '返回数据解析失败';
      }
      return false;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList()) !== false;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const param: Record<string, any> = { offset: (PageNumber - 1) * PageSize, limit: PageSize };
    if (KeyWord) param.zone_name = KeyWord;
    const data = await this.execute('GET', '/v1/user/zones', param);
    if (!data) return false;
    const list = (data.zones || []).map((row: any) => ({
      DomainId: row.zone_name,
      Domain: String(row.zone_name || '').replace(/\.$/, ''),
      RecordCount: 0,
    }));
    return { total: data.total_count || 0, list };
  }

  private async getHostRecords(SubDomain: string): Promise<RecordListResult | false> {
    const data = await this.execute('GET', '/v1/dns/host_info/', { zone_name: this.domainid, domain_name: SubDomain });
    if (!data) return false;
    const list: any[] = [];
    for (const record of data.records || []) {
      let name = String(record.domain_name || '').slice(0, -(String(record.zone_name || '').length + 1));
      if (name === '') name = '@';
      for (const recordGroup of record.record || []) {
        for (const row of recordGroup.data || []) {
          let value = row.value;
          let mx: number | null = null;
          if (record.rd_type === 'MX') {
            const parts = String(value).split(' ');
            value = parts.length > 1 ? parts[1] : '';
            mx = parseInt(parts[0], 10);
          }
          if (record.rd_type === 'TXT') {
            value = String(value).replace(/^"|"$/g, '');
          }
          list.push({
            RecordId: record.domain_record_id + '_' + row.record_value_id,
            Domain: this.domain,
            Name: name,
            Type: record.rd_type,
            Value: value,
            Line: record.view_id,
            TTL: record.ttl,
            MX: mx,
            Status: row.status === 1 ? '1' : '0',
            Weight: recordGroup.weight > 0 ? recordGroup.weight : null,
            Remark: null,
            UpdateTime: record.create_time ?? null,
          });
        }
      }
    }
    return { total: data.total_count || 0, list };
  }

  private async getAllHosts(KeyWord: string | null): Promise<any[] | false> {
    const hosts: any[] = [];
    const pageSize = 100;
    for (let page = 1; page <= 200; page++) {
      const param: Record<string, any> = { zone_name: this.domainid, offset: (page - 1) * pageSize, limit: pageSize };
      if (KeyWord) param.search_word = KeyWord;
      const data = await this.execute('GET', '/v1/dns/host/', param);
      if (!data) return false;
      const batch = Array.isArray(data.domains) ? data.domains : [];
      hosts.push(...batch);
      const total = Number(data.total_count || 0);
      if (!batch.length) break;
      if (total > 0 ? hosts.length >= total : batch.length < pageSize) break;
    }
    return hosts;
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
  ): Promise<RecordListResult | false> {
    if (SubDomain) {
      let host = SubDomain;
      if (host === '@' || host === '') {
        host = this.domain + '.';
      } else if (!host.endsWith('.')) {
        host = host + '.' + this.domain + '.';
      }
      return this.getHostRecords(host.replace(/\.$/, ''));
    }
    // 主机汇总行没有 Type/Value/真实 RecordId，不能直接作为解析记录返回；
    // 先取全部主机，再逐个展开成可编辑的具体记录，最后在本地按页切片。
    const hosts = await this.getAllHosts(KeyWord);
    if (hosts === false) return false;
    const all: RecordInfo[] = [];
    for (const row of hosts) {
      const host = String(row.domain_name || '').replace(/\.+$/, '');
      if (!host) continue;
      const expanded = await this.getHostRecords(host);
      if (expanded === false) return false;
      all.push(...expanded.list);
    }
    const start = Math.max(0, (Number(PageNumber) - 1) * Number(PageSize));
    return { total: all.length, list: all.slice(start, start + Number(PageSize)) };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    return findRecordById(this, RecordId);
  }

  private buildValue(Type: string, Value: string, MX: number): string {
    if (Type === 'MX') return `${Number(MX)} ${Value}`;
    if (Type === 'TXT' && !Value.startsWith('"')) return `"${Value}"`;
    return Value;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, Weight: number | null = null, _Remark: string | null = null) {
    const value = this.buildValue(Type, Value, Number(MX));
    const values = value.split(',').map((val: string) => ({ value: val.trim(), status: 1 }));
    let mode = 1;
    let weight = 0;
    if ((Type === 'A' || Type === 'CNAME') && Weight && Number(Weight) > 0) {
      mode = 3;
      weight = Number(Weight);
    }
    const record = [{ weight, values }];
    const param = {
      zone_name: this.domainid,
      domain_name: Name,
      view_id: Number(Line),
      type: Type,
      ttl: Number(TTL),
      record: JSON.stringify(record),
      mode,
      auto_merge: 2,
    };
    const data = await this.execute('POST', '/v1/record/', param);
    return data && data.domain_record_id ? String(data.domain_record_id) : false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, Weight: number | null = null, _Remark: string | null = null) {
    if (!String(RecordId).includes('_')) {
      this.error = '该记录标识为主机汇总行，请先按子域名筛选后再编辑具体记录';
      return false;
    }
    const value = this.buildValue(Type, Value, Number(MX));
    const [domainRecordId, recordValueId] = String(RecordId).split('_');
    const existing = await this.execute('GET', '/v1/dr_id/' + domainRecordId);
    if (!existing) return false;
    let mode = 1;
    let weight = 0;
    if ((Type === 'A' || Type === 'CNAME') && Weight && Number(Weight) > 0) {
      mode = 3;
      weight = Number(Weight);
    }
    const record: any[] = [];
    for (const recordGroup of existing.data?.record || []) {
      const values: any[] = [];
      let flag = false;
      for (const row of recordGroup.data || []) {
        if (String(row.record_value_id) === recordValueId) {
          row.value = value;
          flag = true;
        }
        values.push({ value: row.value, status: row.status });
      }
      if (values.length > 0) {
        record.push({ weight: flag ? weight : recordGroup.weight, values });
      }
    }
    const param = {
      zone_name: this.domainid,
      domain_name: Name,
      view_id: Number(Line),
      type: Type,
      ttl: Number(TTL),
      record: JSON.stringify(record),
      mode,
    };
    return (await this.execute('POST', '/v1/dr_id/' + domainRecordId, param)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    if (!String(RecordId).includes('_')) {
      // 主机汇总行的 RecordId 是 FQDN；按它删除会清空该主机下全部记录，必须拒绝。
      this.error = '该记录标识为主机汇总行，请先按子域名筛选后再删除具体记录';
      return false;
    }
    const [domainRecordId, recordValueId] = String(RecordId).split('_');
    const existing = await this.execute('GET', '/v1/dr_id/' + domainRecordId);
    if (!existing) return false;
    const record: any[] = [];
    for (const recordGroup of existing.data?.record || []) {
      const values: any[] = [];
      for (const row of recordGroup.data || []) {
        if (String(row.record_value_id) === recordValueId) continue;
        values.push({ value: row.value, status: row.status });
      }
      if (values.length > 0) {
        record.push({ weight: recordGroup.weight, values });
      }
    }
    if (record.length === 0) {
      const param = { ids: JSON.stringify([domainRecordId]), target: 'record', action: 'delete' };
      return (await this.execute('POST', '/v1/change_record_status/', param)) !== false;
    }
    const info = existing.data;
    let name = String(info.domain_name || '').slice(0, -(String(info.zone_name || '').length + 1));
    if (name === '') name = '@';
    const param = {
      zone_name: this.domainid,
      domain_name: name,
      view_id: info.view_id,
      type: info.rd_type,
      ttl: info.ttl,
      record: JSON.stringify(record),
      mode: info.mode,
    };
    return (await this.execute('POST', '/v1/dr_id/' + domainRecordId, param)) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const recordValueId = String(RecordId).split('_')[1];
    if (!recordValueId) {
      this.error = '该记录标识为主机汇总行，请先按子域名筛选后再启停具体记录';
      return false;
    }
    const param = { ids: JSON.stringify([recordValueId]), target: 'value', action: Status === '0' ? 'stop' : 'enable' };
    return (await this.execute('POST', '/v1/change_record_status/', param)) !== false;
  }

  async getRecordLine(): Promise<Record<string, string> | false> {
    const data = await this.execute('GET', '/v1/zone/view/', { zone_name: this.domainid, type: 'GET_FULL' });
    if (!data) return false;
    const list: Record<string, string> = {};
    for (const row of data.zone_views || []) {
      const name = row.name === '*' ? '默认' : row.name;
      list[name] = String(row.id);
    }
    return list;
  }

  async addDomain(Domain: string) {
    const data = await this.execute('POST', '/v1/zone/', { zone_name: Domain });
    return data !== false;
  }
}