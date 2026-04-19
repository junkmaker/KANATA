export interface OHLCBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface FinMetrics {
  roe: number;
  roic: number;
  per: number;
  pbr: number;
  div: number;
  mcap: string;
}

export interface Ticker {
  code: string;
  name: string;
  market: string;
  sector: string;
  seed: number;
  start: number;
  vol: number;
  drift: number;
  base: number;
  currency: string;
  fin: FinMetrics;
}

export interface FinBar {
  t: number;
  roe: number;
  roic: number;
  per: number;
}

export interface IndicatorState {
  sma5: boolean;
  sma25: boolean;
  sma75: boolean;
  ema20: boolean;
  boll: boolean;
  stoch: boolean;
  psar: boolean;
  ichi: boolean;
}

export interface FinancialState {
  roe: boolean;
  roic: boolean;
  per: boolean;
}

export type DrawingType = 'hline' | 'vline' | 'trend' | 'rect' | 'ellipse' | 'text';

export interface DrawingObject {
  id: number;
  type: DrawingType;
  ticker?: string;
  color?: string;
  v?: number;
  idx?: number;
  i1?: number;
  v1?: number;
  i2?: number;
  v2?: number;
  text?: string;
}

export interface AppState {
  selected: string[];
  timeframe: string;
  compareMode: string;
  activeTool: string;
  drawings: DrawingObject[];
  showVolume: boolean;
  showFinancial: boolean;
  indicators: IndicatorState;
  financial: FinancialState;
}

export interface YRange {
  min: number;
  max: number;
}

export interface BOLLResult {
  mid: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export interface STOCHResult {
  k: (number | null)[];
  d: (number | null)[];
}

export interface ICHIResult {
  tenkan: (number | null)[];
  kijun: (number | null)[];
  senkouA: (number | null)[];
  senkouB: (number | null)[];
  chikou: (number | null)[];
}

export interface IndiData {
  sma5?: (number | null)[];
  sma25?: (number | null)[];
  sma75?: (number | null)[];
  ema20?: (number | null)[];
  boll?: BOLLResult;
  stoch?: STOCHResult;
  psar?: (number | null)[];
  ichi?: ICHIResult;
}

export interface SearchResult {
  code: string;
  name: string;
  market: 'JP' | 'US';
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface WatchlistItem {
  id: number;
  symbol: string;
  market: string;
  display_name: string | null;
  position: number;
}

export interface Watchlist {
  id: number;
  name: string;
  position: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  items: WatchlistItem[];
}
