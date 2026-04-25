import { useCallback, useEffect, useRef, useState } from 'react';
import { searchSymbols } from '../lib/searchApi';
import type { SearchResult } from '../types';

const DEBOUNCE_MS = 280;

interface DebouncedSearchState {
  results: SearchResult[];
  loading: boolean;
  error: string | null;
}

export function useDebouncedSearch(query: string): DebouncedSearchState & { clear: () => void } {
  const [state, setState] = useState<DebouncedSearchState>({
    results: [],
    loading: false,
    error: null,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    setState({ results: [], loading: false, error: null });
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    const trimmed = query.trim();
    if (!trimmed) {
      setState({ results: [], loading: false, error: null });
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const results = await searchSymbols(trimmed, controller.signal);
        setState({ results, loading: false, error: null });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setState({
          results: [],
          loading: false,
          error: err instanceof Error ? err.message : 'Search failed',
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  return { ...state, clear };
}
