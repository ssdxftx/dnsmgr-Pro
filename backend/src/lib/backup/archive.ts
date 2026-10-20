import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createGzip, createGunzip } from 'node:zlib';
import { APP_VERSION } from '../version.js';

export const MAGIC = Buffer.from('DNSMGRBK', 'utf8');
export const FORMAT_VERSION = 1;
const TAG_LEN = 16;
const IMPORT_TMP_TTL_MS = 3600_000;
const MAX_IMPORT_JSON_BYTES = Number(process.env.DNSMGR_MAX_IMPORT_BYTES || 512 * 1024 * 1024);

export function dataRoot(): string {
  return process.env.DNSMGR_DATA_DIR || path.resolve(process.cwd(), 'data');
}

export function backupsDir(): string {
  return path.join(dataRoot(), 'backups');
}

export function tmpDir(): string {
  return path.join(dataRoot(), 'tmp');
}

export async function ensureDataDirs(): Promise<void> {
  await mkdir(backupsDir(), { recursive: true });
  await mkdir(tmpDir(), { recursive: true });
}

export interface ArchiveTableChunk {
  name: string;
  columns: string[];
  rows: Record<string, any>[];
}

export interface ArchiveDraft {
  header: Record<string, any>;
  /** 逐表产出，写入时按表流式输出，避免一次性 JSON.stringify 全量数据 */
  tables: () => AsyncGenerator<ArchiveTableChunk>;
}

export interface ArchiveStats {
  tables: Record<string, { rows: number; columns: string[] }>;
  vault?: Record<string, any>;
}

export interface WriteResult {
  size: number;
  checksum: string;
  plainSize: number;
  stats: ArchiveStats;
}

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

export function keyCheck(key: Buffer): Buffer {
  return createHmac('sha256', key).update('dnsmgr-backup').digest().subarray(0, 16);
}

/** 归档头签名：覆盖除 sig 外的全部字段，防止 scope/ownerUid 等元数据被篡改 */
function headerSignature(key: Buffer, header: Record<string, any>): Buffer {
  const { sig: _sig, ...rest } = header;
  return createHmac('sha256', key).update(JSON.stringify(rest)).digest();
}

/** 生成归档文件名：<scope>-<yyyyMMdd-HHmmss>-<rand>.dnsmgrbk */
export function archiveFileName(scope: string, at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `${scope}-${ts}-${randomBytes(3).toString('hex')}.dnsmgrbk`;
}

export function resolveArchivePath(fileName: string): string {
  // 只接受纯文件名，杜绝 ../ 穿越
  const base = path.basename(String(fileName || ''));
  if (!base || base !== fileName) throw new Error('非法的备份文件名');
  return path.join(backupsDir(), base);
}

async function writeChunk(ws: NodeJS.WritableStream, text: string): Promise<void> {
  if (!ws.write(text)) {
    await new Promise<void>((resolve) => ws.once('drain', resolve));
  }
}

/**
 * 写归档：先 gzip 明文到临时文件（同时算 checksum），再写文件头并加密到目标文件，最后追加 GCM tag。
 * tag 放文件末尾，因为只有加密结束才知道 tag；读取时最后 16 字节即 tag。
 */
