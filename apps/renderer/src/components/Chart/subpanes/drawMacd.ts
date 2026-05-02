import { COLORS } from '../../../lib/colors';
import type { MACDParams, MACDResult } from '../../../types';
import { drawLine } from './drawUtils';
import type { SubPaneContext } from './types';

export function drawMacd(pane: SubPaneContext, macd: MACDResult, params: MACDParams): void {
  const { ctx, padL, priceW, viewStart, viewEnd, bw, xScale, y0, height } = pane;
  const { macd: macdLine, signal: signalLine, histogram } = macd;

  let min = Infinity,
    max = -Infinity;
  for (let i = viewStart; i < viewEnd; i++) {
    if (macdLine[i] != null) {
      if (macdLine[i]! > max) max = macdLine[i]!;
      if (macdLine[i]! < min) min = macdLine[i]!;
    }
    if (signalLine[i] != null) {
      if (signalLine[i]! > max) max = signalLine[i]!;
      if (signalLine[i]! < min) min = signalLine[i]!;
    }
    if (histogram[i] != null) {
      if (histogram[i]! > max) max = histogram[i]!;
      if (histogram[i]! < min) min = histogram[i]!;
    }
  }
  if (min === Infinity) return;
  if (max < 0) max = 0;
  if (min > 0) min = 0;
  const pad = (max - min) * 0.1 || 0.001;
  min -= pad;
  max += pad;

  const yScale = (v: number) => y0 + (1 - (v - min) / (max - min)) * (height - 4);
  const zeroY = yScale(0);

  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText(`MACD ${params.fast},${params.slow},${params.signal}`, padL, y0 - 6);

  ctx.strokeStyle = COLORS.gridSoft;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(padL, zeroY);
  ctx.lineTo(padL + priceW, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText('0', padL + priceW + 6, zeroY);

  const bodyW = Math.max(1, bw * 0.6);
  for (let i = viewStart; i < viewEnd; i++) {
    if (histogram[i] == null) continue;
    const h = histogram[i]!;
    const prev = i > 0 ? histogram[i - 1] : null;
    const rising = prev == null || h >= prev;
    let color: string;
    if (h >= 0) color = rising ? 'oklch(0.75 0.15 150 / 0.85)' : 'oklch(0.65 0.10 150 / 0.55)';
    else color = !rising ? 'oklch(0.65 0.15 22 / 0.85)' : 'oklch(0.65 0.10 22 / 0.55)';
    ctx.fillStyle = color;
    const x = xScale(i);
    const yTop = Math.min(yScale(h), zeroY);
    const barH = Math.max(1, Math.abs(yScale(h) - zeroY));
    ctx.fillRect(Math.round(x - bodyW / 2), Math.round(yTop), Math.round(bodyW), Math.round(barH));
  }

  drawLine(
    ctx,
    xScale,
    macdLine.map((v) => (v == null ? null : yScale(v))),
    COLORS.accent,
    1.25,
  );
  drawLine(
    ctx,
    xScale,
    signalLine.map((v) => (v == null ? null : yScale(v))),
    COLORS.amber,
    1.25,
    [3, 2],
  );
}
