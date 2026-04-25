import { COLORS } from '../../../lib/colors';
import type { RSIParams } from '../../../types';
import type { SubPaneContext } from './types';
import { drawLine } from './drawUtils';

export function drawRsi(pane: SubPaneContext, rsi: (number | null)[], params: RSIParams): void {
  const { ctx, padL, priceW, xScale, y0, height } = pane;
  const yScale = (v: number) => y0 + (1 - v / 100) * (height - 4);

  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText(`RSI ${params.period}`, padL, y0 - 6);

  const obY = yScale(params.overbought);
  const osY = yScale(params.oversold);
  ctx.fillStyle = 'oklch(0.65 0.12 150 / 0.07)';
  ctx.fillRect(padL, obY, priceW, Math.max(0, yScale(100) - obY));
  ctx.fillStyle = 'oklch(0.65 0.12 22 / 0.07)';
  ctx.fillRect(padL, osY, priceW, Math.max(0, y0 + height - 4 - osY));

  [params.overbought, 50, params.oversold].forEach(v => {
    const y = yScale(v);
    ctx.strokeStyle = COLORS.gridSoft;
    ctx.setLineDash(v === 50 ? [2, 3] : []);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + priceW, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'left';
    ctx.fillText(String(v), padL + priceW + 6, y);
  });
  ctx.setLineDash([]);

  drawLine(ctx, xScale, rsi.map(v => v == null ? null : yScale(v)), COLORS.lime, 1.25);
}
