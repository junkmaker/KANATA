import type { AppState } from '../../types';

interface LeftPanelProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}

function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="section">
      <div className="section-head">
        <span>{title}</span>
        {right}
      </div>
      <div className="section-body">{children}</div>
    </div>
  );
}

function ToolBtn({
  id,
  label,
  icon,
  activeTool,
  setTool,
}: {
  id: string;
  label: string;
  icon: string;
  activeTool: string;
  setTool: (id: string) => void;
}) {
  const active = activeTool === id;
  return (
    <button
      className={`tool-btn${active ? ' active' : ''}`}
      onClick={() => setTool(id)}
      title={label}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG icon string */}
      <span className="tool-icon" dangerouslySetInnerHTML={{ __html: icon }} />
      <span className="tool-label">{label}</span>
    </button>
  );
}

function Toggle({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  color?: string;
}) {
  return (
    <label className={`toggle-row${value ? ' on' : ''}`}>
      <span
        className="toggle-dot"
        style={{
          background: value ? color || 'var(--accent)' : 'transparent',
          borderColor: color || 'var(--accent)',
        }}
      />
      <span className="toggle-label">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ display: 'none' }}
      />
    </label>
  );
}

export function LeftPanel({ state, setState }: LeftPanelProps) {
  const setTool = (t: string) =>
    setState((s) => ({ ...s, activeTool: s.activeTool === t ? 'pan' : t }));
  const setInd = (k: keyof AppState['indicators'], v: boolean) =>
    setState((s) => ({ ...s, indicators: { ...s.indicators, [k]: v } }));
  const setFin = (k: keyof AppState['financial'], v: boolean) =>
    setState((s) => ({ ...s, financial: { ...s.financial, [k]: v } }));

  const tools = [
    {
      id: 'pan',
      label: 'パン / 選択',
      icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 8h10M8 3v10"/></svg>',
    },
    {
      id: 'trend',
      label: 'トレンドライン',
      icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 13L14 3"/><circle cx="2" cy="13" r="1.4" fill="currentColor"/><circle cx="14" cy="3" r="1.4" fill="currentColor"/></svg>',
    },
    {
      id: 'hline',
      label: '水平線',
      icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 2"><path d="M1 8h14"/></svg>',
    },
    {
      id: 'vline',
      label: '垂直線',
      icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 2"><path d="M8 1v14"/></svg>',
    },
    {
      id: 'rect',
      label: '長方形',
      icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="4" width="12" height="8"/></svg>',
    },
    {
      id: 'ellipse',
      label: '楕円',
      icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><ellipse cx="8" cy="8" rx="6" ry="4"/></svg>',
    },
    {
      id: 'text',
      label: 'テキスト',
      icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4h10M8 4v9M6 13h4"/></svg>',
    },
  ];

  const timeframes = ['5m', '15m', '60m', '1D', '1W', '1M'];
  const clearDrawings = () => setState((s) => ({ ...s, drawings: [], selectedDrawingId: null }));

  return (
    <aside className="panel panel-left">
      <Section title="タイムフレーム">
        <div className="tf-grid">
          {timeframes.map((tf) => (
            <button
              key={tf}
              className={`tf-btn${state.timeframe === tf ? ' active' : ''}`}
              onClick={() => setState((s) => ({ ...s, timeframe: tf }))}
            >
              {tf}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="描画ツール"
        right={
          <button type="button" className="link-btn" onClick={clearDrawings} title="描画を全て消す">
            全消去
          </button>
        }
      >
        <div className="tool-grid">
          {tools.map((t) => (
            <ToolBtn key={t.id} {...t} activeTool={state.activeTool} setTool={setTool} />
          ))}
        </div>
        {state.drawings.length > 0 && (
          <div className="drawing-count">
            チャートに {state.drawings.length} 個の描画
          </div>
        )}
      </Section>

      <Section title="テクニカル分析">
        <div className="subheader">移動平均</div>
        <Toggle
          label="SMA 5"
          value={state.indicators.sma5}
          onChange={(v) => setInd('sma5', v)}
          color="var(--amber)"
        />
        <Toggle
          label="SMA 25"
          value={state.indicators.sma25}
          onChange={(v) => setInd('sma25', v)}
          color="var(--accent)"
        />
        <Toggle
          label="SMA 75"
          value={state.indicators.sma75}
          onChange={(v) => setInd('sma75', v)}
          color="var(--magenta)"
        />
        <Toggle
          label="EMA 20"
          value={state.indicators.ema20}
          onChange={(v) => setInd('ema20', v)}
          color="var(--lime)"
        />
        <div className="subheader">オーバーレイ</div>
        <Toggle
          label="ボリンジャーバンド 20,2"
          value={state.indicators.boll}
          onChange={(v) => setInd('boll', v)}
          color="oklch(0.75 0.07 220)"
        />
        <Toggle
          label="パラボリック SAR"
          value={state.indicators.psar}
          onChange={(v) => setInd('psar', v)}
          color="oklch(0.78 0.20 350)"
        />
        <Toggle
          label="一目均衡表"
          value={state.indicators.ichi}
          onChange={(v) => setInd('ichi', v)}
          color="var(--magenta)"
        />
        <div className="subheader">オシレーター</div>
        <Toggle
          label="ストキャスティクス 14,3,3"
          value={state.indicators.stoch}
          onChange={(v) => setInd('stoch', v)}
          color="var(--accent)"
        />
        <Toggle
          label="MACD"
          value={state.indicators.macd}
          onChange={(v) => setInd('macd', v)}
          color="var(--accent)"
        />
        {state.indicators.macd && (
          <div className="param-row">
            <label>
              短期
              <input
                type="number"
                min={1}
                max={200}
                value={state.indicatorParams.macd.fast}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    indicatorParams: {
                      ...s.indicatorParams,
                      macd: { ...s.indicatorParams.macd, fast: Number(e.target.value) },
                    },
                  }))
                }
              />
            </label>
            <label>
              長期
              <input
                type="number"
                min={1}
                max={200}
                value={state.indicatorParams.macd.slow}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    indicatorParams: {
                      ...s.indicatorParams,
                      macd: { ...s.indicatorParams.macd, slow: Number(e.target.value) },
                    },
                  }))
                }
              />
            </label>
            <label>
              シグナル
              <input
                type="number"
                min={1}
                max={50}
                value={state.indicatorParams.macd.signal}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    indicatorParams: {
                      ...s.indicatorParams,
                      macd: { ...s.indicatorParams.macd, signal: Number(e.target.value) },
                    },
                  }))
                }
              />
            </label>
          </div>
        )}
        <Toggle
          label="RSI"
          value={state.indicators.rsi}
          onChange={(v) => setInd('rsi', v)}
          color="var(--lime)"
        />
        {state.indicators.rsi && (
          <div className="param-row">
            <label>
              期間
              <input
                type="number"
                min={2}
                max={200}
                value={state.indicatorParams.rsi.period}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    indicatorParams: {
                      ...s.indicatorParams,
                      rsi: { ...s.indicatorParams.rsi, period: Number(e.target.value) },
                    },
                  }))
                }
              />
            </label>
            <label>
              OB
              <input
                type="number"
                min={50}
                max={99}
                value={state.indicatorParams.rsi.overbought}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    indicatorParams: {
                      ...s.indicatorParams,
                      rsi: { ...s.indicatorParams.rsi, overbought: Number(e.target.value) },
                    },
                  }))
                }
              />
            </label>
            <label>
              OS
              <input
                type="number"
                min={1}
                max={49}
                value={state.indicatorParams.rsi.oversold}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    indicatorParams: {
                      ...s.indicatorParams,
                      rsi: { ...s.indicatorParams.rsi, oversold: Number(e.target.value) },
                    },
                  }))
                }
              />
            </label>
          </div>
        )}
      </Section>

      <Section title="ファンダメンタルズ">
        <Toggle
          label="ファンダメンタルズを表示"
          value={state.showFinancial}
          onChange={(v) => setState((s) => ({ ...s, showFinancial: v }))}
          color="var(--lime)"
        />
        {state.showFinancial && (
          <div style={{ marginTop: 6 }}>
            <Toggle
              label="ROE (%)"
              value={state.financial.roe}
              onChange={(v) => setFin('roe', v)}
              color="var(--lime)"
            />
            <Toggle
              label="ROIC (%)"
              value={state.financial.roic}
              onChange={(v) => setFin('roic', v)}
              color="var(--teal)"
            />
            <Toggle
              label="PER (×)"
              value={state.financial.per}
              onChange={(v) => setFin('per', v)}
              color="var(--amber)"
            />
          </div>
        )}
      </Section>

      <Section title="出来高">
        <Toggle
          label="出来高を表示"
          value={state.showVolume}
          onChange={(v) => setState((s) => ({ ...s, showVolume: v }))}
          color="var(--muted)"
        />
      </Section>
    </aside>
  );
}
