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
  // API キー保存などでサイドカーが再起動し ready に戻ったら再取得するためのトークン
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const unsubscribe = window.kanata?.onBackendStatus((payload) => {
      if (payload.status === 'ready') setReloadToken((t) => t + 1);
    });
    return unsubscribe;
  }, []);

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
  }, [period, reloadToken]);

  return { data, status, error };
}
