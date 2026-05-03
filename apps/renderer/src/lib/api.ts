import type { FinBar, FinMetrics, OHLCBar } from '../types';
import { getBackendUrl } from './backendUrl';

export async function fetchQuotes(symbol: string, timeframe: string): Promise<OHLCBar[]> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/quotes/${symbol}?timeframe=${timeframe}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchFundamentals(symbol: string): Promise<FinMetrics> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/fundamentals/${symbol}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchQuarterlyFin(symbol: string): Promise<FinBar[]> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/fundamentals/${symbol}/quarterly`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const base = await getBackendUrl();
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
