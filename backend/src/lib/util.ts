export function fmtDateTime(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtTimestamp(ts: number): string {
  if (!ts) return '未运行';
  return fmtDateTime(new Date(ts * 1000));
}

// 仅检查对象自身属性，避免 Object.prototype 上的成员（如 constructor/toString）被当作合法键
export function hasOwn(obj: Record<string, any>, key: any): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}