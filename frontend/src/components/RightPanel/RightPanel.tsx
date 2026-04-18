import { useState, useMemo } from 'react';
import type { AppState, Ticker, OHLCBar } from '../../types';
import { COMPARE_COLORS } from '../../lib/colors';
import { fmtPrice } from '../../lib/formatters';

interface RightPanelProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  tickers: Ticker[];
  data: Record<string, OHLCBar[]>;
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="metric">
      <div className="m-label">{label}</div>
      <div className="m-value" style={color ? { color } : {}}>{value}</div>
    </div>
  );
}

export function RightPanel({ state, setState, tickers, data }: RightPanelProps) {
  const [q, setQ] = useState('');
  const [marketFilter, setMarketFilter] = useState('ALL');

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return tickers.filter(t => {
      if (marketFilter !== 'ALL' && t.market !== marketFilter) return false;
      if (!ql) return true;
      return t.code.toLowerCase().includes(ql) || t.name.toLowerCase().includes(ql) || t.sector.toLowerCase().includes(ql);
    });
  }, [tickers, q, marketFilter]);

  const toggle = (code: string) => {
    setState(s => {
      const sel = s.selected.includes(code)
        ? s.selected.filter(c => c !== code)
        : [...s.selected, code];
      if (sel.length === 0) return s;
      if (sel.length > 6) sel.shift();
      return { ...s, selected: sel };
    });
  };

  const makePrimary = (code: string) => {
    setState(s => {
      const rest = s.selected.filter(c => c !== code);
      return { ...s, selected: [code, ...rest] };
    });
  };

  const primary = state.selected[0];
  const primaryTicker = tickers.find(t => t.code === primary);
  const primarySeries = data[primary];
  const last = primarySeries[primarySeries.length - 1];
  const prev = primarySeries[primarySeries.length - 2];
  const chg = last.c - prev.c;
  const chgPct = chg / prev.c * 100;

  return (
    <aside className="panel panel-right">
      <div className="section">
        <div className="section-head">
          <span>WATCHLIST</span>
          <span className="hint">{state.selected.length} selected</span>
        </div>
        <div className="search-row">
          <input
            className="search-input"
            placeholder="Search code or name…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <div className="market-tabs">
          {['ALL', 'JP', 'US'].map(m => (
            <button key={m} className={`mkt-tab${marketFilter === m ? ' active' : ''}`} onClick={() => setMarketFilter(m)}>
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="ticker-list">
        {filtered.map(t => {
          const series = data[t.code];
          const ll = series[series.length - 1];
          const pp = series[series.length - 2];
          const c = ll.c - pp.c;
          const cp = c / pp.c * 100;
          const selIdx = state.selected.indexOf(t.code);
          const selected = selIdx >= 0;
          const isPrimary = selIdx === 0;
          const color = selected && !isPrimary ? COMPARE_COLORS[selIdx % COMPARE_COLORS.length] : null;

          const spark = series.slice(-40);
          let min = Infinity, max = -Infinity;
          spark.forEach(b => { if (b.c < min) min = b.c; if (b.c > max) max = b.c; });
          const pts = spark.map((b, i) => {
            const x = (i / (spark.length - 1)) * 52;
            const y = 14 - ((b.c - min) / (max - min + 1e-9)) * 12;
            return x.toFixed(1) + ',' + y.toFixed(1);
          }).join(' ');

          return (
            <div
              key={t.code}
              className={`ticker-row${selected ? ' selected' : ''}${isPrimary ? ' primary' : ''}`}
              onClick={() => toggle(t.code)}
              onDoubleClick={() => makePrimary(t.code)}
            >
              <div className="tick-left">
                <div className="tick-chk" style={selected && color ? { background: color, borderColor: color } : {}}>
                  {isPrimary ? '●' : (selected ? selIdx + 1 : '')}
                </div>
                <div className="tick-meta">
                  <div className="tick-code">
                    {t.code}<span className="tick-mkt">{t.market}</span>
                  </div>
                  <div className="tick-name">{t.name}</div>
                </div>
              </div>
              <div className="tick-mid">
                <svg width={54} height={16} viewBox="0 0 52 14" className="spark">
                  <polyline points={pts} fill="none" stroke={c >= 0 ? 'var(--bull)' : 'var(--bear)'} strokeWidth={1} />
                </svg>
              </div>
              <div className="tick-right">
                <div className="tick-price">{fmtPrice(ll.c, t.currency)}</div>
                <div className={`tick-chg ${c >= 0 ? 'up' : 'down'}`}>{c >= 0 ? '+' : ''}{cp.toFixed(2)}%</div>
              </div>
            </div>
          );
        })}
      </div>

      {primaryTicker && (
        <div className="section fundamentals">
          <div className="section-head">
            <span>FUNDAMENTALS</span>
            <span className="hint">{primaryTicker.code}</span>
          </div>
          <div className="fund-grid">
            <Metric label="ROE" value={primaryTicker.fin.roe.toFixed(1) + '%'} color="var(--lime)" />
            <Metric label="ROIC" value={primaryTicker.fin.roic.toFixed(1) + '%'} color="var(--teal)" />
            <Metric label="PER" value={primaryTicker.fin.per.toFixed(1) + '×'} color="var(--amber)" />
            <Metric label="PBR" value={primaryTicker.fin.pbr.toFixed(2) + '×'} />
            <Metric label="DIV" value={primaryTicker.fin.div.toFixed(1) + '%'} />
            <Metric label="MCAP" value={primaryTicker.fin.mcap} />
          </div>
          <div className="sector">
            <span className="label">SECTOR</span>
            <span>{primaryTicker.sector}</span>
          </div>
        </div>
      )}

      {/* suppress unused warning */}
      {false && chg && chgPct}
    </aside>
  );
}
