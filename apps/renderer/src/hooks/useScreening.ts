import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchScanStatus, fetchScreeningResults, startScreeningScan } from '../lib/screeningApi';
import { filterByAge } from '../lib/screeningView';
import type { ScreeningResponse, ScreeningResult, ScreeningScanStatus } from '../types';

export type ScreeningLoadStatus = 'loading' | 'ready' | 'offline';

const POLL_INTERVAL_MS = 2000;

interface UseScreeningResult {
  results: ScreeningResult[];
  totalCount: number;
  generatedAt: string | null;
  loadStatus: ScreeningLoadStatus;
  error: string | null;
  scanStatus: ScreeningScanStatus | null;
  maxAgeDays: number | null;
  setMaxAgeDays: (n: number | null) => void;
  startScan: (universeId?: string) => Promise<void>;
}

export function useScreening(): UseScreeningResult {
  const [data, setData] = useState<ScreeningResponse | null>(null);
  const [loadStatus, setLoadStatus] = useState<ScreeningLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  // 既定は全件。絞って開くと見落とすため(docs/screening_ui_repositioning_plan.md §6)。
  const [maxAgeDays, setMaxAgeDays] = useState<number | null>(null);
  const [scanStatus, setScanStatus] = useState<ScreeningScanStatus | null>(null);
  // サイドカー再起動やスキャン完了時に結果を取り直すためのトークン
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const unsubscribe = window.kanata?.onBackendStatus((payload) => {
      if (payload.status === 'ready') setReloadToken((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  // reloadToken 変化でキャッシュ結果を取得。
  // 絞り込みはサーバに投げない — 鮮度フィルタは break_date から表示側で計算でき、
  // 取り直す理由がない(選択のたびに fetch すると再スキャン中に取りこぼす)。
  useEffect(() => {
    let cancelled = false;
    setLoadStatus('loading');

    fetchScreeningResults()
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
  }, [reloadToken]);

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

  const startScan = useCallback(async (universeId?: string) => {
    try {
      await startScreeningScan(universeId);
      const s = await fetchScanStatus();
      setScanStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'scan failed');
    }
  }, []);

  const all = data?.results ?? [];
  const generatedAt = data?.generated_at ?? null;
  // 鮮度の基準はスキャン実行時刻。現在時刻にすると、古い結果を開いたときに
  // 全件が「古い」と判定されて空テーブルになる。
  const results = useMemo(
    () => filterByAge(all, maxAgeDays, generatedAt),
    [all, maxAgeDays, generatedAt],
  );

  return {
    results,
    totalCount: all.length,
    generatedAt,
    loadStatus,
    error,
    scanStatus,
    maxAgeDays,
    setMaxAgeDays,
    startScan,
  };
}
