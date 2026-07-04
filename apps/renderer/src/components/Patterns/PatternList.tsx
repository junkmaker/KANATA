import { fmtDate } from '../../lib/formatters';
import type { PatternMatch } from '../../types';
import { PatternSignalBadge } from './PatternSignalBadge';

type Props = {
  matches: PatternMatch[];
  timeframe: string;
};

export function PatternList({ matches, timeframe }: Props) {
  // 新しい順に表示（元配列は破壊しない）
  const ordered = [...matches].reverse();
  return (
    <div className="pattern-list">
      <div className="pattern-list-head">検出パターン {matches.length}件</div>
      {ordered.length === 0 ? (
        <div className="pattern-list-empty">パターンは検出されませんでした</div>
      ) : (
        <ul className="pattern-list-items">
          {ordered.map((m) => (
            <li key={`${m.type}-${m.idx}`} className="pattern-list-row">
              <span className="pattern-list-date">{fmtDate(m.t, timeframe)}</span>
              <span className="pattern-list-label">{m.label}</span>
              <PatternSignalBadge signal={m.signal} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
