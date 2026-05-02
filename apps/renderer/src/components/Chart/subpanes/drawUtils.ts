export function drawLine(
  ctx: CanvasRenderingContext2D,
  xs: (i: number) => number,
  ys: (number | null)[],
  color: string,
  width = 1.25,
  dash: number[] | null = null,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  else ctx.setLineDash([]);
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] == null) {
      started = false;
      continue;
    }
    const x = xs(i),
      y = ys[i]!;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}
