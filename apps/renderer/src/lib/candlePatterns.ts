import type { CandlePatternType, OHLCBar, PatternMatch, PatternSignal } from '../types';

// 判定の閾値（マジックナンバー禁止・名前付き定数に集約）
const DOJI_BODY_RATIO = 0.1; // 実体がレンジの 10% 以下なら同時線
const HAMMER_LOWER_RATIO = 2; // 下ヒゲが実体の 2 倍以上
const HAMMER_UPPER_RATIO = 0.25; // 上ヒゲがレンジの 25% 以下
const STAR_BODY_RATIO = 0.3; // 宵の明星・中央足の小実体判定（レンジ比）
const HARAMI_BODY_RATIO = 0.3; // はらみの前足に要求する大実体（レンジ比）
const SIDE_BY_SIDE_OPEN_TOLERANCE = 0.005; // 「並び」と見なす始値の相対許容差（0.5%）
const HAMMER_TREND_LOOKBACK = 10; // ハンマー/首吊り線のトレンド参照本数
const HAMMER_TREND_RATIO = 0.05; // トレンド成立の騰落率しきい値（±5%）
const ISLAND_MAX_LEN = 5; // アイランドの島の最大長（本）

/**
 * 表示ラベルの**単一の真実源**。UI（フィルタチップ・一覧・チャートのマーカー）は
 * すべてここを参照する。文字列は Python 側 `LABELS` と共有フィクスチャ
 * `tests/fixtures/candle_patterns_cases.json` の `labels` にも同じ値で存在し、
 * candlePatternsParity.test.ts が 3 者の一致を検証する。
 */
export const PATTERN_LABELS: Record<CandlePatternType, string> = {
  bearish_engulfing: '陰線包み',
  bearish_harami: '陰線はらみ',
  bullish_engulfing: '陽線包み',
  bullish_harami: '陽線はらみ',
  doji: '同時線',
  evening_star: '宵の明星',
  hammer: 'ハンマー',
  hanging_man: '首吊り線',
  island_bottom: 'アイランドボトム',
  island_top: 'アイランド天井',
  morning_star: '明けの明星',
  two_black_gapping: '下放れ二本黒',
  upside_gap_two_white: '上放れ並び赤',
};

/** 方向の単一の真実源。Python 側 `SIGNALS` / 共有フィクスチャの `signals` と一致する。 */
export const PATTERN_SIGNALS: Record<CandlePatternType, PatternSignal> = {
  bearish_engulfing: 'bearish',
  bearish_harami: 'bearish',
  bullish_engulfing: 'bullish',
  bullish_harami: 'bullish',
  doji: 'neutral',
  evening_star: 'bearish',
  hammer: 'bullish',
  hanging_man: 'bearish',
  island_bottom: 'bullish',
  island_top: 'bearish',
  morning_star: 'bullish',
  two_black_gapping: 'bearish',
  upside_gap_two_white: 'bullish',
};

// 登録済みパターンのランタイム一覧。`PATTERN_LABELS` は Record<CandlePatternType, string> なので
// union に型を足した時点で tsc が登録を強制し、この配列も自動で追随する。
// 共有フィクスチャが「TS にまだ無い型」を先に載せていないかを検証するために公開している。
export const PATTERN_TYPES = Object.keys(PATTERN_LABELS) as CandlePatternType[];

function isBullish(bar: OHLCBar): boolean {
  return bar.c > bar.o;
}

function isBearish(bar: OHLCBar): boolean {
  return bar.c < bar.o;
}

function body(bar: OHLCBar): number {
  return Math.abs(bar.c - bar.o);
}

function range(bar: OHLCBar): number {
  return bar.h - bar.l;
}

// 窓（ギャップ）は高安基準 — ヒゲを含めて重ならないことを窓とする。
// 接触（prev.h === cur.l）は窓ではない。Python 側 has_gap_up / has_gap_down と同値。
// 明星の require_gap は実体基準だが既定 off で UI 経路では未使用のため統一していない。
function hasGapUp(prev: OHLCBar, cur: OHLCBar): boolean {
  return prev.h < cur.l;
}

function hasGapDown(prev: OHLCBar, cur: OHLCBar): boolean {
  return prev.l > cur.h;
}

