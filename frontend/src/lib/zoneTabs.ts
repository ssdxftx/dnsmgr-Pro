export interface ZoneSubTabDef {
  key: string;
  labelKey?: string;
  label?: string;
  gate?: string;
}

export interface ZoneTabDef {
  key: string;
  labelKey: string;
  children?: ZoneSubTabDef[];
  defaultChild?: string;
}

export const ESA_ZONE_TABS: ZoneTabDef[] = [
  { key: 'overview', labelKey: 'esaZone.tabOverview' },
  { key: 'settings-list', labelKey: 'esaZone.tabSettingsList' },
  { key: 'versions', labelKey: 'esaZone.tabVersions' },
  {
    key: 'dns',
    labelKey: 'esaZone.tabDns',
    defaultChild: 'analytics',
    children: [
      { key: 'analytics', labelKey: 'esaZone.dnsAnalytics' },
      { key: 'saas', labelKey: 'esaZone.saasTitle' },
      { key: 'settings', labelKey: 'esaZone.dnsSettings' },
    ],
  },
  {
    key: 'ssl',
    labelKey: 'esaZone.tabSsl',
    defaultChild: 'overview',
    children: [
      { key: 'overview', labelKey: 'esaZone.sslOverview' },
      { key: 'edge', labelKey: 'esaZone.sslEdgeCerts' },
      { key: 'client', labelKey: 'esaZone.sslClientCerts' },
      { key: 'origin', labelKey: 'esaZone.sslOriginCerts' },
    ],
  },
  {
    key: 'security',
    labelKey: 'esaZone.tabSecurity',
    defaultChild: 'overview',
    children: [
      { key: 'overview', labelKey: 'esaZone.secOverview' },
      { key: 'events', labelKey: 'esaZone.secEvents' },
      { key: 'waf', labelKey: 'esaZone.secWaf' },
      { key: 'bots', labelKey: 'esaZone.secBots', gate: 'Premium' },
      { key: 'ddos', label: 'DDoS' },
      { key: 'aicrawler', labelKey: 'esaZone.secAiCrawler', gate: 'Pro' },
      { key: 'apisec', labelKey: 'esaZone.secApi', gate: 'Pro' },
      { key: 'originprotect', labelKey: 'esaZone.secOriginProtection', gate: 'Pro' },
      { key: 'accountsec', labelKey: 'esaZone.secAccountSecurity', gate: 'Enterprise' },
      { key: 'settings', labelKey: 'esaZone.secSettings' },
    ],
  },
  {
    key: 'caching',
    labelKey: 'esaZone.tabCaching',
    defaultChild: 'rules',
    children: [
      { key: 'rules', labelKey: 'esaZone.cacheRules' },
      { key: 'tags', labelKey: 'esaZone.cacheTags' },
      { key: 'devmode', labelKey: 'esaZone.cacheDevMode' },
      { key: 'tiered', labelKey: 'esaZone.cacheTiered' },
      { key: 'reserve', labelKey: 'esaZone.cacheReserve', gate: 'Enterprise' },
      { key: 'purge', labelKey: 'esaZone.cachePurge' },
      { key: 'prefetch', labelKey: 'esaZone.cachePrefetch' },
      { key: 'analytics', labelKey: 'esaZone.cacheAnalytics' },
    ],
  },
  { key: 'rules', labelKey: 'esaZone.tabRules' },
  {
    key: 'network',
    labelKey: 'esaZone.tabNetwork',
    defaultChild: 'optimization',
    children: [
      { key: 'speed', labelKey: 'esaZone.speedMonitor' },
      { key: 'optimization', labelKey: 'esaZone.optimization' },
    ],
  },
  {
    key: 'traffic',
    labelKey: 'esaZone.tabTraffic',
    defaultChild: 'pools',
    children: [
      { key: 'smart', labelKey: 'esaZone.smartRouting' },
      { key: 'waiting', labelKey: 'esaZone.waitingRoom', gate: 'Premium' },
      { key: 'pools', labelKey: 'esaZone.originPools' },
      { key: 'lb', labelKey: 'esaZone.loadBalancers', gate: 'Enterprise' },
    ],
  },
  {
    key: 'l4',
    labelKey: 'esaZone.tabL4',
    defaultChild: 'apps',
    children: [
      { key: 'apps', labelKey: 'esaZone.l4Apps' },
      { key: 'analytics', labelKey: 'esaZone.l4Analytics', gate: 'Enterprise' },
    ],
  },
  { key: 'er', labelKey: 'esaZone.tabEr' },
  { key: 'capping', labelKey: 'esaZone.tabCapping' },
  { key: 'global', labelKey: 'esaZone.tabGlobal' },
  { key: 'api', labelKey: 'esaZone.tabApi' },
];

