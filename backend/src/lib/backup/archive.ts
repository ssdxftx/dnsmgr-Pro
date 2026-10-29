import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { markTempActive, markTempDone } from './tmpRegistry.js';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createGzip, createGunzip } from 'node:zlib';
import { APP_VERSION } from '../version.js';

export const MAGIC = Buffer.from('DNSMGRBK', 'utf8');
export const FORMAT_VERSION = 1;
const TAG_LEN = 16;
const IMPORT_TMP_TTL_MS = 3600_000;
const MAX_IMPORT_JSON_BYTES = Number(process.env.DNSMGR_MAX_IMPORT_BYTES || 128 * 1024 * 1024);
// 旧格式归档没有头签名，scope/ownerUid 可被篡改；默认拒绝，仅在明确信任旧文件时通过环境变量临时放行
const ALLOW_LEGACY_ARCHIVE = String(process.env.DNSMGR_ALLOW_LEGACY_BACKUP || '').trim() === '1';

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
  /** 行迭代器：导出端按主键分页产出，写入端逐行序列化，避免整表读入内存 */
  rows: Iterable<Record<string, any>> | AsyncIterable<Record<string, any>>;
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
  // 只接受纯文件名，杜绝 ../ 穿越；'..' 经 basename 后仍等于自身，必须显式拒绝
  const base = path.basename(String(fileName || ''));
  if (!base || base === '.' || base === '..' || base !== fileName) throw new Error('非法的备份文件名');
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
  markTempActive(tmp);
  const stats: ArchiveStats = { tables: {} };
  const hash = createHash('sha256');
  let size = 0;
  let checksum = '';

  const gz = createGzip({ level: 6 });
  const ws = createWriteStream(tmp, { mode: 0o600 });
  try {
    gz.on('data', (c: Buffer) => {
      hash.update(c);
      size += c.length;
    });
    gz.pipe(ws);

    await writeChunk(gz, '{"header":' + JSON.stringify(draft.header) + ',"tables":{');
    let firstTable = true;
    for await (const t of draft.tables()) {
      if (!firstTable) await writeChunk(gz, ',');
      firstTable = false;
      // data 必须边读边写；行数只有写完才知道，因此把 rows 统计放到 data 之后。
      // 导入端按字段名解析，字段顺序不影响兼容性。
      await writeChunk(gz, JSON.stringify(t.name) + ':{"columns":' + JSON.stringify(t.columns) + ',"data":[');
      let rowCount = 0;
      for await (const row of t.rows) {
        if (rowCount) await writeChunk(gz, ',');
        await writeChunk(gz, JSON.stringify(row));
        rowCount++;
      }
      stats.tables[t.name] = { rows: rowCount, columns: t.columns };
      await writeChunk(gz, '],"rows":' + rowCount + '}');
    }
    if (draft.header.vault) stats.vault = draft.header.vault;
    await writeChunk(gz, '}}');
    gz.end();
    await new Promise<void>((resolve, reject) => {
      ws.once('finish', resolve);
      ws.once('error', reject);
      gz.once('error', reject);
    });

    checksum = hash.digest('hex');
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
  } finally {
    // 无论成功失败都清理包含明文的 gzip 临时文件
    await unlink(tmp).catch(() => undefined);
    markTempDone(tmp);
  }
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
  // 恒定时间比较，避免通过响应时间侧信道逐字节猜测校验值
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) {
    throw new Error('备份密钥错误');
  }
  // 新归档必须通过头签名校验；无 sig 的旧归档默认拒绝，避免 scope/ownerUid 被篡改
  if (!header.sig) {
    if (!ALLOW_LEGACY_ARCHIVE) {
      throw new Error('备份归档缺少头部签名，已拒绝导入；如确认文件可信，可设置 DNSMGR_ALLOW_LEGACY_BACKUP=1 后重试');
    }
    return;
  }
  const want = headerSignature(key, header);
  const gotSig = Buffer.from(String(header.sig), 'base64');
  if (gotSig.length !== want.length || !timingSafeEqual(gotSig, want)) {
    throw new Error('归档头校验失败，文件可能被篡改');
  }
}

export interface OpenedArchive {
  header: ArchiveHeader;
  tableNames: string[];
  readTable: (name: string) => AsyncGenerator<Record<string, any>> | null;
  dispose: () => Promise<void>;
}

type FileHandle = Awaited<ReturnType<typeof open>>;

/** 按字节读取临时 JSON 文件，避免把整个解压结果读进内存 */
class ByteCursor {
  private buf = Buffer.alloc(0);
  private pos = 0;
  private bufStart = 0;
  private nextRead = 0;
  private eof = false;
  private fh: FileHandle;
  private start: number;
  private end: number;

  constructor(fh: FileHandle, start: number, end: number) {
    this.fh = fh;
    this.start = start;
    this.end = end;
    this.bufStart = start;
    this.nextRead = start;
  }

