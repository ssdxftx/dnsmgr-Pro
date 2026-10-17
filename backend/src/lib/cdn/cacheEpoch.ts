// CDN provider 短时缓存（见 routes/cdn.ts 的 providerCache）在账户配置变更后需立即失效，
// 否则最长 5s 内仍用旧配置构建 provider。账户增删改时自增此版本号，缓存侧检测到变化即清空。
let epoch = 0;

export function bumpCdnAccountEpoch(): void {
  epoch++;
}

export function getCdnAccountEpoch(): number {
  return epoch;
}