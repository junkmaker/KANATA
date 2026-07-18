import { useCallback, useEffect, useState } from 'react';
import { deleteUniverse, fetchUniverses, registerUniverse } from '../lib/screeningApi';
import type { ScreeningUniverse } from '../types';

export type UniverseLoadStatus = 'loading' | 'ready' | 'offline';

const STORAGE_KEY = 'kanata.screening.universeId';
const DEFAULT_UNIVERSE_ID = 'default';

interface UseUniversesResult {
  universes: ScreeningUniverse[];
  selectedId: string;
  status: UniverseLoadStatus;
  actionError: string | null;
  select: (id: string) => void;
  register: (file: File) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useUniverses(): UseUniversesResult {
  const [universes, setUniverses] = useState<ScreeningUniverse[]>([]);
  const [selectedId, setSelectedId] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_UNIVERSE_ID,
  );
  const [status, setStatus] = useState<UniverseLoadStatus>('loading');
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // サイドカーの起動完了/再起動時に一覧を取り直す(初回 fetch がサイドカー起動前に
  // 走って offline になった場合の復帰経路。useScreening と同じパターン)。
  useEffect(() => {
    const unsubscribe = window.kanata?.onBackendStatus((payload) => {
      if (payload.status === 'ready') setReloadToken((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    fetchUniverses()
      .then((res) => {
        if (cancelled) return;
        setUniverses(res.universes);
        setStatus('ready');
        // localStorage に削除済み id が残っていたら default に戻す
        setSelectedId((prev) =>
          res.universes.some((u) => u.id === prev) ? prev : DEFAULT_UNIVERSE_ID,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('offline');
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const register = useCallback(
    async (file: File) => {
      setActionError(null);
      try {
        const csvText = await file.text();
        const name = file.name.replace(/\.[^.]+$/, '') || file.name;
        const created = await registerUniverse(name, csvText);
        // レスポンスが作成済みエントリを含むので再取得はしない
        setUniverses((prev) => [...prev, created]);
        select(created.id);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'CSV の登録に失敗しました');
      }
    },
    [select],
  );

  const remove = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        await deleteUniverse(id);
        setUniverses((prev) => prev.filter((u) => u.id !== id));
        if (selectedId === id) select(DEFAULT_UNIVERSE_ID);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'ユニバースの削除に失敗しました');
      }
    },
    [selectedId, select],
  );

  return { universes, selectedId, status, actionError, select, register, remove };
}
