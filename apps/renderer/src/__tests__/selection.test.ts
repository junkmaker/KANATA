import { describe, expect, it } from 'vitest';
import { clampSelectionForMode, toggleSelection } from '../lib/selection';

describe('toggleSelection', () => {
  it('none モードはクリックで単一選択に置換する', () => {
    // Arrange
    const current = ['7203', '6758'];

    // Act
    const next = toggleSelection(current, 'AAPL', 'none');

    // Assert
    expect(next).toEqual(['AAPL']);
  });

  it('none モードで既選択銘柄をクリックしても単一のまま', () => {
    // Arrange
    const current = ['7203'];

    // Act
    const next = toggleSelection(current, '7203', 'none');

    // Assert
    expect(next).toEqual(['7203']);
  });

  it('percent モードは未選択をトグル追加する', () => {
    // Arrange
    const current = ['7203'];

    // Act
    const next = toggleSelection(current, '6758', 'percent');

    // Assert
    expect(next).toEqual(['7203', '6758']);
  });

  it('percent モードは選択済みをトグル削除する', () => {
    // Arrange
    const current = ['7203', '6758'];

    // Act
    const next = toggleSelection(current, '6758', 'percent');

    // Assert
    expect(next).toEqual(['7203']);
  });

  it('percent モードで最後の 1 件は外せない（現状維持）', () => {
    // Arrange
    const current = ['7203'];

    // Act
    const next = toggleSelection(current, '7203', 'percent');

    // Assert
    expect(next).toEqual(['7203']);
  });

  it('percent モードで 6 件超過時は先頭を落とす', () => {
    // Arrange
    const current = ['a', 'b', 'c', 'd', 'e', 'f'];

    // Act
    const next = toggleSelection(current, 'g', 'percent');

    // Assert
    expect(next).toEqual(['b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('空配列でも none はクリック銘柄の単一選択になる', () => {
    // Arrange / Act
    const next = toggleSelection([], 'AAPL', 'none');

    // Assert
    expect(next).toEqual(['AAPL']);
  });

  it('空配列でも percent はクリック銘柄を追加する', () => {
    // Arrange / Act
    const next = toggleSelection([], 'AAPL', 'percent');

    // Assert
    expect(next).toEqual(['AAPL']);
  });

  it('入力配列を変更しない（イミュータブル）', () => {
    // Arrange
    const current = Object.freeze(['a', 'b']) as string[];

    // Act / Assert: 凍結配列でも例外を投げず新しい配列を返す
    expect(() => toggleSelection(current, 'c', 'percent')).not.toThrow();
    expect(current).toEqual(['a', 'b']);
  });
});

describe('clampSelectionForMode', () => {
  it('none で複数選択は主銘柄のみへ正規化する', () => {
    // Arrange
    const current = ['7203', '6758', 'AAPL'];

    // Act
    const next = clampSelectionForMode(current, 'none');

    // Assert
    expect(next).toEqual(['7203']);
  });

  it('none で 1 件はそのまま', () => {
    // Arrange
    const current = ['7203'];

    // Act
    const next = clampSelectionForMode(current, 'none');

    // Assert
    expect(next).toEqual(['7203']);
  });

  it('percent は選択件数を変えない', () => {
    // Arrange
    const current = ['7203', '6758'];

    // Act
    const next = clampSelectionForMode(current, 'percent');

    // Assert
    expect(next).toEqual(['7203', '6758']);
  });

  it('入力配列を変更しない（イミュータブル）', () => {
    // Arrange
    const current = Object.freeze(['7203', '6758', 'AAPL']) as string[];

    // Act / Assert
    expect(() => clampSelectionForMode(current, 'none')).not.toThrow();
    expect(current).toEqual(['7203', '6758', 'AAPL']);
  });
});
