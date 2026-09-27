import type { DeployProvider } from '../types.js';

interface HttpResponse {
  code: number;
  body: string;
  location: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * CloudPanel 证书部署：登录面板后在站点「证书导入」页上传证书与私钥。
 * 采用与上游 PHP 实现一致的会话/Cookie 与表单令牌处理。
 */
export class CloudpanelDeploy implements DeployProvider {
  private url: string;
  private username: string;
  private password: string;
  private proxy: boolean;
  private cookie = '';
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').trim().replace(/\/+$/, '');
    this.username = String(config.username || '').trim();
    this.password = config.password || '';
    this.proxy = String(config.proxy ?? '') === '1';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }

  async check(): Promise<void> {
    this.assertAccountConfig();
    await this.login();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    this.assertAccountConfig();
    if (String(fullchain).trim() === '' || String(privatekey).trim() === '') {
      throw new Error('SSL 证书或私钥内容不能为空');
    }
    const targets = this.parseSites(config.sites ?? '');
    if (!targets.length) throw new Error('没有设置要部署的网站域名');

    await this.login();

    let success = 0;
    let errmsg: string | null = null;
    for (const domain of targets) {
      try {
        await this.deploySite(domain, fullchain, privatekey);
        this.log(`网站 ${domain} 证书部署成功`);
        success++;
      } catch (e: any) {
        errmsg = e?.message || String(e);
        this.log(`网站 ${domain} 证书部署失败：` + errmsg);
      }
    }
    if (success === 0) throw new Error(errmsg || '要部署的网站不存在');
  }

  private assertAccountConfig(): void {
    if (this.url === '' || this.username === '' || this.password === '') {
      throw new Error('请填写面板地址、用户名和密码');
    }
    let parts: URL;
    try {
      parts = new URL(this.url);
    } catch {
      throw new Error('CloudPanel 面板地址格式无效');
    }
    if (!['http:', 'https:'].includes(parts.protocol) || !parts.hostname) {
      throw new Error('CloudPanel 面板地址格式无效');
    }
  }

  private async login(): Promise<void> {
    const page = await this.request('GET', '/login');
    if (page.code !== 200) {
      throw new Error('打开 CloudPanel 登录页失败(httpCode=' + page.code + ')');
    }
    const csrf = this.extractValue(page.body, '_csrf_token');
    if (csrf === '') throw new Error('获取登录 CSRF 令牌失败');

    const response = await this.request(
      'POST',
      '/login',
      { userName: this.username, password: this.password, _csrf_token: csrf },
      20,
      this.url + '/login',
    );

    const location = this.absoluteUrl(response.location);
    if (this.isTwoFactorLocation(location) || this.containsTwoFactor(response.body)) {
      throw new Error('当前 CloudPanel 账户启用了双因素认证，暂不支持');
    }

    if (response.code >= 300 && response.code < 400) {
      if (this.cookie === '') throw new Error('CloudPanel 登录失败：未获取到登录会话');
      const home = await this.request('GET', this.pathFromUrl(location) || '/');
      if (this.isLoginPage(home.body, home.location)) {
        throw new Error('CloudPanel 登录失败，请检查用户名和密码');
      }
      return;
    }

    const alerts = this.parseAlerts(response.body);
    if (alerts.length) throw new Error('CloudPanel 登录失败：' + alerts[0]);
    if (this.isLoginPage(response.body, response.location)) {
      throw new Error('CloudPanel 登录失败，请检查用户名和密码');
    }
    throw new Error('CloudPanel 登录失败(httpCode=' + response.code + ')');
  }

  private async deploySite(domain: string, certificate: string, privatekey: string): Promise<void> {
    const path = '/site/' + encodeURIComponent(domain) + '/certificate/import';
    const page = await this.request('GET', path);
    if (this.isLoginPage(page.body, page.location)) {
      throw new Error('打开证书导入页失败，站点不存在或登录已失效');
    }
    if (page.code !== 200) {
      throw new Error('打开证书导入页失败(httpCode=' + page.code + ')');
    }

    let token = this.extractValue(page.body, 'site_import_certificate[_token]');
    if (token === '') token = this.extractValue(page.body, 'site_import_certificate__token', true);
    if (token === '') throw new Error('获取证书导入表单令牌失败');

    const params = new URLSearchParams();
    params.set('site_import_certificate[privateKey]', privatekey);
    params.set('site_import_certificate[certificate]', certificate);
    params.set('site_import_certificate[certificateChain]', '');
    params.set('site_import_certificate[submit]', 'Import and Install');
    params.set('site_import_certificate[_token]', token);

    const response = await this.request('POST', path, params, 15, this.url + path);

    const location = this.absoluteUrl(response.location);
    if (response.code >= 300 && response.code < 400) {
      if (this.isLoginPage('', location)) throw new Error('登录已失效，证书导入未完成');
      if (location.includes('/certificates') || location.includes('/site/' + domain)) return;
    }

    const alerts = this.parseAlerts(response.body);
    if (alerts.length) throw new Error(alerts.join('；'));
    if (response.code === 200 && response.body.includes('site_import_certificate')) {
      throw new Error('证书导入失败，请检查证书与私钥是否匹配');
    }
    if (response.code >= 500) {
      throw new Error('证书导入失败，面板返回 ' + response.code + '，请确认证书格式后在 CloudPanel 后台手动导入排查');
    }
    if (response.code < 200 || response.code >= 300) {
      throw new Error('证书导入失败(httpCode=' + response.code + ')');
    }
  }

