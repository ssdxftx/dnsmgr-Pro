export interface EsaApiParam {
  name: string;
  type: string;
  required: boolean;
  desc?: string;
  example?: string;
  format?: string;
  enum?: string[];
  properties?: EsaApiParam[];
  items?: EsaApiParam[];
  itemsType?: string;
  itemsEnum?: string[];
}

export interface EsaApiAction {
  title: string;
  summary: string;
  method: string;
  methods?: string[];
  op: string;
  deprecated: boolean;
  path: string[];
  params: EsaApiParam[];
  responseFields: { name: string; type: string; desc?: string }[];
}

export interface EsaApiCatalog {
  version: string;
  generatedAt: string;
  directories: any[];
  actions: Record<string, EsaApiAction>;
}
