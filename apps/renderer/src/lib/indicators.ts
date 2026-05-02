import type { BOLLResult, ICHIResult, MACDResult, OHLCBar, STOCHResult } from '../types';

export function SMA(
  data: OHLCBar[],
  period: number,
  field: keyof OHLCBar = 'c',
): (number | null)[] {
  const out: (number | null)[] = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i][field] as number;
    if (i >= period) sum -= data[i - period][field] as number;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function EMA(
  data: OHLCBar[],
  period: number,
  field: keyof OHLCBar = 'c',
): (number | null)[] {
  const out: (number | null)[] = new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    const v = data[i][field] as number;
    if (prev == null) {
      if (i === period - 1) {
        let s = 0;
        for (let j = 0; j <= i; j++) s += data[j][field] as number;
        prev = s / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function BOLL(data: OHLCBar[], period = 20, mult = 2): BOLLResult {
  const mid = SMA(data, period);
  const upper: (number | null)[] = new Array(data.length).fill(null);
  const lower: (number | null)[] = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let s = 0;
    const m = mid[i]!;
    for (let j = i - period + 1; j <= i; j++) s += (data[j].c - m) ** 2;
    const sd = Math.sqrt(s / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

export function STOCH(data: OHLCBar[], kPeriod = 14, dPeriod = 3, slowing = 3): STOCHResult {
  const rawK: (number | null)[] = new Array(data.length).fill(null);
  for (let i = kPeriod - 1; i < data.length; i++) {
    let hh = -Infinity,
      ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (data[j].h > hh) hh = data[j].h;
      if (data[j].l < ll) ll = data[j].l;
    }
    rawK[i] = ((data[i].c - ll) / (hh - ll + 1e-9)) * 100;
  }
  const k: (number | null)[] = new Array(data.length).fill(null);
  for (let i = 0; i < data.length; i++) {
    if (i >= kPeriod - 1 + slowing - 1) {
      let s = 0,
        n = 0;
      for (let j = i - slowing + 1; j <= i; j++) {
        if (rawK[j] != null) {
          s += rawK[j]!;
          n++;
        }
      }
      if (n === slowing) k[i] = s / slowing;
    }
  }
  const d: (number | null)[] = new Array(data.length).fill(null);
  for (let i = 0; i < data.length; i++) {
    if (k[i] != null && i >= kPeriod - 1 + slowing - 1 + dPeriod - 1) {
      let s = 0;
      for (let j = i - dPeriod + 1; j <= i; j++) s += k[j]!;
      d[i] = s / dPeriod;
    }
  }
  return { k, d };
}

export function PSAR(data: OHLCBar[], step = 0.02, maxStep = 0.2): (number | null)[] {
  const out: (number | null)[] = new Array(data.length).fill(null);
  if (data.length < 2) return out;
  let uptrend = data[1].c > data[0].c;
  let af = step;
  let ep = uptrend ? data[0].h : data[0].l;
  let sar = uptrend ? data[0].l : data[0].h;
  out[0] = sar;
  for (let i = 1; i < data.length; i++) {
    sar = sar + af * (ep - sar);
    const bar = data[i];
    if (uptrend) {
      sar = Math.min(sar, data[i - 1].l, i >= 2 ? data[i - 2].l : data[i - 1].l);
      if (bar.l < sar) {
        uptrend = false;
        sar = ep;
        ep = bar.l;
        af = step;
      } else {
        if (bar.h > ep) {
          ep = bar.h;
          af = Math.min(maxStep, af + step);
        }
      }
    } else {
      sar = Math.max(sar, data[i - 1].h, i >= 2 ? data[i - 2].h : data[i - 1].h);
      if (bar.h > sar) {
        uptrend = true;
        sar = ep;
        ep = bar.h;
        af = step;
      } else {
        if (bar.l < ep) {
          ep = bar.l;
          af = Math.min(maxStep, af + step);
        }
      }
    }
    out[i] = sar;
  }
  return out;
}

function emaFromArray(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    const v = values[i]!;
    count++;
    if (count < period) continue;
    if (count === period) {
      let sum = 0,
        n = 0;
      for (let j = i; j >= 0 && n < period; j--) {
        if (values[j] != null) {
          sum += values[j]!;
          n++;
        }
      }
      prev = sum / period;
      out[i] = prev;
    } else {
      prev = v * k + prev! * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function MACD(data: OHLCBar[], fast = 12, slow = 26, signal = 9): MACDResult {
  const emaFast = EMA(data, fast);
  const emaSlow = EMA(data, slow);
  const macdLine: (number | null)[] = new Array(data.length).fill(null);
  for (let i = 0; i < data.length; i++) {
    if (emaFast[i] != null && emaSlow[i] != null) macdLine[i] = emaFast[i]! - emaSlow[i]!;
  }
  const signalLine = emaFromArray(macdLine, signal);
  const histogram: (number | null)[] = new Array(data.length).fill(null);
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] != null && signalLine[i] != null) histogram[i] = macdLine[i]! - signalLine[i]!;
  }
  return { macd: macdLine, signal: signalLine, histogram };
}

export function RSI(data: OHLCBar[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(data.length).fill(null);
  if (data.length < period + 1) return out;
  let avgGain = 0,
    avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i].c - data[i - 1].c;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].c - data[i - 1].c;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    out[i] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
  }
  return out;
}

export function ICHI(
  data: OHLCBar[],
  tenkanP = 9,
  kijunP = 26,
  senkouBP = 52,
  disp = 26,
): ICHIResult {
  const n = data.length;
  const hh = (i: number, p: number) => {
    let h = -Infinity;
    for (let j = i - p + 1; j <= i; j++) if (data[j].h > h) h = data[j].h;
    return h;
  };
  const ll = (i: number, p: number) => {
    let l = Infinity;
    for (let j = i - p + 1; j <= i; j++) if (data[j].l < l) l = data[j].l;
    return l;
  };
  const tenkan: (number | null)[] = new Array(n).fill(null);
  const kijun: (number | null)[] = new Array(n).fill(null);
  const senkouA: (number | null)[] = new Array(n + disp).fill(null);
  const senkouB: (number | null)[] = new Array(n + disp).fill(null);
  const chikou: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i >= tenkanP - 1) tenkan[i] = (hh(i, tenkanP) + ll(i, tenkanP)) / 2;
    if (i >= kijunP - 1) kijun[i] = (hh(i, kijunP) + ll(i, kijunP)) / 2;
    if (tenkan[i] != null && kijun[i] != null) senkouA[i + disp] = (tenkan[i]! + kijun[i]!) / 2;
    if (i >= senkouBP - 1) senkouB[i + disp] = (hh(i, senkouBP) + ll(i, senkouBP)) / 2;
    if (i - disp >= 0) chikou[i - disp] = data[i].c;
  }
  return { tenkan, kijun, senkouA, senkouB, chikou };
}
