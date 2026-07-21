import { describe, expect, it } from 'vitest';
import { ICHI, ICHI_DISPLACEMENT } from '../lib/indicators';
import type { OHLCBar } from '../types';

// 単調増加バー（合成データは使わない、hh/ll が予測しやすい）
function bar(o: number, h: number, l: number, c: number, t = 0): OHLCBar {
  return { o, h, l, c, t, v: 0 };
}

function buildRisingBars(n: number): OHLCBar[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + i;
    return bar(base, base + 1, base - 1, base + 0.5, i);
  });
}

describe('ICHI', () => {
  it('ICHI_DISPLACEMENT は 26 である', () => {
    expect(ICHI_DISPLACEMENT).toBe(26);
  });

  it('senkouA/senkouB は n + ICHI_DISPLACEMENT の長さを持つ', () => {
    // Arrange
    const bars = buildRisingBars(80);

    // Act
    const result = ICHI(bars);

    // Assert
    expect(result.senkouA.length).toBe(80 + ICHI_DISPLACEMENT);
    expect(result.senkouB.length).toBe(80 + ICHI_DISPLACEMENT);
  });

  it('十分なデータがあれば未来インデックスの senkouA/senkouB が非null になる', () => {
    // Arrange
    const n = 80;
    const bars = buildRisingBars(n);

    // Act
    const result = ICHI(bars);

    // Assert
    for (let i = n; i < n + ICHI_DISPLACEMENT; i++) {
      expect(result.senkouA[i]).not.toBeNull();
      expect(result.senkouB[i]).not.toBeNull();
    }
  });

  it('senkouA[i + ICHI_DISPLACEMENT] は tenkan[i] と kijun[i] の平均に一致する', () => {
    // Arrange
    const bars = buildRisingBars(80);

    // Act
    const result = ICHI(bars);
    const i = 60;

    // Assert
    const tenkanI = result.tenkan[i];
    const kijunI = result.kijun[i];
    expect(tenkanI).not.toBeNull();
    expect(kijunI).not.toBeNull();
    expect(result.senkouA[i + ICHI_DISPLACEMENT]).toBeCloseTo(((tenkanI ?? 0) + (kijunI ?? 0)) / 2);
  });

  it('tenkan/kijun/chikou は未来へ伸びず n の長さのまま', () => {
    // Arrange
    const bars = buildRisingBars(80);

    // Act
    const result = ICHI(bars);

    // Assert
    expect(result.tenkan.length).toBe(80);
    expect(result.kijun.length).toBe(80);
    expect(result.chikou.length).toBe(80);
  });

  it('データ長が senkouBP(52) 未満でも例外を投げず senkouB は全て null', () => {
    // Arrange
    const bars = buildRisingBars(10);

    // Act & Assert
    expect(() => ICHI(bars)).not.toThrow();
    const result = ICHI(bars);
    expect(result.senkouB.every((v) => v === null)).toBe(true);
  });
});
