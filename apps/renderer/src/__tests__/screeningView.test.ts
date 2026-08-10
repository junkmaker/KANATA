import { describe, expect, it } from 'vitest';
import {
  AGE_LABEL,
  ageInDays,
  BADGE_DEFS,
  DEFAULT_MAX_AGE_DAYS,
  filterByAge,
  formatMarketCap,
  resolveMarketCap,
  sortByBreakDate,
  sortByDateDesc,
  toBadges,
} from '../lib/screeningView';
import type { PppResult, ScreeningResult, ScreeningScoreDetail } from '../types';

const byBreakDate = (r: ScreeningResult) => r.break_date;
const byEstablishedDate = (r: PppResult) => r.established_date;

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
    market_cap_asof: null,
    market_cap_date: null,
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

function pppResult(over: Partial<PppResult> = {}): PppResult {
  return {
    ticker: '7203',
    name: 'トヨタ自動車',
    market_cap: null,
    market_cap_asof: null,
    market_cap_date: null,
    established_date: '2026-07-01',
    duration_days: 5,
    closes: [],
    ...over,
  };
}

describe('sortByDateDesc', () => {
  it('成立日の新しい順に並べる（PPP でも並び順の規約は共通）', () => {
    const rows = [
      pppResult({ ticker: '1111', established_date: '2026-07-01' }),
      pppResult({ ticker: '2222', established_date: '2026-07-10' }),
      pppResult({ ticker: '3333', established_date: '2026-07-05' }),
    ];

    expect(sortByDateDesc(rows, byEstablishedDate).map((r) => r.ticker)).toEqual([
      '2222',
      '3333',
      '1111',
    ]);
  });

  it('同着は ticker 昇順', () => {
    const rows = [
      pppResult({ ticker: '9984', established_date: '2026-07-10' }),
      pppResult({ ticker: '6758', established_date: '2026-07-10' }),
      pppResult({ ticker: '7203', established_date: '2026-07-10' }),
    ];

    expect(sortByDateDesc(rows, byEstablishedDate).map((r) => r.ticker)).toEqual([
      '6758',
      '7203',
      '9984',
    ]);
  });

  it('入力を破壊しない', () => {
    const rows = [
      pppResult({ ticker: '1111', established_date: '2026-07-01' }),
      pppResult({ ticker: '2222', established_date: '2026-07-10' }),
    ];
    sortByDateDesc(rows, byEstablishedDate);

    expect(rows.map((r) => r.ticker)).toEqual(['1111', '2222']);
  });
});

describe('パターン別の表示規約', () => {
  it('鮮度ラベルはパターンごとに語が違う（選択肢は共有）', () => {
    expect(AGE_LABEL['n-pattern']).toBe('ブレイク');
    expect(AGE_LABEL.ppp).toBe('成立');
    // 登録漏れの検出（Record 型なので tsc も落とすが、実体でも確認する）
    expect(Object.keys(AGE_LABEL).sort()).toEqual(['n-pattern', 'ppp']);
  });

  it('既定の鮮度は N字=全件 / PPP=7日', () => {
    // PPP だけ絞るのは、成立イベントが 1 年窓で銘柄の 8 割超に出るため
    // （全件だとユニバースの部分集合コピーになる）。既定値の変更をここで固定する。
    expect(DEFAULT_MAX_AGE_DAYS['n-pattern']).toBeNull();
    expect(DEFAULT_MAX_AGE_DAYS.ppp).toBe(7);
    expect(Object.keys(DEFAULT_MAX_AGE_DAYS).sort()).toEqual(['n-pattern', 'ppp']);
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
    expect(toBadges(detail({ pullback_penalty: 15 })).map((b) => b.label)).toEqual(['浅い押し目']);
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
    expect(filterByAge(rows, null, asOf, byBreakDate)).toHaveLength(3);
  });

  it('指定日数以内だけ残す', () => {
    expect(filterByAge(rows, 7, asOf, byBreakDate).map((r) => r.ticker)).toEqual(['1111', '2222']);
    expect(filterByAge(rows, 3, asOf, byBreakDate).map((r) => r.ticker)).toEqual(['1111']);
  });

  it('経過日数を判定できない行は落とさず残す', () => {
    // 黙って消すと件数が合わない理由が読み手に分からなくなる。
    const withBroken = [...rows, result({ ticker: '4444', break_date: 'n/a' })];

    expect(filterByAge(withBroken, 3, asOf, byBreakDate).map((r) => r.ticker)).toEqual([
      '1111',
      '4444',
    ]);
  });

  it('アクセサ経由で PPP の成立日でも絞れる', () => {
    const rows = [
      pppResult({ ticker: '1111', established_date: '2026-07-08' }), // 0 日
      pppResult({ ticker: '2222', established_date: '2026-07-04' }), // 4 日
      pppResult({ ticker: '3333', established_date: '2026-06-20' }), // 18 日
    ];

    expect(filterByAge(rows, 7, asOf, byEstablishedDate).map((r) => r.ticker)).toEqual([
      '1111',
      '2222',
    ]);
    expect(filterByAge(rows, null, asOf, byEstablishedDate)).toHaveLength(3);
  });
});

describe('formatMarketCap', () => {
  it('兆・億で整形し、null は — にする', () => {
    expect(formatMarketCap(null)).toBe('—');
    expect(formatMarketCap(4.6e13)).toBe('46.0兆');
    expect(formatMarketCap(1e12)).toBe('1.0兆'); // 兆の境界
    expect(formatMarketCap(999_999_999_999)).toBe('10000億');
    expect(formatMarketCap(2.3e10)).toBe('230億');
    expect(formatMarketCap(1e8)).toBe('1億'); // 億の境界
    expect(formatMarketCap(50_000_000)).toBe('50000000'); // 億未満は生値
    expect(formatMarketCap(0)).toBe('0');
  });
});

describe('resolveMarketCap', () => {
  it('実施日の実測値があればそれを使い、基準日を title に出す', () => {
    const v = resolveMarketCap(
      result({ market_cap_asof: 5.1e13, market_cap_date: '2026-07-31', market_cap: 4.6e13 }),
    );

    expect(v.source).toBe('asof');
    expect(v.text).toBe('51.0兆');
    expect(v.title).toContain('2026-07-31');
  });

  it('実測値が無ければ CSV 値へ落とし、* と説明を付ける', () => {
    const v = resolveMarketCap(result({ market_cap_asof: null, market_cap: 4.6e13 }));

    expect(v.source).toBe('universe');
    expect(v.text).toBe('46.0兆*'); // 記号で出所が分かる（色だけに頼らない）
    expect(v.title).toContain('CSV');
  });

  it('どちらも無ければ — で source は none', () => {
    const v = resolveMarketCap(result());

    expect(v.source).toBe('none');
    expect(v.text).toBe('—');
  });

  it('PPP の行でも同じ規約で解決する（時価総額はパターン非依存）', () => {
    const v = resolveMarketCap(
      pppResult({ market_cap_asof: 5.1e13, market_cap_date: '2026-07-31' }),
    );

    expect(v.source).toBe('asof');
    expect(v.text).toBe('51.0兆');
  });

  it('実測値があれば CSV 値より優先する（古い値に戻らない）', () => {
    const v = resolveMarketCap(
      result({ market_cap_asof: 1e12, market_cap: 9.9e13, market_cap_date: '2026-07-31' }),
    );

    expect(v.text).toBe('1.0兆');
  });
});
