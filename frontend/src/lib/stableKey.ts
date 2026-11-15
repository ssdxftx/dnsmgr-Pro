const ids = new WeakMap<object, number>();
let seq = 0;

/**
 * 为可编辑数组的行对象分配稳定 key。
 * 用数组下标作 key 时，删除中间行会让后续行复用前一行组件实例，
 * 输入焦点、下拉展开、临时校验状态会串到错误行上。
 */
export function stableKey(row: any, index: number): string | number {
  if (row && typeof row === 'object') {
    let id = ids.get(row);
    if (!id) {
      id = ++seq;
      ids.set(row, id);
    }
    return 'k' + id;
  }
  return 'i' + index;
}
