import { describe, expect, it } from 'vitest';
import { buildPatternMap, detectPatterns } from '../lib/candlePatterns';
import type { OHLCBar } from '../types';

// 幾何条件を厳密に組んだ手組みバー（合成データは使わない）
function bar(o: number, h: number, l: number, c: number, t = 0): OHLCBar {
  return { o, h, l, c, t, v: 0 };
}

describe('detectPatterns', () => {
  it('陽線包みを検出する', () => {
    // Arrange: 弱気足 → 実体を包む強気足
    const bars = [bar(110, 111, 99, 100, 1), bar(99, 113, 98, 112, 2)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'bullish_engulfing',
        signal: 'bullish',
        idx: 1,
        spanStart: 0,
      }),
    );
  });

  it('前足実体を包まない陽線は検出しない', () => {
    // Arrange: 強気足だが前足の実体まで届かない
    const bars = [bar(110, 111, 99, 100, 1), bar(103, 109, 102, 108, 2)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches.some((m) => m.type === 'bullish_engulfing')).toBe(false);
  });

  it('同時線を検出する', () => {
    // Arrange: 実体がレンジの 10% 以下
    const bars = [bar(100, 105, 95, 100.2, 1)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({ type: 'doji', signal: 'neutral', idx: 0 }),
    );
  });

  it('ハンマーを検出する', () => {
    // Arrange: 小実体・長い下ヒゲ・短い上ヒゲ
    const bars = [bar(105, 106.5, 100, 106, 1)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({ type: 'hammer', signal: 'bullish', idx: 0 }),
    );
  });

  it('宵の明星を検出する', () => {
    // Arrange: 強気大陽線 → 小実体 → 弱気で中点割れ
    const bars = [
      bar(100, 110.5, 99.5, 110, 1),
      bar(111, 112, 110.8, 111.3, 2),
      bar(109, 109.5, 102.5, 103, 3),
    ];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'evening_star',
        signal: 'bearish',
        idx: 2,
        spanStart: 0,
      }),
    );
  });

  it('先頭バー・短い配列でも範囲外参照せず例外を投げない', () => {
    // Arrange
    const empty: OHLCBar[] = [];
    const single = [bar(100, 101, 99, 100.5, 1)];

    // Act & Assert
    expect(() => detectPatterns(empty)).not.toThrow();
    expect(detectPatterns(empty)).toEqual([]);
    expect(() => detectPatterns(single)).not.toThrow();
    // 単一バーでは前足参照の陽線包み・宵の明星は検出されない
    expect(detectPatterns(single).some((m) => m.type === 'bullish_engulfing')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'evening_star')).toBe(false);
  });

  it('range=0（四値同一）でゼロ除算せず何も検出しない', () => {
    // Arrange
    const bars = [bar(100, 100, 100, 100, 1)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toEqual([]);
  });
});

describe('buildPatternMap', () => {
  it('同一確定バーの複数マッチを配列に集約する', () => {
    // Arrange: 前足を包み、かつハンマー条件も満たす強気足
    const bars = [bar(110, 111, 99, 100, 1), bar(99.5, 111, 77, 110.5, 2)];
    const matches = detectPatterns(bars);

    // Act
    const map = buildPatternMap(matches);

    // Assert: idx 1 に陽線包み + ハンマーの 2 件
    const atBar1 = map.get(1) ?? [];
    expect(atBar1.length).toBeGreaterThanOrEqual(2);
    const types = atBar1.map((m) => m.type);
    expect(types).toContain('bullish_engulfing');
    expect(types).toContain('hammer');
  });

  it('空マッチでは空の Map を返す', () => {
    // Act
    const map = buildPatternMap([]);

    // Assert
    expect(map.size).toBe(0);
  });
});
