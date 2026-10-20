export interface DomainInfo {
  DomainId: string;
  Domain: string;
  RecordCount: number;
}

export interface RecordInfo {
  RecordId: string;
  Domain: string;
  Name: string;
  Type: string;
  Value: string;
  Line: string;
  TTL: number;
  MX: number | null;
  Status: string;
  Weight: number | null;
  Remark: string | null;
  UpdateTime: string | null;
}

export interface DomainListResult {
  total: number;
  list: DomainInfo[];
}

export interface RecordListResult {
  total: number;
  list: RecordInfo[];
}

export interface DnsProvider {
  getError(): string;
  check(): Promise<boolean>;
  getDomainList(KeyWord?: string | null, PageNumber?: number, PageSize?: number): Promise<DomainListResult | false>;
  getDomainRecords(
    PageNumber?: number,
    PageSize?: number,
    KeyWord?: string | null,
    SubDomain?: string | null,
    Value?: string | null,
    Type?: string | null,
    Line?: string | null,
    Status?: string | null,
    SortField?: string | null,
    SortOrder?: string | null,
  ): Promise<RecordListResult | false>;
  getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false>;
  addDomainRecord(
    Name: string,
    Type: string,
    Value: string,
    Line?: string,
    TTL?: number,
    MX?: number,
    Weight?: number | null,
    Remark?: string | null,
  ): Promise<string | false>;
  updateDomainRecord(
    RecordId: string,
    Name: string,
    Type: string,
    Value: string,
    Line?: string,
    TTL?: number,
    MX?: number,
    Weight?: number | null,
    Remark?: string | null,
  ): Promise<boolean>;
  deleteDomainRecord(RecordId: string): Promise<boolean>;
  setDomainRecordStatus(RecordId: string, Status: string): Promise<boolean>;
  updateDomainRecordRemark?(RecordId: string, Remark: string | null): Promise<boolean>;
  getRecordLine(): Promise<Record<string, string> | false>;
  addDomain(Domain: string): Promise<boolean>;

  // 以下为可选能力：迁移自原项目，供批量/导入/优选IP 等场景按需调用
  getSubDomainRecords?(SubDomain: string, PageNumber?: number, PageSize?: number, Type?: string | null, Line?: string | null): Promise<RecordListResult | false>;
  getDomainRecordLog?(PageNumber?: number, PageSize?: number, KeyWord?: string | null, StartDate?: string | null, EndDate?: string | null): Promise<RecordListResult | false>;
  getMinTTL?(): Promise<number | false>;
  getRecordGroups?(): Promise<any[] | false>;
  changeRecordGroup?(RecordIdList: string[], GroupId: string): Promise<boolean>;
  // 权重解析（阿里云）
  getWeightSubDomains?(PageNumber?: number, PageSize?: number, SubDomain?: string | null): Promise<{ total: number; list: any[] } | false>;
  setWeightStatus?(SubDomain: string, Open: string, Type?: string | null, Line?: string | null): Promise<boolean>;
  updateRecordWeight?(RecordId: string, Weight: number): Promise<boolean>;
  // 域名别名（DNSPod）
  domainAliasList?(): Promise<any[] | false>;
  addDomainAlias?(Alias: string): Promise<boolean>;
  deleteDomainAlias?(Id: string): Promise<boolean>;
}