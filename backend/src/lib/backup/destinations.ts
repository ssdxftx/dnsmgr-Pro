import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
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
import { assertUrlAllowed, safeFetch } from '../netGuard.js';

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
  return base.replace(/\/+$/, '') + '/' + encodeURIComponent(name);
}

function basicAuth(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function webdavFetch(cfg: any, url: string, init: RequestInit = {}): Promise<Response> {
  await assertUrlAllowed(url);
  const headers: Record<string, string> = { Authorization: basicAuth(cfg.username, cfg.password), ...(init.headers as any) };
  return safeFetch(url, { ...init, headers });
}

export async function testDestination(row: DestinationRow): Promise<{ ok: boolean; message: string }> {
  try {
    if (row.type === 'webdav') {
      const url = String(row.config.url || '');
      if (!url) return { ok: false, message: '请填写 WebDAV 地址' };
      const res = await webdavFetch(row.config, url, { method: 'PROPFIND', headers: { Depth: '0' } });
      return res.status === 200 || res.status === 207
        ? { ok: true, message: '连接成功' }
        : { ok: false, message: `连接失败（HTTP ${res.status}）` };
    }
    const client = s3Client(row.config);
    await client.send(new ListObjectsV2Command({ Bucket: row.config.bucket, MaxKeys: 1 }));
    return { ok: true, message: '连接成功' };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e).slice(0, 300) };
  }
}

function s3Client(cfg: any): S3Client {
  return new S3Client({
    region: cfg.region || 'us-east-1',
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
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
    const res = await webdavFetch(row.config, joinUrl(String(row.config.url), name), {
      method: 'PUT',
      body: Readable.toWeb(createReadStream(localPath)) as any,
      duplex: 'half',
    } as any);
    if (res.status >= 300) throw new Error(`WebDAV 上传失败（HTTP ${res.status}）`);
    return;
  }
  const client = s3Client(row.config);
  await client.send(
    new PutObjectCommand({ Bucket: row.config.bucket, Key: s3Key(row.config, name), Body: createReadStream(localPath) }),
  );
}

export async function listRemote(destId: number): Promise<RemoteItem[]> {
  const row = await getDestination(destId);
  if (!row) throw new Error('备份目的地不存在');
  if (row.type === 'webdav') {
    const res = await webdavFetch(row.config, String(row.config.url), { method: 'PROPFIND', headers: { Depth: '1' } });
    if (res.status !== 207 && res.status !== 200) throw new Error(`WebDAV 列表失败（HTTP ${res.status}）`);
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
  const client = s3Client(row.config);
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
    const res = await webdavFetch(row.config, joinUrl(String(row.config.url), name), { method: 'GET' });
    if (!res.ok || !res.body) throw new Error(`WebDAV 下载失败（HTTP ${res.status}）`);
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(localPath));
    return;
  }
  const client = s3Client(row.config);
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
    const client = s3Client(row.config);
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
