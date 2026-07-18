import { getBackendUrl } from './backendUrl';

// 生オブジェクト系エンドポイント(macro / screening)共通の GET ラッパ。
// {success,data,error} エンベロープ系(watchlist)には使わない。

export const FETCH_TIMEOUT_MS = 15_000;

export async function fetchJson<T>(path: string): Promise<T> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
