import { fmtDate } from './formatters';

/** ラベル同士に最低限空ける余白（px）。 */
const MIN_LABEL_GAP = 10;

/** 幅に余裕がある時の目安ラベル本数。従来の `nVis / 10` を踏襲する。 */
const TARGET_LABEL_COUNT = 10;

/**
 * 各フィールドが 2 桁になる時刻。`fmtDate` の書式ごとの**最大幅**を測るための見本。
 * 実データではなくこれを測ることで、view の先頭がどのバーでも結果が変わらない。
 */
const WIDEST_SAMPLE_MS = new Date(2026, 11, 28, 22, 38).getTime();

/**
 * 幅測定用のラベル見本を返す。`fmtDate` を通すので、書式を変えても
 * 測定側が自動で追従する（桁数を別途ハードコードしない）。
 */
export function widestDateLabel(tf: string): string {
  return fmtDate(WIDEST_SAMPLE_MS, tf);
}

/**
 * X 軸ラベルの間引き間隔（バー何本ごとに 1 ラベルか）を返す。
 *
 * 本数基準（`nVis / 10`）だけで決めるとラベル幅を無視するため、日中足の
 * `YY/MM/DD HH:mm` が狭いウィンドウで隣と重なる。実測幅から必要な間隔を求め、
 * 本数基準と比べて**広い方**を採る。幅に余裕がある時は従来どおりの見た目になる。
 *
 * `labelWidth` は呼び出し側が `ctx.measureText` で実測した値を渡す。算術で
 * 見積もらないのは、JetBrains Mono が未ロードで代替フォントに落ちた場合でも
 * 実際の描画幅で判断するため。
 */
export function tickStepForLabels(
  nVis: number,
  barWidth: number,
  labelWidth: number,
  minGap: number = MIN_LABEL_GAP,
): number {
  const byCount = Math.floor(nVis / TARGET_LABEL_COUNT);
  // レイアウト確定前は bw が 0 や非有限になりうる。その時は本数基準のみで決める。
  if (!Number.isFinite(barWidth) || barWidth <= 0 || !Number.isFinite(labelWidth)) {
    return Math.max(1, byCount);
  }
  const byWidth = Math.ceil((labelWidth + minGap) / barWidth);
  return Math.max(1, byCount, byWidth);
}
