import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchFundamentals } from '../../lib/api';
import { COMPARE_COLORS } from '../../lib/colors';
import { fmtPrice } from '../../lib/formatters';
import { toggleSelection } from '../../lib/selection';
import type { AppState, FinMetrics, OHLCBar, Ticker, Watchlist } from '../../types';
import { AddSymbolForm } from './AddSymbolForm';
import { WatchlistSelector } from './WatchlistSelector';

interface WatchlistController {
  status: 'loading' | 'ready' | 'offline';
  watchlists: Watchlist[];
  activeId: number | null;
  onSelectActive: (id: number) => void;
  create: (name: string) => Promise<void>;
  rename: (id: number, name: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  addItem: (symbol: string, market: string, displayName?: string) => Promise<void>;
  removeItem: (symbol: string) => Promise<void>;
  reorderItems: (symbols: string[]) => Promise<void>;
  error: string | null;
  clearError: () => void;
}

interface RightPanelProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  tickers: Ticker[];
  data: Record<string, OHLCBar[]>;
  watchlist: WatchlistController;
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="metric">
      <div className="m-label">{label}</div>
      <div className="m-value" style={color ? { color } : {}}>
        {value}
      </div>
    </div>
  );
}

export function RightPanel({ state, setState, tickers, data, watchlist }: RightPanelProps) {
  const [q, setQ] = useState('');
  const [marketFilter, setMarketFilter] = useState('ALL');
  const [editing, setEditing] = useState(false);
  const [fetchedFin, setFetchedFin] = useState<FinMetrics | null>(null);
  const [draggedCode, setDraggedCode] = useState<string | null>(null);
  const [dragOverCode, setDragOverCode] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<'top' | 'bottom'>('bottom');
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const scrollDirectionRef = useRef<'up' | 'down' | null>(null);

  // Source list for the visible watchlist rows (the active list's members)
  const visibleTickers = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return tickers.filter((t) => {
      if (marketFilter !== 'ALL' && t.market !== marketFilter) return false;
      if (!ql) return true;
      return (
        t.code.toLowerCase().includes(ql) ||
        t.name.toLowerCase().includes(ql) ||
        (t.sector || '').toLowerCase().includes(ql)
      );
    });
  }, [tickers, q, marketFilter]);

  const isDraggable = editing && q === '' && marketFilter === 'ALL';

  const memberSymbols = useMemo(() => new Set(tickers.map((t) => t.code)), [tickers]);

  // Auto-exit editing mode if backend goes offline
  useEffect(() => {
    if (watchlist.status !== 'ready') setEditing(false);
  }, [watchlist.status]);

  const primaryTicker = tickers.find((t) => t.code === state.selected[0]);
  useEffect(() => {
    if (!primaryTicker) {
      setFetchedFin(null);
      return;
    }
    let cancelled = false;
    fetchFundamentals(primaryTicker.code)
      .then((fin) => {
        if (!cancelled) setFetchedFin(fin);
      })
      .catch(() => {
        if (!cancelled) setFetchedFin(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primaryTicker?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (code: string) => {
    setState((s) => ({ ...s, selected: toggleSelection(s.selected, code, s.compareMode) }));
  };

  const makePrimary = (code: string) => {
    setState((s) => {
      const rest = s.selected.filter((c) => c !== code);
      return { ...s, selected: [code, ...rest] };
    });
  };

  const handleRemoveSymbol = async (code: string) => {
    await watchlist.removeItem(code);
    setState((s) => ({ ...s, selected: s.selected.filter((c) => c !== code) }));
  };

  const stopAutoScroll = () => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    scrollDirectionRef.current = null;
  };

  const startAutoScroll = (direction: 'up' | 'down') => {
    if (scrollDirectionRef.current === direction) return;
    stopAutoScroll();
    scrollDirectionRef.current = direction;
    const SPEED = 8;
    const tick = () => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTop += direction === 'up' ? -SPEED : SPEED;
      scrollRafRef.current = requestAnimationFrame(tick);
    };
    scrollRafRef.current = requestAnimationFrame(tick);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, code: string) => {
    setDraggedCode(code);
    e.dataTransfer.effectAllowed = 'move';
    const el = e.currentTarget;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.cssText = [
      'position:fixed',
      'top:-9999px',
      'left:-9999px',
      `width:${el.offsetWidth}px`,
      'transform:scale(1.04)',
      'transform-origin:left top',
      'border:1px solid var(--accent)',
      'border-radius:2px',
      'box-shadow:0 8px 24px rgba(0,0,0,0.5)',
    ].join(';');
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, 20, el.offsetHeight / 2);
    setTimeout(() => document.body.removeChild(clone), 0);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, code: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (code === draggedCode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDragPosition(e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom');
    setDragOverCode(code);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverCode(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetCode: string) => {
    e.preventDefault();
    if (!draggedCode || draggedCode === targetCode) {
      setDraggedCode(null);
      setDragOverCode(null);
      return;
    }
    const codes = tickers.map((t) => t.code);
    const from = codes.indexOf(draggedCode);
    const to = codes.indexOf(targetCode);
    if (from === -1 || to === -1) return;
    const next = [...codes];
    next.splice(from, 1);
    const insertIdx = dragPosition === 'top' ? (from < to ? to - 1 : to) : from < to ? to : to + 1;
    next.splice(insertIdx, 0, draggedCode);
    watchlist.reorderItems(next);
    setDraggedCode(null);
    setDragOverCode(null);
  };

  const handleDragEnd = () => {
    setDraggedCode(null);
    setDragOverCode(null);
    stopAutoScroll();
  };

  const handleListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const el = listRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ZONE = 60;
    if (e.clientY < rect.top + ZONE) {
      startAutoScroll('up');
    } else if (e.clientY > rect.bottom - ZONE) {
      startAutoScroll('down');
    } else {
      stopAutoScroll();
    }
  };

  const handleListDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    stopAutoScroll();
  };

  const primary = state.selected[0];
  const primarySeries = data[primary];
  const last = primarySeries?.[primarySeries.length - 1];
  const prev = primarySeries?.[primarySeries.length - 2];
  const displayFin = fetchedFin ?? primaryTicker?.fin;

  return (
    <aside className="panel panel-right">
      <div className="section">
        <div className="section-head">
          <span>ウォッチリスト</span>
          <span className="hint">{state.selected.length} 件選択中</span>
        </div>
        <WatchlistSelector
          watchlists={watchlist.watchlists}
          activeId={watchlist.activeId}
          status={watchlist.status}
          editing={editing}
          onSelect={watchlist.onSelectActive}
          onCreate={watchlist.create}
          onRename={watchlist.rename}
          onDelete={watchlist.remove}
          onToggleEdit={() => setEditing((e) => !e)}
        />
        <div className="search-row">
          <input
            className="search-input"
            placeholder="コード・銘柄名で検索…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {editing && (
          <AddSymbolForm
            activeListId={watchlist.activeId}
            existingSymbols={memberSymbols}
            onAdd={watchlist.addItem}
            disabled={watchlist.status !== 'ready'}
          />
        )}
        {editing && watchlist.error && <div className="watchlist-error">{watchlist.error}</div>}
        <div className="market-tabs">
          {(
            [
              { id: 'ALL', label: '全て' },
              { id: 'JP', label: 'JP' },
              { id: 'US', label: 'US' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              className={`mkt-tab${marketFilter === m.id ? ' active' : ''}`}
              onClick={() => setMarketFilter(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="ticker-list"
        ref={listRef}
        onDragOver={isDraggable ? handleListDragOver : undefined}
        onDragLeave={isDraggable ? handleListDragLeave : undefined}
      >
        {visibleTickers.map((t) => {
          const series = data[t.code];
          const ll = series && series.length >= 1 ? series[series.length - 1] : null;
          const pp = series && series.length >= 2 ? series[series.length - 2] : null;
          const c = ll && pp ? ll.c - pp.c : 0;
          const cp = ll && pp ? (c / pp.c) * 100 : 0;
          const selIdx = state.selected.indexOf(t.code);
          const selected = selIdx >= 0;
          const isPrimary = selIdx === 0;
          const color =
            selected && !isPrimary ? COMPARE_COLORS[selIdx % COMPARE_COLORS.length] : null;

          const spark = series && series.length >= 2 ? series.slice(-40) : [];
          let pts = '';
          if (spark.length >= 2) {
            let min = Infinity,
              max = -Infinity;
            spark.forEach((b) => {
              if (b.c < min) min = b.c;
              if (b.c > max) max = b.c;
            });
            pts = spark
              .map((b, i) => {
                const x = (i / (spark.length - 1)) * 52;
                const y = 14 - ((b.c - min) / (max - min + 1e-9)) * 12;
                return x.toFixed(1) + ',' + y.toFixed(1);
              })
              .join(' ');
          }

          return (
            <div
              key={t.code}
              className={[
                'ticker-row',
                selected ? 'selected' : '',
                isPrimary ? 'primary' : '',
                isDraggable && draggedCode === t.code ? 'dragging' : '',
                isDraggable && dragOverCode === t.code && dragPosition === 'top'
                  ? 'drag-over-top'
                  : '',
                isDraggable && dragOverCode === t.code && dragPosition === 'bottom'
                  ? 'drag-over-bottom'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable={isDraggable}
              onDragStart={isDraggable ? (e) => handleDragStart(e, t.code) : undefined}
              onDragOver={isDraggable ? (e) => handleDragOver(e, t.code) : undefined}
              onDragLeave={isDraggable ? handleDragLeave : undefined}
              onDrop={isDraggable ? (e) => handleDrop(e, t.code) : undefined}
              onDragEnd={isDraggable ? handleDragEnd : undefined}
              onClick={() => toggle(t.code)}
              onDoubleClick={() => makePrimary(t.code)}
            >
              <div className="tick-left">
                {isDraggable && (
                  <div className="drag-handle" title="ドラッグして並び替え">
                    &#8942;&#8942;
                  </div>
                )}
                <div
                  className="tick-chk"
                  style={selected && color ? { background: color, borderColor: color } : {}}
                >
                  {isPrimary ? '●' : selected ? selIdx + 1 : ''}
                </div>
                <div className="tick-meta">
                  <div className="tick-code">
                    {t.code}
                    <span className="tick-mkt">{t.market}</span>
                  </div>
                  <div className="tick-name">{t.name}</div>
                </div>
              </div>
              <div className="tick-mid">
                <svg width={54} height={16} viewBox="0 0 52 14" className="spark">
                  {pts && (
                    <polyline
                      points={pts}
                      fill="none"
                      stroke={c >= 0 ? 'var(--bull)' : 'var(--bear)'}
                      strokeWidth={1}
                    />
                  )}
                </svg>
              </div>
              <div className="tick-right">
                <div className="tick-price">{ll ? fmtPrice(ll.c, t.currency) : '—'}</div>
                <div className={`tick-chg ${ll && pp ? (c >= 0 ? 'up' : 'down') : ''}`}>
                  {ll && pp ? `${c >= 0 ? '+' : ''}${cp.toFixed(2)}%` : '—'}
                </div>
              </div>
              {editing && (
                <button
                  className="tick-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveSymbol(t.code);
                  }}
                  title="リストから削除"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {primaryTicker && last && prev && displayFin && (
        <div className="section fundamentals">
          <div className="section-head">
            <span>ファンダメンタルズ</span>
            <span className="hint">{primaryTicker.code}</span>
          </div>
          <div className="fund-grid">
            <Metric label="ROE" value={displayFin.roe.toFixed(1) + '%'} color="var(--lime)" />
            <Metric label="ROIC" value={displayFin.roic.toFixed(1) + '%'} color="var(--teal)" />
            <Metric label="PER" value={displayFin.per.toFixed(1) + '×'} color="var(--amber)" />
            <Metric label="PBR" value={displayFin.pbr.toFixed(2) + '×'} />
            <Metric label="DIV" value={displayFin.div.toFixed(1) + '%'} />
            <Metric label="MCAP" value={displayFin.mcap} />
          </div>
          <div className="sector">
            <span className="label">セクター</span>
            <span>{primaryTicker.sector}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
