import { useState } from 'react';
import { useMacroDashboard } from '../../hooks/useMacroDashboard';
import type { MacroPeriod, MacroSignal } from '../../types';
import { MacroCard } from './MacroCard';
import { SignalBadge } from './SignalBadge';
import './macro.css';

const PERIODS: MacroPeriod[] = ['3M', '6M', '1Y', '2Y'];

const OVERALL_TEXT: Record<MacroSignal, string> = {
  green: '土台・幅ともに良好',
  yellow: 'breadth または流動性の劣化に注意',
  red: '後期サイクルの警戒シグナル',
  gray: '指標を取得できません',
};

export function MacroDashboard() {
  const [period, setPeriod] = useState<MacroPeriod>('1Y');
  const { data, status, error } = useMacroDashboard(period);

  return (
    <div className="macro-dashboard">
      <div className="macro-overall">
        {data ? (
          <>
            <span className="macro-overall-label">総合シグナル</span>
            <SignalBadge signal={data.overall_signal} />
            <span className="macro-overall-text">{OVERALL_TEXT[data.overall_signal]}</span>
          </>
        ) : (
          <span className="macro-overall-label">
            {status === 'loading' ? '読み込み中…' : '総合シグナル —'}
          </span>
        )}
      </div>

      {status === 'offline' && (
        <div className="macro-error">バックエンドに接続できません{error ? `: ${error}` : ''}</div>
      )}

      {data && (
        <div className="macro-cards">
          {data.indicators.map((indicator) => (
            <MacroCard key={indicator.indicator} indicator={indicator} />
          ))}
        </div>
      )}

      <div className="macro-periods">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className={`macro-period ${p === period ? 'active' : ''}`}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
