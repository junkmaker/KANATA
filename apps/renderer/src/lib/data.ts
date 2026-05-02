import type { FinBar, OHLCBar } from '../types';

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function genSeries({
  seed,
  bars,
  start,
  vol,
  drift,
  base,
}: {
  seed: number;
  bars: number;
  start: number;
  vol: number;
  drift: number;
  base: number;
}): OHLCBar[] {
  const r = rand(seed);
  const out: OHLCBar[] = [];
  let price = start;
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  for (let i = 0; i < bars; i++) {
    const o = price;
    const sigma = vol * o;
    const dr = drift * o;
    const moves = 4;
    let hi = o,
      lo = o;
    let p = o;
    for (let k = 0; k < moves; k++) {
      const g = ((r() + r() + r() - 1.5) * sigma) / Math.sqrt(moves);
      p = p + g + dr / moves;
      if (p > hi) hi = p;
      if (p < lo) lo = p;
    }
    const c = p;
    const v = Math.round((base + r() * base * 1.2) * (1 + (Math.abs(c - o) / o) * 10));
    const t = now - (bars - 1 - i) * dayMs;
    out.push({ t, o, h: hi, l: lo, c, v });
    price = c;
  }
  return out;
}

export function retime(series: OHLCBar[], tfMs: number): OHLCBar[] {
  const n = series.length;
  const now = Date.now();
  return series.map((b, i) => ({ ...b, t: now - (n - 1 - i) * tfMs }));
}

export function genFin(seed: number, baseRoe: number, baseRoic: number, basePer: number): FinBar[] {
  const r = rand(seed + 9999);
  const now = Date.now();
  const quarterMs = 91 * 24 * 3600 * 1000;
  const quarters = 20;
  const out: FinBar[] = [];
  let roe = baseRoe || 10;
  let roic = baseRoic || 8;
  let per = basePer || 15;
  for (let i = 0; i < quarters; i++) {
    roe = Math.max(0, roe + (r() - 0.5) * 4);
    roic = Math.max(0, roic + (r() - 0.5) * 3);
    per = Math.max(0, per + (r() - 0.5) * 6);
    out.push({ t: now - (quarters - 1 - i) * quarterMs, roe, roic, per });
  }
  return out;
}

export const TF: Record<string, number> = {
  '1D': 24 * 3600 * 1000,
  '1W': 7 * 24 * 3600 * 1000,
  '1M': 30 * 24 * 3600 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '60m': 60 * 60 * 1000,
};
