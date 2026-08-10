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
export type CandlePatternType =
  | 'bearish_engulfing'
  | 'bearish_harami'
  | 'bullish_engulfing'
  | 'bullish_harami'
  | 'doji'
  | 'evening_star'
  | 'hammer'
  | 'hanging_man'
  | 'island_bottom'
  | 'island_top'
  | 'morning_star'
  | 'two_black_gapping'
  | 'upside_gap_two_white';
export type PatternSignal = 'bullish' | 'bearish' | 'neutral';

/**
 * フィルタチップの選択値。`all` は絞り込みなし。
 *
 * `AppState.patternFilter` と `lib/patternView.ts` が共有する。同じ union を
 * 両方に書くと片方だけ広げても tsc が通ってしまうため、ここを唯一の定義にする。
 * `lib/` ではなく `types.ts` に置くのは、`types.ts` を依存の末端に保つため
 * （`types.ts` が `lib/` を import すると循環の入口になる）。
 */
export type PatternFilter = CandlePatternType | 'all';

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
  drawingColor: string;
  /** 描画オブジェクト（トレンドライン等）を表示するか。false でも drawings は保持される */
  showDrawings: boolean;
  showVolume: boolean;
  showFinancial: boolean;
  showSqMarkers: boolean;
  indicators: IndicatorState;
  financial: FinancialState;
  indicatorParams: IndicatorParams;
  patternFilter: PatternFilter;
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

// --- N-pattern screening ---
export interface ScreeningPivot {
  index: number;
  date: string;
  price: number;
  type: 'low' | 'high';
}

export interface ScreeningScoreDetail {
  trend: number;
  breakout: number;
  volume: number;
  macd: number;
  pullback_penalty: number;
  duration_penalty: number;
}

export interface ScreeningClose {
  date: string;
  value: number;
}

export interface ScreeningResult {
  ticker: string;
  name: string;
  /** ユニバース CSV の登録値。足切りフィルタとフォールバック表示に使う。 */
  market_cap: number | null;
  /** スキャン実施日時点の時価総額（発行済株式数 × 最終日足終値）。取得失敗時 null。 */
  market_cap_asof: number | null;
  /** market_cap_asof の基準日（最終日足バーの日付、`YYYY-MM-DD`）。値が無ければ null。 */
  market_cap_date: string | null;
  score: number;
  score_detail: ScreeningScoreDetail;
  pivots: ScreeningPivot[];
  break_date: string;
  closes: ScreeningClose[];
}

export interface ScreeningResponse {
  generated_at: string | null;
  universe_count: number;
  scanned_count: number;
  universe_id: string | null;
  universe_name: string | null;
  results: ScreeningResult[];
}

// --- PPP screening ---
/** スクリーニングのパターン種別。値はエンドポイントのパス片と同じ綴り。 */
export type ScreeningPattern = 'n-pattern' | 'ppp';

export interface PppResult {
  ticker: string;
  name: string;
  /** ユニバース CSV の登録値。足切りフィルタとフォールバック表示に使う。 */
  market_cap: number | null;
  /** スキャン実施日時点の時価総額（発行済株式数 × 最終日足終値）。取得失敗時 null。 */
  market_cap_asof: number | null;
  /** market_cap_asof の基準日（最終日足バーの日付、`YYYY-MM-DD`）。値が無ければ null。 */
  market_cap_date: string | null;
  /** 成立イベント日（out → in の遷移バー）。銘柄ごとに最新の 1 件。 */
  established_date: string;
  /** 成立日から最終バーまでの経過バー本数。**列には出さない**（検証用に持つだけ）。 */
  duration_days: number;
  closes: ScreeningClose[];
}

export interface PppResponse {
  generated_at: string | null;
  universe_count: number;
  scanned_count: number;
  universe_id: string | null;
  universe_name: string | null;
  results: PppResult[];
}

export interface ScreeningUniverse {
  id: string;
  name: string;
  symbol_count: number;
  has_market_cap: boolean;
  created_at: string | null;
  builtin: boolean;
}

export type ScanStatus = 'idle' | 'running' | 'done' | 'error';

export interface ScreeningScanStatus {
  status: ScanStatus;
  done: number;
  total: number;
  started_at: string | null;
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