// 直前バーまでの騰落率。終点を当日にしないのは、ハンマー自身の下ヒゲで戻す動きが
// トレンド判定に混ざるのを避けるため。参照元が無い / 分母 0 は null（＝文脈なし）。
// Python 側 trend_change_ratio と同値。Phase 6 の流れ星/逆ハンマーが再利用する。
function trendChangeRatio(bars: OHLCBar[], i: number): number | null {
  const baseIdx = i - 1 - HAMMER_TREND_LOOKBACK;
  if (baseIdx < 0) return null;
  const base = bars[baseIdx].c;
  if (base === 0) return null;
  return (bars[i - 1].c - base) / base;
}

// ハンマー型の形状条件だけ（トレンド文脈は見ない）。ハンマーと首吊り線が共有する。
function hasHammerShape(bar: OHLCBar): boolean {
  const r = range(bar);
  const b = body(bar);
  if (r <= 0 || b <= 0) return false;
  const upperShadow = bar.h - Math.max(bar.o, bar.c);
  const lowerShadow = Math.min(bar.o, bar.c) - bar.l;
  return lowerShadow >= HAMMER_LOWER_RATIO * b && upperShadow <= HAMMER_UPPER_RATIO * r;
}

function makeMatch(
  type: CandlePatternType,
  bars: OHLCBar[],
  idx: number,
  spanStart: number,
): PatternMatch {
  return {
    type,
    signal: PATTERN_SIGNALS[type],
    label: PATTERN_LABELS[type],
    idx,
    spanStart,
    spanEnd: idx,
    t: bars[idx].t,
  };
}

// 陽線包み: 前足が弱気、当足が強気で、当足の実体が前足の実体を包む。
function detectBullishEngulfing(bars: OHLCBar[], i: number): PatternMatch | null {
  if (i < 1) return null;
  const prev = bars[i - 1];
  const cur = bars[i];
  if (!isBearish(prev) || !isBullish(cur)) return null;
  if (cur.o <= prev.c && cur.c >= prev.o) {
    return makeMatch('bullish_engulfing', bars, i, i - 1);
  }
  return null;
}

// 陰線包み: 陽線包みの鏡像（前足が強気、当足が弱気で前足の実体を包む）。
function detectBearishEngulfing(bars: OHLCBar[], i: number): PatternMatch | null {
  if (i < 1) return null;
  const prev = bars[i - 1];
  const cur = bars[i];
  if (!isBullish(prev) || !isBearish(cur)) return null;
  if (cur.o >= prev.c && cur.c <= prev.o) {
    return makeMatch('bearish_engulfing', bars, i, i - 1);
  }
  return null;
}

// 陽線はらみ: 大陰線の実体に、翌足の陽線の実体が内包される（包みの内外反転）。
function detectBullishHarami(bars: OHLCBar[], i: number): PatternMatch | null {
  if (i < 1) return null;
  const prev = bars[i - 1];
  const cur = bars[i];
  if (!isBearish(prev) || !isBullish(cur)) return null;
  const prevRange = range(prev);
  // 前足に大実体を要求する（ヒゲばかりで方向感の無い前足を除く）。
  // 実体/レンジの比なので価格水準には依らず、レンジ自体が小さいバーは除外しない。
  if (prevRange <= 0 || body(prev) < HARAMI_BODY_RATIO * prevRange) return null;
  if (cur.o >= prev.c && cur.c <= prev.o) {
    return makeMatch('bullish_harami', bars, i, i - 1);
  }
  return null;
}

// 陰線はらみ: 陽線はらみの鏡像（大陽線の実体に小陰線が収まる）。
function detectBearishHarami(bars: OHLCBar[], i: number): PatternMatch | null {
  if (i < 1) return null;
  const prev = bars[i - 1];
  const cur = bars[i];
  if (!isBullish(prev) || !isBearish(cur)) return null;
  const prevRange = range(prev);
  if (prevRange <= 0 || body(prev) < HARAMI_BODY_RATIO * prevRange) return null;
  if (cur.c >= prev.o && cur.o <= prev.c) {
    return makeMatch('bearish_harami', bars, i, i - 1);
  }
  return null;
}

