import { useScreening } from '../../hooks/useScreening';
import { useUniverses } from '../../hooks/useUniverses';
import { AGE_OPTIONS } from '../../lib/screeningView';
import { ScreeningTable } from './ScreeningTable';
import { UniverseSelect } from './UniverseSelect';
import './screening.css';

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
  } = useScreening();
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
          {/* ブレイクからの経過日数で絞る。スコアではなく鮮度で絞るのは、
              順位付けに期待値の含意を持たせないため(§16.2)。
              新しいほど有利という証拠は無く、これは作業順序の話。 */}
          ブレイク
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
      ) : (
        <ScreeningTable results={results} onSelectSymbol={onSelectSymbol} />
      )}
    </div>
  );
}
