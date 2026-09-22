import { domainToASCII } from 'node:url';
import { AWS } from '../../clients/AWS.js';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

const CHANGE_ROOT = 'ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/"';
const CREATE_ROOT = 'CreateHostedZoneRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/"';

// Route53 响应固定包在单一根节点（如 ListHostedZonesResponse）内，这里统一解开
function unwrap(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const keys = Object.keys(data).filter((k) => k !== '?xml');
  if (keys.length === 1 && data[keys[0]] && typeof data[keys[0]] === 'object') return data[keys[0]];
  return data;
}

function asList(value: any): any[] {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function str(v: any): string {
  return v === undefined || v === null ? '' : String(v);
}

export class AwsDns implements DnsProvider {
  private client: AWS;
  private error = '';
  private domain: string;
  private domainId: string;

  constructor(config: Record<string, any>) {
    this.client = new AWS(
      config.AccessKeyId || '',
      config.SecretAccessKey || '',
      'route53.amazonaws.com',
      'route53',
      '2013-04-01',
      'us-east-1',
    );
    this.domain = config.domain || '';
    this.domainId = str(config.domainid);
  }

  getError() {
    return this.error;
  }

  private async send(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, any> = {}, rootTag?: string): Promise<any> {
    try {
      const data = await this.client.requestXmlN(method, path, params, rootTag);
      return unwrap(data);
    } catch (e: any) {
      this.error = e?.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList()) !== false;
  }

  private async listAllHostedZones(): Promise<any[] | false> {
    const list: any[] = [];
    let marker = '';
    for (;;) {
      const params: Record<string, any> = { maxitems: '100' };
      if (marker) params.marker = marker;
      const data = await this.send('GET', '/hostedzone', params);
      if (data === false) return false;
      for (const zone of asList(data.HostedZones?.HostedZone)) list.push(zone);
      const truncated = str(data.IsTruncated) === 'true';
      marker = truncated ? str(data.NextMarker) : '';
      if (!truncated || !marker) break;
    }
    return list;
  }

  private async listAllRecordSets(): Promise<any[] | false> {
    const list: any[] = [];
    const params: Record<string, any> = { maxitems: '300' };
    for (;;) {
      const data = await this.send('GET', `/hostedzone/${this.zoneId()}/rrset`, params);
      if (data === false) return false;
      for (const set of asList(data.ResourceRecordSets?.ResourceRecordSet)) list.push(set);
      const truncated = str(data.IsTruncated) === 'true';
      if (!truncated) break;
      params.name = str(data.NextRecordName);
      params.type = str(data.NextRecordType);
      if (data.NextRecordIdentifier) params.identifier = str(data.NextRecordIdentifier);
      else delete params.identifier;
    }
    return list;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const zones = await this.listAllHostedZones();
    if (zones === false) return false;
    let list: DomainListResult['list'] = [];
    for (const row of zones) {
      const name = str(row.Name).replace(/\.+$/, '');
      if (KeyWord && name.toLowerCase().indexOf(String(KeyWord).toLowerCase()) === -1) continue;
      list.push({
        DomainId: this.normalizeZoneId(str(row.Id)),
        Domain: name,
        RecordCount: parseInt(str(row.ResourceRecordSetCount)) || 0,
      });
    }
    const total = list.length;
    const start = (Number(PageNumber) - 1) * Number(PageSize);
    list = list.slice(start, start + Number(PageSize));
    return { total, list };
  }

  async getDomainRecords(
    _PageNumber = 1,
    _PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
    _Line: string | null = null,
    _Status: string | null = null,
  ): Promise<RecordListResult | false> {
    const sets = await this.listAllRecordSets();
    if (sets === false) return false;
    let list: RecordListResult['list'] = [];
    for (const row of sets) {
      if (row.AliasTarget || row.SetIdentifier) continue;
      const type = str(row.Type);
      if (type === 'SOA') continue;
      const name = this.fromFqdn(str(row.Name));
      const ttl = parseInt(str(row.TTL)) || 300;
      for (const record of asList(row.ResourceRecords?.ResourceRecord)) {
        const raw = str(record.Value);
        const parsed = this.parseValue(type, raw);
        list.push({
          RecordId: this.encodeRecordId(name, type, raw),
          Domain: this.domain,
          Name: name,
          Type: type,
          Value: parsed.value,
          Line: 'default',
          TTL: ttl,
          MX: parsed.mx,
          Status: '1',
          Weight: null,
          Remark: null,
          UpdateTime: null,
        });
      }
    }
    if (SubDomain) {
      list = list.filter((v) => v.Name.toLowerCase() === String(SubDomain).toLowerCase());
    } else {
      if (KeyWord) {
        const kw = String(KeyWord).toLowerCase();
        list = list.filter((v) => v.Name.toLowerCase().includes(kw) || str(v.Value).toLowerCase().includes(kw));
      }
      if (Value) list = list.filter((v) => str(v.Value) === String(Value));
      if (Type) list = list.filter((v) => v.Type === String(Type));
    }
    return { total: list.length, list };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    const old = this.decodeRecordId(RecordId);
    if (!old) return false;
    const parsed = this.parseValue(old.Type, old.Value);
    return {
      RecordId,
      Domain: this.domain,
      Name: old.Name,
      Type: old.Type,
      Value: parsed.value,
      Line: 'default',
      TTL: 300,
      MX: parsed.mx,
      Status: '1',
      Weight: null,
      Remark: null,
      UpdateTime: null,
    };
  }

  async addDomainRecord(Name: string, Type: string, Value: string, _Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null): Promise<string | false> {
    const type = this.convertType(Type);
    const fqdn = this.toFqdn(Name);
    const raw = this.formatValue(type, Value, MX);
    const set = await this.getRecordSet(fqdn, type);
    if (set === false) return false;
    const values = set ? this.extractValues(set) : [];
    if (values.includes(raw)) {
      this.error = '已存在相同记录';
      return false;
    }
    values.push(raw);
    const ttl = TTL ? Number(TTL) : (set ? parseInt(str(set.TTL)) || 300 : 600);
    if (!(await this.changeRecordSets([{ Action: 'UPSERT', Name: fqdn, Type: type, TTL: ttl, Values: values }]))) return false;
    return this.encodeRecordId(this.fromFqdn(fqdn), type, raw);
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = 'default', TTL = 600, MX = 1, Weight: number | null = null, Remark: string | null = null): Promise<boolean> {
    const old = this.decodeRecordId(RecordId);
    if (!old) {
      this.error = '记录ID无效';
      return false;
    }
    const type = this.convertType(Type);
    const fqdn = this.toFqdn(Name);
    const newRaw = this.formatValue(type, Value, MX);
    const oldFqdn = this.toFqdn(old.Name);
    const oldType = old.Type;
    const oldRaw = old.Value;

    if (oldFqdn.toLowerCase() === fqdn.toLowerCase() && oldType.toUpperCase() === type.toUpperCase()) {
      const set = await this.getRecordSet(fqdn, type);
      if (set === false) return false;
      const values = set ? this.extractValues(set) : [];
      let replaced = false;
      for (let i = 0; i < values.length; i++) {
        if (values[i] === oldRaw) {
          values[i] = newRaw;
          replaced = true;
          break;
        }
      }
      if (!replaced) values.push(newRaw);
      const unique = [...new Set(values)];
      return (await this.changeRecordSets([{ Action: 'UPSERT', Name: fqdn, Type: type, TTL: Number(TTL), Values: unique }])) !== false;
    }

    if (!(await this.deleteDomainRecord(RecordId))) return false;
    return (await this.addDomainRecord(Name, Type, Value, Line, TTL, MX, Weight, Remark)) !== false;
  }

  async updateDomainRecordRemark(_RecordId: string, _Remark: string | null): Promise<boolean> {
    return false;
  }

  async deleteDomainRecord(RecordId: string): Promise<boolean> {
    const old = this.decodeRecordId(RecordId);
    if (!old) {
      this.error = '记录ID无效';
      return false;
    }
    const fqdn = this.toFqdn(old.Name);
    const type = old.Type;
    const set = await this.getRecordSet(fqdn, type);
    if (set === false) return false;
    if (!set) {
      this.error = '记录不存在';
      return false;
    }
    const values = this.extractValues(set);
    const remaining = values.filter((item) => item !== old.Value);
    if (remaining.length === values.length) {
      this.error = '记录不存在';
      return false;
    }
    const ttl = parseInt(str(set.TTL)) || 300;
    if (!remaining.length) {
      return (await this.changeRecordSets([{ Action: 'DELETE', Name: fqdn, Type: type, TTL: ttl, Values: values }])) !== false;
    }
    return (await this.changeRecordSets([{ Action: 'UPSERT', Name: fqdn, Type: type, TTL: ttl, Values: remaining }])) !== false;
  }

  async setDomainRecordStatus(_RecordId: string, _Status: string): Promise<boolean> {
    this.error = 'AWS Route53 不支持暂停/启用解析记录';
    return false;
  }

  async getRecordLine(): Promise<Record<string, string> | false> {
    return { 默认: 'default' };
  }

  async addDomain(Domain: string): Promise<boolean> {
    return (
      (await this.send('POST', '/hostedzone', {
        Name: Domain,
        CallerReference: 'dnsmgr-' + Domain + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2),
      }, CREATE_ROOT)) !== false
    );
  }

  private async getRecordSet(fqdn: string, type: string): Promise<any | false | null> {
    const data = await this.send('GET', `/hostedzone/${this.zoneId()}/rrset`, { name: fqdn, type, maxitems: '1' });
    if (data === false) return false;
    const sets = asList(data.ResourceRecordSets?.ResourceRecordSet);
    if (!sets.length) return null;
    const set = sets[0];
    if (str(set.Name).replace(/\.+$/, '').toLowerCase() !== fqdn.replace(/\.+$/, '').toLowerCase()) return null;
    if (str(set.Type).toUpperCase() !== type.toUpperCase()) return null;
    if (set.AliasTarget || set.SetIdentifier) return null;
    return set;
  }

  private async changeRecordSets(changes: Array<{ Action: string; Name: string; Type: string; TTL: number; Values: string[] }>): Promise<boolean> {
    const Change = changes.map((change) => ({
      Action: change.Action,
      ResourceRecordSet: {
        Name: change.Name,
        Type: change.Type,
        TTL: change.TTL,
        ResourceRecords: { ResourceRecord: change.Values.map((value) => ({ Value: value })) },
      },
    }));
    return (await this.send('POST', `/hostedzone/${this.zoneId()}/rrset`, { ChangeBatch: { Changes: { Change } } }, CHANGE_ROOT)) !== false;
  }

  private extractValues(set: any): string[] {
    const values: string[] = [];
    for (const record of asList(set.ResourceRecords?.ResourceRecord)) {
      if (record.Value !== undefined) values.push(str(record.Value));
    }
    return values;
  }

  private convertType(type: string): string {
    return type === 'SPF' ? 'TXT' : type;
  }

  private formatValue(type: string, value: string, mx = 1): string {
    if (type === 'TXT') {
      if (value === '' || value[0] !== '"') return '"' + value + '"';
      return value;
    }
    if (type === 'MX') return Number(mx) + ' ' + value.replace(/\.+$/, '') + '.';
    if (['CNAME', 'NS', 'PTR'].includes(type)) return value.replace(/\.+$/, '') + '.';
    if (type === 'SRV') {
      const parts = value.trim().split(/\s+/);
      if (parts.length >= 4) {
        parts[3] = parts[3].replace(/\.+$/, '') + '.';
        return parts.join(' ');
      }
    }
    return value;
  }

  private parseValue(type: string, raw: string): { value: string; mx: number | null } {
    if (type === 'TXT') {
      const m = raw.match(/^"(.*)"$/s);
      if (m && !m[1].includes('" "')) return { value: m[1].replace(/\\"/g, '"'), mx: null };
      return { value: raw, mx: null };
    }
    if (type === 'MX') {
      const parts = raw.split(' ');
      return { value: parts[1] ? parts[1].replace(/\.+$/, '') : '', mx: parseInt(parts[0]) || 0 };
    }
    if (['CNAME', 'NS', 'PTR'].includes(type)) return { value: raw.replace(/\.+$/, ''), mx: null };
    if (type === 'SRV') {
      const parts = raw.trim().split(/\s+/);
      if (parts.length >= 4) {
        parts[3] = parts[3].replace(/\.+$/, '');
        return { value: parts.join(' '), mx: null };
      }
    }
    return { value: raw, mx: null };
  }

  private toFqdn(name: string): string {
    const domain = this.domainAscii();
    if (name === '@' || name === '') return domain + '.';
    if (name.endsWith('.')) return name;
    return name + '.' + domain + '.';
  }

  private fromFqdn(fqdn: string): string {
    const value = fqdn.replace(/\.+$/, '');
    const domain = this.domainAscii();
    if (value.toLowerCase() === domain.toLowerCase() || value.toLowerCase() === this.domain.replace(/\.+$/, '').toLowerCase()) return '@';
    let suffix = '.' + domain;
    if (value.length > suffix.length && value.toLowerCase().endsWith(suffix.toLowerCase())) {
      return value.slice(0, -suffix.length);
    }
    suffix = '.' + this.domain.replace(/\.+$/, '');
    if (value.length > suffix.length && value.toLowerCase().endsWith(suffix.toLowerCase())) {
      return value.slice(0, -suffix.length);
    }
    return value;
  }

  private domainAscii(): string {
    const domain = this.domain.replace(/\.+$/, '');
    return domainToASCII(domain) || domain;
  }

  private encodeRecordId(name: string, type: string, value: string): string {
    return Buffer.from(`${name}\x1e${type}\x1e${value}`, 'utf8').toString('base64url');
  }

  private decodeRecordId(recordId: string): { Name: string; Type: string; Value: string } | null {
    try {
      const decoded = Buffer.from(String(recordId), 'base64url').toString('utf8');
      const parts = decoded.split('\x1e');
      if (parts.length !== 3) return null;
      return { Name: parts[0], Type: parts[1], Value: parts[2] };
    } catch {
      return null;
    }
  }

  private zoneId(): string {
    return this.normalizeZoneId(this.domainId);
  }

  private normalizeZoneId(id: string): string {
    return str(id).replace('/hostedzone/', '');
  }
}