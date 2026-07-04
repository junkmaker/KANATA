import { useMemo } from 'react';
import type { MacroIndicator, MacroSignal } from '../../types';
import { InfoTooltip } from './InfoTooltip';
import { MacroLineChart } from './MacroLineChart';
import { MACRO_INFO, type MacroInfo } from './macroInfo';
import { SignalBadge } from './SignalBadge';

const TITLE: Record<string, string> = {
  hy_oas: 'HY OAS',
  net_liquidity: 'Fed純流動性',
  rsp_spy: 'RSP/SPY',
  nikkei_sp: 'NS倍率',
  nikkei_topix: 'NT倍率',
  brent_wti: 'ブレント-WTI',
};

const SUBTITLE: Record<string, string> = {
  hy_oas: 'ハイイールド・スプレッド',
  net_liquidity: 'WALCL − RRP − TGA',
  rsp_spy: '等加重 ÷ 時価加重',
  nikkei_sp: '日経225 ÷ S&P500',
  nikkei_topix: '日経225 ÷ TOPIX(1306)',
  brent_wti: 'ブレント − WTI スプレッド',
};

// yfinance 由来（FRED キー非依存）の指標。unavailable 時に FRED_API_KEY ヒントを出さない。
const YFINANCE_INDICATORS = ['rsp_spy', 'nikkei_sp', 'nikkei_topix', 'brent_wti'];

// 上昇=良好で安値線が意味を持つ指標（安値ラインをオーバーレイ表示する）。
const LOW_LINE_INDICATORS = ['rsp_spy', 'nikkei_sp', 'nikkei_topix'];

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
  if (unit === 'usd_bbl') {
    return `$${value.toFixed(2)}`;
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function formatChange(change: number | null, unit: string): string {
  if (change == null) return '—';
  const sign = change > 0 ? '+' : '';
  if (unit === 'bp') return `${sign}${change.toFixed(0)} bp`;
  if (unit === 'USD_trillion') return `${sign}${change.toFixed(2)}`;
  if (unit === 'ratio') return `${sign}${change.toFixed(4)}`;
  if (unit === 'usd_bbl') return `${sign}$${change.toFixed(2)}`;
  return `${sign}${change}`;
}

// criteria の各色は SignalBadge の SIGNAL_COLOR/SIGNAL_LABEL と一貫させる。
const CRITERIA_ROWS: { key: keyof MacroInfo['criteria']; color: string; label: string }[] = [
  { key: 'green', color: 'var(--bull)', label: '良好' },
  { key: 'yellow', color: 'var(--amber)', label: '注意' },
  { key: 'red', color: 'var(--bear)', label: '警戒' },
];

// ツールチップ本体。MacroCard / MacroDashboard で共有する。
export function MacroInfoBody({ title, info }: { title: string; info: MacroInfo }) {
  return (
    <>
      <div className="macro-tooltip-title">{title}</div>
      <div className="macro-tooltip-section-label">内容</div>
      <div className="macro-tooltip-text">{info.what}</div>
      <div className="macro-tooltip-section-label">読み方</div>
      <div className="macro-tooltip-text">{info.read}</div>
      <div className="macro-tooltip-section-label">判断基準</div>
      {CRITERIA_ROWS.map((row) => (
        <div key={row.key} className="macro-tooltip-criteria-row">
          <span className="macro-tooltip-dot" style={{ background: row.color }} />
          <span className="macro-tooltip-text">
            <span style={{ color: row.color }}>{row.label}</span>: {info.criteria[row.key]}
          </span>
        </div>
      ))}
    </>
  );
}

type Props = {
  indicator: MacroIndicator;
};

export function MacroCard({ indicator }: Props) {
  const { latest, meta, unit, series, signal } = indicator;
  const title = TITLE[indicator.indicator] ?? indicator.indicator;
  const subtitle = SUBTITLE[indicator.indicator] ?? '';
  const info = MACRO_INFO[indicator.indicator];

  const lowLine = useMemo(() => {
    if (!LOW_LINE_INDICATORS.includes(indicator.indicator) || series.length === 0) return null;
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
        {info && (
          <InfoTooltip
            content={<MacroInfoBody title={`${title} ${subtitle}`} info={info} />}
            label={`${title} の解説`}
          />
        )}
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
          {!YFINANCE_INDICATORS.includes(indicator.indicator) && (
            <div className="macro-hint">FRED_API_KEY 未設定</div>
          )}
        </div>
      )}
    </div>
  );
}
