import { describe, expect, it } from 'vitest';
import { checkAlertCondition } from '../lib/alertChecker';
import { anchorDrawing } from '../lib/drawingAnchor';
import type { AlertObject, DrawingObject, OHLCBar } from '../types';

const DAY = 24 * 60 * 60 * 1000;

/** 1 日刻みの日足を作る。最終バーの終値だけ lastClose にする */
function bars(n: number, lastClose: number, t0 = Date.UTC(2026, 0, 5)): OHLCBar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = i === n - 1 ? lastClose : 100;
    return { t: t0 + i * DAY, o: c, h: c, l: c, c, v: 0 };
  });
}

function alert(direction: AlertObject['direction']): AlertObject {
  return { id: 'a', drawingId: 1, symbol: 'AAPL', direction, triggered: false, createdAt: 0 };
}

describe('checkAlertCondition', () => {
  it('水平線は終値との比較で判定する', () => {
    const d: DrawingObject = { id: 1, type: 'hline', v: 100 };
    expect(checkAlertCondition(alert('below'), [d], { AAPL: bars(10, 90) }, '1D')).toBe(true);
    expect(checkAlertCondition(alert('above'), [d], { AAPL: bars(10, 90) }, '1D')).toBe(false);
  });

  it('データ窓の先頭が落ちてもトレンドラインは保存時の日付で判定する（issue #81）', () => {
    // 100 本のデータで (80, 100) → (90, 110) の線を引く。最終バー idx 99 での線の値は 119
    const before = bars(100, 118);
    const trend = anchorDrawing(
      { id: 1, type: 'trend', i1: 80, v1: 100, i2: 90, v2: 110 },
      before,
      '1D',
    );
    // 先頭 15 本が落ちる。最終バーは同じ日付なので線の値も 119 のまま
    const after = before.slice(15);
    expect(checkAlertCondition(alert('below'), [trend], { AAPL: after }, '1D')).toBe(true);
    const afterAbove = bars(100, 120).slice(15);
    expect(checkAlertCondition(alert('above'), [trend], { AAPL: afterAbove }, '1D')).toBe(true);
  });

  it('時刻を持たない旧データのトレンドラインは従来通りインデックスで判定する', () => {
    const trend: DrawingObject = { id: 1, type: 'trend', i1: 0, v1: 100, i2: 9, v2: 109 };
    expect(checkAlertCondition(alert('below'), [trend], { AAPL: bars(10, 108) }, '1D')).toBe(true);
    expect(checkAlertCondition(alert('above'), [trend], { AAPL: bars(10, 110) }, '1D')).toBe(true);
  });
});
