import { describe, expect, it } from 'vitest';
import { tickStepForLabels, widestDateLabel } from '../lib/xAxisTicks';

/** 11px JetBrains Mono の実測に近い 1 文字あたりの送り幅（px）。 */
const CH = 6.6;

describe('widestDateLabel', () => {
  it('日中足は時刻付きの 14 文字を返す', () => {
    expect(widestDateLabel('60m')).toBe('26/12/28 22:38');
    expect(widestDateLabel('60m')).toHaveLength(14);
  });

  it('日足・週足・月足は 8 文字を返す', () => {
    expect(widestDateLabel('1D')).toBe('26/12/28');
    expect(widestDateLabel('1D')).toHaveLength(8);
  });

  it('全フィールドが 2 桁の見本なので最大幅になる', () => {
    // 1 桁になりうる月・日・時・分がすべて 2 桁で埋まっていること
    expect(widestDateLabel('5m')).not.toMatch(/\b\d\b/);
  });
});

describe('tickStepForLabels', () => {
  it('幅に余裕がある時は従来どおり本数基準（nVis / 10）になる', () => {
    // 200 本 / 幅 2000px → bw=10px。ラベル 8 文字 ≈ 53px、必要間隔 ≈ 6.3 本 < 20 本
    expect(tickStepForLabels(200, 10, 8 * CH)).toBe(20);
  });

  it('狭いペインでは間隔を広げてラベルの重なりを防ぐ', () => {
    // 200 本 / 幅 600px → bw=3px。日中足 14 文字 ≈ 92px → 必要 (92+10)/3 = 34 本
    const step = tickStepForLabels(200, 3, 14 * CH);
    expect(step).toBe(35);
    expect(step * 3).toBeGreaterThanOrEqual(14 * CH);
  });

  it('返した間隔だとラベル幅＋余白が必ず収まる', () => {
    const barWidth = 4;
    const labelW = 14 * CH;
    const step = tickStepForLabels(300, barWidth, labelW);
    expect(step * barWidth).toBeGreaterThanOrEqual(labelW + 10);
  });

  it('本数基準と幅基準の広い方を採る', () => {
    // 幅基準が本数基準を下回る場合は本数基準が勝つ
    expect(tickStepForLabels(500, 20, 8 * CH)).toBe(50);
  });

  it('最低でも 1 を返す（バーが少なくても 0 にしない）', () => {
    expect(tickStepForLabels(5, 100, 8 * CH)).toBe(1);
    expect(tickStepForLabels(0, 100, 8 * CH)).toBe(1);
  });

  it('レイアウト確定前の bw が 0 や非有限でも本数基準へフォールバックする', () => {
    expect(tickStepForLabels(200, 0, 92)).toBe(20);
    expect(tickStepForLabels(200, Number.POSITIVE_INFINITY, 92)).toBe(20);
    expect(tickStepForLabels(200, Number.NaN, 92)).toBe(20);
    expect(tickStepForLabels(200, 3, Number.NaN)).toBe(20);
  });

  it('余白は引数で調整できる', () => {
    expect(tickStepForLabels(200, 3, 90, 0)).toBe(30);
    expect(tickStepForLabels(200, 3, 90, 30)).toBe(40);
  });
});
