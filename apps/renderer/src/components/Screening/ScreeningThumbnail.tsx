import { useEffect, useRef } from 'react';
import type { ScreeningClose, ScreeningPivot } from '../../types';

type Props = {
  closes: ScreeningClose[];
  pivots: ScreeningPivot[];
  width?: number;
  height?: number;
};

const PAD = { top: 6, right: 6, bottom: 6, left: 6 };

export function ScreeningThumbnail({ closes, pivots, width = 180, height = 48 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas は var(--x) を解釈できないので具体色に解決する。
    const computed = getComputedStyle(canvas);
    const resolve = (token: string): string => {
      const match = token.match(/^var\((--[\w-]+)\)$/);
      return match ? computed.getPropertyValue(match[1]).trim() || '#888' : token;
    };

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (closes.length < 2) return;

    const values = closes.map((p) => p.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.1;
    min -= pad;
    max += pad;

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const xAt = (i: number) => PAD.left + (i / (closes.length - 1)) * plotW;
    const yAt = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * plotH;

    ctx.strokeStyle = resolve('var(--accent)');
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    closes.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // pivot.index は 1年データ基準なので、日付で closes 上の位置に対応付ける。
    const posByDate = new Map(closes.map((p, i) => [p.date, i]));
    const bull = resolve('var(--bull)');
    const bear = resolve('var(--bear)');
    for (const pivot of pivots) {
      const pos = posByDate.get(pivot.date);
      if (pos === undefined) continue;
      const x = xAt(pos);
      const y = yAt(pivot.price);
      const isLow = pivot.type === 'low';
      ctx.fillStyle = isLow ? bull : bear;
      ctx.beginPath();
      // low は下向き▼、high は上向き▲
      if (isLow) {
        ctx.moveTo(x - 3, y + 1);
        ctx.lineTo(x + 3, y + 1);
        ctx.lineTo(x, y + 5);
      } else {
        ctx.moveTo(x - 3, y - 1);
        ctx.lineTo(x + 3, y - 1);
        ctx.lineTo(x, y - 5);
      }
      ctx.closePath();
      ctx.fill();
    }
  }, [closes, pivots, width, height]);

  return <canvas ref={canvasRef} className="screening-thumb" style={{ width, height }} />;
}
