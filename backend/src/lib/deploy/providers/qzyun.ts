import type { DeployProvider } from '../types.js';

const BASE_URL = 'https://panel.qzyun.cn';
const ROUTER_STATE_TREE =
  '%5B%22%22%2C%7B%22children%22%3A%5B%22(app)%22%2C%7B%22children%22%3A%5B%22(product)%22%2C%7B%22children%22%3A%5B%22certificate%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36';

interface HttpResult {
  code: number;
  headers: Record<string, string[]>;
  body: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class QzyunDeploy implements DeployProvider {
  private logger: ((txt: string) => void) | null = null;
  private email: string;
  private password: string;
  private cookie = '';
  private actions: Record<string, string> = {};
  private certificateWasAdded = false;

  constructor(config: Record<string, any>) {
    this.email = String(config.email ?? '').trim();
    this.password = String(config.password ?? '');
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  async check(): Promise<void> {
    this.validateAccount();
    await this.login();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    this.validateAccount();

    const certificate = String(config.certificate ?? '').trim();
    const domain = String(config.domain ?? '').trim();
    if (certificate === '') throw new Error('证书名称或文档ID不能为空');
    if (String(fullchain).trim() === '' || String(privatekey).trim() === '') throw new Error('证书或私钥内容为空');

    await this.login();
    const page = await this.request('/certificate');
    if (page.code !== 200) throw new Error('获取全栈云证书列表失败(httpCode=' + page.code + ')');

    let documentId: string;
    if (this.isDocumentId(certificate)) {
      documentId = certificate;
    } else {
      try {
        documentId = this.findCertificateDocumentId(page.body, certificate);
      } catch (e: any) {
        if (!String(e.message || e).includes('未找到证书')) throw e;
        documentId = await this.addCertificate(page.body, certificate, fullchain, privatekey);
      }
    }

    if (!this.certificateWasAdded) {
      const actionId = await this.findAction(page.body, 'updateCertificateAction');
      const response = await this.postAction('/certificate', actionId, {
        '1_certDocumentId': documentId,
        '1_serverCertificate': fullchain,
        '1_privateKey': privatekey,
        '0': '[{"success":false,"message":""},"$K1"]',
      });
      const result = this.parseActionResult(response.body);
      if (response.code !== 200 || !result || result.success !== true) {
        const message = result?.message ?? '请求失败(httpCode=' + response.code + ')';
        throw new Error('全栈云证书更新失败：' + message);
      }
    }

    if (domain !== '') {
      await this.bindDomain(domain, documentId, certificate, fullchain, privatekey);
    }

    if (!info || typeof info !== 'object') info = {};
    if (!info.config || typeof info.config !== 'object') info.config = {};
    info.config.certificate = documentId;
    this.log('全栈云证书处理成功，文档ID：' + documentId);
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }

  private validateAccount(): void {
    if (this.email === '' || this.password === '') throw new Error('请填写全栈云登录邮箱和密码');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) throw new Error('全栈云登录邮箱格式不正确');
  }

  private async login(): Promise<void> {
    const page = await this.request('/login');
    if (page.code !== 200) throw new Error('打开全栈云登录页失败(httpCode=' + page.code + ')');

    const actionId = await this.findAction(page.body, 'login');
    const response = await this.postAction('/login', actionId, {
      '1_email': this.email,
      '1_password': this.password,
      '0': '[{"error":null,"success":false},"$K1"]',
    });
    this.cookie = this.extractCookies(response.headers);

    if (response.code >= 300 && response.code < 400) {
      if (this.cookie === '') throw new Error('全栈云登录失败：重定向响应未返回登录会话');
      return;
    }

    const result = this.parseActionResult(response.body);
    if (response.code !== 200 || (result && result.success === false)) {
      const message = result?.error ?? result?.message ?? '请求失败(httpCode=' + response.code + ')';
      throw new Error('全栈云登录失败：' + message);
    }
    if (this.cookie === '') throw new Error('全栈云登录失败：未获取到登录会话');
  }

  private async addCertificate(page: string, name: string, fullchain: string, privatekey: string): Promise<string> {
    const actionId = await this.findAction(page, 'addCertificateAction');
    const response = await this.postAction('/certificate', actionId, {
      '1_certificateName': name,
      '1_serverCertificate': fullchain,
      '1_privateKey': privatekey,
      '0': '[{"success":false,"message":""},"$K1"]',
    });
    const result = this.parseActionResult(response.body);
    if (response.code !== 200 || !result || result.success !== true) {
      const message = result?.message ?? '请求失败(httpCode=' + response.code + ')';
      throw new Error('全栈云证书添加失败：' + message);
    }

    const listPage = await this.request('/certificate');
    const documentId = this.findCertificateDocumentId(listPage.body, name);
    this.certificateWasAdded = true;
    this.log('全栈云证书添加成功，文档ID：' + documentId);
    return documentId;
  }

  private async bindDomain(domain: string, documentId: string, certificate: string, fullchain: string, privatekey: string): Promise<void> {
    const domainPage = await this.request('/cdn/domain/' + encodeURIComponent(domain));
    if (domainPage.code !== 200) throw new Error('获取全栈云域名信息失败(httpCode=' + domainPage.code + ')');
    const domainInfo = this.findDomainInfo(domainPage.body, domain);
    if (!domainInfo) throw new Error('全栈云中未找到域名“' + domain + '”');

    const certificatePage = await this.request('/certificate');
    if (this.isCertificateBound(certificatePage.body, documentId, domain)) {
      this.log('全栈云证书已绑定域名，跳过：' + domain);
      return;
    }
    const actionId = await this.findAction(certificatePage.body, 'bindDomainCdnServer');
    const certificateName = this.isDocumentId(certificate)
      ? this.findCertificateNameByDocumentId(certificatePage.body, documentId)
      : certificate;
    const response = await this.postAction('/certificate', actionId, {
      '1_domainName': domain,
      '1_Id': String(domainInfo.id),
      '1_documentId': domainInfo.documentId,
      '1_CertificateName': certificateName,
      '1_ServerCertificate': fullchain,
      '1_CertificateDocumentId': documentId,
      '1_PrivateKey': privatekey,
      '0': '[{"success":false,"message":""},"$K1"]',
    });
    const result = this.parseActionResult(response.body);
    if (response.code !== 200 || !result || result.success !== true) {
      const message = result?.message ?? '请求失败(httpCode=' + response.code + ')';
      throw new Error('全栈云证书绑定域名失败：' + message);
    }
    this.log('全栈云证书已绑定域名：' + domain);
  }

  private isCertificateBound(html: string, documentId: string, domain: string): boolean {
    const rsc = this.extractRsc(html);
    const needle = '"documentId":' + JSON.stringify(documentId);
    const position = rsc.indexOf(needle);
    if (position === -1) return false;
    const start = rsc.lastIndexOf('{"id":', position);
    if (start === -1) return false;
    const object = this.extractJsonObject(rsc, start);
    const certificate = object ? this.safeParse(object) : null;
    for (const cdnDomain of certificate?.cdnDomains || []) {
      if (cdnDomain?.domain === domain) return true;
    }
    return false;
  }

  private findDomainInfo(html: string, domain: string): { id: any; documentId: any } | null {
    const rsc = this.extractRsc(html);
    const needle = '"domain":' + JSON.stringify(domain);
    let offset = 0;
    for (;;) {
      const position = rsc.indexOf(needle, offset);
      if (position === -1) break;
      const start = rsc.lastIndexOf('{"id":', position);
      if (start !== -1) {
        const object = this.extractJsonObject(rsc, start);
        const domainData = object ? this.safeParse(object) : null;
        if (domainData && domainData.domain === domain && domainData.id !== undefined && domainData.documentId !== undefined) {
          return { id: domainData.id, documentId: domainData.documentId };
        }
      }
      offset = position + needle.length;
    }
    return null;
  }

  private findCertificateNameByDocumentId(html: string, documentId: string): string {
    const rsc = this.extractRsc(html);
    const needle = '"documentId":' + JSON.stringify(documentId);
    let offset = 0;
    for (;;) {
      const position = rsc.indexOf(needle, offset);
      if (position === -1) break;
      const start = rsc.lastIndexOf('{"id":', position);
      if (start !== -1) {
        const object = this.extractJsonObject(rsc, start);
        const certificate = object ? this.safeParse(object) : null;
        if (certificate && certificate.name !== undefined && certificate.content !== undefined) return certificate.name;
      }
      offset = position + needle.length;
    }
    throw new Error('全栈云中未找到证书名称');
  }

  private async findAction(html: string, actionName: string): Promise<string> {
    if (this.actions[actionName]) return this.actions[actionName];

    const srcRe = /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi;
    const srcs = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(html))) srcs.add(m[1]);

