import { COLORS } from '../../../lib/colors';
import type { OHLCBar } from '../../../types';
import type { SubPaneContext } from './types';

export function drawVolume(pane: SubPaneContext, bars: OHLCBar[], volMax: number): void {
  const { ctx, padL, priceW, viewStart, viewEnd, bw, xScale, y0, height } = pane;
  ctx.strokeStyle = COLORS.grid;
  ctx.beginPath();
  ctx.moveTo(padL, y0 + 0.5);
  ctx.lineTo(padL + priceW, y0 + 0.5);
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText('VOL', padL, y0 + 10);
  for (let i = viewStart; i < viewEnd; i++) {
    const b = bars[i];
    if (!b) continue;
    const up = b.c >= b.o;
    ctx.fillStyle = up ? 'oklch(0.86 0.12 150 / 0.70)' : 'oklch(0.82 0.14 22 / 0.70)';
    const x = xScale(i);
    const bodyW = Math.max(1, bw * 0.72);
    const hh = (b.v / volMax) * height;
    ctx.fillRect(
      Math.round(x - bodyW / 2),
      Math.round(y0 + height - hh + 4),
      Math.round(bodyW),
      Math.round(hh),
    );
  }
}
