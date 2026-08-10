import type { OHLCBar, Ticker, Watchlist, WatchlistItem } from '../types';
import { genSeries } from './data';

const FALLBACK_FIN = { roe: 0, roic: 0, per: 0, pbr: 0, div: 0, mcap: '—' };

function hashSeed(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return h || 1;
}

/**
 * 市場コードだけでは表示単位が決まらないシンボルの明示指定。`''` は「単位なし」。
 *
 * **`^` 始まりを一律で単位なしにしないこと**。^N225 や ^GSPC のような株価指数は
 * 構成銘柄の価格から作られるので通貨単位が付いていたほうが読みやすい。
 * 単位を外すのは VIX 系のように価格ではない指数だけ。
 */
const CURRENCY_OVERRIDES: Record<string, string> = {
  'NIY=F': '¥', // CME 日経225先物。US 上場だが円建て
  'NKD=F': '$', // 同じ日経225でもこちらはドル建て
  '^VIX': '', // ボラティリティ指数。通貨建てではない
  '^VXN': '',
  '^RVX': '',
  '^VVIX': '',
};

/**
 * 表示単位を返す。空文字は「単位なし」を意味するので、
 * 呼び出し側は `|| '$'` ではなく `?? '$'` でフォールバックすること。
 */
export function inferCurrency(symbol: string, market: string): string {
  const override = CURRENCY_OVERRIDES[symbol.toUpperCase()];
  if (override !== undefined) return override;
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
    currency: inferCurrency(item.symbol, item.market),
    fin: { ...FALLBACK_FIN },
  };
}

export function watchlistToTickers(list: Watchlist | null | undefined): Ticker[] {
  if (!list || list.items.length === 0) return [];
  return list.items.map(itemToTicker);
}

export function syntheticSeriesForTicker(t: Ticker): OHLCBar[] {
  return genSeries({
    seed: t.seed,
    bars: 1500,
    start: t.start,
    vol: t.vol,
    drift: t.drift,
    base: t.base,
  });
}
