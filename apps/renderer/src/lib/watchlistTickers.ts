import type { OHLCBar, Ticker, Watchlist, WatchlistItem } from '../types';
import { genSeries } from './data';

const FALLBACK_FIN = { roe: 0, roic: 0, per: 0, pbr: 0, div: 0, mcap: '—' };

function hashSeed(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return h || 1;
}

function inferCurrency(market: string): string {
  return market === 'JP' ? '¥' : '$';
}

export function itemToTicker(item: WatchlistItem): Ticker {
  const seed = hashSeed(item.symbol);
  return {
    code: item.symbol,
    name: item.display_name || item.symbol,
    market: item.market,
    sector: '—',
    seed,
    start: 100,
    vol: 0.02,
    drift: 0.0003,
    base: 1_000_000,
    currency: inferCurrency(item.market),
    fin: { ...FALLBACK_FIN },
  };
}

export function watchlistToTickers(list: Watchlist | null | undefined): Ticker[] {
  if (!list || list.items.length === 0) return [];
  return list.items.map(itemToTicker);
}

export function syntheticSeriesForTicker(t: Ticker): OHLCBar[] {
  return genSeries({ seed: t.seed, bars: 1500, start: t.start, vol: t.vol, drift: t.drift, base: t.base });
}
