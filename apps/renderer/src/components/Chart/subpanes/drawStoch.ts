import { COLORS } from '../../../lib/colors';
import type { STOCHResult } from '../../../types';
import type { SubPaneContext } from './types';
import { drawLine } from './drawUtils';

export function drawStoch(pane: SubPaneContext, stoch: STOCHResult): void {
  const { ctx, padL, priceW, xScale, y0, height } = pane;
  const yScale = (v: number) => y0 + (1 - v / 100) * (height - 4);

  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText('STOCH %K 14 %D 3', padL, y0 - 6);

  [20, 50, 80].forEach(v => {
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

  const { k, d } = stoch;
  drawLine(ctx, xScale, k.map(v => v == null ? null : yScale(v)), COLORS.accent, 1.25);
  drawLine(ctx, xScale, d.map(v => v == null ? null : yScale(v)), COLORS.amber, 1.25, [3, 2]);
}
