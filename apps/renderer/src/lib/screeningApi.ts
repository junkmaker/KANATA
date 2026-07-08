import type { ScreeningResponse, ScreeningScanStatus } from '../types';
import { getBackendUrl } from './backendUrl';

// Screening endpoints return raw objects (NOT the {success,data,error} envelope),
// mirroring macroApi. Do not unwrap.

async function fetchJson<T>(path: string): Promise<T> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchScreeningResults(minScore: number): Promise<ScreeningResponse> {
  return fetchJson<ScreeningResponse>(`/api/screening/n-pattern?min_score=${minScore}`);
}

export type StartScanResult = 'started' | 'already-running';

export async function startScreeningScan(): Promise<StartScanResult> {
  const base = await getBackendUrl();
  // 409 は「実行中」として正常系扱いにする(throw しない)。
  const res = await fetch(`${base}/api/screening/n-pattern/scan`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 409) return 'already-running';
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return 'started';
}

export async function fetchScanStatus(): Promise<ScreeningScanStatus> {
  return fetchJson<ScreeningScanStatus>('/api/screening/n-pattern/status');
}
