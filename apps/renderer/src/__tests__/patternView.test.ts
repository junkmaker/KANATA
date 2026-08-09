import { describe, expect, it } from 'vitest';
import { PATTERN_LABELS, PATTERN_SIGNALS, PATTERN_TYPES } from '../lib/candlePatterns';
import {
  missingFromDisplayOrder,
  PATTERN_DISPLAY_ORDER,
  PATTERN_FILTER_GROUPS,
  SIGNAL_LABELS,
} from '../lib/patternView';
import type { CandlePatternType } from '../types';

describe('PATTERN_DISPLAY_ORDER', () => {
  it('登録済みの全パターンをちょうど 1 回ずつ含む', () => {
    // Assert: tsc は配列の網羅を強制できない。型を足して並びに入れ忘れると
    // 「チャートには出るがチップで選べない」型が静かに生まれる
    expect([...PATTERN_DISPLAY_ORDER].sort()).toEqual([...PATTERN_TYPES].sort());
    expect(new Set(PATTERN_DISPLAY_ORDER).size).toBe(PATTERN_DISPLAY_ORDER.length);
  });

  it('missingFromDisplayOrder が漏れゼロを報告する', () => {
    expect(missingFromDisplayOrder()).toEqual([]);
  });
});

describe('PATTERN_FILTER_GROUPS', () => {
  it('先頭が「すべて」の単独行になっている', () => {
    // Assert: 「すべて」はどの方向にも属さない。見出しは空でセルだけ確保する
    expect(PATTERN_FILTER_GROUPS[0]).toEqual({
      key: 'all',
      heading: '',
      ariaLabel: '絞り込みなし',
      chips: [{ value: 'all', label: 'すべて' }],
    });
  });

  it('全グループが空でない ariaLabel を持つ', () => {
    // Assert: 「すべて」行は heading が空なので、読み上げ名を heading から作れない。
    // 空文字のまま aria-label に渡すと group が無名になり、行の意味が失われる
    for (const g of PATTERN_FILTER_GROUPS) {
      expect(g.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it('方向グループが強気→弱気→中立の順に並ぶ', () => {
    // Arrange
    const headings = PATTERN_FILTER_GROUPS.slice(1).map((g) => g.heading);

    // Assert
    expect(headings).toEqual([SIGNAL_LABELS.bullish, SIGNAL_LABELS.bearish, SIGNAL_LABELS.neutral]);
  });

  it('チップの label が PATTERN_LABELS と一致する（表示側での写し書きを禁じる）', () => {
    // Act: 「すべて」を除く全チップ
    const chips = PATTERN_FILTER_GROUPS.slice(1).flatMap((g) => g.chips);

    // Assert: ここが落ちるのは patternView.ts にラベルを直書きしたとき。
    // 直書きすると Python / 共有フィクスチャとの一致テストが効かなくなる
    for (const c of chips) {
      expect(c.label).toBe(PATTERN_LABELS[c.value as CandlePatternType]);
    }
  });

  it('各チップが自分の方向のグループにだけ入る', () => {
    for (const g of PATTERN_FILTER_GROUPS.slice(1)) {
      for (const c of g.chips) {
        const signal = PATTERN_SIGNALS[c.value as CandlePatternType];
        expect(SIGNAL_LABELS[signal]).toBe(g.heading);
      }
    }
  });

  it('全パターンがちょうど 1 個のチップとして現れる', () => {
    // Assert: グループ分けの過程で落ちた型・重複した型を捕まえる
    const values = PATTERN_FILTER_GROUPS.slice(1).flatMap((g) => g.chips.map((c) => c.value));
    expect([...values].sort()).toEqual([...PATTERN_TYPES].sort());
  });
});
