import type { OHLCBar } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * 日足バーの取引所ローカルの曜日（0=日曜, 6=土曜）。
 * 日足は取引所ローカルの 0 時に置かれる（JST なら前日 15:00 UTC、NY なら当日 04:00/05:00 UTC）。
 * 12 時間足すと UTC-11〜UTC+12 のどの取引所でも当日の暦日に入るので、閲覧端末のタイムゾーンに依存しない。
 */
function exchangeWeekday(t: number): number {
  return new Date(t + HALF_DAY_MS).getUTCDay();
}

/**
 * 日足の次のバー時刻。土日を飛ばす（実データも土日にバーを持たないため）。
 * 暦日で進めると、未来領域に置いた描画が実データの到着後に週末ぶんずれる（issue #81）。
 * 祝日はカレンダーを持たないので飛ばせない（祝日 1 日につき 1 本ずれる）。
 */
function nextDailyTimestamp(prevT: number): number {
  let t = prevT + DAY_MS;
  while (exchangeWeekday(t) === 0 || exchangeWeekday(t) === 6) t += DAY_MS;
  return t;
}

export function nextBarTimestamp(prevT: number, tf: string): number {
  if (tf === '5m') return prevT + 5 * 60 * 1000;
  if (tf === '15m') return prevT + 15 * 60 * 1000;
  if (tf === '60m') return prevT + 60 * 60 * 1000;
  if (tf === '1D') return nextDailyTimestamp(prevT);
  if (tf === '1W') return prevT + 7 * 24 * 60 * 60 * 1000;
  if (tf === '1M') {
    const d = new Date(prevT);
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  }
  return prevT + DAY_MS;
}

export function barTimestampAt(data: readonly OHLCBar[], idx: number, tf: string): number {
  if (idx < data.length) return data[idx].t;
  let t = data[data.length - 1].t;
  for (let i = data.length; i <= idx; i++) {
    t = nextBarTimestamp(t, tf);
  }
  return t;
}
