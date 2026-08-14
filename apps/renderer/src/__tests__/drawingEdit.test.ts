import { describe, expect, it } from 'vitest';
import {
  applyHandleDrag,
  findHandleAt,
  handleIdsFor,
  handlePoint,
  updateDrawingText,
} from '../lib/drawingEdit';
import type { DrawingObject } from '../types';

/** 2 点系の描画を作るヘルパ（i/v をそのまま画面 x/y に写す縮尺で扱う） */
function twoPoint(over: Partial<DrawingObject> = {}): DrawingObject {
  return { id: 1, type: 'rect', i1: 10, v1: 100, i2: 20, v2: 200, ...over };
}

/** データ座標をそのまま画面座標として返す恒等変換（テスト用） */
const identityToScreen = (idx: number, v: number) => ({ x: idx, y: v });

describe('handleIdsFor', () => {
  it('トレンドラインは始点・終点の 2 個', () => {
    expect(handleIdsFor('trend')).toEqual(['p1', 'p2']);
  });

  it('長方形は外接矩形の四隅 4 個', () => {
    expect(handleIdsFor('rect')).toEqual(['p1', 'p2', 'i1v2', 'i2v1']);
  });

  it('楕円も長方形と同じ四隅 4 個', () => {
    expect(handleIdsFor('ellipse')).toEqual(['p1', 'p2', 'i1v2', 'i2v1']);
  });

  it('水平線はハンドルを持たない（全体移動がリサイズを兼ねる）', () => {
    expect(handleIdsFor('hline')).toEqual([]);
  });

  it('垂直線はハンドルを持たない', () => {
    expect(handleIdsFor('vline')).toEqual([]);
  });

  it('テキストはハンドルを持たない（本文編集は別関数）', () => {
    expect(handleIdsFor('text')).toEqual([]);
  });
});

describe('handlePoint', () => {
  it('p1 は (i1, v1)', () => {
    expect(handlePoint(twoPoint(), 'p1')).toEqual({ idx: 10, v: 100 });
  });

  it('p2 は (i2, v2)', () => {
    expect(handlePoint(twoPoint(), 'p2')).toEqual({ idx: 20, v: 200 });
  });

  it('i1v2 は (i1, v2)', () => {
    expect(handlePoint(twoPoint(), 'i1v2')).toEqual({ idx: 10, v: 200 });
  });

  it('i2v1 は (i2, v1)', () => {
    expect(handlePoint(twoPoint(), 'i2v1')).toEqual({ idx: 20, v: 100 });
  });

  it('座標が欠けた描画では null', () => {
    // Arrange
    const broken: DrawingObject = { id: 1, type: 'rect', i1: 10 };

    // Act & Assert
    expect(handlePoint(broken, 'p1')).toBeNull();
  });
});

describe('findHandleAt', () => {
  it('ハンドル上を指すと掴める', () => {
    // Arrange
    const d = twoPoint();

    // Act
    const hit = findHandleAt(d, 10, 100, identityToScreen);

    // Assert
    expect(hit).toBe('p1');
  });

  it('許容半径ちょうどの距離でも掴める', () => {
    // Arrange
    const d = twoPoint();

    // Act: p1 (10,100) から真上へちょうど 6px
    const hit = findHandleAt(d, 10, 94, identityToScreen);

    // Assert
    expect(hit).toBe('p1');
  });

  it('どのハンドルからも離れていれば null', () => {
    // Arrange
    const d = twoPoint();

    // Act: 矩形の中心（各隅から 50px 以上）
    const hit = findHandleAt(d, 15, 150, identityToScreen);

    // Assert
    expect(hit).toBeNull();
  });

  it('複数が許容内なら列挙順ではなく最も近いものを返す', () => {
    // Arrange: 横幅 3px の細い矩形（p1 と i2v1 がどちらも許容内）
    const d = twoPoint({ i2: 13 });

    // Act: i2v1 (13,100) 寄りを指す
    const hit = findHandleAt(d, 12.5, 100, identityToScreen);

    // Assert: 列挙順で先の p1 ではなく、近い i2v1 が返る
    expect(hit).toBe('i2v1');
  });

  it('近いほうが列挙順で先でも正しく返す（最後勝ちになっていない）', () => {
    // Arrange
    const d = twoPoint({ i2: 13 });

    // Act: p1 (10,100) 寄りを指す
    const hit = findHandleAt(d, 10.5, 100, identityToScreen);

    // Assert
    expect(hit).toBe('p1');
  });

  it('ハンドルを持たない型は常に null', () => {
    // Arrange
    const d = twoPoint({ type: 'text', idx: 10, v: 100 });

    // Act
    const hit = findHandleAt(d, 10, 100, identityToScreen);

    // Assert
    expect(hit).toBeNull();
  });

  it('isVisible が false を返す位置のハンドルは掴めない（クリップされて見えていない）', () => {
    // Arrange: y >= 150 の帯だけが見えている状況を模す
    const d = twoPoint();
    const isVisible = (p: { x: number; y: number }) => p.y >= 150;

    // Act: p1 (10,100) は見えていない
    const hit = findHandleAt(d, 10, 100, identityToScreen, isVisible);

    // Assert
    expect(hit).toBeNull();
  });

  it('isVisible で除外されたハンドルは、より遠い可視ハンドルを隠さない', () => {
    // Arrange: 幅 3px の細い矩形。p1 (10,100) が近いが不可視、i1v2 (10,200) は可視
    const d = twoPoint({ i2: 13 });
    const isVisible = (p: { x: number; y: number }) => p.y >= 150;

    // Act: p1 のすぐ近くを指す
    const hit = findHandleAt(d, 10, 100, identityToScreen, isVisible, 200);

    // Assert: 不可視の p1 ではなく、可視で最も近い i1v2 が返る
    expect(hit).toBe('i1v2');
  });

  it('isVisible を省略すると全ハンドルが候補になる', () => {
    const hit = findHandleAt(twoPoint(), 10, 100, identityToScreen);
    expect(hit).toBe('p1');
  });
});

