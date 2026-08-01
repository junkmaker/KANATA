import type { ScreeningResult, ScreeningScoreDetail } from '../types';

/**
 * スクリーニング表の並び替え・バッジ導出・鮮度フィルタ（純関数）。
 *
 * スコアを表に出さないのは、前方リターンの予測力が無いことがバックテストで
 * 確定したため（docs/n_pattern_backtest_spec.md §16.2）。順位付けにも絞り込みにも
 * スコアを使わず、**ブレイク日の鮮度**という作業上の軸だけで扱う。
 */

/** バッジ 1 個ぶん。`label` はそのまま表示する。 */
export type ScreeningBadge = {
  key: keyof ScreeningScoreDetail;
  label: string;
};

/**
 * バッジに出す要素と表示名。
 *
 * `trend` と `duration_penalty` を含めないのは実測に基づく判断:
 * 前者は `TREND_BONUS = 0` のため常に 0、後者は 3 年で発火 1 件の死にコード。
 * `TREND_BONUS` を将来戻すなら、ここにも `trend` を戻すこと。
 *
 * `pullback_penalty` は内部名が「penalty」だが、実測では**減点された群のほうが
 * 超過リターンが高い**（+1.63%、中央値 +1.77%）。UI では減点という含意を持ち込まず
 * 「浅い押し目」という事実だけを出す。
 */
export const BADGE_DEFS: ScreeningBadge[] = [
  { key: 'breakout', label: '強いブレイク' },
  { key: 'volume', label: '出来高急増' },
  { key: 'macd', label: 'MACD GC' },
  { key: 'pullback_penalty', label: '浅い押し目' },
];

/** 鮮度フィルタの選択肢（暦日）。`null` は全件。既定は全件 — 絞ると見落とすため。 */
export const AGE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '全件' },
  { value: 3, label: '3日以内' },
  { value: 7, label: '7日以内' },
];

/**
 * ブレイク日の新しい順。同着は ticker 昇順（並びを決定的にするため）。
 *
 * バックエンドも同じ順に並べるが、表示前に非破壊で並べ直して二重に担保する
 * （旧バージョンが書いた結果 JSON がスコア順のまま残っていても正しく出る）。
 */
export function sortByBreakDate(results: ScreeningResult[]): ScreeningResult[] {
  return [...results].sort((a, b) => {
    if (a.break_date !== b.break_date) return a.break_date < b.break_date ? 1 : -1;
    return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
  });
}

/**
 * 発火した要素のバッジを返す。
 *
 * **良し悪しの評価ではなく、パターンの事実**として並べる。数を数えて順位付けに
 * 使ってはいけない（各要素は個別に無情報だと実測済み）。
 */
export function toBadges(detail: ScreeningScoreDetail | undefined): ScreeningBadge[] {
  if (!detail) return [];
  return BADGE_DEFS.filter((b) => (detail[b.key] ?? 0) !== 0);
}

/** 先頭の `YYYY-MM-DD`。以降の時刻・オフセットは意図的に見ない。 */
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * 日付文字列の**暦日部分だけ**を UTC 0 時のミリ秒に写す。解釈できなければ `null`。
 *
 * `break_date` は市場の営業日（`2026-07-05`）、`generated_at` はオフセット付きの
 * 絶対時刻（`2026-07-08T20:00:00-05:00`）と型が違う。後者を `Date.parse` で
 * 瞬間として扱うと、両者の差にマシンの UTC オフセットとスキャン時刻が混入し、
 * 暦日差が 1 日ずれる（実測: 上の 2 例は 3 日なのに 4 と出て「3日以内」から落ちる）。
 * **両辺とも暦日へ落としてから引く**ことでずれを断つ。文字列のオフセットを
 * そのまま暦日として読むので、実行環境のタイムゾーンにも依存しない。
 */
function calendarDayMs(value: string): number | null {
  const m = CALENDAR_DATE_RE.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // Date.UTC は 2026-13-45 のような値を繰り上げて受理するため往復で弾く。
  const valid =
    back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day;
  return valid ? ms : null;
}

/**
 * ブレイク日から基準日までの経過日数（暦日）。
 *
 * 営業日ではなく暦日で近似するのは、レンダラーに祝日表が無いため。
 * **並び順には影響しない**ので、絞り込みの粒度としてはこれで足りる。
 * `asOf` が null なら実行環境のローカル暦日を基準にする。
 * 不正な日付は `null`（＝フィルタで落とさない）。
 */
export function ageInDays(breakDate: string, asOf: string | null): number | null {
  const b = calendarDayMs(breakDate);
  if (b === null) return null;
  const now = new Date();
  const base =
    asOf === null
      ? Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
      : calendarDayMs(asOf);
  if (base === null) return null;
  // 両辺とも UTC 0 時なので差は必ず 86400000 の倍数（round は桁落ち保険）。
  const days = Math.round((base - b) / 86_400_000);
  return days < 0 ? 0 : days;
}

/**
 * 鮮度で絞る。`maxAgeDays` が null なら全件。
 *
 * 経過日数を判定できない行は**落とさず残す**。日付の解釈に失敗しただけの行を
 * 黙って消すと、件数が合わない理由が読み手に分からなくなる。
 */
export function filterByAge(
  results: ScreeningResult[],
  maxAgeDays: number | null,
  asOf: string | null,
): ScreeningResult[] {
  if (maxAgeDays === null) return results;
  return results.filter((r) => {
    const age = ageInDays(r.break_date, asOf);
    return age === null || age <= maxAgeDays;
  });
}
