import { mkdtemp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { openArchive, readArchiveHeader, writeArchive } from '../src/lib/backup/archive.js';
import { importArchive } from '../src/lib/backup/import.js';
import { decodeStoredValue, encodeRow } from '../src/lib/backup/manifest.js';
import { decryptWithDek, deriveKek, encryptWithDek, newDek, unwrapDek, wrapDek } from '../src/lib/vault/keys.js';

function assert(cond: any, msg: string): void {
  if (!cond) {
    console.error('失败：' + msg);
    process.exit(1);
  }
  console.log('通过：' + msg);
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'dnsmgr-backup-check-'));
process.env.DNSMGR_DATA_DIR = dir;
const key = randomBytes(32);
const out = path.join(dir, 'site-test.dnsmgrbk');

const userCols = ['id', 'username', 'blob', 'cfg'];
const users = [
  { id: 1, username: 'admin', blob: Buffer.from('secret-bytes'), cfg: 'enc:u1:aaa:bbb:ccc' },
  { id: 2, username: 'bob', blob: Buffer.alloc(0), cfg: null },
];
const domainCols = ['id', 'name', 'note'];

const written = await writeArchive(
  {
    header: { scope: 'site', createdAt: '2026-10-20 00:00:00' },
    tables: async function* () {
      yield { name: 'user', columns: userCols, rows: users.map((r) => encodeRow(r, userCols)) };
      yield {
        name: 'domain',
        columns: domainCols,
        rows: [{ id: 1, name: 'a.example.com', note: '包含 } 和 ] 的字符串' }],
      };
    },
  },
  key,
  out,
);

assert(written.size > 0, '归档写入非空');
assert(written.stats.tables.user.rows === 2, 'header 记录 user 行数');

const head = await readArchiveHeader(out);
assert(head.header.tables?.user?.rows === 2, '文件头可读取行数');
assert(head.header.scope === 'site', '文件头保留 scope');

const opened = await openArchive(out, key);
const userRows: any[] = [];
for await (const row of opened.readTable('user')!) userRows.push(row);
assert(userRows.length === 2, '解析 user 表');
assert(Buffer.from(userRows[0].blob.__b64, 'base64').toString() === 'secret-bytes', 'Buffer 以 base64 往返');
assert(userRows[0].cfg === 'enc:u1:aaa:bbb:ccc', 'enc:u1: 密文原样保留');
const domainRows: any[] = [];
for await (const row of opened.readTable('domain')!) domainRows.push(row);
assert(domainRows[0].note === '包含 } 和 ] 的字符串', '字符串中的括号不影响按表解析');
assert(decodeStoredValue(userRows[0].blob).toString() === 'secret-bytes', 'Buffer 还原');
await opened.dispose();

let wrongKeyMsg = '';
try {
  await openArchive(out, randomBytes(32));
} catch (e: any) {
  wrongKeyMsg = String(e?.message || '');
}
assert(wrongKeyMsg === '备份密钥错误', '错误密钥返回「备份密钥错误」');

async function writeMetaArchive(file: string, header: Record<string, any>): Promise<void> {
  await writeArchive(
    {
      header,
      tables: async function* () {
        yield { name: 'user', columns: ['id', 'username'], rows: [] };
      },
    },
    key,
    file,
  );
}

async function expectImportRejected(file: string, opts: any, label: string): Promise<void> {
  let message = '';
  try {
    await importArchive(file, opts);
  } catch (e: any) {
    message = String(e?.message || '');
  }
  assert(!!message, label);
}

const installArchive = path.join(dir, 'install-test.dnsmgrbk');
await writeMetaArchive(installArchive, { scope: 'install' });
await expectImportRejected(
  installArchive,
  { key, mode: 'merge', actor: { uid: 2, username: 'bob' } },
  '非管理员导入 install scope 被拒绝',
);
await expectImportRejected(
  out,
  { key, mode: 'merge', actor: { uid: 2, username: 'bob' } },
  '非管理员导入 site scope 被拒绝',
);
const noScopeArchive = path.join(dir, 'noscope-test.dnsmgrbk');
await writeMetaArchive(noScopeArchive, {});
await expectImportRejected(
  noScopeArchive,
  { key, mode: 'merge', actor: { uid: 2, username: 'bob' } },
  '缺少 scope 的归档被拒绝',
);
const userArchive = path.join(dir, 'user-test.dnsmgrbk');
await writeMetaArchive(userArchive, { scope: 'user', ownerUid: 1 });
await expectImportRejected(
  userArchive,
  { key, mode: 'merge', actor: { uid: 2, username: 'bob' } },
  '非管理员导入他人个人备份被拒绝',
);

const dek = newDek();
const kek = await deriveKek('correct horse battery staple', randomBytes(16));
const wrapped = wrapDek(kek, dek, 7);
assert(unwrapDek(kek, wrapped, 7)?.equals(dek) === true, '保险库 DEK 包裹/解包');
assert(unwrapDek(kek, wrapped, 8) === null, 'uid 不匹配时解包失败');
const cipherText = encryptWithDek(dek, '{"token":"x"}');
assert(decryptWithDek(dek, cipherText) === '{"token":"x"}', 'enc:u1: 往返');
assert(decryptWithDek(newDek(), cipherText) === null, '错误 DEK 无法解密');

console.log('\n备份与保险库自检全部通过');
