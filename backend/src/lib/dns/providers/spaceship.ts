import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';
import { findRecordById } from '../recordLookup.js';

import { fetchWithProxy } from '../../http.js';
export class SpaceshipDns implements DnsProvider {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = 'https://spaceship.dev/api/v1';
  private error = '';
  private domain: string;

  constructor(config: Record<string, any>) {
    this.apiKey = config.apikey || '';
    this.apiSecret = config.apisecret || '';
    this.domain = config.domain || '';
  }

  getError() {
    return this.error;
  }

  private async sendRequest(method: 'GET' | 'PUT' | 'DELETE', path: string, params: any = null): Promise<any> {
    try {
      const headers: Record<string, string> = {
        'X-API-Key': this.apiKey,
        'X-API-Secret': this.apiSecret,
      };
      let url = this.baseUrl + path;
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(15000) };
      if (method === 'GET' && params) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
          if (v !== null && v !== undefined) qs.append(k, String(v));
        }
        url += '?' + qs.toString();
      } else if (params !== null) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(params);
      }
      const res = await fetchWithProxy(url, init);
      const text = await res.text();
      let arr: any = null;
      if (text) {
        try {
          arr = JSON.parse(text);
        } catch {
          arr = null;
        }
      }
      if (res.status === 200 || res.status === 204) {
        return arr;
      }
      if (arr?.detail) {
        this.error = arr.detail;
      } else {
        this.error = 'http code: ' + res.status;
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

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 100): Promise<DomainListResult | false> {
    const data = await this.sendRequest('GET', '/domains', { take: PageSize, skip: (PageNumber - 1) * PageSize });
    if (!data) return false;
    const list = (data.items || []).map((row: any) => ({
      DomainId: row.name,
      Domain: row.name,
      RecordCount: 0,
    }));
    if (KeyWord) {
      const filtered = list.filter((row: any) => row.Domain.toLowerCase().includes(KeyWord.toLowerCase()));
      return { total: filtered.length, list: filtered };
    }
    return { total: data.total || 0, list };
  }

  private extractAddress(row: any): { address: string; mx: number } {
    const type = row.type;
    let address = '';
    let mx = 0;
    if (type === 'MX') {
      address = row.exchange;
      mx = row.preference;
    } else if (type === 'CNAME') {
      address = row.cname;
    } else if (type === 'TXT') {
      address = row.value;
    } else if (type === 'PTR') {
      address = row.pointer;
    } else if (type === 'NS') {
      address = row.nameserver;
    } else if (type === 'CAA') {
      address = `${row.flag} ${row.tag} ${row.value}`;
    } else if (type === 'SRV') {
      address = `${row.priority} ${row.weight} ${row.port} ${row.target}`;
    } else if (type === 'ALIAS') {
      address = row.aliasName;
    } else {
      address = row.address;
    }
    return { address: address ?? '', mx };
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    _KeyWord: string | null = null,
    SubDomain: string | null = null,
  ): Promise<RecordListResult | false> {
    let rawItems: any[] = [];
    let total = 0;
    if (SubDomain) {
      // 本地过滤必须翻页拉全量，固定 take=100 会在记录超过 100 条时漏记录
      let skip = 0;
      for (let page = 0; page < 200; page++) {
        const data = await this.sendRequest('GET', '/dns/records/' + this.domain, { take: 100, skip });
        if (!data) return false;
        const batch = Array.isArray(data.items) ? data.items : [];
        rawItems.push(...batch);
        total = Math.max(total, Number(data.total || 0));
        if (batch.length < 100 || (total > 0 && rawItems.length >= total)) break;
        skip += batch.length;
      }
    } else {
      const param: Record<string, any> = { take: PageSize, skip: (PageNumber - 1) * PageSize };
      const data = await this.sendRequest('GET', '/dns/records/' + this.domain, param);
      if (!data) return false;
      rawItems = Array.isArray(data.items) ? data.items : [];
      total = Number(data.total || 0);
    }
    let list: RecordInfo[] = rawItems.map((row: any) => {
      const { address, mx } = this.extractAddress(row);
      return {
        RecordId: this.encodeRecordId(row.type, row.name, address, mx),
        Domain: this.domain,
        Name: row.name,
        Type: row.type,
        Value: address,
        TTL: row.ttl,
        Line: 'default',
        MX: mx,
        Status: '1',
        Weight: null,
        Remark: null,
        UpdateTime: null,
      };
    });
    if (SubDomain) {
      list = list.filter((v) => v.Name.toLowerCase() === SubDomain.toLowerCase());
    }
    return { total: total || list.length, list };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    return findRecordById(this, RecordId);
  }

  private convertRecordItem(Name: string, Type: string, Value: string, MX: number): Record<string, any> {
    const item: Record<string, any> = { type: Type, name: Name };
    if (Type === 'MX') {
      item.exchange = Value;
      item.preference = Number(MX);
    } else if (Type === 'TXT') {
      item.value = Value;
    } else if (Type === 'CNAME') {
      item.cname = Value;
    } else if (Type === 'ALIAS') {
      item.aliasName = Value;
    } else if (Type === 'NS') {
      item.nameserver = Value;
    } else if (Type === 'PTR') {
      item.pointer = Value;
    } else if (Type === 'CAA') {
      const parts = Value.split(' ');
      if (parts.length >= 3) {
        item.flag = parseInt(parts[0], 10);
        item.tag = parts[1];
        item.value = parts.slice(2).join(' ').replace(/^"+|"+$/g, '');
      }
    } else if (Type === 'SRV') {
      const parts = Value.split(' ');
      if (parts.length >= 4) {
        item.priority = parseInt(parts[0], 10);
        item.weight = parseInt(parts[1], 10);
        item.port = parseInt(parts[2], 10);
        item.target = parts.slice(3).join(' ');
      }
    } else {
      item.address = Value;
    }
    return item;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, _Line = '0', TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    const item = this.convertRecordItem(Name, Type, Value, Number(MX));
    item.ttl = Number(TTL);
    const data = await this.sendRequest('PUT', '/dns/records/' + this.domain, { force: false, items: [item] });
    return data === false ? false : 'ok';
  }

  async updateDomainRecord(_RecordId: string, Name: string, Type: string, Value: string, _Line = '0', TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    const item = this.convertRecordItem(Name, Type, Value, Number(MX));
    item.ttl = Number(TTL);
    const data = await this.sendRequest('PUT', '/dns/records/' + this.domain, { force: true, items: [item] });
    return data !== false;
  }

  private encodeRecordId(type: string, name: string, address: string, mx: number): string {
    return Buffer.from(JSON.stringify({ type, name, address, mx }), 'utf8').toString('base64url');
  }

  private decodeRecordId(RecordId: string): { type: string; name: string; address: string; mx: number } | null {
    const raw = String(RecordId ?? '');
    if (raw.includes('|')) {
      const parts = raw.split('|');
      if (parts.length < 4) return null;
      return {
        type: parts[0],
        name: parts[1],
        address: parts.slice(2, -1).join('|'),
        mx: Number(parts[parts.length - 1]) || 0,
      };
    }
    try {
      const obj = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      if (!obj || typeof obj !== 'object' || obj.type === undefined || obj.name === undefined) return null;
      return {
        type: String(obj.type),
        name: String(obj.name ?? ''),
        address: String(obj.address ?? ''),
        mx: Number(obj.mx) || 0,
      };
    } catch {
      return null;
    }
  }

  async deleteDomainRecord(RecordId: string) {
    const old = this.decodeRecordId(RecordId);
    if (!old) {
      this.error = '记录ID无效';
      return false;
    }
    const item = this.convertRecordItem(old.name, old.type, old.address, old.mx);
    const data = await this.sendRequest('DELETE', '/dns/records/' + this.domain, [item]);
    return data !== false;
  }

  async setDomainRecordStatus(_RecordId: string, _Status: string) {
    return false;
  }

  async getRecordLine() {
    return { 默认: 'default' };
  }

  async addDomain(_Domain: string) {
    return false;
  }
}