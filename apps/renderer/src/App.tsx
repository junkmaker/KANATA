import { useEffect, useMemo, useState } from 'react';
import { Chart } from './components/Chart/Chart';
import { LeftPanel } from './components/LeftPanel/LeftPanel';
import { MacroDashboard } from './components/Macro/MacroDashboard';
import { PatternView } from './components/Patterns/PatternView';
import { RightPanel } from './components/RightPanel/RightPanel';
import { ScreeningView } from './components/Screening/ScreeningView';
import { StatusBar } from './components/StatusBar';
import { TopBar } from './components/TopBar';
import { TweaksPanel } from './components/TweaksPanel';
import { useAlertCheck } from './hooks/useAlertCheck';
import { useChartData } from './hooks/useChartData';
import { useWatchlists } from './hooks/useWatchlists';
import { subscribeBackendUrlChange } from './lib/backendUrl';
import { buildExtraTicker, inferMarketForCode } from './lib/extraTicker';
import { migrateLegacyWatchlist } from './lib/migrateLocalState';
import { clampSelectionForMode } from './lib/selection';
import { watchlistToTickers } from './lib/watchlistTickers';
import type { AppState } from './types';
import './styles/globals.css';

const ACTIVE_LIST_KEY = 'kanata.activeWatchlistId';
const VIEW_KEY = 'kanata.view';

type View = 'chart' | 'pattern' | 'macro' | 'screening';

function loadView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'macro' || v === 'pattern' || v === 'screening') return v;
    return 'chart';
  } catch {
    return 'chart';
  }
}

const DEFAULT_STATE: AppState = {
  selected: [],
  timeframe: '1D',
  compareMode: 'percent',
  activeTool: 'pan',
  drawings: [],
  selectedDrawingId: null,
  showVolume: true,
  showFinancial: true,
  showSqMarkers: true,
  indicators: {
    sma5: false,
    sma25: true,
    sma75: true,
    ema20: false,
    boll: false,
    stoch: true,
    psar: false,
    ichi: false,
    macd: false,
    rsi: false,
  },
  financial: { roe: true, roic: true, per: true },
  indicatorParams: {
    macd: { fast: 12, slow: 26, signal: 9 },
    rsi: { period: 14, overbought: 70, oversold: 30 },
  },
  patternFilter: 'all',
};