  private parseSites(sites: any): string[] {
    const seen = new Map<string, string>();
    for (const raw of String(sites ?? '').split(/[\r\n,]+/)) {
      const site = raw.trim();
      if (site) seen.set(site, site);
    }
    return Array.from(seen.values());
  }

  private async request(
    method: string,
    path: string,
    params: URLSearchParams | Record<string, string> | null = null,
    timeout = 15,
    referer: string | null = null,
  ): Promise<HttpResponse> {
    const url = path.startsWith('http://') || path.startsWith('https://') ? path : this.url + path;
    const headers: Record<string, string> = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (method.toUpperCase() === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers.Origin = this.url;
    }
    if (this.cookie) headers.Cookie = this.cookie;

    let body: string | undefined;
    if (params !== null) {
      body = params instanceof URLSearchParams ? params.toString() : new URLSearchParams(params).toString();
    }

    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout * 1000),
    });
    const text = await res.text();
    this.mergeCookies(res.headers.getSetCookie ? res.headers.getSetCookie() : []);
    return { code: res.status, body: text, location: res.headers.get('location') || '' };
  }

  private mergeCookies(setCookies: string[]): void {
    const map = new Map<string, string>();
    if (this.cookie !== '') {
      for (const pair of this.cookie.split('; ')) {
        const idx = pair.indexOf('=');
        if (idx < 0) continue;
        const name = pair.slice(0, idx);
        if (name) map.set(name, pair.slice(idx + 1));
      }
    }
    for (const value of setCookies) {
      const pair = String(value).split(';')[0].trim();
      if (pair === '') continue;
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const name = pair.slice(0, idx);
      const val = pair.slice(idx + 1);
      if (name === '') continue;
      if (val === '' || pair.endsWith('=deleted')) {
        map.delete(name);
        continue;
      }
      map.set(name, val);
    }
    this.cookie = Array.from(map.entries())
      .map(([n, v]) => n + '=' + v)
      .join('; ');
  }

  private extractValue(html: string, name: string, byId = false): string {
    const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const attr = byId ? 'id' : 'name';
    let m = html.match(new RegExp(attr + '="' + quoted + '"[^>]*value="([^"]*)"', 'i'));
    if (m) return decodeEntities(m[1]);
    m = html.match(new RegExp('value="([^"]*)"[^>]*' + attr + '="' + quoted + '"', 'i'));
    if (m) return decodeEntities(m[1]);
    return '';
  }

  private parseAlerts(html: string): string[] {
    const messages: string[] = [];
    const re = /class="alert alert-(?:danger|warning|success)"[^>]*>([\s\S]*?)<\/div>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const text = decodeEntities(m[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
      if (text !== '') messages.push(text);
    }
    return messages;
  }

  private isLoginPage(html: string, location = ''): boolean {
    const path = this.pathFromUrl(this.absoluteUrl(location));
    if (path === '/login') return true;
    return html.includes('name="userName"') && html.includes('action="/login"');
  }

  private isTwoFactorLocation(location: string): boolean {
    const path = this.pathFromUrl(location).toLowerCase();
    return path.includes('2fa') || path.includes('two-factor') || path.includes('totp');
  }

  private containsTwoFactor(html: string): boolean {
    const lower = html.toLowerCase();
    return lower.includes('two-factor') || lower.includes('authenticator') || lower.includes('one-time password');
  }

  private absoluteUrl(location: string): string {
    const loc = String(location || '').trim();
    if (loc === '') return '';
    if (loc.startsWith('http://') || loc.startsWith('https://')) return loc;
    if (loc.startsWith('/')) return this.url + loc;
    return this.url + '/' + loc.replace(/^\/+/, '');
  }

  private pathFromUrl(url: string): string {
    if (url === '') return '';
    try {
      const p = new URL(url).pathname;
      return p || '/';
    } catch {
      return '/';
    }
  }
}