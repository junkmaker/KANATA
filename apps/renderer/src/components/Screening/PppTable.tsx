import { resolveMarketCap, sortByDateDesc } from '../../lib/screeningView';
import type { PppResult } from '../../types';
import { ScreeningThumbnail } from './ScreeningThumbnail';

type Props = {
  results: PppResult[];
  onSelectSymbol: (ticker: string, name: string) => void;
};

/**
 * PPP 候補の一覧。**数値列を持たない**。
 *
 * 乖離値を出すと大小比較が始まり、閾値でバッジ化するのはスコアの再発明になる
 * （docs/ppp_screening_spec.md 決定#9）。継続日数（duration_days）も出さない —
 * 成立日と 1 対 1 の情報で、鮮度フィルタが既に同じ軸を扱っているため。
 * 「特徴」バッジ列も持たない（PPP には N字の score_detail に相当するものが無い）。
 *
 * 並びは成立日の新しい順（N字と同じ規約）。
 */
export function PppTable({ results, onSelectSymbol }: Props) {
  const sorted = sortByDateDesc(results, (r) => r.established_date);

  if (sorted.length === 0) {
    return <div className="screening-empty">該当銘柄がありません</div>;
  }

  return (
    <div className="screening-table-wrap">
      <table className="screening-table">
        <thead>
          <tr>
            <th>コード</th>
            <th>銘柄名</th>
            <th className="num">時価総額</th>
            <th>成立日</th>
            <th>サムネイル</th>
          </tr>
        </thead>
        <tbody>
          {/* key は ticker で足りる。銘柄ごとに最新の成立イベント 1 件だけを
              採る設計なので重複しない（docs/ppp_screening_spec.md §5.2）。 */}
          {sorted.map((r) => {
            const cap = resolveMarketCap(r);
            return (
              <tr
                key={r.ticker}
                onClick={() => onSelectSymbol(r.ticker, r.name)}
                className="screening-row"
              >
                <td className="screening-code">{r.ticker}</td>
                <td className="screening-name">{r.name}</td>
                <td
                  className={cap.source === 'universe' ? 'num screening-cap-stale' : 'num'}
                  title={cap.title}
                >
                  {cap.text}
                </td>
                <td className="screening-breakdate">{r.established_date}</td>
                <td>
                  {/* PPP にピボットは無いので pivots を渡さない。 */}
                  <ScreeningThumbnail closes={r.closes} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