  private async fill(): Promise<void> {
    if (this.pos < this.buf.length) return;
    if (this.eof || this.nextRead >= this.end) {
      this.eof = true;
      this.buf = Buffer.alloc(0);
      this.pos = 0;
      return;
    }
    const size = Math.min(64 * 1024, this.end - this.nextRead);
    const b = Buffer.allocUnsafe(size);
    const { bytesRead } = await this.fh.read(b, 0, size, this.nextRead);
    if (!bytesRead) {
      this.eof = true;
      this.buf = Buffer.alloc(0);
      this.pos = 0;
      return;
    }
    this.buf = b.subarray(0, bytesRead);
    this.bufStart = this.nextRead;
    this.nextRead += bytesRead;
    this.pos = 0;
  }

  async peek(): Promise<number> {
    await this.fill();
    return this.pos < this.buf.length ? this.buf[this.pos] : -1;
  }

  async read(): Promise<number> {
    const c = await this.peek();
    if (c >= 0) this.pos++;
    return c;
  }

  offset(): number {
    return this.bufStart + this.pos;
  }

  async skipWs(): Promise<void> {
    for (;;) {
      await this.fill();
      if (this.pos >= this.buf.length) {
        if (this.eof) return;
        continue;
      }
      while (this.pos < this.buf.length) {
        const c = this.buf[this.pos];
        if (c !== 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) return;
        this.pos++;
      }
      if (this.eof) return;
    }
  }

  async expect(ch: number): Promise<void> {
    await this.skipWs();
    if ((await this.read()) !== ch) throw new Error('备份 JSON 结构异常');
  }

  /** 跳过一段复合值（对象/数组），按块扫描，避免逐字节分配 Buffer */
  async scanComposite(open: number): Promise<void> {
    const close = open === 0x7b ? 0x7d : 0x5d;
    let depth = 1;
    let inStr = false;
    let escaped = false;
    for (;;) {
      await this.fill();
      if (this.pos >= this.buf.length) {
        if (this.eof) throw new Error('备份 JSON 损坏（括号未闭合）');
        continue;
      }
      const start = this.pos;
      for (let i = start; i < this.buf.length; i++) {
        const c = this.buf[i];
        if (inStr) {
          if (escaped) escaped = false;
          else if (c === 0x5c) escaped = true;
          else if (c === 0x22) inStr = false;
          continue;
        }
        if (c === 0x22) inStr = true;
        else if (c === open) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) {
            this.pos = i + 1;
            return;
          }
        }
      }
      this.pos = this.buf.length;
    }
  }

  /** 读取一个完整 JSON 值，返回原始字节（用于逐行 JSON.parse） */
  async readRawValue(): Promise<Buffer> {
    await this.skipWs();
    const first = await this.read();
    if (first < 0) throw new Error('备份 JSON 提前结束');
    if (first === 0x22) return this.readStringBytes(first);
    if (first === 0x7b || first === 0x5b) return this.readCompositeBytes(first);
    return this.readScalarBytes(first);
  }

  private async readStringBytes(first: number): Promise<Buffer> {
    const parts: Buffer[] = [Buffer.from([first])];
    let escaped = false;
    for (;;) {
      await this.fill();
      if (this.pos >= this.buf.length) {
        if (this.eof) throw new Error('备份 JSON 损坏（字符串未闭合）');
        continue;
      }
      const start = this.pos;
      for (let i = start; i < this.buf.length; i++) {
        const c = this.buf[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (c === 0x5c) {
          escaped = true;
          continue;
        }
        if (c === 0x22) {
          this.pos = i + 1;
          parts.push(this.buf.subarray(start, i + 1));
          return Buffer.concat(parts);
        }
      }
      this.pos = this.buf.length;
      parts.push(this.buf.subarray(start, this.buf.length));
      if (this.eof) throw new Error('备份 JSON 损坏（字符串未闭合）');
    }
  }

  private async readCompositeBytes(open: number): Promise<Buffer> {
    const close = open === 0x7b ? 0x7d : 0x5d;
    const parts: Buffer[] = [Buffer.from([open])];
    let depth = 1;
    let inStr = false;
    let escaped = false;
    for (;;) {
      await this.fill();
      if (this.pos >= this.buf.length) {
        if (this.eof) throw new Error('备份 JSON 损坏（括号未闭合）');
        continue;
      }
      const start = this.pos;
      for (let i = start; i < this.buf.length; i++) {
        const c = this.buf[i];
        if (inStr) {
          if (escaped) escaped = false;
          else if (c === 0x5c) escaped = true;
          else if (c === 0x22) inStr = false;
          continue;
        }
        if (c === 0x22) inStr = true;
        else if (c === open) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) {
            this.pos = i + 1;
            parts.push(this.buf.subarray(start, i + 1));
            return Buffer.concat(parts);
          }
        }
      }
      this.pos = this.buf.length;
      parts.push(this.buf.subarray(start, this.buf.length));
      if (this.eof) throw new Error('备份 JSON 损坏（括号未闭合）');
    }
  }

  private async readScalarBytes(first: number): Promise<Buffer> {
    const parts: Buffer[] = [Buffer.from([first])];
    for (;;) {
      await this.fill();
      if (this.pos >= this.buf.length) {
        if (this.eof) return Buffer.concat(parts);
        continue;
      }
      const start = this.pos;
      let i = start;
      while (i < this.buf.length) {
        const c = this.buf[i];
        if (c === 0x2c || c === 0x7d || c === 0x5d || c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) break;
        i++;
      }
      if (i > start) {
        this.pos = i;
        parts.push(this.buf.subarray(start, i));
      }
      if (i < this.buf.length) return Buffer.concat(parts);
      this.pos = this.buf.length;
      if (this.eof) return Buffer.concat(parts);
    }
  }

  async readString(): Promise<string> {
    const raw = await this.readRawValue();
    return String(JSON.parse(raw.toString('utf8')));
  }

  async skipValue(): Promise<void> {
    await this.readRawValue();
  }
}