export async function writeArchive(draft: ArchiveDraft, key: Buffer, outPath: string): Promise<WriteResult> {
  await ensureDataDirs();
  const tmp = outPath + '.tmp';
  const stats: ArchiveStats = { tables: {} };
  const hash = createHash('sha256');
  let size = 0;

  const gz = createGzip({ level: 6 });
  const ws = createWriteStream(tmp);
  gz.on('data', (c: Buffer) => {
    hash.update(c);
    size += c.length;
  });
  gz.pipe(ws);

  await writeChunk(gz, '{"header":' + JSON.stringify(draft.header) + ',"tables":{');
  let firstTable = true;
  for await (const t of draft.tables()) {
    stats.tables[t.name] = { rows: t.rows.length, columns: t.columns };
    if (!firstTable) await writeChunk(gz, ',');
    firstTable = false;
    await writeChunk(gz, JSON.stringify(t.name) + ':{"rows":' + t.rows.length + ',"columns":' + JSON.stringify(t.columns) + ',"data":[');
    for (let i = 0; i < t.rows.length; i++) {
      if (i) await writeChunk(gz, ',');
      await writeChunk(gz, JSON.stringify(t.rows[i]));
    }
    await writeChunk(gz, ']}');
  }
  if (draft.header.vault) stats.vault = draft.header.vault;
  await writeChunk(gz, '}}');
  gz.end();
  await new Promise<void>((resolve, reject) => {
    ws.once('finish', resolve);
    ws.once('error', reject);
    gz.once('error', reject);
  });

  const checksum = hash.digest('hex');
  const iv = randomBytes(12);
  const header: Record<string, any> = {
    ...draft.header,
    formatVersion: FORMAT_VERSION,
    appVersion: APP_VERSION,
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    check: keyCheck(key).toString('base64'),
    plainSize: size,
    checksum,
    ...stats,
  };
  header.sig = headerSignature(key, header).toString('base64');
  const headerBuf = Buffer.from(JSON.stringify(header), 'utf8');

  const fd = await open(outPath, 'w');
  try {
    await fd.write(Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), u32le(headerBuf.length), headerBuf]));
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const rs = createReadStream(tmp);
    for await (const chunk of rs) {
      const enc = cipher.update(chunk as Buffer);
      if (enc.length) await fd.write(enc);
    }
    const tail = cipher.final();
    if (tail.length) await fd.write(tail);
    await fd.write(cipher.getAuthTag());
  } finally {
    await fd.close();
  }
  await unlink(tmp).catch(() => undefined);
  const st = await stat(outPath);
  return { size: st.size, checksum, plainSize: size, stats };
}

export interface ArchiveHeader {
  formatVersion: number;
  appVersion?: string;
  createdAt?: string;
  scope?: string;
  kdf?: { algo: string; salt?: string | null };
  cipher?: string;
  iv: string;
  check: string;
  sig?: string;
  plainSize?: number;
  checksum?: string;
  tables?: Record<string, { rows: number; columns: string[] }>;
  vault?: Record<string, any>;
  [k: string]: any;
}

export interface OpenedHeader {
  header: ArchiveHeader;
  headerEnd: number;
  fileSize: number;
}

export async function readArchiveHeader(file: string): Promise<OpenedHeader> {
  const st = await stat(file);
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(13);
    const { bytesRead } = await fh.read(head, 0, 13, 0);
    if (bytesRead < 13) throw new Error('文件过小，不是有效的备份归档');
    if (!head.subarray(0, 8).equals(MAGIC)) throw new Error('文件格式不正确，不是 dnsmgr 备份归档');
    const ver = head.readUInt8(8);
    if (ver !== FORMAT_VERSION) throw new Error(`不支持的备份格式版本：${ver}`);
    const headerLen = head.readUInt32LE(9);
    if (headerLen <= 0 || headerLen > 4 * 1024 * 1024 || 13 + headerLen + TAG_LEN > st.size) {
      throw new Error('备份文件头损坏');
    }
    const hb = Buffer.alloc(headerLen);
    await fh.read(hb, 0, headerLen, 13);
    let header: ArchiveHeader;
    try {
      header = JSON.parse(hb.toString('utf8'));
    } catch {
      throw new Error('备份文件头损坏');
    }
    return { header, headerEnd: 13 + headerLen, fileSize: st.size };
  } finally {
    await fh.close();
  }
}

/** 校验密钥：HMAC 比对失败时直接报「备份密钥错误」，避免误报文件损坏 */
export function verifyArchiveKey(header: ArchiveHeader, key: Buffer): void {
  const expect = keyCheck(key);
  const got = Buffer.from(String(header.check || ''), 'base64');
  if (got.length !== expect.length || !got.equals(expect)) {
    throw new Error('备份密钥错误');
  }
  // 兼容旧归档：无 sig 时只做密钥校验；新归档必须通过头签名校验
  if (header.sig) {
    const want = headerSignature(key, header);
    const gotSig = Buffer.from(String(header.sig), 'base64');
    if (gotSig.length !== want.length || !timingSafeEqual(gotSig, want)) {
      throw new Error('归档头校验失败，文件可能被篡改');
    }
  }
}

export interface OpenedArchive {
  header: ArchiveHeader;
  tableNames: string[];
  readTable: (name: string) => { rows: number; columns: string[]; data: any[] } | null;
  dispose: () => Promise<void>;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t')) i++;
  return i;
}

