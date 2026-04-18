import { useState, useEffect, useMemo } from 'react';
import type { AppState } from './types';
import { TICKERS, DATA, TF, retime } from './lib/data';
import { useChartData } from './hooks/useChartData';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { TweaksPanel } from './components/TweaksPanel';
import { LeftPanel } from './components/LeftPanel/LeftPanel';
import { RightPanel } from './components/RightPanel/RightPanel';
import { Chart } from './components/Chart/Chart';
import './styles/globals.css';

const DEFAULT_STATE: AppState = {
  selected: ['AAPL'],
  timeframe: '1D',
  compareMode: 'percent',
  activeTool: 'pan',
  drawings: [],
  showVolume: true,
  showFinancial: true,
  indicators: {
    sma5: false,
    sma25: true,
    sma75: true,
    ema20: false,
    boll: false,
    stoch: true,
    psar: false,
    ichi: false,
  },
  financial: { roe: true, roic: true, per: true },
};

function loadState(): AppState {
  try {
    const s = localStorage.getItem('kanata.state');
    if (s) return { ...DEFAULT_STATE, ...JSON.parse(s) };
  } catch { /* noop */ }
  return DEFAULT_STATE;
}

export function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [aesthetic, setAesthetic] = useState(() => {
    try { return localStorage.getItem('kanata.aesthetic') || 'dark-blue'; } catch { return 'dark-blue'; }
  });
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem('kanata.density') || 'comfortable'; } catch { return 'comfortable'; }
  });

  // Synthetic data for all tickers (watchlist sparklines + fallback)
  const syntheticData = useMemo(() => {
    const d: Record<string, typeof DATA[string]> = {};
    const tfMs = TF[state.timeframe] || TF['1D'];
    TICKERS.forEach(t => { d[t.code] = retime(DATA[t.code], tfMs); });
    return d;
  }, [state.timeframe]);

  // Real data for selected tickers from backend
  const { realData, status } = useChartData(state.selected, state.timeframe);

  // Merge: real data overrides synthetic for selected tickers
  const data = useMemo(() => {
    const merged = { ...syntheticData };
    state.selected.forEach(sym => {
      if (realData[sym]?.length) merged[sym] = realData[sym];
    });
    return merged;
  }, [syntheticData, realData, state.selected]);

  useEffect(() => {
    try { localStorage.setItem('kanata.state', JSON.stringify(state)); } catch { /* noop */ }
  }, [state]);

  useEffect(() => {
    try { localStorage.setItem('kanata.aesthetic', aesthetic); } catch { /* noop */ }
    document.documentElement.dataset.aesthetic = aesthetic;
  }, [aesthetic]);

  useEffect(() => {
    try { localStorage.setItem('kanata.density', density); } catch { /* noop */ }
    document.documentElement.dataset.density = density;
  }, [density]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === '__activate_edit_mode') setTweaksOpen(true);
      else if (e.data.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const primary = state.selected[0];
  const primaryTicker = TICKERS.find(t => t.code === primary);
  const primarySeries = data[primary];
  const last = primarySeries[primarySeries.length - 1];
  const prev = primarySeries[primarySeries.length - 2];
  const chg = last.c - prev.c;
  const chgPct = chg / prev.c * 100;
  const up = chg >= 0;

  return (
    <div className="app">
      <TopBar
        state={state}
        setState={setState}
        primaryTicker={primaryTicker}
        last={last}
        chg={chg}
        chgPct={chgPct}
        up={up}
        dataStatus={status}
      />
      <div className="main-grid">
        <LeftPanel state={state} setState={setState} />
        <div className="chart-area">
          <Chart state={state} setState={setState} tickers={TICKERS} data={data} />
        </div>
        <RightPanel state={state} setState={setState} tickers={TICKERS} data={data} />
      </div>
      <StatusBar state={state} primaryTicker={primaryTicker} last={last} />
      {tweaksOpen && (
        <TweaksPanel
          aesthetic={aesthetic}
          setAesthetic={setAesthetic}
          density={density}
          setDensity={setDensity}
          onClose={() => setTweaksOpen(false)}
          state={state}
          setState={setState}
        />
      )}
    </div>
  );
}
