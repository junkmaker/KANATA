import type { OHLCBar } from '../types';

export function nextBarTimestamp(prevT: number, tf: string): number {
  if (tf === '5m') return prevT + 5 * 60 * 1000;
  if (tf === '15m') return prevT + 15 * 60 * 1000;
  if (tf === '60m') return prevT + 60 * 60 * 1000;
  if (tf === '1D') return prevT + 24 * 60 * 60 * 1000;
  if (tf === '1W') return prevT + 7 * 24 * 60 * 60 * 1000;
  if (tf === '1M') {
    const d = new Date(prevT);
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  }
  return prevT + 24 * 60 * 60 * 1000;
}

export function barTimestampAt(data: OHLCBar[], idx: number, tf: string): number {
  if (idx < data.length) return data[idx].t;
  let t = data[data.length - 1].t;
  for (let i = data.length; i <= idx; i++) {
    t = nextBarTimestamp(t, tf);
  }
  return t;
}
