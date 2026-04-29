import type { AppState, Ticker, OHLCBar } from '../types';
import type { DataStatus } from '../hooks/useChartData';
import { fmtPrice } from '../lib/formatters';
import { WindowControls } from './WindowControls';

interface TopBarProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  primaryTicker: Ticker | undefined;
  last: OHLCBar;
  chg: number;
  chgPct: number;
  up: boolean;
  dataStatus: DataStatus;
}

const STATUS_LABEL: Record<DataStatus, string> = {
  idle: '—',
  loading: 'LOADING',
  ready: 'LIVE',
  error: 'ERROR',
};

const STATUS_COLOR: Record<DataStatus, string> = {
  idle: 'var(--muted)',
  loading: 'var(--amber)',
  ready: 'var(--bull)',
  error: 'var(--bear)',
};

export function TopBar({ primaryTicker, last, chg, chgPct, up, dataStatus }: TopBarProps) {
  const marketTime = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const dotColor = STATUS_COLOR[dataStatus];

  return (
    <header className="topbar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="brand">
        <div className="brand-mark">
          <svg width={20} height={20} viewBox="0 0 20 20">
            <rect x={1} y={11} width={3} height={8} fill="currentColor" />
            <rect x={6} y={6} width={3} height={13} fill="currentColor" />
            <rect x={11} y={9} width={3} height={10} fill="currentColor" />
            <rect x={16} y={2} width={3} height={17} fill="currentColor" />
          </svg>
        </div>
        <div className="brand-text">
          <div className="brand-name">KANATA /TERMINAL</div>
          <div className="brand-sub">chart · v0.4.1</div>
        </div>
      </div>

      {primaryTicker && (
        <div className="top-ticker" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="tt-code">
            {primaryTicker.code}
            <span className="tt-mkt">{primaryTicker.market}</span>
          </div>
          <div className="tt-name">{primaryTicker.name}</div>
          <div className={`tt-price ${up ? 'up' : 'down'}`}>
            {fmtPrice(last.c, primaryTicker.currency)}
          </div>
          <div className={`tt-chg ${up ? 'up' : 'down'}`}>
            {up ? '▲ ' : '▼ '}{up ? '+' : ''}{chg.toFixed(2)} ({up ? '+' : ''}{chgPct.toFixed(2)}%)
          </div>
        </div>
      )}

      <div className="top-controls" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="status-dot" style={{ background: dotColor, boxShadow: `0 0 0 0 ${dotColor}` }} title={STATUS_LABEL[dataStatus]} />
        <span className="status-text" style={{ color: dotColor }}>{STATUS_LABEL[dataStatus]}</span>
        <span className="clock">{marketTime} JST</span>
      </div>

      <WindowControls />
    </header>
  );
}
