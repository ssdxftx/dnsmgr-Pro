export function parseOriginRecords(text: string) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [rec, w] = line.split(',').map((x) => x.trim());
      const o: any = { Record: rec };
      if (w) o.Weight = Number(w);
      return o;
    });
}

export function parseExtraParams(text: string) {
  const s = String(text || '').trim();
  if (!s) return undefined;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : undefined;
  } catch {
    return undefined;
  }
}
