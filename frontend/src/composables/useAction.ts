import { reactive } from 'vue';

/**
 * 非 Button 触发点（开关、下拉菜单项、整卡点击、tabs 切换）的并发互斥基座。
 *
 * 用法：
 *   const { busy, run } = useAction();
 *   run(`row:${row.id}`, () => del(row));
 *   // 模板/渲染中读取 busy[`row:${row.id}`] 控制 loading / disabled
 */
export function useAction() {
  const busy = reactive<Record<string, boolean>>({});

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (busy[key]) return undefined;
    busy[key] = true;
    try {
      return await fn();
    } finally {
      // 删除而不是置 false：行级 key 会随翻页/切换持续增加，长期会话下 Map 会无界增长
      delete busy[key];
    }
  }

  return { busy, run };
}
