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

// 转义 LIKE 通配符，配合 SQL 中的 ESCAPE '!' 使用，避免用户输入的 % / _ / ! 改变匹配语义
export function escapeLike(s: string): string {
  return String(s).replace(/[!%_]/g, (m) => '!' + m);
}

// 面向客户端返回的错误信息：去除换行/制表等控制符并限制长度，避免泄露多行堆栈等内部细节
export function clientMessage(e: any, fallback = '操作失败'): string {
  const raw = typeof e === 'string' ? e : e && e.message ? String(e.message) : '';
  const cleaned = raw.replace(/[\r\n\t]+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 200) : fallback;
}