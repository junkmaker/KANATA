import { describe, expect, it } from 'vitest';
import {
  anchorDrawing,
  indexToTime,
  pinLegacyDrawings,
  resolveDrawing,
  resolveDrawings,
  timeToIndex,
} from '../lib/drawingAnchor';
import { barTimestampAt } from '../lib/futureBars';
import type { DrawingObject, OHLCBar } from '../types';

const DAY = 24 * 60 * 60 * 1000;

/** 2026-01-05（月）の JST 0 時。yfinance の日足と同じく取引所ローカルの 0 時に置く */
const MON_JST = Date.UTC(2026, 0, 4, 15);

/** 月曜から平日だけの日足を n 本作る（価格は検証に使わないので固定） */
function bars(n: number): OHLCBar[] {
  return Array.from({ length: n }, (_, i) => {
    const t = MON_JST + (Math.floor(i / 5) * 7 + (i % 5)) * DAY;
    return { t, o: 1, h: 1, l: 1, c: 1, v: 0 };
  });
}

describe('indexToTime', () => {
  const data = bars(10);

  it('整数 idx はそのバーの時刻', () => {
    expect(indexToTime(data, 3, '1D')).toBe(data[3].t);
  });

  it('小数 idx は隣接バーの間を補間する', () => {
    expect(indexToTime(data, 3.5, '1D')).toBe(data[3].t + 0.5 * DAY);
  });

  it('未来 idx は futureBars と一致する', () => {
    expect(indexToTime(data, 12, '1D')).toBe(barTimestampAt(data, 12, '1D'));
  });

  it('負の idx は先頭バーの名目間隔で外挿する', () => {
    expect(indexToTime(data, -2, '1D')).toBe(data[0].t - 2 * DAY);
  });

  it('空データは null', () => {
    expect(indexToTime([], 0, '1D')).toBeNull();
  });
});

describe('timeToIndex', () => {
  const data = bars(10);

  it('空データは null', () => {
    expect(timeToIndex([], 0, '1D')).toBeNull();
  });

  it('バー時刻ちょうどは整数を返す', () => {
    expect(timeToIndex(data, data[7].t, '1D')).toBe(7);
  });

  it.each([0, 3, 3.25, 9, 9.5, 15, 15.75, -4, -0.5])('indexToTime と往復で恒等（idx=%s）', (x) => {
    const t = indexToTime(data, x, '1D') as number;
    expect(timeToIndex(data, t, '1D')).toBeCloseTo(x, 9);
  });

  it('区間幅 0 の重複時刻でも 0 除算しない', () => {
    const dup = [...bars(3), { ...bars(3)[2] }];
    expect(Number.isFinite(timeToIndex(dup, dup[2].t, '1D') as number)).toBe(true);
  });
});

