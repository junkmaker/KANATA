import { useCallback, useEffect, useState } from 'react';
import type { Watchlist } from '../types';
import {
  addWatchlistItem,
  createWatchlist,
  deleteWatchlist,
  fetchWatchlists,
  removeWatchlistItem,
  reorderWatchlistItems,
  reorderWatchlists,
  updateWatchlist,
} from '../lib/watchlistApi';

export type WatchlistsStatus = 'loading' | 'ready' | 'offline';

interface UseWatchlistsResult {
  watchlists: Watchlist[];
  status: WatchlistsStatus;
  error: string | null;
  reload: () => Promise<void>;
  create: (name: string) => Promise<Watchlist | null>;
  rename: (id: number, name: string) => Promise<Watchlist | null>;
  setDefault: (id: number) => Promise<Watchlist | null>;
  remove: (id: number) => Promise<boolean>;
  reorderLists: (ids: number[]) => Promise<void>;
  addItem: (listId: number, symbol: string, market: string, displayName?: string) => Promise<Watchlist | null>;
  removeItem: (listId: number, symbol: string) => Promise<Watchlist | null>;
  reorderItems: (listId: number, symbols: string[]) => Promise<Watchlist | null>;
}

export function useWatchlists(): UseWatchlistsResult {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [status, setStatus] = useState<WatchlistsStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      const lists = await fetchWatchlists();
      setWatchlists(lists);
      setStatus('ready');
      setError(null);
    } catch (e) {
      setStatus('offline');
      setError(e instanceof Error ? e.message : 'fetch failed');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const replaceList = (updated: Watchlist) => {
    setWatchlists(prev => prev.map(w => (w.id === updated.id ? updated : w)));
  };

  const create = useCallback(async (name: string) => {
    try {
      const wl = await createWatchlist(name);
      setWatchlists(prev => [...prev, wl]);
      return wl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
      return null;
    }
  }, []);

  const rename = useCallback(async (id: number, name: string) => {
    try {
      const wl = await updateWatchlist(id, { name });
      replaceList(wl);
      return wl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'rename failed');
      return null;
    }
  }, []);

  const setDefault = useCallback(async (id: number) => {
    try {
      const wl = await updateWatchlist(id, { is_default: true });
      setWatchlists(prev => prev.map(w => ({ ...w, is_default: w.id === id ? 1 : 0 })));
      return wl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'setDefault failed');
      return null;
    }
  }, []);

  const remove = useCallback(async (id: number) => {
    try {
      await deleteWatchlist(id);
      setWatchlists(prev => prev.filter(w => w.id !== id));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
      return false;
    }
  }, []);

  const reorderLists = useCallback(async (ids: number[]) => {
    try {
      const lists = await reorderWatchlists(ids);
      setWatchlists(lists);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reorder failed');
    }
  }, []);

  const addItem = useCallback(
    async (listId: number, symbol: string, market: string, displayName?: string) => {
      try {
        const wl = await addWatchlistItem(listId, { symbol, market, display_name: displayName });
        replaceList(wl);
        return wl;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'add item failed');
        return null;
      }
    },
    [],
  );

  const removeItem = useCallback(async (listId: number, symbol: string) => {
    try {
      const wl = await removeWatchlistItem(listId, symbol);
      replaceList(wl);
      return wl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'remove item failed');
      return null;
    }
  }, []);

  const reorderItems = useCallback(async (listId: number, symbols: string[]) => {
    try {
      const wl = await reorderWatchlistItems(listId, symbols);
      replaceList(wl);
      return wl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reorder items failed');
      return null;
    }
  }, []);

  return {
    watchlists,
    status,
    error,
    reload,
    create,
    rename,
    setDefault,
    remove,
    reorderLists,
    addItem,
    removeItem,
    reorderItems,
  };
}
