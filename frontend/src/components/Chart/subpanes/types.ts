export interface SubPaneContext {
  ctx: CanvasRenderingContext2D;
  padL: number;
  priceW: number;
  viewStart: number;
  viewEnd: number;
  bw: number;
  xScale: (i: number) => number;
  y0: number;
  height: number;
}
