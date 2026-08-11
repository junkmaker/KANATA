import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchPppResults,
  fetchScanStatus,
  fetchScreeningResults,
  startScreeningScan,
} from '../lib/screeningApi';
import { DEFAULT_MAX_AGE_DAYS, filterByAge } from '../lib/screeningView';
import type {
  PppResponse,
  PppResult,
  ScreeningPattern,
  ScreeningResponse,
  ScreeningResult,
  ScreeningScanStatus,
} from '../types';

export type ScreeningLoadStatus = 'loading' | 'ready' | 'offline';

const POLL_INTERVAL_MS = 2000;

type PatternRow = ScreeningResult | PppResult;
type PatternResponse = ScreeningResponse | PppResponse;

interface UseScreeningResult {
  results: PatternRow[];
  totalCount: number;
  generatedAt: string | null;
  loadStatus: ScreeningLoadStatus;
  error: string | null;
  scanStatus: ScreeningScanStatus | null;
  maxAgeDays: number | null;
  setMaxAgeDays: (n: number | null) => void;
  startScan: (universeId?: string) => Promise<void>;
}

/** 行から鮮度判定に使う日付を取り出す。フィールド名がパターンで違う。 */
function dateOf(r: PatternRow): string {
  return 'established_date' in r ? r.established_date : r.break_date;
}

/**
 * スクリーニング結果の取得・鮮度フィルタ・スキャン起動。
 *
 * **パターンごとに呼び分けない** — この hook は 1 箇所からだけ呼び、パターンは
 * 引数で渡す。タブごとにインスタンスを持つと fetch とポーリングが二重に走る。
 * スキャンジョブは 1 本なので、進捗と再読込トークンはパターン間で共通でよい。
 */
export function useScreening(pattern: ScreeningPattern): UseScreeningResult {
  // 取得済みレスポンスは**どのパターンのものか**を一緒に持つ。`pattern` が変わった
  // レンダーでは、再取得の effect（描画後に走る）がまだ loading を立てていないため、
  // これが無いと前パターンの行が新しい表に 1 フレームだけ描かれる
  // （PPP タブに N字の行が成立日カラム空欄で出る）。キャストがあるので tsc も
  // 型では捕まえられない。
  const [data, setData] = useState<{ pattern: ScreeningPattern; res: PatternResponse } | null>(
    null,
  );
  const [loadStatus, setLoadStatus] = useState<ScreeningLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  // 鮮度は**タブごとに独立して保持する**。単一 state にしてパターン変更でリセットすると、
  // 切り替えて戻ったときにユーザーの選択が黙って消える。既定値の根拠は
  // screeningView.ts の DEFAULT_MAX_AGE_DAYS を参照（N字=全件 / PPP=7日）。
  const [maxAgeByPattern, setMaxAgeByPattern] = useState<Record<ScreeningPattern, number | null>>(
    () => ({ ...DEFAULT_MAX_AGE_DAYS }),
  );
  const [scanStatus, setScanStatus] = useState<ScreeningScanStatus | null>(null);
  // サイドカー再起動やスキャン完了時に結果を取り直すためのトークン
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const unsubscribe = window.kanata?.onBackendStatus((payload) => {
      if (payload.status === 'ready') setReloadToken((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  // reloadToken / pattern 変化でキャッシュ結果を取得。
  // 絞り込みはサーバに投げない — 鮮度フィルタは日付から表示側で計算でき、
  // 取り直す理由がない(選択のたびに fetch すると再スキャン中に取りこぼす)。
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken はサイドカー再起動後の再取得トリガー。effect 内で値を読まないため biome は不要と判断するが、依存から外すと再取得が起きなくなる
  useEffect(() => {
    let cancelled = false;
    setLoadStatus('loading');

    const fetcher = pattern === 'ppp' ? fetchPppResults : fetchScreeningResults;
    fetcher()
      .then((res) => {
        if (cancelled) return;
        setData({ pattern, res });
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
  }, [reloadToken, pattern]);

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

  const maxAgeDays = maxAgeByPattern[pattern];
  const setMaxAgeDays = useCallback(
    (n: number | null) => setMaxAgeByPattern((prev) => ({ ...prev, [pattern]: n })),
    [pattern],
  );

  // 現在のパターンに対応するデータだけを採る。切替直後は null になり、
  // 下の effectiveStatus が loading に倒れて表の描画そのものを止める。
  const current = data !== null && data.pattern === pattern ? data.res : null;
  const all: PatternRow[] = current?.results ?? [];
  const generatedAt = current?.generated_at ?? null;
  // 鮮度の基準はスキャン実行時刻。現在時刻にすると、古い結果を開いたときに
  // 全件が「古い」と判定されて空テーブルになる。
  const results = useMemo(
    () => filterByAge(all, maxAgeDays, generatedAt, dateOf),
    [all, maxAgeDays, generatedAt],
  );

  // ready なのに現在のパターンのデータが無い＝切替直後の 1 フレーム。loading に倒す。
  // それ以外（loading / offline）は素通しで、同じパターンの再取得中の挙動は変えない。
  const effectiveStatus: ScreeningLoadStatus =
    loadStatus === 'ready' && current === null ? 'loading' : loadStatus;

  return {
    results,
    totalCount: all.length,
    generatedAt,
    loadStatus: effectiveStatus,
    error,
    scanStatus,
    maxAgeDays,
    setMaxAgeDays,
    startScan,
  };
}
