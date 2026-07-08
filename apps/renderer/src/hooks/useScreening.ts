import { useCallback, useEffect, useState } from 'react';
import { fetchScanStatus, fetchScreeningResults, startScreeningScan } from '../lib/screeningApi';
import type { ScreeningResponse, ScreeningResult, ScreeningScanStatus } from '../types';

export type ScreeningLoadStatus = 'loading' | 'ready' | 'offline';

const POLL_INTERVAL_MS = 2000;

interface UseScreeningResult {
  results: ScreeningResult[];
  generatedAt: string | null;
  loadStatus: ScreeningLoadStatus;
  error: string | null;
  scanStatus: ScreeningScanStatus | null;
  minScore: number;
  setMinScore: (n: number) => void;
  startScan: () => Promise<void>;
}

export function useScreening(): UseScreeningResult {
  const [data, setData] = useState<ScreeningResponse | null>(null);
  const [loadStatus, setLoadStatus] = useState<ScreeningLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(50);
  const [scanStatus, setScanStatus] = useState<ScreeningScanStatus | null>(null);
  // サイドカー再起動やスキャン完了時に結果を取り直すためのトークン
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const unsubscribe = window.kanata?.onBackendStatus((payload) => {
      if (payload.status === 'ready') setReloadToken((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  // min_score / reloadToken 変化でキャッシュ結果を取得
  useEffect(() => {
    let cancelled = false;
    setLoadStatus('loading');

    fetchScreeningResults(minScore)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoadStatus('ready');
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadStatus('offline');
        setError(e instanceof Error ? e.message : 'fetch failed');
      });

    return () => {
      cancelled = true;
    };
  }, [minScore, reloadToken]);

  // 実行中のみ status をポーリング。running↔done で effect を張り替える。
  const isRunning = scanStatus?.status === 'running';
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;

    const id = setInterval(() => {
      fetchScanStatus()
        .then((s) => {
          if (cancelled) return;
          setScanStatus(s);
          if (s.status === 'done' || s.status === 'error') {
            setReloadToken((t) => t + 1);
          }
        })
        .catch(() => {
          /* transient poll error — 次の tick で回復 */
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isRunning]);

  const startScan = useCallback(async () => {
    try {
      await startScreeningScan();
      const s = await fetchScanStatus();
      setScanStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'scan failed');
    }
  }, []);

  return {
    results: data?.results ?? [],
    generatedAt: data?.generated_at ?? null,
    loadStatus,
    error,
    scanStatus,
    minScore,
    setMinScore,
    startScan,
  };
}