function loadState(): AppState {
  try {
    const s = localStorage.getItem('kanata.state');
    if (s) {
      const saved = JSON.parse(s);
      const merged: AppState = {
        ...DEFAULT_STATE,
        ...saved,
        indicators: { ...DEFAULT_STATE.indicators, ...(saved.indicators || {}) },
        indicatorParams: {
          macd: { ...DEFAULT_STATE.indicatorParams.macd, ...(saved.indicatorParams?.macd || {}) },
          rsi: { ...DEFAULT_STATE.indicatorParams.rsi, ...(saved.indicatorParams?.rsi || {}) },
        },
      };
      // 比較を非表示のときは単一選択を不変条件として保証する（永続状態が複数でも起動時に正規化）
      return { ...merged, selected: clampSelectionForMode(merged.selected, merged.compareMode) };
    }
  } catch {
    /* noop */
  }
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
    try {
      return localStorage.getItem('kanata.aesthetic') || 'dark-blue';
    } catch {
      return 'dark-blue';
    }
  });
  const [view, setView] = useState<View>(loadView);
  // スクリーニングから選んだウォッチリスト外銘柄(チャート描画のため一時的に加える)
  const [extra, setExtra] = useState<{ code: string; name: string } | null>(null);

  const wl = useWatchlists();
  const [activeListId, setActiveListId] = useState<number | null>(loadActiveListId);

  // サイドカー再起動（FRED キー保存など）で新ポートに変わったら URL キャッシュを追従させる
  useEffect(() => subscribeBackendUrlChange(), []);

  // One-shot migration of legacy localStorage watchlist on first ready load
  useEffect(() => {
    if (wl.status !== 'ready') return;
    migrateLegacyWatchlist(wl.watchlists).then((created) => {
      if (created) wl.reload();
    });
  }, [wl.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the active watchlist (fall back to default / first if missing)
  const activeList = useMemo(() => {
    if (wl.watchlists.length === 0) return null;
    if (activeListId !== null) {
      const found = wl.watchlists.find((w) => w.id === activeListId);
      if (found) return found;
    }
    return wl.watchlists.find((w) => w.is_default === 1) || wl.watchlists[0];
  }, [wl.watchlists, activeListId]);

  // Persist active list selection
  useEffect(() => {
    if (activeList) {
      try {
        localStorage.setItem(ACTIVE_LIST_KEY, String(activeList.id));
      } catch {
        /* noop */
      }
    }
  }, [activeList]);

  const displayTickers = useMemo(() => {
    if (wl.status === 'offline') return [];
    return watchlistToTickers(activeList);
  }, [wl.status, activeList]);

  // ウォッチリスト外のスクリーニング銘柄を合成 Ticker として一時的に加える
  const extraTicker = useMemo(() => {
    if (!extra) return null;
    if (displayTickers.some((t) => t.code === extra.code)) return null;
    return buildExtraTicker(extra.code, extra.name);
  }, [extra, displayTickers]);

  const chartTickers = useMemo(
    () => (extraTicker ? [...displayTickers, extraTicker] : displayTickers),
    [displayTickers, extraTicker],
  );

  // Real data for all tickers from backend (keeps prices consistent regardless of selection)
  const allSymbols = useMemo(() => chartTickers.map((t) => t.code), [chartTickers]);
  const { realData, status } = useChartData(allSymbols, state.timeframe);
  useAlertCheck(state.drawings, realData, status);

  const data = realData;

  useEffect(() => {
    try {
      localStorage.setItem('kanata.state', JSON.stringify(state));
    } catch {
      /* noop */
    }
  }, [state]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* noop */
    }
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem('kanata.aesthetic', aesthetic);
    } catch {
      /* noop */
    }
    document.documentElement.dataset.aesthetic = aesthetic;
  }, [aesthetic]);

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
    if (chartTickers.length === 0) return;
    setState((s) => {
      const codes = new Set(chartTickers.map((t) => t.code));
      const filtered = s.selected.filter((c) => codes.has(c));
      if (filtered.length === s.selected.length && filtered.length > 0) return s;
      const next = filtered.length > 0 ? filtered : [chartTickers[0].code];
      return { ...s, selected: next };
    });
  }, [chartTickers]);

  // スクリーニングの行クリック: 当該銘柄を選択してチャートビューへ遷移
  const handleSelectFromScreening = (ticker: string, name: string) => {
    const inWatchlist = displayTickers.some((t) => t.code === ticker);
    setExtra(inWatchlist ? null : { code: ticker, name });
    setState((s) => ({ ...s, selected: [ticker] }));
    setView('chart');
  };

  // スクリーニング銘柄バナーの「＋リストに追加」: アクティブリストへ永続追加
  const handleAddExtra = async () => {
    if (!extra || !activeList) return;
    await wl.addItem(activeList.id, extra.code, inferMarketForCode(extra.code), extra.name);
  };

  const watchlistController = useMemo(
    () => ({
      status: wl.status,
      watchlists: wl.watchlists,
      activeId: activeList?.id ?? null,
      error: wl.error,
      clearError: wl.clearError,
      onSelectActive: (id: number) => setActiveListId(id),
      create: async (name: string) => {
        const created = await wl.create(name);
        if (created) setActiveListId(created.id);
      },
      rename: async (id: number, name: string) => {
        await wl.rename(id, name);
      },
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
      reorderItems: async (symbols: string[]) => {
        if (!activeList) return;
        await wl.reorderItems(activeList.id, symbols);
      },
    }),
    [wl, activeList, activeListId],
  );

  const primary = state.selected[0];
  const primaryTicker = chartTickers.find((t) => t.code === primary);
  const primarySeries = data[primary];
  const last = primarySeries?.[primarySeries.length - 1];
  const prev = primarySeries?.[primarySeries.length - 2];
  const chg = last && prev ? last.c - prev.c : 0;
  const chgPct = last && prev ? (chg / prev.c) * 100 : 0;
  const up = chg >= 0;

  // Still fetching watchlists from backend
  if (wl.status === 'loading') {
    return (
      <div className="app">
        <div style={{ padding: 24 }}>読み込み中…</div>
      </div>
    );
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
        view={view}
        onViewChange={setView}
        onOpenSettings={() => setTweaksOpen(true)}
      />
      {view === 'macro' ? (
        <div className="main-grid macro-view">
          <MacroDashboard />
        </div>
      ) : view === 'pattern' ? (
        <div className="main-grid pattern-grid">
          <PatternView state={state} setState={setState} tickers={displayTickers} data={data} />
        </div>
      ) : view === 'screening' ? (
        <div className="main-grid screening-view-grid">
          <ScreeningView onSelectSymbol={handleSelectFromScreening} />
        </div>
      ) : (
        <div className="main-grid">
          <LeftPanel state={state} setState={setState} />
          <div className="chart-area">
            {chartTickers.length === 0 ? (
              <div className="chart-empty">ウォッチリストに銘柄を追加してください</div>
            ) : (
              <Chart state={state} setState={setState} tickers={chartTickers} data={data} />
            )}
          </div>
          <div data-testid="watchlist">
            <RightPanel
              state={state}
              setState={setState}
              tickers={displayTickers}
              data={data}
              watchlist={watchlistController}
              extraTicker={extraTicker}
              onAddExtra={handleAddExtra}
            />
          </div>
        </div>
      )}
      <StatusBar state={state} primaryTicker={primaryTicker} last={last} />
      {tweaksOpen && (
        <TweaksPanel
          aesthetic={aesthetic}
          setAesthetic={setAesthetic}
          onClose={() => setTweaksOpen(false)}
          state={state}
          setState={setState}
        />
      )}
    </div>
  );
}
