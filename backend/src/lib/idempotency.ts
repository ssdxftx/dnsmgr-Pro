import { createHash } from 'node:crypto';
import { query, queryOne, table } from '../db.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_RESPONSE_BYTES = 256 * 1024;
// /api/events 的创建响应里带一次性 HMAC secret，缓存到 idempotency_key 表等于把密钥
// 明文多存一份 24 小时；/api/auth 的 TOTP 生成响应同样带 secret/一次性令牌。
// 这类响应一律不进入幂等缓存。
const SKIP_PREFIXES = ['/api/api-keys', '/api/auth', '/api/vault', '/api/events'];

function keyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function validKey(key: string): boolean {
  return key.length >= 8 && key.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(key);
}

export async function beginIdempotent(req: any, reply: any): Promise<any> {
  if (!WRITE_METHODS.has(String(req.method || '').toUpperCase())) return undefined;
  const raw = String(req.headers?.['idempotency-key'] || '').trim();
  if (!raw) return undefined;
  if (!validKey(raw)) {
    return reply.code(400).send({ code: -1, msg: 'Idempotency-Key 格式无效（8-128 位字母数字或 . _ : -）' });
  }
  const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) return undefined;

  const uid = Number(req.user?.uid || 0);
  if (!uid) return undefined;
  const method = String(req.method || '').toUpperCase();
  const rawUrl = String(req.url || req.raw?.url || '');
  const path = rawUrl.split('?')[0].slice(0, 255);
  if (SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'))) return undefined;
  const hash = keyHash(raw);
  // 请求指纹必须覆盖 query 与 body：否则同一个 Idempotency-Key 改参数重放时，
  // 会直接返回上一次的缓存响应（例如把「删除 A」的响应返回给「删除 B」）。
  let bodyText = '';
  try {
    bodyText = req.body === undefined ? '' : JSON.stringify(req.body);
  } catch {
    bodyText = '';
  }
  const requestHash = createHash('sha256')
    .update(`${method}\n${rawUrl.slice(0, 2048)}\n${bodyText.slice(0, 65536)}`)
    .digest('hex');

  let row: any = await queryOne(
    `SELECT * FROM ${table('idempotency_key')} WHERE uid = ? AND key_hash = ? LIMIT 1`,
    [uid, hash],
  );
  if (row) {
    const ageMs = Date.now() - new Date(String(row.created_at).replace(' ', 'T')).getTime();
    if (row.status === 'done') {
      if (row.method !== method || row.path !== path || (row.request_hash && row.request_hash !== requestHash)) {
        return reply.code(409).send({ code: -1, msg: '同一 Idempotency-Key 不能用于不同请求' });
      }
      reply.header('X-Idempotency-Replayed', 'true');
      return reply
        .code(Number(row.http_status || 200))
        .type('application/json')
        .send(row.response || '');
    }
    if (row.status === 'processing' && ageMs < 5 * 60_000) {
      return reply.code(409).send({ code: -1, msg: '相同 Idempotency-Key 的请求正在处理中' });
    }
    await query(`DELETE FROM ${table('idempotency_key')} WHERE id = ?`, [row.id]);
  }

  try {
    await query(
      `INSERT INTO ${table('idempotency_key')}
        (uid, key_hash, method, path, request_hash, status, http_status, response, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'processing', 0, NULL, NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [uid, hash, method, path, requestHash],
    );
  } catch {
    row = await queryOne(`SELECT * FROM ${table('idempotency_key')} WHERE uid = ? AND key_hash = ? LIMIT 1`, [uid, hash]);
    if (row?.status === 'done') {
      if (row.method !== method || row.path !== path || (row.request_hash && row.request_hash !== requestHash)) {
        return reply.code(409).send({ code: -1, msg: '同一 Idempotency-Key 不能用于不同请求' });
      }
      reply.header('X-Idempotency-Replayed', 'true');
      return reply.code(Number(row.http_status || 200)).type('application/json').send(row.response || '');
    }
    return reply.code(409).send({ code: -1, msg: '相同 Idempotency-Key 的请求正在处理中' });
  }

  req.idempotency = { uid, hash, method, path };
  if (Math.random() < 0.05) {
    query(`DELETE FROM ${table('idempotency_key')} WHERE expires_at < NOW() LIMIT 200`).catch(() => undefined);
  }
  return undefined;
}

export async function completeIdempotent(req: any, reply: any, payload: any): Promise<void> {
  const meta = req.idempotency;
  if (!meta) return;
  req.idempotency = null;
  const status = Number(reply.raw?.statusCode || reply.statusCode || 200);
  if (status >= 500 || status === 429) {
    await query(`DELETE FROM ${table('idempotency_key')} WHERE uid = ? AND key_hash = ?`, [meta.uid, meta.hash]).catch(() => undefined);
    return;
  }
  let body = '';
  if (typeof payload === 'string') body = payload;
  else if (Buffer.isBuffer(payload)) return;
  else if (payload && typeof payload === 'object') {
    try {
      body = JSON.stringify(payload);
    } catch {
      return;
    }
  } else if (payload != null) {
    body = String(payload);
  }
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    await query(`DELETE FROM ${table('idempotency_key')} WHERE uid = ? AND key_hash = ?`, [meta.uid, meta.hash]).catch(() => undefined);
    return;
  }
  await query(
    `UPDATE ${table('idempotency_key')}
        SET status = 'done', http_status = ?, response = ?, expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR)
      WHERE uid = ? AND key_hash = ?`,
    [status, body, meta.uid, meta.hash],
  ).catch(() => undefined);
}