/** 从 i（指向值的首字符）返回该 JSON 值的结束位置（不含） */
function scanValueEnd(s: string, i: number): number {
  const c = s[i];
  if (c === '"') {
    i++;
    while (i < s.length) {
      if (s[i] === '\\') i += 2;
      else if (s[i] === '"') return i + 1;
      else i++;
    }
    throw new Error('备份 JSON 损坏（字符串未闭合）');
  }
  if (c === '{' || c === '[') {
    const open = c;
    const close = c === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (ch === '\\') i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    throw new Error('备份 JSON 损坏（括号未闭合）');
  }
  // 数字 / true / false / null
  while (i < s.length && !',}] \n\r\t'.includes(s[i])) i++;
  return i;
}

/** 解析对象内的键值位置：返回 key -> [valueStart, valueEnd] */
function objectMembers(s: string, objStart: number): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  let i = skipWs(s, objStart);
  if (s[i] !== '{') throw new Error('备份 JSON 结构异常');
  i++;
  for (;;) {
    i = skipWs(s, i);
    if (s[i] === '}') return out;
    if (s[i] !== '"') throw new Error('备份 JSON 结构异常');
    const keyEnd = scanValueEnd(s, i);
    const key = JSON.parse(s.slice(i, keyEnd));
    i = skipWs(s, keyEnd);
    if (s[i] !== ':') throw new Error('备份 JSON 结构异常');
    i = skipWs(s, i + 1);
    const valEnd = scanValueEnd(s, i);
    out.set(String(key), [i, valEnd]);
    i = skipWs(s, valEnd);
    if (s[i] === ',') i++;
  }
}

/** 清理异常退出遗留的导入临时文件（含全站明文凭据），避免长期驻留数据卷 */
async function cleanStaleImportFiles(): Promise<void> {
  const dir = tmpDir();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.startsWith('import-') || !name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const st = await stat(file);
      if (now - st.mtimeMs > IMPORT_TMP_TTL_MS) await unlink(file);
    } catch {
      /* 已被并发清理或无权访问，忽略 */
    }
  }
}

/** 解密 + 解压到临时文件，供按表解析；调用方负责 dispose */
export async function openArchive(file: string, key: Buffer): Promise<OpenedArchive> {
  const { header, headerEnd, fileSize } = await readArchiveHeader(file);
  verifyArchiveKey(header, key);

  await ensureDataDirs();
  await cleanStaleImportFiles();
  const tmp = path.join(tmpDir(), `import-${randomBytes(6).toString('hex')}.json`);
  const hash = createHash('sha256');
  const rs = createReadStream(file, { start: headerEnd, end: fileSize - TAG_LEN - 1 });
  // 摘要必须对「解密后的 gzip 字节」计算，与写入端 gz 输出一致；
  // 用 Transform 旁路计算：直接监听 data 会把流切到 flowing 模式，导致管道丢块
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
  dec.setAuthTag(Buffer.from((await readTag(file, fileSize)), 'base64'));
  const gunzip = createGunzip();
  // 解压后累计字节上限，防止高压缩比归档打满磁盘
  let unpacked = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      unpacked += chunk.length;
      if (unpacked > MAX_IMPORT_JSON_BYTES) {
        cb(new Error('解压内容超过允许上限'));
        return;
      }
      cb(null, chunk);
    },
  });
  const ws = createWriteStream(tmp, { mode: 0o600 });
  try {
    await pipeline(rs, dec, tap, gunzip, limiter, ws);
  } catch (e: any) {
    await unlink(tmp).catch(() => undefined);
    throw new Error('文件校验失败：' + (e?.message || '解密失败'));
  }
  const checksum = hash.digest('hex');
  if (header.checksum && checksum !== header.checksum) {
    await unlink(tmp).catch(() => undefined);
    throw new Error('文件校验失败：内容摘要不一致');
  }

  const json = await readFile(tmp, 'utf8');
  const top = objectMembers(json, skipWs(json, 0));
  const tablesRange = top.get('tables');
  if (!tablesRange) throw new Error('备份内容缺少数据表');
  const members = objectMembers(json, tablesRange[0]);
  const tableNames = [...members.keys()];

  return {
    header,
    tableNames,
    readTable: (name: string) => {
      const r = members.get(name);
      if (!r) return null;
      return JSON.parse(json.slice(r[0], r[1]));
    },
    dispose: async () => {
      await unlink(tmp).catch(() => undefined);
    },
  };
}

async function readTag(file: string, fileSize: number): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(TAG_LEN);
    await fh.read(buf, 0, TAG_LEN, fileSize - TAG_LEN);
    return buf.toString('base64');
  } finally {
    await fh.close();
  }
}
