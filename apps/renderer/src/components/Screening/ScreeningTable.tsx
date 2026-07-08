import type { ScreeningResult } from '../../types';
import { ScreeningThumbnail } from './ScreeningThumbnail';

type Props = {
  results: ScreeningResult[];
  onSelectSymbol: (ticker: string) => void;
};

function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return `${(cap / 1e12).toFixed(1)}兆`;
  if (cap >= 1e8) return `${Math.round(cap / 1e8)}億`;
  return String(cap);
}

export function ScreeningTable({ results, onSelectSymbol }: Props) {
  // score 降順はバックエンド保証だが、表示前に念のため非破壊ソートする。
  const sorted = [...results].sort((a, b) => b.score - a.score);

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
            <th className="num">スコア</th>
            <th>サムネイル</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.ticker} onClick={() => onSelectSymbol(r.ticker)} className="screening-row">
              <td className="screening-code">{r.ticker}</td>
              <td className="screening-name">{r.name}</td>
              <td className="num">{formatMarketCap(r.market_cap)}</td>
              <td className="num screening-score">{r.score}</td>
              <td>
                <ScreeningThumbnail closes={r.closes} pivots={r.pivots} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
