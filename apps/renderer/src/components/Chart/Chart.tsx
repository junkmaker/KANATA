import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchQuarterlyFin } from '../../lib/api';
import { COLORS, COMPARE_COLORS } from '../../lib/colors';
import { fmtDate, fmtPrice, fmtVol } from '../../lib/formatters';
import { BOLL, EMA, ICHI, MACD, PSAR, RSI, SMA, STOCH } from '../../lib/indicators';
import type { AppState, DrawingObject, FinBar, IndiData, OHLCBar, Ticker, YRange } from '../../types';
import { drawMacd } from './subpanes/drawMacd';
import { drawRsi } from './subpanes/drawRsi';
import { drawStoch } from './subpanes/drawStoch';
import { drawLine } from './subpanes/drawUtils';
import { drawVolume } from './subpanes/drawVolume';

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
    const ro = new ResizeObserver((entries) => {
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

  const [finHistory, setFinHistory] = useState<FinBar[] | null>(null);
  useEffect(() => {
    if (!state.showFinancial) {
      setFinHistory(null);
      return;
    }
    let cancelled = false;
    fetchQuarterlyFin(primary)
      .then((bars) => {
        if (!cancelled) setFinHistory(bars.length > 0 ? bars : null);
      })
      .catch(() => {
        if (!cancelled) setFinHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primary, state.showFinancial]);

  const PAD_L = 12,
    PAD_R = 72,
    PAD_T = 12;
  const VOL_H = state.showVolume ? 64 : 0;
  const STOCH_H = state.indicators.stoch ? 72 : 0;
  const MACD_H = state.indicators.macd ? 72 : 0;
  const RSI_H = state.indicators.rsi ? 72 : 0;
  const FIN_H = state.showFinancial ? 96 : 0;
  const X_AXIS_H = 22;
  const gapsToLastPane =
    FIN_H > 0 ? 76 : RSI_H > 0 ? 58 : MACD_H > 0 ? 40 : STOCH_H > 0 ? 22 : VOL_H > 0 ? 4 : 0;
  const priceH = Math.max(
    120,
    size.h - VOL_H - STOCH_H - MACD_H - RSI_H - FIN_H - X_AXIS_H - PAD_T - gapsToLastPane,
  );
  const priceW = size.w - PAD_L - PAD_R;

  const volY0 = PAD_T + priceH + 4;
  const stochY0 = volY0 + VOL_H + 18;
  const macdY0 = stochY0 + STOCH_H + 18;
  const rsiY0 = macdY0 + MACD_H + 18;
  const finY0 = rsiY0 + RSI_H + 18;
  const lastPaneBottom =
    RSI_H > 0
      ? rsiY0 + RSI_H
      : MACD_H > 0
        ? macdY0 + MACD_H
        : STOCH_H > 0
          ? stochY0 + STOCH_H
          : VOL_H > 0
            ? volY0 + VOL_H
            : PAD_T + priceH;

  const params = state.indicatorParams;

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
    if (state.indicators.macd)
      o.macd = MACD(primaryData, params.macd.fast, params.macd.slow, params.macd.signal);
    if (state.indicators.rsi) o.rsi = RSI(primaryData, params.rsi.period);
    return o;
  }, [
    primaryData,
    state.indicators,
    params.macd.fast,
    params.macd.slow,
    params.macd.signal,
    params.rsi.period,
  ]);

  const safeEnd = primaryData ? Math.min(view.end, primaryData.length) : view.end;

  const yRange = useMemo<YRange>(() => {
    if (!primaryData) return { min: 0, max: 1 };
    const end = Math.min(view.end, primaryData.length);
    let min = Infinity,
      max = -Infinity;
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
  for (let i = view.start; i < safeEnd; i++)
    if (primaryData && primaryData[i] && primaryData[i].v > volMax) volMax = primaryData[i].v;

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
      const tk = tickers.find((t) => t.code === primary);
      ctx.fillText(fmtPrice(v, tk?.currency || '$'), PAD_L + priceW + 6, y);
    }

    const xAxisGridBottom = FIN_H > 0 ? lastPaneBottom : size.h - X_AXIS_H;
    const tickStep = Math.max(1, Math.floor(nVis / 10));
    ctx.strokeStyle = COLORS.gridSoft;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    const tf = state.timeframe;
    for (let i = view.start; i < safeEnd; i += tickStep) {
      const x = xScale(i);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, PAD_T);
      ctx.lineTo(Math.round(x) + 0.5, xAxisGridBottom);
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_L, PAD_T, priceW, priceH);
    ctx.clip();

    // Ichimoku cloud (behind candles)
    if (state.indicators.ichi && indi.ichi) {
      const { tenkan, kijun, senkouA, senkouB, chikou } = indi.ichi;
      ctx.beginPath();
      let first = true;
      for (let i = view.start; i < safeEnd; i++) {
        if (senkouA[i] == null || senkouB[i] == null) continue;
        const x = xScale(i);
        if (first) {
          ctx.moveTo(x, yScale(senkouA[i]!));
          first = false;
        } else ctx.lineTo(x, yScale(senkouA[i]!));
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
      const toY = (arr: (number | null)[]) => arr.map((v) => (v == null ? null : yScale(v)));
      drawLine(ctx, xScale, toY(tenkan), COLORS.magenta, 1.25);
      drawLine(ctx, xScale, toY(kijun), COLORS.accent, 1.25);
      drawLine(ctx, xScale, toY(chikou), COLORS.muted, 1, [4, 3]);
    }

    // Bollinger bands
    if (state.indicators.boll && indi.boll) {
      const toY = (arr: (number | null)[]) => arr.map((v) => (v == null ? null : yScale(v)));
      drawLine(ctx, xScale, toY(indi.boll.upper), 'oklch(0.75 0.07 220 / 0.85)', 1);
      drawLine(ctx, xScale, toY(indi.boll.mid), 'oklch(0.70 0.05 220 / 0.7)', 1, [3, 3]);
      drawLine(ctx, xScale, toY(indi.boll.lower), 'oklch(0.75 0.07 220 / 0.85)', 1);
    }

    // Candles
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
        ctx.fillRect(Math.round(x - bodyW / 2), Math.round(top), Math.round(bodyW), Math.round(h));
      } else {
        ctx.fillRect(Math.round(x - bodyW / 2), Math.round(top), Math.round(bodyW), Math.round(h));
      }
    }

    const toY = (arr: (number | null)[]) => arr.map((v) => (v == null ? null : yScale(v)));
    if (state.indicators.sma5 && indi.sma5)
      drawLine(ctx, xScale, toY(indi.sma5), COLORS.amber, 1.25);
    if (state.indicators.sma25 && indi.sma25)
      drawLine(ctx, xScale, toY(indi.sma25), COLORS.accent, 1.25);
    if (state.indicators.sma75 && indi.sma75)
      drawLine(ctx, xScale, toY(indi.sma75), COLORS.magenta, 1.25);
    if (state.indicators.ema20 && indi.ema20)
      drawLine(ctx, xScale, toY(indi.ema20), COLORS.lime, 1.25, [4, 2]);

    if (state.indicators.psar && indi.psar) {
      ctx.fillStyle = 'oklch(0.78 0.20 350)';
      for (let i = view.start; i < safeEnd; i++) {
        if (indi.psar[i] == null) continue;
        const x = xScale(i),
          y = yScale(indi.psar[i]!);
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
        let pmin = Infinity,
          pmax = -Infinity;
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
        pmin -= pad2;
        pmax += pad2;
        const pctY = (p: number) => PAD_T + (1 - (p - pmin) / (pmax - pmin)) * priceH;
        const ys: (number | null)[] = [];
        for (let i = 0; i < primaryData.length; i++) {
          const bi = i + off;
          if (bi < 0 || bi >= arr.length) {
            ys.push(null);
            continue;
          }
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
      drawVolume(
        {
          ctx,
          padL: PAD_L,
          priceW,
          viewStart: view.start,
          viewEnd: safeEnd,
          bw,
          xScale,
          y0: volY0,
          height: VOL_H,
        },
        primaryData,
        volMax,
      );
    }

    // Stochastics
    if (state.indicators.stoch && indi.stoch) {
      drawStoch(
        {
          ctx,
          padL: PAD_L,
          priceW,
          viewStart: view.start,
          viewEnd: safeEnd,
          bw,
          xScale,
          y0: stochY0,
          height: STOCH_H,
        },
        indi.stoch,
      );
    }

    // MACD
    if (state.indicators.macd && indi.macd) {
      drawMacd(
        {
          ctx,
          padL: PAD_L,
          priceW,
          viewStart: view.start,
          viewEnd: safeEnd,
          bw,
          xScale,
          y0: macdY0,
          height: MACD_H,
        },
        indi.macd,
        params.macd,
      );
    }

    // RSI
    if (state.indicators.rsi && indi.rsi) {
      drawRsi(
        {
          ctx,
          padL: PAD_L,
          priceW,
          viewStart: view.start,
          viewEnd: safeEnd,
          bw,
          xScale,
          y0: rsiY0,
          height: RSI_H,
        },
        indi.rsi,
        params.rsi,
      );
    }

    // Financial pane
    if (state.showFinancial) {
      const finW = priceW;
      const finY = finY0;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(PAD_L, finY + 0.5);
      ctx.lineTo(PAD_L + finW, finY + 0.5);
      ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.fillText('FUNDAMENTALS · last 20 quarters', PAD_L, finY + 8);

      const finData = finHistory;

      if (finData) {
        let rmin = Infinity,
          rmax = -Infinity;
        let pmin = Infinity,
          pmax = -Infinity;
        finData.forEach((f) => {
          if (state.financial.roe) {
            if (f.roe < rmin) rmin = f.roe;
            if (f.roe > rmax) rmax = f.roe;
          }
          if (state.financial.roic) {
            if (f.roic < rmin) rmin = f.roic;
            if (f.roic > rmax) rmax = f.roic;
          }
          if (state.financial.per) {
            if (f.per < pmin) pmin = f.per;
            if (f.per > pmax) pmax = f.per;
          }
        });
        if (rmin === Infinity) {
          rmin = 0;
          rmax = 1;
        }
        if (pmin === Infinity) {
          pmin = 0;
          pmax = 1;
        }
        const rSpan = rmax - rmin || 1;
        const pSpan = pmax - pmin || 1;
        rmin -= rSpan * 0.1;
        rmax += rSpan * 0.1;
        pmin -= pSpan * 0.1;
        pmax += pSpan * 0.1;

        const fx = (i: number) =>
          finData.length < 2 ? PAD_L + finW / 2 : PAD_L + (i / (finData.length - 1)) * finW;
        const fyL = (v: number) => finY + 8 + (1 - (v - rmin) / (rmax - rmin)) * (FIN_H - 20);
        const fyR = (v: number) => finY + 8 + (1 - (v - pmin) / (pmax - pmin)) * (FIN_H - 20);

        ctx.textAlign = 'right';
        if (state.financial.roe || state.financial.roic) {
          ctx.fillStyle = COLORS.muted;
          ctx.fillText(`${rmax.toFixed(1)}%`, PAD_L + finW + 56, finY + 14);
          ctx.fillText(`${rmin.toFixed(1)}%`, PAD_L + finW + 56, finY + FIN_H - 14);
        }
        if (state.financial.per) {
          ctx.fillStyle = COLORS.amber;
          ctx.fillText(`${pmax.toFixed(1)}×`, PAD_L + finW + 56, finY + 26);
          ctx.fillText(`${pmin.toFixed(1)}×`, PAD_L + finW + 56, finY + FIN_H - 2);
        }

        const drawFin = (ys: number[], color: string, dash?: number[]) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          if (dash) ctx.setLineDash(dash);
          else ctx.setLineDash([]);
          ctx.beginPath();
          ys.forEach((y, i) => {
            if (i === 0) ctx.moveTo(fx(i), y);
            else ctx.lineTo(fx(i), y);
          });
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ys.forEach((y, i) => {
            ctx.beginPath();
            ctx.arc(fx(i), y, i === ys.length - 1 ? 2.5 : 1.5, 0, Math.PI * 2);
            ctx.fill();
          });
        };
        if (state.financial.roe)
          drawFin(
            finData.map((f) => fyL(f.roe)),
            COLORS.lime,
          );
        if (state.financial.roic)
          drawFin(
            finData.map((f) => fyL(f.roic)),
            COLORS.teal,
          );
        if (state.financial.per)
          drawFin(
            finData.map((f) => fyR(f.per)),
            COLORS.amber,
            [4, 2],
          );
      } else {
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'center';
        ctx.fillText('No data available', PAD_L + finW / 2, finY + FIN_H / 2);
      }
    }

    // X axis labels
    const xAxisY = FIN_H > 0 ? finY0 - 9 : size.h - X_AXIS_H / 2;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    for (let i = view.start; i < safeEnd; i += tickStep) {
      ctx.fillText(fmtDate(primaryData[i].t, tf), xScale(i), xAxisY);
    }
  }, [
    size,
    primaryData,
    view,
    state,
    indi,
    tickers,
    primary,
    priceW,
    priceH,
    volY0,
    stochY0,
    macdY0,
    rsiY0,
    finY0,
    VOL_H,
    STOCH_H,
    MACD_H,
    RSI_H,
    FIN_H,
    volMax,
    params,
    finHistory,
  ]);

  // Overlay: crosshair, drawings
  const [hover, setHover] = useState<{ sx: number; sy: number } | null>(null);
  const [dragging, setDragging] = useState<{
    type: 'pan' | 'drawing' | 'move-drawing';
    startX?: number;
    startY?: number;
    startView?: typeof view;
    startIdx?: number;
    startV?: number;
    snapshot?: DrawingObject;
  } | null>(null);
  const [tempDrawing, setTempDrawing] = useState<(typeof state.drawings)[0] | null>(null);
  const [textInput, setTextInput] = useState<{
    x: number;
    y: number;
    idx: number;
    v: number;
  } | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const textInputReadyRef = useRef(false);

  useEffect(() => {
    if (!textInput) {
      textInputReadyRef.current = false;
      return;
    }
    const rafId = requestAnimationFrame(() => {
      textInputRef.current?.focus();
      textInputReadyRef.current = true;
    });
    return () => {
      cancelAnimationFrame(rafId);
      textInputReadyRef.current = false;
    };
  }, [textInput]);

  const commitTextNote = (text: string) => {
    if (text.trim() && textInput) {
      setState((s) => ({
        ...s,
        drawings: [
          ...s.drawings,
          {
            type: 'text',
            idx: textInput.idx,
            v: textInput.v,
            text: text.trim(),
            color: COLORS.accent,
            ticker: primary,
            id: Math.random(),
          },
        ],
        activeTool: 'pan',
      }));
    } else {
      setState((s) => ({ ...s, activeTool: 'pan' }));
    }
    setTextInput(null);
  };

  const screenToData = useCallback(
    (sx: number, sy: number) => {
      const idx = view.start + (sx - PAD_L) / bw;
      const v = yRange.max - ((sy - PAD_T) / priceH) * (yRange.max - yRange.min);
      return { idx, v };
    },
    [view, bw, yRange, priceH],
  );

  const dataToScreen = useCallback(
    (idx: number, v: number) => {
      return { x: xScale(idx), y: yScale(v) };
    },
    [view, bw, yRange, priceH],
  );

  const hitTest = useCallback(
    (sx: number, sy: number): number | null => {
      const TOL = 5;
      const drawings = state.drawings || [];
      for (let i = drawings.length - 1; i >= 0; i--) {
        const d = drawings[i];
        if (d.ticker && d.ticker !== primary) continue;
        if (d.type === 'hline' && d.v != null) {
          if (Math.abs(sy - yScale(d.v)) <= TOL) return d.id;
        } else if (d.type === 'vline' && d.idx != null) {
          if (Math.abs(sx - xScale(d.idx)) <= TOL) return d.id;
        } else if (d.type === 'trend' && d.i1 != null && d.v1 != null && d.i2 != null && d.v2 != null) {
          const p1 = dataToScreen(d.i1, d.v1);
          const p2 = dataToScreen(d.i2, d.v2);
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len2 = dx * dx + dy * dy;
          if (len2 < 1e-6) continue;
          const t = ((sx - p1.x) * dx + (sy - p1.y) * dy) / len2;
          if (t < 0 || t > 1) continue;
          const px = p1.x + t * dx;
          const py = p1.y + t * dy;
          const dist = Math.hypot(sx - px, sy - py);
          if (dist <= TOL) return d.id;
        } else if (d.type === 'rect' && d.i1 != null && d.v1 != null && d.i2 != null && d.v2 != null) {
          const p1 = dataToScreen(d.i1, d.v1);
          const p2 = dataToScreen(d.i2, d.v2);
          const xMin = Math.min(p1.x, p2.x);
          const xMax = Math.max(p1.x, p2.x);
          const yMin = Math.min(p1.y, p2.y);
          const yMax = Math.max(p1.y, p2.y);
          if (sx >= xMin - TOL && sx <= xMax + TOL && sy >= yMin - TOL && sy <= yMax + TOL) {
            return d.id;
          }
        } else if (d.type === 'ellipse' && d.i1 != null && d.v1 != null && d.i2 != null && d.v2 != null) {
          const p1 = dataToScreen(d.i1, d.v1);
          const p2 = dataToScreen(d.i2, d.v2);
          const cx = (p1.x + p2.x) / 2;
          const cy = (p1.y + p2.y) / 2;
          const rx = Math.abs(p2.x - p1.x) / 2;
          const ry = Math.abs(p2.y - p1.y) / 2;
          if (rx < 1 || ry < 1) continue;
          const nx = (sx - cx) / rx;
          const ny = (sy - cy) / ry;
          const norm = nx * nx + ny * ny;
          const avgR = (rx + ry) / 2;
          if (Math.abs(norm - 1) <= TOL / avgR) return d.id;
          if (norm <= 1) return d.id;
        } else if (d.type === 'text' && d.idx != null && d.v != null) {
          const p = dataToScreen(d.idx, d.v);
          const w = (d.text?.length ?? 1) * 7 + 16;
          const h = 14;
          if (sx >= p.x - 4 && sx <= p.x + w && sy >= p.y - h / 2 && sy <= p.y + h / 2) {
            return d.id;
          }
        }
      }
      return null;
    },
    [state.drawings, primary, dataToScreen, xScale, yScale],
  );

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
    const HANDLE_COLOR = '#fff';
    allDrawings.forEach((d) => {
      if (d.ticker && d.ticker !== primary) return;
      const isSelected = d.id === state.selectedDrawingId;
      ctx.strokeStyle = d.color || COLORS.accent;
      ctx.fillStyle = d.color || COLORS.accent;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      if (d.type === 'hline' && d.v != null) {
        const y = yScale(d.v);
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(PAD_L + priceW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px "JetBrains Mono", monospace';
        const tk = tickers.find((t) => t.code === primary);
        ctx.fillText(fmtPrice(d.v, tk?.currency || '$'), PAD_L + 4, y - 4);
        if (isSelected) {
          const cx = PAD_L + priceW / 2;
          ctx.fillStyle = HANDLE_COLOR;
          ctx.beginPath();
          ctx.arc(cx, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = d.color || COLORS.accent;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else if (d.type === 'vline' && d.idx != null) {
        const x = xScale(d.idx);
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(x, PAD_T);
        ctx.lineTo(x, PAD_T + priceH);
        ctx.stroke();
        ctx.setLineDash([]);
        if (isSelected) {
          const cy = PAD_T + priceH / 2;
          ctx.fillStyle = HANDLE_COLOR;
          ctx.beginPath();
          ctx.arc(x, cy, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = d.color || COLORS.accent;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else if (
        (d.type === 'trend' || d.type === 'rect' || d.type === 'ellipse') &&
        d.i1 != null &&
        d.v1 != null &&
        d.i2 != null &&
        d.v2 != null
      ) {
        const p1 = dataToScreen(d.i1, d.v1);
        const p2 = dataToScreen(d.i2, d.v2);
        if (d.type === 'trend') {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          const handleR = isSelected ? 5 : 3;
          ctx.fillStyle = isSelected ? HANDLE_COLOR : d.color || COLORS.accent;
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, handleR, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p2.x, p2.y, handleR, 0, Math.PI * 2);
          ctx.fill();
          if (isSelected) {
            ctx.strokeStyle = d.color || COLORS.accent;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(p1.x, p1.y, handleR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(p2.x, p2.y, handleR, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (d.type === 'rect') {
          const x = Math.min(p1.x, p2.x);
          const y = Math.min(p1.y, p2.y);
          const w = Math.abs(p2.x - p1.x);
          const h = Math.abs(p2.y - p1.y);
          ctx.fillStyle = (d.color || COLORS.accent).replace(')', ' / 0.12)');
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = d.color || COLORS.accent;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.strokeRect(x, y, w, h);
          if (isSelected) {
            const corners = [
              [x, y],
              [x + w, y],
              [x, y + h],
              [x + w, y + h],
            ];
            ctx.fillStyle = HANDLE_COLOR;
            ctx.lineWidth = 1.5;
            corners.forEach(([cx, cy]) => {
              ctx.fillRect(cx - 3, cy - 3, 6, 6);
              ctx.strokeStyle = d.color || COLORS.accent;
              ctx.strokeRect(cx - 3, cy - 3, 6, 6);
            });
          }
        } else if (d.type === 'ellipse') {
          const cx = (p1.x + p2.x) / 2,
            cy = (p1.y + p2.y) / 2;
          const rx = Math.abs(p2.x - p1.x) / 2,
            ry = Math.abs(p2.y - p1.y) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          if (isSelected) {
            const corners = [
              [cx - rx, cy],
              [cx + rx, cy],
              [cx, cy - ry],
              [cx, cy + ry],
            ];
            ctx.fillStyle = HANDLE_COLOR;
            ctx.lineWidth = 1.5;
            corners.forEach(([hx, hy]) => {
              ctx.fillRect(hx - 3, hy - 3, 6, 6);
              ctx.strokeStyle = d.color || COLORS.accent;
              ctx.strokeRect(hx - 3, hy - 3, 6, 6);
            });
          }
        }
      } else if (d.type === 'text' && d.idx != null && d.v != null) {
        const p = dataToScreen(d.idx, d.v);
        if (isSelected) {
          const w = (d.text?.length ?? 1) * 7 + 12;
          ctx.fillStyle = (d.color || COLORS.accent).replace(')', ' / 0.18)');
          ctx.fillRect(p.x + 2, p.y - 8, w, 16);
        }
        ctx.fillStyle = d.color || COLORS.accent;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text || '…', p.x + 6, p.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, isSelected ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    if (hover && hover.sx >= PAD_L && hover.sx <= PAD_L + priceW) {
      ctx.strokeStyle = COLORS.muted;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(hover.sx) + 0.5, PAD_T);
      ctx.lineTo(Math.round(hover.sx) + 0.5, FIN_H > 0 ? lastPaneBottom : size.h - X_AXIS_H);
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
        const tk = tickers.find((t) => t.code === primary);
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(fmtPrice(v, tk?.currency || '$'), PAD_L + priceW + 6, hover.sy);
      }

      const idx = Math.round(view.start + (hover.sx - PAD_L) / bw);
      if (idx >= view.start && idx < view.end && primaryData?.[idx]) {
        const xAxisY = FIN_H > 0 ? finY0 - 9 : size.h - X_AXIS_H / 2;
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
  }, [
    hover,
    state.drawings,
    state.selectedDrawingId,
    tempDrawing,
    yRange,
    view,
    primary,
    size,
    priceH,
    priceW,
    dataToScreen,
  ]);

  // Pointer handlers
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { idx, v } = screenToData(sx, sy);
    const tool = state.activeTool;
    if (tool === 'pan' || !tool) {
      const hitId = hitTest(sx, sy);
      if (hitId != null) {
        const d = state.drawings.find((x) => x.id === hitId);
        if (d) {
          setState((s) => ({ ...s, selectedDrawingId: hitId }));
          setDragging({
            type: 'move-drawing',
            startX: sx,
            startY: sy,
            startIdx: idx,
            startV: v,
            snapshot: d,
          });
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
      if (state.selectedDrawingId != null) {
        setState((s) => ({ ...s, selectedDrawingId: null }));
      }
      setDragging({ type: 'pan', startX: sx, startView: { ...view } });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (tool === 'hline') {
      setState((s) => ({
        ...s,
        drawings: [
          ...s.drawings,
          {
            type: 'hline',
            v,
            color: COLORS.amber,
            ticker: primary,
            id: Math.random(),
          },
        ],
        activeTool: 'pan',
      }));
    } else if (tool === 'vline') {
      setState((s) => ({
        ...s,
        drawings: [
          ...s.drawings,
          {
            type: 'vline',
            idx,
            color: COLORS.amber,
            ticker: primary,
            id: Math.random(),
          },
        ],
        activeTool: 'pan',
      }));
    } else if (tool === 'trend' || tool === 'rect' || tool === 'ellipse') {
      setTempDrawing({
        type: tool as (typeof state.drawings)[0]['type'],
        i1: idx,
        v1: v,
        i2: idx,
        v2: v,
        color: COLORS.accent,
        ticker: primary,
        id: Math.random(),
      });
      setDragging({ type: 'drawing' });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (tool === 'text') {
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setTextInput({ x: sx, y: sy, idx, v });
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
      if (ns < 0) {
        ne -= ns;
        ns = 0;
      }
      if (ne > primaryData.length) {
        const d2 = ne - primaryData.length;
        ns -= d2;
        ne -= d2;
      }
      setView({ start: ns, end: ne });
    } else if (dragging?.type === 'drawing' && tempDrawing) {
      const { idx, v } = screenToData(sx, sy);
      setTempDrawing({ ...tempDrawing, i2: idx, v2: v });
    } else if (
      dragging?.type === 'move-drawing' &&
      dragging.snapshot &&
      dragging.startIdx != null &&
      dragging.startV != null
    ) {
      const { idx, v } = screenToData(sx, sy);
      const dIdx = idx - dragging.startIdx;
      const dV = v - dragging.startV;
      const snap = dragging.snapshot;
      setState((s) => ({
        ...s,
        drawings: s.drawings.map((d) => {
          if (d.id !== snap.id) return d;
          if (d.type === 'hline' && snap.v != null) {
            return { ...d, v: snap.v + dV };
          }
          if (d.type === 'vline' && snap.idx != null) {
            return { ...d, idx: snap.idx + dIdx };
          }
          if (
            (d.type === 'trend' || d.type === 'rect' || d.type === 'ellipse') &&
            snap.i1 != null &&
            snap.v1 != null &&
            snap.i2 != null &&
            snap.v2 != null
          ) {
            return {
              ...d,
              i1: snap.i1 + dIdx,
              v1: snap.v1 + dV,
              i2: snap.i2 + dIdx,
              v2: snap.v2 + dV,
            };
          }
          if (d.type === 'text' && snap.idx != null && snap.v != null) {
            return { ...d, idx: snap.idx + dIdx, v: snap.v + dV };
          }
          return d;
        }),
      }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragging?.type === 'drawing' && tempDrawing) {
      setState((s) => ({
        ...s,
        drawings: [...s.drawings, tempDrawing],
        activeTool: 'pan',
      }));
      setTempDrawing(null);
    } else if (dragging?.type === 'move-drawing') {
      // Move complete — drawings already mutated incrementally during pointer move.
    }
    setDragging(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
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
      const newLen = Math.max(30, Math.min(pd.length, Math.round(len * scale)));
      const center = v.start + centerFrac * len;
      let ns = Math.round(center - centerFrac * newLen);
      let ne = ns + newLen;
      if (ns < 0) {
        ne -= ns;
        ns = 0;
      }
      if (ne > pd.length) {
        const d2 = ne - pd.length;
        ns -= d2;
        ne -= d2;
      }
      setView({ start: ns, end: ne });
    };
    cvs.addEventListener('wheel', handler, { passive: false });
    return () => cvs.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    if (state.activeTool !== 'pan') {
      setState((s) => ({ ...s, selectedDrawingId: null }));
    }
  }, [state.activeTool, setState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (textInput) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return;
      setState((s) => {
        if (s.selectedDrawingId == null) return s;
        return {
          ...s,
          drawings: s.drawings.filter((d) => d.id !== s.selectedDrawingId),
          selectedDrawingId: null,
        };
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [textInput, setState]);

  const hoverIdx = hover ? Math.round(view.start + (hover.sx - PAD_L) / bw) : safeEnd - 1;
  const hoverBar = primaryData && primaryData[hoverIdx];

  return (
    <div
      ref={wrapRef}
      className="chart-wrap"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        cursor:
          state.activeTool && state.activeTool !== 'pan'
            ? 'crosshair'
            : dragging?.type === 'pan'
              ? 'grabbing'
              : 'crosshair',
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
      {textInput && (
        <input
          ref={textInputRef}
          type="text"
          defaultValue=""
          placeholder="テキストを入力..."
          style={{
            position: 'absolute',
            left: textInput.x,
            top: textInput.y - 12,
            zIndex: 10,
            background: 'rgba(0,0,0,0.85)',
            color: COLORS.accent,
            border: `1px solid ${COLORS.accent}`,
            borderRadius: 3,
            padding: '2px 6px',
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
            outline: 'none',
            minWidth: 120,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitTextNote(e.currentTarget.value);
            } else if (e.key === 'Escape') {
              setState((s) => ({ ...s, activeTool: 'pan' }));
              setTextInput(null);
            }
          }}
          onBlur={(e) => {
            if (!textInputReadyRef.current) return;
            commitTextNote(e.currentTarget.value);
          }}
        />
      )}
      <ChartLegend
        state={state}
        hoverBar={hoverBar}
        tickers={tickers}
        primary={primary}
        data={data}
        hoverIdx={hoverIdx}
        yRange={yRange}
        indi={indi}
      />
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
  indi: IndiData;
}

function ChartLegend({
  state,
  hoverBar,
  tickers,
  primary,
  data,
  hoverIdx,
  indi,
}: ChartLegendProps) {
  const tk = tickers.find((t) => t.code === primary);
  if (!tk || !hoverBar) return null;
  const last = hoverBar;
  const prev = data[primary][Math.max(0, hoverIdx - 1)];
  const chg = last.c - prev.c;
  const chgPct = (chg / prev.c) * 100;
  const up = chg >= 0;

  const indRows: {
    label: string;
    v: number | null | undefined;
    c: string;
    extra?: string;
    fmt?: (v: number) => string;
  }[] = [];
  const i = hoverIdx;
  if (state.indicators.sma5)
    indRows.push({
      label: 'MA5',
      v: SMA(data[primary], 5)[i],
      c: 'var(--amber)',
    });
  if (state.indicators.sma25)
    indRows.push({
      label: 'MA25',
      v: SMA(data[primary], 25)[i],
      c: 'var(--accent)',
    });
  if (state.indicators.sma75)
    indRows.push({
      label: 'MA75',
      v: SMA(data[primary], 75)[i],
      c: 'var(--magenta)',
    });
  if (state.indicators.ema20)
    indRows.push({
      label: 'EMA20',
      v: EMA(data[primary], 20)[i],
      c: 'var(--lime)',
    });
  if (state.indicators.boll) {
    const b = BOLL(data[primary], 20, 2);
    indRows.push({
      label: 'BB',
      v: b.mid[i],
      extra: ` · U ${fmtPrice(b.upper[i], tk.currency)} · L ${fmtPrice(b.lower[i], tk.currency)}`,
      c: 'oklch(0.75 0.07 220)',
    });
  }
  if (state.indicators.macd && indi.macd) {
    const m = indi.macd.macd[i];
    const s = indi.macd.signal[i];
    const p = state.indicatorParams.macd;
    indRows.push({
      label: `MACD ${p.fast},${p.slow},${p.signal}`,
      v: m,
      c: 'var(--accent)',
      extra: s != null ? ` · S ${s.toFixed(3)}` : '',
      fmt: (v) => v.toFixed(3),
    });
  }
  if (state.indicators.rsi && indi.rsi) {
    const p = state.indicatorParams.rsi;
    indRows.push({
      label: `RSI ${p.period}`,
      v: indi.rsi[i],
      c: 'var(--lime)',
      fmt: (v) => v.toFixed(1),
    });
  }

  return (
    <div className="chart-legend">
      <div className="legend-symbol">
        <span className="sym-code">{tk.code}</span>
        <span className="sym-name">{tk.name}</span>
        <span className="sym-mkt">{tk.market}</span>
      </div>
      <div className="legend-ohlc">
        <span>O</span>
        <b>{fmtPrice(last.o, tk.currency)}</b>
        <span>H</span>
        <b>{fmtPrice(last.h, tk.currency)}</b>
        <span>L</span>
        <b>{fmtPrice(last.l, tk.currency)}</b>
        <span>C</span>
        <b style={{ color: up ? 'var(--bull)' : 'var(--bear)' }}>{fmtPrice(last.c, tk.currency)}</b>
        <span style={{ color: up ? 'var(--bull)' : 'var(--bear)' }}>
          {up ? '+' : ''}
          {chg.toFixed(2)} ({up ? '+' : ''}
          {chgPct.toFixed(2)}%)
        </span>
        <span>V</span>
        <b>{fmtVol(last.v)}</b>
      </div>
      {indRows.length > 0 && (
        <div className="legend-ind">
          {indRows.map((r, k) => (
            <span key={k} className="ind-pill">
              <i style={{ background: r.c }} />
              {r.label} {r.v != null ? (r.fmt ? r.fmt(r.v) : fmtPrice(r.v, tk.currency)) : '—'}
              {r.extra || ''}
            </span>
          ))}
        </div>
      )}
      {state.selected.length > 1 && (
        <div className="legend-ind">
          {state.selected.slice(1).map((code, idx) => {
            const tk2 = tickers.find((t) => t.code === code);
            if (!tk2) return null;
            return (
              <span key={code} className="ind-pill">
                <i
                  style={{
                    background: COMPARE_COLORS[(idx + 1) % COMPARE_COLORS.length],
                  }}
                />
                {tk2.code}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
