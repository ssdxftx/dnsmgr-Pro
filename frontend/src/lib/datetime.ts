const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function toIsoDateTime(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function formatDateTime(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  if (!DATE_TIME_PATTERN.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
