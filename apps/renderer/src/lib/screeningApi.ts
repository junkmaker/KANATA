import type { ScreeningResponse, ScreeningScanStatus, ScreeningUniverse } from '../types';
import { FETCH_TIMEOUT_MS, fetchJson } from './backendFetch';
import { getBackendUrl } from './backendUrl';

// Screening endpoints return raw objects (NOT the {success,data,error} envelope),
// mirroring macroApi. Do not unwrap.

// HTTPException の detail をエラーメッセージとして拾う(取れなければ statusText)。
async function errorFromResponse(res: Response): Promise<Error> {
  const fallback = `${res.status} ${res.statusText}`;
  const detail = await res
    .json()
    .then((body: unknown) => {
      if (body && typeof body === 'object' && 'detail' in body) {
        const d = (body as { detail: unknown }).detail;
        return typeof d === 'string' ? d : null;
      }
      return null;
    })
    .catch(() => null);
  return new Error(detail ?? fallback);
}

export async function fetchScreeningResults(minScore: number): Promise<ScreeningResponse> {
  return fetchJson<ScreeningResponse>(`/api/screening/n-pattern?min_score=${minScore}`);
}

export type StartScanResult = 'started' | 'already-running';

export async function startScreeningScan(universeId?: string): Promise<StartScanResult> {
  const base = await getBackendUrl();
  // 409 は「実行中」として正常系扱いにする(throw しない)。
  // universe_id: null は内蔵デフォルト(バックエンドはボディ無しとも等価に扱う)。
  const res = await fetch(`${base}/api/screening/n-pattern/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ universe_id: universeId ?? null }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 409) return 'already-running';
  if (!res.ok) throw await errorFromResponse(res);
  return 'started';
}

export async function fetchScanStatus(): Promise<ScreeningScanStatus> {
  return fetchJson<ScreeningScanStatus>('/api/screening/n-pattern/status');
}

export async function fetchUniverses(): Promise<{ universes: ScreeningUniverse[] }> {
  return fetchJson<{ universes: ScreeningUniverse[] }>('/api/screening/universes');
}

export async function registerUniverse(
  name: string,
  csvText: string,
): Promise<ScreeningUniverse> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/screening/universes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, csv_text: csvText }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw await errorFromResponse(res);
  return res.json();
}

export async function deleteUniverse(id: string): Promise<void> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/screening/universes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw await errorFromResponse(res);
}
