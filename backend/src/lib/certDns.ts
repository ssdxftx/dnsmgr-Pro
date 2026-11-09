import { isIP } from 'node:net';
import { query, queryOne, table } from '../db.js';
import { getDnsProvider } from './dns/factory.js';
import { getDnsRecords, queryDnsDoh } from './dnsQuery.js';
import type { DnsRecord } from './cert/types.js';

const lineDef: Record<string, string> = {
  aliyun: 'default', dnspod: '0', huawei: 'default_view', west: '', dnsla: '',
  huoshan: 'default', baidu: 'default', jdcloud: '-1', bt: '0', qingcloud: '0',
  cloudflare: '0', namesilo: 'default', henet: 'default', powerdns: 'default',
  spaceship: 'default', aliyunesa: '0', tencenteo: 'Default', dnsmgr: 'default', goedge: 'default', aws: 'default',
};

import { loadAccountConfig } from './accounts/taskConfig.js';

// 私有账户配置存于保险库（U1 密文），必须通过 loadAccountConfig 解包；
// 只调用 decryptConfig 会得到空对象，导致证书 DNS 验证用空凭据调用厂商。
async function accountConfig(drow: any): Promise<Record<string, any>> {
  return loadAccountConfig({ config: drow.config, owner_uid: drow.owner_uid });
}

// 归一化记录名（小写、去首尾空白与结尾点），用于精确比对，避免上游模糊匹配误伤同名相似记录
function normName(s: any): string {
  return String(s ?? '').trim().toLowerCase().replace(/\.$/, '');
}

type DnsList = Record<string, DnsRecord[]>;

function getHuaweiDnsRecords(list: DnsRecord[]): DnsRecord[] {
  const txtRecords: Record<string, string[]> = {};
  const rest: DnsRecord[] = [];
  for (const row of list) {
    if (row.type === 'TXT') {
      if (!txtRecords[row.name]) txtRecords[row.name] = [];
      txtRecords[row.name].push(row.value);
    } else {
      rest.push(row);
    }
  }
  for (const [name, rows] of Object.entries(txtRecords)) {
    rest.push({ name, type: 'TXT', value: '"' + rows.join('","') + '"' });
  }
  return rest;
}

/**
 * 按域名名解析 DNS 账户。项目允许不同云账户接入同名域名，因此不能随便取第一行：
 * 先精确匹配；有多个时用证书账户的归属用户收口；仍无法唯一确定时直接报错，
 * 宁可签发失败也不能把 ACME TXT 写进其他租户的 Zone。
 */
async function findDnsDomain(mainDomain: string, ownerUid = 0): Promise<any> {
  const select = `SELECT A.*, B.type, B.config, B.owner_uid, B.visibility FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id`;
  let rows: any[] = await query(`${select} WHERE A.name = ? ORDER BY A.id ASC`, [mainDomain]);
  if (!rows.length && /^xn--/i.test(mainDomain)) {
    // 国际化域名大小写/编码差异：只在结果唯一时采用
    rows = await query(`${select} WHERE LOWER(A.name) = LOWER(?) ORDER BY A.id ASC`, [mainDomain]);
  }
  if (rows.length <= 1) {
    const only = rows[0];
    if (!only) return null;
    // 唯一行也必须校验账户归属：否则管理员/证书任务可以按域名名命中
    // 其他用户私有账户中的同名 Zone，写入或清理 ACME TXT。
    if (String(only.visibility || '') === 'private' && Number(only.owner_uid) !== Number(ownerUid)) {
      throw new Error('域名' + mainDomain + '属于其他用户的私有云账户，无权操作');
    }
    return only;
  }
  if (ownerUid > 0) {
    const mine = rows.filter((r) => Number(r.owner_uid) === ownerUid && String(r.visibility || '') !== 'shared');
    if (mine.length === 1) return mine[0];
    const shared = rows.filter((r) => String(r.visibility || '') === 'shared');
    if (shared.length === 1) return shared[0];
  }
  throw new Error('域名' + mainDomain + '在多个云账户中存在同名记录，无法确定使用哪个 DNS 账户');
}

