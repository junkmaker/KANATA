import { useMemo } from 'react';
import { buildPatternMap, detectPatterns } from '../../lib/candlePatterns';
import type { AppState, CandlePatternType, OHLCBar, Ticker } from '../../types';
import { Chart } from '../Chart/Chart';
import { PatternFilterBar } from './PatternFilterBar';
import { PatternList } from './PatternList';
import './patterns.css';

type PatternFilter = CandlePatternType | 'all';

type Props = {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  tickers: Ticker[];
  data: Record<string, OHLCBar[]>;
};

export function PatternView({ state, setState, tickers, data }: Props) {
  const primary = state.selected[0];
  const bars = data[primary];

  // 検出は当ビューの単一ソース（Chart は描画のみ）
  const allMatches = useMemo(() => (bars ? detectPatterns(bars) : []), [bars]);
  const filtered = useMemo(
    () =>
      state.patternFilter === 'all'
        ? allMatches
        : allMatches.filter((m) => m.type === state.patternFilter),
    [allMatches, state.patternFilter],
  );
  const patternMap = useMemo(() => buildPatternMap(filtered), [filtered]);

  const setFilter = (f: PatternFilter) => setState((s) => ({ ...s, patternFilter: f }));

  return (
    <div className="pattern-view">
      <PatternFilterBar value={state.patternFilter} onChange={setFilter} />
      {bars ? (
        <>
          <div className="pattern-chart-wrap">
            <Chart
              state={state}
              setState={setState}
              tickers={tickers}
              data={data}
              patternMatches={patternMap}
              allowPaneExpand={false}
            />
          </div>
          <PatternList matches={filtered} timeframe={state.timeframe} />
        </>
      ) : (
        <div className="pattern-view-empty">銘柄を選択してください</div>
      )}
    </div>
  );
}