// 同時線: 実体がレンジの一定割合以下（レンジ 0 は非検出）。
function detectDoji(bars: OHLCBar[], i: number): PatternMatch | null {
  const cur = bars[i];
  const r = range(cur);
  if (r <= 0) return null;
  if (body(cur) <= DOJI_BODY_RATIO * r) {
    return makeMatch('doji', bars, i, i);
  }
  return null;
}

// ハンマー: ハンマー型の形状 + 下降トレンド後（騰落率 <= -HAMMER_TREND_RATIO）。
// 形状だけで判定していた旧定義を Phase 3 で三分化した。上昇後は首吊り線、
// 横ばい（±HAMMER_TREND_RATIO の間）はどちらも出さない。
function detectHammer(bars: OHLCBar[], i: number): PatternMatch | null {
  if (!hasHammerShape(bars[i])) return null;
  const ratio = trendChangeRatio(bars, i);
  if (ratio === null || ratio > -HAMMER_TREND_RATIO) return null;
  return makeMatch('hammer', bars, i, i);
}

// 首吊り線: ハンマーと同一形状 + 上昇トレンド後。しきい値が対称なので同時に立たない。
function detectHangingMan(bars: OHLCBar[], i: number): PatternMatch | null {
  if (!hasHammerShape(bars[i])) return null;
  const ratio = trendChangeRatio(bars, i);
  if (ratio === null || ratio < HAMMER_TREND_RATIO) return null;
  return makeMatch('hanging_man', bars, i, i);
}

// 明けの明星: 弱気の大陰線 → 小実体 → 強気足が 1 本目の中点を上回る 3 本構成。
function detectMorningStar(bars: OHLCBar[], i: number): PatternMatch | null {
  if (i < 2) return null;
  const first = bars[i - 2];
  const star = bars[i - 1];
  const cur = bars[i];
  if (!isBearish(first) || !isBullish(cur)) return null;
  const firstRange = range(first);
  const starRange = range(star);
  if (firstRange <= 0 || starRange <= 0) return null;
  // 1 本目は大陰線、2 本目は小実体
  if (body(first) < STAR_BODY_RATIO * firstRange) return null;
  if (body(star) > STAR_BODY_RATIO * starRange) return null;
  // 3 本目が 1 本目の実体中点を上回る
  const firstMid = (first.o + first.c) / 2;
  if (cur.c > firstMid) {
    return makeMatch('morning_star', bars, i, i - 2);
  }
  return null;
}

// 宵の明星: 強気の大陽線 → 小実体 → 弱気足が 1 本目の中点を割り込む 3 本構成。
function detectEveningStar(bars: OHLCBar[], i: number): PatternMatch | null {
  if (i < 2) return null;
  const first = bars[i - 2];
  const star = bars[i - 1];
  const cur = bars[i];
  if (!isBullish(first) || !isBearish(cur)) return null;
  const firstRange = range(first);
  const starRange = range(star);
  if (firstRange <= 0 || starRange <= 0) return null;
  // 1 本目は大陽線、2 本目は小実体
  if (body(first) < STAR_BODY_RATIO * firstRange) return null;
  if (body(star) > STAR_BODY_RATIO * starRange) return null;
  // 3 本目が 1 本目の実体中点を割り込む
  const firstMid = (first.o + first.c) / 2;
  if (cur.c < firstMid) {
    return makeMatch('evening_star', bars, i, i - 2);
  }
  return null;
}

// 下放れ二本黒: 下窓のあと陰線が 2 本続き、2 本目が終値を切り下げる（継続パターン）。
// 他の検出器と違い反転ではなく継続を示すため、矢印は下降の継続方向を指す。
function detectTwoBlackGapping(bars: OHLCBar[], i: number): PatternMatch | null {
  if (i < 2) return null;
  const before = bars[i - 2];
  const first = bars[i - 1];
  const cur = bars[i];
  if (!hasGapDown(before, first)) return null;
  if (!isBearish(first) || !isBearish(cur)) return null;
  // 終値を切り下げること（切り上げたら継続の形にならない）
  if (cur.c >= first.c) return null;
  return makeMatch('two_black_gapping', bars, i, i - 2);
}

