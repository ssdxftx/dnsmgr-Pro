import { domainToASCII } from 'node:url';
import { Cloudflare } from '../../clients/Cloudflare.js';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class CloudflareDns implements DnsProvider {
  private client: Cloudflare;
  private error = '';
  private domain: string;

  constructor(private config: Record<string, any>) {
    const auth = config.auth !== undefined ? Number(config.auth) : /^[0-9a-f]+$/i.test(config.apikey) ? 0 : 1;
    this.client = new Cloudflare(config.email, config.apikey, auth);
    this.domain = config.domain || '';
  }

  getError() {
    return this.error;
  }

  private async send(method: Parameters<Cloudflare['request']>[0], path: string, params?: Record<string, any>, body?: Record<string, any>): Promise<any> {
    try {
      return await this.client.request(method, path, params, body);
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList(null, 1, 20)) !== false;
  }

  private domainAscii(): string {
    try {
      return domainToASCII(this.domain) || this.domain;
    } catch {
      return this.domain;
    }
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const params: Record<string, any> = { page: PageNumber, per_page: PageSize };
    if (KeyWord) params.name = KeyWord;
    const data = await this.send('GET', '/zones', params);
    if (!data) return false;
    const list = (data.result || []).map((row: any) => ({ DomainId: row.id, Domain: row.name, RecordCount: 0 }));
    return { total: data.result_info?.total_count || 0, list };
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
    Line: string | null = null,
    _Status: string | null = null,
  ): Promise<RecordListResult | false> {
    if (Value) KeyWord = Value;
    const params: Record<string, any> = { type: Type ?? undefined, search: KeyWord ?? undefined, page: PageNumber, per_page: PageSize };
    if (SubDomain) {
      const ascii = this.domainAscii();
      params.name = SubDomain === '@' ? ascii : SubDomain + '.' + ascii;
    }
    if (Line) params.proxied = Line === '1' ? 'true' : 'false';
    const data = await this.send('GET', '/zones/' + this.config.domainid + '/dns_records', params);
    if (!data) return false;
    const list = (data.result || []).map((row: any) => this.extractRow(row));
    return { total: data.result_info?.total_count || 0, list };
  }

  private extractRow(row: any): RecordInfo {
    let name = this.extractName(row.name || '');
    const status = name.endsWith('_pause') ? '0' : '1';
    if (name === '__root__') name = '@';
    if (status === '0') name = name.slice(0, -6);
    let value = row.content || '';
    if (row.type === 'SRV' && row.priority !== undefined && row.priority !== null) {
      value = row.priority + ' ' + value;
    }
    return {
      RecordId: row.id,
      Domain: this.domain,
      Name: name,
      Type: row.type,
      Value: value,
      Line: row.proxied ? '1' : '0',
      TTL: row.ttl,
      MX: row.priority ?? null,
      Status: status,
      Weight: null,
      Remark: row.comment ?? null,
      UpdateTime: row.modified_on ?? null,
    };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    const data = await this.send('GET', '/zones/' + this.config.domainid + '/dns_records/' + RecordId);
    if (!data || !data.result) return false;
    return this.extractRow(data.result);
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const ascii = this.domainAscii();
    const name = Name === '@' ? ascii : Name + '.' + ascii;
    const body: Record<string, any> = { name, type: this.convertType(Type), content: Value, proxied: Line === '1', ttl: Number(TTL), comment: Remark ?? null };
    if (Type === 'MX') body.priority = Number(MX);
    if (Type === 'CAA' || Type === 'SRV') {
      delete body.content;
      body.data = this.convertValue(Value, Type);
    }
    const data = await this.send('POST', '/zones/' + this.config.domainid + '/dns_records', undefined, body);
    return data && data.result?.id ? String(data.result.id) : false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const ascii = this.domainAscii();
    const name = Name === '@' ? ascii : Name + '.' + ascii;
    const body: Record<string, any> = { name, type: this.convertType(Type), content: Value, proxied: Line === '1', ttl: Number(TTL), comment: Remark ?? null };
    if (Type === 'MX') body.priority = Number(MX);
    if (Type === 'CAA' || Type === 'SRV') {
      delete body.content;
      body.data = this.convertValue(Value, Type);
    }
    return (await this.send('PATCH', '/zones/' + this.config.domainid + '/dns_records/' + RecordId, undefined, body)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.send('DELETE', '/zones/' + this.config.domainid + '/dns_records/' + RecordId)) !== false;
  }

  async updateDomainRecordRemark(_RecordId: string, _Remark: string | null): Promise<boolean> {
    return false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const info = await this.getDomainRecordInfo(RecordId);
    if (!info) return false;
    let name = Status === '1' ? info.Name.replace(/_pause/g, '') : info.Name + '_pause';
    if (name === '__root__') name = '@';
    else if (name === '@_pause') name = '__root___pause';
    return (await this.updateDomainRecord(RecordId, name, info.Type, info.Value, info.Line, info.TTL, info.MX ?? 1, info.Weight, info.Remark)) !== false;
  }

  async getRecordLine() {
    return { default: '0', proxied: '1' };
  }

  async addDomain(Domain: string) {
    const data = await this.send('POST', '/zones', undefined, { name: Domain });
    return data !== false;
  }

  private convertType(type: string): string {
    const dict: Record<string, string> = { REDIRECT_URL: 'URI', FORWARD_URL: 'URI' };
    return dict[type] || type;
  }

  private convertValue(value: string, type: string): Record<string, any> {
    const arr = value.split(' ');
    if (type === 'SRV') {
      if (arr.length > 3) {
        return { priority: Number(arr[0]), weight: Number(arr[1]), port: Number(arr[2]), target: arr[3] };
      }
      return { weight: Number(arr[0]), port: Number(arr[1]), target: arr[2] };
    }
    if (type === 'CAA') {
      return { flags: Number(arr[0]), tag: arr[1], value: (arr[2] || '').replace(/^"|"$/g, '') };
    }
    return {};
  }

  private extractName(fullName: string): string {
    const domainAscii = this.domainAscii();
    if (fullName === domainAscii || fullName === this.domain) return '@';
    if (fullName.endsWith('.' + domainAscii)) return fullName.slice(0, -(domainAscii.length + 1));
    if (fullName.endsWith('.' + this.domain)) return fullName.slice(0, -(this.domain.length + 1));
    return fullName;
  }
}