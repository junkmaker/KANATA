import type { IndiData, OHLCBar, YRange } from '../types';

/** レンジ上下に足す余白の比率 */
const PAD_RATIO = 0.08;

export interface PriceYRangeInput {
  /** 主銘柄の OHLC */
  data: OHLCBar[];
  /** 表示窓の先頭インデックス */
  start: number;
  /** 表示窓の末尾（実データ長でクランプ済み） */
  end: number;
  /** 一目の雲（未来 ICHI_DISPLACEMENT 本ぶん）を含む末尾 */
  cloudEnd: number;
  /** 算出済みの指標。キーが有る＝その指標が有効 */
  indi: IndiData;
}

/**
 * 価格ペインの Y レンジを表示窓から決める。
 *
 * ローソク足の高値安値に加えて、価格ペインへ重ねて描くオーバーレイ
 * （移動平均・ボリンジャー・一目の雲）もレンジに参加させる。
 * 移動平均を除くと、期間が長い線ほど価格帯から離れて枠外へ消える一方、
 * 凡例には値が出続けるという食い違いが起きる。
 */
export function computePriceYRange({ data, start, end, cloudEnd, indi }: PriceYRangeInput): YRange {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = start; i < end; i++) {
    const b = data[i];
    if (!b) continue;
    if (b.h > max) max = b.h;
    if (b.l < min) min = b.l;
  }

  /** 系列の [start, until) 区間で min/max を広げる。null は線の切れ目なので飛ばす */
  const extend = (series: (number | null)[] | undefined, until: number) => {
    if (!series) return;
    for (let i = start; i < until; i++) {
      const v = series[i];
      if (v == null) continue;
      if (v > max) max = v;
      if (v < min) min = v;
    }
  };

  extend(indi.sma5, end);
  extend(indi.sma25, end);
  extend(indi.sma75, end);
  extend(indi.sma200, end);
  extend(indi.ema20, end);

  if (indi.boll) {
    extend(indi.boll.upper, end);
    extend(indi.boll.lower, end);
  }

  if (indi.ichi) {
    extend(indi.ichi.senkouA, cloudEnd);
    extend(indi.ichi.senkouB, cloudEnd);
  }

  if (min === Number.POSITIVE_INFINITY) return { min: 0, max: 1 };

  const pad = (max - min) * PAD_RATIO;
  return { min: min - pad, max: max + pad };
}
