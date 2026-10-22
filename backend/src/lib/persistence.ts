import fs from 'node:fs';
import path from 'node:path';

export interface PersistenceInfo {
  dataDir: string;
  persistent: boolean;
  writable: boolean;
  fstype: string;
  mountPoint: string;
  reason: string;
  /** 数据目录位于网络文件系统：SQLite WAL 不可用，需改用 MySQL */
  network: boolean;
}

const NON_PERSISTENT_FS = new Set(['overlay', 'tmpfs', 'ramfs', 'devtmpfs', 'proc', 'sysfs']);
// SQLite 的 WAL 锁依赖可靠的 POSIX 文件锁；网络文件系统上容易出现锁失效与数据损坏。
const NETWORK_FS = new Set([
  'nfs', 'nfs4', 'cifs', 'smb3', 'smbfs', 'sshfs', 'fuse.sshfs',
  'ceph', 'fuse.ceph', 'cephfs', 'glusterfs', 'fuse.glusterfs',
  'fuse.rclone', 'davfs',
]);

function decodeMountPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_m, code) => String.fromCharCode(parseInt(code, 8)));
}

function readMountInfo(): Array<{ mountPoint: string; fstype: string }> {
  try {
    const raw = fs.readFileSync('/proc/self/mountinfo', 'utf8');
    const list: Array<{ mountPoint: string; fstype: string }> = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      const parts = line.split(' ');
      const sep = parts.indexOf('-');
      if (sep < 0 || parts.length < sep + 3) continue;
      list.push({
        mountPoint: decodeMountPath(parts[4]),
        fstype: parts[sep + 1],
      });
    }
    return list;
  } catch {
    return [];
  }
}

function isAncestor(parent: string, child: string): boolean {
  if (parent === child) return true;
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function resolveDataDir(): string {
  return path.resolve(process.env.DNSMGR_DATA_DIR || path.join(process.cwd(), 'data'));
}

/**
 * 检测目标目录的持久化能力。默认检测 DNSMGR_DATA_DIR；
 * 传入 SQLite 数据文件所在目录时，可避免 DB_FILE 指向数据目录之外时漏判网络文件系统。
 */
export function detectDataPersistence(targetDir = resolveDataDir()): PersistenceInfo {
  const dataDir = path.resolve(targetDir);
  let writable = false;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }

  const mounts = readMountInfo();
  const hit = mounts
    .filter((m) => isAncestor(m.mountPoint, dataDir))
    .sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0];
  const network = !!hit && NETWORK_FS.has(hit.fstype);
  const override = String(process.env.DNSMGR_DATA_PERSISTENT || '').trim().toLowerCase();

  if (network) {
    return {
      dataDir,
      persistent: false,
      writable,
      fstype: hit.fstype,
      mountPoint: hit.mountPoint,
      network: true,
      reason: `SQLite 不支持 ${hit.fstype} 网络文件系统，请改用 MySQL 或本地持久化卷`,
    };
  }

  if (override === '1' || override === 'true') {
    return {
      dataDir,
      persistent: writable,
      writable,
      fstype: 'override',
      mountPoint: dataDir,
      network: false,
      reason: writable ? '已通过 DNSMGR_DATA_PERSISTENT 显式启用持久化' : '数据目录不可写',
    };
  }
  if (override === '0' || override === 'false') {
    return {
      dataDir,
      persistent: false,
      writable,
      fstype: 'override',
      mountPoint: dataDir,
      network: false,
      reason: '已通过 DNSMGR_DATA_PERSISTENT 显式关闭持久化',
    };
  }

  if (!writable) {
    return {
      dataDir,
      persistent: false,
      writable,
      fstype: '',
      mountPoint: '',
      network: false,
      reason: '数据目录不可写',
    };
  }

  if (!mounts.length) {
    return {
      dataDir,
      persistent: true,
      writable,
      fstype: '',
      mountPoint: '',
      network: false,
      reason: '未读取到容器挂载信息，按本地磁盘处理',
    };
  }

  if (!hit) {
    return {
      dataDir,
      persistent: true,
      writable,
      fstype: '',
      mountPoint: '',
      network: false,
      reason: '数据目录位于本地文件系统',
    };
  }

  if (hit.mountPoint === '/') {
    return {
      dataDir,
      persistent: false,
      writable,
      fstype: hit.fstype,
      mountPoint: hit.mountPoint,
      network: false,
      reason: '数据目录位于根文件系统，请挂载持久化卷或设置 DNSMGR_DATA_PERSISTENT=1',
    };
  }
  if (NON_PERSISTENT_FS.has(hit.fstype)) {
    return {
      dataDir,
      persistent: false,
      writable,
      fstype: hit.fstype,
      mountPoint: hit.mountPoint,
      network: false,
      reason: `数据目录位于 ${hit.fstype} 文件系统，容器重建后可能丢失`,
    };
  }

  return {
    dataDir,
    persistent: true,
    writable,
    fstype: hit.fstype,
    mountPoint: hit.mountPoint,
    network: false,
    reason: `数据目录已挂载在 ${hit.fstype} 文件系统`,
  };
}
