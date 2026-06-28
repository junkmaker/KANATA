import { useEffect, useState } from 'react';
import { fetchMacroDashboard } from '../lib/macroApi';
import type { MacroDashboard, MacroPeriod } from '../types';

export type MacroStatus = 'loading' | 'ready' | 'offline';

interface UseMacroDashboardResult {
  data: MacroDashboard | null;
  status: MacroStatus;
  error: string | null;
}

export function useMacroDashboard(period: MacroPeriod): UseMacroDashboardResult {
  const [data, setData] = useState<MacroDashboard | null>(null);
  const [status, setStatus] = useState<MacroStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    fetchMacroDashboard(period)
      .then((dashboard) => {
        if (cancelled) return;
        setData(dashboard);
        setStatus('ready');
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus('offline');
        setError(e instanceof Error ? e.message : 'fetch failed');
      });

    return () => {
      cancelled = true;
    };
  }, [period]);

  return { data, status, error };
}