describe('anchorDrawing / resolveDrawing', () => {
  it('データ窓の先頭が落ちても同じ日付のバーに解決される（issue #81）', () => {
    const before = bars(100);
    const after = before.slice(15); // 15 営業日経過で先頭 15 本が落ちた
    const saved = anchorDrawing({ id: 1, type: 'text', idx: 40, v: 10, text: 'x' }, before, '1D');
    const resolved = resolveDrawing(saved, after, '1D');
    expect(resolved.idx).toBe(25);
    expect(after[resolved.idx as number].t).toBe(before[40].t);
  });

  it('データ窓の末尾が伸びても idx は変わらない', () => {
    const saved = anchorDrawing({ id: 1, type: 'vline', idx: 50 }, bars(100), '1D');
    expect(resolveDrawing(saved, bars(120), '1D').idx).toBe(50);
  });

  it('未来に置いた点は実データが追いついても同じ位置に解決される', () => {
    const saved = anchorDrawing({ id: 1, type: 'vline', idx: 105 }, bars(100), '1D');
    expect(resolveDrawing(saved, bars(110), '1D').idx).toBe(105);
  });

  it('金曜の 1 本先は月曜に保存され、月曜のバー到着後もその足に乗る（週末でずれない）', () => {
    const upToFri = bars(5); // 月〜金
    const saved = anchorDrawing({ id: 1, type: 'vline', idx: 5 }, upToFri, '1D');
    expect(saved.t).toBe(upToFri[4].t + 3 * DAY);
    expect(resolveDrawing(saved, bars(6), '1D').idx).toBe(5);
  });

  it('5 本先に置いた点は実データ到着後も 5 本目の足に乗る', () => {
    const saved = anchorDrawing({ id: 1, type: 'vline', idx: 9 }, bars(5), '1D');
    expect(resolveDrawing(saved, bars(15), '1D').idx).toBe(9);
  });

  it('トレンドラインは両端が解決され、価格は変わらない', () => {
    const before = bars(100);
    const saved = anchorDrawing(
      { id: 1, type: 'trend', i1: 10, v1: 100, i2: 20, v2: 200 },
      before,
      '1D',
    );
    const resolved = resolveDrawing(saved, before.slice(5), '1D');
    expect(resolved).toMatchObject({ i1: 5, v1: 100, i2: 15, v2: 200 });
  });

  it('hline は anchor しても同一参照', () => {
    const d: DrawingObject = { id: 1, type: 'hline', v: 100 };
    expect(anchorDrawing(d, bars(10), '1D')).toBe(d);
  });

  it('データが空なら anchor も resolve も同一参照', () => {
    const d: DrawingObject = { id: 1, type: 'vline', idx: 3, t: 0 };
    expect(anchorDrawing(d, [], '1D')).toBe(d);
    expect(resolveDrawing(d, [], '1D')).toBe(d);
  });

  it('時刻を持たない旧データは resolve で同一参照', () => {
    const d: DrawingObject = { id: 1, type: 'vline', idx: 5 };
    expect(resolveDrawing(d, bars(10), '1D')).toBe(d);
  });

  it('入力をミューテートしない', () => {
    const d = Object.freeze<DrawingObject>({ id: 1, type: 'rect', i1: 1, v1: 1, i2: 2, v2: 2 });
    const anchored = Object.freeze(anchorDrawing(d, bars(10), '1D'));
    resolveDrawing(anchored, bars(10).slice(1), '1D');
    expect(d).toEqual({ id: 1, type: 'rect', i1: 1, v1: 1, i2: 2, v2: 2 });
  });
});

describe('resolveDrawings', () => {
  it('何も変わらなければ同一配列を返す', () => {
    const ds: DrawingObject[] = [{ id: 1, type: 'hline', v: 1 }];
    expect(resolveDrawings(ds, bars(10), '1D')).toBe(ds);
  });

  it('時刻アンカーを持つ描画は解決する', () => {
    const data = bars(10);
    const ds = [anchorDrawing({ id: 1, type: 'vline', idx: 4 }, data, '1D')];
    expect(resolveDrawings(ds, data.slice(2), '1D')[0].idx).toBe(2);
  });
});

describe('pinLegacyDrawings', () => {
  const data = bars(10);

  it('時刻を持たない旧データに時刻を付ける', () => {
    const next = pinLegacyDrawings([{ id: 1, type: 'text', idx: 5, v: 1 }], data, '1D', 'AAPL');
    expect(next[0].t).toBe(data[5].t);
  });

  it('ticker 未設定の描画も対象にする', () => {
    const next = pinLegacyDrawings(
      [{ id: 1, type: 'trend', i1: 1, v1: 1, i2: 2, v2: 2 }],
      data,
      '1D',
      'AAPL',
    );
    expect(next[0]).toMatchObject({ t1: data[1].t, t2: data[2].t });
  });

  it('別銘柄の描画は触らず同一配列を返す', () => {
    const ds: DrawingObject[] = [{ id: 1, type: 'vline', idx: 5, ticker: '7203' }];
    expect(pinLegacyDrawings(ds, data, '1D', 'AAPL')).toBe(ds);
  });

  it('既に時刻を持つ描画だけなら同一配列を返す（effect の無限更新防止）', () => {
    const ds = [anchorDrawing({ id: 1, type: 'vline', idx: 5 }, data, '1D')];
    expect(pinLegacyDrawings(ds, data, '1D', 'AAPL')).toBe(ds);
  });

  it('データが空なら同一配列を返す', () => {
    const ds: DrawingObject[] = [{ id: 1, type: 'vline', idx: 5 }];
    expect(pinLegacyDrawings(ds, [], '1D', 'AAPL')).toBe(ds);
  });
});
