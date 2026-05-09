import type { AppState, OHLCBar, Ticker } from '../types';

interface StatusBarProps {
  state: AppState;
  primaryTicker: Ticker | undefined;
  last: OHLCBar | undefined;
}

export function StatusBar({ state }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span>
        TF <b>{state.timeframe}</b>
      </span>
      <span>
        SYM <b>{state.selected.join(' · ')}</b>
      </span>
      <span>
        TOOL <b>{state.activeTool.toUpperCase()}</b>
      </span>
      <span>
        DRAW <b>{state.drawings.length}</b>
      </span>
      <span style={{ marginLeft: 'auto' }}>
        ドラッグでパン · スクロールでズーム · 行をダブルクリックでメインに設定
      </span>
    </footer>
  );
}
