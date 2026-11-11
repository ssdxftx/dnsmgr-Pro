import { domainToASCII } from 'node:url';

// CDN 线路切换共用的域名匹配逻辑。
// 统一做小写、去尾点、IDN -> punycode，避免同一站点因写法不同被判定为不匹配。

export function normalizeHost(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  const raw = String(first ?? '')
    .trim()
    .replace(/\.+$/, '');
  if (!raw) return '';
  const ascii = domainToASCII(raw);
  return String(ascii || raw)
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
}

/**
 * 判断某个站点是否既能覆盖当前加速域名，又与当前关联 DNS 域名属于同一主域名。
 *
 * - covers：加速域名等于站点名，或是站点名的子域名
 * - sameRoot：站点名与 DNS 域名互为后缀（例如 cdn.example.com 可落到 example.com 或 cdn.example.com）
 *
 * 这样既不会把 cdn.example.com 切到 unrelated.com，也允许目标站点比 DNS 域名更具体。
 */
export function siteCoversDomain(accelDomain: unknown, siteName: unknown, dnsDomain: unknown): boolean {
  const accel = normalizeHost(accelDomain);
  const site = normalizeHost(siteName);
  const dns = normalizeHost(dnsDomain);
  if (!accel || !site || !dns) return false;
  const covers = accel === site || accel.endsWith('.' + site);
  const sameRoot = site === dns || dns.endsWith('.' + site) || site.endsWith('.' + dns);
  return covers && sameRoot;
}

export function cnameEquals(a: unknown, b: unknown): boolean {
  return normalizeHost(a) === normalizeHost(b);
}

/** DNS 记录名归一化为相对主机名（@ / www），用于比较 FQDN 与短名。 */
export function shortRecordName(recordName: unknown, dnsDomain: unknown): string {
  let name = normalizeHost(recordName);
  const base = normalizeHost(dnsDomain);
  if (!name) return '';
  if (!base) return name;
  if (name === base) return '@';
  if (name.endsWith('.' + base)) name = name.slice(0, -(base.length + 1));
  return name || '@';
}
