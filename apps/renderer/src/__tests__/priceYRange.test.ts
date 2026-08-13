import { describe, expect, it } from 'vitest';
import { computePriceYRange } from '../lib/priceYRange';
import type { IndiData, OHLCBar } from '../types';

/**
 * 価格ペインの Y レンジ算出テスト。
 *
 * 主眼は「価格ペインに重ねて描くものは全てレンジに参加する」こと。
 * 移動平均が参加していないと、長期線ほど枠外へ消えるのに凡例には値が出る。
 */

const bars = (rows: [low: number, high: number][]): OHLCBar[] =>
  rows.map(([l, h], i) => ({ t: i * 86_400_000, o: l, h, l, c: h, v: 100 }));

/** パディングを外して素の min / max に戻す（レンジは上下に 8% ずつ広げられる） */
const unpad = ({ min, max }: { min: number; max: number }) => {
  const span = (max - min) / 1.16;
  return { min: min + span * 0.08, max: max - span * 0.08 };
};

const input = (
  data: OHLCBar[],
  indi: IndiData = {},
  over: Partial<{ start: number; end: number; cloudEnd: number }> = {},
) => ({
  data,
  start: 0,
  end: data.length,
  cloudEnd: data.length,
  indi,
  ...over,
});

describe('computePriceYRange', () => {
  it('ローソク足の高値安値から決まり、上下に 8% の余白が付く', () => {
    const r = computePriceYRange(input(bars([[100, 200]])));
    expect(r.min).toBeCloseTo(92, 6);
    expect(r.max).toBeCloseTo(208, 6);
  });

  it('表示窓の外のバーは無視する', () => {
    const data = bars([
      [10, 20],
      [100, 200],
    ]);
    const r = unpad(computePriceYRange(input(data, {}, { start: 1, end: 2 })));
    expect(r.min).toBeCloseTo(100, 6);
    expect(r.max).toBeCloseTo(200, 6);
  });

  it('価格帯から離れた MA200 までレンジを広げる（枠外にクリップしない）', () => {
    const data = bars([
      [1000, 1100],
      [1000, 1100],
    ]);
    const r = unpad(computePriceYRange(input(data, { sma200: [700, 720] })));
    expect(r.min).toBeCloseTo(700, 6);
    expect(r.max).toBeCloseTo(1100, 6);
  });

  it('MA が価格より上にあれば上側も広がる', () => {
    const data = bars([[1000, 1100]]);
    const r = unpad(computePriceYRange(input(data, { sma75: [1500] })));
    expect(r.max).toBeCloseTo(1500, 6);
  });

  it('無効な指標（indi にキーが無い）はレンジに影響しない', () => {
    const data = bars([[1000, 1100]]);
    const off = unpad(computePriceYRange(input(data, {})));
    expect(off.min).toBeCloseTo(1000, 6);
    expect(off.max).toBeCloseTo(1100, 6);
  });

  it('系列の null（助走期間）は飛ばす', () => {
    const data = bars([
      [1000, 1100],
      [1000, 1100],
    ]);
    const r = unpad(computePriceYRange(input(data, { sma200: [null, 700] })));
    expect(r.min).toBeCloseTo(700, 6);
  });

  it('ボリンジャーバンドは従来どおりレンジに含む', () => {
    const data = bars([[1000, 1100]]);
    const r = unpad(
      computePriceYRange(input(data, { boll: { upper: [1300], mid: [1050], lower: [800] } })),
    );
    expect(r.min).toBeCloseTo(800, 6);
    expect(r.max).toBeCloseTo(1300, 6);
  });

  it('一目の雲は未来バー（cloudEnd）まで見る', () => {
    const data = bars([[1000, 1100]]);
    const ichi = {
      tenkan: [],
      kijun: [],
      senkouA: [1050, 1400],
      senkouB: [1050, 1420],
      chikou: [],
    };
    const r = unpad(computePriceYRange(input(data, { ichi }, { cloudEnd: 2 })));
    expect(r.max).toBeCloseTo(1420, 6);
  });

  it('データが空なら 0..1 を返す', () => {
    expect(computePriceYRange(input([]))).toEqual({ min: 0, max: 1 });
  });
});
