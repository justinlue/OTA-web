/** Compare dotted versions numerically ("1.10.0" > "1.9.2"); non-numeric parts compare as strings. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.\-+]/);
  const pb = b.replace(/^v/i, '').split(/[.\-+]/);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return 0;
}
