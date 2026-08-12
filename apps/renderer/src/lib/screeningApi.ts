import type {
  PppResponse,
  ScreeningResponse,
  ScreeningScanStatus,
  ScreeningUniverse,
} from '../types';
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

// min_score クエリは廃止した(スコアでの絞り込みは実測の裏付けが無い期待値の
// 含意を持ち込むため — docs/completed/n_pattern_backtest_spec.md §16.2)。
// 絞り込みは break_date の鮮度で表示側が行う。
export async function fetchScreeningResults(): Promise<ScreeningResponse> {
  return fetchJson<ScreeningResponse>('/api/screening/n-pattern');
}

// PPP は乖離値を返さない(検出条件そのもので、同じ df から常に再計算できる)。
export async function fetchPppResults(): Promise<PppResponse> {
  return fetchJson<PppResponse>('/api/screening/ppp');
}

export type StartScanResult = 'started' | 'already-running';

// スキャンは **1 ジョブで全パターンを実行する**(パターン別のスキャンは無い)。
// 銘柄あたりの取得を 1 回に保つための設計で、代償として「N字だけ再スキャン」はできない。
export async function startScreeningScan(universeId?: string): Promise<StartScanResult> {
  const base = await getBackendUrl();
  // 409 は「実行中」として正常系扱いにする(throw しない)。
  // universe_id: null は内蔵デフォルト(バックエンドはボディ無しとも等価に扱う)。
  const res = await fetch(`${base}/api/screening/scan`, {
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
  return fetchJson<ScreeningScanStatus>('/api/screening/status');
}

export async function fetchUniverses(): Promise<{ universes: ScreeningUniverse[] }> {
  return fetchJson<{ universes: ScreeningUniverse[] }>('/api/screening/universes');
}

export async function registerUniverse(name: string, csvText: string): Promise<ScreeningUniverse> {
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
