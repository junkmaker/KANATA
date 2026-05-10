import { describe, expect, it } from 'vitest';
import { nthWeekdayOfMonth } from '../lib/sqCalendar';

const FRIDAY = 5;

describe('nthWeekdayOfMonth', () => {
  it('2024年1月の第2金曜日は12日', () => {
    const d = nthWeekdayOfMonth(2024, 0, FRIDAY, 2);
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(12);
    expect(d.getUTCDay()).toBe(FRIDAY);
  });

  it('2024年3月の第2金曜日は8日（JP メジャーSQ）', () => {
    const d = nthWeekdayOfMonth(2024, 2, FRIDAY, 2);
    expect(d.getUTCDate()).toBe(8);
    expect(d.getUTCDay()).toBe(FRIDAY);
  });

  it('2024年1月の第3金曜日は19日（US ウィッチング）', () => {
    const d = nthWeekdayOfMonth(2024, 0, FRIDAY, 3);
    expect(d.getUTCDate()).toBe(19);
    expect(d.getUTCDay()).toBe(FRIDAY);
  });

  it('2024年3月の第3金曜日は15日（US クアドルプル・ウィッチング）', () => {
    const d = nthWeekdayOfMonth(2024, 2, FRIDAY, 3);
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCDay()).toBe(FRIDAY);
  });

  it('2024年12月の第2金曜日は13日', () => {
    const d = nthWeekdayOfMonth(2024, 11, FRIDAY, 2);
    expect(d.getUTCDate()).toBe(13);
    expect(d.getUTCDay()).toBe(FRIDAY);
  });

  it('2024年12月の第3金曜日は20日', () => {
    const d = nthWeekdayOfMonth(2024, 11, FRIDAY, 3);
    expect(d.getUTCDate()).toBe(20);
    expect(d.getUTCDay()).toBe(FRIDAY);
  });

  it('2025年6月の第2金曜日は13日', () => {
    const d = nthWeekdayOfMonth(2025, 5, FRIDAY, 2);
    expect(d.getUTCDate()).toBe(13);
    expect(d.getUTCDay()).toBe(FRIDAY);
  });

  it('2025年9月の第3金曜日は19日', () => {
    const d = nthWeekdayOfMonth(2025, 8, FRIDAY, 3);
    expect(d.getUTCDate()).toBe(19);
    expect(d.getUTCDay()).toBe(FRIDAY);
  });

  it('全月で結果が常に金曜日', () => {
    for (let m = 0; m < 12; m++) {
      expect(nthWeekdayOfMonth(2024, m, FRIDAY, 2).getUTCDay()).toBe(FRIDAY);
      expect(nthWeekdayOfMonth(2024, m, FRIDAY, 3).getUTCDay()).toBe(FRIDAY);
    }
  });

  it('第1月曜日（2024年1月1日は月曜）', () => {
    const d = nthWeekdayOfMonth(2024, 0, 1, 1);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCDay()).toBe(1);
  });
});
