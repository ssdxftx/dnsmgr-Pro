import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { queryOne, table } from '../../db.js';
import { decryptConfig } from '../secret.js';
import { assertDeployTargetAllowed, assertUrlAllowed, safeFetch } from '../netGuard.js';

export interface DestinationRow {
  id: number;
  name: string;
  type: 'webdav' | 's3';
  config: any;
  enabled: number;
}

export interface RemoteItem {
  name: string;
  size: number;
  modified?: string;
}

export async function getDestination(id: number): Promise<DestinationRow | null> {
  if (!id) return null;
  const row: any = await queryOne(`SELECT * FROM ${table('backup_destination')} WHERE id = ?`, [id]);
  if (!row) return null;
  return { ...row, config: decryptConfig(row.config) || {} };
}

function joinUrl(base: string, name: string): string {
  return base.trim().replace(/\/+$/, '') + '/' + encodeURIComponent(name);
}

function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search : '');
  } catch {
    return url;
  }
}

async function responseSnippet(res: Response): Promise<string> {
  try {
    const text = (await res.text()).replace(/\s+/g, ' ').trim();
    return text ? `：${text.slice(0, 160)}` : '';
  } catch {
    return '';
  }
}

function basicAuth(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function webdavFetch(cfg: any, url: string, init: RequestInit = {}): Promise<Response> {
  await assertUrlAllowed(url);
  const headers: Record<string, string> = { Authorization: basicAuth(cfg.username, cfg.password), ...(init.headers as any) };
  return safeFetch(url, { ...init, headers });
}

interface WebdavDirState {
  ok: boolean;
  status: number;
  detail: string;
  writable: boolean | null;
}

function webdavWritable(xml: string): boolean | null {
  const m = /<(?:[A-Za-z0-9_-]+:)?current-user-privilege-set[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?current-user-privilege-set>/i.exec(xml);
  if (!m) return null;
  return /<(?:[A-Za-z0-9_-]+:)?(?:write|write-content|all)\b/i.test(m[1]);
}

function readonlyError(path: string): Error {
  return new Error(
    `WebDAV 目标目录只读（路径 ${path}）：当前账号没有写入权限，请改填可写目录，例如坚果云的 /dav/我的坚果云/ 或其中的子目录`,
  );
}

// 校验目标地址确实是 WebDAV 目录：仅看 HTTP 200 会把普通网页/反向代理首页误判为可用
async function webdavDirState(cfg: any, url: string): Promise<WebdavDirState> {
  const base = url.trim().replace(/\/+$/, '');
  const res = await webdavFetch(cfg, base || url, { method: 'PROPFIND', headers: { Depth: '0' } });
  if (res.status !== 200 && res.status !== 207) {
    return { ok: false, status: res.status, detail: (await responseSnippet(res)) || '目录不存在或无权访问', writable: null };
  }
  const xml = await res.text();
  // PROPFIND 的 resourcetype 为空表示这是文件，不能作为上传目录
  if (!/<(?:[A-Za-z0-9_-]+:)?collection[\s/>]/i.test(xml)) {
    return { ok: false, status: res.status, detail: '该地址指向文件或不是 WebDAV 目录，请填写目录地址', writable: null };
  }
  return { ok: true, status: res.status, detail: '', writable: webdavWritable(xml) };
}

async function ensureWebdavDir(cfg: any, url: string): Promise<WebdavDirState> {
  const state = await webdavDirState(cfg, url);
  if (state.ok || state.status !== 404) return state;
  const base = url.trim().replace(/\/+$/, '');
  const res = await webdavFetch(cfg, base + '/', { method: 'MKCOL' });
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, detail: '', writable: null };
  // MKCOL 返回 405 通常表示目录已被并发创建，交给后续写入判断
  if (res.status === 405) return { ok: true, status: res.status, detail: '', writable: null };
  return { ok: false, status: res.status, detail: (await responseSnippet(res)) || '创建目录失败', writable: null };
}

async function webdavPut(cfg: any, url: string, localPath: string): Promise<Response> {
  const size = (await stat(localPath)).size;
  return webdavFetch(cfg, url, {
    method: 'PUT',
    headers: { 'Content-Length': String(size), 'Content-Type': 'application/octet-stream' },
    body: Readable.toWeb(createReadStream(localPath)) as any,
    duplex: 'half',
  } as any);
}

export async function testDestination(row: DestinationRow): Promise<{ ok: boolean; message: string }> {
  try {
    if (row.type === 'webdav') {
      const url = String(row.config.url || '');
      if (!url) return { ok: false, message: '请填写 WebDAV 地址' };
      const dir = await ensureWebdavDir(row.config, url);
      if (!dir.ok) return { ok: false, message: `连接失败（HTTP ${dir.status}）：${dir.detail}` };
      if (dir.writable === false) {
        return {
          ok: false,
          message: `目录只读：当前账号没有写入权限，请改填可写目录（坚果云请使用 /dav/我的坚果云/ 或其中的子目录）`,
        };
      }
      // 只做 PROPFIND 无法发现「可读不可写」，用一次真实写入探测
      const probeUrl = joinUrl(url, `.dnsmgr-write-test-${randomBytes(4).toString('hex')}`);
      const put = await webdavFetch(row.config, probeUrl, {
        method: 'PUT',
        headers: { 'Content-Length': '2', 'Content-Type': 'text/plain' },
        body: 'ok',
      });
      if (put.status >= 300) {
        return { ok: false, message: `目录可读但无法写入（HTTP ${put.status}）${await responseSnippet(put)}` };
      }
      await webdavFetch(row.config, probeUrl, { method: 'DELETE' }).catch(() => undefined);
      return { ok: true, message: '连接成功（可读写）' };
    }
    const client = await s3Client(row.config);
    await client.send(new ListObjectsV2Command({ Bucket: row.config.bucket, MaxKeys: 1 }));
    return { ok: true, message: '连接成功' };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e).slice(0, 300) };
  }
}

