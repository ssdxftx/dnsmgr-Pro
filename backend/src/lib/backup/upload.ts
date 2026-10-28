import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpDir } from './archive.js';
import { markTempActive, markTempDone } from './tmpRegistry.js';

/** 流式保存 multipart 上传文件到 data/tmp，返回临时路径与字段 */
export async function saveUpload(req: any): Promise<{ file: string; fields: Record<string, any> }> {
  const part = await req.file();
  if (!part) throw new Error('请选择备份文件');
  await mkdir(tmpDir(), { recursive: true });
  const dest = path.join(tmpDir(), `upload-${randomUUID()}.dnsmgrbk`);
  // 登记为进行中，避免 1 小时清理任务删掉正在导入的上传文件
  markTempActive(dest);
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(dest);
    let failed = false;
    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      part.file.destroy();
      ws.destroy();
      void unlink(dest).catch(() => undefined);
      markTempDone(dest);
      reject(e);
    };
    part.file.pipe(ws);
    part.file.on('limit', () => fail(new Error('文件超过 200MB 上限')));
    ws.once('finish', () => {
      if (!failed) resolve();
    });
    ws.once('error', fail);
    part.file.once('error', fail);
  });
  // 文件移交调用方，由调用方处理完毕后 releaseTemp
  return { file: dest, fields: (part.fields || {}) as Record<string, any> };
}

/** 调用方用完后解除登记（通常与 unlink 一起执行） */
export function releaseTemp(file: string): void {
  markTempDone(file);
}

/** multipart 字段取值（可能为 { value } 结构） */
export function fieldValue(fields: Record<string, any>, name: string): any {
  const f = fields[name];
  if (f === undefined) return undefined;
  return Array.isArray(f) ? f[0]?.value : f?.value;
}
