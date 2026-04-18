import type { OHLCBar } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function fetchQuotes(symbol: string, timeframe: string): Promise<OHLCBar[]> {
  const res = await fetch(`${BASE_URL}/api/quotes/${symbol}?timeframe=${timeframe}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
