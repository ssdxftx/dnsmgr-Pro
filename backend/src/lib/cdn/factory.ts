import { TencentCDN } from './providers/TencentCDN.js';
import { TencentEdgeOne } from './providers/TencentEdgeOne.js';
import { AliyunCDN } from './providers/AliyunCDN.js';
import { AliyunESA } from './providers/AliyunESA.js';
import { VolcengineCDN } from './providers/VolcengineCDN.js';
import { HuaweiCDN } from './providers/HuaweiCDN.js';
import { BaiduCDN } from './providers/BaiduCDN.js';
import { QiniuCDN } from './providers/QiniuCDN.js';
import { BaiShanCDN } from './providers/BaiShanCDN.js';
import { CdnetworksCDN } from './providers/CdnetworksCDN.js';
import { KingsoftCDN } from './providers/KingsoftCDN.js';
import { WangsuCDN } from './providers/WangsuCDN.js';
import type { CdnProvider } from './types.js';

export interface CdnFieldConfig {
  name: string;
  type: 'input';
  placeholder?: string;
  required?: boolean;
}

// 接入向导能力：驱动前端分步弹窗的步骤与字段显隐
export interface CdnAddFlow {
  zone: { needed: boolean; label: string };
  serviceArea: { needed: boolean };
  origin: { protocol: boolean; ports: boolean; host: boolean; hostModes: string[] };
  cert: string[];
}

export interface CdnProviderMeta {
  name: string;
  note?: string;
  config: Record<string, CdnFieldConfig>;
  // 支持为加速域名一键配置厂商免费证书
  freecert?: boolean;
  // 支持联动证书申请：把本系统签发的证书直传到站点并启用 HTTPS
  certapply?: boolean;
  // 支持「与项目联动」：按精确子域名选择/签发证书，确认后自动部署
  certlink?: boolean;
  // 接入向导能力（在下方按厂商合并生成）
  addFlow?: CdnAddFlow;
}

export const cdnConfig: Record<string, CdnProviderMeta> = {
  tencent_cdn: {
    name: '腾讯云 CDN',
    note: '加速域名接入腾讯云 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      SecretId: { name: 'SecretId', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
    },
  },
  tencent_edgeone: {
    name: '腾讯云 EdgeOne',
    note: '接入前请先在腾讯云 EdgeOne 控制台创建站点（Zone）',
    freecert: true,
    certlink: true,
    config: {
      SecretId: { name: 'SecretId', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
    },
  },
  aliyun_cdn: {
    name: '阿里云 CDN',
    note: '加速域名接入阿里云 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      AccessKeyId: { name: 'AccessKeyId', type: 'input', required: true },
      AccessKeySecret: { name: 'AccessKeySecret', type: 'input', required: true },
    },
  },
  aliyun_esa: {
    name: '阿里云 ESA',
    note: '边缘安全加速，接入前请先在阿里云 ESA 控制台创建站点',
    certapply: true,
    config: {
      AccessKeyId: { name: 'AccessKeyId', type: 'input', required: true },
      AccessKeySecret: { name: 'AccessKeySecret', type: 'input', required: true },
    },
  },
  volcengine_cdn: {
    name: '火山引擎 CDN',
    note: '加速域名接入火山引擎 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      AccessKeyId: { name: 'AccessKeyId', type: 'input', required: true },
      SecretAccessKey: { name: 'SecretAccessKey', type: 'input', required: true },
    },
  },
  huawei_cdn: {
    name: '华为云 CDN',
    note: '加速域名接入华为云 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      AccessKeyId: { name: 'AccessKeyId', type: 'input', required: true },
      SecretAccessKey: { name: 'SecretAccessKey', type: 'input', required: true },
    },
  },
  baidu_cdn: {
    name: '百度云 CDN',
    note: '加速域名接入百度智能云 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      AccessKeyId: { name: 'AccessKeyId', type: 'input', required: true },
      SecretAccessKey: { name: 'SecretAccessKey', type: 'input', required: true },
    },
  },
  qiniu_cdn: {
    name: '七牛云 CDN',
    note: '加速域名接入七牛云 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      AccessKey: { name: 'AccessKey', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
    },
  },
  baishan_cdn: {
    name: '白山云 CDN',
    note: '加速域名接入白山云 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      Token: { name: 'Token', type: 'input', required: true },
    },
  },
  cdnetworks_cdn: {
    name: 'CDNetworks',
    note: '加速域名接入 CDNetworks，拿到 CNAME 后可联动添加解析记录',
    config: {
      AccessKey: { name: 'AccessKey', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
      ContractId: { name: 'ContractId', type: 'input' },
      ItemId: { name: 'ItemId', type: 'input' },
    },
  },
  kingsoft_cdn: {
    name: '金山云 CDN',
    note: '加速域名接入金山云 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      AccessKey: { name: 'AccessKey', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
      Region: { name: 'Region', type: 'input', placeholder: '默认 cn-beijing-6' },
    },
  },
  wangsu_cdn: {
    name: '网宿 CDN',
    note: '加速域名接入网宿（ChinaNetCenter），与 CDNetworks 同源 API',
    config: {
      AccessKey: { name: 'AccessKey', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
    },
  },
};

