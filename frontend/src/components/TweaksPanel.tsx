import type { AppState } from '../types';

interface TweaksPanelProps {
  aesthetic: string;
  setAesthetic: (v: string) => void;
  density: string;
  setDensity: (v: string) => void;
  onClose: () => void;
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}

export function TweaksPanel({ aesthetic, setAesthetic, density, setDensity, onClose, state, setState }: TweaksPanelProps) {
  return (
    <div className="tweaks-panel">
      <div className="tweaks-head">
        <span>TWEAKS</span>
        <button className="link-btn" onClick={onClose}>CLOSE</button>
      </div>

      <div className="tweaks-row">
        <div className="tweak-label">Color theme</div>
        <div className="tweak-chips">
          {([['dark-blue', 'Dark Blue'], ['dark-neutral', 'Neutral'], ['dark-amber', 'Amber CRT'], ['midnight', 'Midnight']] as [string, string][]).map(([id, label]) => (
            <button key={id} className={`chip${aesthetic === id ? ' on' : ''}`} onClick={() => setAesthetic(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="tweaks-row">
        <div className="tweak-label">Density</div>
        <div className="tweak-chips">
          {(['compact', 'comfortable'] as string[]).map(d => (
            <button key={d} className={`chip${density === d ? ' on' : ''}`} onClick={() => setDensity(d)}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="tweaks-row">
        <div className="tweak-label">Compare mode</div>
        <div className="tweak-chips">
          {([['percent', '% change'], ['none', 'Hide compares']] as [string, string][]).map(([id, label]) => (
            <button key={id} className={`chip${state.compareMode === id ? ' on' : ''}`}
              onClick={() => setState(s => ({ ...s, compareMode: id }))}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="tweaks-row">
        <div className="tweak-label">Quick presets</div>
        <div className="tweak-chips">
          <button className="chip" onClick={() => setState(s => ({ ...s, indicators: { sma5: false, sma25: true, sma75: true, ema20: false, boll: true, stoch: true, psar: false, ichi: false } }))}>
            Swing trader
          </button>
          <button className="chip" onClick={() => setState(s => ({ ...s, indicators: { sma5: true, sma25: false, sma75: false, ema20: true, boll: false, stoch: true, psar: true, ichi: false } }))}>
            Day trader
          </button>
          <button className="chip" onClick={() => setState(s => ({ ...s, indicators: { sma5: false, sma25: false, sma75: false, ema20: false, boll: false, stoch: false, psar: false, ichi: true } }))}>
            Ichimoku
          </button>
          <button className="chip" onClick={() => setState(s => ({ ...s, indicators: { sma5: false, sma25: false, sma75: false, ema20: false, boll: false, stoch: false, psar: false, ichi: false } }))}>
            Clean
          </button>
        </div>
      </div>
    </div>
  );
}
