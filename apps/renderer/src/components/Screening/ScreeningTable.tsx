import { resolveMarketCap, sortByBreakDate, toBadges } from '../../lib/screeningView';
import type { ScreeningResult } from '../../types';
import { ScreeningThumbnail } from './ScreeningThumbnail';

type Props = {
  results: ScreeningResult[];
  onSelectSymbol: (ticker: string, name: string) => void;
};

/**
 * N字候補の一覧。**スコアは表示しない**。
 *
 * スコアにも構成要素にも前方リターンの予測力が無いことがバックテストで確定したため
 * (docs/completed/n_pattern_backtest_spec.md §16.2)、順位付けに期待値の含意を持たせない。
 * 並びはブレイク日の新しい順で、要素は集約せずバッジで individually 出す。
 */
export function ScreeningTable({ results, onSelectSymbol }: Props) {
  const sorted = sortByBreakDate(results);

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
            <th>ブレイク日</th>
            <th>特徴</th>
            <th>サムネイル</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const badges = toBadges(r.score_detail);
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
                <td className="screening-breakdate">{r.break_date}</td>
                <td>
                  {/* バッジは「パターンの事実」であって品質の評価ではない。
                      良し悪しを示す配色は使わず、数で並べ替えもしない。 */}
                  <div className="screening-badges">
                    {badges.length === 0 ? (
                      <span className="screening-badge-none">—</span>
                    ) : (
                      badges.map((b) => (
                        <span key={b.key} className="screening-badge">
                          {b.label}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td>
                  <ScreeningThumbnail closes={r.closes} pivots={r.pivots} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