// 接入向导默认能力：多数非站点型厂商需要服务区域，回源三项均支持
const ADD_FLOW_DEFAULT: CdnAddFlow = {
  zone: { needed: false, label: '站点' },
  serviceArea: { needed: true },
  origin: { protocol: true, ports: true, host: true, hostModes: ['accelerate', 'origin', 'custom'] },
  cert: [],
};

// 按厂商覆盖接入向导能力（以各 provider 的 updateOrigin / createDomain 实现为准）
const ADD_FLOW_OVERRIDES: Record<string, Partial<CdnAddFlow>> = {
  tencent_edgeone: {
    zone: { needed: true, label: '站点' },
    serviceArea: { needed: false },
    cert: ['freecert', 'certlink'],
  },
  aliyun_esa: {
    zone: { needed: true, label: '站点' },
    serviceArea: { needed: false },
    origin: { protocol: false, ports: true, host: true, hostModes: ['accelerate', 'origin', 'custom'] },
    cert: ['certapply'],
  },
  qiniu_cdn: {
    origin: { protocol: false, ports: false, host: true, hostModes: ['accelerate', 'origin', 'custom'] },
  },
};

for (const [type, meta] of Object.entries(cdnConfig)) {
  const o = ADD_FLOW_OVERRIDES[type] || {};
  meta.addFlow = {
    zone: { ...ADD_FLOW_DEFAULT.zone, ...(o.zone || {}) },
    serviceArea: { ...ADD_FLOW_DEFAULT.serviceArea, ...(o.serviceArea || {}) },
    origin: { ...ADD_FLOW_DEFAULT.origin, ...(o.origin || {}) },
    cert: o.cert ?? ADD_FLOW_DEFAULT.cert,
  };
}

const providerMap: Record<string, new (config: Record<string, any>) => CdnProvider> = {
  tencent_cdn: TencentCDN,
  tencent_edgeone: TencentEdgeOne,
  aliyun_cdn: AliyunCDN,
  aliyun_esa: AliyunESA,
  volcengine_cdn: VolcengineCDN,
  huawei_cdn: HuaweiCDN,
  baidu_cdn: BaiduCDN,
  qiniu_cdn: QiniuCDN,
  baishan_cdn: BaiShanCDN,
  cdnetworks_cdn: CdnetworksCDN,
  kingsoft_cdn: KingsoftCDN,
  wangsu_cdn: WangsuCDN,
};

export function getCdnProvider(type: string, config: Record<string, any>): CdnProvider | false {
  const Ctor = providerMap[type];
  if (!Ctor) return false;
  return new Ctor(config);
}

export function getCdnConfigList() {
  return cdnConfig;
}