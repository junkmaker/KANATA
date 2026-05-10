import { describe, expect, it } from 'vitest';
import { buildSqEventMap, getSqEventsInRange } from '../lib/sqEvents';
import type { OHLCBar } from '../types';

describe('getSqEventsInRange', () => {
  it('2024年通年のJPイベントは12件（毎月SQ）', () => {
    const from = new Date(Date.UTC(2024, 0, 1));
    const to = new Date(Date.UTC(2024, 11, 31));
    const events = getSqEventsInRange(from, to, 'JP');
    expect(events.length).toBe(12);
    expect(events.every((e) => e.market === 'JP')).toBe(true);
  });

  it('2024年通年のUSイベントは12件（毎月ウィッチング）', () => {
    const from = new Date(Date.UTC(2024, 0, 1));
    const to = new Date(Date.UTC(2024, 11, 31));
    const events = getSqEventsInRange(from, to, 'US');
    expect(events.length).toBe(12);
    expect(events.every((e) => e.market === 'US')).toBe(true);
  });

  it('JP: 四半期月（3/6/9/12月）はメジャーSQ', () => {
    const from = new Date(Date.UTC(2024, 0, 1));
    const to = new Date(Date.UTC(2024, 11, 31));
    const events = getSqEventsInRange(from, to, 'JP');
    const majorMonths = events
      .filter((e) => e.severity === 'major')
      .map((e) => e.date.getUTCMonth());
    expect(majorMonths.sort((a, b) => a - b)).toEqual([2, 5, 8, 11]);
  });

  it('US: 四半期月（3/6/9/12月）はクアドルプル・ウィッチング', () => {
    const from = new Date(Date.UTC(2024, 0, 1));
    const to = new Date(Date.UTC(2024, 11, 31));
    const events = getSqEventsInRange(from, to, 'US');
    const quadMonths = events
      .filter((e) => e.type === 'us_quad_witching')
      .map((e) => e.date.getUTCMonth());
    expect(quadMonths.sort((a, b) => a - b)).toEqual([2, 5, 8, 11]);
  });

  it('JP SQ 日付は全て金曜日', () => {
    const from = new Date(Date.UTC(2024, 0, 1));
    const to = new Date(Date.UTC(2024, 11, 31));
    const events = getSqEventsInRange(from, to, 'JP');
    expect(events.every((e) => e.date.getUTCDay() === 5)).toBe(true);
  });

  it('US ウィッチング日付は全て金曜日', () => {
    const from = new Date(Date.UTC(2024, 0, 1));
    const to = new Date(Date.UTC(2024, 11, 31));
    const events = getSqEventsInRange(from, to, 'US');
    expect(events.every((e) => e.date.getUTCDay() === 5)).toBe(true);
  });

  it('範囲外のイベントは含まれない', () => {
    const from = new Date(Date.UTC(2024, 0, 1));
    const to = new Date(Date.UTC(2024, 0, 31));
    const events = getSqEventsInRange(from, to, 'JP');
    expect(events.length).toBe(1);
  });
});

describe('buildSqEventMap', () => {
  const makeBar = (ts: number): OHLCBar => ({ t: ts, o: 100, h: 110, l: 90, c: 105, v: 1000 });

  it('1Dタイムフレームで正確な日付のバーにマッピングされる', () => {
    const sqTs = Date.UTC(2024, 0, 12); // 2024-01-12 JP SQ日
    const bars: OHLCBar[] = [
      makeBar(Date.UTC(2024, 0, 10)),
      makeBar(Date.UTC(2024, 0, 11)),
      makeBar(sqTs),
      makeBar(Date.UTC(2024, 0, 15)),
    ];
    const map = buildSqEventMap(bars, '1D', 'JP');
    const evs = map.get(2);
    expect(evs).toBeDefined();
    expect(evs?.[0].type).toBe('jp_sq');
  });

  it('空のバー配列は空のMapを返す', () => {
    const map = buildSqEventMap([], '1D', 'JP');
    expect(map.size).toBe(0);
  });

  it('5m/15m/60mタイムフレームでは一致するバーがなく空のMapを返す', () => {
    const bars: OHLCBar[] = [makeBar(Date.UTC(2024, 0, 12))];
    const map = buildSqEventMap(bars, '5m', 'JP');
    expect(map.size).toBe(0);
  });
});