async function s3Client(cfg: any): Promise<S3Client> {
  // 自建 S3 常在内网，允许内网目标但拒绝链路本地/云元数据地址
  if (cfg.endpoint) await assertDeployTargetAllowed(String(cfg.endpoint));
  return new S3Client({
    region: cfg.region || 'us-east-1',
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // 关闭默认的 CRC 校验：新版 SDK 会对流式上传启用 aws-chunked，
    // 部分 S3 兼容实现（MinIO/R2/自建网关）会把分块头写进对象，导致归档损坏
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function s3Key(cfg: any, name: string): string {
  const prefix = String(cfg.prefix || '').replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${name}` : name;
}

export async function uploadToDestination(destId: number, localPath: string, name: string): Promise<void> {
  const row = await getDestination(destId);
  if (!row) throw new Error('备份目的地不存在');
  if (row.type === 'webdav') {
    const base = String(row.config.url || '');
    if (!base) throw new Error('请填写 WebDAV 地址');
    const fileUrl = joinUrl(base, name);
    let res = await webdavPut(row.config, fileUrl, localPath);
    // 目标目录可能尚未创建（或服务端要求目录以 / 结尾），先补建目录再重试一次
    if (res.status === 404 || res.status === 409) {
      const state = await webdavDirState(row.config, base);
      if (state.writable === false) throw readonlyError(urlPath(base));
      const dir = state.ok ? state : await ensureWebdavDir(row.config, base);
      if (dir.writable === false) throw readonlyError(urlPath(base));
      if (dir.ok) res = await webdavPut(row.config, fileUrl, localPath);
      else throw new Error(`WebDAV 上传失败（HTTP ${res.status}，路径 ${urlPath(fileUrl)}）：${dir.detail}`);
    }
    if (res.status >= 300) {
      throw new Error(`WebDAV 上传失败（HTTP ${res.status}，路径 ${urlPath(fileUrl)}）${await responseSnippet(res)}`);
    }
    return;
  }
  const size = (await stat(localPath)).size;
  const client = await s3Client(row.config);
  await client.send(
    new PutObjectCommand({
      Bucket: row.config.bucket,
      Key: s3Key(row.config, name),
      Body: createReadStream(localPath),
      // 显式长度：缺省时 SDK 使用 aws-chunked，部分兼容实现会把分块头写进对象导致文件损坏
      ContentLength: size,
    }),
  );
}

export async function listRemote(destId: number): Promise<RemoteItem[]> {
  const row = await getDestination(destId);
  if (!row) throw new Error('备份目的地不存在');
  if (row.type === 'webdav') {
    const res = await webdavFetch(row.config, String(row.config.url), { method: 'PROPFIND', headers: { Depth: '1' } });
    if (res.status !== 207 && res.status !== 200) {
      throw new Error(`WebDAV 列表失败（HTTP ${res.status}，路径 ${urlPath(String(row.config.url))}）${await responseSnippet(res)}`);
    }
    const xml = await res.text();
    const items: RemoteItem[] = [];
    const re = /<(?:d:)?response>([\s\S]*?)<\/(?:d:)?response>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const block = m[1];
      const href = /<(?:d:)?href>([^<]+)<\/(?:d:)?href>/i.exec(block)?.[1] || '';
      const name = decodeURIComponent(href.split('/').filter(Boolean).pop() || '');
      if (!name || !name.endsWith('.dnsmgrbk')) continue;
      const size = Number(/<(?:d:)?getcontentlength>(\d+)</i.exec(block)?.[1] || 0);
      const modified = /<(?:d:)?getlastmodified>([^<]+)</i.exec(block)?.[1];
      items.push({ name, size, modified });
    }
    return items;
  }
  const client = await s3Client(row.config);
  const prefix = String(row.config.prefix || '').replace(/^\/+|\/+$/g, '');
  const res = await client.send(new ListObjectsV2Command({ Bucket: row.config.bucket, Prefix: prefix || undefined }));
  return (res.Contents || [])
    .filter((o) => String(o.Key || '').endsWith('.dnsmgrbk'))
    .map((o) => ({
      name: String(o.Key || '').split('/').pop() || '',
      size: Number(o.Size || 0),
      modified: o.LastModified?.toISOString(),
    }));
}

export async function downloadRemote(destId: number, name: string, localPath: string): Promise<void> {
  const row = await getDestination(destId);
  if (!row) throw new Error('备份目的地不存在');
  if (row.type === 'webdav') {
    const url = joinUrl(String(row.config.url), name);
    const res = await webdavFetch(row.config, url, { method: 'GET' });
    if (res.status === 404) throw new Error(`WebDAV 下载失败：远端文件不存在（${urlPath(url)}）`);
    if (!res.ok || !res.body) {
      throw new Error(`WebDAV 下载失败（HTTP ${res.status}，路径 ${urlPath(url)}）${await responseSnippet(res)}`);
    }
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(localPath));
    return;
  }
  const client = await s3Client(row.config);
  const res = await client.send(new GetObjectCommand({ Bucket: row.config.bucket, Key: s3Key(row.config, name) }));
  if (!res.Body) throw new Error('S3 下载失败');
  await pipeline(res.Body as any, createWriteStream(localPath));
}

export async function deleteRemote(destId: number, name: string): Promise<void> {
  const row = await getDestination(destId);
  if (!row) return;
  try {
    if (row.type === 'webdav') {
      await webdavFetch(row.config, joinUrl(String(row.config.url), name), { method: 'DELETE' });
      return;
    }
    const client = await s3Client(row.config);
    await client.send(new DeleteObjectCommand({ Bucket: row.config.bucket, Key: s3Key(row.config, name) }));
  } catch {
    // 远端删除失败不应阻断本地清理
  }
}

export async function readLocal(file: string): Promise<Buffer> {
  return readFile(file);
}

export async function removeLocal(file: string): Promise<void> {
  await unlink(file).catch(() => undefined);
}

export function localBackupPath(fileName: string): string {
  const base = path.basename(String(fileName || ''));
  if (!base || base !== fileName) throw new Error('非法的备份文件名');
  return path.join(process.env.DNSMGR_DATA_DIR || path.resolve(process.cwd(), 'data'), 'backups', base);
}
