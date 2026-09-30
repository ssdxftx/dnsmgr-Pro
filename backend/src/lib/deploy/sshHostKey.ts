import { createHash } from 'node:crypto';

/** 规范化 SHA256 指纹：去掉 `SHA256:` 前缀与空白，保留 base64 主体 */
function normalizeFingerprint(v: string): string {
  return String(v || '').trim().replace(/^SHA256:/i, '').replace(/\s+/g, '');
}

/**
 * SSH 主机密钥校验（防中间人）。
 * - 配置 host_fingerprint（形如 `SHA256:base64`）或 host_key（主机公钥 base64）时，严格校验，不匹配即拒绝连接。
 * - 未配置时保持向后兼容，接受任意主机密钥（与历史行为一致）。
 */
export function applyHostKeyVerification(connectConfig: Record<string, any>, config: Record<string, any>): void {
  const fingerprint = normalizeFingerprint(config?.host_fingerprint || '');
  const rawKey = String(config?.host_key || '').replace(/\s+/g, '');
  if (!fingerprint && !rawKey) return;
  connectConfig.hostVerifier = (key: Buffer): boolean => {
    try {
      if (rawKey && key.toString('base64') === rawKey) return true;
      if (fingerprint) return createHash('sha256').update(key).digest('base64') === fingerprint;
    } catch {
      return false;
    }
    return false;
  };
}