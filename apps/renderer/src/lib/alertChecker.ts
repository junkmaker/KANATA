import type { AlertObject, DrawingObject, OHLCBar } from '../types';

function trendlineValueAt(d: DrawingObject, idx: number): number | null {
  if (d.i1 == null || d.v1 == null || d.i2 == null || d.v2 == null) return null;
  if (d.i1 === d.i2) return d.v1;
  return d.v1 + ((d.v2 - d.v1) * (idx - d.i1)) / (d.i2 - d.i1);
}

export function checkAlertCondition(
  alert: AlertObject,
  drawings: DrawingObject[],
  data: Record<string, OHLCBar[]>,
): boolean {
  const drawing = drawings.find((d) => d.id === alert.drawingId);
  if (!drawing) return false;

  const bars = data[alert.symbol];
  if (!bars || bars.length === 0) return false;

  const close = bars[bars.length - 1].c;

  if (drawing.type === 'hline') {
    if (drawing.v == null) return false;
    return alert.direction === 'below' ? close < drawing.v : close > drawing.v;
  }

  if (drawing.type === 'trend') {
    const lineVal = trendlineValueAt(drawing, bars.length - 1);
    if (lineVal == null) return false;
    return alert.direction === 'below' ? close < lineVal : close > lineVal;
  }

  return false;
}
