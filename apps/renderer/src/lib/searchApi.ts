import type { ApiResponse, SearchResult } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function searchSymbols(
  q: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const res = await fetch(
    `${BASE_URL}/api/search?q=${encodeURIComponent(q)}`,
    { signal },
  );
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status}`);
  }
  const body = (await res.json()) as ApiResponse<SearchResult[]>;
  if (!body.success || !body.data) {
    throw new Error(body.error || 'Search returned unsuccessful response');
  }
  return body.data;
}
