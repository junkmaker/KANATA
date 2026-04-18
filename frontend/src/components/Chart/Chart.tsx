import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { AppState, Ticker, OHLCBar, IndiData, YRange } from '../../types';
import { COLORS, COMPARE_COLORS } from '../../lib/colors';
import { fmtPrice, fmtVol, fmtDate } from '../../lib/formatters';
import { SMA, EMA, BOLL, STOCH, PSAR, ICHI } from '../../lib/indicators';
import { FIN_TS } from '../../lib/data';

interface ChartProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  tickers: Ticker[];
  data: Record<string, OHLCBar[]>;
}

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const cr = e.contentRect;
        setSize({ w: cr.width, h: cr.height });
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  xs: (i: number) => number,
  ys: (number | null)[],
  color: string,
  width = 1.25,
  dash: number[] | null = null,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] == null) { started = false; continue; }
    const x = xs(i), y = ys[i]!;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export function Chart({ state, setState, tickers, data }: ChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const size = useSize(wrapRef);

  const primary = state.selected[0];
  const primaryData = data[primary];

  const [view, setView] = useState({ start: 1200, end: 1500 });
  useEffect(() => {
    if (!primaryData) return;
    const end = primaryData.length;
    const start = Math.max(0, end - 220);
    setView({ start, end });
  }, [primary, primaryData?.length]);

  const PAD_L = 12, PAD_R = 72, PAD_T = 12;
  const VOL_H = state.showVolume ? 64 : 0;
  const STOCH_H = state.indicators.stoch ? 72 : 0;
  const FIN_H = state.showFinancial ? 96 : 0;
  const X_AXIS_H = 22;
  const priceH = Math.max(120, size.h - VOL_H - STOCH_H - FIN_H - X_AXIS_H - PAD_T);
  const priceW = size.w - PAD_L - PAD_R;

  const indi = useMemo<IndiData>(() => {
    if (!primaryData) return {};
    const o: IndiData = {};
    if (state.indicators.sma5) o.sma5 = SMA(primaryData, 5);
    if (state.indicators.sma25) o.sma25 = SMA(primaryData, 25);
    if (state.indicators.sma75) o.sma75 = SMA(primaryData, 75);
    if (state.indicators.ema20) o.ema20 = EMA(primaryData, 20);
    if (state.indicators.boll) o.boll = BOLL(primaryData, 20, 2);
    if (state.indicators.stoch) o.stoch = STOCH(primaryData, 14, 3, 3);
    if (state.indicators.psar) o.psar = PSAR(primaryData);
    if (state.indicators.ichi) o.ichi = ICHI(primaryData);
    return o;
  }, [primaryData, state.indicators]);

  const safeEnd = primaryData ? Math.min(view.end, primaryData.length) : view.end;

  const yRange = useMemo<YRange>(() => {
    if (!primaryData) return { min: 0, max: 1 };
    const end = Math.min(view.end, primaryData.length);
    let min = Infinity, max = -Infinity;
    for (let i = view.start; i < end; i++) {
      const b = primaryData[i];
      if (!b) continue;
      if (b.h > max) max = b.h;
      if (b.l < min) min = b.l;
    }
    if (min === Infinity) return { min: 0, max: 1 };
    if (state.indicators.boll && indi.boll) {
      for (let i = view.start; i < end; i++) {
        if (indi.boll.upper[i] != null && indi.boll.upper[i]! > max) max = indi.boll.upper[i]!;
        if (indi.boll.lower[i] != null && indi.boll.lower[i]! < min) min = indi.boll.lower[i]!;
      }
    }
    const pad = (max - min) * 0.08;
    return { min: min - pad, max: max + pad };
  }, [primaryData, view, state.indicators.boll, indi]);

  const nVis = safeEnd - view.start;
  const bw = priceW / nVis;
  const xScale = (i: number) => PAD_L + (i - view.start) * bw + bw / 2;
  const yScale = (v: number) => {
    const t = (v - yRange.min) / (yRange.max - yRange.min);
    return PAD_T + (1 - t) * priceH;
  };

  let volMax = 1;
  for (let i = view.start; i < safeEnd; i++) if (primaryData && primaryData[i] && primaryData[i].v > volMax) volMax = primaryData[i].v;
  const volY0 = PAD_T + priceH + 4;
  const stochY0 = volY0 + VOL_H + 18;
  const stochYScale = (v: number) => stochY0 + (1 - v / 100) * (STOCH_H - 4);
  const finY0 = stochY0 + STOCH_H + 18;

  // Main canvas draw
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !primaryData || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = size.w * dpr;
    cvs.height = size.h * dpr;
    cvs.style.width = size.w + 'px';
    cvs.style.height = size.h + 'px';
    const ctx = cvs.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.muted;
    const nLines = 6;
    for (let i = 0; i <= nLines; i++) {
      const y = PAD_T + (priceH / nLines) * i;
      ctx.strokeStyle = i === 0 || i === nLines ? COLORS.grid : COLORS.gridSoft;
      ctx.beginPath();
      ctx.moveTo(PAD_L, Math.round(y) + 0.5);
      ctx.lineTo(PAD_L + priceW, Math.round(y) + 0.5);
      ctx.stroke();
      const v = yRange.max - (yRange.max - yRange.min) * (i / nLines);
      ctx.textAlign = 'left';
      const tk = tickers.find(t => t.code === primary);
      ctx.fillText(fmtPrice(v, tk?.currency || '$'), PAD_L + priceW + 6, y);
    }

    const tickStep = Math.max(1, Math.floor(nVis / 10));
    ctx.strokeStyle = COLORS.gridSoft;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    const tf = state.timeframe;
    for (let i = view.start; i < safeEnd; i += tickStep) {
      const x = xScale(i);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, PAD_T);
      ctx.lineTo(Math.round(x) + 0.5, PAD_T + priceH + VOL_H + STOCH_H + (state.showVolume ? 4 : 0) + (state.indicators.stoch ? 18 : 0));
      ctx.stroke();
    }

    // Ichimoku cloud (behind candles)
    if (state.indicators.ichi && indi.ichi) {
      const { tenkan, kijun, senkouA, senkouB, chikou } = indi.ichi;
      ctx.beginPath();
      let first = true;
      for (let i = view.start; i < safeEnd; i++) {
        if (senkouA[i] == null || senkouB[i] == null) continue;
        const x = xScale(i);
        if (first) { ctx.moveTo(x, yScale(senkouA[i]!)); first = false; }
        else ctx.lineTo(x, yScale(senkouA[i]!));
      }
      for (let i = safeEnd - 1; i >= view.start; i--) {
        if (senkouA[i] == null || senkouB[i] == null) continue;
        ctx.lineTo(xScale(i), yScale(senkouB[i]!));
      }
      ctx.closePath();
      const midI = Math.floor((view.start + safeEnd) / 2);
      const green = (senkouA[midI] ?? 0) >= (senkouB[midI] ?? 0);
      ctx.fillStyle = green ? COLORS.cloudGreen : COLORS.cloudRed;
      ctx.fill();
      drawLine(ctx, xScale, tenkan, COLORS.magenta, 1.25);
      drawLine(ctx, xScale, kijun, COLORS.accent, 1.25);
      drawLine(ctx, xScale, chikou, COLORS.muted, 1, [4, 3]);
    }

    // Bollinger bands
    if (state.indicators.boll && indi.boll) {
      drawLine(ctx, xScale, indi.boll.upper, 'oklch(0.75 0.07 220 / 0.85)', 1);
      drawLine(ctx, xScale, indi.boll.mid, 'oklch(0.70 0.05 220 / 0.7)', 1, [3, 3]);
      drawLine(ctx, xScale, indi.boll.lower, 'oklch(0.75 0.07 220 / 0.85)', 1);
    }

    // Candles
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_L, PAD_T, priceW, priceH);
    ctx.clip();
    for (let i = view.start; i < safeEnd; i++) {
      const b = primaryData[i];
      const x = xScale(i);
      const up = b.c >= b.o;
      ctx.strokeStyle = up ? COLORS.bull : COLORS.bear;
      ctx.fillStyle = up ? COLORS.bull : COLORS.bear;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yScale(b.h));
      ctx.lineTo(Math.round(x) + 0.5, yScale(b.l));
      ctx.stroke();
      const yo = yScale(b.o);
      const yc = yScale(b.c);
      const top = Math.min(yo, yc);
      const h = Math.max(1, Math.abs(yc - yo));
      const bodyW = Math.max(1, bw * 0.72);
      if (up) {
        ctx.fillStyle = 'oklch(0.82 0.13 150 / 0.30)';
        ctx.fillRect(Math.round(x - bodyW / 2), Math.round(top), Math.round(bodyW), Math.round(h));
        ctx.strokeStyle = COLORS.bull;
        ctx.strokeRect(Math.round(x - bodyW / 2) + 0.5, Math.round(top) + 0.5, Math.round(bodyW) - 1, Math.round(h) - 1);
      } else {
        ctx.fillRect(Math.round(x - bodyW / 2), Math.round(top), Math.round(bodyW), Math.round(h));
      }
    }

    if (state.indicators.sma5 && indi.sma5) drawLine(ctx, xScale, indi.sma5, COLORS.amber, 1.25);
    if (state.indicators.sma25 && indi.sma25) drawLine(ctx, xScale, indi.sma25, COLORS.accent, 1.25);
    if (state.indicators.sma75 && indi.sma75) drawLine(ctx, xScale, indi.sma75, COLORS.magenta, 1.25);
    if (state.indicators.ema20 && indi.ema20) drawLine(ctx, xScale, indi.ema20, COLORS.lime, 1.25, [4, 2]);

    if (state.indicators.psar && indi.psar) {
      ctx.fillStyle = 'oklch(0.78 0.20 350)';
      for (let i = view.start; i < safeEnd; i++) {
        if (indi.psar[i] == null) continue;
        const x = xScale(i), y = yScale(indi.psar[i]!);
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Comparison lines
    if (state.selected.length > 1 && state.compareMode === 'percent') {
      for (let idx = 1; idx < state.selected.length; idx++) {
        const code = state.selected[idx];
        const arr = data[code];
        if (!arr) continue;
        const color = COMPARE_COLORS[idx % COMPARE_COLORS.length];
        const off = arr.length - primaryData.length;
        const basePrice = arr[Math.max(0, view.start + off)]?.c;
        if (!basePrice) continue;
        let pmin = Infinity, pmax = -Infinity;
        for (let i = view.start; i < safeEnd; i++) {
          const bi = i + off;
          if (bi < 0 || bi >= arr.length) continue;
          const pct = (arr[bi].c / basePrice - 1) * 100;
          if (pct < pmin) pmin = pct;
          if (pct > pmax) pmax = pct;
        }
        const primBase = primaryData[view.start].c;
        for (let i = view.start; i < safeEnd; i++) {
          const pct = (primaryData[i].c / primBase - 1) * 100;
          if (pct < pmin) pmin = pct;
          if (pct > pmax) pmax = pct;
        }
        const pad2 = (pmax - pmin) * 0.1 || 1;
        pmin -= pad2; pmax += pad2;
        const pctY = (p: number) => PAD_T + (1 - (p - pmin) / (pmax - pmin)) * priceH;
        const ys: (number | null)[] = [];
        for (let i = 0; i < primaryData.length; i++) {
          const bi = i + off;
          if (bi < 0 || bi >= arr.length) { ys.push(null); continue; }
          ys.push(pctY((arr[bi].c / basePrice - 1) * 100));
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(PAD_L, PAD_T, priceW, priceH);
        ctx.clip();
        drawLine(ctx, xScale, ys, color, 1.5);
        ctx.restore();
      }
    }

    // Volume
    if (state.showVolume) {
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.fillText('VOL', PAD_L, volY0 + 10);
      for (let i = view.start; i < safeEnd; i++) {
        const b = primaryData[i];
        const up = b.c >= b.o;
        ctx.fillStyle = up ? 'oklch(0.86 0.12 150 / 0.70)' : 'oklch(0.82 0.14 22 / 0.70)';
        const x = xScale(i);
        const bodyW = Math.max(1, bw * 0.72);
        const hh = (b.v / volMax) * VOL_H;
        ctx.fillRect(Math.round(x - bodyW / 2), Math.round(volY0 + VOL_H - hh + 4), Math.round(bodyW), Math.round(hh));
      }
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(PAD_L, volY0 + 0.5);
      ctx.lineTo(PAD_L + priceW, volY0 + 0.5);
      ctx.stroke();
    }

    // Stochastics
    if (state.indicators.stoch && indi.stoch) {
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.fillText('STOCH %K 14 %D 3', PAD_L, stochY0 - 6);
      [20, 50, 80].forEach(v => {
        const y = stochYScale(v);
        ctx.strokeStyle = COLORS.gridSoft;
        ctx.setLineDash(v === 50 ? [2, 3] : []);
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(PAD_L + priceW, y);
        ctx.stroke();
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'left';
        ctx.fillText(String(v), PAD_L + priceW + 6, y);
      });
      ctx.setLineDash([]);
      const { k, d } = indi.stoch;
      drawLine(ctx, xScale, k.map(v => v == null ? null : stochYScale(v)), COLORS.accent, 1.25);
      drawLine(ctx, xScale, d.map(v => v == null ? null : stochYScale(v)), COLORS.amber, 1.25, [3, 2]);
    }

    // Financial pane
    if (state.showFinancial) {
      const finData = FIN_TS[primary];
      const finW = priceW;
      const finY = finY0;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(PAD_L, finY + 0.5);
      ctx.lineTo(PAD_L + finW, finY + 0.5);
      ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.fillText('FUNDAMENTALS · last 20 quarters', PAD_L, finY - 6);

      let rmin = Infinity, rmax = -Infinity;
      let pmin = Infinity, pmax = -Infinity;
      finData.forEach(f => {
        if (state.financial.roe) { if (f.roe < rmin) rmin = f.roe; if (f.roe > rmax) rmax = f.roe; }
        if (state.financial.roic) { if (f.roic < rmin) rmin = f.roic; if (f.roic > rmax) rmax = f.roic; }
        if (state.financial.per) { if (f.per < pmin) pmin = f.per; if (f.per > pmax) pmax = f.per; }
      });
      if (rmin === Infinity) { rmin = 0; rmax = 1; }
      if (pmin === Infinity) { pmin = 0; pmax = 1; }
      rmin -= (rmax - rmin) * 0.1; rmax += (rmax - rmin) * 0.1;
      pmin -= (pmax - pmin) * 0.1; pmax += (pmax - pmin) * 0.1;

      const fx = (i: number) => PAD_L + (i / (finData.length - 1)) * finW;
      const fyL = (v: number) => finY + 8 + (1 - (v - rmin) / (rmax - rmin)) * (FIN_H - 20);
      const fyR = (v: number) => finY + 8 + (1 - (v - pmin) / (pmax - pmin)) * (FIN_H - 20);

      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'right';
      ctx.fillText(rmax.toFixed(1) + '%', PAD_L + finW + 56, finY + 12);
      ctx.fillText(rmin.toFixed(1) + '%', PAD_L + finW + 56, finY + FIN_H - 8);

      const drawFin = (ys: number[], color: string, dash?: number[]) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
        ctx.beginPath();
        ys.forEach((y, i) => { if (i === 0) ctx.moveTo(fx(i), y); else ctx.lineTo(fx(i), y); });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(fx(finData.length - 1), ys[ys.length - 1], 2.5, 0, Math.PI * 2);
        ctx.fill();
      };
      if (state.financial.roe) drawFin(finData.map(f => fyL(f.roe)), COLORS.lime);
      if (state.financial.roic) drawFin(finData.map(f => fyL(f.roic)), COLORS.teal);
      if (state.financial.per) drawFin(finData.map(f => fyR(f.per)), COLORS.amber, [4, 2]);
    }

    // X axis labels
    const xAxisY = size.h - X_AXIS_H / 2;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    for (let i = view.start; i < safeEnd; i += tickStep) {
      ctx.fillText(fmtDate(primaryData[i].t, tf), xScale(i), xAxisY);
    }
  }, [size, primaryData, view, state, indi, tickers, primary, priceW, priceH]);

  // Overlay: crosshair, drawings
  const [hover, setHover] = useState<{ sx: number; sy: number } | null>(null);
  const [dragging, setDragging] = useState<{ type: 'pan' | 'drawing'; startX?: number; startView?: typeof view } | null>(null);
  const [tempDrawing, setTempDrawing] = useState<typeof state.drawings[0] | null>(null);

  const screenToData = useCallback((sx: number, sy: number) => {
    const idx = view.start + (sx - PAD_L) / bw;
    const v = yRange.max - ((sy - PAD_T) / priceH) * (yRange.max - yRange.min);
    return { idx, v };
  }, [view, bw, yRange, priceH]);

  const dataToScreen = useCallback((idx: number, v: number) => {
    return { x: xScale(idx), y: yScale(v) };
  }, [view, bw, yRange, priceH]);

  useEffect(() => {
    const cvs = overlayRef.current;
    if (!cvs) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = size.w * dpr;
    cvs.height = size.h * dpr;
    cvs.style.width = size.w + 'px';
    cvs.style.height = size.h + 'px';
    const ctx = cvs.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const allDrawings = [...(state.drawings || []), ...(tempDrawing ? [tempDrawing] : [])];
    allDrawings.forEach(d => {
      if (d.ticker && d.ticker !== primary) return;
      ctx.strokeStyle = d.color || COLORS.accent;
      ctx.fillStyle = d.color || COLORS.accent;
      ctx.lineWidth = 1.5;
      if (d.type === 'hline' && d.v != null) {
        const y = yScale(d.v);
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(PAD_L + priceW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px "JetBrains Mono", monospace';
        const tk = tickers.find(t => t.code === primary);
        ctx.fillText(fmtPrice(d.v, tk?.currency || '$'), PAD_L + 4, y - 4);
      } else if (d.type === 'vline' && d.idx != null) {
        const x = xScale(d.idx);
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(x, PAD_T);
        ctx.lineTo(x, PAD_T + priceH);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if ((d.type === 'trend' || d.type === 'rect' || d.type === 'ellipse') && d.i1 != null && d.v1 != null && d.i2 != null && d.v2 != null) {
        const p1 = dataToScreen(d.i1, d.v1);
        const p2 = dataToScreen(d.i2, d.v2);
        if (d.type === 'trend') {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.beginPath(); ctx.arc(p1.x, p1.y, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(p2.x, p2.y, 3, 0, Math.PI * 2); ctx.fill();
        } else if (d.type === 'rect') {
          ctx.fillStyle = (d.color || COLORS.accent).replace(')', ' / 0.12)');
          ctx.fillRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
          ctx.strokeStyle = d.color || COLORS.accent;
          ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
        } else if (d.type === 'ellipse') {
          const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
          const rx = Math.abs(p2.x - p1.x) / 2, ry = Math.abs(p2.y - p1.y) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (d.type === 'text' && d.idx != null && d.v != null) {
        const p = dataToScreen(d.idx, d.v);
        ctx.fillStyle = d.color || COLORS.accent;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text || '…', p.x + 6, p.y);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    });

    if (hover && hover.sx >= PAD_L && hover.sx <= PAD_L + priceW) {
      ctx.strokeStyle = COLORS.muted;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(hover.sx) + 0.5, PAD_T);
      ctx.lineTo(Math.round(hover.sx) + 0.5, PAD_T + priceH + VOL_H + STOCH_H + (state.showVolume ? 4 : 0) + (state.indicators.stoch ? 18 : 0));
      ctx.stroke();
      if (hover.sy >= PAD_T && hover.sy <= PAD_T + priceH) {
        ctx.beginPath();
        ctx.moveTo(PAD_L, Math.round(hover.sy) + 0.5);
        ctx.lineTo(PAD_L + priceW, Math.round(hover.sy) + 0.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (hover.sy >= PAD_T && hover.sy <= PAD_T + priceH) {
        const v = yRange.max - ((hover.sy - PAD_T) / priceH) * (yRange.max - yRange.min);
        ctx.fillStyle = COLORS.panel;
        ctx.fillRect(PAD_L + priceW, hover.sy - 9, PAD_R - 2, 18);
        ctx.strokeStyle = COLORS.accent;
        ctx.strokeRect(PAD_L + priceW + 0.5, hover.sy - 9 + 0.5, PAD_R - 3, 17);
        ctx.fillStyle = COLORS.accent;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const tk = tickers.find(t => t.code === primary);
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(fmtPrice(v, tk?.currency || '$'), PAD_L + priceW + 6, hover.sy);
      }

      const idx = Math.round(view.start + (hover.sx - PAD_L) / bw);
      if (idx >= view.start && idx < view.end && primaryData[idx]) {
        const xAxisY = size.h - X_AXIS_H / 2;
        ctx.fillStyle = COLORS.panel;
        ctx.fillRect(hover.sx - 58, xAxisY - 9, 116, 18);
        ctx.strokeStyle = COLORS.accent;
        ctx.strokeRect(hover.sx - 58 + 0.5, xAxisY - 9 + 0.5, 115, 17);
        ctx.fillStyle = COLORS.accent;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(fmtDate(primaryData[idx].t, state.timeframe), hover.sx, xAxisY);
      }
    }
  }, [hover, state.drawings, tempDrawing, yRange, view, primary, size, priceH, priceW, dataToScreen]);

  // Pointer handlers
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { idx, v } = screenToData(sx, sy);
    const tool = state.activeTool;
    if (tool === 'pan' || !tool) {
      setDragging({ type: 'pan', startX: sx, startView: { ...view } });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (tool === 'hline') {
      setState(s => ({ ...s, drawings: [...s.drawings, { type: 'hline', v, color: COLORS.amber, ticker: primary, id: Math.random() }], activeTool: 'pan' }));
    } else if (tool === 'vline') {
      setState(s => ({ ...s, drawings: [...s.drawings, { type: 'vline', idx, color: COLORS.amber, ticker: primary, id: Math.random() }], activeTool: 'pan' }));
    } else if (tool === 'trend' || tool === 'rect' || tool === 'ellipse') {
      setTempDrawing({ type: tool as typeof state.drawings[0]['type'], i1: idx, v1: v, i2: idx, v2: v, color: COLORS.accent, ticker: primary, id: Math.random() });
      setDragging({ type: 'drawing' });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (tool === 'text') {
      const txt = prompt('Annotation text:');
      if (txt) {
        setState(s => ({ ...s, drawings: [...s.drawings, { type: 'text', idx, v, text: txt, color: COLORS.accent, ticker: primary, id: Math.random() }], activeTool: 'pan' }));
      } else {
        setState(s => ({ ...s, activeTool: 'pan' }));
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setHover({ sx, sy });
    if (dragging?.type === 'pan' && dragging.startX != null && dragging.startView) {
      const dx = sx - dragging.startX;
      const shift = Math.round(-dx / bw);
      let ns = dragging.startView.start + shift;
      let ne = dragging.startView.end + shift;
      if (ns < 0) { ne -= ns; ns = 0; }
      if (ne > primaryData.length) { const d2 = ne - primaryData.length; ns -= d2; ne -= d2; }
      setView({ start: ns, end: ne });
    } else if (dragging?.type === 'drawing' && tempDrawing) {
      const { idx, v } = screenToData(sx, sy);
      setTempDrawing({ ...tempDrawing, i2: idx, v2: v });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragging?.type === 'drawing' && tempDrawing) {
      setState(s => ({ ...s, drawings: [...s.drawings, tempDrawing], activeTool: 'pan' }));
      setTempDrawing(null);
    }
    setDragging(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  // Wheel via addEventListener to avoid passive constraint
  const wheelRef = useRef({ view, bw, primaryData, priceW });
  wheelRef.current = { view, bw, primaryData, priceW };

  useEffect(() => {
    const cvs = overlayRef.current;
    if (!cvs) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { view: v, bw: b, primaryData: pd, priceW: pw } = wheelRef.current;
      const rect = cvs.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const centerFrac = (sx - PAD_L) / pw;
      const scale = e.deltaY > 0 ? 1.15 : 0.87;
      const len = v.end - v.start;
      let newLen = Math.max(30, Math.min(pd.length, Math.round(len * scale)));
      const center = v.start + centerFrac * len;
      let ns = Math.round(center - centerFrac * newLen);
      let ne = ns + newLen;
      if (ns < 0) { ne -= ns; ns = 0; }
      if (ne > pd.length) { const d2 = ne - pd.length; ns -= d2; ne -= d2; }
      setView({ start: ns, end: ne });
    };
    cvs.addEventListener('wheel', handler, { passive: false });
    return () => cvs.removeEventListener('wheel', handler);
  }, []);

  const hoverIdx = hover ? Math.round(view.start + (hover.sx - PAD_L) / bw) : (safeEnd - 1);
  const hoverBar = primaryData && primaryData[hoverIdx];

  return (
    <div
      ref={wrapRef}
      className="chart-wrap"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        cursor: state.activeTool && state.activeTool !== 'pan' ? 'crosshair' : (dragging?.type === 'pan' ? 'grabbing' : 'crosshair'),
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
      <canvas
        ref={overlayRef}
        style={{ position: 'absolute', inset: 0 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      />
      <ChartLegend state={state} hoverBar={hoverBar} tickers={tickers} primary={primary} data={data} hoverIdx={hoverIdx} yRange={yRange} />
    </div>
  );
}

interface ChartLegendProps {
  state: AppState;
  hoverBar: OHLCBar | undefined;
  tickers: Ticker[];
  primary: string;
  data: Record<string, OHLCBar[]>;
  hoverIdx: number;
  yRange: YRange;
}

function ChartLegend({ state, hoverBar, tickers, primary, data, hoverIdx }: ChartLegendProps) {
  const tk = tickers.find(t => t.code === primary);
  if (!tk || !hoverBar) return null;
  const last = hoverBar;
  const prev = data[primary][Math.max(0, hoverIdx - 1)];
  const chg = last.c - prev.c;
  const chgPct = chg / prev.c * 100;
  const up = chg >= 0;

  const indRows: { label: string; v: number | null | undefined; c: string; extra?: string }[] = [];
  const i = hoverIdx;
  if (state.indicators.sma5) indRows.push({ label: 'MA5', v: SMA(data[primary], 5)[i], c: 'var(--amber)' });
  if (state.indicators.sma25) indRows.push({ label: 'MA25', v: SMA(data[primary], 25)[i], c: 'var(--accent)' });
  if (state.indicators.sma75) indRows.push({ label: 'MA75', v: SMA(data[primary], 75)[i], c: 'var(--magenta)' });
  if (state.indicators.ema20) indRows.push({ label: 'EMA20', v: EMA(data[primary], 20)[i], c: 'var(--lime)' });
  if (state.indicators.boll) {
    const b = BOLL(data[primary], 20, 2);
    indRows.push({ label: 'BB', v: b.mid[i], extra: ` · U ${fmtPrice(b.upper[i], tk.currency)} · L ${fmtPrice(b.lower[i], tk.currency)}`, c: 'oklch(0.75 0.07 220)' });
  }

  return (
    <div className="chart-legend">
      <div className="legend-symbol">
        <span className="sym-code">{tk.code}</span>
        <span className="sym-name">{tk.name}</span>
        <span className="sym-mkt">{tk.market}</span>
      </div>
      <div className="legend-ohlc">
        <span>O</span><b>{fmtPrice(last.o, tk.currency)}</b>
        <span>H</span><b>{fmtPrice(last.h, tk.currency)}</b>
        <span>L</span><b>{fmtPrice(last.l, tk.currency)}</b>
        <span>C</span><b style={{ color: up ? 'var(--bull)' : 'var(--bear)' }}>{fmtPrice(last.c, tk.currency)}</b>
        <span style={{ color: up ? 'var(--bull)' : 'var(--bear)' }}>{up ? '+' : ''}{chg.toFixed(2)} ({up ? '+' : ''}{chgPct.toFixed(2)}%)</span>
        <span>V</span><b>{fmtVol(last.v)}</b>
      </div>
      {indRows.length > 0 && (
        <div className="legend-ind">
          {indRows.map((r, k) => (
            <span key={k} className="ind-pill">
              <i style={{ background: r.c }} />
              {r.label} {r.v != null ? fmtPrice(r.v, tk.currency) : '—'}{r.extra || ''}
            </span>
          ))}
        </div>
      )}
      {state.selected.length > 1 && (
        <div className="legend-ind">
          {state.selected.slice(1).map((code, idx) => {
            const tk2 = tickers.find(t => t.code === code);
            if (!tk2) return null;
            return (
              <span key={code} className="ind-pill">
                <i style={{ background: COMPARE_COLORS[(idx + 1) % COMPARE_COLORS.length] }} />
                {tk2.code}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