describe('applyHandleDrag', () => {
  it('p1 は i1/v1 だけを動かす（対角 p2 は固定）', () => {
    // Act
    const next = applyHandleDrag(twoPoint(), 'p1', 99, 999);

    // Assert
    expect(next).toMatchObject({ i1: 99, v1: 999, i2: 20, v2: 200 });
  });

  it('p2 は i2/v2 だけを動かす', () => {
    const next = applyHandleDrag(twoPoint(), 'p2', 99, 999);
    expect(next).toMatchObject({ i1: 10, v1: 100, i2: 99, v2: 999 });
  });

  it('i1v2 は i1/v2 だけを動かす', () => {
    const next = applyHandleDrag(twoPoint(), 'i1v2', 99, 999);
    expect(next).toMatchObject({ i1: 99, v1: 100, i2: 20, v2: 999 });
  });

  it('i2v1 は i2/v1 だけを動かす', () => {
    const next = applyHandleDrag(twoPoint(), 'i2v1', 99, 999);
    expect(next).toMatchObject({ i1: 10, v1: 999, i2: 99, v2: 200 });
  });

  it('入力オブジェクトを書き換えない（イミュータブル）', () => {
    // Arrange
    const d = twoPoint();

    // Act
    applyHandleDrag(d, 'p1', 99, 999);

    // Assert
    expect(d.i1).toBe(10);
    expect(d.v1).toBe(100);
  });

  it('トレンドラインに矩形専用ハンドルを渡すと no-op', () => {
    // Arrange
    const d = twoPoint({ type: 'trend' });

    // Act
    const next = applyHandleDrag(d, 'i1v2', 99, 999);

    // Assert
    expect(next).toBe(d);
  });

  it('座標が欠けた描画は no-op', () => {
    // Arrange
    const d: DrawingObject = { id: 1, type: 'rect', i1: 10 };

    // Act
    const next = applyHandleDrag(d, 'p1', 99, 999);

    // Assert
    expect(next).toBe(d);
  });

  it('0 サイズに潰れる操作も値をそのまま反映する', () => {
    // Act: p2 を p1 と同じ座標へ
    const next = applyHandleDrag(twoPoint(), 'p2', 10, 100);

    // Assert
    expect(next.i2).toBe(next.i1);
    expect(next.v2).toBe(next.v1);
  });
});

describe('updateDrawingText', () => {
  const textDrawing: DrawingObject = { id: 1, type: 'text', idx: 5, v: 50, text: '旧' };

  it('本文を差し替える', () => {
    // Act
    const next = updateDrawingText([textDrawing], 1, '新');

    // Assert
    expect(next[0].text).toBe('新');
  });

  it('前後の空白を落として保存する', () => {
    const next = updateDrawingText([textDrawing], 1, '  新  ');
    expect(next[0].text).toBe('新');
  });

  it('空文字は編集を破棄して元の配列をそのまま返す', () => {
    // Arrange
    const drawings = [textDrawing];

    // Act
    const next = updateDrawingText(drawings, 1, '');

    // Assert
    expect(next).toBe(drawings);
  });

  it('空白のみも編集を破棄する', () => {
    // Arrange
    const drawings = [textDrawing];

    // Act
    const next = updateDrawingText(drawings, 1, '   ');

    // Assert
    expect(next).toBe(drawings);
  });

  it('テキスト以外の描画は書き換えない', () => {
    // Arrange
    const rect = twoPoint();

    // Act
    const next = updateDrawingText([rect], 1, '新');

    // Assert
    expect(next[0]).toBe(rect);
  });

  it('対象外の要素は同一参照のまま残す', () => {
    // Arrange
    const other: DrawingObject = { id: 2, type: 'text', idx: 9, v: 90, text: '他' };

    // Act
    const next = updateDrawingText([textDrawing, other], 1, '新');

    // Assert
    expect(next[0].text).toBe('新');
    expect(next[1]).toBe(other);
  });
});
