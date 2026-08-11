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
 * 単位を外すのは VIX 系や利回り指数のように価格ではない系列だけ。
 */
const CURRENCY_OVERRIDES: Record<string, string> = {
  'NIY=F': '¥', // CME 日経225先物。US 上場だが円建て
  'NKD=F': '$', // 同じ日経225でもこちらはドル建て
  '^VIX': '', // ボラティリティ指数。通貨建てではない
  '^VXN': '',
  '^RVX': '',
  '^VVIX': '',
  '^IRX': '', // 米国債利回り指数。値は % であって価格ではない
  '^FVX': '',
  '^TNX': '',
  '^TYX': '',
};

/**
 * yfinance の為替シンボル（`USDJPY=X` と、USD 基軸を省いた短縮形 `JPY=X`）。
 *
 * 表を列挙せず正規表現にしているのは組み合わせが際限なく増えるため。
 * 単位なしにする理由は 2 つ:
 * - レートは 2 通貨の比なので、どちらか片方の記号を前置しても正しくならない
 * - `fmtPrice` の `¥` は円建て株価のために整数へ丸めるので、USDJPY に `¥` を
 *   与えると 152.34 が `¥152` になり為替に必要な精度が落ちる
 *
 * `=F`（先物）は対象外なので `NIY=F` とは衝突しない。
 */
const FX_SYMBOL_RE = /^[A-Z]{3,6}=X$/;

/**
 * 表示単位を返す。空文字は「単位なし」を意味するので、
 * 呼び出し側は `|| '$'` ではなく `?? '$'` でフォールバックすること。
 */
export function inferCurrency(symbol: string, market: string): string {
  const upper = symbol.toUpperCase();
  const override = CURRENCY_OVERRIDES[upper];
  if (override !== undefined) return override;
  if (FX_SYMBOL_RE.test(upper)) return '';
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