export const EO_ZONE_TABS: ZoneTabDef[] = [
  { key: 'overview', labelKey: 'cdnZoneSetting.tabOverview' },
  { key: 'billing', labelKey: 'cdnZoneSetting.tabBilling' },
  { key: 'domains', labelKey: 'cdnZoneSetting.tabDomains' },
  { key: 'origin', labelKey: 'cdnZoneSetting.tabOrigin' },
  { key: 'rules', labelKey: 'cdnZoneSetting.tabRules' },
  { key: 'security', labelKey: 'cdnZoneSetting.tabSecurity' },
  { key: 'versions', labelKey: 'cdnZoneSetting.tabVersions' },
  { key: 'edge', labelKey: 'cdnZoneSetting.tabEdge' },
  { key: 'multipath', labelKey: 'cdnZoneSetting.tabMultiPath' },
  { key: 'inference', labelKey: 'cdnZoneSetting.tabInference' },
  { key: 'media', labelKey: 'cdnZoneSetting.tabMedia' },
  { key: 'l4', labelKey: 'cdnZoneSetting.tabL4' },
  { key: 'tasks', labelKey: 'cdnZoneSetting.tabTasks' },
  { key: 'global', labelKey: 'cdnZoneSetting.tabGlobal' },
];

export const ESA_ACCOUNT_TABS: ZoneTabDef[] = [
  { key: 'overview', labelKey: 'esaAccount.navOverview' },
  {
    key: 'edge',
    labelKey: 'esaAccount.navEdge',
    defaultChild: 'functions',
    children: [
      { key: 'functions', labelKey: 'esaAccount.edgeFunctions' },
      { key: 'kv', labelKey: 'esaAccount.kvTitle' },
      { key: 'containers', labelKey: 'esaAccount.containersTitle', gate: 'Enterprise' },
    ],
  },
  {
    key: 'captcha',
    labelKey: 'esaAccount.navCaptcha',
    defaultChild: 'config',
    children: [
      { key: 'config', labelKey: 'esaAccount.captchaConfig' },
      { key: 'analytics', labelKey: 'esaAccount.captchaAnalytics' },
    ],
  },
  {
    key: 'global',
    labelKey: 'esaAccount.navGlobal',
    defaultChild: 'lists',
    children: [
      { key: 'lists', labelKey: 'esaAccount.globalLists' },
      { key: 'waf', labelKey: 'esaAccount.globalWaf', gate: 'Enterprise' },
      { key: 'scenario', labelKey: 'esaAccount.globalScenario' },
      { key: 'pages', labelKey: 'esaAccount.globalPages' },
      { key: 'ratelimit', labelKey: 'esaAccount.globalRateLimit', gate: 'Enterprise' },
    ],
  },
  {
    key: 'tools',
    labelKey: 'esaAccount.navTools',
    defaultChild: 'ip',
    children: [
      { key: 'ip', labelKey: 'esaAccount.ipGeo' },
      { key: 'trail', labelKey: 'esaAccount.actionTrail' },
    ],
  },
  {
    key: 'billing',
    labelKey: 'esaAccount.navBilling',
    defaultChild: 'plans',
    children: [
      { key: 'plans', labelKey: 'esaAccount.billingPlans' },
      { key: 'usage', labelKey: 'esaAccount.billingUsage' },
      { key: 'packages', labelKey: 'esaAccount.billingPackages' },
    ],
  },
];
