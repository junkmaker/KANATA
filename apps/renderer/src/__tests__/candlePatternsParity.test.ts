import { describe, expect, it } from 'vitest';
import rawFixture from '../../../../tests/fixtures/candle_patterns_cases.json';
import { detectPatterns, PATTERN_TYPES } from '../lib/candlePatterns';
import type { CandlePatternType, OHLCBar, PatternSignal } from '../types';

// Python 側（backend/tests/test_candle_patterns.py）と同じ JSON を読む。
// 片方の定義だけを変えると必ずどちらかが落ちる、というのがこのテストの存在理由。
type Fixture = {
  patterns: CandlePatternType[];
  labels: Record<CandlePatternType, string>;
  signals: Record<CandlePatternType, PatternSignal>;
  cases: Array<{
    name: string;
    bars: number[][];
    expect: Partial<Record<CandlePatternType, number[]>>;
  }>;
};

const fixture = rawFixture as unknown as Fixture;

function toBars(rows: number[][]): OHLCBar[] {
  return rows.map(([o, h, l, c], i) => ({ o, h, l, c, t: i + 1, v: 0 }));
}

describe('共有フィクスチャ（TS/Python 一致）', () => {
  it('フィクスチャの型がすべて TS 側に登録されている', () => {
    // Assert: Python 側 test_fixture_patterns_are_all_registered と同じ部分集合の表明。
    // 発火したものだけを見ると「TS に無い型」を素通りさせるので、登録一覧と直接突き合わせる
    expect(PATTERN_TYPES).toEqual(expect.arrayContaining(fixture.patterns));
  });

  it('フィクスチャの全型に陽性ケースがある（label/signal 検証を空振りさせない）', () => {
    // Arrange: どの型がいずれかのケースで発火を期待されているか
    const withPositiveCase = new Set(fixture.cases.flatMap((c) => Object.keys(c.expect)));

    // Assert: 陽性ケースの無い型は下の label/signal 検証を通過してしまう
    expect([...fixture.patterns].sort()).toEqual([...withPositiveCase].sort());
  });

  it('検出結果の label/signal がフィクスチャの表記と一致する', () => {
    // Arrange: 全ケースを検出器に通し、label/signal の実物を集める
    const seen = new Map<string, { label: string; signal: string }>();
    for (const c of fixture.cases) {
      for (const m of detectPatterns(toBars(c.bars))) {
        seen.set(m.type, { label: m.label, signal: m.signal });
      }
    }

    // Assert: 上のテストにより、ここは全型ぶん回ることが保証されている
    expect([...seen.keys()].sort()).toEqual([...fixture.patterns].sort());
    for (const [type, { label, signal }] of seen) {
      expect(label).toBe(fixture.labels[type as CandlePatternType]);
      expect(signal).toBe(fixture.signals[type as CandlePatternType]);
    }
  });

  it.each(
    fixture.cases.map((c) => [c.name, c] as const),
  )('%s の検出 index が期待と完全一致する', (_name, c) => {
    // Arrange
    const bars = toBars(c.bars);

    // Act
    const matches = detectPatterns(bars);

    // Assert: expect は網羅。キーの無いパターンは 0 件でなければならない
    const actual = Object.fromEntries(
      fixture.patterns.map((p) => [
        p,
        matches
          .filter((m) => m.type === p)
          .map((m) => m.idx)
          .sort((a, b) => a - b),
      ]),
    );
    const expected = Object.fromEntries(fixture.patterns.map((p) => [p, c.expect[p] ?? []]));
    expect(actual).toEqual(expected);
  });
});
