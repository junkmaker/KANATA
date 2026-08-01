import { describe, expect, it } from 'vitest';
import type { ScreeningResult, ScreeningScoreDetail } from '../types';
import {
  BADGE_DEFS,
  ageInDays,
  filterByAge,
  sortByBreakDate,
  toBadges,
} from '../lib/screeningView';

function detail(over: Partial<ScreeningScoreDetail> = {}): ScreeningScoreDetail {
  return {
    trend: 0,
    breakout: 0,
    volume: 0,
    macd: 0,
    pullback_penalty: 0,
    duration_penalty: 0,
    ...over,
  };
}

function result(over: Partial<ScreeningResult> = {}): ScreeningResult {
  return {
    ticker: '7203',
    name: 'トヨタ自動車',
    market_cap: null,
    score: 50,
    score_detail: detail(),
    pivots: [],
    break_date: '2026-07-01',
    closes: [],
    ...over,
  };
}

describe('sortByBreakDate', () => {
  it('ブレイク日の新しい順に並べる（スコアは順位に影響しない）', () => {
    const rows = [
      result({ ticker: '1111', break_date: '2026-07-01', score: 75 }),
      result({ ticker: '2222', break_date: '2026-07-10', score: 40 }),
      result({ ticker: '3333', break_date: '2026-07-05', score: 65 }),
    ];

    expect(sortByBreakDate(rows).map((r) => r.ticker)).toEqual(['2222', '3333', '1111']);
  });

  it('同着は ticker 昇順（並びを決定的にする）', () => {
    const rows = [
      result({ ticker: '9984', break_date: '2026-07-10' }),
      result({ ticker: '6758', break_date: '2026-07-10' }),
      result({ ticker: '7203', break_date: '2026-07-10' }),
    ];

    expect(sortByBreakDate(rows).map((r) => r.ticker)).toEqual(['6758', '7203', '9984']);
  });

  it('入力を破壊しない', () => {
    const rows = [
      result({ ticker: '1111', break_date: '2026-07-01' }),
      result({ ticker: '2222', break_date: '2026-07-10' }),
    ];
    sortByBreakDate(rows);

    expect(rows.map((r) => r.ticker)).toEqual(['1111', '2222']);
  });
});

describe('toBadges', () => {
  it('発火した要素だけを BADGE_DEFS の順で返す', () => {
    const badges = toBadges(detail({ volume: 10, breakout: 15 }));

    expect(badges.map((b) => b.label)).toEqual(['強いブレイク', '出来高急増']);
  });

  it('trend と duration_penalty はバッジにしない', () => {
    // trend は TREND_BONUS=0 で常に 0、duration_penalty は 3 年で発火 1 件の死にコード。
    expect(BADGE_DEFS.map((b) => b.key)).not.toContain('trend');
    expect(BADGE_DEFS.map((b) => b.key)).not.toContain('duration_penalty');
    expect(toBadges(detail({ trend: 25, duration_penalty: 15 }))).toEqual([]);
  });

  it('pullback_penalty は減点ではなく事実として出す', () => {
    // 実測では減点群のほうが超過リターンが高い。UI に減点の含意を持ち込まない。
    expect(toBadges(detail({ pullback_penalty: 15 })).map((b) => b.label)).toEqual([
      '浅い押し目',
    ]);
  });

  it('何も発火していなければ空（それは「弱い候補」ではない）', () => {
    expect(toBadges(detail())).toEqual([]);
  });

  it('score_detail が無くても落ちない', () => {
    expect(toBadges(undefined)).toEqual([]);
  });
});

describe('ageInDays', () => {
  // generated_at は now_iso() 由来で常にオフセット付き（例 2026-07-08T09:30:00+09:00）。
  it('基準日との暦日差を返す', () => {
    expect(ageInDays('2026-07-01', '2026-07-08T09:30:00+09:00')).toBe(7);
  });

  it('オフセットや時刻でずれない（暦日どうしで引く）', () => {
    // 旧実装は generated_at を絶対時刻として扱ったため、この 2 例が 4 日と出て
    // 「3日以内」から落ちていた。実際は 3 日。
    expect(ageInDays('2026-07-05', '2026-07-08T20:00:00-05:00')).toBe(3);
    expect(ageInDays('2026-07-05', '2026-07-08T08:00:00+09:00')).toBe(3);
    expect(ageInDays('2026-07-05', '2026-07-08T23:59:59Z')).toBe(3);
  });

  it('未来日は 0 に丸める', () => {
    expect(ageInDays('2026-07-20', '2026-07-08T09:30:00+09:00')).toBe(0);
  });

  it('asOf が null ならローカル暦日を基準にする', () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    expect(ageInDays(today, null)).toBe(0);
  });

  it('解釈できない日付は null', () => {
    expect(ageInDays('未スキャン', '2026-07-08T09:30:00+09:00')).toBeNull();
    expect(ageInDays('2026-13-45', '2026-07-08T09:30:00+09:00')).toBeNull();
    expect(ageInDays('2026-07-01', 'not-a-date')).toBeNull();
  });
});

describe('filterByAge', () => {
  const rows = [
    result({ ticker: '1111', break_date: '2026-07-08' }), // 0 日
    result({ ticker: '2222', break_date: '2026-07-04' }), // 4 日
    result({ ticker: '3333', break_date: '2026-06-20' }), // 18 日
  ];
  const asOf = '2026-07-08T09:30:00+09:00';

  it('null なら全件返す（既定は絞らない）', () => {
    expect(filterByAge(rows, null, asOf)).toHaveLength(3);
  });

  it('指定日数以内だけ残す', () => {
    expect(filterByAge(rows, 7, asOf).map((r) => r.ticker)).toEqual(['1111', '2222']);
    expect(filterByAge(rows, 3, asOf).map((r) => r.ticker)).toEqual(['1111']);
  });

  it('経過日数を判定できない行は落とさず残す', () => {
    // 黙って消すと件数が合わない理由が読み手に分からなくなる。
    const withBroken = [...rows, result({ ticker: '4444', break_date: 'n/a' })];

    expect(filterByAge(withBroken, 3, asOf).map((r) => r.ticker)).toEqual(['1111', '4444']);
  });
});
