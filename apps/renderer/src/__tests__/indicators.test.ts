import { describe, expect, it } from 'vitest';
import { BOLL, MACD, PSAR, RSI, SMA, STOCH } from '../lib/indicators';
import type { OHLCBar } from '../types';

/**
 * インジケーターの特性テスト。
 *
 * 目的は「今の実装が理論的に正しい」ことの証明ではなく、
 * `noNonNullAssertion` 解消のための書き換え（`arr[i]!` → 局所 const）で
 * **挙動が一切変わらない**ことを固定すること。
 * 期待値は書き換え前の実行結果から採っている。
 */

const bars = (closes: number[]): OHLCBar[] =>
  closes.map((c, i) => ({ t: i * 86_400_000, o: c, h: c + 1, l: c - 1, c, v: 100 + i }));

/** 上下に振れる決定論的な系列（ランダムを使わない） */
const wave = (n: number): OHLCBar[] =>
  bars(Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 3) * 10 + i * 0.5));

describe('SMA', () => {
  it('period 未満の添字は null、以降は移動平均を返す', () => {
    const out = SMA(bars([1, 2, 3, 4, 5]), 3);
    expect(out).toEqual([null, null, 2, 3, 4]);
  });

  it('空配列でも例外を投げず空配列を返す', () => {
    expect(SMA([], 5)).toEqual([]);
  });

  it('データ長が period 未満なら全て null', () => {
    expect(SMA(bars([1, 2]), 5)).toEqual([null, null]);
  });

  it('period 200 では 199 番目まで null、200 本目から値が出る', () => {
    const out = SMA(wave(250), 200);
    expect(out[198]).toBeNull();
    expect(out[199]).not.toBeNull();
    expect(out.length).toBe(250);
  });
});

describe('BOLL', () => {
  it('period 未満の添字は null、以降は非 null', () => {
    const r = BOLL(bars([1, 2, 3, 4, 5]), 3);
    expect(r.mid.slice(0, 2)).toEqual([null, null]);
    expect(r.upper[2]).not.toBeNull();
    expect(r.lower[2]).not.toBeNull();
  });

  it('upper > mid > lower が成り立つ', () => {
    const r = BOLL(wave(60), 20, 2);
    const i = 40;
    const mid = r.mid[i];
    const upper = r.upper[i];
    const lower = r.lower[i];
    expect(mid).not.toBeNull();
    expect(upper as number).toBeGreaterThan(mid as number);
    expect(mid as number).toBeGreaterThan(lower as number);
  });

  it('終値が一定ならバンド幅が 0 になる', () => {
    const r = BOLL(bars(Array(10).fill(50)), 5, 2);
    expect(r.upper[9]).toBeCloseTo(50, 10);
    expect(r.lower[9]).toBeCloseTo(50, 10);
  });
});

describe('STOCH', () => {
  it('slowing 境界より前の %K は null', () => {
    const r = STOCH(wave(40), 14, 3, 3);
    // i >= kPeriod - 1 + slowing - 1 = 15 から非 null
    expect(r.k.slice(0, 15).every((v) => v === null)).toBe(true);
    expect(r.k[15]).not.toBeNull();
  });

  it('%D は %K よりさらに dPeriod-1 本ぶん遅れて立ち上がる', () => {
    const r = STOCH(wave(40), 14, 3, 3);
    expect(r.d[16]).toBeNull();
    expect(r.d[17]).not.toBeNull();
  });

  it('高値と安値が同値でも 1e-9 ガードで NaN にならない', () => {
    const flat = bars(Array(30).fill(10)).map((b) => ({ ...b, h: 10, l: 10 }));
    const r = STOCH(flat, 14, 3, 3);
    const v = r.k[20];
    expect(v).not.toBeNull();
    expect(Number.isNaN(v as number)).toBe(false);
  });
});

describe('MACD', () => {
  it('macd / signal / histogram が同じ長さで返る', () => {
    const d = wave(80);
    const r = MACD(d, 12, 26, 9);
    expect(r.macd).toHaveLength(d.length);
    expect(r.signal).toHaveLength(d.length);
    expect(r.histogram).toHaveLength(d.length);
  });

  it('histogram = macd - signal（両方が非 null の添字で）', () => {
    const r = MACD(wave(80), 12, 26, 9);
    const i = r.histogram.findIndex((v) => v !== null);
    expect(i).toBeGreaterThan(0);
    expect(r.histogram[i] as number).toBeCloseTo(
      (r.macd[i] as number) - (r.signal[i] as number),
      10,
    );
  });

  it('データが短くても例外を投げない', () => {
    expect(() => MACD(bars([1, 2, 3]), 12, 26, 9)).not.toThrow();
  });
});

describe('RSI', () => {
  it('period+1 本未満なら全て null', () => {
    expect(RSI(bars([1, 2, 3]), 14).every((v) => v === null)).toBe(true);
  });

  it('単調増加の系列では 100 に張り付く', () => {
    const out = RSI(bars(Array.from({ length: 40 }, (_, i) => 100 + i)), 14);
    expect(out[30] as number).toBeCloseTo(100, 5);
  });

  it('値は 0..100 の範囲に収まる', () => {
    for (const v of RSI(wave(60), 14)) {
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('PSAR', () => {
  it('1 本だけでも例外を投げない', () => {
    expect(() => PSAR(bars([100]))).not.toThrow();
  });

  it('入力と同じ長さを返す', () => {
    const d = wave(50);
    expect(PSAR(d)).toHaveLength(d.length);
  });

  it('空配列でも例外を投げない', () => {
    expect(() => PSAR([])).not.toThrow();
  });
});
