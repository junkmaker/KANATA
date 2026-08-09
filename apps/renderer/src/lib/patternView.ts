import type { CandlePatternType, PatternFilter, PatternSignal } from '../types';
import { PATTERN_LABELS, PATTERN_SIGNALS, PATTERN_TYPES } from './candlePatterns';

/**
 * パターンビューの表示順・方向グルーピング（純データ）。
 *
 * 検出ロジックからは独立しており、`candlePatterns.ts` の
 * `PATTERN_LABELS` / `PATTERN_SIGNALS` を**表示のために並べ替えるだけ**。
 * ラベル文字列をここで再定義しないのは、UI 側に写しを作った時点で
 * TS / Python / 共有フィクスチャの 3 者一致テストの外に出てしまうため。
 */

/** 方向の表示名。チップの見出し列と `PatternSignalBadge` が共有する。 */
export const SIGNAL_LABELS: Record<PatternSignal, string> = {
  bullish: '強気',
  bearish: '弱気',
  neutral: '中立',
};

/**
 * チップの表示順。**鏡像ペアが同じ位置に並ぶ**ように手で並べている
 * （強気 n 番目と弱気 n 番目が対）。`PATTERN_TYPES` は `Object.keys` 由来で
 * 検出器の登録順に依存するため、UI の並びをそこに委ねない。
 *
 * 型を増やしたらここにも足すこと。tsc は配列の網羅を強制できないので、
 * 漏れは `__tests__/patternView.test.ts` が落とす。
 */
export const PATTERN_DISPLAY_ORDER: CandlePatternType[] = [
  // 強気（弱気側と対の順）
  'bullish_engulfing',
  'bullish_harami',
  'hammer',
  'morning_star',
  'upside_gap_two_white',
  'island_bottom',
  // 弱気
  'bearish_engulfing',
  'bearish_harami',
  'hanging_man',
  'evening_star',
  'two_black_gapping',
  'island_top',
  // 中立
  'doji',
];

/** チップ 1 個ぶん。`label` はそのまま表示する。 */
export type PatternFilterChip = {
  value: PatternFilter;
  label: string;
};

/**
 * 見出し 1 行ぶん。`heading` が空文字なら見出しセルを空けて揃えだけ保つ。
 *
 * `ariaLabel` を `heading` と別に持つのは、「すべて」行の見出しが空で
 * 読み上げ名を作れないため。また「強気」だけでは何の群か伝わらないので、
 * 目で見える見出しより一段冗長にする（見出し側は `aria-hidden` にして二重読みを防ぐ）。
 */
export type PatternFilterGroup = {
  key: string;
  heading: string;
  ariaLabel: string;
  chips: PatternFilterChip[];
};

/** 見出し行の並び順（強気 → 弱気 → 中立）。 */
const SIGNAL_ORDER: PatternSignal[] = ['bullish', 'bearish', 'neutral'];

/**
 * 「すべて」+ 方向別 3 行。空の方向グループは出さない
 * （将来 `neutral` が 0 件になったときに見出しだけが残らないように）。
 */
export const PATTERN_FILTER_GROUPS: PatternFilterGroup[] = [
  {
    key: 'all',
    heading: '',
    ariaLabel: '絞り込みなし',
    chips: [{ value: 'all', label: 'すべて' }],
  },
  ...SIGNAL_ORDER.map((signal) => ({
    key: signal,
    heading: SIGNAL_LABELS[signal],
    ariaLabel: `${SIGNAL_LABELS[signal]}パターン`,
    chips: PATTERN_DISPLAY_ORDER.filter((t) => PATTERN_SIGNALS[t] === signal).map((t) => ({
      value: t as PatternFilter,
      label: PATTERN_LABELS[t],
    })),
  })).filter((g) => g.chips.length > 0),
];

/** 表示順に漏れ・重複が無いか（テストと開発時の自己点検用）。 */
export function missingFromDisplayOrder(): CandlePatternType[] {
  const shown = new Set(PATTERN_DISPLAY_ORDER);
  return PATTERN_TYPES.filter((t) => !shown.has(t));
}
