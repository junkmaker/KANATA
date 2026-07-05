import { clampSelectionForMode } from '../lib/selection';
import type { AppState } from '../types';
import { ApiKeyField } from './Settings/ApiKeyField';

interface TweaksPanelProps {
  aesthetic: string;
  setAesthetic: (v: string) => void;
  onClose: () => void;
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}

export function TweaksPanel({
  aesthetic,
  setAesthetic,
  onClose,
  state,
  setState,
}: TweaksPanelProps) {
  return (
    <div className="tweaks-panel">
      <div className="tweaks-head">
        <span>設定</span>
        <button className="link-btn" onClick={onClose}>
          閉じる
        </button>
      </div>

      <ApiKeyField />

      <div className="tweaks-row">
        <div className="tweak-label">カラーテーマ</div>
        <div className="tweak-chips">
          {(
            [
              ['dark-blue', 'ダークブルー'],
              ['dark-neutral', 'ニュートラル'],
              ['dark-amber', 'アンバーCRT'],
              ['midnight', 'ミッドナイト'],
            ] as [string, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={`chip${aesthetic === id ? ' on' : ''}`}
              onClick={() => setAesthetic(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="tweaks-row">
        <div className="tweak-label">SQ・ウィッチング</div>
        <div className="tweak-chips">
          {(
            [
              ['true', '表示'],
              ['false', '非表示'],
            ] as [string, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={`chip${String(state.showSqMarkers) === id ? ' on' : ''}`}
              onClick={() => setState((s) => ({ ...s, showSqMarkers: id === 'true' }))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="tweaks-row">
        <div className="tweak-label">比較モード</div>
        <div className="tweak-chips">
          {(
            [
              ['percent', '変化率'],
              ['none', '比較を非表示'],
            ] as [string, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={`chip${state.compareMode === id ? ' on' : ''}`}
              onClick={() =>
                setState((s) => ({
                  ...s,
                  compareMode: id,
                  selected: clampSelectionForMode(s.selected, id),
                }))
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="tweaks-row">
        <div className="tweak-label">クイックプリセット</div>
        <div className="tweak-chips">
          <button
            className="chip"
            onClick={() =>
              setState((s) => ({
                ...s,
                indicators: {
                  ...s.indicators,
                  sma5: false,
                  sma25: true,
                  sma75: true,
                  ema20: false,
                  boll: true,
                  stoch: true,
                  psar: false,
                  ichi: false,
                },
              }))
            }
          >
            スイング
          </button>
          <button
            className="chip"
            onClick={() =>
              setState((s) => ({
                ...s,
                indicators: {
                  ...s.indicators,
                  sma5: true,
                  sma25: false,
                  sma75: false,
                  ema20: true,
                  boll: false,
                  stoch: true,
                  psar: true,
                  ichi: false,
                },
              }))
            }
          >
            デイトレ
          </button>
          <button
            className="chip"
            onClick={() =>
              setState((s) => ({
                ...s,
                indicators: {
                  ...s.indicators,
                  sma5: false,
                  sma25: false,
                  sma75: false,
                  ema20: false,
                  boll: false,
                  stoch: false,
                  psar: false,
                  ichi: true,
                },
              }))
            }
          >
            一目
          </button>
          <button
            className="chip"
            onClick={() =>
              setState((s) => ({
                ...s,
                indicators: {
                  ...s.indicators,
                  sma5: false,
                  sma25: false,
                  sma75: false,
                  ema20: false,
                  boll: false,
                  stoch: false,
                  psar: false,
                  ichi: false,
                },
              }))
            }
          >
            全解除
          </button>
        </div>
      </div>
    </div>
  );
}
