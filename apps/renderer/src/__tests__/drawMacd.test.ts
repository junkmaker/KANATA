import { describe, expect, it } from 'vitest';
import { drawMacd } from '../components/Chart/subpanes/drawMacd';
import { drawLine } from '../components/Chart/subpanes/drawUtils';
import type { SubPaneContext } from '../components/Chart/subpanes/types';
import type { MACDParams, MACDResult } from '../types';

/**
 * MACD サブペイン描画の特性テスト。
 *
 * Canvas は jsdom に実体が無いので ctx をスタブし、
 * 「どの座標に何を描いたか」を記録して検証する。
 * `noNonNullAssertion` 解消の書き換えで描画座標が変わらないことを固定する。
 */

type Call = [string, ...unknown[]];

function makePane(overrides: Partial<SubPaneContext> = {}): {
  pane: SubPaneContext;
  calls: Call[];
} {
  const calls: Call[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: '' as CanvasTextAlign,
    fillText: rec('fillText'),
    fillRect: rec('fillRect'),
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    stroke: rec('stroke'),
    setLineDash: rec('setLineDash'),
    save: rec('save'),
    restore: rec('restore'),
    rect: rec('rect'),
    clip: rec('clip'),
  } as unknown as CanvasRenderingContext2D;

  const pane: SubPaneContext = {
    ctx,
    padL: 10,
    priceW: 200,
    viewStart: 0,
    viewEnd: 5,
    bw: 10,
    xScale: (i: number) => 10 + i * 10,
    y0: 100,
    height: 50,
    ...overrides,
  };
  return { pane, calls };
}

const params: MACDParams = { fast: 12, slow: 26, signal: 9 };

const macdResult = (
  macd: (number | null)[],
  signal: (number | null)[],
  histogram: (number | null)[],
): MACDResult => ({ macd, signal, histogram });

describe('drawMacd', () => {
  it('全系列が null なら早期 return して何も描かない', () => {
    const { pane, calls } = makePane();
    const nulls = [null, null, null, null, null];
    drawMacd(pane, macdResult(nulls, nulls, nulls), params);
    expect(calls).toHaveLength(0);
  });

  it('ヒストグラムの棒はゼロ線を基準に描かれる', () => {
    const { pane, calls } = makePane();
    drawMacd(pane, macdResult([1, 2, 3, 2, 1], [0.5, 1, 2, 1.5, 1], [0.5, 1, 1, 0.5, 0]), params);
    const rects = calls.filter((c) => c[0] === 'fillRect');
    expect(rects).toHaveLength(5);
    // 幅は bw * 0.6 = 6
    expect(rects[0][3]).toBe(6);
  });

  it('null を含む系列でも min/max を跨いで描画できる', () => {
    const { pane, calls } = makePane();
    drawMacd(
      pane,
      macdResult([null, 2, null, -2, 1], [null, 1, null, -1, 0], [null, 1, null, -1, 1]),
      params,
    );
    // null の添字は fillRect をスキップするので 3 本だけ
    expect(calls.filter((c) => c[0] === 'fillRect')).toHaveLength(3);
    // 早期 return していない = ラベルが描かれている
    expect(calls.some((c) => c[0] === 'fillText' && String(c[1]).startsWith('MACD'))).toBe(true);
  });

  it('ゼロ線ラベルとパラメータラベルを描く', () => {
    const { pane, calls } = makePane();
    drawMacd(pane, macdResult([1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [0, 0, 0, 0, 0]), params);
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
    expect(texts).toContain('MACD 12,26,9');
    expect(texts).toContain('0');
  });

  it('クリップ領域はペイン矩形に一致する', () => {
    const { pane, calls } = makePane();
    drawMacd(pane, macdResult([1, 2, 3, 2, 1], [1, 1, 1, 1, 1], [0, 1, 2, 1, 0]), params);
    const rect = calls.find((c) => c[0] === 'rect');
    expect(rect).toEqual(['rect', 10, 100, 200, 50]);
  });
});

describe('drawLine', () => {
  it('null で線を切り、再開時は moveTo になる', () => {
    const { pane, calls } = makePane();
    drawLine(pane.ctx, pane.xScale, [1, 2, null, 4, 5], '#fff');
    const ops = calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo').map((c) => c[0]);
    expect(ops).toEqual(['moveTo', 'lineTo', 'moveTo', 'lineTo']);
  });

  it('全て null なら moveTo も lineTo も呼ばれない', () => {
    const { pane, calls } = makePane();
    drawLine(pane.ctx, pane.xScale, [null, null, null], '#fff');
    expect(calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')).toHaveLength(0);
  });

  it('dash 指定時は setLineDash に配列が渡り、最後に解除される', () => {
    const { pane, calls } = makePane();
    drawLine(pane.ctx, pane.xScale, [1, 2, 3], '#fff', 1, [3, 2]);
    const dashes = calls.filter((c) => c[0] === 'setLineDash').map((c) => c[1]);
    expect(dashes[0]).toEqual([3, 2]);
    expect(dashes[dashes.length - 1]).toEqual([]);
  });
});
