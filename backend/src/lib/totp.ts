import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD = 30;
const DIGITS = 6;

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  const s = (str || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s) {
    const idx = ALPHABET.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function generateCode(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 1000 / PERIOD);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1000000;
  return String(code).padStart(DIGITS, '0');
}

/** 常量时间比较：6 位码虽短，也不应通过比较耗时泄露前缀信息 */
function codeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyTOTP(secret: string, code: string, window = 1): boolean {
  const input = String(code || '').trim();
  if (!/^\d{6}$/.test(input)) return false;
  // 空/过短的密钥会让 HMAC 退化为可预测的固定值，必须直接拒绝
  if (base32Decode(String(secret || '')).length < 10) return false;
  const now = Math.floor(Date.now() / 1000);
  for (let i = -window; i <= window; i++) {
    if (codeEquals(generateCode(secret, (now + i * PERIOD) * 1000), input)) return true;
  }
  return false;
}

export function provisioningUri(secret: string, label: string, issuer = 'DNS Manager'): string {
  const path = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${path}?issuer=${encodeURIComponent(issuer)}&secret=${secret}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}