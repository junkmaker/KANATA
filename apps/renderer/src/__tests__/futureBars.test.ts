import { describe, expect, it } from 'vitest';
import { barTimestampAt, nextBarTimestamp } from '../lib/futureBars';
import type { OHLCBar } from '../types';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** 2026-01-09（金）の JST 0 時 */
const FRI_JST = Date.UTC(2026, 0, 8, 15);
/** 2026-01-09（金）の NY 0 時（EST = UTC-5） */
const FRI_NY = Date.UTC(2026, 0, 9, 5);

describe('nextBarTimestamp（日足）', () => {
  it('JST の金曜の次は月曜（土日を飛ばす）', () => {
    expect(nextBarTimestamp(FRI_JST, '1D')).toBe(FRI_JST + 3 * DAY);
  });

  it('NY の金曜の次も月曜（端末のタイムゾーンに依存しない）', () => {
    expect(nextBarTimestamp(FRI_NY, '1D')).toBe(FRI_NY + 3 * DAY);
  });

  it('平日の次は翌日', () => {
    const thu = FRI_JST - DAY;
    expect(nextBarTimestamp(thu, '1D')).toBe(FRI_JST);
  });
});

describe('nextBarTimestamp（日足以外）', () => {
  it('分足は固定幅で進む', () => {
    expect(nextBarTimestamp(0, '5m')).toBe(5 * 60 * 1000);
    expect(nextBarTimestamp(0, '60m')).toBe(HOUR);
  });

  it('週足は 7 日', () => {
    expect(nextBarTimestamp(FRI_JST, '1W')).toBe(FRI_JST + 7 * DAY);
  });
});

describe('barTimestampAt', () => {
  const data: OHLCBar[] = [{ t: FRI_JST, o: 1, h: 1, l: 1, c: 1, v: 0 }];

  it('範囲内はバーの時刻', () => {
    expect(barTimestampAt(data, 0, '1D')).toBe(FRI_JST);
  });

  it('未来は平日だけを数える（金曜の 5 本先は翌週金曜）', () => {
    expect(barTimestampAt(data, 5, '1D')).toBe(FRI_JST + 7 * DAY);
  });
});
