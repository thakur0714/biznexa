/** Numeric dotted version comparison; missing components are treated as zero. */
export function isVersionBelow(current: string, minimum: string): boolean {
  const parts = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10));
  const a = parts(current); const b = parts(minimum);
  if ([...a, ...b].some((part) => !Number.isFinite(part) || part < 0)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}
