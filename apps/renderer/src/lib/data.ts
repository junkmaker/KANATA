import type { OHLCBar, Ticker, FinBar } from '../types';

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function genSeries({ seed, bars, start, vol, drift, base }: {
  seed: number; bars: number; start: number; vol: number; drift: number; base: number;
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
    let hi = o, lo = o;
    let p = o;
    for (let k = 0; k < moves; k++) {
      const g = (r() + r() + r() - 1.5) * sigma / Math.sqrt(moves);
      p = p + g + dr / moves;
      if (p > hi) hi = p;
      if (p < lo) lo = p;
    }
    const c = p;
    const v = Math.round((base + r() * base * 1.2) * (1 + Math.abs(c - o) / o * 10));
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

export const TF: Record<string, number> = {
  '1D': 24 * 3600 * 1000,
  '1W': 7 * 24 * 3600 * 1000,
  '1M': 30 * 24 * 3600 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '60m': 60 * 60 * 1000,
};

export const TICKERS: Ticker[] = [
  { code: '7203', name: 'Toyota Motor', market: 'JP', sector: 'Auto', seed: 11, start: 2850, vol: 0.014, drift: 0.0006, base: 18000000, currency: '¥', fin: { roe: 12.8, roic: 9.1, per: 10.4, pbr: 1.12, div: 3.1, mcap: '45.2T' } },
  { code: '6758', name: 'Sony Group', market: 'JP', sector: 'Electronics', seed: 12, start: 13400, vol: 0.018, drift: 0.0008, base: 7000000, currency: '¥', fin: { roe: 14.5, roic: 10.2, per: 18.7, pbr: 2.38, div: 0.6, mcap: '16.8T' } },
  { code: '9984', name: 'SoftBank Group', market: 'JP', sector: 'Telecom/Inv', seed: 13, start: 8900, vol: 0.028, drift: 0.0002, base: 12000000, currency: '¥', fin: { roe: 8.2, roic: 4.1, per: 22.1, pbr: 1.54, div: 0.5, mcap: '13.1T' } },
  { code: '6861', name: 'Keyence', market: 'JP', sector: 'Machinery', seed: 14, start: 64000, vol: 0.015, drift: 0.0005, base: 900000, currency: '¥', fin: { roe: 11.1, roic: 12.3, per: 38.5, pbr: 4.22, div: 0.4, mcap: '15.5T' } },
  { code: '8306', name: 'Mitsubishi UFJ', market: 'JP', sector: 'Banking', seed: 15, start: 1580, vol: 0.017, drift: 0.0007, base: 60000000, currency: '¥', fin: { roe: 9.3, roic: 1.1, per: 11.2, pbr: 1.01, div: 2.9, mcap: '19.3T' } },
  { code: '9432', name: 'NTT', market: 'JP', sector: 'Telecom', seed: 16, start: 156, vol: 0.009, drift: 0.0003, base: 350000000, currency: '¥', fin: { roe: 13.0, roic: 6.8, per: 12.4, pbr: 1.61, div: 3.3, mcap: '14.2T' } },
  { code: '7974', name: 'Nintendo', market: 'JP', sector: 'Entertainment', seed: 17, start: 7600, vol: 0.020, drift: 0.0004, base: 8000000, currency: '¥', fin: { roe: 18.2, roic: 19.1, per: 21.3, pbr: 3.77, div: 2.6, mcap: '10.8T' } },
  { code: 'AAPL', name: 'Apple Inc.', market: 'US', sector: 'Technology', seed: 21, start: 215, vol: 0.013, drift: 0.0006, base: 55000000, currency: '$', fin: { roe: 156.1, roic: 58.2, per: 31.4, pbr: 49.2, div: 0.5, mcap: '3.28T' } },
  { code: 'MSFT', name: 'Microsoft', market: 'US', sector: 'Technology', seed: 22, start: 418, vol: 0.014, drift: 0.0008, base: 21000000, currency: '$', fin: { roe: 37.6, roic: 29.1, per: 34.8, pbr: 11.1, div: 0.7, mcap: '3.11T' } },
  { code: 'NVDA', name: 'NVIDIA', market: 'US', sector: 'Semiconductor', seed: 23, start: 112, vol: 0.032, drift: 0.0015, base: 420000000, currency: '$', fin: { roe: 118.3, roic: 85.7, per: 65.2, pbr: 52.4, div: 0.03, mcap: '2.81T' } },
  { code: 'TSLA', name: 'Tesla', market: 'US', sector: 'Auto/Energy', seed: 24, start: 248, vol: 0.035, drift: 0.0001, base: 95000000, currency: '$', fin: { roe: 21.8, roic: 14.2, per: 62.1, pbr: 11.6, div: 0.0, mcap: '791B' } },
  { code: 'GOOGL', name: 'Alphabet', market: 'US', sector: 'Technology', seed: 25, start: 174, vol: 0.015, drift: 0.0007, base: 22000000, currency: '$', fin: { roe: 29.7, roic: 25.8, per: 24.2, pbr: 6.9, div: 0.4, mcap: '2.15T' } },
  { code: 'AMZN', name: 'Amazon', market: 'US', sector: 'Retail/Cloud', seed: 26, start: 188, vol: 0.018, drift: 0.0007, base: 35000000, currency: '$', fin: { roe: 22.3, roic: 13.2, per: 42.1, pbr: 8.2, div: 0.0, mcap: '1.95T' } },
  { code: 'META', name: 'Meta Platforms', market: 'US', sector: 'Social', seed: 27, start: 510, vol: 0.022, drift: 0.0009, base: 14000000, currency: '$', fin: { roe: 33.4, roic: 26.1, per: 27.8, pbr: 8.4, div: 0.3, mcap: '1.29T' } },
  { code: 'JPM', name: 'JPMorgan Chase', market: 'US', sector: 'Banking', seed: 28, start: 214, vol: 0.013, drift: 0.0005, base: 11000000, currency: '$', fin: { roe: 17.1, roic: 1.8, per: 12.2, pbr: 1.94, div: 2.3, mcap: '608B' } },
];

export const DATA: Record<string, OHLCBar[]> = {};
TICKERS.forEach(t => {
  DATA[t.code] = genSeries({ seed: t.seed, bars: 1500, start: t.start, vol: t.vol, drift: t.drift, base: t.base });
});

function genFin(seed: number, baseROE: number, baseROIC: number, basePER: number): FinBar[] {
  const r = rand(seed + 100);
  const out: FinBar[] = [];
  const now = Date.now();
  const q = 90 * 24 * 3600 * 1000;
  for (let i = 19; i >= 0; i--) {
    const t = now - i * q;
    out.push({
      t,
      roe: Math.max(0, baseROE + (r() - 0.5) * baseROE * 0.25 + Math.sin(i / 3) * baseROE * 0.08),
      roic: Math.max(0, baseROIC + (r() - 0.5) * baseROIC * 0.25 + Math.cos(i / 3) * baseROIC * 0.08),
      per: Math.max(2, basePER + (r() - 0.5) * basePER * 0.30 + Math.sin(i / 4) * basePER * 0.12),
    });
  }
  return out;
}

export const FIN_TS: Record<string, FinBar[]> = {};
TICKERS.forEach(t => {
  FIN_TS[t.code] = genFin(t.seed, t.fin.roe, t.fin.roic, t.fin.per);
});
