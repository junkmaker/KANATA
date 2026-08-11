export function fmtPrice(v: number | null | undefined, cur = '$'): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (cur === '¥') return cur + Math.round(v).toLocaleString();
  return cur + v.toFixed(2);
}

export function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * バーの時刻を `YY/MM/DD`（日中足は `YY/MM/DD HH:mm`）で返す。
 *
 * ロケール API を使わないのは、`toLocaleDateString('en-GB')` の英語月名だと
 * 月ごとに文字幅が変わり、Canvas の X 軸ラベルと等幅フォントの列で桁が揃わないため。
 * ゼロ埋めして常に固定幅にする。
 *
 * **ローカル時刻の getter を使う**（`getUTC*` ではない）。置き換え前の
 * `toLocaleDateString` は `timeZone` 未指定でローカル解釈だったため、
 * UTC getter にすると JST では日足の表示日が 1 日ずれる。
 */
export function fmtDate(t: number, tf: string): string {
  const d = new Date(t);
  const ymd = `${pad2(d.getFullYear() % 100)}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  if (tf === '5m' || tf === '15m' || tf === '60m') {
    return `${ymd} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return ymd;
}
