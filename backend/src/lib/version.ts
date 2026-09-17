import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const APP_NAME = '彩虹 DNS Pro';
export const APP_DESCRIPTION = 'DNS 解析 · CDN 加速 · SSL 证书 · 自动部署 一体化管理平台';
export const REPO_URL = 'https://github.com/ssdxftx/dnsmgr-Pro';
export const LICENSE = 'MIT';

// 更新检查默认对比本项目仓库，可用 DNSMGR_UPDATE_REPO=owner/repo 覆盖
export const UPDATE_REPO = normalizeRepo(process.env.DNSMGR_UPDATE_REPO || 'ssdxftx/dnsmgr-Pro');

function normalizeRepo(raw: string): string {
  const v = String(raw || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(v) ? v : 'ssdxftx/dnsmgr-Pro';
}

function readPackageVersion(): string {
  // backend/src/lib -> backend/package.json；容器内为 /app/src/lib -> /app/package.json
  const candidates = [join(__dirname, '..', '..', 'package.json'), resolve(process.cwd(), 'package.json')];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (pkg?.version) return String(pkg.version);
    } catch {
      // 忽略读取失败，继续尝试下一个候选路径
    }
  }
  return '0.0.0';
}

export const APP_VERSION = readPackageVersion();

export interface SemverParts {
  raw: string;
  version: string;
  parts: [number, number, number];
}

export function parseSemver(input: unknown): SemverParts | null {
  const raw = String(input ?? '').trim();
  const m = raw.match(/^[vV]?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) return null;
  const parts: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { raw, version: `${parts[0]}.${parts[1]}.${parts[2]}`, parts };
}

export function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}
