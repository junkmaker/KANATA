import { describe, expect, it } from 'vitest';
import { buildPatternMap, detectPatterns } from '../lib/candlePatterns';
import type { OHLCBar } from '../types';

// 幾何条件を厳密に組んだ手組みバー（合成データは使わない）
function bar(o: number, h: number, l: number, c: number, t = 0): OHLCBar {
  return { o, h, l, c, t, v: 0 };
}

// 下降/上昇/横ばいの助走 11 本。それ自体はどのパターンも発火させない。
// ハンマー/首吊り線は 12 本目以降でしか成立しないので文脈系テストは必ず前置する。
// Python 側 test_candle_patterns.py の DOWNTREND / UPTREND / FLAT と同じ数値。
function downtrendPrefix(): OHLCBar[] {
  return Array.from({ length: 11 }, (_, k) =>
    bar(200 - 5 * k, 201 - 5 * k, 194 - 5 * k, 195 - 5 * k, k + 1),
  );
}

function uptrendPrefix(): OHLCBar[] {
  return Array.from({ length: 11 }, (_, k) =>
    bar(100 + 5 * k, 106 + 5 * k, 99 + 5 * k, 105 + 5 * k, k + 1),
  );
}

function flatPrefix(): OHLCBar[] {
  return Array.from({ length: 11 }, (_, k) =>
    bar(200 - 0.5 * k, 201 - 0.5 * k, 194 - 0.5 * k, 195 - 0.5 * k, k + 1),
  );
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

  it('下降トレンド後のハンマーを検出する', () => {
    // Arrange: 助走 11 本の下降（騰落率 -25.6%）+ 小実体・長い下ヒゲ・短い上ヒゲ
    const bars = [...downtrendPrefix(), bar(142, 144, 132, 143.5, 12)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({ type: 'hammer', signal: 'bullish', idx: 11, spanStart: 11 }),
    );
    expect(matches.some((m) => m.type === 'hanging_man')).toBe(false);
  });

  it('上昇トレンド後の同じ形は首吊り線として検出する', () => {
    // Arrange: 形状は上と同一。助走だけを上昇（騰落率 +47.6%）に差し替える
    const bars = [...uptrendPrefix(), bar(157, 159, 147, 158.5, 12)];

    // Act
    const matches = detectPatterns(bars);

    // Assert: 弱気に反転する（既存の誤ラベルの是正）
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'hanging_man',
        signal: 'bearish',
        label: '首吊り線',
        idx: 11,
        spanStart: 11,
      }),
    );
    expect(matches.some((m) => m.type === 'hammer')).toBe(false);
  });

  it('横ばい後のハンマー型はどちらも検出しない', () => {
    // Arrange: 騰落率 -2.56% は ±5% の帯の中
    const bars = [...flatPrefix(), bar(187, 189, 177, 188.5, 12)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches.some((m) => m.type === 'hammer' || m.type === 'hanging_man')).toBe(false);
  });

  it('助走が足りないバーではハンマーを検出しない', () => {
    // Arrange: 形状は成立しているが 11 本目（12 本目に届かない）
    const bars = [...downtrendPrefix().slice(0, 10), bar(142, 144, 132, 143.5, 11)];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches.some((m) => m.type === 'hammer')).toBe(false);
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

  it('アイランド天井を検出する', () => {
    // Arrange: 上窓 → 島 2 本 → 下窓
    const bars = [
      bar(100, 105, 98, 104, 1),
      bar(110, 115, 108, 112, 2),
      bar(111, 116, 107, 108, 3),
      bar(100, 104, 95, 96, 4),
    ];

    // Act
    const matches = detectPatterns(bars);

    // Assert: 枠は入口の窓の手前のバーから確定バーまで
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'island_top',
        signal: 'bearish',
        label: 'アイランド天井',
        idx: 3,
        spanStart: 0,
      }),
    );
  });

  it('アイランドボトムを価格反転で検出する', () => {
    // Arrange: アイランド天井を 220 で反転させた鏡像
    const bars = [
      bar(120, 122, 115, 116, 1),
      bar(110, 112, 105, 108, 2),
      bar(109, 113, 104, 112, 3),
      bar(120, 125, 116, 124, 4),
    ];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({
        type: 'island_bottom',
        signal: 'bullish',
        label: 'アイランドボトム',
        idx: 3,
        spanStart: 0,
      }),
    );
    expect(matches.some((m) => m.type === 'island_top')).toBe(false);
  });

  it('逆向きの内部の窓で島が終わり、入口の窓を使い回さない', () => {
    // Arrange: 上窓 1 つのあと下窓が 4 本続く。島は最初の下窓で終わる
    const bars = [
      bar(100, 105, 98, 104, 1),
      bar(110, 115, 108, 112, 2),
      bar(96, 106, 95, 100, 3),
      bar(86, 94, 85, 90, 4),
      bar(76, 84, 75, 80, 5),
      bar(66, 74, 65, 70, 6),
    ];

    // Act
    const matches = detectPatterns(bars).filter((m) => m.type === 'island_top');

    // Assert: 成立は 1 件だけ（使い回すと枠が 4 枚重なり矢印も 4 つ並ぶ）
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual(expect.objectContaining({ idx: 2, spanStart: 0 }));
  });

  it('島が ISLAND_MAX_LEN を超えるアイランドは検出しない', () => {
    // Arrange: 島 6 本（入口の上窓が探索範囲の外に出る）
    const bars = [
      bar(100, 105, 98, 104, 1),
      bar(110, 115, 108, 112, 2),
      bar(112, 116, 109, 114, 3),
      bar(114, 118, 111, 116, 4),
      bar(116, 120, 113, 118, 5),
      bar(118, 122, 115, 120, 6),
      bar(120, 124, 117, 122, 7),
      bar(110, 116, 105, 106, 8),
    ];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches.some((m) => m.type === 'island_top')).toBe(false);
  });

  it('島がちょうど ISLAND_MAX_LEN のアイランドは検出する', () => {
    // Arrange: 上のケースから島を 1 本減らして 5 本にする（境界の内側）
    const bars = [
      bar(100, 105, 98, 104, 1),
      bar(110, 115, 108, 112, 2),
      bar(112, 116, 109, 114, 3),
      bar(114, 118, 111, 116, 4),
      bar(116, 120, 113, 118, 5),
      bar(118, 122, 115, 120, 6),
      bar(110, 114, 105, 106, 7),
    ];

    // Act
    const matches = detectPatterns(bars);

    // Assert
    expect(matches).toContainEqual(
      expect.objectContaining({ type: 'island_top', idx: 6, spanStart: 0 }),
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
    expect(detectPatterns(single).some((m) => m.type === 'bullish_harami')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'morning_star')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'two_black_gapping')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'upside_gap_two_white')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'hanging_man')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'island_top')).toBe(false);
    expect(detectPatterns(single).some((m) => m.type === 'island_bottom')).toBe(false);
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
    // Arrange: 前足を包み、かつハンマー条件も満たす強気足（助走で下降文脈を作る）
    const bars = [...downtrendPrefix(), bar(144, 152, 128, 151, 12)];
    const matches = detectPatterns(bars);

    // Act
    const map = buildPatternMap(matches);

    // Assert: idx 11 に陽線包み + ハンマーの 2 件
    const atBar11 = map.get(11) ?? [];
    expect(atBar11.length).toBeGreaterThanOrEqual(2);
    const types = atBar11.map((m) => m.type);
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
