import { describe, expect, it } from 'vitest';
import { withAlpha } from '../lib/colors';

describe('withAlpha', () => {
  it('6桁 hex を rgba に変換する', () => {
    expect(withAlpha('#FFC0CB', 0.12)).toBe('rgba(255, 192, 203, 0.12)');
  });
  it('白 hex を rgba に変換する', () => {
    expect(withAlpha('#FFFFFF', 0.18)).toBe('rgba(255, 255, 255, 0.18)');
  });
  it('3桁 hex を展開して rgba に変換する', () => {
    expect(withAlpha('#0F0', 0.5)).toBe('rgba(0, 255, 0, 0.5)');
  });
  it('oklch にアルファチャンネルを差し込む', () => {
    expect(withAlpha('oklch(0.78 0.14 220)', 0.12)).toBe('oklch(0.78 0.14 220 / 0.12)');
  });
  it('既にアルファ付きの色はそのまま返す', () => {
    const c = 'oklch(0.78 0.14 220 / 0.5)';
    expect(withAlpha(c, 0.12)).toBe(c);
  });
});
