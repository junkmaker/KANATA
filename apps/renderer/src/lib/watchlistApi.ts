import type { ApiResponse, Watchlist } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body?.detail || body?.error || detail;
    } catch { /* noop */ }
    throw new Error(detail);
  }
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success || body.data === null || body.data === undefined) {
    throw new Error(body.error || 'API returned unsuccessful response');
  }
  return body.data;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export async function fetchWatchlists(): Promise<Watchlist[]> {
  const res = await fetch(`${BASE_URL}/api/watchlists`);
  return unwrap<Watchlist[]>(res);
}

export async function createWatchlist(name: string): Promise<Watchlist> {
  const res = await fetch(`${BASE_URL}/api/watchlists`, jsonInit('POST', { name }));
  return unwrap<Watchlist>(res);
}

export async function updateWatchlist(
  id: number,
  payload: { name?: string; is_default?: boolean },
): Promise<Watchlist> {
  const res = await fetch(`${BASE_URL}/api/watchlists/${id}`, jsonInit('PATCH', payload));
  return unwrap<Watchlist>(res);
}

export async function deleteWatchlist(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/watchlists/${id}`, jsonInit('DELETE'));
  await unwrap<{ id: number }>(res);
}

export async function reorderWatchlists(ids: number[]): Promise<Watchlist[]> {
  const res = await fetch(`${BASE_URL}/api/watchlists/reorder`, jsonInit('PUT', { ids }));
  return unwrap<Watchlist[]>(res);
}

export async function addWatchlistItem(
  listId: number,
  payload: { symbol: string; market: string; display_name?: string },
): Promise<Watchlist> {
  const res = await fetch(`${BASE_URL}/api/watchlists/${listId}/items`, jsonInit('POST', payload));
  return unwrap<Watchlist>(res);
}

export async function removeWatchlistItem(listId: number, symbol: string): Promise<Watchlist> {
  const res = await fetch(
    `${BASE_URL}/api/watchlists/${listId}/items/${encodeURIComponent(symbol)}`,
    jsonInit('DELETE'),
  );
  return unwrap<Watchlist>(res);
}

export async function reorderWatchlistItems(listId: number, symbols: string[]): Promise<Watchlist> {
  const res = await fetch(
    `${BASE_URL}/api/watchlists/${listId}/items/reorder`,
    jsonInit('PUT', { symbols }),
  );
  return unwrap<Watchlist>(res);
}