    for (const rawSrc of srcs) {
      const src = rawSrc.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const url = this.sameOriginUrl(src);
      if (!url) continue;
      const response = await this.request(url);
      if (response.code !== 200) continue;
      const re = new RegExp('createServerReference\\("([a-f0-9]{32,64})"[\\s\\S]{0,300},"' + escapeRegExp(actionName) + '"\\)');
      const match = response.body.match(re);
      if (match) {
        this.actions[actionName] = match[1];
        return match[1];
      }
    }

    throw new Error('无法识别全栈云接口动作：' + actionName + '，可能是全栈云前端已更新');
  }

  private findCertificateDocumentId(html: string, certificateName: string): string {
    const rsc = this.extractRsc(html);
    const needle = '"name":' + JSON.stringify(certificateName);
    let offset = 0;
    const documentIds = new Set<string>();

    for (;;) {
      const position = rsc.indexOf(needle, offset);
      if (position === -1) break;
      const start = rsc.lastIndexOf('{"id":', position);
      if (start !== -1) {
        const object = this.extractJsonObject(rsc, start);
        const certificate = object ? this.safeParse(object) : null;
        if (
          certificate &&
          certificate.name === certificateName &&
          certificate.startTime !== undefined &&
          certificate.privateKey !== undefined &&
          certificate.content !== undefined &&
          certificate.documentId !== undefined
        ) {
          documentIds.add(String(certificate.documentId));
        }
      }
      offset = position + needle.length;
    }

    const ids = [...documentIds];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) throw new Error('全栈云中存在多张同名证书，请改为填写证书文档ID');
    throw new Error('全栈云中未找到证书“' + certificateName + '”');
  }

  private extractRsc(html: string): string {
    const re = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g;
    let rsc = '';
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const data = this.safeParse(m[1]);
      if (Array.isArray(data) && data[0] === 1 && typeof data[1] === 'string') rsc += data[1];
    }
    return rsc;
  }

  private extractJsonObject(text: string, start: number): string | null {
    const length = text.length;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  private async postAction(path: string, actionId: string, fields: Record<string, string>): Promise<HttpResult> {
    const form = new FormData();
    for (const [name, contents] of Object.entries(fields)) form.append(name, contents);
    return this.request(path, form, {
      Accept: 'text/x-component',
      'next-action': actionId,
      'next-router-state-tree': ROUTER_STATE_TREE,
    }, 'POST', 30);
  }

  private parseActionResult(body: string): any | null {
    const re = /(?:^|\n)[a-z0-9]+:(\{[^\r\n]*\})/gi;
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) matches.push(m[1]);
    for (const json of matches.reverse()) {
      const result = this.safeParse(json);
      if (result && (result.success !== undefined || result.error !== undefined || result.message !== undefined)) return result;
    }
    return null;
  }

  private extractCookies(headers: Record<string, string[]>): string {
    const cookies: string[] = [];
    for (const [name, values] of Object.entries(headers)) {
      if (name.toLowerCase() !== 'set-cookie') continue;
      for (const value of values) {
        const pair = String(value).split(';')[0].trim();
        if (pair !== '' && !pair.endsWith('=') && !pair.endsWith('=deleted')) cookies.push(pair);
      }
    }
    return cookies.join('; ');
  }

  private sameOriginUrl(url: string): string | null {
    if (url.startsWith('/')) return BASE_URL + url;
    try {
      const host = new URL(url).host;
      return host === new URL(BASE_URL).host ? url : null;
    } catch {
      return null;
    }
  }

  private async request(
    path: string,
    data?: FormData | null,
    headers: Record<string, string> = {},
    method = 'GET',
    timeout = 15,
  ): Promise<HttpResult> {
    const absolute = path.startsWith('http');
    const url = absolute ? path : BASE_URL + path;
    const referer = absolute ? BASE_URL + '/' : BASE_URL + path;

    const finalHeaders: Record<string, string> = {
      Referer: referer,
      'User-Agent': USER_AGENT,
      ...headers,
    };
    if (this.cookie) finalHeaders.Cookie = this.cookie;

    const res = await fetch(url, {
      method,
      headers: finalHeaders,
      body: method === 'GET' ? undefined : (data ?? undefined),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout * 1000),
    });

    const responseHeaders: Record<string, string[]> = {};
    if (typeof (res.headers as any).getSetCookie === 'function') {
      const list = (res.headers as any).getSetCookie() as string[];
      if (list && list.length) responseHeaders['set-cookie'] = list;
    }
    const body = await res.text();
    return { code: res.status, headers: responseHeaders, body };
  }

  private safeParse(text: string): any | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private isDocumentId(value: string): boolean {
    return /^[a-z0-9]{24}$/i.test(value);
  }
}