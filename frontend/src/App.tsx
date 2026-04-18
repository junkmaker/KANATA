import { useState, useEffect, useMemo } from 'react';
import type { AppState, OHLCBar } from './types';
import { TICKERS, TF, retime } from './lib/data';
import { useChartData } from './hooks/useChartData';
import { useWatchlists } from './hooks/useWatchlists';
import { migrateLegacyWatchlist } from './lib/migrateLocalState';
import { syntheticSeriesForTicker, watchlistToTickers } from './lib/watchlistTickers';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { TweaksPanel } from './components/TweaksPanel';
import { LeftPanel } from './components/LeftPanel/LeftPanel';
import { RightPanel } from './components/RightPanel/RightPanel';
import { Chart } from './components/Chart/Chart';
import './styles/globals.css';

const ACTIVE_LIST_KEY = 'kanata.activeWatchlistId';

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

function loadActiveListId(): number | null {
  try {
    const v = localStorage.getItem(ACTIVE_LIST_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
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

  const wl = useWatchlists();
  const [activeListId, setActiveListId] = useState<number | null>(loadActiveListId);

  // One-shot migration of legacy localStorage watchlist on first ready load
  useEffect(() => {
    if (wl.status !== 'ready') return;
    migrateLegacyWatchlist(wl.watchlists).then(created => {
      if (created) wl.reload();
    });
  }, [wl.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the active watchlist (fall back to default / first if missing)
  const activeList = useMemo(() => {
    if (wl.watchlists.length === 0) return null;
    if (activeListId !== null) {
      const found = wl.watchlists.find(w => w.id === activeListId);
      if (found) return found;
    }
    return wl.watchlists.find(w => w.is_default === 1) || wl.watchlists[0];
  }, [wl.watchlists, activeListId]);

  // Persist active list selection
  useEffect(() => {
    if (activeList) {
      try { localStorage.setItem(ACTIVE_LIST_KEY, String(activeList.id)); } catch { /* noop */ }
    }
  }, [activeList]);

  // Display tickers come from the active watchlist when ready; otherwise full preset
  const displayTickers = useMemo(() => {
    if (wl.status === 'offline') return TICKERS;
    return watchlistToTickers(activeList);
  }, [wl.status, activeList]);

  // Synthetic OHLC for displayed tickers (sparklines / fallback)
  const syntheticData = useMemo(() => {
    const tfMs = TF[state.timeframe] || TF['1D'];
    const d: Record<string, OHLCBar[]> = {};
    displayTickers.forEach(t => {
      const series = syntheticSeriesForTicker(t);
      d[t.code] = retime(series, tfMs);
    });
    return d;
  }, [state.timeframe, displayTickers]);

  // Real data for selected tickers from backend
  const { realData, status } = useChartData(state.selected, state.timeframe);

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

  // Ensure the primary selection is always available in the visible tickers
  useEffect(() => {
    if (displayTickers.length === 0) return;
    setState(s => {
      const codes = new Set(displayTickers.map(t => t.code));
      const filtered = s.selected.filter(c => codes.has(c));
      if (filtered.length === s.selected.length && filtered.length > 0) return s;
      const next = filtered.length > 0 ? filtered : [displayTickers[0].code];
      return { ...s, selected: next };
    });
  }, [displayTickers]);

  const watchlistController = useMemo(() => ({
    status: wl.status,
    watchlists: wl.watchlists,
    activeId: activeList?.id ?? null,
    onSelectActive: (id: number) => setActiveListId(id),
    create: async (name: string) => {
      const created = await wl.create(name);
      if (created) setActiveListId(created.id);
    },
    rename: async (id: number, name: string) => { await wl.rename(id, name); },
    remove: async (id: number) => {
      const ok = await wl.remove(id);
      if (ok && activeListId === id) setActiveListId(null);
    },
    addItem: async (symbol: string, market: string, displayName?: string) => {
      if (!activeList) return;
      await wl.addItem(activeList.id, symbol, market, displayName);
    },
    removeItem: async (symbol: string) => {
      if (!activeList) return;
      await wl.removeItem(activeList.id, symbol);
    },
  }), [wl, activeList, activeListId]);

  const primary = state.selected[0];
  const primaryTicker = displayTickers.find(t => t.code === primary);
  const primarySeries = data[primary];
  const last = primarySeries?.[primarySeries.length - 1];
  const prev = primarySeries?.[primarySeries.length - 2];
  const chg = last && prev ? last.c - prev.c : 0;
  const chgPct = last && prev ? (chg / prev.c) * 100 : 0;
  const up = chg >= 0;

  if (!last) {
    return <div className="app"><div style={{ padding: 24 }}>Loading…</div></div>;
  }

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
          <Chart state={state} setState={setState} tickers={displayTickers} data={data} />
        </div>
        <RightPanel
          state={state}
          setState={setState}
          tickers={displayTickers}
          data={data}
          searchTickers={TICKERS}
          watchlist={watchlistController}
        />
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
