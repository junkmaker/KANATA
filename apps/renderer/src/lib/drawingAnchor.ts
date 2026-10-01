import type { DrawingObject, OHLCBar } from '../types';
import { barTimestampAt, nextBarTimestamp } from './futureBars';

/**
 * 描画の時間軸を「バー番号」と「バー時刻」の間で変換するリーフモジュール（issue #81）。
 *
 * 日足は `period="5y"` のローリング窓で取得するため、日が進むと先頭バーが落ちて
 * 同じバー番号が後ろの日付を指すようになる。保存形式の真実源はバー時刻（`t` / `t1` / `t2`）とし、
 * 表示・当たり判定の直前に `resolveDrawing` で現在のデータでのインデックスへ解決し直す。
 * 保存直前には `anchorDrawing` でインデックスから時刻を書き込む。
 */

/** 整数とみなす誤差。時刻 → インデックスの浮動小数誤差で 40 が 39.9999999 になるのを防ぐ */
const INTEGER_EPS = 1e-9;
/** 未来方向の探索上限。壊れた時刻で無限ループしないための保険（MAX_FUTURE_BARS より十分大きく取る） */
const MAX_FUTURE_SEARCH = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 先頭バーの名目間隔（データ窓より過去への外挿に使う）。
 * 日足の次バーは土日を飛ばすので、先頭が金曜だと 3 日になってしまう。曜日に依存させないため 1 日に固定する
 */
function firstStep(data: readonly OHLCBar[], tf: string): number {
  if (tf === '1D') return DAY_MS;
  return nextBarTimestamp(data[0].t, tf) - data[0].t;
}

/** 整数インデックス k のバー時刻。k < 0（データ窓より過去）は先頭バーの名目間隔で外挿する */
function timeAtInt(data: readonly OHLCBar[], k: number, tf: string): number {
  if (k >= 0) return barTimestampAt(data, k, tf);
  return data[0].t + k * firstStep(data, tf);
}

function snapInteger(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - r) < INTEGER_EPS ? r : x;
}

/** 小数インデックス → 時刻。隣接 2 バーの間を線形補間する。データが空なら null */
export function indexToTime(data: readonly OHLCBar[], idx: number, tf: string): number | null {
  if (data.length === 0) return null;
  const k = Math.floor(idx);
  const f = idx - k;
  const t0 = timeAtInt(data, k, tf);
  if (f === 0) return t0;
  return t0 + f * (timeAtInt(data, k + 1, tf) - t0);
}

/** 時刻 → 小数インデックス（indexToTime の逆関数）。データが空なら null */
export function timeToIndex(data: readonly OHLCBar[], t: number, tf: string): number | null {
  if (data.length === 0) return null;
  const last = data.length - 1;

  // データ窓より過去
  if (t < data[0].t) return snapInteger((t - data[0].t) / firstStep(data, tf));

  // データ窓の中: data[i].t <= t を満たす最大の i を二分探索する
  if (t <= data[last].t) {
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (data[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    if (lo === last) return lo;
    const span = data[lo + 1].t - data[lo].t;
    if (span <= 0) return lo;
    return snapInteger(lo + (t - data[lo].t) / span);
  }

  // 未来: 最終バーから futureBars と同じ刻みで進める
  let k = last;
  let tk = data[last].t;
  let tNext = nextBarTimestamp(tk, tf);
  for (let n = 0; tNext <= t && n < MAX_FUTURE_SEARCH; n++) {
    k++;
    tk = tNext;
    tNext = nextBarTimestamp(tk, tf);
  }
  const span = tNext - tk;
  return snapInteger(span > 0 ? k + (t - tk) / span : k);
}

/** 描画のインデックス成分から時刻アンカーを書き込んだ新しい描画を返す（保存直前に呼ぶ） */
export function anchorDrawing(
  d: DrawingObject,
  data: readonly OHLCBar[],
  tf: string,
): DrawingObject {
  if (data.length === 0) return d;
  if (d.idx == null && d.i1 == null && d.i2 == null) return d;
  const next: DrawingObject = { ...d };
  if (d.idx != null) next.t = indexToTime(data, d.idx, tf) ?? undefined;
  if (d.i1 != null) next.t1 = indexToTime(data, d.i1, tf) ?? undefined;
  if (d.i2 != null) next.t2 = indexToTime(data, d.i2, tf) ?? undefined;
  return next;
}

/** 時刻アンカーから現在のデータでのインデックスを解決した描画を返す（表示・当たり判定の直前に呼ぶ） */
export function resolveDrawing(
  d: DrawingObject,
  data: readonly OHLCBar[],
  tf: string,
): DrawingObject {
  if (data.length === 0) return d;
  if (d.t == null && d.t1 == null && d.t2 == null) return d;
  const next: DrawingObject = { ...d };
  if (d.t != null) next.idx = timeToIndex(data, d.t, tf) ?? d.idx;
  if (d.t1 != null) next.i1 = timeToIndex(data, d.t1, tf) ?? d.i1;
  if (d.t2 != null) next.i2 = timeToIndex(data, d.t2, tf) ?? d.i2;
  return next;
}

/** 配列版。どれも変わらなければ元の配列参照を返す */
export function resolveDrawings(
  ds: readonly DrawingObject[],
  data: readonly OHLCBar[],
  tf: string,
): DrawingObject[] {
  const next = ds.map((d) => resolveDrawing(d, data, tf));
  return next.every((d, i) => d === ds[i]) ? (ds as DrawingObject[]) : next;
}

/** 時刻導入前に保存された（インデックス成分に対応する時刻を欠く）描画か */
function isLegacy(d: DrawingObject): boolean {
  return (
    (d.idx != null && d.t == null) ||
    (d.i1 != null && d.t1 == null) ||
    (d.i2 != null && d.t2 == null)
  );
}

/**
 * 時刻アンカーを持たない旧データを、現在のデータで固定する。
 * 対象は ticker が一致するもの（ticker 未設定の描画は全銘柄に出るので対象に含める）。
 * 何も変えなかったら**元の配列参照を返す**（呼び出し側 effect の無限更新を防ぐ）。
 */
export function pinLegacyDrawings(
  ds: readonly DrawingObject[],
  data: readonly OHLCBar[],
  tf: string,
  ticker: string,
): DrawingObject[] {
  if (data.length === 0) return ds as DrawingObject[];
  const next = ds.map((d) =>
    isLegacy(d) && (d.ticker == null || d.ticker === ticker) ? anchorDrawing(d, data, tf) : d,
  );
  return next.every((d, i) => d === ds[i]) ? (ds as DrawingObject[]) : next;
}
