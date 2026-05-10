import { COLORS } from '../../../lib/colors';
import type { SqEvent } from '../../../lib/sqEvents';

interface DrawSqMarkersParams {
  ctx: CanvasRenderingContext2D;
  xScale: (i: number) => number;
  eventsByBar: Map<number, SqEvent[]>;
  viewStart: number;
  viewEnd: number;
  padT: number;
  drawBottom: number;
}

// Draws vertical lines for each SQ/witching event in view range.
// Call this BEFORE ctx.save()/clip() so lines span all subpanes.
export function drawSqMarkerLines({
  ctx,
  xScale,
  eventsByBar,
  viewStart,
  viewEnd,
  padT,
  drawBottom,
}: DrawSqMarkersParams): void {
  ctx.setLineDash([]);
  for (let i = viewStart; i < viewEnd; i++) {
    const events = eventsByBar.get(i);
    if (!events || events.length === 0) continue;
    const hasMajor = events.some((e) => e.severity === 'major');
    const x = Math.round(xScale(i)) + 0.5;
    ctx.strokeStyle = hasMajor ? COLORS.sqMajor : COLORS.sqMinor;
    ctx.lineWidth = hasMajor ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, drawBottom);
    ctx.stroke();
  }
}

interface DrawSqLabelsParams {
  ctx: CanvasRenderingContext2D;
  xScale: (i: number) => number;
  eventsByBar: Map<number, SqEvent[]>;
  viewStart: number;
  viewEnd: number;
  labelY: number;
}

// Draws short text labels at the top of each marker line.
// Call this AFTER ctx.restore() so labels render on top of candles.
export function drawSqMarkerLabels({
  ctx,
  xScale,
  eventsByBar,
  viewStart,
  viewEnd,
  labelY,
}: DrawSqLabelsParams): void {
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = viewStart; i < viewEnd; i++) {
    const events = eventsByBar.get(i);
    if (!events || events.length === 0) continue;
    const hasMajor = events.some((e) => e.severity === 'major');
    const label = events.find((e) => e.severity === 'major')?.shortLabel ?? events[0].shortLabel;
    ctx.fillStyle = hasMajor ? COLORS.sqMajor : COLORS.sqMinor;
    ctx.fillText(label, xScale(i), labelY);
  }
}
