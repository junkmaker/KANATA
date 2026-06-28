import { useMemo } from 'react';
import type { MacroIndicator, MacroSignal } from '../../types';
import { MacroLineChart } from './MacroLineChart';
import { SignalBadge } from './SignalBadge';

const TITLE: Record<string, string> = {
  hy_oas: 'HY OAS',
  net_liquidity: 'Fed純流動性',
  rsp_spy: 'RSP/SPY',
};

const SUBTITLE: Record<string, string> = {
  hy_oas: 'ハイイールド・スプレッド',
  net_liquidity: 'WALCL − RRP − TGA',
  rsp_spy: '等加重 ÷ 時価加重',
};

const SIGNAL_LINE_COLOR: Record<MacroSignal, string> = {
  green: 'var(--bull)',
  yellow: 'var(--amber)',
  red: 'var(--bear)',
  gray: 'var(--muted)',
};

function formatValue(value: number, unit: string): string {
  if (unit === 'bp') {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} bp`;
  }
  if (unit === 'USD_trillion') {
    return `${value.toFixed(2)} 兆$`;
  }
  if (unit === 'ratio') {
    return value.toFixed(4);
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function formatChange(change: number | null, unit: string): string {
  if (change == null) return '—';
  const sign = change > 0 ? '+' : '';
  if (unit === 'bp') return `${sign}${change.toFixed(0)} bp`;
  if (unit === 'USD_trillion') return `${sign}${change.toFixed(2)}`;
  if (unit === 'ratio') return `${sign}${change.toFixed(4)}`;
  return `${sign}${change}`;
}

type Props = {
  indicator: MacroIndicator;
};

export function MacroCard({ indicator }: Props) {
  const { latest, meta, unit, series, signal } = indicator;
  const title = TITLE[indicator.indicator] ?? indicator.indicator;
  const subtitle = SUBTITLE[indicator.indicator] ?? '';

  const lowLine = useMemo(() => {
    if (indicator.indicator !== 'rsp_spy' || series.length === 0) return null;
    return Math.min(...series.map((p) => p.value));
  }, [indicator.indicator, series]);

  const changeUp = latest?.change != null && latest.change >= 0;

  return (
    <div className="macro-card">
      <div className="macro-card-head">
        <div className="macro-card-titles">
          <div className="macro-card-title">{title}</div>
          <div className="macro-card-subtitle">{subtitle}</div>
        </div>
        <SignalBadge signal={signal} />
      </div>

      {meta.available && latest ? (
        <>
          <div className="macro-card-values">
            <span className="macro-card-value">{formatValue(latest.value, unit)}</span>
            <span className={`macro-card-change ${changeUp ? 'up' : 'down'}`}>
              {formatChange(latest.change, unit)}
            </span>
          </div>
          <MacroLineChart
            series={series}
            color={SIGNAL_LINE_COLOR[signal]}
            lowLine={lowLine}
          />
          <div className="macro-card-flags">
            {meta.stale && <span className="macro-flag stale">stale</span>}
            {latest.provisional && <span className="macro-flag provisional">速報値</span>}
          </div>
        </>
      ) : (
        <div className="macro-card-unavailable">
          データ取得不可
          {indicator.indicator !== 'rsp_spy' && <div className="macro-hint">FRED_API_KEY 未設定</div>}
        </div>
      )}
    </div>
  );
}
