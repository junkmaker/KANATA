export function fmtPrice(v: number | null | undefined, cur = '$'): string {
  if (v == null || isNaN(v)) return '—';
  if (cur === '¥') return cur + Math.round(v).toLocaleString();
  return cur + v.toFixed(2);
}

export function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}

export function fmtDate(t: number, tf: string): string {
  const d = new Date(t);
  if (tf === '5m' || tf === '15m' || tf === '60m') {
    return d.toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-GB', { year: '2-digit', month: 'short', day: '2-digit' });
}
