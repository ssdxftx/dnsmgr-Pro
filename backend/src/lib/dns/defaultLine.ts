const DEFAULT_LINES: Record<string, string> = {
  aliyun: 'default',
  dnspod: '0',
  huawei: 'default_view',
  west: '',
  dnsla: '',
  huoshan: 'default',
  baidu: 'default',
  jdcloud: '-1',
  bt: '0',
  qingcloud: '0',
  cloudflare: '0',
  aws: 'default',
  namesilo: 'default',
  henet: 'default',
  powerdns: 'default',
  spaceship: 'default',
  aliyunesa: '0',
  tencenteo: 'Default',
  dnsmgr: 'default',
  goedge: 'default',
};

export function defaultRecordLine(type: string): string {
  return DEFAULT_LINES[String(type || '').trim()] ?? 'default';
}
