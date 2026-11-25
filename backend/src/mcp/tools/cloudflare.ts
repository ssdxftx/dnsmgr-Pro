import {
  int,
  str,
  arr,
  listResponse,
  requireArgs,
  type ToolArgs,
  type ToolDef,
} from '../types.js';

const need = (...keys: string[]) => (args: ToolArgs) => {
  requireArgs(args, keys);
  return args;
};

function joinArray(value: any, glue: string): any {
  return Array.isArray(value) ? value.join(glue) : value;
}

const tlsEnum = ['1.0', '1.1', '1.2', '1.3'];

const tools: ToolDef[] = [
  {
    name: 'cf_hostname_query',
    title: '查询Cloudflare自定义主机名',
    description: '查询 Cloudflare 域名（SaaS）的自定义主机名、回退源、DCV委派信息。domain_id 为系统内 Cloudflare 类型域名的ID。',
    readOnly: true,
    properties: {
      domain_id: int('Cloudflare 域名ID'),
      hostname: str('txt_targets：需要添加TXT验证记录的主机名'),
    },
    required: ['domain_id'],
    actions: {
      list: {
        desc: '自定义主机名列表（含证书验证状态与验证记录）',
        scope: { module: 'cloudflare' },
        before: need('domain_id'),
        request: (args) => ({ method: 'GET', path: `/api/cloudflare/domains/${Number(args.domain_id)}/hostnames` }),
        after: (data) => listResponse(data),
      },
      txt_targets: {
        desc: '查找可用于添加TXT验证记录的本地域名',
        scope: { module: 'cloudflare' },
        before: need('domain_id', 'hostname'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cloudflare/domains/${Number(args.domain_id)}/hostnames/txt-targets`,
          body: { hostname: args.hostname },
        }),
      },
      fallback_get: {
        desc: '获取回退源（Fallback Origin）',
        scope: { module: 'cloudflare' },
        before: need('domain_id'),
        request: (args) => ({ method: 'GET', path: `/api/cloudflare/domains/${Number(args.domain_id)}/fallback` }),
      },
      dcv_uuid: {
        desc: '获取DCV委派UUID',
        scope: { module: 'cloudflare' },
        before: need('domain_id'),
        request: (args) => ({ method: 'GET', path: `/api/cloudflare/domains/${Number(args.domain_id)}/dcv-uuid` }),
      },
    },
  },
  {
    name: 'cf_hostname_manage',
    title: '管理Cloudflare自定义主机名',
    description:
      '创建、修改、删除 Cloudflare 自定义主机名（SaaS），以及设置回退源。domain_id 为系统内 Cloudflare 类型域名的ID。',
    destructive: true,
    properties: {
      domain_id: int('Cloudflare 域名ID'),
      hostname: str('add：自定义主机名；delete：主机名（用于日志）'),
      hostnames: arr('batch_add：主机名列表'),
      hostname_id: str('update/refresh/delete：自定义主机名ID'),
      hostname_ids: arr('batch_update/batch_delete：自定义主机名ID列表'),
      custom_origin_server: str('自定义源站，留空使用回退源'),
      ssl_method: str('证书验证方式，默认txt', ['txt', 'http']),
      min_tls_version: str('最低TLS版本，默认1.0', tlsEnum),
      origin: str('fallback_set：回退源主机名'),
    },
    required: ['domain_id'],
    actions: {
      add: {
        desc: '创建自定义主机名（hostname 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('domain_id', 'hostname'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cloudflare/domains/${Number(args.domain_id)}/hostnames`,
          body: {
            hostname: args.hostname,
            custom_origin_server: args.custom_origin_server,
            ssl_method: args.ssl_method,
            min_tls_version: args.min_tls_version,
          },
        }),
      },
      batch_add: {
        desc: '批量创建自定义主机名（hostnames 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('domain_id', 'hostnames'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cloudflare/domains/${Number(args.domain_id)}/hostnames/batch_add`,
          body: {
            hostnames: joinArray(args.hostnames, '\n'),
            custom_origin_server: args.custom_origin_server,
            ssl_method: args.ssl_method,
            min_tls_version: args.min_tls_version,
          },
        }),
      },
      update: {
        desc: '修改自定义主机名的源站与证书设置（hostname_id 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('domain_id', 'hostname_id'),
        request: (args) => ({
          method: 'PUT',
          path: `/api/cloudflare/domains/${Number(args.domain_id)}/hostnames/${encodeURIComponent(String(args.hostname_id))}`,
          body: {
            custom_origin_server: args.custom_origin_server,
            ssl_method: args.ssl_method,
            min_tls_version: args.min_tls_version,
          },
        }),
      },
      batch_update: {
        desc: '批量修改源站与证书设置（hostname_ids 必填，ssl_method/min_tls_version 留空则不修改）',
        scope: { module: 'cloudflare', write: true },
        before: need('domain_id', 'hostname_ids'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cloudflare/domains/${Number(args.domain_id)}/hostnames/batch_update`,
          body: {
            hostname_ids: joinArray(args.hostname_ids, ','),
            custom_origin_server: args.custom_origin_server,
            ssl_method: args.ssl_method,
            min_tls_version: args.min_tls_version,
          },
        }),
      },
      refresh: {
        desc: '重新发起证书验证（hostname_id 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('domain_id', 'hostname_id'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cloudflare/domains/${Number(args.domain_id)}/hostnames/${encodeURIComponent(String(args.hostname_id))}/refresh`,
        }),
      },
      delete: {
        desc: '删除自定义主机名（hostname_id 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('domain_id', 'hostname_id'),
        request: (args) => ({
          method: 'DELETE',
          path: `/api/cloudflare/domains/${Number(args.domain_id)}/hostnames/${encodeURIComponent(String(args.hostname_id))}`,
          query: { hostname: args.hostname },
        }),
      },
      batch_delete: {
        desc: '批量删除自定义主机名（hostname_ids 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('domain_id', 'hostname_ids'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cloudflare/domains/${Number(args.domain_id)}/hostnames/batch_delete`,
          body: { hostname_ids: args.hostname_ids },
        }),
      },
      fallback_set: {
        desc: '设置回退源（origin 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('domain_id', 'origin'),
        request: (args) => ({
          method: 'PUT',
          path: `/api/cloudflare/domains/${Number(args.domain_id)}/fallback`,
          body: { origin: args.origin },
        }),
      },
      fallback_delete: {
        desc: '清空回退源',
        scope: { module: 'cloudflare', write: true },
        before: need('domain_id'),
        request: (args) => ({ method: 'DELETE', path: `/api/cloudflare/domains/${Number(args.domain_id)}/fallback` }),
      },
    },
  },
  {
    name: 'cf_tunnel_query',
    title: '查询Cloudflare Tunnel',
    description:
      '查询 Cloudflare Tunnel（隧道）及其公网主机名、私有网络CIDR路由、主机名路由。account_id 为系统内 Cloudflare 类型域名账户的ID（需使用API令牌认证）。',
    readOnly: true,
    properties: {
      account_id: int('Cloudflare 域名账户ID（系统内ID）'),
      tunnel_id: str('Tunnel ID（list 以外的操作必填）'),
    },
    required: ['account_id'],
    actions: {
      list: {
        desc: 'Tunnel 列表',
        scope: { module: 'cloudflare' },
        before: need('account_id'),
        request: (args) => ({ method: 'GET', path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels` }),
        after: (data) => listResponse(data),
      },
      token: {
        desc: '获取 Tunnel 的运行令牌（用于 cloudflared 连接）',
        scope: { module: 'cloudflare' },
        before: need('account_id', 'tunnel_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/token`,
        }),
      },
      public_hostnames: {
        desc: 'Tunnel 的公网主机名（Public Hostname）列表',
        scope: { module: 'cloudflare' },
        before: need('account_id', 'tunnel_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/public-hostnames`,
        }),
        after: (data) => listResponse(data),
      },
      cidr_routes: {
        desc: 'Tunnel 的私有网络CIDR路由列表',
        scope: { module: 'cloudflare' },
        before: need('account_id', 'tunnel_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/cidr-routes`,
        }),
        after: (data) => listResponse(data),
      },
      hostname_routes: {
        desc: 'Tunnel 的主机名路由列表',
        scope: { module: 'cloudflare' },
        before: need('account_id', 'tunnel_id'),
        request: (args) => ({
          method: 'GET',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/hostname-routes`,
        }),
        after: (data) => listResponse(data),
      },
    },
  },
  {
    name: 'cf_tunnel_manage',
    title: '管理Cloudflare Tunnel',
    description:
      '创建、删除 Cloudflare Tunnel，配置公网主机名、CIDR路由、主机名路由。account_id 为系统内 Cloudflare 类型域名账户的ID。',
    destructive: true,
    properties: {
      account_id: int('Cloudflare 域名账户ID（系统内ID）'),
      tunnel_id: str('Tunnel ID（add 以外的操作必填）'),
      name: str('add：Tunnel 名称'),
      hostname: str('public_hostname_save/public_hostname_delete/hostname_route_add：主机名'),
      service: str('public_hostname_save：服务地址，如 http://localhost:8080'),
      path: str('public_hostname_save/public_hostname_delete：路径（可选）'),
      network: str('cidr_add：CIDR网段，如 10.0.0.0/24'),
      comment: str('cidr_add/hostname_route_add：备注'),
      route_id: str('cidr_delete/hostname_route_delete：路由ID'),
    },
    required: ['account_id'],
    actions: {
      add: {
        desc: '创建 Tunnel（name 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('account_id', 'name'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels`,
          body: { name: args.name },
        }),
      },
      delete: {
        desc: '删除 Tunnel',
        scope: { module: 'cloudflare', write: true },
        before: need('account_id', 'tunnel_id'),
        request: (args) => ({
          method: 'DELETE',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}`,
        }),
      },
      public_hostname_save: {
        desc: '添加或更新公网主机名，并自动创建CNAME解析（hostname、service 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('account_id', 'tunnel_id', 'hostname', 'service'),
        request: (args) => ({
          method: 'PUT',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/public-hostnames`,
          body: { hostname: args.hostname, service: args.service, path: args.path },
        }),
      },
      public_hostname_delete: {
        desc: '删除公网主机名（hostname 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('account_id', 'tunnel_id', 'hostname'),
        request: (args) => ({
          method: 'DELETE',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/public-hostnames`,
          query: { hostname: args.hostname, path: args.path },
        }),
      },
      cidr_add: {
        desc: '添加CIDR路由（network 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('account_id', 'tunnel_id', 'network'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/cidr-routes`,
          body: { network: args.network, comment: args.comment },
        }),
      },
      cidr_delete: {
        desc: '删除CIDR路由（route_id 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('account_id', 'tunnel_id', 'route_id'),
        request: (args) => ({
          method: 'DELETE',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/cidr-routes/${encodeURIComponent(String(args.route_id))}`,
        }),
      },
      hostname_route_add: {
        desc: '添加主机名路由（hostname 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('account_id', 'tunnel_id', 'hostname'),
        request: (args) => ({
          method: 'POST',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/hostname-routes`,
          body: { hostname: args.hostname, comment: args.comment },
        }),
      },
      hostname_route_delete: {
        desc: '删除主机名路由（route_id 必填）',
        scope: { module: 'cloudflare', write: true },
        before: need('account_id', 'tunnel_id', 'route_id'),
        request: (args) => ({
          method: 'DELETE',
          path: `/api/cloudflare/accounts/${Number(args.account_id)}/tunnels/${encodeURIComponent(String(args.tunnel_id))}/hostname-routes/${encodeURIComponent(String(args.route_id))}`,
        }),
      },
    },
  },
];

export default tools;
