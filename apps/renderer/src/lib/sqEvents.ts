import type { OHLCBar } from '../types';
import { barTimestampAt } from './futureBars';
import { nthWeekdayOfMonth } from './sqCalendar';

export type SqEventType = 'jp_sq' | 'jp_major_sq' | 'us_witching' | 'us_quad_witching';

export interface SqEvent {
  date: Date;
  type: SqEventType;
  market: 'JP' | 'US';
  label: string;
  shortLabel: string;
  severity: 'minor' | 'major';
}

// 0-indexed months for quarterly events (Mar=2, Jun=5, Sep=8, Dec=11)
const QUARTERLY_MONTHS = new Set([2, 5, 8, 11]);
const FRIDAY = 5;

export function getSqEventsInRange(from: Date, to: Date, market: 'JP' | 'US'): SqEvent[] {
  const events: SqEvent[] = [];
  const fromTs = from.getTime();
  const toTs = to.getTime();

  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
    for (let m = 0; m < 12; m++) {
      let date: Date;
      let event: SqEvent;

      if (market === 'JP') {
        date = nthWeekdayOfMonth(y, m, FRIDAY, 2); // 2nd Friday
        const isMajor = QUARTERLY_MONTHS.has(m);
        event = {
          date,
          type: isMajor ? 'jp_major_sq' : 'jp_sq',
          market: 'JP',
          label: isMajor ? 'メジャーSQ' : 'SQ',
          shortLabel: isMajor ? 'MajSQ' : 'SQ',
          severity: isMajor ? 'major' : 'minor',
        };
      } else {
        date = nthWeekdayOfMonth(y, m, FRIDAY, 3); // 3rd Friday
        const isQuad = QUARTERLY_MONTHS.has(m);
        event = {
          date,
          type: isQuad ? 'us_quad_witching' : 'us_witching',
          market: 'US',
          label: isQuad ? 'クアドルプル・ウィッチング' : 'ダブル・ウィッチング',
          shortLabel: isQuad ? 'QW' : 'DW',
          severity: isQuad ? 'major' : 'minor',
        };
      }

      const ts = date.getTime();
      if (ts >= fromTs && ts <= toTs) {
        events.push(event);
      }
    }
  }

  return events;
}

// Tolerates ±30h to cover UTC vs JST offset for daily bars
const DAILY_TOLERANCE_MS = 30 * 3600 * 1000;

function findBarIndexForEvent(bars: OHLCBar[], eventTs: number, timeframe: string): number {
  if (timeframe === '1D') {
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < bars.length; i++) {
      const diff = Math.abs(bars[i].t - eventTs);
      if (diff < DAILY_TOLERANCE_MS && diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  if (timeframe === '1W') {
    for (let i = 0; i < bars.length; i++) {
      const barStart = bars[i].t - DAILY_TOLERANCE_MS;
      const barEnd = (i + 1 < bars.length ? bars[i + 1].t : bars[i].t + 7 * 86400000) + DAILY_TOLERANCE_MS;
      if (eventTs >= barStart && eventTs < barEnd) return i;
    }
    return -1;
  }

  if (timeframe === '1M') {
    const eventDate = new Date(eventTs);
    const ey = eventDate.getUTCFullYear();
    const em = eventDate.getUTCMonth();
    for (let i = 0; i < bars.length; i++) {
      const bd = new Date(bars[i].t);
      if (bd.getUTCFullYear() === ey && bd.getUTCMonth() === em) return i;
    }
    return -1;
  }

  return -1;
}

// Finds the best-matching future bar index (>= bars.length) for a 1D event timestamp.
function findFutureBarIndexForEvent(bars: OHLCBar[], eventTs: number, maxFutureBars: number): number {
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = bars.length; i < bars.length + maxFutureBars; i++) {
    const futureTs = barTimestampAt(bars, i, '1D');
    const diff = Math.abs(futureTs - eventTs);
    if (diff < DAILY_TOLERANCE_MS && diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function buildSqEventMap(
  bars: OHLCBar[],
  timeframe: string,
  market: 'JP' | 'US',
  maxFutureBars: number = 0,
): Map<number, SqEvent[]> {
  if (!bars.length) return new Map();

  const lastTs = bars[bars.length - 1].t;
  const futureEndTs =
    maxFutureBars > 0 && timeframe === '1D'
      ? barTimestampAt(bars, bars.length + maxFutureBars - 1, '1D') + 40 * 86400000
      : lastTs + 40 * 86400000;

  const from = new Date(bars[0].t - 40 * 86400000);
  const to = new Date(futureEndTs);
  const events = getSqEventsInRange(from, to, market);

  const map = new Map<number, SqEvent[]>();
  for (const event of events) {
    let idx = findBarIndexForEvent(bars, event.date.getTime(), timeframe);
    if (idx === -1 && maxFutureBars > 0 && timeframe === '1D') {
      idx = findFutureBarIndexForEvent(bars, event.date.getTime(), maxFutureBars);
    }
    if (idx !== -1) {
      const existing = map.get(idx);
      map.set(idx, existing ? [...existing, event] : [event]);
    }
  }

  return map;
}
