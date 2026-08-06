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

  it('陰線包みを検出する', () => {
    // Arrange: 強気足 → 実体を包む弱気足
    const bars = [bar(105, 112, 104, 110, 1), bar(115, 116, 103, 104, 2)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'bearish_engulfing',
        signal: 'bearish',
        label: '陰線包み',
        idx: 1,
        spanStart: 0,
      }),
    );
  });

  it('陽線はらみを検出する', () => {
    // Arrange: 大陰線の実体（100〜110）に小陽線が収まる
    const bars = [bar(110, 112, 99, 100, 1), bar(104, 107, 103, 106, 2)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'bullish_harami',
        signal: 'bullish',
        idx: 1,
        spanStart: 0,
      }),
    );
    // 包みとは内外が逆なので同時には立たない
    expect(matches.some((m) => m.type === 'bullish_engulfing')).toBe(false);
  });

  it('前足の実体が小さいはらみは検出しない', () => {
    // Arrange: 前足の実体 3 が HARAMI_BODY_RATIO * レンジ 13 = 3.9 に届かない
    const bars = [bar(103, 112, 99, 100, 1), bar(101, 104, 100.5, 102, 2)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches.some((m) => m.type === 'bullish_harami')).toBe(false);
  });

  it('陰線はらみを価格反転で検出する', () => {
    // Arrange: 陽線はらみを 220 で反転させた鏡像
    const bars = [bar(110, 121, 108, 120, 1), bar(116, 117, 113, 114, 2)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({ type: 'bearish_harami', signal: 'bearish', idx: 1 }),
    );
    expect(matches.some((m) => m.type === 'bullish_harami')).toBe(false);
  });

  it('明けの明星を検出する', () => {
    // Arrange: 弱気大陰線 → 小実体 → 強気で中点(105)超え
    const bars = [
      bar(110, 111, 99, 100, 1),
      bar(98, 99.5, 97, 98.3, 2),
      bar(99, 107, 98.5, 106, 3),
    ];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'morning_star',
        signal: 'bullish',
        label: '明けの明星',
        idx: 2,
        spanStart: 0,
      }),
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

  it('下放れ二本黒を検出する', () => {
    // Arrange: 下窓 → 陰線 → 終値を切り下げる陰線
    const bars = [bar(100, 108, 99, 106, 1), bar(96, 98, 92, 93, 2), bar(92, 93, 87, 88, 3)];

    // Act
    const matches = detectPatterns(bars);

    // Assert: 窓の手前のバーを含む 3 本が span になる
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'two_black_gapping',
        signal: 'bearish',
        label: '下放れ二本黒',
        idx: 2,
        spanStart: 0,
      }),
    );
  });

  it('ヒゲが重なる下放れは検出しない', () => {
    // Arrange: 実体は離れているが高値 100 が手前の安値 99 を上回る（高安基準）
    const bars = [bar(100, 108, 99, 106, 1), bar(96, 100, 92, 93, 2), bar(92, 93, 87, 88, 3)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches.some((m) => m.type === 'two_black_gapping')).toBe(false);
  });

  it('終値を切り下げない下放れ二本黒は検出しない', () => {
    // Arrange: 3本目は陰線だが終値 94 が 2本目の 93 を上回る
    const bars = [bar(100, 108, 99, 106, 1), bar(96, 98, 92, 93, 2), bar(95, 96, 93, 94, 3)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches.some((m) => m.type === 'two_black_gapping')).toBe(false);
  });

  it('上放れ並び赤を検出する', () => {
    // Arrange: 上窓 → 陽線 → 始値の差 0.4 が許容差 0.54 に収まる陽線
    const bars = [
      bar(100, 105, 98, 104, 1),
      bar(108, 113, 107, 112, 2),
      bar(108.4, 115, 108, 114, 3),
    ];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'upside_gap_two_white',
        signal: 'bullish',
        label: '上放れ並び赤',
        idx: 2,
        spanStart: 0,
      }),
    );
  });

  it('始値がずれた上放れ並び赤は検出しない', () => {
    // Arrange: 始値の差 1.0 が許容差 0.54 を超える
    const bars = [
      bar(100, 105, 98, 104, 1),
      bar(108, 113, 107, 112, 2),
      bar(109, 115, 108.5, 114, 3),
    ];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches.some((m) => m.type === 'upside_gap_two_white')).toBe(false);
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
    expect(detectPatterns(single).some((m) => m.type === 'bullish_harami')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'morning_star')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'two_black_gapping')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'upside_gap_two_white')).toBe(false);
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