export async function addDns(dnsList: DnsList, log: (txt: string) => void, cname = false, ownerUid = 0): Promise<void> {
  const cnameDomainList: DnsList = {};
  for (const [mainDomain, list] of Object.entries(dnsList)) {
    const drow = await findDnsDomain(mainDomain, ownerUid);
    if (!drow) {
      if (cname) {
        for (let i = list.length - 1; i >= 0; i--) {
          const row = list[i];
          const domain = row.name === '_acme-challenge' ? mainDomain : row.name.replace('_acme-challenge.', '') + '.' + mainDomain;
          const cnameRow = await queryOne(
            `SELECT A.*, B.name AS cnamedomain FROM ${table('cert_cname')} A JOIN ${table('domain')} B ON A.did = B.id WHERE A.domain = ?`,
            [domain],
          );
          if (cnameRow) {
            row.name = cnameRow.rr;
            if (!cnameDomainList[cnameRow.cnamedomain]) cnameDomainList[cnameRow.cnamedomain] = [];
            cnameDomainList[cnameRow.cnamedomain].push(row);
            list.splice(i, 1);
          } else {
            throw new Error('域名' + domain + '未在本系统添加');
          }
        }
      } else {
        throw new Error('域名' + mainDomain + '未在本系统添加');
      }
    }
    if (!drow) continue;
    if (!list.length) continue;

    const provider = getDnsProvider(drow.type, await accountConfig(drow), drow.name, drow.thirdid);
    if (!provider) throw new Error('DNS模块不存在');

    let records = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (drow.type === 'huawei') records = getHuaweiDnsRecords(records);

    const cache: Record<string, any> = {};
    for (const row of records) {
      const domain = row.name + '.' + mainDomain;
      if (!cache[row.name]) {
        cache[row.name] = await provider.getDomainRecords(1, 100, null, row.name, null, null, null);
      }
      if (!cache[row.name]) throw new Error('获取' + domain + '记录列表失败，' + provider.getError());

      const list2 = cache[row.name].list;
      const matched = list2.filter((v: any) => {
        if (normName(v.Name) !== normName(row.name)) return false;
        const val = Array.isArray(v.Value) ? v.Value.join(',') : v.Value;
        return v.Type === row.type && (val === row.value || String(val).replace(/\.$/, '') === row.value);
      });
      if (matched.length) {
        cache[row.name].list = list2.filter((v: any) => !matched.includes(v));
        continue;
      }

      // 不再删除「同名同类型的其他记录」：那会删掉用户自建 TXT 以及其他并发订单/续签
      // 刚写入的 _acme-challenge 值，导致两边都验证失败。CA 允许多条同名 TXT，
      // 过期值由 delDns 在验证结束后按精确值清理。若厂商拒绝重复记录，会在下面报错。
      const ttl = drow.type === 'namesilo' ? 3600 : 600;
      const line = lineDef[drow.type] ?? 'default';
      const res = await provider.addDomainRecord(row.name, row.type, row.value, line, ttl);
      if (!res && row.type !== 'CAA') throw new Error('添加' + domain + '解析记录失败，' + provider.getError());
      log('Add DNS Record: ' + domain + ' ' + row.type + ' ' + row.value);
    }
  }
  if (Object.keys(cnameDomainList).length) {
    await addDns(cnameDomainList, log, false, ownerUid);
  }
}

export async function delDns(dnsList: DnsList, log: (txt: string) => void, cname = false, ownerUid = 0): Promise<void> {
  const cnameDomainList: DnsList = {};
  for (const [mainDomain, list] of Object.entries(dnsList)) {
    const drow = await findDnsDomain(mainDomain, ownerUid);
    if (!drow) {
      if (cname) {
        for (let i = list.length - 1; i >= 0; i--) {
          const row = list[i];
          const domain = row.name === '_acme-challenge' ? mainDomain : row.name.replace('_acme-challenge.', '') + '.' + mainDomain;
          const cnameRow = await queryOne(
            `SELECT A.*, B.name AS cnamedomain FROM ${table('cert_cname')} A JOIN ${table('domain')} B ON A.did = B.id WHERE A.domain = ?`,
            [domain],
          );
          if (cnameRow) {
            row.name = cnameRow.rr;
            if (!cnameDomainList[cnameRow.cnamedomain]) cnameDomainList[cnameRow.cnamedomain] = [];
            cnameDomainList[cnameRow.cnamedomain].push(row);
            list.splice(i, 1);
          }
        }
      } else {
        continue;
      }
    }
    if (!drow) continue;
    if (!list.length) continue;

    const provider = getDnsProvider(drow.type, await accountConfig(drow), drow.name, drow.thirdid);
    if (!provider) continue;

    let records = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (drow.type === 'huawei') records = getHuaweiDnsRecords(records);

    const cache: Record<string, any> = {};
    for (const row of records) {
      const domain = row.name + '.' + mainDomain;
      if (!cache[row.name]) {
        cache[row.name] = await provider.getDomainRecords(1, 100, null, row.name, null, null, null);
      }
      if (!cache[row.name]) continue;
      const matched = cache[row.name].list.filter((v: any) => {
        if (normName(v.Name) !== normName(row.name)) return false;
        const val = Array.isArray(v.Value) ? v.Value.join(',') : v.Value;
        return v.Type === row.type && (val === row.value || String(val).replace(/\.$/, '') === row.value);
      });
      for (const rec of matched) {
        await provider.deleteDomainRecord(rec.RecordId);
        log('Delete DNS Record: ' + domain + ' ' + row.type + ' ' + row.value);
      }
    }
  }
  if (Object.keys(cnameDomainList).length) {
    await delDns(cnameDomainList, log, false, ownerUid);
  }
}

function valueMatches(expected: string, result: string[] | false): boolean {
  if (!result || !result.length) return false;
  if (result.includes(expected) || result.includes(expected.toLowerCase())) return true;
  if (isIP(expected)) {
    const normalized = result.map((v) => String(v).toLowerCase());
    return normalized.includes(expected.toLowerCase());
  }
  return false;
}

export async function verifyDns(dnsList: DnsList): Promise<boolean> {
  if (!Object.keys(dnsList).length) return true;
  for (const [mainDomain, list] of Object.entries(dnsList)) {
    for (const row of list) {
      if (row.type === 'CAA') continue;
      const domain = row.name + '.' + mainDomain;
      let result = await getDnsRecords(domain, row.type);
      if (!valueMatches(row.value, result)) {
        result = await queryDnsDoh(domain, row.type);
        if (!valueMatches(row.value, result)) return false;
      }
    }
  }
  return true;
}