import { randomBytes, timingSafeEqual } from 'node:crypto';

// 安装令牌：未配置环境变量时，首次未安装启动会生成一次性随机令牌并打印到日志，
// 避免公网暴露的安装接口被任意人调用（探测内网数据库/抢先创建管理员）。
const envToken = String(process.env.DNSMGR_SETUP_TOKEN || '').trim();
let current = envToken;

export function initSetupToken(): void {
  if (current) return;
  current = randomBytes(12).toString('hex');
  console.warn('');
  console.warn('[setup] 系统尚未安装。安装令牌（仅本次进程有效）：' + current);
  console.warn('[setup] 请在安装页填写该令牌；也可通过 DNSMGR_SETUP_TOKEN 固定令牌。');
  console.warn('');
}

export function verifySetupToken(input: any): boolean {
  const got = Buffer.from(String(input || ''), 'utf8');
  const want = Buffer.from(current, 'utf8');
  if (!want.length || got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}