async function eachObjectMember(cur: ByteCursor, fn: (key: string) => Promise<void>): Promise<void> {
  await cur.expect(0x7b);
  for (;;) {
    await cur.skipWs();
    const c = await cur.peek();
    if (c === 0x7d) {
      await cur.read();
      return;
    }
    if (c === 0x2c) {
      await cur.read();
      continue;
    }
    const key = await cur.readString();
    await cur.expect(0x3a);
    await fn(key);
  }
}

interface TableRange {
  start: number;
  end: number;
}

async function buildTableIndex(file: string): Promise<{ ranges: Map<string, TableRange>; names: string[] }> {
  const st = await stat(file);
  const fh = await open(file, 'r');
  const ranges = new Map<string, TableRange>();
  const names: string[] = [];
  const cur = new ByteCursor(fh, 0, st.size);
  try {
    await eachObjectMember(cur, async (topKey) => {
      if (topKey !== 'tables') {
        await cur.skipValue();
        return;
      }
      await eachObjectMember(cur, async (table) => {
        names.push(table);
        await eachObjectMember(cur, async (field) => {
          if (field !== 'data') {
            await cur.skipValue();
            return;
          }
          await cur.skipWs();
          const start = cur.offset();
          if ((await cur.read()) !== 0x5b) throw new Error('备份 JSON 结构异常');
          await cur.scanComposite(0x5b);
          ranges.set(table, { start, end: cur.offset() });
        });
      });
    });
  } finally {
    await fh.close();
  }
  return { ranges, names };
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

async function* readTableRows(file: string, range: TableRange | undefined): AsyncGenerator<Record<string, any>> {
  if (!range) return;
  const fh = await open(file, 'r');
  const cur = new ByteCursor(fh, range.start + 1, range.end - 1);
  try {
    for (;;) {
      await cur.skipWs();
      const c = await cur.peek();
      if (c < 0 || c === 0x5d) return;
      if (c === 0x2c) {
        await cur.read();
        continue;
      }
      const raw = await cur.readRawValue();
      yield JSON.parse(raw.toString('utf8'));
    }
  } finally {
    await fh.close();
  }
}

export async function openArchive(file: string, key: Buffer): Promise<OpenedArchive> {
  const { header, headerEnd, fileSize } = await readArchiveHeader(file);
  verifyArchiveKey(header, key);

  await ensureDataDirs();
  await cleanStaleImportFiles();
  const tmp = path.join(tmpDir(), `import-${randomBytes(6).toString('hex')}.json`);
  // 登记为使用中，避免 1 小时清理任务在导入过程中删掉解压后的明文 JSON
  markTempActive(tmp);
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
    markTempDone(tmp);
    await unlink(tmp).catch(() => undefined);
    throw new Error('文件校验失败：' + (e?.message || '解密失败'));
  }
  const checksum = hash.digest('hex');
  if (header.checksum && checksum !== header.checksum) {
    markTempDone(tmp);
    await unlink(tmp).catch(() => undefined);
    throw new Error('文件校验失败：内容摘要不一致');
  }

  let index: { ranges: Map<string, TableRange>; names: string[] };
  try {
    index = await buildTableIndex(tmp);
  } catch (e) {
    markTempDone(tmp);
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
  const { ranges, names } = index;
  if (!names.length) {
    markTempDone(tmp);
    await unlink(tmp).catch(() => undefined);
    throw new Error('备份内容缺少数据表');
  }

  return {
    header,
    tableNames: names,
    readTable: (name: string) => (names.includes(name) ? readTableRows(tmp, ranges.get(name)) : null),
    dispose: async () => {
      markTempDone(tmp);
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
