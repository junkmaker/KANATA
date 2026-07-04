import type { CandlePatternType, OHLCBar, PatternMatch, PatternSignal } from '../types';

// 判定の閾値（マジックナンバー禁止・名前付き定数に集約）
const DOJI_BODY_RATIO = 0.1; // 実体がレンジの 10% 以下なら同時線
const HAMMER_LOWER_RATIO = 2; // 下ヒゲが実体の 2 倍以上
const HAMMER_UPPER_RATIO = 0.25; // 上ヒゲがレンジの 25% 以下
const STAR_BODY_RATIO = 0.3; // 宵の明星・中央足の小実体判定（レンジ比）

const LABELS: Record<CandlePatternType, string> = {
  bullish_engulfing: '陽線包み',
  doji: '同時線',
  evening_star: '宵の明星',
  hammer: 'ハンマー',
};

const SIGNALS: Record<CandlePatternType, PatternSignal> = {
  bullish_engulfing: 'bullish',
  doji: 'neutral',
  evening_star: 'bearish',
  hammer: 'bullish',
};

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

function makeMatch(
  type: CandlePatternType,
  bars: OHLCBar[],
  idx: number,
  spanStart: number,
): PatternMatch {
  return {
    type,
    signal: SIGNALS[type],
    label: LABELS[type],
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

// ハンマー: 小さい実体・長い下ヒゲ・短い上ヒゲ（レンジ 0・実体 0 は非検出）。
function detectHammer(bars: OHLCBar[], i: number): PatternMatch | null {
  const cur = bars[i];
  const r = range(cur);
  const b = body(cur);
  if (r <= 0 || b <= 0) return null;
  const upperShadow = cur.h - Math.max(cur.o, cur.c);
  const lowerShadow = Math.min(cur.o, cur.c) - cur.l;
  if (lowerShadow >= HAMMER_LOWER_RATIO * b && upperShadow <= HAMMER_UPPER_RATIO * r) {
    return makeMatch('hammer', bars, i, i);
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

const DETECTORS: Array<(bars: OHLCBar[], i: number) => PatternMatch | null> = [
  detectBullishEngulfing,
  detectDoji,
  detectHammer,
  detectEveningStar,
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
