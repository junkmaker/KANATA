import { useScreening } from '../../hooks/useScreening';
import { ScreeningTable } from './ScreeningTable';
import './screening.css';

const MIN_SCORE_OPTIONS = [0, 50, 60, 70, 80];

function formatScanTime(iso: string | null): string {
  if (!iso) return '未スキャン';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Props = {
  onSelectSymbol: (ticker: string) => void;
};

export function ScreeningView({ onSelectSymbol }: Props) {
  const { results, generatedAt, loadStatus, error, scanStatus, minScore, setMinScore, startScan } =
    useScreening();

  const isRunning = scanStatus?.status === 'running';

  return (
    <div className="screening-view">
      <div className="screening-toolbar">
        <button
          type="button"
          className="screening-scan-btn"
          onClick={startScan}
          disabled={isRunning}
        >
          {isRunning ? 'スキャン中…' : 'スキャン実行'}
        </button>
        {isRunning && scanStatus && (
          <span className="screening-progress">
            進捗 {scanStatus.done}/{scanStatus.total}
          </span>
        )}
        <span className="screening-lastscan">最終スキャン: {formatScanTime(generatedAt)}</span>
        <label className="screening-minscore">
          最小スコア
          <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
            {MIN_SCORE_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {scanStatus?.status === 'error' && (
        <div className="screening-error">
          スキャンに失敗しました{scanStatus.error ? `: ${scanStatus.error}` : ''}
        </div>
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
