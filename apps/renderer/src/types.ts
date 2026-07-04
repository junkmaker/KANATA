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
  macd: boolean;
  rsi: boolean;
}

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export interface MACDParams {
  fast: number;
  slow: number;
  signal: number;
}

export interface RSIParams {
  period: number;
  overbought: number;
  oversold: number;
}

export interface IndicatorParams {
  macd: MACDParams;
  rsi: RSIParams;
}

export interface FinancialState {
  roe: boolean;
  roic: boolean;
  per: boolean;
}

export type DrawingType = 'hline' | 'vline' | 'trend' | 'rect' | 'ellipse' | 'text';

export type PaneId = 'price' | 'stoch' | 'macd' | 'rsi';

export interface DrawingObject {
  id: number;
  type: DrawingType;
  pane?: PaneId;
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

// --- Candlestick patterns ---
export type CandlePatternType = 'bullish_engulfing' | 'doji' | 'evening_star' | 'hammer';
export type PatternSignal = 'bullish' | 'bearish' | 'neutral';

export interface PatternMatch {
  type: CandlePatternType;
  signal: PatternSignal;
  label: string; // 例: '陽線包み'
  idx: number; // プライマリ OHLC 配列のバー index（パターン確定バー）
  spanStart: number; // ハイライト枠開始 index（単一足なら idx と同じ）
  spanEnd: number; // ハイライト枠終了 index（確定バー、宵の明星は idx）
  t: number; // 確定バーの時刻（ms）
}

export interface AppState {
  selected: string[];
  timeframe: string;
  compareMode: string;
  activeTool: string;
  drawings: DrawingObject[];
  selectedDrawingId: number | null;
  showVolume: boolean;
  showFinancial: boolean;
  showSqMarkers: boolean;
  indicators: IndicatorState;
  financial: FinancialState;
  indicatorParams: IndicatorParams;
  patternFilter: CandlePatternType | 'all';
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
  macd?: MACDResult;
  rsi?: (number | null)[];
}

export type AlertDirection = 'below' | 'above';

export interface AlertObject {
  id: string;
  drawingId: number;
  symbol: string;
  direction: AlertDirection;
  triggered: boolean;
  createdAt: number;
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

// --- Macro dashboard ---
export type MacroSignal = 'green' | 'yellow' | 'red' | 'gray';
export type MacroPeriod = '3M' | '6M' | '1Y' | '2Y';

export interface MacroSeriesPoint {
  date: string;
  value: number;
}

export interface MacroLatest {
  date: string;
  value: number;
  change: number | null;
  provisional: boolean;
}

export interface MacroIndicatorMeta {
  source: string;
  stale: boolean;
  available: boolean;
}

export interface MacroIndicator {
  indicator: string;
  unit: string;
  lens: string;
  signal: MacroSignal;
  latest: MacroLatest | null;
  thresholds: Record<string, string | null>;
  series: MacroSeriesPoint[];
  meta: MacroIndicatorMeta;
}

export interface MacroDashboard {
  overall_signal: MacroSignal;
  indicators: MacroIndicator[];
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
