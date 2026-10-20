import { fetch as undiciFetch } from 'undici';
import { getConfiguredProxyAgent } from '../proxy.js';
import { APP_VERSION, UPDATE_REPO, compareSemver, parseSemver, type SemverParts } from '../version.js';

const SUCCESS_TTL = 10 * 60 * 1000;
const ERROR_TTL = 60 * 1000;
const REQUEST_TIMEOUT = 10 * 1000;
const API_BASE = 'https://api.github.com';
const WEB_BASE = 'https://github.com';
const USER_AGENT = 'dnsmgr-pro-update-check';

export interface UpdateCheckResult {
  current: string;
  latest: string | null;
  latestTag: string | null;
  hasUpdate: boolean;
  ahead: boolean;
  repo: string;
  releaseUrl: string | null;
  compareUrl: string | null;
  publishedAt: string | null;
  notes: string | null;
  checkedAt: string;
  cached: boolean;
  error: string | null;
}

let cache: { at: number; data: UpdateCheckResult } | null = null;

function authHeaders(): Record<string, string> {
  // 私有仓库或需要提高 API 限流额度时，可在服务端配置令牌（不落库、不回传前端）
  const token = String(process.env.DNSMGR_UPDATE_TOKEN || '').trim();
  return token ? { Authorization: 'Bearer ' + token } : {};
}

async function request(url: string, headers: Record<string, string>): Promise<any> {
  const dispatcher = await getConfiguredProxyAgent();
  return undiciFetch(url, { headers, dispatcher, signal: AbortSignal.timeout(REQUEST_TIMEOUT) } as any);
}

// git 协议的 refs 接口不受 GitHub REST API 限流影响，标签式发布场景更可靠
async function fetchTagNamesViaGit(repo: string): Promise<string[]> {
  const res = await request(`${WEB_BASE}/${repo}/info/refs?service=git-upload-pack`, { Accept: '*/*', 'User-Agent': USER_AGENT });
  if (!res.ok) throw new Error(`git refs 返回 HTTP ${res.status}`);
  const text = await res.text();
  const names = new Set<string>();
  for (const m of text.matchAll(/refs\/tags\/([^\s\u0000^]+)/g)) names.add(m[1]);
  return [...names];
}

async function fetchTagNamesViaApi(repo: string): Promise<string[]> {
  const res = await request(`${API_BASE}/repos/${repo}/tags?per_page=100`, {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    ...authHeaders(),
  });
  if (!res.ok) {
    const hint = res.status === 403 || res.status === 429 ? '（接口限流，可配置 DNSMGR_UPDATE_TOKEN 提高额度）' : '';
    throw new Error(`GitHub API 返回 HTTP ${res.status}${hint}`);
  }
  const tags = await res.json();
  return (Array.isArray(tags) ? tags.map((t: any) => String(t?.name || '')) : []).filter(Boolean);
}

async function fetchTagNames(repo: string): Promise<string[]> {
  try {
    const names = await fetchTagNamesViaGit(repo);
    if (names.length) return names;
  } catch {
    // 忽略，改用 REST API
  }
  return fetchTagNamesViaApi(repo);
}

function pickLatestTag(names: string[]): SemverParts | null {
  let best: SemverParts | null = null;
  for (const name of names) {
    const parsed = parseSemver(name);
    if (!parsed) continue;
    if (!best || compareSemver(parsed.parts, best.parts) > 0) best = parsed;
  }
  return best;
}

// 发布说明为可选信息，标签式发布可能没有对应的 GitHub Release
async function fetchRelease(repo: string, tag: string): Promise<any | null> {
  try {
    const res = await request(`${API_BASE}/repos/${repo}/releases/tags/${tag}`, {
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      ...authHeaders(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function checkUpdate(force = false): Promise<UpdateCheckResult> {
  const now = Date.now();
  if (!force && cache) {
    const ttl = cache.data.error ? ERROR_TTL : SUCCESS_TTL;
    if (now - cache.at < ttl) return { ...cache.data, cached: true };
  }

  const current = APP_VERSION;
  const repo = UPDATE_REPO;
  const base: UpdateCheckResult = {
    current,
    latest: null,
    latestTag: null,
    hasUpdate: false,
    ahead: false,
    repo,
    releaseUrl: `${WEB_BASE}/${repo}/releases`,
    compareUrl: null,
    publishedAt: null,
    notes: null,
    checkedAt: new Date().toISOString(),
    cached: false,
    error: null,
  };

  let result: UpdateCheckResult;
  try {
    const tagNames = await fetchTagNames(repo);
    const latest = pickLatestTag(tagNames);
    if (!latest) {
      result = { ...base, error: '仓库中还没有版本标签' };
    } else {
      const currentParsed = parseSemver(current);
      const hasUpdate = !!currentParsed && compareSemver(latest.parts, currentParsed.parts) > 0;
      const ahead = !!currentParsed && compareSemver(latest.parts, currentParsed.parts) < 0;

      // 仅当当前版本确实有对应标签时才提供对比链接，避免出现 404
      const currentTags = [`v${current}`, current];
      const currentTag = currentTags.find((t) => tagNames.includes(t)) || null;

      const release = await fetchRelease(repo, latest.raw);
      const releaseUrl = release?.html_url ? String(release.html_url) : `${WEB_BASE}/${repo}/tags`;

      result = {
        ...base,
        latest: latest.version,
        latestTag: latest.raw,
        hasUpdate,
        ahead,
        releaseUrl,
        compareUrl: currentTag ? `${WEB_BASE}/${repo}/compare/${currentTag}...${latest.raw}` : null,
        publishedAt: release?.published_at ? String(release.published_at) : null,
        notes: release?.body ? String(release.body) : null,
      };
    }
  } catch (e: any) {
    result = { ...base, error: e?.message || '检查更新失败' };
  }

  cache = { at: now, data: result };
  return result;
}
