import { useCallback, useState } from 'react';
import { useScreening } from '../../hooks/useScreening';
import { useUniverses } from '../../hooks/useUniverses';
import { AGE_LABEL, AGE_OPTIONS } from '../../lib/screeningView';
import type { PppResult, ScreeningPattern, ScreeningResult } from '../../types';
import { PppTable } from './PppTable';
import { ScreeningTable } from './ScreeningTable';
import { UniverseSelect } from './UniverseSelect';
import './screening.css';

const PATTERN_KEY = 'kanata.screening.pattern';

const PATTERN_TABS: { value: ScreeningPattern; label: string }[] = [
  { value: 'n-pattern', label: 'N字' },
  { value: 'ppp', label: 'PPP' },
];

/**
 * 永続化した選択パターンを読む。**値を検証してから返す。**
 *
 * 生の文字列をそのまま ScreeningPattern として扱うと、手で書き換えられた値や
 * 将来削除したパターン名が残っていたときに表が黙って空になる。
 */
function loadPattern(): ScreeningPattern {
  const saved = localStorage.getItem(PATTERN_KEY);
  return saved === 'ppp' || saved === 'n-pattern' ? saved : 'n-pattern';
}

function formatScanTime(iso: string | null): string {
  if (!iso) return '未スキャン';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Props = {
  onSelectSymbol: (ticker: string, name: string) => void;
};

export function ScreeningView({ onSelectSymbol }: Props) {
  const [pattern, setPattern] = useState<ScreeningPattern>(loadPattern);
  const selectPattern = useCallback((p: ScreeningPattern) => {
    setPattern(p);
    localStorage.setItem(PATTERN_KEY, p);
  }, []);

  const {
    results,
    totalCount,
    generatedAt,
    loadStatus,
    error,
    scanStatus,
    maxAgeDays,
    setMaxAgeDays,
    startScan,
  } = useScreening(pattern);
  const {
    universes,
    selectedId,
    status: universeStatus,
    actionError,
    select,
    register,
    remove,
  } = useUniverses();

  const isRunning = scanStatus?.status === 'running';

  return (
    <div className="screening-view">
      <div className="screening-toolbar">
        <button
          type="button"
          className="screening-scan-btn"
          onClick={() => startScan(selectedId)}
          disabled={isRunning}
        >
          {isRunning ? 'スキャン中…' : 'スキャン実行'}
        </button>
        <UniverseSelect
          universes={universes}
          selectedId={selectedId}
          disabled={isRunning || universeStatus !== 'ready'}
          onSelect={select}
          onRegister={register}
          onRemove={remove}
          actionError={actionError}
        />
        {isRunning && scanStatus && (
          <span className="screening-progress">
            進捗 {scanStatus.done}/{scanStatus.total}
          </span>
        )}
        <span className="screening-lastscan">最終スキャン: {formatScanTime(generatedAt)}</span>
        <label className="screening-age">
          {/* 検出日からの経過日数で絞る。スコアではなく鮮度で絞るのは、
              順位付けに期待値の含意を持たせないため(§16.2)。
              新しいほど有利という証拠は無く、これは作業順序の話。
              選択肢は共有し、ラベル語だけパターンで差し替える
              (N字「ブレイク」/ PPP「成立」)。既定値もパターンで違う。 */}
          {AGE_LABEL[pattern]}
          <select
            value={maxAgeDays === null ? '' : String(maxAgeDays)}
            onChange={(e) => setMaxAgeDays(e.target.value === '' ? null : Number(e.target.value))}
          >
            {AGE_OPTIONS.map((o) => (
              <option key={o.label} value={o.value === null ? '' : String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="screening-count">
          {results.length === totalCount
            ? `${totalCount} 件`
            : `${results.length} / ${totalCount} 件`}
        </span>
      </div>

      {/* パターンタブ。ツールバーの外に独立した行として置く — ツールバーは
          flex-wrap なので、中に入れるとスキャンボタン等と混ざってタブに見えない。
          スキャンボタンはタブごとに増やさない(ジョブが 1 本なので、2 箇所に
          出すと同じジョブを叩くボタンが並ぶ)。 */}
      <div className="screening-tabs">
        {PATTERN_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`screening-tab ${pattern === t.value ? 'active' : ''}`}
            onClick={() => selectPattern(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {scanStatus?.status === 'error' && (
        <div className="screening-error">
          スキャンに失敗しました{scanStatus.error ? `: ${scanStatus.error}` : ''}
        </div>
      )}

      {loadStatus !== 'offline' && error && (
        <div className="screening-error">スキャンを開始できません: {error}</div>
      )}

      {loadStatus === 'offline' ? (
        <div className="screening-error">
          バックエンドに接続できません{error ? `: ${error}` : ''}
        </div>
      ) : loadStatus === 'loading' ? (
        <div className="screening-loading">読み込み中…</div>
      ) : pattern === 'ppp' ? (
        <PppTable results={results as PppResult[]} onSelectSymbol={onSelectSymbol} />
      ) : (
        <ScreeningTable results={results as ScreeningResult[]} onSelectSymbol={onSelectSymbol} />
      )}
    </div>
  );
}
