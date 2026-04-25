import type { OHLCBar } from '../types';
import { getBackendUrl } from './backendUrl';

export async function fetchQuotes(symbol: string, timeframe: string): Promise<OHLCBar[]> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/quotes/${symbol}?timeframe=${timeframe}`, {
    signal: AbortSignal.timeout(10_000),
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