// 上放れ並び赤: 上窓のあと陽線が 2 本並び、2 本目がほぼ同じ始値で寄る（継続パターン）。
function detectUpsideGapTwoWhite(bars: OHLCBar[], i: number): PatternMatch | null {
  if (i < 2) return null;
  const before = bars[i - 2];
  const first = bars[i - 1];
  const cur = bars[i];
  if (!hasGapUp(before, first)) return null;
  if (!isBullish(first) || !isBullish(cur)) return null;
  // 「並び」は始値の近接のみで判定する（実体サイズの近接は条件に入れない）
  if (Math.abs(cur.o - first.o) > SIDE_BY_SIDE_OPEN_TOLERANCE * Math.abs(first.o)) return null;
  return makeMatch('upside_gap_two_white', bars, i, i - 2);
}

// アイランド（天井/底）の共通実装。島の長さが可変なので、この 2 種だけ検出器の中に
// 開始候補の探索ループがある。ハイライト枠は入口の窓の手前のバーから（Phase 2 の窓系と
// 同じ流儀）。Python 側 _detect_island と同値。
//
// 島の内部に **入口と同じ向き** の窓があってもよいが、**逆向きの内部の窓は島を終わらせる**。
// その窓こそが直前の島の出口であり、そこより手前は別の島だから — 見逃すと 1 つの入口の窓が
// 後続のすべての出口の窓に使い回され、同じ入口から始まる島が何本も重なって描かれる。
function detectIsland(
  bars: OHLCBar[],
  i: number,
  type: 'island_top' | 'island_bottom',
): PatternMatch | null {
  const entryGapUp = type === 'island_top';
  const entered = (a: number, b: number) =>
    entryGapUp ? hasGapUp(bars[a], bars[b]) : hasGapDown(bars[a], bars[b]);
  const exited = (a: number, b: number) =>
    entryGapUp ? hasGapDown(bars[a], bars[b]) : hasGapUp(bars[a], bars[b]);

  const e = i - 1; // 島の最終バー
  if (e < 1) return null;
  if (!exited(e, i)) return null;
  const lo = Math.max(1, e - ISLAND_MAX_LEN + 1);
  // 逆向きの内部の窓があれば、そこが直前の島の出口。島の開始はその後ろに限る
  let sMin = lo;
  for (let k = e; k > lo; k--) {
    if (exited(k - 1, k)) {
      sMin = k;
      break;
    }
  }
  // 開始候補は長い島から見る（到達できる範囲で最も早い窓を島の入口とする）
  for (let s = sMin; s <= e; s++) {
    if (entered(s - 1, s)) {
      return makeMatch(type, bars, i, s - 1);
    }
  }
  return null;
}

// アイランド天井: 上窓で切り離された島（最大 ISLAND_MAX_LEN 本）が下窓で終わる。
function detectIslandTop(bars: OHLCBar[], i: number): PatternMatch | null {
  return detectIsland(bars, i, 'island_top');
}

// アイランドボトム: アイランド天井の鏡像（下窓で入り上窓で出る）。
function detectIslandBottom(bars: OHLCBar[], i: number): PatternMatch | null {
  return detectIsland(bars, i, 'island_bottom');
}

const DETECTORS: Array<(bars: OHLCBar[], i: number) => PatternMatch | null> = [
  detectBullishEngulfing,
  detectBearishEngulfing,
  detectBullishHarami,
  detectBearishHarami,
  detectDoji,
  detectHammer,
  detectHangingMan,
  detectMorningStar,
  detectEveningStar,
  detectTwoBlackGapping,
  detectUpsideGapTwoWhite,
  detectIslandTop,
  detectIslandBottom,
];

// 全バーを走査し、各検出器のヒットを集約する。同一バーに複数ヒット可。
export function detectPatterns(bars: OHLCBar[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (let i = 0; i < bars.length; i++) {
    for (const detect of DETECTORS) {
      const m = detect(bars, i);
      if (m) matches.push(m);
    }
  }
  return matches;
}

// 確定バー index をキーにマッチをまとめる（sqEvents と同じイミュータブル更新）。
export function buildPatternMap(matches: PatternMatch[]): Map<number, PatternMatch[]> {
  const map = new Map<number, PatternMatch[]>();
  for (const m of matches) {
    const existing = map.get(m.spanEnd);
    map.set(m.spanEnd, existing ? [...existing, m] : [m]);
  }
  return map;
}
