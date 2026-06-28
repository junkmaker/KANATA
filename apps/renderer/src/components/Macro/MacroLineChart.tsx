import { useEffect, useRef } from 'react';
import type { MacroSeriesPoint } from '../../types';

interface ThresholdLine {
  value: number;
  color?: string;
  dashed?: boolean;
}

type Props = {
  series: MacroSeriesPoint[];
  color?: string;
  thresholdLines?: ThresholdLine[];
  lowLine?: number | null;
  height?: number;
};

const PAD = { top: 8, right: 8, bottom: 8, left: 8 };

export function MacroLineChart({ series, color, thresholdLines, lowLine, height = 96 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas cannot consume `var(--x)` tokens; resolve them to concrete colors.
    const computed = getComputedStyle(canvas);
    const resolve = (token: string): string => {
      const match = token.match(/^var\((--[\w-]+)\)$/);
      return match ? computed.getPropertyValue(match[1]).trim() || '#888' : token;
    };

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 240;
    const cssH = height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (series.length < 2) return;

    const values = series.map((p) => p.value);
    const extraVals = [
      ...(thresholdLines?.map((t) => t.value) ?? []),
      ...(lowLine != null ? [lowLine] : []),
    ];
    let min = Math.min(...values, ...extraVals);
    let max = Math.max(...values, ...extraVals);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;

    const plotW = cssW - PAD.left - PAD.right;
    const plotH = cssH - PAD.top - PAD.bottom;
    const xAt = (i: number) => PAD.left + (i / (series.length - 1)) * plotW;
    const yAt = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * plotH;

    const stroke = (val: number, lineColor: string, dashed: boolean) => {
      ctx.save();
      ctx.strokeStyle = resolve(lineColor);
      ctx.lineWidth = 1;
      if (dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, yAt(val));
      ctx.lineTo(cssW - PAD.right, yAt(val));
      ctx.stroke();
      ctx.restore();
    };

    for (const t of thresholdLines ?? []) {
      stroke(t.value, t.color ?? 'var(--bear)', t.dashed ?? true);
    }
    if (lowLine != null) {
      stroke(lowLine, 'var(--muted)', true);
    }

    ctx.strokeStyle = resolve(color ?? 'var(--accent)');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [series, color, thresholdLines, lowLine, height]);

  return <canvas ref={canvasRef} className="macro-linechart" style={{ height }} />;
}
