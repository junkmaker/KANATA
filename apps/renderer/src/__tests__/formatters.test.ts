import { describe, expect, it } from 'vitest';
import { fmtDate } from '../lib/formatters';

/**
 * `Date` のローカルコンストラクタで作り `getTime()` を渡す。
 * `fmtDate` もローカル getter で読むため、CI と開発機のタイムゾーンが
 * 違っても結果は変わらない（ISO 文字列や UTC ミリ秒直書きだとずれる）。
 */
function localMs(y: number, m: number, d: number, h = 0, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime();
}

describe('fmtDate', () => {
  it('日足は YY/MM/DD で返す', () => {
    expect(fmtDate(localMs(2026, 7, 31), '1D')).toBe('26/07/31');
  });

  it('月と日を 2 桁にゼロ埋めする', () => {
    expect(fmtDate(localMs(2026, 12, 5), '1D')).toBe('26/12/05');
    expect(fmtDate(localMs(2026, 1, 2), '1D')).toBe('26/01/02');
  });

  it('年の下 2 桁もゼロ埋めする', () => {
    expect(fmtDate(localMs(2005, 1, 2), '1D')).toBe('05/01/02');
  });

  it('週足・月足は日足と同じ書式', () => {
    expect(fmtDate(localMs(2026, 7, 31), '1W')).toBe('26/07/31');
    expect(fmtDate(localMs(2026, 7, 31), '1M')).toBe('26/07/31');
  });

  it('日中足は YY/MM/DD HH:mm で時刻を付ける', () => {
    expect(fmtDate(localMs(2026, 7, 31, 14, 30), '60m')).toBe('26/07/31 14:30');
    expect(fmtDate(localMs(2026, 7, 31, 9, 5), '15m')).toBe('26/07/31 09:05');
    expect(fmtDate(localMs(2026, 7, 31, 0, 0), '5m')).toBe('26/07/31 00:00');
  });

  it('未知のタイムフレームは日付のみにフォールバックする', () => {
    expect(fmtDate(localMs(2026, 7, 31, 14, 30), '4h')).toBe('26/07/31');
  });
});
