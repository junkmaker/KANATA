import { COLORS } from '../../../lib/colors';
import type { OHLCBar, PatternMatch, PatternSignal } from '../../../types';

// シグナル → 矢印/ラベル色（Canvas 側は COLORS を参照）
const SIGNAL_COLOR: Record<PatternSignal, string> = {
  bullish: COLORS.bull,
  bearish: COLORS.bear,
  neutral: COLORS.amber,
};

const MARKER_GAP = 10; // バー高安から矢印までの距離(px)
const MARKER_STACK = 16; // 同一バーに複数マッチある場合の縦積み間隔(px)
const TRI_HALF = 5; // 三角形の底辺の半幅(px)
const TRI_HEIGHT = 8; // 三角形の高さ(px)
const LABEL_GAP = 4; // 矢印とラベルの距離(px)
const LABEL_H = 10; // ラベル文字の想定高さ(px、9px フォント + 余白)
const HIGHLIGHT_ALPHA = 0.14; // 宵の明星ハイライト枠の塗り透明度
const HIGHLIGHT_PAD = 4; // ハイライト枠の上下パディング(px)

interface HighlightParams {
  ctx: CanvasRenderingContext2D;
  xScale: (i: number) => number;
  yScale: (v: number) => number;
  bars: OHLCBar[];
  matchesByBar: Map<number, PatternMatch[]>;
  viewStart: number;
  viewEnd: number;
  bw: number;
}

// 複数バーにまたがるパターン（宵の明星）の半透明ハイライト枠。
// candles ループの直前（clip 内）で呼ぶ。
export function drawPatternHighlights({
  ctx,
  xScale,
  yScale,
  bars,
  matchesByBar,
  viewStart,
  viewEnd,
  bw,
}: HighlightParams): void {
  for (let i = viewStart; i < viewEnd; i++) {
    const matches = matchesByBar.get(i);
    if (!matches || matches.length === 0) continue;
    for (const m of matches) {
      if (m.spanStart >= m.spanEnd) continue; // 単一足はハイライトしない
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = m.spanStart; j <= m.spanEnd; j++) {
        const b = bars[j];
        if (!b) continue;
        if (b.h > hi) hi = b.h;
        if (b.l < lo) lo = b.l;
      }
      if (hi === -Infinity) continue;
      const x0 = xScale(m.spanStart) - bw / 2;
      const x1 = xScale(m.spanEnd) + bw / 2;
      const yTop = yScale(hi) - HIGHLIGHT_PAD;
      const yBot = yScale(lo) + HIGHLIGHT_PAD;
      ctx.globalAlpha = HIGHLIGHT_ALPHA;
      ctx.fillStyle = SIGNAL_COLOR[m.signal];
      ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = SIGNAL_COLOR[m.signal];
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(yTop) + 0.5, x1 - x0, yBot - yTop);
    }
  }
}

interface MarkerParams {
  ctx: CanvasRenderingContext2D;
  xScale: (i: number) => number;
  yScale: (v: number) => number;
  bars: OHLCBar[];
  matchesByBar: Map<number, PatternMatch[]>;
  viewStart: number;
  viewEnd: number;
  padT: number; // 価格ペイン上端(px)
  priceBottom: number; // 価格ペイン下端(px)
}

// 矢印（強気=下から上向き / 弱気=上から下向き）とラベルを描く。
// ctx.restore() の後に呼び、ローソクの上に重ねる。
export function drawPatternMarkers({
  ctx,
  xScale,
  yScale,
  bars,
  matchesByBar,
  viewStart,
  viewEnd,
  padT,
  priceBottom,
}: MarkerParams): void {
  // 三角形＋ラベル全体が占める縦幅。これを使って価格ペイン内にクランプする。
  const markerSpan = TRI_HEIGHT + LABEL_GAP + LABEL_H;
  ctx.save();
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  for (let i = viewStart; i < viewEnd; i++) {
    const matches = matchesByBar.get(i);
    if (!matches || matches.length === 0) continue;
    matches.forEach((m, k) => {
      const bar = bars[m.idx];
      if (!bar) return;
      const x = xScale(m.idx);
      const color = SIGNAL_COLOR[m.signal];
      const pointsDown = m.signal === 'bearish';
      const offset = k * MARKER_STACK;

      ctx.fillStyle = color;
      if (pointsDown) {
        // バー高値の上に下向き三角形（ペイン上端をはみ出さないようクランプ）
        const apexY = Math.max(yScale(bar.h) - MARKER_GAP - offset, padT + markerSpan);
        drawTriangle(ctx, x, apexY, false);
        ctx.textBaseline = 'bottom';
        ctx.fillText(m.label, x, apexY - TRI_HEIGHT - LABEL_GAP);
      } else {
        // バー安値の下に上向き三角形（ペイン下端をはみ出さないようクランプ）
        const apexY = Math.min(yScale(bar.l) + MARKER_GAP + offset, priceBottom - markerSpan);
        drawTriangle(ctx, x, apexY, true);
        ctx.textBaseline = 'top';
        ctx.fillText(m.label, x, apexY + TRI_HEIGHT + LABEL_GAP);
      }
    });
  }
  ctx.restore();
}

// apexY を頂点として、pointsUp=true なら上向き（頂点が上）、false なら下向きの三角形を塗る。
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  apexY: number,
  pointsUp: boolean,
): void {
  const baseY = pointsUp ? apexY + TRI_HEIGHT : apexY - TRI_HEIGHT;
  ctx.beginPath();
  ctx.moveTo(x, apexY);
  ctx.lineTo(x - TRI_HALF, baseY);
  ctx.lineTo(x + TRI_HALF, baseY);
  ctx.closePath();
  ctx.fill();
}
