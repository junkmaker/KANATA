import { describe, expect, it } from 'vitest';
import {
  applyToolSelection,
  isDrawingsToggleKey,
  isTypingTarget,
  toggleDrawingsVisibility,
} from '../lib/drawingVisibility';
import type { AppState } from '../types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    selected: ['7203'],
    timeframe: '1D',
    compareMode: 'percent',
    activeTool: 'pan',
    drawings: [],
    selectedDrawingId: null,
    drawingColor: '#fff',
    showDrawings: true,
    showVolume: true,
    showFinancial: true,
    showSqMarkers: true,
    indicators: {
      sma5: false,
      sma25: true,
      sma75: true,
      sma200: false,
      ema20: false,
      boll: false,
      stoch: true,
      psar: false,
      ichi: false,
      macd: false,
      rsi: false,
    },
    financial: { roe: true, roic: true, per: true },
    indicatorParams: {
      macd: { fast: 12, slow: 26, signal: 9 },
      rsi: { period: 14, overbought: 70, oversold: 30 },
    },
    patternFilter: 'all',
    ...overrides,
  };
}

function keyEvent(over: Partial<Parameters<typeof isDrawingsToggleKey>[0]> = {}) {
  return { key: 'h', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over };
}

describe('isDrawingsToggleKey', () => {
  it('修飾キーなしの h を受け付ける', () => {
    expect(isDrawingsToggleKey(keyEvent())).toBe(true);
  });

  it('大文字 H も受け付ける（CapsLock 対策）', () => {
    expect(isDrawingsToggleKey(keyEvent({ key: 'H' }))).toBe(true);
  });

  it('Ctrl+H は無視する', () => {
    expect(isDrawingsToggleKey(keyEvent({ ctrlKey: true }))).toBe(false);
  });

  it('Meta+H は無視する', () => {
    expect(isDrawingsToggleKey(keyEvent({ metaKey: true }))).toBe(false);
  });

  it('Alt+H は無視する', () => {
    expect(isDrawingsToggleKey(keyEvent({ altKey: true }))).toBe(false);
  });

  it('Shift+H は無視する', () => {
    expect(isDrawingsToggleKey(keyEvent({ shiftKey: true }))).toBe(false);
  });

  it('IME 変換中は無視する', () => {
    expect(isDrawingsToggleKey(keyEvent({ isComposing: true }))).toBe(false);
  });

  it('キーリピートは無視する（押しっぱなしで点滅させない）', () => {
    expect(isDrawingsToggleKey(keyEvent({ repeat: true }))).toBe(false);
  });

  it('別のキーは無視する', () => {
    expect(isDrawingsToggleKey(keyEvent({ key: 'g' }))).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it('input はキー入力対象とみなす', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
  });

  it('textarea はキー入力対象とみなす', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
  });

  it('select はキー入力対象とみなす（type-ahead と衝突するため）', () => {
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
  });

  it('contentEditable はタグ名によらずキー入力対象とみなす', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('通常の要素はキー入力対象ではない', () => {
    expect(isTypingTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
  });

  it('target が無い場合はキー入力対象ではない', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe('toggleDrawingsVisibility', () => {
  it('表示中から呼ぶと非表示になる', () => {
    // Arrange
    const state = baseState({ showDrawings: true });

    // Act
    const next = toggleDrawingsVisibility(state);

    // Assert
    expect(next.showDrawings).toBe(false);
  });

  it('非表示中から呼ぶと表示になる', () => {
    // Arrange
    const state = baseState({ showDrawings: false });

    // Act
    const next = toggleDrawingsVisibility(state);

    // Assert
    expect(next.showDrawings).toBe(true);
  });

  it('非表示にするとき選択中の描画を解除する', () => {
    // Arrange
    const state = baseState({ showDrawings: true, selectedDrawingId: 42 });

    // Act
    const next = toggleDrawingsVisibility(state);

    // Assert
    expect(next.selectedDrawingId).toBeNull();
  });

  it('表示に戻すとき選択状態は変更しない', () => {
    // Arrange
    const state = baseState({ showDrawings: false, selectedDrawingId: 42 });

    // Act
    const next = toggleDrawingsVisibility(state);

    // Assert
    expect(next.selectedDrawingId).toBe(42);
  });

  it('非表示にするとき描画ツールをパンへ戻す（見えない描画を作らせない）', () => {
    // Arrange
    const state = baseState({ showDrawings: true, activeTool: 'trend' });

    // Act
    const next = toggleDrawingsVisibility(state);

    // Assert
    expect(next.activeTool).toBe('pan');
  });

  it('表示に戻すとき選択中のツールは変更しない', () => {
    // Arrange
    const state = baseState({ showDrawings: false, activeTool: 'rect' });

    // Act
    const next = toggleDrawingsVisibility(state);

    // Assert
    expect(next.activeTool).toBe('rect');
  });

  it('drawings 配列を書き換えない（イミュータブル）', () => {
    // Arrange
    const drawings = [{ id: 1, type: 'hline' as const, v: 100 }];
    const state = baseState({ drawings });

    // Act
    const next = toggleDrawingsVisibility(state);

    // Assert
    expect(next.drawings).toBe(drawings);
    expect(state.showDrawings).toBe(true);
  });
});

describe('applyToolSelection', () => {
  it('別ツールを選ぶと activeTool が切り替わる', () => {
    // Arrange
    const state = baseState({ activeTool: 'pan' });

    // Act
    const next = applyToolSelection(state, 'trend');

    // Assert
    expect(next.activeTool).toBe('trend');
  });

  it('同じツールを再度押すと pan に戻る', () => {
    // Arrange
    const state = baseState({ activeTool: 'trend' });

    // Act
    const next = applyToolSelection(state, 'trend');

    // Assert
    expect(next.activeTool).toBe('pan');
  });

  it('非表示中に描画ツールを選ぶと表示が ON へ戻る', () => {
    // Arrange
    const state = baseState({ activeTool: 'pan', showDrawings: false });

    // Act
    const next = applyToolSelection(state, 'trend');

    // Assert
    expect(next.showDrawings).toBe(true);
  });

  it('非表示中に pan へ戻す操作では表示状態を変えない', () => {
    // Arrange
    const state = baseState({ activeTool: 'trend', showDrawings: false });

    // Act
    const next = applyToolSelection(state, 'trend');

    // Assert
    expect(next.activeTool).toBe('pan');
    expect(next.showDrawings).toBe(false);
  });

  it('入力 state を変更しない（イミュータブル）', () => {
    // Arrange
    const state = baseState({ activeTool: 'pan', showDrawings: false });

    // Act
    applyToolSelection(state, 'rect');

    // Assert
    expect(state.activeTool).toBe('pan');
    expect(state.showDrawings).toBe(false);
  });
});
