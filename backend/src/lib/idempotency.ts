import { createHash } from 'node:crypto';
import { query, queryOne, table } from '../db.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_RESPONSE_BYTES = 256 * 1024;
const SKIP_PREFIXES = ['/api/api-keys', '/api/auth/reauth', '/api/vault'];

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
  const path = String(req.url || req.raw?.url || '').split('?')[0].slice(0, 255);
  if (SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'))) return undefined;
  const hash = keyHash(raw);

  let row: any = await queryOne(
    `SELECT * FROM ${table('idempotency_key')} WHERE uid = ? AND key_hash = ? LIMIT 1`,
    [uid, hash],
  );
  if (row) {
    const ageMs = Date.now() - new Date(String(row.created_at).replace(' ', 'T')).getTime();
    if (row.status === 'done') {
      if (row.method !== method || row.path !== path) {
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
        (uid, key_hash, method, path, status, http_status, response, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'processing', 0, NULL, NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [uid, hash, method, path],
    );
  } catch {
    row = await queryOne(`SELECT * FROM ${table('idempotency_key')} WHERE uid = ? AND key_hash = ? LIMIT 1`, [uid, hash]);
    if (row?.status === 'done') {
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
