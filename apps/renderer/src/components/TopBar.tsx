import type { DataStatus } from '../hooks/useChartData';
import { fmtPrice } from '../lib/formatters';
import type { AppState, OHLCBar, Ticker } from '../types';
import { WindowControls } from './WindowControls';

type View = 'chart' | 'pattern' | 'macro';

interface TopBarProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  primaryTicker: Ticker | undefined;
  last: OHLCBar | undefined;
  chg: number;
  chgPct: number;
  up: boolean;
  dataStatus: DataStatus;
  view: View;
  onViewChange: (view: View) => void;
  onOpenSettings: () => void;
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

export function TopBar({
  primaryTicker,
  last,
  chg,
  chgPct,
  up,
  dataStatus,
  view,
  onViewChange,
  onOpenSettings,
}: TopBarProps) {
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
          <div className="brand-name">KANATA</div>
          <div className="brand-sub">chart · v0.4.1</div>
        </div>
      </div>

      <div className="view-switch" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          type="button"
          className={`view-tab ${view === 'chart' ? 'active' : ''}`}
          onClick={() => onViewChange('chart')}
        >
          チャート
        </button>
        <button
          type="button"
          className={`view-tab ${view === 'pattern' ? 'active' : ''}`}
          onClick={() => onViewChange('pattern')}
        >
          パターン
        </button>
        <button
          type="button"
          className={`view-tab ${view === 'macro' ? 'active' : ''}`}
          onClick={() => onViewChange('macro')}
        >
          マクロ
        </button>
      </div>

      {primaryTicker && (
        <div className="top-ticker" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="tt-code">
            {primaryTicker.code}
            <span className="tt-mkt">{primaryTicker.market}</span>
          </div>
          <div className="tt-name">{primaryTicker.name}</div>
          <div className={`tt-price ${up ? 'up' : 'down'}`}>
            {last ? fmtPrice(last.c, primaryTicker.currency) : '—'}
          </div>
          <div className={`tt-chg ${last ? (up ? 'up' : 'down') : ''}`}>
            {last
              ? `${up ? '▲ ' : '▼ '}${up ? '+' : ''}${chg.toFixed(2)} (${up ? '+' : ''}${chgPct.toFixed(2)}%)`
              : '—'}
          </div>
        </div>
      )}

      <div className="top-controls" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div
          className="status-dot"
          style={{ background: dotColor, boxShadow: `0 0 0 0 ${dotColor}` }}
          title={STATUS_LABEL[dataStatus]}
        />
        <span className="status-text" style={{ color: dotColor }}>
          {STATUS_LABEL[dataStatus]}
        </span>
        <span className="clock">{marketTime} JST</span>
        <button
          type="button"
          className="settings-btn"
          onClick={onOpenSettings}
          title="設定"
          aria-label="設定"
        >
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx={12} cy={12} r={3} />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <WindowControls />
    </header>
  );
}
