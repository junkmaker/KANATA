import type { ApiResponse, SearchResult } from '../types';
import { getBackendUrl } from './backendUrl';

export async function searchSymbols(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status}`);
  }
  const body = (await res.json()) as ApiResponse<SearchResult[]>;
  if (!body.success || !body.data) {
    throw new Error(body.error || 'Search returned unsuccessful response');
  }
  return body.data;
}
