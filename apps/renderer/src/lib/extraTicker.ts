import type { Ticker } from '../types';
import { itemToTicker } from './watchlistTickers';

const JP_CODE_RE = /^\d{4}$|^\d{3}[A-Z]$/;

export function inferMarketForCode(code: string): 'JP' | 'US' {
  return JP_CODE_RE.test(code) ? 'JP' : 'US';
}

export function buildExtraTicker(code: string, name: string): Ticker {
  const market = inferMarketForCode(code);
  return itemToTicker({
    id: -1,
    symbol: code,
    market,
    display_name: name || code,
    position: 0,
  });
}
