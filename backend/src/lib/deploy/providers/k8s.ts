import { request as httpRequest } from 'node:https';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { assertDeployTargetAllowed } from '../../netGuard.js';
import type { DeployProvider } from '../types.js';

export class K8sDeploy implements DeployProvider {
  private kubeconfig: string;
  private server = '';
  private bearerToken: string | null = null;
  private tls: { cert: Buffer | null; key: Buffer | null } = { cert: null, key: null };
  private insecure = false;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.kubeconfig = config.kubeconfig || '';
    // 默认校验证书；确需连接自签名集群时可显式开启 insecure
    this.insecure = config.insecure === true || config.insecure === '1' || config.insecure === 1;
  }

  // K8s 资源名遵循 DNS-1123：仅小写字母、数字、- 与 .，用白名单阻止路径/查询注入
  private static safeName(value: any, label: string): string {
    const v = String(value || '').trim();
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(v) || v.length > 253) {
      throw new Error(label + '不合法：仅允许小写字母、数字、- 和 .');
    }
    return v;
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private indexByName(arr: any[]): Record<string, any> {
    const out: Record<string, any> = {};
    for (const item of arr || []) {
      if (item && item.name !== undefined) out[item.name] = item;
    }
    return out;
  }

  private parse(): void {
    let kcfg: any;
    try {
      kcfg = parseYaml(this.kubeconfig);
    } catch {
      throw new Error('Kubeconfig格式错误');
    }
    if (!kcfg) throw new Error('Kubeconfig格式错误');
    const curr = kcfg['current-context'];
    if (!curr) throw new Error('Kubeconfig缺少current-context');

    const contexts = this.indexByName(kcfg.contexts || []);
    const clusters = this.indexByName(kcfg.clusters || []);
    const users = this.indexByName(kcfg.users || []);

    const ctx = contexts[curr];
    if (!ctx) throw new Error('Kubeconfig中找不到current-context: ' + curr);

    const clusterName = ctx.context && ctx.context.cluster;
    const userName = ctx.context && ctx.context.user;
    if (!clusterName || !userName) throw new Error('Kubeconfig中context缺少cluster或user: ' + curr);

    const cluster = clusters[clusterName];
    const user = users[userName];
    if (!cluster) throw new Error('Kubeconfig中找不到cluster: ' + clusterName);
    if (!user) throw new Error('Kubeconfig中找不到user: ' + userName);

    const server = cluster.cluster && cluster.cluster.server;
    if (!server) throw new Error('Kubeconfig中找不到cluster.server');
    this.server = server.replace(/\/+$/, '');

    this.bearerToken =
      (user.user && user.user.token) ||
      (user.user && user.user['auth-provider'] && user.user['auth-provider'].config && user.user['auth-provider'].config['access-token']) ||
      null;

    let clientCert: Buffer | null = null;
    let clientKey: Buffer | null = null;
    if (user.user && user.user['client-certificate-data'] && user.user['client-key-data']) {
      clientCert = Buffer.from(user.user['client-certificate-data'], 'base64');
      clientKey = Buffer.from(user.user['client-key-data'], 'base64');
    } else if (user.user && user.user['client-certificate'] && user.user['client-key']) {
      clientCert = readFileSync(user.user['client-certificate']);
      clientKey = readFileSync(user.user['client-key']);
    }
    this.tls = { cert: clientCert, key: clientKey };
  }

  private k8sRequest(method: string, path: string, body?: string): Promise<{ code: number; body: string; err: string }> {
    return new Promise((resolve) => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.bearerToken) headers['Authorization'] = 'Bearer ' + this.bearerToken;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const url = new URL(this.server + path);
      const req = httpRequest(
        url,
        {
          method,
          headers,
          timeout: 30000,
          rejectUnauthorized: !this.insecure,
          cert: this.tls.cert || undefined,
          key: this.tls.key || undefined,
        },
        (res) => {
          let data = '';
          res.on('data', (d) => (data += d.toString()));
          res.on('end', () => resolve({ code: res.statusCode || 0, body: data, err: '' }));
        }
      );
      req.on('timeout', () => {
        req.destroy(new Error('timeout'));
      });
      req.on('error', (e) => resolve({ code: 0, body: '', err: e.message }));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  private async verify(): Promise<void> {
    this.parse();
    await assertDeployTargetAllowed(this.server);
    const { code, body, err } = await this.k8sRequest('GET', '/version');
    if (err) throw new Error('连接Kubernetes API服务器失败: ' + err);
    if (code !== 200) throw new Error('连接Kubernetes API服务器失败: HTTP ' + code + ' ' + body);
  }

  async check(): Promise<void> {
    if (!this.kubeconfig) throw new Error('Kubeconfig不能为空');
    await this.verify();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const namespace = config.namespace;
    const secretNameRaw = config.secret_name;
    if (!namespace) throw new Error('命名空间不能为空');
    if (!secretNameRaw) throw new Error('Secret名称不能为空');
    const safeNamespace = K8sDeploy.safeName(namespace, '命名空间');
    const safeSecretName = K8sDeploy.safeName(secretNameRaw, 'Secret名称');

    this.parse();
    await assertDeployTargetAllowed(this.server);

    const secretPayload = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: safeSecretName, namespace: safeNamespace },
      type: 'kubernetes.io/tls',
      data: {
        'tls.crt': Buffer.from(config.fullchain || fullchain).toString('base64'),
        'tls.key': Buffer.from(config.privatekey || privatekey).toString('base64'),
      },
    };

    const secretUrl = '/api/v1/namespaces/' + safeNamespace + '/secrets/' + safeSecretName;
    const s = await this.k8sRequest('GET', secretUrl);

    if (s.code === 404) {
      const createUrl = '/api/v1/namespaces/' + safeNamespace + '/secrets';
      this.log('Secret:' + safeSecretName + ' 不存在，正在创建...');
      const c = await this.k8sRequest('POST', createUrl, JSON.stringify(secretPayload));
      if (c.code < 200 || c.code >= 300) throw new Error('创建Secret失败 (HTTP ' + c.code + '): ' + c.body + ' | ' + c.err);
      this.log('Secret:' + safeNamespace + ' 创建成功');
    } else if (s.code >= 200 && s.code < 300) {
      this.log('Secret:' + safeSecretName + ' 已存在，正在更新...');
      const patch = { data: secretPayload.data, type: 'kubernetes.io/tls' };
      const p = await this.k8sRequest('PATCH', secretUrl, JSON.stringify(patch));
      if (p.code < 200 || p.code >= 300) throw new Error('更新Secret失败 (HTTP ' + p.code + '): ' + p.body + ' | ' + p.err);
      this.log('Secret:' + safeSecretName + ' 更新成功');
    } else {
      throw new Error('获取Secret失败 (HTTP ' + s.code + '): ' + s.body + ' | ' + s.err);
    }

    if (config.ingresses) {
      const ingressUrl = '/apis/networking.k8s.io/v1/namespaces/' + safeNamespace + '/ingresses';
      for (const rawName of String(config.ingresses).split(',')) {
        const ingName = K8sDeploy.safeName(rawName.trim(), 'Ingress名称');
        const g = await this.k8sRequest('GET', ingressUrl + '/' + ingName);
        if (g.code < 200 || g.code >= 300) throw new Error("获取Ingress '" + ingName + "' 失败 (HTTP " + g.code + '): ' + g.body + ' | ' + g.err);
        let ing: any;
        try {
          ing = JSON.parse(g.body);
        } catch {
          throw new Error("解析Ingress '" + ingName + "' JSON失败: " + g.body);
        }

        const hosts: string[] = [];
        for (const rule of ing.spec?.rules || []) {
          if (rule.host) hosts.push(rule.host);
        }
        const uniqueHosts = [...new Set(hosts)];

        const tls: any[] = ing.spec?.tls || [];
        let found = false;
        for (const entry of tls) {
          if ((entry.secretName || '') === safeSecretName) {
            found = true;
            entry.hosts = [...new Set([...(entry.hosts || []), ...uniqueHosts])];
          }
        }
        if (!found) {
          tls.push({ secretName: safeSecretName, hosts: uniqueHosts });
        }

        const patch = { spec: { tls } };
        const i = await this.k8sRequest('PATCH', ingressUrl + '/' + ingName, JSON.stringify(patch));
        if (i.code < 200 || i.code >= 300) throw new Error("更新Ingress '" + ingName + "' 失败 (HTTP " + i.code + '): ' + i.body + ' | ' + i.err);
        this.log("Ingress '" + ingName + "' 更新TLS成功");
      }
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
