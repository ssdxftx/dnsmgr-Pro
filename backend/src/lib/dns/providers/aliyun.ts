import { Aliyun } from '../../clients/Aliyun.js';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class AliyunDns implements DnsProvider {
  private client: Aliyun;
  private error = '';
  private domain: string;

  constructor(private config: Record<string, any>) {
    this.client = new Aliyun(config.AccessKeyId, config.AccessKeySecret, 'alidns.aliyuncs.com', '2015-01-09');
    this.domain = config.domain || '';
  }

  getError() {
    return this.error;
  }

  private async request(param: Record<string, any>, throwOnError = false): Promise<any> {
    try {
      const data = await this.client.request({ Action: param.Action, ...param });
      return data;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList(null, 1, 20)) !== false;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const data = await this.request({ Action: 'DescribeDomains', KeyWord, PageNumber, PageSize });
    if (!data) return false;
    const list = (data.Domains?.Domain || []).map((row: any) => ({
      DomainId: row.DomainId,
      Domain: row.DomainName,
      RecordCount: row.RecordCount,
    }));
    return { total: data.TotalCount || 0, list };
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
    Line: string | null = null,
    Status: string | null = null,
    SortField: string | null = null,
    SortOrder: string | null = null,
  ): Promise<RecordListResult | false> {
    const param: Record<string, any> = { Action: 'DescribeDomainRecords', DomainName: this.domain, PageNumber, PageSize };
    if (SubDomain || Type || Line || Value) {
      param.SearchMode = 'ADVANCED';
      param.RRKeyWord = SubDomain ?? undefined;
      param.ValueKeyWord = Value ?? undefined;
      param.Type = Type ?? undefined;
      param.Line = Line ?? undefined;
    } else if (KeyWord) {
      param.KeyWord = KeyWord;
    }
    if (Status) param.Status = Status === '1' ? 'Enable' : 'Disable';
    const allowedSort: Record<string, string> = { Name: 'RR', Type: 'Type', LineName: 'Line', Value: 'Value', UpdateTime: 'UpdateDate' };
    if (SortField && allowedSort[SortField]) {
      param.OrderBy = allowedSort[SortField];
      param.Direction = String(SortOrder).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    }
    const data = await this.request(param);
    if (!data) return false;
    const list = (data.DomainRecords?.Record || []).map((row: any) => ({
      RecordId: row.RecordId,
      Domain: row.DomainName,
      Name: row.RR,
      Type: row.Type,
      Value: row.Value,
      Line: row.Line,
      TTL: row.TTL,
      MX: row.Priority ?? null,
      Status: row.Status === 'ENABLE' ? '1' : '0',
      Weight: row.Weight ?? null,
      Remark: row.Remark ?? null,
      UpdateTime: row.UpdateTimestamp ? new Date(Number(row.UpdateTimestamp)).toISOString().slice(0, 19).replace('T', ' ') : null,
    }));
    return { total: data.TotalCount || 0, list };
  }

  // 精确子域名查询：使用 DescribeSubDomainRecords，避免通用接口的模糊匹配
  async getSubDomainRecords(SubDomain: string, PageNumber = 1, PageSize = 20, Type: string | null = null, Line: string | null = null): Promise<RecordListResult | false> {
    const param: Record<string, any> = { Action: 'DescribeSubDomainRecords', SubDomain: SubDomain + '.' + this.domain, PageNumber, PageSize };
    if (Type) param.Type = Type;
    if (Line) param.Line = Line;
    const data = await this.request(param);
    if (!data) return false;
    const list = (data.DomainRecords?.Record || []).map((row: any) => ({
      RecordId: row.RecordId,
      Domain: row.DomainName,
      Name: row.RR,
      Type: row.Type,
      Value: row.Value,
      Line: row.Line,
      TTL: row.TTL,
      MX: row.Priority ?? null,
      Status: row.Status === 'ENABLE' ? '1' : '0',
      Weight: row.Weight ?? null,
      Remark: row.Remark ?? null,
      UpdateTime: row.UpdateTimestamp ? new Date(Number(row.UpdateTimestamp)).toISOString().slice(0, 19).replace('T', ' ') : null,
    }));
    return { total: data.TotalCount || 0, list };
  }

  async getDomainRecordLog(PageNumber = 1, PageSize = 20, KeyWord: string | null = null, StartDate: string | null = null, EndDate: string | null = null): Promise<RecordListResult | false> {
    const param: Record<string, any> = { Action: 'DescribeRecordLogs', DomainName: this.domain, PageNumber, PageSize };
    if (KeyWord) param.KeyWord = KeyWord;
    if (StartDate) param.StartTimestamp = Number(StartDate);
    if (EndDate) param.EndTimestamp = Number(EndDate);
    const data = await this.request(param);
    if (!data) return false;
    const list = (data.RecordLogs?.RecordLog || []).map((row: any) => ({
      RecordId: String(row.RecordId ?? ''),
      Domain: this.domain,
      Name: row.Rr ?? '',
      Type: '',
      Value: '',
      Line: '',
      TTL: 0,
      MX: null,
      Status: '',
      Weight: null,
      Remark: null,
      UpdateTime: row.OperTime ?? null,
    }));
    return { total: data.TotalCount || 0, list };
  }

  async getRecordGroups(): Promise<any[] | false> {
    const data = await this.request({ Action: 'DescribeRecordGroups', DomainName: this.domain, PageSize: 100, Lang: 'zh' });
    if (!data) return false;
    return data.RecordGroups?.RecordGroup || [];
  }

  async changeRecordGroup(RecordIdList: string[], GroupId: string): Promise<boolean> {
    const param = { Action: 'ChangeRecordGroup', DomainName: this.domain, RecordIdList: JSON.stringify(RecordIdList), GroupId };
    return (await this.request(param)) !== false;
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    const data = await this.request({ Action: 'DescribeDomainRecordInfo', RecordId });
    if (!data) return false;
    return {
      RecordId: data.RecordId,
      Domain: data.DomainName,
      Name: data.RR,
      Type: data.Type,
      Value: data.Value,
      Line: data.Line,
      TTL: data.TTL,
      MX: data.Priority ?? null,
      Status: data.Status === 'ENABLE' ? '1' : '0',
      Weight: data.Weight ?? null,
      Remark: data.Remark ?? null,
      UpdateTime: data.UpdateTimestamp ? new Date(Number(data.UpdateTimestamp)).toISOString().slice(0, 19).replace('T', ' ') : null,
    };
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = 'default', TTL = 600, MX: number | null = null, Weight: number | null = null, Remark: string | null = null) {
    const param: Record<string, any> = { Action: 'AddDomainRecord', DomainName: this.domain, RR: Name, Type, Value, Line: convertLineCode(Line), TTL: Number(TTL) };
    if (MX) param.Priority = Number(MX);
    if (Weight !== null && Weight !== undefined) param.Weight = Number(Weight);
    const data = await this.request(param);
    return data && data.RecordId ? String(data.RecordId) : false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = 'default', TTL = 600, MX: number | null = null, Weight: number | null = null, Remark: string | null = null) {
    const param: Record<string, any> = { Action: 'UpdateDomainRecord', RecordId, RR: Name, Type, Value, Line: convertLineCode(Line), TTL: Number(TTL) };
    if (MX) param.Priority = Number(MX);
    if (Weight !== null && Weight !== undefined) param.Weight = Number(Weight);
    return (await this.request(param)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.request({ Action: 'DeleteDomainRecord', RecordId })) !== false;
  }

  async updateDomainRecordRemark(RecordId: string, Remark: string | null): Promise<boolean> {
    return (await this.request({ Action: 'UpdateDomainRecordRemark', RecordId, Remark: Remark ?? '' })) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const s = Status === '1' ? 'Enable' : 'Disable';
    return (await this.request({ Action: 'SetDomainRecordStatus', RecordId, Status: s })) !== false;
  }

  async getRecordLine() {
    const data = await this.request({ Action: 'DescribeSupportLines', DomainName: this.domain });
    if (!data) return false;
    const lines: Record<string, string> = {};
    // 用 LineDisplayName（完整展示名，如「中国联通_海南」）作键，避免子线路重名，值为 LineCode
    for (const r of data.RecordLines?.RecordLine || []) lines[r.LineDisplayName || r.LineName] = r.LineCode;
    return lines;
  }

  async getMinTTL(): Promise<number | false> {
    const data = await this.request({ Action: 'DescribeDomainInfo', DomainName: this.domain, NeedDetailAttributes: 'true', Lang: 'zh' });
    if (!data) return false;
    return data.MinTtl ?? false;
  }

  // 权重配置子域名列表
  async getWeightSubDomains(PageNumber = 1, PageSize = 20, SubDomain: string | null = null): Promise<{ total: number; list: any[] } | false> {
    const param: Record<string, any> = { Action: 'DescribeDNSSLBSubDomains', DomainName: this.domain, PageNumber, PageSize };
    if (SubDomain) param.Rr = SubDomain;
    const data = await this.request(param);
    if (!data) return false;
    let i = 1;
    const list = (data.SlbSubDomains?.SlbSubDomain || []).map((v: any) => {
      const rr = String(v.SubDomain || '').slice(0, -(this.domain.length + 1));
      return { ...v, id: i++, rr };
    });
    return { total: data.TotalCount || 0, list };
  }

  // 开启/关闭权重配置
  async setWeightStatus(SubDomain: string, Open: string, Type: string | null = null, Line: string | null = null): Promise<boolean> {
    const param: Record<string, any> = { Action: 'SetDNSSLBStatus', DomainName: this.domain, SubDomain, Open: Open === '1' ? 'true' : 'false' };
    if (Type) param.Type = Type;
    if (Line) param.Line = Line;
    return (await this.request(param)) !== false;
  }

  // 修改记录权重
  async updateRecordWeight(RecordId: string, Weight: number): Promise<boolean> {
    return (await this.request({ Action: 'UpdateDNSSLBWeight', RecordId, Weight: Number(Weight) })) !== false;
  }

  async addDomain(Domain: string) {
    return (await this.request({ Action: 'AddDomain', DomainName: Domain })) !== false;
  }
}

// 线路码转换：前端展示使用可读线路别名，下发时需还原为阿里云线路码
const LINE_CODE_MAP: Record<string, string> = {
  '0': 'default',
  '10=1': 'unicom',
  '10=0': 'telecom',
  '10=3': 'mobile',
  '10=2': 'edu',
  '3=0': 'oversea',
  '10=22': 'btvn',
  '80=0': 'search',
  '7=0': 'internal',
};

function convertLineCode(line: string): string {
  return LINE_CODE_MAP[line] ?? line;
}