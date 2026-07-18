import type { MacroDashboard, MacroIndicator, MacroPeriod } from '../types';
import { fetchJson } from './backendFetch';

// Macro endpoints return raw §6 objects (NOT the {success,data,error} envelope).
// Do not reuse the watchlist `unwrap` helper here.

const PERIOD_DAYS: Record<MacroPeriod, number> = {
  '3M': 90,
  '6M': 182,
  '1Y': 365,
  '2Y': 730,
};

function startForPeriod(period: MacroPeriod): string {
  const days = PERIOD_DAYS[period];
  const start = new Date();
  start.setDate(start.getDate() - days);
  return start.toISOString().slice(0, 10);
}

export async function fetchMacroDashboard(period: MacroPeriod): Promise<MacroDashboard> {
  return fetchJson<MacroDashboard>(`/api/macro/dashboard?start=${startForPeriod(period)}`);
}

export async function fetchHyOas(period: MacroPeriod): Promise<MacroIndicator> {
  return fetchJson<MacroIndicator>(`/api/macro/hy-oas?start=${startForPeriod(period)}`);
}

export async function fetchNetLiquidity(period: MacroPeriod): Promise<MacroIndicator> {
  return fetchJson<MacroIndicator>(`/api/macro/net-liquidity?start=${startForPeriod(period)}`);
}

export async function fetchRspSpy(period: MacroPeriod): Promise<MacroIndicator> {
  return fetchJson<MacroIndicator>(`/api/macro/rsp-spy?start=${startForPeriod(period)}`);
}
